import type { DrillAnswer, DrillSuggestedTask } from '../plan-schema';

/**
 * F08 — Scenario Drills (pure).
 *
 * A drill asks questions; it never gives emergency instructions (R-DRL-1).
 * All five scenarios are grounded in the US/Mexico preparedness context and
 * complete in 10 minutes or less. One step per screen, three honest answers.
 */

export type DrillStep = {
  id: string;
  prompt: string;
  hint?: string;
  /** A "Not yet" answer offers this as a checklist task; nothing is added silently (R-DRL-2). */
  taskLink?: { title: string; detail: string; category: string };
};

export type DrillDefinition = {
  id: string;
  title: string;
  scenario: string;
  minutes: 3 | 5 | 10;
  steps: DrillStep[];
  debrief: string;
};

export type { DrillAnswer };

export const DRILLS: DrillDefinition[] = [
  {
    id: 'power-outage',
    title: 'Power outage',
    scenario: 'The grid is down for 24 hours and there is no cell service.',
    minutes: 5,
    steps: [
      { id: 'lights', prompt: 'Do you know where every flashlight is right now, without looking?', hint: 'One place everyone knows works better than three hiding spots.', taskLink: { title: 'Set one flashlight spot', detail: 'Pick one place every flashlight lives, and tell the household.', category: 'Supplies' } },
      { id: 'radio', prompt: 'Can you get news without power or cell service?', hint: 'A battery or hand-crank radio is the usual answer.', taskLink: { title: 'Get a battery radio', detail: 'A battery-powered or hand-crank radio that can receive local broadcasts.', category: 'Supplies' } },
      { id: 'devices', prompt: 'Is there one charged backup battery for phones?', hint: 'Power banks hold a charge longest when kept topped up.', taskLink: { title: 'Keep a power bank charged', detail: 'Top up a power bank and note where it lives.', category: 'Supplies' } },
      { id: 'fridge', prompt: 'Do you know how long your fridge keeps food cold shut?', hint: 'About 4 hours if unopened. The freezer holds longer.', taskLink: { title: 'Check fridge/freezer plan', detail: 'Note what gets used first in an outage and if you need ice packs.', category: 'Supplies' } },
      { id: 'cold-medication', prompt: 'Does anyone in the household need medication that must stay cold?', hint: 'A qualified cooler can hold 48 hours without ice.', taskLink: { title: 'Plan cold storage for medication', detail: 'Write down how you would keep it cold, and ask your clinician in advance.', category: 'Health' } },
      { id: 'neighbour', prompt: 'Would anyone check on you during a long outage?', hint: 'A friendly agreement counts. Practice beats paperwork.' },
    ],
    debrief: 'What would fail first in your home?',
  },
  {
    id: 'evacuation',
    title: 'Evacuation',
    scenario: 'An order is issued for your zone with about 6 hours of notice.',
    minutes: 10,
    steps: [
      { id: 'grab', prompt: 'Could each person grab a packed bag in the next 5 minutes?', taskLink: { title: 'Build the go-bags', detail: 'Use the go-bag builder and name who carries each bag.', category: 'Supplies' } },
      { id: 'medication', prompt: 'Would medication come with you, in its bottles?', hint: 'Bottles save questions at a shelter or clinic.', taskLink: { title: 'Stage a ready medication supply', detail: 'Ask your clinician what to keep packed and current.', category: 'Health' } },
      { id: 'out-of-area', prompt: 'Is there a contact outside the area everyone knows to call?', taskLink: { title: 'Record an out-of-area contact', detail: 'Plan → Communication: name, phone, and how close they live.', category: 'People' } },
      { id: 'meeting', prompt: 'Does everyone know the meeting point — including a second one?', hint: 'An address everyone can picture, not "the usual place".', taskLink: { title: 'Set a meeting point', detail: 'Plan → Communication: label, address, and a landmark note.', category: 'People' } },
      { id: 'route', prompt: 'Do you know a second way out of your neighborhood?', hint: 'Confirm it against current instructions from your local authority — routes can change.' },
      { id: 'leave-behind', prompt: 'Have you decided what you would leave behind?', hint: 'A short list written today saves minutes under stress.' },
      { id: 'documents', prompt: 'Could you put documents in one pouch fast?', taskLink: { title: 'Stash a document pouch', detail: 'Copies of IDs, insurance, and deeds in a waterproof pouch.', category: 'Home' } },
      { id: 'pets', prompt: 'Do you know which shelters or routes allow pets?', hint: 'Not every shelter does — ask before you need to know.', taskLink: { title: 'Confirm pet options', detail: 'List pet-friendly options and what the carrier needs.', category: 'Pets' } },
      { id: 'fuel', prompt: 'Is the vehicle fueled or charged above half?', hint: 'A top-up rule ("never below half") is simpler than a reminder app.', taskLink: { title: 'Adopt a fuel rule', detail: 'Agree on a minimum fuel or charge level with the household.', category: 'Travel' } },
      { id: 'washer', prompt: 'Would you unplug appliances and lock up on the way out?' },
    ],
    debrief: 'What did you decide to leave?',
  },
  {
    id: 'shelter-night',
    title: 'Shelter night',
    scenario: 'You are in a public shelter for 12 hours.',
    minutes: 5,
    steps: [
      { id: 'medication', prompt: 'Could you follow your medication schedule without your fridge, your room, or your phone?', taskLink: { title: 'Copy the medication schedule', detail: 'Paper copy in the go-bag, with doses and times.', category: 'Health' } },
      { id: 'charging', prompt: 'Do you have a way to charge devices at a shelter?', taskLink: { title: 'Pack a charging kit', detail: 'Cord, plug, and a power bank in one pouch.', category: 'Supplies' } },
      { id: 'warm', prompt: 'Do you have a layer that keeps you warm sitting still for hours?', hint: 'Shelters are cool at night. A blanket per person. Socks matter.' },
      { id: 'documents', prompt: 'Do you have ID and documents you could show quickly?', taskLink: { title: 'Check document copies', detail: 'IDs, insurance, prescriptions — copies in the pouch.', category: 'Home' } },
      { id: 'access', prompt: 'If someone needs a ramp, signage, hearing or vision support — is that written down where a stranger could help?', taskLink: { title: 'Note access needs', detail: 'Write access needs on the communication card for a stranger to read.', category: 'People' } },
      { id: 'pets', prompt: 'Do you know the shelter’s pet arrangement?', hint: 'Ask your local emergency management before the night you need it.' },
    ],
    debrief: 'What would you need that you did not bring?',
  },
  {
    id: 'home-medical',
    title: 'Home medical',
    scenario: 'A household member has a medical event and there is no signal.',
    minutes: 5,
    steps: [
      { id: 'list', prompt: 'Could someone else recite the medication list right now?', hint: 'The medical card exists for exactly this.', taskLink: { title: 'Share the medical card', detail: 'Export the medical summary card and save it where others can find it.', category: 'Health' } },
      { id: 'who', prompt: 'Do you know who to call when phones barely work?', hint: 'Text messages often go through when calls fail.' },
      { id: 'device', prompt: 'Does any device in the home need power to keep someone safe?', taskLink: { title: 'Write a power plan', detail: 'Backup hours per device and who to call for a longer outage.', category: 'Health' } },
      { id: 'facility', prompt: 'Do you know your nearest emergency facility — and a second one?' },
      { id: 'ice', prompt: 'Is there an in-case-of-emergency note a stranger could find?', taskLink: { title: 'Make an ICE note', detail: 'Phone lockscreen or wallet card: who to call and what not to miss.', category: 'People' } },
    ],
    debrief: 'Who else knows your medication list?',
  },
  {
    id: 'communication-failure',
    title: 'Communication failure',
    scenario: 'Phone networks are down for about 8 hours.',
    minutes: 3,
    steps: [
      { id: 'out-of-area', prompt: 'Is the out-of-area contact someone everyone in the household can name?', taskLink: { title: 'Confirm the out-of-area contact', detail: 'Everyone should know the same name and number for storing.', category: 'People' } },
      { id: 'meeting', prompt: 'Does everyone know where to walk, and for how long, before meeting?', taskLink: { title: 'Rehearse the meeting point', detail: 'Walk it once with the household this month.', category: 'People' } },
      { id: 'paper', prompt: 'Do you have the plan on paper, not only in the phone?', hint: 'Charge dies. Paper does not.', taskLink: { title: 'Print the plan card', detail: 'One paper copy per bag, handwritten updates allowed.', category: 'Home' } },
      { id: 'cadence', prompt: 'If you cannot check in on time, will they know what that means?', taskLink: { title: 'Set a fallback check-in', detail: 'Agree what silence means and what to do next.', category: 'People' } },
    ],
    debrief: 'Is your meeting point known to everyone?',
  },
];

export const DRILL_TITLE: Record<string, string> = Object.fromEntries(
  DRILLS.map(drill => [drill.id, drill.title]),
);

export type { DrillSuggestedTask };
