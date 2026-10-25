import {
  DEFAULT_MEDICAL_CARD_FIELDS,
  earliestRefill,
  longestPrescriptionDays,
  medicalCardText,
  medicalKitLines,
  needsPower,
  needsRefrigeration,
  refrigeratedCount,
} from '../src/medical/model';
import { DEFAULT_HOUSEHOLD, clampMedication, clampMedicalDevice, isMedicalPlanEmpty, type MedicalPlan } from '../src/plan-schema';

function plan(overrides: Partial<MedicalPlan> = {}): MedicalPlan {
  return {
    medications: [{
      id: 'm1', name: 'Insulin', dose: '10 units', schedule: 'Morning', days: 7,
      refrigerated: true, prescriptionRefillDate: '2026-11-01T00:00:00.000Z', pharmacy: 'Corner Rx', notes: '',
    }],
    devices: [{ id: 'd1', name: 'CPAP', powerSource: 'both', backupHours: 4, needsRefrigeration: false }],
    contacts: [{ id: 'c1', name: 'Dr. Rivera', phone: '555-0100', role: 'Clinician' }],
    allergies: 'Penicillin',
    notes: '',
    ...overrides,
  };
}

describe('medical derivations', () => {
  it('detects refrigeration from medications and devices', () => {
    expect(needsRefrigeration(plan())).toBe(true);
    expect(needsRefrigeration(plan({ medications: [{ id: 'm', name: '', dose: '', schedule: '', days: 7, refrigerated: false, prescriptionRefillDate: null, pharmacy: '', notes: '' }] }))).toBe(false);
    expect(refrigeratedCount(plan())).toBe(1);
  });

  it('detects the need for backup power only for mains/both devices', () => {
    expect(needsPower(plan())).toBe(true);
    expect(needsPower(plan({ devices: [{ id: 'd', name: 'x', powerSource: 'battery', backupHours: 0, needsRefrigeration: false }] }))).toBe(false);
    expect(needsPower(plan({ devices: [] }))).toBe(false);
  });

  it('reports the longest prescription supply (R-MED-9)', () => {
    expect(longestPrescriptionDays(plan())).toBe(7);
    const long = plan({ medications: [{ id: 'a', name: 'A', dose: '', schedule: '', days: 30, refrigerated: false, prescriptionRefillDate: null, pharmacy: '', notes: '' }] });
    expect(longestPrescriptionDays(long)).toBe(30);
    expect(longestPrescriptionDays(plan({ medications: [] }))).toBeNull();
  });

  it('finds the earliest refill date', () => {
    expect(earliestRefill(plan())).toBe('2026-11-01T00:00:00.000Z');
    expect(earliestRefill(plan({ medications: [] }))).toBeNull();
    expect(earliestRefill(plan({ medications: [{ id: 'x', name: 'x', dose: '', schedule: '', days: 7, refrigerated: false, prescriptionRefillDate: 'nonsense', pharmacy: '', notes: '' }] }))).toBeNull();
  });

  it('treats an empty plan as empty', () => {
    expect(isMedicalPlanEmpty(plan({ medications: [], devices: [], contacts: [], allergies: ' ', notes: '' }))).toBe(true);
    expect(isMedicalPlanEmpty(plan())).toBe(false);
  });

  it('clamps days into [1, 365] and backup hours into [0, 168] (R-MED-4)', () => {
    expect(clampMedication({ id: 'm', name: '', dose: '', schedule: '', days: 999, refrigerated: false, prescriptionRefillDate: 5 as never, pharmacy: '', notes: '' }).days).toBe(365);
    expect(clampMedication({ id: 'm', name: '', dose: '', schedule: '', days: 0, refrigerated: false, prescriptionRefillDate: null, pharmacy: '', notes: '' }).days).toBe(1);
    expect(clampMedication({ id: 'm', name: '', dose: '', schedule: '', days: 10.4, refrigerated: false, prescriptionRefillDate: null, pharmacy: '', notes: '' }).days).toBe(10);
    expect(clampMedicalDevice({ id: 'd', name: '', powerSource: 'mains', backupHours: 500, needsRefrigeration: false }).backupHours).toBe(168);
  });
});

describe('medical kit lines (F03)', () => {
  it('emits a cooler pack line when something needs refrigeration', () => {
    const lines = medicalKitLines(plan(), DEFAULT_HOUSEHOLD);
    const cooler = lines.find(line => line.id === 'medical-cooler-pack');
    expect(cooler).toBeTruthy();
    expect(cooler?.basis).toContain('1 refrigerated medicine');
    expect(cooler?.category).toBe('medical');
  });

  it('emits a backup power line naming only devices that need mains power', () => {
    const lines = medicalKitLines(plan(), DEFAULT_HOUSEHOLD);
    const power = lines.find(line => line.id === 'medical-backup-power');
    expect(power?.basis).toContain('CPAP');
  });

  it('emits the extra-days line at the longest supply', () => {
    const lines = medicalKitLines(plan(), DEFAULT_HOUSEHOLD);
    const extra = lines.find(line => line.id === 'medical-extra-days');
    expect(extra).toMatchObject({ quantity: 7, unit: 'day', unitPlural: 'days' });
  });

  it('emits nothing for an empty plan', () => {
    expect(medicalKitLines(plan({ medications: [], devices: [] }), DEFAULT_HOUSEHOLD)).toEqual([]);
  });
});

describe('medical card export (R-MED-3, R-MED-10)', () => {
  it('shows only the selected fields — pharmacies never leak by default', () => {
    const text = medicalCardText(plan(), DEFAULT_MEDICAL_CARD_FIELDS);
    expect(text).toContain('StormReady medical summary card');
    expect(text).toContain('- Insulin · dose: 10 units · schedule: Morning');
    expect(text).toContain('Penicillin');
    expect(text).not.toContain('Corner Rx');
    expect(text).not.toContain('CPAP');
    expect(text).not.toContain('Dr. Rivera');
  });

  it('includes opt-in fields when selected', () => {
    const text = medicalCardText(plan(), { ...DEFAULT_MEDICAL_CARD_FIELDS, pharmacies: true, devices: true, contacts: true, notes: true });
    expect(text).toContain('pharmacy: Corner Rx');
    expect(text).toContain('CPAP (both, backup 4 h)');
    expect(text).toContain('Clinician: Dr. Rivera · 555-0100');
  });

  it('is explicit when there is no plan recorded', () => {
    expect(medicalCardText(plan({ medications: [], devices: [], contacts: [], allergies: '', notes: '' }), DEFAULT_MEDICAL_CARD_FIELDS)).toBe('No medical plan recorded yet.');
  });
});
