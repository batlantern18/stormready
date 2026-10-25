import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_PLAN,
  type CommunicationPlan,
  type Destination,
  type GoBag,
  type Household,
  type InventoryEntry,
  type InventoryState,
  type MedicalPlan,
  type PlanState,
  type ProfilePlan,
  type Task,
  type VerifiedZone,
  clampInventoryEntry,
  clampMedicalDevice,
  clampMedication,
} from '../plan-schema';

/**
 * F06 — Household Transfer (pure model).
 *
 * A self-contained `.stormready-plan` file travels by whatever transport the
 * user already has — cable, Bluetooth, email, a messaging app — and is never
 * uploaded anywhere (R-EXP-7). Medical and inventory are excluded unless
 * explicitly enabled (R-EXP-1); the zone moves only when allowed, and is then
 * imported as `manual` with its original verification facts (R-EXP-2).
 */

export type PlanEnvelope = {
  format: 'stormready-plan';
  version: 1;
  planId: string;
  exportedAt: string;
  sections: {
    household?: Household;
    tasks?: Task[];
    destination?: Destination;
    zone?: VerifiedZone; // present only if the user explicitly allows it
    communication?: CommunicationPlan;
    medical?: MedicalPlan;
    goBags?: GoBag[];
    inventory?: InventoryState;
  };
};

export type ImportPreview = {
  planId: string;
  exportedAt: string;
  added: { section: string; count: number }[];
  conflicts: { section: string; count: number }[];
  skipped: { section: string; reason: string }[];
};

export type ExportOptions = {
  household: boolean;
  checklist: boolean;
  destination: boolean;
  zone: boolean;
  communication: boolean;
  medical: boolean;
  goBags: boolean;
  inventory: boolean;
};

/** R-EXP-1: medical and inventory are excluded by default. */
export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  household: true,
  checklist: true,
  destination: true,
  zone: false,
  communication: true,
  medical: false,
  goBags: true,
  inventory: false,
};

export function buildEnvelope(
  profile: ProfilePlan,
  options: ExportOptions,
  input: { planId: string; exportedAt: string },
): PlanEnvelope {
  return {
    format: 'stormready-plan',
    version: 1,
    planId: input.planId,
    exportedAt: input.exportedAt,
    sections: {
      ...(options.household ? { household: profile.household } : {}),
      ...(options.checklist ? { tasks: profile.tasks } : {}),
      ...(options.destination ? { destination: profile.destination } : {}),
      ...(options.zone ? { zone: profile.zone } : {}),
      ...(options.communication ? { communication: profile.communication } : {}),
      ...(options.medical ? { medical: profile.medical } : {}),
      ...(options.goBags ? { goBags: profile.goBags.bags } : {}),
      ...(options.inventory ? { inventory: profile.inventory } : {}),
    },
  };
}

export type EnvelopeParseResult =
  | { ok: true; envelope: PlanEnvelope }
  | { ok: false; reason: string };

/** R-EXP-5: an unknown format or a newer version is rejected, not imported. */
export function parseEnvelope(raw: unknown): EnvelopeParseResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, reason: 'That file is not a StormReady plan.' };
  }
  const candidate = raw as Partial<PlanEnvelope>;
  if (candidate.format !== 'stormready-plan') {
    return { ok: false, reason: 'That file is not a StormReady plan.' };
  }
  if (candidate.version !== 1) {
    return { ok: false, reason: 'That plan was exported by a newer app version. Update the app and try again.' };
  }
  if (!candidate.planId || typeof candidate.exportedAt !== 'string') {
    return { ok: false, reason: 'The plan file is missing important details.' };
  }
  return {
    ok: true,
    envelope: {
      format: 'stormready-plan',
      version: 1,
      planId: candidate.planId,
      exportedAt: candidate.exportedAt,
      sections: candidate.sections ?? {},
    },
  };
}

/** R-EXP-3: import never overwrites without a preview and an explicit choice. */
export function previewImport(current: ProfilePlan, envelope: PlanEnvelope): ImportPreview {
  const added: ImportPreview['added'] = [];
  const conflicts: ImportPreview['conflicts'] = [];
  const skipped: ImportPreview['skipped'] = [];
  const s = envelope.sections;
  const already = 'already imported — this file has nothing new for that part';

  if (s.household) {
    if (sameHousehold(current.household, s.household)) skipped.push({ section: 'household', reason: already });
    else conflicts.push({ section: 'household', count: 1 });
  }
  if (s.tasks) {
    const arriving = s.tasks.filter(task => !current.tasks.some(local => local.id === task.id));
    const superseding = s.tasks.filter(task => {
      const local = current.tasks.find(entry => entry.id === task.id);
      return local && task.done && !local.done;
    });
    if (arriving.length) added.push({ section: 'checklist', count: arriving.length });
    if (superseding.length) conflicts.push({ section: 'checklist', count: superseding.length });
    if (!arriving.length && !superseding.length) skipped.push({ section: 'checklist', reason: already });
  }
  if (s.destination) {
    const same = s.destination.label === current.destination.label
      && s.destination.address === current.destination.address
      && s.destination.transport === current.destination.transport;
    if (same) skipped.push({ section: 'destination', reason: already });
    else added.push({ section: 'destination', count: 1 });
  }
  if (s.zone) {
    if (current.zone.value.trim()) {
      skipped.push({
        section: 'zone',
        reason: 'Your device already has a zone on record. Importing never overwrites it — zones are verified locally, by you.',
      });
    } else {
      added.push({ section: 'zone', count: 1 });
    }
  }
  if (s.communication) {
    const arrivingContacts = s.communication.contacts.filter(contact => !current.communication.contacts.some(local => local.id === contact.id));
    const meetingArriving = !sameMeeting(current.communication.meetingPoint, s.communication.meetingPoint)
      && Boolean(s.communication.meetingPoint.label.trim() || s.communication.meetingPoint.address.trim());
    if (arrivingContacts.length) added.push({ section: 'communication contacts', count: arrivingContacts.length });
    if (meetingArriving) added.push({ section: 'meeting point', count: 1 });
    if (!arrivingContacts.length && !meetingArriving) skipped.push({ section: 'communication plan', reason: already });
  }
  if (s.medical) {
    const arrivingMeds = s.medical.medications.filter(medication => !current.medical.medications.some(local => local.id === medication.id));
    const arrivingDevices = s.medical.devices.filter(device => !current.medical.devices.some(local => local.id === device.id));
    const arrivingContacts = s.medical.contacts.filter(contact => !current.medical.contacts.some(local => local.id === contact.id));
    const total = arrivingMeds.length + arrivingDevices.length + arrivingContacts.length;
    if (total) added.push({ section: 'medical plan', count: total });
    else skipped.push({ section: 'medical plan', reason: already });
  }
  if (s.goBags) {
    const arriving = s.goBags.filter(bag => !current.goBags.bags.some(local => local.id === bag.id));
    const overlapping = s.goBags.length - arriving.length;
    if (arriving.length) added.push({ section: 'go-bags', count: arriving.length });
    if (overlapping) conflicts.push({ section: 'go-bags', count: overlapping });
    if (!s.goBags.length) skipped.push({ section: 'go-bags', reason: 'The file has no go-bags in it' });
  }
  if (s.inventory) {
    const arriving = Object.values(s.inventory.entries).filter(entry => !current.inventory.entries[entry.itemId]);
    const total = arriving.length;
    if (total) added.push({ section: 'inventory', count: total });
    else skipped.push({ section: 'inventory', reason: already });
  }

  return { planId: envelope.planId, exportedAt: envelope.exportedAt, added, conflicts, skipped };
}

function sameHousehold(a: Household, b: Household): boolean {
  return a.people === b.people
    && a.infants === b.infants
    && a.days === b.days
    && a.pets === b.pets
    && a.petCount === b.petCount
    && a.hasVehicle === b.hasVehicle
    && a.medicalNeeds === b.medicalNeeds
    && a.accessibilityNeeds === b.accessibilityNeeds
    && a.county === b.county
    && a.country === b.country
    && a.state === b.state;
}

function sameMeeting(a: { label: string; address: string }, b: { label: string; address: string }): boolean {
  return a.label === b.label && a.address === b.address;
}

export type MergeMode = 'merge' | 'replace';

/**
 * R-EXP-4: merge never deletes local data; sections the envelope omits are
 * left exactly as they are. The result flows through the normal plan store
 * path, so versioning and corruption quarantine still apply.
 */
export function mergeEnvelope(current: PlanState, envelope: PlanEnvelope, mode: MergeMode): PlanState {
  const profileId = current.activeProfileId || DEFAULT_PROFILE_ID;
  const profile = current.profiles[profileId] ?? DEFAULT_PROFILE_PLAN;
  const s = envelope.sections;

  const household = s.household
    ? mode === 'replace'
      ? s.household
      : { ...profile.household, ...s.household }
    : profile.household;

  const tasks = s.tasks
    ? (mode === 'replace'
        ? [...s.tasks]
        : mergeTasks(profile.tasks, s.tasks))
    : profile.tasks;

  const destination = s.destination
    ? mode === 'replace'
      ? s.destination
      : { ...profile.destination, ...s.destination }
    : profile.destination;

  // R-EXP-2: an imported zone keeps its original verification date and
  // provenance, and is always re-labeled `manual` — never a fresh check.
  const zone: VerifiedZone = s.zone && !profile.zone.value.trim()
    ? { ...s.zone, source: 'manual', country: s.zone.country ?? profile.zone.country }
    : profile.zone;

  const communication: CommunicationPlan | undefined = s.communication
    ? (mode === 'replace'
        ? s.communication
        : {
            contacts: unionById(profile.communication.contacts, s.communication.contacts),
            meetingPoint: s.communication.meetingPoint.label.trim() || s.communication.meetingPoint.address.trim()
              ? s.communication.meetingPoint
              : profile.communication.meetingPoint,
            checkIn: s.communication.checkIn.who.trim() || s.communication.checkIn.method.trim()
              ? s.communication.checkIn
              : profile.communication.checkIn,
            backup: s.communication.backup.contact.trim() || s.communication.backup.method.trim()
              ? s.communication.backup
              : profile.communication.backup,
          })
    : undefined;

  const medical: MedicalPlan | undefined = s.medical
    ? (mode === 'replace'
        ? s.medical
        : {
            medications: unionById(profile.medical.medications, s.medical.medications.map(clampMedication)),
            devices: unionById(profile.medical.devices, s.medical.devices.map(clampMedicalDevice)),
            contacts: unionById(profile.medical.contacts, s.medical.contacts),
            allergies: profile.medical.allergies || s.medical.allergies,
            notes: profile.medical.notes || s.medical.notes,
          })
    : undefined;

  const goBags = s.goBags ? unionById(profile.goBags.bags, s.goBags) : undefined;
  const inventory = s.inventory ? mergeInventory(profile.inventory, s.inventory, mode) : undefined;

  const nextProfile: ProfilePlan = {
    ...profile,
    household,
    tasks,
    destination,
    zone,
    ...(communication ? { communication } : {}),
    ...(medical ? { medical } : {}),
    ...(goBags ? { goBags: { bags: goBags } } : {}),
    ...(inventory ? { inventory } : {}),
  };

  return {
    ...current,
    activeProfileId: profileId,
    profiles: { ...current.profiles, [profileId]: nextProfile },
  };
}

function mergeTasks(local: Task[], arriving: Task[]): Task[] {
  const byId = new Map(local.map(task => [task.id, task]));
  const result = [...local];
  for (const task of arriving) {
    const existing = byId.get(task.id);
    if (!existing) {
      byId.set(task.id, task);
      result.push(task);
      continue;
    }
    // "Keeping the more complete state": a done task wins; titles/details stay local.
    if (task.done && !existing.done) {
      const merged = { ...existing, done: true };
      byId.set(task.id, merged);
      result[result.findIndex(entry => entry.id === task.id)] = merged;
    }
  }
  return result;
}

function unionById<T extends { id: string }>(local: T[], arriving: T[]): T[] {
  const ids = new Set(local.map(item => item.id));
  return [...local, ...arriving.filter(item => !ids.has(item.id))];
}

function mergeInventory(local: InventoryState, arriving: InventoryState, mode: MergeMode): InventoryState {
  if (mode === 'replace') {
    const entries: Record<string, InventoryEntry> = {};
    for (const entry of Object.values(arriving.entries)) {
      const clean = clampInventoryEntry(entry);
      if (clean.itemId) entries[clean.itemId] = clean;
    }
    return { entries, lastRotationAt: arriving.lastRotationAt };
  }
  const entries = { ...local.entries };
  for (const entry of Object.values(arriving.entries)) {
    // Local entries win where both sides have the item (never deletes local data).
    if (!entries[entry.itemId]) entries[clampInventoryEntry(entry).itemId] = clampInventoryEntry(entry);
  }
  return { entries, lastRotationAt: local.lastRotationAt ?? arriving.lastRotationAt };
}
