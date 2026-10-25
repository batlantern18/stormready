/**
 * One scheduled identifier per optional reminder. `rotation` holds the
 * medication refill reminder (a DATE trigger keyed off the earliest refill
 * date the user entered); it is opt-in and independent of the checklist/zone
 * reminders, so those toggles must preserve it.
 */
export type ReminderIdentifiers = {
  checklist?: string;
  zone?: string;
  rotation?: string;
};

export type ReminderState = {
  enabled: boolean;
  identifiers: ReminderIdentifiers;
  updatedAt: string | null;
};

export const DEFAULT_REMINDER_STATE: ReminderState = {
  enabled: false,
  identifiers: {},
  updatedAt: null,
};
