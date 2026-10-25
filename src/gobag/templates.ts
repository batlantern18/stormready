import type { GoBagTemplate } from '../plan-schema';

/**
 * F02 — Go-bag templates (R-BAG-2): templates are data, not code branches.
 * Item ids reference the kit catalog; quantities shown in a bag always come
 * from the current `calculateKit` output.
 */

export type BagTemplateDefinition = {
  template: GoBagTemplate;
  title: string;
  scenario: string;
  itemIds: string[];
};

export const BAG_TEMPLATES: Record<GoBagTemplate, BagTemplateDefinition> = {  personal: {
    template: 'personal',
    title: 'Personal go-bag',
    scenario: 'One small bag each person can grab by the door.',
    itemIds: ['water', 'food', 'medication', 'first-aid', 'masks', 'flashlights', 'power-banks', 'cash', 'documents', 'contacts'],
  },
  vehicle: {
    template: 'vehicle',
    title: 'Vehicle kit',
    scenario: 'What you need if you must leave by car or are stuck in it.',
    itemIds: ['water', 'first-aid', 'flashlights', 'batteries', 'power-banks', 'cash', 'blankets'],
  },
  work: {
    template: 'work',
    title: 'Work bag',
    scenario: 'Enough to get home or stay somewhere safe from work.',
    itemIds: ['water', 'food', 'masks', 'flashlights', 'power-banks', 'cash', 'medication'],
  },
  kids: {
    template: 'kids',
    title: 'Kids’ bag',
    scenario: 'Small, light, and easy for a child to carry.',
    itemIds: ['water', 'food', 'masks', 'blankets', 'flashlights'],
  },
  home: {
    template: 'home',
    title: 'Home shelter kit',
    scenario: 'For staying safe at home, not for leaving.',
    itemIds: ['water', 'food', 'radio', 'batteries', 'first-aid', 'hygiene', 'flashlights'],
  },
  custom: {
    template: 'custom',
    title: 'Custom bag',
    scenario: 'Start empty and choose the lines that fit.',
    itemIds: [],
  },
};
