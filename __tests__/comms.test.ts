import {
  commsCompletion,
  communicationCardText,
  contactDistanceMiles,
  hasOutOfAreaContact,
  isContactNear,
  needsOutOfAreaContact,
  telHref,
} from '../src/comms/model';
import { DEFAULT_COMMUNICATION_PLAN, type CommunicationPlan, type EmergencyContact } from '../src/plan-schema';

function contact(overrides: Partial<EmergencyContact> = {}): EmergencyContact {
  return { id: 'c1', name: 'Ana', phone: '555-0100', relationship: 'Aunt', distance: '200 miles', ...overrides };
}

function plan(overrides: Partial<CommunicationPlan> = {}): CommunicationPlan {
  return {
    ...DEFAULT_COMMUNICATION_PLAN,
    contacts: [contact()],
    meetingPoint: { label: 'Publix on 5th', address: '500 5th Ave', note: 'Use the north parking lot' },
    checkIn: { who: 'Ben', everyHours: 24, method: 'text message', fallback: 'Try the landline' },
    backup: { contact: 'Ana', method: 'ham radio', note: 'Channel 3' },
    ...overrides,
  };
}

describe('contact helpers', () => {
  it('builds tel: links as free text (R-COM-1)', () => {
    expect(telHref(' 555-0100 ')).toBe('tel:555-0100');
  });

  it('parses a distance number and marks under-15-mile contacts as informational (R-COM-9)', () => {
    expect(contactDistanceMiles(contact({ distance: '12.5 miles' }))).toBe(12.5);
    expect(contactDistanceMiles(contact({ distance: 'far away' }))).toBeNull();
    expect(isContactNear(contact({ distance: '10 miles' }))).toBe(true);
    expect(isContactNear(contact({ distance: '15 miles' }))).toBe(false);
    expect(isContactNear(contact({ distance: '15' }))).toBe(false);
    expect(isContactNear(contact({ distance: '' }))).toBeNull();
  });

  it('knows whether an out-of-area contact exists', () => {
    expect(hasOutOfAreaContact(plan())).toBe(true);
    expect(hasOutOfAreaContact(plan({ contacts: [contact({ name: '', phone: '' })] }))).toBe(false);
    expect(needsOutOfAreaContact(plan({ contacts: [] }))).toBe(true);
  });
});

describe('completion (derived, never stored)', () => {
  it('scores 0 on an empty plan and 100 on a complete plan', () => {
    expect(commsCompletion(DEFAULT_COMMUNICATION_PLAN)).toBe(0);
    expect(commsCompletion(plan())).toBe(100);
  });

  it('scores partial plans proportionally', () => {
    const partial = plan({
      contacts: [],
      meetingPoint: { label: 'Publix', address: '', note: '' },
      checkIn: { who: '', everyHours: 24, method: '', fallback: '' },
      backup: { contact: '', method: '', note: '' },
    });
    expect(commsCompletion(partial)).toBe(25);
  });
});

describe('communication card text (R-COM-2, R-COM-3)', () => {
  it('renders the whole plan with the zone provenance line', () => {
    const text = communicationCardText(plan(), {
      zoneLine: 'Zone C · entered by you · 12 days ago',
      householdLine: '4 people · 2 pets',
    });
    expect(text).toContain('StormReady communication card');
    expect(text).toContain('4 people · 2 pets');
    expect(text).toContain('If we are missing, contact');
    expect(text).toContain('- Aunt Ana · 555-0100');
    expect(text).toContain('Meeting point');
    expect(text).toContain('- Publix on 5th');
    expect(text).toContain('- Use the north parking lot');
    expect(text).toContain('- Ben checks in every 24 hours by text message');
    expect(text).toContain('- If there is no reply: Try the landline');
    expect(text).toContain('Backup plan');
    expect(text).toContain('Zone on record: Zone C · entered by you · 12 days ago');
    expect(text).toContain('StormReady never sends data anywhere');
  });

  it('omits unfilled sections instead of printing placeholders (R-COM-3)', () => {
    const text = communicationCardText(DEFAULT_COMMUNICATION_PLAN, {});
    expect(text).toBe('No communication plan recorded yet.');
  });

  it('renders partial check-in lines without N/A', () => {
    const text = communicationCardText(plan({
      contacts: [],
      checkIn: { who: '', everyHours: 1, method: 'ham radio', fallback: '' },
      backup: { contact: '', method: '', note: '' },
    }), {});
    expect(text).toContain('- Checks in every 1 hour by ham radio');
    expect(text).not.toContain('undefined');
    expect(text).not.toContain('N/A');
  });
});
