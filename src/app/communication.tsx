import React, { useMemo, useState } from 'react';
import { Alert, Linking, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import {
  clampCheckIn,
  type CommunicationPlan,
  type EmergencyContact,
  type CheckInPlan,
} from '../plan-schema';
import { communicationCardText, commsCompletion, isContactNear, telHref } from '../comms/model';
import { zoneSummary } from '../zone/verification';
import { newId } from '../util/id';
import { usePlan } from '../plan';
import { Action, Body, Card, Disclosure, Field, Header, MotionPressable, Page, Pill, Row } from '../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../theme';
import { useT } from '../i18n';

const CHECK_IN_OPTIONS = [6, 12, 24, 48];

/**
 * F04 — Family Communication & Meeting Plan. Four parts, each optional, all
 * offline: out-of-area contacts, a meeting point, a check-in plan, a backup.
 * R-COM-1: phone numbers are free text rendered as tel: links and never
 * dialed automatically. The shared card omits anything left blank (R-COM-3)
 * and carries the zone label with its provenance and age (R-COM-2).
 */
export default function Communication() {
  const plan = usePlan();
  const router = useRouter();
  const { colors, dark } = useAppTheme();
  const { t } = useT();
  const styles = dark ? darkStyles : lightStyles;
  const [editingId, setEditingId] = useState<string | null>(null);

  const communication = plan.communication;
  const completion = commsCompletion(communication);
  const zone = useMemo(() => zoneSummary(plan.zone), [plan.zone]);

  const patch = (update: Partial<typeof communication>) =>
    plan.setCommunication({ ...communication, ...update });

  const patchMeeting = (update: Partial<typeof communication.meetingPoint>) =>
    patch({ meetingPoint: { ...communication.meetingPoint, ...update } });

  const patchCheckIn = (update: Partial<CheckInPlan>) =>
    patch({ checkIn: clampCheckIn({ ...communication.checkIn, ...update }) });

  const patchBackup = (update: Partial<typeof communication.backup>) =>
    patch({ backup: { ...communication.backup, ...update } });

  const addContact = () => {
    const contact: EmergencyContact = { id: newId('contact'), name: '', phone: '', relationship: '', distance: '' };
    patch({ contacts: [...communication.contacts, contact] });
    setEditingId(contact.id);
  };

  const removeContact = (entry: EmergencyContact) =>
    Alert.alert(t('comms.remove.title', { name: entry.name || t('comms.unnamed') }), t('comms.remove.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('comms.remove.confirm'), style: 'destructive', onPress: () => patch({ contacts: communication.contacts.filter(contact => contact.id !== entry.id) }) },
    ]);

  const zoneLine = [
    zone.label,
    zone.provenance,
    zone.ageDays !== null ? t('comms.card.zoneAge', { days: zone.ageDays }) : '',
  ].filter(Boolean).join(' · ');

  const householdLine = [
    `${plan.household.people} ${plan.household.people === 1 ? t('comms.person') : t('comms.people')}`,
    plan.household.pets ? t('comms.pets', { count: plan.household.petCount }) : '',
  ].filter(Boolean).join(' · ');

  const shareCard = async () => {
    await Share.share({
      title: t('comms.share.title'),
      message: communicationCardText(communication, { zoneLine, householdLine }),
    }).catch(() => {});
  };

  return <Page>
    <Row style={styles.chromeGap}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('comms.eyebrow')}</Pill>
    </Row>

    <Header
      eyebrow={t('comms.eyebrow')}
      title={t('comms.title')}
      subtitle={t('comms.subtitle')}
    />

    <Card>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{t('comms.completion.title')}</Text>
          <Body style={{ fontSize: 12 }}>{t('comms.completion.body')}</Body>
        </View>
        <Text style={{ color: colors.primary, fontSize: 26, fontWeight: '900' }}>{completion}%</Text>
      </Row>
      <Body style={{ fontSize: 11 }}>{t('comms.completion.parts')}</Body>
    </Card>

    {commsNeedsContact(communication) ? <Card style={{ backgroundColor: colors.amberBg, borderColor: colors.amberBg }}>
      <Row><Pill tone="amber">{t('comms.kitLine.tag')}</Pill></Row>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{t('comms.kitLine.title')}</Text>
      <Body style={{ fontSize: 12 }}>{t('comms.kitLine.body')}</Body>
    </Card> : null}

    <Card>
      <Row>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('comms.contacts')}</Text>
        <Action title={t('comms.add')} small kind="secondary" onPress={addContact} />
      </Row>
      <Body style={{ fontSize: 12 }}>{t('comms.contacts.body')}</Body>
      {communication.contacts.map((contact, index) => {
        const near = isContactNear(contact);
        return <View key={contact.id} style={[styles.lineRow, index > 0 && { borderTopColor: colors.outlineVariant }]}>
          <Row style={{ gap: 10 }}>
            <Text onPress={() => setEditingId(editingId === contact.id ? null : contact.id)} accessibilityRole="button" style={{ flex: 1, color: colors.ink, fontWeight: '700', fontSize: 15 }}>
              {editingId === contact.id ? '▾ ' : '▸ '}{contact.name || t('comms.unnamed')}
            </Text>
            {near ? <Pill tone="blue">{t('comms.nearTag')}</Pill> : null}
            {contact.phone ? <Pill tone="green">{t('comms.phoneOnFile')}</Pill> : null}
          </Row>
          {editingId !== contact.id ? <>
            <Body style={{ fontSize: 12 }}>
              {contact.relationship ? `${contact.relationship} · ` : ''}{contact.phone ? `${t('comms.phone')}: ${contact.phone}` : ''}{contact.distance ? ` · ${contact.distance}` : ''}
            </Body>
            {near ? <Body style={{ fontSize: 12 }}>{t('comms.near')}</Body> : null}
            {contact.phone ? <Text
              accessibilityRole="link"
              onPress={() => void Linking.openURL(telHref(contact.phone)).catch(() => {})}
              style={{ color: colors.primary, fontSize: 13, fontWeight: '700' }}
            >
              {t('comms.call', { phone: contact.phone })}
            </Text> : null}
          </> : <Disclosure>
            <ContactEditor
              contact={contact}
              onChange={next => patch({ contacts: communication.contacts.map(item => item.id === next.id ? next : item) })}
              onRemove={() => removeContact(contact)}
              onClose={() => setEditingId(null)}
            />
          </Disclosure>}
        </View>;
      })}
    </Card>

    <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('comms.meeting')}</Text>
      <Body style={{ fontSize: 12 }}>{t('comms.meeting.body')}</Body>
      <Field label={t('comms.meeting.label')} value={communication.meetingPoint.label} onChangeText={label => patchMeeting({ label: label.slice(0, 120) })} placeholder={t('comms.meeting.label.placeholder')} />
      <Field label={t('comms.meeting.address')} value={communication.meetingPoint.address} onChangeText={address => patchMeeting({ address: address.slice(0, 200) })} placeholder={t('comms.meeting.address.placeholder')} />
      <Field label={t('comms.meeting.note')} value={communication.meetingPoint.note} onChangeText={note => patchMeeting({ note: note.slice(0, 200) })} placeholder={t('comms.meeting.note.placeholder')} multiline />
    </Card>

    <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('comms.checkin')}</Text>
      <Body style={{ fontSize: 12 }}>{t('comms.checkin.body')}</Body>
      <Field label={t('comms.checkin.who')} value={communication.checkIn.who} onChangeText={who => patchCheckIn({ who: who.slice(0, 120) })} placeholder={t('comms.checkin.who.placeholder')} />
      <Row style={{ gap: 9 }}>
        {CHECK_IN_OPTIONS.map(hours => <View key={hours} style={{ flex: 1 }}>
          <Action
            title={t('comms.checkin.hours', { hours })}
            small
            kind={communication.checkIn.everyHours === hours ? 'primary' : 'quiet'}
            onPress={() => patchCheckIn({ everyHours: hours })}
          />
        </View>)}
      </Row>
      <Field label={t('comms.checkin.method')} value={communication.checkIn.method} onChangeText={method => patchCheckIn({ method: method.slice(0, 120) })} placeholder={t('comms.checkin.method.placeholder')} />
      <Field label={t('comms.checkin.fallback')} value={communication.checkIn.fallback} onChangeText={fallback => patchCheckIn({ fallback: fallback.slice(0, 200) })} multiline placeholder={t('comms.checkin.fallback.placeholder')} />
    </Card>

    <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('comms.backup')}</Text>
      <Body style={{ fontSize: 12 }}>{t('comms.backup.body')}</Body>
      <Field label={t('comms.backup.contact')} value={communication.backup.contact} onChangeText={contact => patchBackup({ contact: contact.slice(0, 120) })} placeholder={t('comms.backup.contact.placeholder')} />
      <Field label={t('comms.backup.method')} value={communication.backup.method} onChangeText={method => patchBackup({ method: method.slice(0, 120) })} placeholder={t('comms.backup.method.placeholder')} />
      <Field label={t('comms.backup.note')} value={communication.backup.note} onChangeText={note => patchBackup({ note: note.slice(0, 200) })} multiline placeholder={t('comms.backup.note.placeholder')} />
    </Card>

    <Card style={{ backgroundColor: colors.navy, borderColor: colors.navy }}>
      <Text style={{ color: '#FFFFFF', fontWeight: '800', fontSize: 17 }}>{t('comms.card.title')}</Text>
      <Body style={{ color: '#C3D7CE' }}>{t('comms.card.body')}</Body>
      <Body style={{ color: '#C3D7CE', fontSize: 12 }}>{t('comms.card.zone', { zone: zoneLine || t('comms.card.noZone') })}</Body>
      <Action title={t('comms.share.action')} onPress={() => void shareCard()} />
      <Body style={{ color: '#C3D7CE', fontSize: 11 }}>{t('comms.share.note')}</Body>
    </Card>
  </Page>;
}

/** The kit emits a "Communication card" line until an out-of-area contact exists (R-COM-6/7). */
function commsNeedsContact(communication: CommunicationPlan): boolean {
  return !communication.contacts.some(contact => contact.name.trim() || contact.phone.trim());
}

function ContactEditor({ contact, onChange, onRemove, onClose }: {
  contact: EmergencyContact;
  onChange: (value: EmergencyContact) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return <View style={{ gap: 12, marginTop: 10 }}>
    <Field label={t('comms.field.name')} value={contact.name} onChangeText={name => onChange({ ...contact, name: name.slice(0, 120) })} placeholder={t('comms.field.name.placeholder')} />
    <Field label={t('comms.field.relationship')} value={contact.relationship} onChangeText={relationship => onChange({ ...contact, relationship: relationship.slice(0, 80) })} placeholder={t('comms.field.relationship.placeholder')} />
    <Field label={t('comms.field.phone')} value={contact.phone} onChangeText={phone => onChange({ ...contact, phone: phone.slice(0, 40) })} keyboardType="phone-pad" placeholder={t('comms.field.phone.placeholder')} />
    <Field label={t('comms.field.distance')} value={contact.distance} onChangeText={distance => onChange({ ...contact, distance: distance.slice(0, 60) })} placeholder={t('comms.field.distance.placeholder')} />
    <Row style={{ gap: 9 }}>
      <View style={{ flex: 1 }}><Action title={t('comms.save')} onPress={onClose} /></View>
      <View style={{ flex: 1 }}><Action title={t('comms.remove.action')} kind="quiet" onPress={onRemove} /></View>
    </Row>
  </View>;
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
