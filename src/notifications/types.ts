export type ReminderIdentifiers = {
  checklist?: string;
  zone?: string;
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
