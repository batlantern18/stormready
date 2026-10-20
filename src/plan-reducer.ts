import {
  DEFAULT_PLAN,
  LIMITS,
  clampHousehold,
  type Destination,
  type Household,
  type PlanState,
  type VerifiedZone,
} from './plan-schema';

/**
 * Every plan state transition, expressed as a pure function. The provider in
 * `src/plan.tsx` is a thin wrapper around this reducer so the rules can be
 * unit tested without React or a renderer.
 */
export type PlanAction =
  | { type: 'replace'; value: PlanState }
  | { type: 'setHousehold'; value: Partial<Household> }
  | { type: 'toggleTask'; id: string }
  | { type: 'setTaskDone'; id: string; done: boolean }
  | { type: 'setDestination'; value: Partial<Destination> }
  | { type: 'setZone'; value: Partial<VerifiedZone> }
  | { type: 'completeOnboarding' }
  | { type: 'reset' };

export function planReducer(state: PlanState, action: PlanAction): PlanState {
  switch (action.type) {
    case 'replace':
      // Hydration from storage. The store has already validated the document.
      return action.value;
    case 'setHousehold':
      return {
        ...state,
        household: clampHousehold({ ...state.household, ...action.value }),
      };
    case 'toggleTask':
      return {
        ...state,
        tasks: state.tasks.map(task => (task.id === action.id ? { ...task, done: !task.done } : task)),
      };
    case 'setTaskDone':
      return {
        ...state,
        tasks: state.tasks.map(task => (task.id === action.id ? { ...task, done: action.done } : task)),
      };
    case 'setDestination':
      return {
        ...state,
        destination: { ...state.destination, ...action.value },
      };
    case 'setZone':
      return {
        ...state,
        zone: {
          ...state.zone,
          ...action.value,
          notes: (action.value.notes ?? state.zone.notes).slice(0, LIMITS.notes),
        },
      };
    case 'completeOnboarding':
      return { ...state, onboarded: true };
    case 'reset':
      // Clearing the plan must not send an existing user back through onboarding.
      return { ...DEFAULT_PLAN, onboarded: state.onboarded };
    default:
      return state;
  }
}
