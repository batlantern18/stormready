import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { OnboardingPage, useOnboardingFinish } from '../../onboarding/ui';
import { usePlan } from '../../plan';
import { calculateKit } from '../../kit/calculator';
import { formatGallons, householdSummary } from '../../kit/format';
import { visibleTasks } from '../../plan-schema';
import { zoneSummary } from '../../zone/verification';
import { Action, Body, Card, Pill, Row } from '../../ui';
import { useAppTheme } from '../../theme';

export default function ReadyStep() {
  const plan = usePlan();
  const { colors } = useAppTheme();
  const finish = useOnboardingFinish();
  const lines = calculateKit(plan.household);
  const water = lines.find(line => line.id === 'water')?.quantity ?? 0;
  const zone = zoneSummary(plan.zone);
  const tasks = visibleTasks(plan.tasks, plan.household);
  const done = tasks.filter(task => task.done).length;

  return <OnboardingPage
    step={4}
    eyebrow="Your starting point"
    title="Your plan is ready to keep."
    subtitle="Nothing here is final. Update the household, kit, and zone whenever your situation changes."
    footer={<>
      <Action title="Open my plan" onPress={() => finish('/(tabs)/plan')} />
      <Action title="Go to Home" kind="quiet" onPress={() => finish('/(tabs)')} />
    </>}
  >
    <Card style={{ backgroundColor: colors.navy, borderColor: colors.navy }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={styles.eyebrow}>HOUSEHOLD</Text>
          <Text style={styles.title}>{householdSummary(plan.household)}</Text>
        </View>
        <Pill tone="green">SAVED LOCALLY</Pill>
      </Row>
      <Body style={{ color: colors.forestMuted }}>Your details are stored on this device. There is no account, cloud sync, or analytics.</Body>
    </Card>

    <Card>
      <View style={styles.summaryRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.label, { color: colors.onSurface }]}>Emergency kit</Text>
          <Text style={[styles.detail, { color: colors.onSurfaceVariant }]}>{lines.length} lines sized for your household</Text>
        </View>
        <Text style={[styles.value, { color: colors.primary }]}>{formatGallons(water)}</Text>
      </View>
      <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
      <View style={styles.summaryRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.label, { color: colors.onSurface }]}>Evacuation zone</Text>
          <Text style={[styles.detail, { color: colors.onSurfaceVariant }]}>{zone.provenance}</Text>
        </View>
        <Text style={[styles.zoneValue, { color: colors.onSurface }]}>{zone.label}</Text>
      </View>
      {zone.warning ? <Text accessibilityRole="alert" style={[styles.warning, { color: colors.warning }]}>{zone.warning}</Text> : null}
      <View style={[styles.divider, { backgroundColor: colors.outlineVariant }]} />
      <View style={styles.summaryRow}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.label, { color: colors.onSurface }]}>Preparedness checklist</Text>
          <Text style={[styles.detail, { color: colors.onSurfaceVariant }]}>Small steps, saved automatically</Text>
        </View>
        <Text style={[styles.zoneValue, { color: colors.onSurface }]}>{done} / {tasks.length}</Text>
      </View>
    </Card>

    <Card style={{ backgroundColor: colors.surfaceContainerLow }}>
      <Text style={[styles.label, { color: colors.onSurface }]}>What happens next</Text>
      <Body>Open Prepare to review your kit and checklist. Use Map to save an offline area, check nearby shelters, and guard your zone. Settings has optional, off-by-default reminders.</Body>
      <Body style={{ fontSize: 11 }}>StormReady is a planning tool, not an official alert authority. Follow instructions from local emergency management and call 911 for immediate danger.</Body>
    </Card>
  </OnboardingPage>;
}

const styles = StyleSheet.create({
  eyebrow: { color: '#B5F1E4', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  title: { color: '#FFFFFF', fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.4 },
  summaryRow: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4 },
  label: { fontSize: 14, fontWeight: '800' },
  detail: { fontSize: 12, lineHeight: 17 },
  value: { fontSize: 22, fontWeight: '900' },
  zoneValue: { fontSize: 13, fontWeight: '800', textAlign: 'right' },
  divider: { height: StyleSheet.hairlineWidth },
  warning: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
});
