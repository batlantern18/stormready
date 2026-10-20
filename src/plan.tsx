import React, { createContext, useContext, useEffect, useMemo, useReducer, useState } from 'react';
import { DEFAULT_PLAN, type Destination, type Household, type PlanState, type VerifiedZone } from './plan-schema';
import { planReducer } from './plan-reducer';
import { keys } from './storage/keys';
import { load, remove, save } from './storage/store';

type PlanContext = PlanState & {
  ready: boolean;
  setHousehold: (value: Partial<Household>) => void;
  toggleTask: (id: string) => void;
  setTaskDone: (id: string, done: boolean) => void;
  setDestination: (value: Partial<Destination>) => void;
  setZone: (value: Partial<VerifiedZone>) => void;
  completeOnboarding: () => void;
  reset: () => Promise<void>;
};

const Context = createContext<PlanContext | null>(null);

export function PlanProvider({ children }: React.PropsWithChildren) {
  const [plan, dispatch] = useReducer(planReducer, DEFAULT_PLAN);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let active = true;
    load(keys.plan)
      .then(value => { if (active) dispatch({ type: 'replace', value }); })
      .catch(() => { /* the store already falls back to defaults */ })
      .finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (ready) save(keys.plan, plan);
  }, [plan, ready]);

  const value = useMemo<PlanContext>(() => ({
    ...plan,
    ready,
    setHousehold: update => dispatch({ type: 'setHousehold', value: update }),
    toggleTask: id => dispatch({ type: 'toggleTask', id }),
    setTaskDone: (id, done) => dispatch({ type: 'setTaskDone', id, done }),
    setDestination: update => dispatch({ type: 'setDestination', value: update }),
    setZone: update => dispatch({ type: 'setZone', value: update }),
    completeOnboarding: () => dispatch({ type: 'completeOnboarding' }),
    reset: async () => {
      await remove(keys.plan);
      dispatch({ type: 'reset' });
    },
  }), [plan, ready]);

  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export function usePlan() {
  const value = useContext(Context);
  if (!value) throw new Error('usePlan must be used within PlanProvider');
  return value;
}

/** Re-exported so domain modules can share the household action type. */
export type { PlanContext };

/**
 * The state transitions live in a pure reducer so they can be tested without
 * React. It is re-exported here so the provider module stays the single entry
 * point for plan state.
 */
export { planReducer } from './plan-reducer';
export type { PlanAction } from './plan-reducer';
