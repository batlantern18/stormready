import {
  DEFAULT_MEDICAL_CARD_FIELDS,
  medicalCardText,
  medicalKitLines,
  medicalSummary,
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

describe('medicalSummary (derived facts)', () => {
  it('counts refrigerated medications', () => {
    expect(medicalSummary(plan()).refrigeratedCount).toBe(1);
    expect(medicalSummary(plan({ medications: [{ id: 'm', name: '', dose: '', schedule: '', days: 7, refrigerated: false, prescriptionRefillDate: null, pharmacy: '', notes: '' }] })).refrigeratedCount).toBe(0);
  });

  it('counts refrigerated devices too (regression: was dropped in plan-schema refactor)', () => {
    const planWithRefrigeratedDevice: MedicalPlan = {
      medications: [],
      devices: [{ id: 'd1', name: 'Cooler', powerSource: 'battery', backupHours: 0, needsRefrigeration: true }],
      contacts: [],
      allergies: '',
      notes: '',
    };
    expect(medicalSummary(planWithRefrigeratedDevice).refrigeratedCount).toBe(1);

    const planWithBoth: MedicalPlan = {
      medications: [{ id: 'm1', name: 'Insulin', dose: '10 units', schedule: 'Morning', days: 7, refrigerated: true, prescriptionRefillDate: null, pharmacy: '', notes: '' }],
      devices: [
        { id: 'd1', name: 'Cooler', powerSource: 'battery', backupHours: 0, needsRefrigeration: true },
        { id: 'd2', name: 'Pump', powerSource: 'battery', backupHours: 0, needsRefrigeration: true },
      ],
      contacts: [],
      allergies: '',
      notes: '',
    };
    expect(medicalSummary(planWithBoth).refrigeratedCount).toBe(3);
  });

  it('detects the need for backup power only for mains/both devices', () => {
    expect(medicalSummary(plan()).powered).toBe(true);
    expect(medicalSummary(plan({ devices: [{ id: 'd', name: 'x', powerSource: 'battery', backupHours: 0, needsRefrigeration: false }] })).powered).toBe(false);
    expect(medicalSummary(plan({ devices: [] })).powered).toBe(false);
  });

  it('finds the earliest refill date', () => {
    expect(medicalSummary(plan()).earliestRefill).toBe('2026-11-01T00:00:00.000Z');
    expect(medicalSummary(plan({ medications: [] })).earliestRefill).toBeNull();
    expect(medicalSummary(plan({ medications: [{ id: 'x', name: 'x', dose: '', schedule: '', days: 7, refrigerated: false, prescriptionRefillDate: 'nonsense', pharmacy: '', notes: '' }] })).earliestRefill).toBeNull();
  });
});

describe('medical plan invariants', () => {
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

  it('emits the extra-days line at the longest supply (R-MED-9)', () => {
    const lines = medicalKitLines(plan(), DEFAULT_HOUSEHOLD);
    const extra = lines.find(line => line.id === 'medical-extra-days');
    expect(extra).toMatchObject({ quantity: 7, unit: 'day', unitPlural: 'days' });

    const long = plan({ medications: [{ id: 'a', name: 'A', dose: '', schedule: '', days: 30, refrigerated: false, prescriptionRefillDate: null, pharmacy: '', notes: '' }] });
    const longExtra = medicalKitLines(long, DEFAULT_HOUSEHOLD).find(line => line.id === 'medical-extra-days');
    expect(longExtra).toMatchObject({ quantity: 30 });

    expect(medicalKitLines(plan({ medications: [] }), DEFAULT_HOUSEHOLD).find(line => line.id === 'medical-extra-days')).toBeUndefined();
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
