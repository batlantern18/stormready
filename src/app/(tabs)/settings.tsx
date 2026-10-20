import React, { useEffect, useState } from 'react';
import { Alert, Linking, Platform, Share, Switch, Text, View } from 'react-native';
import { usePlan } from '../../plan';
import { disableReminders, enableReminders, loadReminderState } from '../../notifications/scheduler';
import type { ReminderState } from '../../notifications/types';
import { Action, Body, Card, Header, Page, Pill, Row } from '../../ui';
import { useAppTheme } from '../../theme';

export default function Settings() {
  const plan = usePlan();
  const { dark, colors, setDark } = useAppTheme();
  const [reminders, setReminders] = useState<ReminderState | null>(null);
  const [reminderBusy, setReminderBusy] = useState(false);
  const [reminderMessage, setReminderMessage] = useState('');

  useEffect(() => {
    let active = true;
    loadReminderState().then(state => { if (active) setReminders(state); }).catch(() => {});
    return () => { active = false; };
  }, []);

  const exportPlan = async () => {
    const text = JSON.stringify({
      exportedAt: new Date().toISOString(),
      household: plan.household,
      zone: plan.zone,
      tasks: plan.tasks,
      destination: plan.destination,
    }, null, 2);
    await Share.share({ title: 'My StormReady plan', message: text }).catch(() => {});
  };

  const erase = () => Alert.alert('Clear saved plan?', 'This removes your household details, checklist progress, zone, and destination from this device.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Clear plan', style: 'destructive', onPress: () => { void plan.reset(); } },
  ]);

  const toggleReminders = async (next: boolean) => {
    if (reminderBusy) return;
    setReminderBusy(true);
    setReminderMessage('');
    try {
      if (next) {
        const result = await enableReminders();
        setReminders(result.state);
        if (!result.enabled) {
          setReminderMessage(result.reason === 'denied'
            ? 'Notifications are blocked. Allow them in system settings, then try again.'
            : result.reason === 'unsupported'
              ? 'Local reminders are available in the installed Android app.'
              : 'Reminders could not be scheduled. Try again.');
        } else {
          setReminderMessage('Reminders are on: a weekly checklist nudge and a monthly zone recheck.');
        }
      } else {
        setReminders(await disableReminders());
        setReminderMessage('Reminders are off. No notifications will be scheduled.');
      }
    } finally {
      setReminderBusy(false);
    }
  };

  return <Page>
    <Header eyebrow="Settings & privacy" title="Your plan stays in your hands." subtitle="StormReady stores your household details on this device. There are no accounts or StormReady servers." />
    <Card><Row><View style={{ flex: 1, gap: 4 }}><Text style={{ color: colors.ink, fontWeight: '800', fontSize: 18 }}>Appearance</Text><Body>Use a darker color theme throughout the app.</Body></View><Switch accessibilityLabel="Dark mode" value={dark} onValueChange={setDark} trackColor={{ false: colors.outlineVariant, true: colors.primary }} thumbColor={dark ? colors.onPrimary : colors.surfaceContainerLowest} /></Row></Card>

    <Card>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 3 }}><Text style={{ color: colors.ink, fontWeight: '800', fontSize: 18 }}>Optional reminders</Text><Body>Off by default. A weekly checklist nudge and a monthly prompt to recheck your zone.</Body></View>
        <Pill tone="blue">LOCAL</Pill>
      </Row>
      <Row style={{ minHeight: 48 }}>
        <View style={{ flex: 1, gap: 2 }}><Text style={{ color: colors.ink, fontWeight: '600', fontSize: 14 }}>Schedule plan reminders</Text><Text style={{ color: colors.muted, fontSize: 12 }}>Uses the Android reminders channel at a best-effort time.</Text></View>
        <Switch
          accessibilityLabel="Schedule plan reminders"
          accessibilityState={{ checked: reminders?.enabled ?? false, disabled: reminderBusy || Platform.OS === 'web' }}
          disabled={reminderBusy || Platform.OS === 'web'}
          value={reminders?.enabled ?? false}
          onValueChange={value => void toggleReminders(value)}
          trackColor={{ false: colors.outlineVariant, true: colors.primary }}
          thumbColor={reminders?.enabled ? colors.onPrimary : colors.surfaceContainerLowest}
        />
      </Row>
      {reminderMessage ? <Text accessibilityRole="alert" style={{ color: reminderMessage.startsWith('Reminders are on') ? colors.success : colors.warning, fontSize: 12, lineHeight: 17 }}>{reminderMessage}</Text> : null}
      <Body style={{ fontSize: 11 }}>These are planning nudges scheduled by this device. They are not weather alerts, and StormReady does not run a background alert server. You can turn them off at any time.</Body>
      {reminderMessage.includes('blocked') ? <Action title="Open notification settings" kind="secondary" small onPress={() => void Linking.openSettings().catch(() => {})} /> : null}
    </Card>

    <Card><Row><View style={{ flex: 1, gap: 4 }}><Text style={{ color: colors.ink, fontWeight: '800', fontSize: 18 }}>Your saved plan</Text><Body>Local to this device</Body></View><Pill>PRIVATE</Pill></Row>
      <Body>Your household profile, task progress, verified zone, destination, and downloaded area pack stay in app storage on this device. Saved data is versioned and recovered safely if it is ever damaged. Uninstalling the app may remove it.</Body>
      <Action title="Export a copy of my plan" kind="secondary" onPress={() => void exportPlan()} />
      <Action title="Erase saved plan from this device" kind="quiet" onPress={erase} />
    </Card>

    <Card><Text style={{ color: colors.ink, fontWeight: '800', fontSize: 18 }}>Trusted guidance</Text>
      <Body>Official guidance changes. Check the source directly before making decisions during an emergency.</Body>
      <Body>Official websites require a connection. Offline, use Prepare for the built-in field guide and Map for your saved zone, shelter directory, and any downloaded county evacuation PDF.</Body>
      <Action title="U.S. FEMA emergency resources ↗" kind="secondary" onPress={() => Linking.openURL('https://www.fema.gov/emergency-managers').catch(() => {})} />
      <Action title="National Weather Service ↗" kind="secondary" onPress={() => Linking.openURL('https://www.weather.gov/').catch(() => {})} />
      <Action title="Mexico Protección Civil ↗" kind="secondary" onPress={() => Linking.openURL('https://www.gob.mx/proteccioncivil').catch(() => {})} />
      <Action title="Mexico weather service (SMN) ↗" kind="secondary" onPress={() => Linking.openURL('https://smn.conagua.gob.mx/es/').catch(() => {})} />
      <Action title="Mexico risk atlas (CENAPRED) ↗" kind="secondary" onPress={() => Linking.openURL('https://www.atlasnacionalderiesgos.gob.mx/').catch(() => {})} />
    </Card>
    <Card style={{ backgroundColor: colors.soft }}>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 17 }}>About StormReady</Text>
      <Body>StormReady is a preparedness organizer, not an emergency alert authority or replacement for 911. Call 911 for immediate danger. Follow instructions from local emergency management and first responders.</Body>
      <Text style={{ color: colors.muted, fontSize: 11 }}>Version 1.1 · Ready Kit · Preparedness information can change</Text>
    </Card>
  </Page>;
}
