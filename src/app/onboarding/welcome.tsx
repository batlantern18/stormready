import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingPage } from '../../onboarding/ui';
import { Action, Body, Card, Pill, Row } from '../../ui';
import { useAppTheme } from '../../theme';

const STEPS = [
  { symbol: '1', title: 'Household details', detail: 'People, pets, and any access or medical needs.' },
  { symbol: '2', title: 'A kit sized for you', detail: 'Quantities with the basis and official source for every line.' },
  { symbol: '3', title: 'Your evacuation zone', detail: 'Automatic in Florida; entered and verified by you elsewhere.' },
  { symbol: '4', title: 'Everything stays here', detail: 'No account. No analytics. No location permission during setup.' },
];

export default function Welcome() {
  const { colors } = useAppTheme();
  const router = useRouter();
  return <OnboardingPage
    step={1}
    eyebrow="Welcome to StormReady"
    title="Ready starts with a few quiet minutes."
    subtitle="Build a household plan you can use offline, then keep it close when the weather changes."
    footer={<Action title="Start my plan" onPress={() => router.push('/onboarding/household')} />}
  >
    <Card style={{ backgroundColor: colors.navy, borderColor: colors.navy }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.cardEyebrow}>READY KIT · V1.1</Text>
          <Text style={styles.cardTitle}>A plan, a kit, and a zone — all on this device.</Text>
        </View>
        <Pill tone="green">LOCAL ONLY</Pill>
      </Row>
      <Body style={{ color: colors.forestMuted }}>StormReady is a preparedness organizer. It does not replace official alerts or instructions from local authorities.</Body>
    </Card>

    <View style={{ gap: 10 }}>
      {STEPS.map(step => <View key={step.symbol} style={[styles.step, { borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLowest }]}>
        <View style={[styles.badge, { backgroundColor: colors.primaryContainer }]}><Text style={[styles.badgeText, { color: colors.primary }]}>{step.symbol}</Text></View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={[styles.stepTitle, { color: colors.onSurface }]}>{step.title}</Text>
          <Text style={[styles.stepDetail, { color: colors.onSurfaceVariant }]}>{step.detail}</Text>
        </View>
      </View>)}
    </View>

    <Body>You can skip setup at any time. Every choice can be changed later in Prepare, Map, or Settings.</Body>
  </OnboardingPage>;
}

const styles = StyleSheet.create({
  cardEyebrow: { color: '#B5F1E4', fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  cardTitle: { color: '#FFFFFF', fontSize: 21, lineHeight: 26, fontWeight: '800', letterSpacing: -0.4 },
  step: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 16, borderWidth: 1 },
  badge: { width: 34, height: 34, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 15, fontWeight: '900' },
  stepTitle: { fontSize: 14, fontWeight: '800' },
  stepDetail: { fontSize: 12, lineHeight: 17 },
});
