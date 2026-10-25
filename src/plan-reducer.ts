import {
  DEFAULT_PLAN,
  DEFAULT_PROFILE_PLAN,
  LIMITS,
  clampCheckIn,
  clampHousehold,
  normalizeCountry,
  type CommunicationPlan,
  type Destination,
  type DrillResult,
  type GoBagState,
  type Household,
  type InventoryState,
  type MedicalPlan,
  type PlanState,
  type ProfilePlan,
  type Task,
  type VerifiedZone,
} from './plan-schema';

/**
 * Every plan state transition, expressed as a pure function. The provider in
 * `src/plan.tsx` is a thin wrapper around this reducer so the rules can be
 * unit tested without React or a renderer. All feature mutations apply to the
 * active profile's document (schema v3); there is exactly one profile in
 * v1.2, so `activeProfileId` is always resolvable here.
 */
export type PlanAction =
  | { type: 'replace'; value: PlanState }
  | { type: 'setHousehold'; value: Partial<Household> }
  | { type: 'toggleTask'; id: string }
  | { type: 'setTaskDone'; id: string; done: boolean }
  | { type: 'addTask'; value: Task }
  | { type: 'setDestination'; value: Partial<Destination> }
  | { type: 'setZone'; value: Partial<VerifiedZone> }
  | { type: 'completeOnboarding' }
  | { type: 'setInventory'; value: InventoryState }
  | { type: 'setGoBags'; value: GoBagState }
  | { type: 'setMedical'; value: MedicalPlan }
  | { type: 'setCommunication'; value: CommunicationPlan }
  | { type: 'addDrillResult'; value: DrillResult }
  | { type: 'reset' }
  | { type: 'wipe' };

/** Applies `updater` to the active profile's document, leaving the rest intact. */
function withActiveProfile(
  state: PlanState,
  updater: (profile: ProfilePlan) => ProfilePlan,
): PlanState {
  const profiles = { ...state.profiles };
  const current: ProfilePlan = profiles[state.activeProfileId] ?? DEFAULT_PROFILE_PLAN;
  return { ...state, profiles: { ...profiles, [state.activeProfileId]: updater(current) } };
}

export function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'replace':
      // Hydration from storage. The store has already validated the document.
      return action.value;
    case 'setHousehold':
      return withActiveProfile(state, profile => ({
        ...profile,
        household: clampHousehold({ ...profile.household, ...action.value }),
      }));
    case 'toggleTask':
      return withActiveProfile(state, profile => ({
        ...profile,
        tasks: profile.tasks.map(task => (task.id === action.id ? { ...task, done: !task.done } : task)),
      }));
    case 'setTaskDone':
      return withActiveProfile(state, profile => ({
        ...profile,
        tasks: profile.tasks.map(task => (task.id === action.id ? { ...task, done: action.done } : task)),
      }));
    case 'addTask':
      // Drill suggestions and imports join the checklist by id; an existing
      // task with the same id is kept exactly as the user left it.
      if (state.profiles[state.activeProfileId]?.tasks.some(task => task.id === action.value.id)) {
        return state;
      }
      return withActiveProfile(state, profile => ({
        ...profile,
        tasks: [...profile.tasks, action.value],
      }));
    case 'setDestination':
      return withActiveProfile(state, profile => ({
        ...profile,
        destination: { ...profile.destination, ...action.value },
      }));
    case 'setZone':
      return withActiveProfile(state, profile => ({
        ...profile,
        zone: {
          ...profile.zone,
          ...action.value,
          notes: (action.value.notes ?? profile.zone.notes).slice(0, LIMITS.notes),
          country: normalizeCountry(action.value.country ?? profile.zone.country),
        },
      }));
    case 'completeOnboarding':
      return { ...state, onboarded: true };
    case 'setInventory':
      return withActiveProfile(state, profile => ({ ...profile, inventory: action.value }));
    case 'setGoBags':
      return withActiveProfile(state, profile => ({ ...profile, goBags: action.value }));
    case 'setMedical':
      return withActiveProfile(state, profile => ({ ...profile, medical: action.value }));
    case 'setCommunication':
      return withActiveProfile(state, profile => ({
        ...profile,
        communication: {
          ...action.value,
          checkIn: clampCheckIn(action.value.checkIn),
        },
      }));
    case 'addDrillResult':
      return withActiveProfile(state, profile => ({
        ...profile,
        drills: { results: [action.value, ...profile.drills.results] },
      }));
    case 'reset':
      // Clearing the plan must not send an existing user back through onboarding.
      return { ...DEFAULT_PLAN, onboarded: state.onboarded };
    case 'wipe':
      // The full "delete all my data" action: back to first-run onboarding.
      return { ...DEFAULT_PLAN };

    default:
      return state;
  }
}
