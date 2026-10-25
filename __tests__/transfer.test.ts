import {
  DEFAULT_EXPORT_OPTIONS,
  buildEnvelope,
  mergeEnvelope,
  parseEnvelope,
  previewImport,
  type ExportOptions,
} from '../src/transfer/model';
import {
  DEFAULT_PROFILE_ID,
  DEFAULT_PROFILE_PLAN,
  DEFAULT_TASKS,
  type PlanState,
  type ProfilePlan,
} from '../src/plan-schema';

function profile(overrides: Partial<ProfilePlan> = {}): ProfilePlan {
  return {
    ...DEFAULT_PROFILE_PLAN,
    household: { ...DEFAULT_PROFILE_PLAN.household, people: 4, county: 'Hillsborough' },
    tasks: DEFAULT_TASKS.map(task => ({ ...task, done: task.id === 'water' })),
    zone: { ...DEFAULT_PROFILE_PLAN.zone, value: '', source: 'none' },
    goBags: { bags: [{ id: 'local-bag', name: 'Home bag', owner: '', location: '', template: 'home', itemIds: ['water'], packed: {}, note: '', createdAt: '' }] },
    ...overrides,
  };
}

function state(p: ProfilePlan = profile()): PlanState {
  return { onboarded: true, activeProfileId: DEFAULT_PROFILE_ID, profiles: { [DEFAULT_PROFILE_ID]: p }, updatedAt: '2026-10-19T00:00:00.000Z' };
}

const exportedAt = '2026-10-19T00:00:00.000Z';

describe('export (F06, R-EXP-1, R-EXP-8)', () => {
  it('leaves medical and inventory out of the default export', () => {
    const envelope = buildEnvelope(profile(), DEFAULT_EXPORT_OPTIONS, { planId: 'p1', exportedAt });
    const serialized = JSON.stringify(envelope);
    expect(envelope.sections.household).toBeTruthy();
    expect(envelope.sections.tasks).toBeTruthy();
    expect(envelope.sections.communication).toBeTruthy();
    expect(envelope.sections.medical).toBeUndefined();
    expect(envelope.sections.inventory).toBeUndefined();
    expect(envelope.sections.zone).toBeUndefined();
    expect(serialized).not.toContain('Insulin');
    expect(serialized).not.toContain('dose');
    expect(serialized).not.toContain('quantityOwned');
  });

  it('includes opt-in sections when toggled (R-EXP-9)', () => {
    const options: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS, medical: true, inventory: true, zone: true };
    const envelope = buildEnvelope(profile(), options, { planId: 'p1', exportedAt });
    expect(envelope.sections.medical).toBeTruthy();
    expect(envelope.sections.inventory).toBeTruthy();
    expect(envelope.sections.zone).toBeTruthy();
  });

  it('carries the format, version, planId, and timestamp', () => {
    const envelope = buildEnvelope(profile(), DEFAULT_EXPORT_OPTIONS, { planId: 'p1', exportedAt });
    expect(envelope).toMatchObject({ format: 'stormready-plan', version: 1, planId: 'p1', exportedAt });
  });
});

describe('parse (R-EXP-5)', () => {
  it('accepts a valid envelope', () => {
    const result = parseEnvelope({ format: 'stormready-plan', version: 1, planId: 'p1', exportedAt, sections: {} });
    expect(result).toEqual({ ok: true, envelope: expect.objectContaining({ planId: 'p1' }) });
  });

  it('rejects non-plan files and newer versions without partial import', () => {
    expect(parseEnvelope({ hello: true })).toMatchObject({ ok: false });
    expect(parseEnvelope(null)).toMatchObject({ ok: false });
    expect(parseEnvelope([])).toMatchObject({ ok: false });
    expect(parseEnvelope({ format: 'stormready-plan', version: 99, planId: 'p1', exportedAt })).toMatchObject({
      ok: false,
      reason: expect.stringContaining('newer app version'),
    });
    expect(parseEnvelope({ format: 'stormready-plan', version: 1, exportedAt })).toMatchObject({ ok: false });
  });
});

describe('preview (R-EXP-3, R-EXP-10, R-EXP-12)', () => {
  it('reports additions, conflicts, and the zone skip reason', () => {
    const envelope = buildEnvelope(profile(), { ...DEFAULT_EXPORT_OPTIONS, zone: true }, { planId: 'p1', exportedAt });
    const importing = profile({
      tasks: DEFAULT_TASKS.map(task => ({ ...task, done: false })),
      goBags: { bags: [] },
      zone: { ...DEFAULT_PROFILE_PLAN.zone, value: 'Zone C', source: 'manual' },
    });
    const preview = previewImport(importing, envelope);

    expect(preview.added).toEqual([{ section: 'go-bags', count: 1 }]);
    expect(preview.conflicts).toEqual([{ section: 'checklist', count: 1 }]);
    const zoneSkip = preview.skipped.find(entry => entry.section === 'zone');
    expect(zoneSkip?.reason).toContain('never overwrites');
    for (const section of ['household', 'destination', 'communication plan']) {
      expect(preview.skipped.find(entry => entry.section === section)?.reason).toContain('nothing new');
    }
  });

  it('reports what a fresh device would gain', () => {
    const envelope = buildEnvelope(profile(), { ...DEFAULT_EXPORT_OPTIONS, zone: true }, { planId: 'p1', exportedAt });
    const preview = previewImport({ ...DEFAULT_PROFILE_PLAN }, envelope);
    expect(preview.added).toEqual(expect.arrayContaining([
      { section: 'zone', count: 1 },
      { section: 'go-bags', count: 1 },
    ]));
    // The checklist shares the default task ids: nothing "arrives", but the
    // exporter's done state supersedes the untouched local checklist.
    expect(preview.conflicts).toEqual(expect.arrayContaining([{ section: 'household', count: 1 }, { section: 'checklist', count: 1 }]));
  });

  it('reports "already imported" when re-importing the same file (R-EXP-12)', () => {
    const envelope = buildEnvelope(profile(), DEFAULT_EXPORT_OPTIONS, { planId: 'p1', exportedAt });
    const imported = mergeEnvelope(state(), envelope, 'merge');
    const preview = previewImport(imported.profiles[DEFAULT_PROFILE_ID], envelope);
    expect(preview.added).toEqual([]);
    expect(preview.conflicts).toEqual([{ section: 'go-bags', count: 1 }]);
    expect(preview.skipped.length).toBeGreaterThan(0);
    expect(preview.skipped.every(entry => entry.reason.includes('nothing new'))).toBe(true);
  });

  it('flags an empty go-bag section as skipped, not missing', () => {
    const envelope = buildEnvelope(profile({ goBags: { bags: [] } }), DEFAULT_EXPORT_OPTIONS, { planId: 'p1', exportedAt });
    expect(previewImport(profile(), envelope).skipped).toEqual(
      expect.arrayContaining([{ section: 'go-bags', reason: 'The file has no go-bags in it' }]),
    );
  });
});

describe('merge (R-EXP-2, R-EXP-4, R-EXP-13)', () => {
  it('unions go-bags, contacts, and medications by id and never deletes local data', () => {
    const envelope = buildEnvelope(profile({
      goBags: { bags: [{ id: 'away-bag', name: 'Away bag', owner: '', location: '', template: 'personal', itemIds: [], packed: {}, note: '', createdAt: '' }] },
      medical: { medications: [{ id: 'med-away', name: 'Ibuprofen', dose: '200mg', schedule: '', days: 7, refrigerated: false, prescriptionRefillDate: null, pharmacy: '', notes: '' }], devices: [], contacts: [], allergies: '', notes: '' },
    }), { ...DEFAULT_EXPORT_OPTIONS, medical: true, goBags: true }, { planId: 'p1', exportedAt });

    const merged = mergeEnvelope(state(), envelope, 'merge').profiles[DEFAULT_PROFILE_ID];
    expect(merged.goBags.bags.map(bag => bag.id)).toEqual(['local-bag', 'away-bag']);
    expect(merged.medical.medications.map(med => med.id)).toEqual(['med-away']);
  });

  it('merges the checklist by id, keeping the more complete state', () => {
    const envelope = buildEnvelope(profile({ tasks: DEFAULT_TASKS.map(task => ({ ...task, done: true })) }), DEFAULT_EXPORT_OPTIONS, { planId: 'p1', exportedAt });
    const merged = mergeEnvelope(state(), envelope, 'merge').profiles[DEFAULT_PROFILE_ID];
    expect(merged.tasks).toHaveLength(DEFAULT_TASKS.length);
    expect(merged.tasks.every(task => task.done)).toBe(true);
    const titles = merged.tasks.map(task => task.title);
    expect(titles).toEqual(DEFAULT_TASKS.map(task => task.title));
  });

  it('imports a zone only when there is none locally, relabeled manual with its original date (R-EXP-2)', () => {
    const importedZone = { ...DEFAULT_PROFILE_PLAN.zone, value: 'Zone A', source: 'florida-lookup' as const, verifiedAt: '2026-03-01T00:00:00.000Z' };
    const envelope = buildEnvelope(profile({ zone: importedZone }), { ...DEFAULT_EXPORT_OPTIONS, zone: true }, { planId: 'p1', exportedAt });

    const empty = mergeEnvelope(state(), envelope, 'merge').profiles[DEFAULT_PROFILE_ID];
    expect(empty.zone).toMatchObject({ value: 'Zone A', source: 'manual', verifiedAt: '2026-03-01T00:00:00.000Z' });

    const occupied = mergeEnvelope(state(profile({ zone: { ...DEFAULT_PROFILE_PLAN.zone, value: 'Zone C' } })), envelope, 'merge');
    expect(occupied.profiles[DEFAULT_PROFILE_ID].zone.value).toBe('Zone C');
  });

  it('leaves omitted sections exactly as they are (R-EXP-4)', () => {
    const local = profile({ medical: { medications: [{ id: 'local-med', name: 'Insulin', dose: '', schedule: '', days: 7, refrigerated: true, prescriptionRefillDate: null, pharmacy: '', notes: '' }], devices: [], contacts: [], allergies: '', notes: '' } });
    const envelope = buildEnvelope(profile(), { ...DEFAULT_EXPORT_OPTIONS, medical: false }, { planId: 'p1', exportedAt });
    const merged = mergeEnvelope(state(local), envelope, 'replace').profiles[DEFAULT_PROFILE_ID];
    expect(merged.medical.medications.map(med => med.id)).toEqual(['local-med']);
  });

  it('replaces when the user chooses replace, without deleting omitted sections', () => {
    const envelope = buildEnvelope(profile(), DEFAULT_EXPORT_OPTIONS, { planId: 'p1', exportedAt });
    const merged = mergeEnvelope(state(), envelope, 'replace').profiles[DEFAULT_PROFILE_ID];
    expect(merged.household.people).toBe(4);
    expect(merged.tasks.every(task => task.done === (task.id === 'water'))).toBe(true);
  });

  it('merges inventory without losing local entries or dates', () => {
    const local = profile({ inventory: { entries: { water: { itemId: 'water', owned: true, quantityOwned: 9, purchasedAt: null, expiresAt: null, note: '' } }, lastRotationAt: '2026-09-01T00:00:00.000Z' } });
    const envelope = buildEnvelope(profile({ inventory: { entries: { food: { itemId: 'food', owned: true, quantityOwned: 14, purchasedAt: null, expiresAt: null, note: '' } }, lastRotationAt: '2026-08-01T00:00:00.000Z' } }), { ...DEFAULT_EXPORT_OPTIONS, inventory: true }, { planId: 'p1', exportedAt });
    const merged = mergeEnvelope(state(local), envelope, 'merge').profiles[DEFAULT_PROFILE_ID];
    expect(Object.keys(merged.inventory.entries)).toEqual(['water', 'food']);
    expect(merged.inventory.lastRotationAt).toBe('2026-09-01T00:00:00.000Z');
  });

  it('reports a different destination as an addition (R-EXP-12)', () => {
    const envelope = buildEnvelope(
      profile({ destination: { label: 'Grandma in Baton Rouge', address: '301 Lake St', transport: 'car' } }),
      DEFAULT_EXPORT_OPTIONS,
      { planId: 'p1', exportedAt },
    );
    const preview = previewImport(profile(), envelope);
    expect(preview.added).toEqual(expect.arrayContaining([{ section: 'destination', count: 1 }]));
  });

  it('counts arriving medical devices and contacts, and skips a plan that adds nothing', () => {
    const awayMedical = {
      medications: [{ id: 'med-1', name: 'Ibuprofen', dose: '', schedule: '', days: 7, refrigerated: false, prescriptionRefillDate: null, pharmacy: '', notes: '' }],
      devices: [{ id: 'dev-1', name: 'CPAP', powerSource: 'battery' as const, backupHours: 8, needsRefrigeration: false }],
      contacts: [{ id: 'con-1', name: 'Dr. Rivera', phone: '', role: '' }],
      allergies: '', notes: '',
    };
    const arriving = buildEnvelope(profile({ medical: awayMedical }), { ...DEFAULT_EXPORT_OPTIONS, medical: true }, { planId: 'p1', exportedAt });
    expect(previewImport(profile(), arriving).added).toEqual(
      expect.arrayContaining([{ section: 'medical plan', count: 3 }]),
    );

    // Re-importing the same medical plan: nothing arrives, so it is skipped.
    const already = buildEnvelope(profile({ medical: awayMedical }), { ...DEFAULT_EXPORT_OPTIONS, medical: true }, { planId: 'p1', exportedAt });
    const local = profile({ medical: awayMedical });
    expect(previewImport(local, already).skipped).toEqual(
      expect.arrayContaining([{ section: 'medical plan', reason: expect.stringContaining('nothing new') }]),
    );
  });

  it('counts arriving inventory entries and skips ones the device tracks', () => {
    const inventory = { entries: { water: { itemId: 'water', owned: true, quantityOwned: 9, purchasedAt: null, expiresAt: null, note: '' } }, lastRotationAt: null };
    const envelope = buildEnvelope(
      profile({ inventory: { entries: { ...inventory.entries, food: { itemId: 'food', owned: true, quantityOwned: 12, purchasedAt: null, expiresAt: null, note: '' } }, lastRotationAt: null } }),
      { ...DEFAULT_EXPORT_OPTIONS, inventory: true },
      { planId: 'p1', exportedAt },
    );
    expect(previewImport(profile({ inventory }), envelope).added).toEqual(
      expect.arrayContaining([{ section: 'inventory', count: 1 }]),
    );
    // water itself arrives too on a fresh device; the other sections are
    // identical (already imported) but inventory must not be among the skips.
    expect(previewImport(profile({ inventory }), envelope).skipped.map(entry => entry.section)).not.toContain('inventory');

    // A device that already tracks both item ids gets nothing new.
    const both = { ...inventory, entries: { ...inventory.entries, food: { itemId: 'food', owned: false, quantityOwned: 0, purchasedAt: null, expiresAt: null, note: '' } } };
    const completeEnvelope = buildEnvelope(
      profile({ inventory: { entries: { ...inventory.entries, food: { itemId: 'food', owned: true, quantityOwned: 12, purchasedAt: null, expiresAt: null, note: '' } }, lastRotationAt: null } }),
      { ...DEFAULT_EXPORT_OPTIONS, inventory: true },
      { planId: 'p1', exportedAt },
    );
    expect(previewImport(profile({ inventory: both }), completeEnvelope).skipped).toEqual(
      expect.arrayContaining([{ section: 'inventory', reason: expect.stringContaining('nothing new') }]),
    );
  });

  it('adds brand new tasks in a merge instead of matching by position', () => {
    const newTask = { id: 'task-away', title: 'Fuel the car', detail: '', category: 'Travel', done: false, optional: false };
    const envelope = buildEnvelope(profile({ tasks: [...DEFAULT_TASKS, newTask] }), DEFAULT_EXPORT_OPTIONS, { planId: 'p1', exportedAt });
    const merged = mergeEnvelope(state(), envelope, 'merge').profiles[DEFAULT_PROFILE_ID];
    expect(merged.tasks.some(task => task.id === 'task-away' && task.title === 'Fuel the car')).toBe(true);
  });

  it('replaces inventory with the incoming cleaned list and its rotation date', () => {
    const local = profile({ inventory: { entries: { water: { itemId: 'water', owned: true, quantityOwned: 9, purchasedAt: null, expiresAt: null, note: '' }, soap: { itemId: 'soap', owned: true, quantityOwned: 2, purchasedAt: null, expiresAt: null, note: '' } }, lastRotationAt: '2026-09-01T00:00:00.000Z' } });
    const envelope = buildEnvelope(
      profile({ inventory: { entries: { food: { itemId: 'food', owned: true, quantityOwned: 14, purchasedAt: null, expiresAt: null, note: '' } }, lastRotationAt: '2026-08-01T00:00:00.000Z' } }),
      { ...DEFAULT_EXPORT_OPTIONS, inventory: true },
      { planId: 'p1', exportedAt },
    );

    const replaced = mergeEnvelope(state(local), envelope, 'replace').profiles[DEFAULT_PROFILE_ID];
    expect(Object.keys(replaced.inventory.entries)).toEqual(['food']);
    expect(replaced.inventory.lastRotationAt).toBe('2026-08-01T00:00:00.000Z');
  });
});
