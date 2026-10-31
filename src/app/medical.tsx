import React, { useMemo, useState, useEffect } from 'react';
import { Alert, Linking, Platform, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  isMedicalPlanEmpty,
  clampMedication,
  clampMedicalDevice,
  DEFAULT_MEDICAL_PLAN,
  LIMITS,
  type Medication,
  type MedicalDevice,
  type MedicalContact,
} from '../plan-schema';
import {
  DEFAULT_MEDICAL_CARD_FIELDS,
  medicalCardText,
  medicalSummary,
  type MedicalCardFields,
} from '../medical/model';
import { newId } from '../util/id';
import { usePlan } from '../plan';
import { setRefillReminder, loadReminderState } from '../notifications/scheduler';
import { Action, Body, Card, Disclosure, Field, Header, MotionPressable, Page, Pill, Row, Stepper, ToggleRow } from '../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../theme';
import { useT, type TranslationKey } from '../i18n';
import { formatDateShort } from '../i18n/format';

/**
 * F03 — the Medication & Medical Needs Plan.
 *
 * R-MED-1: the household's `medicalNeeds` boolean becomes derived — the plan
 * is the source of truth, and `effectiveMedicalNeeds` keeps the old input
 * working. R-MED-2: nothing here is a clinical requirement; every card names
 * the user's own input and points at a public non-clinical source. R-MED-3:
 * the card export is opt-in per field.
 */
export default function Medical() {
  const plan = usePlan();
  const router = useRouter();
  const { colors, dark } = useAppTheme();
  const { t, locale } = useT();
  const styles = dark ? darkStyles : lightStyles;
  const [editingMed, setEditingMed] = useState<string | null>(null);
  const [editingDevice, setEditingDevice] = useState<string | null>(null);
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [cardFields, setCardFields] = useState<MedicalCardFields>(DEFAULT_MEDICAL_CARD_FIELDS);
  const [cardOpen, setCardOpen] = useState(false);
  const [refillReminderOn, setRefillReminderOn] = useState(false);
  const [refillReminderBusy, setRefillReminderBusy] = useState(false);

  const medical = plan.medical;
  const empty = isMedicalPlanEmpty(medical);
  const medicalFacts = useMemo(() => medicalSummary(medical), [medical]);
  const refill = medicalFacts.earliestRefill;
  const refrigerated = medicalFacts.refrigeratedCount;
  const powered = medicalFacts.powered;

  useEffect(() => {
    let active = true;
    loadReminderState()
      .then(state => { if (active) setRefillReminderOn(Boolean(state.identifiers.rotation)); })
      .catch(() => {});
    return () => { active = false; };
  }, []);

  const patch = (update: Partial<typeof medical>) =>
    plan.setMedical({ ...medical, ...update });

  const mutateMedications = (mutate: (medications: Medication[]) => Medication[]) =>
    patch({ medications: mutate([...medical.medications]) });

  const addMedication = () => {
    const medication: Medication = {
      id: newId('med'),
      name: '',
      dose: '',
      schedule: '',
      days: plan.household.days,
      refrigerated: false,
      prescriptionRefillDate: null,
      pharmacy: '',
      notes: '',
    };
    mutateMedications(medications => [...medications, medication]);
    setEditingMed(medication.id);
  };

  const addDevice = () => {
    const device: MedicalDevice = {
      id: newId('device'),
      name: '',
      powerSource: 'battery',
      backupHours: 8,
      needsRefrigeration: false,
    };
    patch({ devices: [...medical.devices, device] });
    setEditingDevice(device.id);
  };

  const addContact = () => {
    const contact: MedicalContact = { id: newId('clinician'), name: '', phone: '', role: '' };
    patch({ contacts: [...medical.contacts, contact] });
    setEditingContact(contact.id);
  };

  const removeMedication = (entry: Medication) =>
    Alert.alert(t('medical.remove.med.title', { name: entry.name || t('medical.unnamed') }), t('medical.remove.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('medical.remove.confirm'), style: 'destructive', onPress: () => mutateMedications(medications => medications.filter(med => med.id !== entry.id)) },
    ]);

  const removeDevice = (entry: MedicalDevice) =>
    Alert.alert(t('medical.remove.device.title', { name: entry.name || t('medical.unnamed') }), t('medical.remove.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('medical.remove.confirm'), style: 'destructive', onPress: () => patch({ devices: medical.devices.filter(device => device.id !== entry.id) }) },
    ]);

  const removeContact = (entry: MedicalContact) =>
    Alert.alert(t('medical.remove.contact.title', { name: entry.name || t('medical.unnamed') }), t('medical.remove.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('medical.remove.confirm'), style: 'destructive', onPress: () => patch({ contacts: medical.contacts.filter(contact => contact.id !== entry.id) }) },
    ]);

  const shareCard = async () => {
    await Share.share({
      title: t('medical.share.title'),
      message: medicalCardText(medical, cardFields),
    }).catch(() => {});
  };

  /** One call schedules or cancels; the returned state is the single truth. */
  const toggleRefillReminder = () => {
    if (refillReminderBusy || !refill) return;
    setRefillReminderBusy(true);
    setRefillReminder(!refillReminderOn ? refill : null)
      .then(state => setRefillReminderOn(Boolean(state.identifiers.rotation)))
      .catch(() => {})
      .finally(() => setRefillReminderBusy(false));
  };

  /** R-MED-11: the plan can be removed, but never silently — confirm first. */
  const removePlan = () =>
    Alert.alert(t('medical.removePlan.title'), t('medical.removePlan.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('medical.removePlan.confirm'),
        style: 'destructive',
        onPress: () => {
          setEditingMed(null);
          setEditingDevice(null);
          setEditingContact(null);
          setCardOpen(false);
          plan.setMedical({ ...DEFAULT_MEDICAL_PLAN, medications: [], devices: [], contacts: [] });
        },
      },
    ]);

  const CARD_FIELD_ROWS: { key: keyof MedicalCardFields; labelKey: TranslationKey }[] = [
    { key: 'medications', labelKey: 'medical.card.medications' },
    { key: 'doses', labelKey: 'medical.card.doses' },
    { key: 'schedules', labelKey: 'medical.card.schedules' },
    { key: 'pharmacies', labelKey: 'medical.card.pharmacies' },
    { key: 'devices', labelKey: 'medical.card.devices' },
    { key: 'contacts', labelKey: 'medical.card.contacts' },
    { key: 'allergies', labelKey: 'medical.card.allergies' },
    { key: 'notes', labelKey: 'medical.card.notes' },
  ];

  return <Page>
    <Row style={styles.chromeGap}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('medical.eyebrow')}</Pill>
    </Row>

    <Header
      eyebrow={t('medical.eyebrow')}
      title={t('medical.title')}
      subtitle={t('medical.subtitle')}
    />

    {empty ? <Card style={{ backgroundColor: colors.sand, borderColor: colors.sand }}>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('medical.emptyTitle')}</Text>
      <Body>{t('medical.emptyBody')}</Body>
      <Row style={{ gap: 9 }}>
        <View style={{ flex: 1 }}><Action title={t('medical.add.medication')} onPress={addMedication} /></View>
        <View style={{ flex: 1 }}><Action title={t('medical.add.device')} kind="secondary" small onPress={addDevice} /></View>
      </Row>
    </Card> : null}

    {!empty && refill ? <Card style={{ backgroundColor: colors.amberBg, borderColor: colors.amberBg }}>
      <Row><Pill tone="amber">{t('medical.refill.tag')}</Pill></Row>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>
        {t('medical.refill.title', { date: formatDateShort(refill, locale) })}
      </Text>
      <Body style={{ fontSize: 11 }}>{t('medical.refill.body')}</Body>
      {Platform.OS !== 'web' ? <ToggleRow
        title={t('medical.refill.reminder')}
        detail={t('medical.refill.reminder.detail')}
        value={refillReminderOn}
        onPress={toggleRefillReminder}
      /> : null}
    </Card> : null}

    {refrigerated > 0 ? <Card style={{ backgroundColor: colors.tertiaryContainer, borderColor: colors.tertiaryContainer }}>
      <Row><Pill tone="blue">{t('medical.cooler.tag')}</Pill></Row>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{t('medical.cooler.title')}</Text>
      <Body>{t('medical.cooler.body', { count: refrigerated })}</Body>
      <Body style={{ fontSize: 12 }}>
        {t('medical.cooler.link')}<Text accessibilityRole="link" onPress={() => void Linking.openURL('https://www.cdc.gov/vaccines/hcp/admin/storage/toolkit/index.html').catch(() => {})} style={{ color: colors.primary, fontWeight: '700' }}> CDC ↗</Text>
      </Body>
    </Card> : null}

    {powered ? <Card style={{ backgroundColor: colors.amberBg, borderColor: colors.amberBg }}>
      <Row><Pill tone="amber">{t('medical.power.tag')}</Pill></Row>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{t('medical.power.title')}</Text>
      {medical.devices.filter(device => device.powerSource !== 'battery').map(device => <Row key={device.id} style={{ paddingTop: 4 }}>
        <Text style={{ flex: 1, color: colors.ink, fontWeight: '600', fontSize: 14 }}>{device.name || t('medical.unnamedDevice')}</Text>
        <Text style={{ color: colors.muted, fontSize: 12 }}>{t('medical.power.hours', { hours: device.backupHours })}</Text>
      </Row>)}
      <Body style={{ fontSize: 11 }}>{t('medical.power.body')}</Body>
    </Card> : null}

    <Card>
      <Row>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('medical.medications')}</Text>
        <Action title={t('medical.add.medication')} small kind="secondary" onPress={addMedication} />
      </Row>
      <Body style={{ fontSize: 12 }}>{t('medical.medications.body', { count: medical.medications.length })}</Body>
      {medical.medications.map((medication, index) => <View key={medication.id} style={[styles.lineRow, index > 0 && { borderTopColor: colors.outlineVariant }]}>
        <Row style={{ gap: 10 }}>
          <Text onPress={() => setEditingMed(editingMed === medication.id ? null : medication.id)} accessibilityRole="button" style={{ flex: 1, color: colors.ink, fontWeight: '700', fontSize: 15 }}>
            {editingMed === medication.id ? '▾ ' : '▸ '}{medication.name || t('medical.unnamed')}
          </Text>
          {medication.refrigerated ? <Pill tone="blue">{t('medical.coldTag')}</Pill> : null}
          {medication.prescriptionRefillDate ? <Body style={{ fontSize: 11 }}>{t('medical.refill.due', { date: formatDateShort(medication.prescriptionRefillDate, locale) })}</Body> : null}
        </Row>
        {editingMed !== medication.id && (medication.dose || medication.schedule) ? <Body style={{ fontSize: 12 }}>
          {medication.dose ? `${t('medical.field.dose')}: ${medication.dose}` : ''}{medication.dose && medication.schedule ? ' · ' : ''}{medication.schedule ? `${t('medical.field.schedule')}: ${medication.schedule}` : ''}
        </Body> : null}
        {editingMed === medication.id ? <Disclosure>
          <MedicationEditor
            medication={medication}
            defaultDays={plan.household.days}
            onChange={next => mutateMedications(medications => medications.map(med => med.id === next.id ? next : med))}
            onRemove={() => removeMedication(medication)}
            onClose={() => setEditingMed(null)}
          />
        </Disclosure> : null}
      </View>)}
    </Card>

    <Card>
      <Row>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('medical.devices')}</Text>
        <Action title={t('medical.add.device')} small kind="secondary" onPress={addDevice} />
      </Row>
      <Body style={{ fontSize: 12 }}>{t('medical.devices.body', { count: medical.devices.length })}</Body>
      {medical.devices.map((device, index) => <View key={device.id} style={[styles.lineRow, index > 0 && { borderTopColor: colors.outlineVariant }]}>
        <Row style={{ gap: 10 }}>
          <Text onPress={() => setEditingDevice(editingDevice === device.id ? null : device.id)} accessibilityRole="button" style={{ flex: 1, color: colors.ink, fontWeight: '700', fontSize: 15 }}>
            {editingDevice === device.id ? '▾ ' : '▸ '}{device.name || t('medical.unnamedDevice')}
          </Text>
          <Body style={{ fontSize: 11 }}>{t('medical.power.hours', { hours: device.backupHours })}</Body>
        </Row>
        {editingDevice === device.id ? <Disclosure>
          <DeviceEditor
            device={device}
            onChange={next => patch({ devices: medical.devices.map(item => item.id === next.id ? next : item) })}
            onRemove={() => removeDevice(device)}
            onClose={() => setEditingDevice(null)}
          />
        </Disclosure> : null}
      </View>)}
    </Card>

    <Card>
      <Row>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('medical.contacts')}</Text>
        <Action title={t('medical.add.contact')} small kind="secondary" onPress={addContact} />
      </Row>
      <Body style={{ fontSize: 12 }}>{t('medical.contacts.body')}</Body>
      {medical.contacts.map((contact, index) => <View key={contact.id} style={[styles.lineRow, index > 0 && { borderTopColor: colors.outlineVariant }]}>
        <Row style={{ gap: 10 }}>
          <Text onPress={() => setEditingContact(editingContact === contact.id ? null : contact.id)} accessibilityRole="button" style={{ flex: 1, color: colors.ink, fontWeight: '700', fontSize: 15 }}>
            {editingContact === contact.id ? '▾ ' : '▸ '}{contact.name || t('medical.unnamed')}
          </Text>
          {contact.phone ? <Pill tone="green">{t('medical.phoneOnFile')}</Pill> : null}
        </Row>
        {editingContact !== contact.id && contact.role ? <Body style={{ fontSize: 12 }}>{contact.role}</Body> : null}
        {editingContact === contact.id ? <Disclosure>
          <ContactEditor
            contact={contact}
            onChange={next => patch({ contacts: medical.contacts.map(item => item.id === next.id ? next : item) })}
            onRemove={() => removeContact(contact)}
            onClose={() => setEditingContact(null)}
          />
        </Disclosure> : null}
      </View>)}
    </Card>

    <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('medical.allergies')}</Text>
      <Field label={t('medical.allergies')} value={medical.allergies} onChangeText={allergies => patch({ allergies: allergies.slice(0, LIMITS.notes) })} multiline placeholder={t('medical.allergies.placeholder')} />
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('medical.notes')}</Text>
      <Field label={t('medical.notes')} value={medical.notes} onChangeText={notes => patch({ notes: notes.slice(0, LIMITS.notes) })} multiline placeholder={t('medical.notes.placeholder')} />
    </Card>

    <Card>
      <Row>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('medical.card.title')}</Text>
        <Action title={cardOpen ? t('common.done') : t('medical.card.action')} kind={cardOpen ? 'quiet' : 'secondary'} small onPress={() => setCardOpen(v => !v)} />
      </Row>
      <Body style={{ fontSize: 12 }}>{t('medical.card.body')}</Body>
      {cardOpen ? <>
        {CARD_FIELD_ROWS.map(row => <ToggleRow key={row.key} title={t(row.labelKey)} value={cardFields[row.key]} onPress={() => setCardFields(fields => ({ ...fields, [row.key]: !fields[row.key] }))} />)}
        <Action title={t('medical.card.share')} onPress={() => void shareCard()} />
        <Body style={{ fontSize: 11 }}>{t('medical.card.note')}</Body>
      </> : null}
    </Card>

    {!empty ? <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('medical.removePlan.title')}</Text>
      <Body style={{ fontSize: 12 }}>{t('medical.removePlan.body')}</Body>
      <Action title={t('medical.removePlan.action')} kind="secondary" onPress={removePlan} />
    </Card> : null}
  </Page>;
}

function MedicationEditor({ medication, defaultDays, onChange, onRemove, onClose }: {
  medication: Medication;
  defaultDays: number;
  onChange: (value: Medication) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { t } = useT();
  const current = clampMedication(medication);
  const [refill, setRefill] = useState(toShortDate(medication.prescriptionRefillDate));
  const refillError = refill && !isValidShortDate(refill) ? t('inventory.date.invalid') : '';

  const commitRefill = (raw: string) => {
    setRefill(raw);
    if (!raw.trim()) onChange({ ...current, prescriptionRefillDate: null });
  };

  const save = () => {
    if (refill.trim() && !isValidShortDate(refill.trim())) return;
    onChange({
      ...current,
      name: current.name.trim() || '',
      prescriptionRefillDate: refill.trim() && isValidShortDate(refill.trim()) ? refill.trim() : null,
    });
    onClose();
  };

  return <View style={{ gap: 12, marginTop: 10 }}>
    {refillError ? <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 12 }}>{refillError}</Text> : null}
    <Field label={t('medical.field.name')} value={medication.name} onChangeText={name => onChange({ ...current, name: name.slice(0, 120) })} placeholder={t('medical.field.name.placeholder')} />
    <Field label={t('medical.field.dose')} value={medication.dose} onChangeText={dose => onChange({ ...current, dose: dose.slice(0, 80) })} placeholder={t('medical.field.dose.placeholder')} />
    <Field label={t('medical.field.schedule')} value={medication.schedule} onChangeText={schedule => onChange({ ...current, schedule: schedule.slice(0, 120) })} placeholder={t('medical.field.schedule.placeholder')} />
    <Stepper
      label={t('medical.field.days')}
      detail={t('medical.field.days.detail', { default: defaultDays })}
      value={current.days}
      min={LIMITS.medicationDays.min}
      max={LIMITS.medicationDays.max}
      onChange={days => onChange({ ...current, days })}
    />
    <ToggleRow title={t('medical.field.refrigerated')} detail={t('medical.field.refrigerated.detail')} value={medication.refrigerated} onPress={() => onChange({ ...current, refrigerated: !medication.refrigerated })} />
    <Field label={t('medical.field.refill')} value={refill} onChangeText={commitRefill} placeholder={t('inventory.date.example')} />
    <Field label={t('medical.field.pharmacy')} value={medication.pharmacy} onChangeText={pharmacy => onChange({ ...current, pharmacy: pharmacy.slice(0, 160) })} placeholder={t('medical.field.pharmacy.placeholder')} />
    <Field label={t('medical.field.notes')} value={medication.notes} onChangeText={notes => onChange({ ...current, notes: notes.slice(0, LIMITS.notes) })} multiline placeholder={t('medical.field.notes.placeholder')} />
    <Row style={{ gap: 9 }}>
      <View style={{ flex: 1 }}><Action title={t('medical.save')} onPress={save} /></View>
      <View style={{ flex: 1 }}><Action title={t('medical.remove.action')} kind="quiet" onPress={onRemove} /></View>
      <View style={{ flex: 1 }}><Action title={t('common.cancel')} kind="quiet" onPress={onClose} /></View>
    </Row>
  </View>;
}

function DeviceEditor({ device, onChange, onRemove, onClose }: {
  device: MedicalDevice;
  onChange: (value: MedicalDevice) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  const current = clampMedicalDevice(device);
  const powerOptions: { value: MedicalDevice['powerSource']; labelKey: TranslationKey }[] = [
    { value: 'mains', labelKey: 'medical.device.mains' },
    { value: 'battery', labelKey: 'medical.device.battery' },
    { value: 'both', labelKey: 'medical.device.both' },
  ];
  return <View style={{ gap: 12, marginTop: 10 }}>
    <Field label={t('medical.field.name')} value={device.name} onChangeText={name => onChange({ ...current, name: name.slice(0, 120) })} placeholder={t('medical.field.device.placeholder')} />
    <Row style={{ gap: 9 }}>
      {powerOptions.map(option => <View key={option.value} style={{ flex: 1 }}>
        <Action
          title={t(option.labelKey)}
          small
          kind={device.powerSource === option.value ? 'primary' : 'quiet'}
          onPress={() => onChange({ ...current, powerSource: option.value })}
        />
      </View>)}
    </Row>
    <Stepper
      label={t('medical.device.backupHours')}
      detail={t('medical.device.backupHours.detail')}
      value={current.backupHours}
      min={LIMITS.deviceBackupHours.min}
      max={LIMITS.deviceBackupHours.max}
      onChange={backupHours => onChange({ ...current, backupHours })}
    />
    <ToggleRow title={t('medical.device.refrigeration')} detail={t('medical.device.refrigeration.detail')} value={device.needsRefrigeration} onPress={() => onChange({ ...current, needsRefrigeration: !device.needsRefrigeration })} />
    <Row style={{ gap: 9 }}>
      <View style={{ flex: 1 }}><Action title={t('medical.save')} kind="secondary" onPress={onClose} /></View>
      <View style={{ flex: 1 }}><Action title={t('medical.remove.action')} kind="quiet" onPress={onRemove} /></View>
    </Row>
  </View>;
}

function ContactEditor({ contact, onChange, onRemove, onClose }: {
  contact: MedicalContact;
  onChange: (value: MedicalContact) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return <View style={{ gap: 12, marginTop: 10 }}>
    <Field label={t('medical.field.name')} value={contact.name} onChangeText={name => onChange({ ...contact, name: name.slice(0, 120) })} placeholder={t('medical.field.contact.placeholder')} />
    <Field label={t('medical.field.role')} value={contact.role} onChangeText={role => onChange({ ...contact, role: role.slice(0, 80) })} placeholder={t('medical.field.role.placeholder')} />
    <Field label={t('medical.field.phone')} value={contact.phone} onChangeText={phone => onChange({ ...contact, phone: phone.slice(0, 40) })} keyboardType="phone-pad" placeholder={t('medical.field.phone.placeholder')} />
    <Row style={{ gap: 9 }}>
      <View style={{ flex: 1 }}><Action title={t('medical.save')} onPress={onClose} /></View>
      <View style={{ flex: 1 }}><Action title={t('medical.remove.action')} kind="quiet" onPress={onRemove} /></View>
    </Row>
  </View>;
}

function toShortDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return iso.length <= 10 ? iso : date.toISOString().slice(0, 10);
}

function isValidShortDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && value.length === 10;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  chromeGap: { gap: 10 },
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { fontSize: 15, fontWeight: '700' },
  heading: { color: colors.onSurface, fontWeight: '800', fontSize: 17 },
  lineRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 10 },
});

const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);
