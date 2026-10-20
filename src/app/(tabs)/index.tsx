import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Link, type Href } from 'expo-router';
import { usePlan } from '../../plan';
import { visibleTasks } from '../../plan-schema';
import { zoneSummary } from '../../zone/verification';
import { Body, Card, Header, Page, Pill, ProgressBar, Row } from '../../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../../theme';

export default function Home() {
  const plan = usePlan();
  const { dark, colors } = useAppTheme();
  const styles = dark ? darkStyles : lightStyles;
  const visible = visibleTasks(plan.tasks, plan.household);
  const completed = visible.filter(t => t.done).length;
  const next = visible.find(t => !t.done);
  const zone = zoneSummary(plan.zone);

  return <Page>
    <Row style={styles.brandRow}>
      <View style={styles.brandMark}><Text style={styles.brandMarkText}>S</Text></View>
      <Text style={styles.brand}>STORMREADY</Text>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">SAVED ON DEVICE</Pill>
    </Row>

    <Header eyebrow="A calmer way to prepare" title="Ready starts with one small step." subtitle="Make a household plan now, so you have something to lean on when the weather changes." />

    <Card style={[styles.progressCard, dark && { backgroundColor: colors.navy, borderColor: colors.navy }]}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={[styles.cardEyebrow, dark && { color: colors.lime }]}>YOUR PREPAREDNESS PLAN</Text>
          <Text style={styles.progressTitle}>{completed === visible.length ? 'You’re in good shape.' : `${visible.length - completed} steps to go`}</Text>
        </View>
        <View style={styles.counter}><Text style={styles.counterTop}>{completed}</Text><Text style={styles.counterBottom}>OF {visible.length}</Text></View>
      </Row>
      <ProgressBar value={completed} max={visible.length} label="Preparedness checklist progress" tint={colors.lime} />
      {next ? <View style={styles.nextStep}>
        <View style={styles.stepDot}><Text style={styles.stepDotText}>↗</Text></View>
        <View style={{ flex: 1, gap: 4 }}><Text style={styles.nextLabel}>UP NEXT</Text><Text style={styles.nextTitle}>{next.title}</Text><Text style={styles.nextDetail}>{next.detail}</Text></View>
      </View> : <Body style={{ color: colors.forestMuted }}>Your checklist is complete. Keep your plan handy and check local guidance when conditions change.</Body>}
      <Body style={{ color: colors.forestMuted }}>Open Prepare in the bottom toolbar to update your checklist.</Body>
    </Card>

    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>Your essentials</Text><Text style={styles.sectionNote}>Available whenever you need them</Text></View>
    <View style={styles.shortcuts}>
      <Shortcut href="/(tabs)/plan" title="Household plan" subtitle="Supplies, people & next steps" symbol="✓" tint={colors.mint} />
      <Shortcut href="/kit" title="Emergency kit" subtitle={`${plan.household.people} people · ${plan.household.days} days · shareable`} symbol="▤" tint={dark ? colors.mint : '#E9F0ED'} />
      <Shortcut href="/(tabs)/map" title="Map & shelters" subtitle={zone.ageDays !== null || plan.zone.value ? `${zone.label} · ${zone.provenance}` : 'Save an area for offline use'} symbol="⌖" tint={dark ? colors.mint : '#E9F0ED'} />
    </View>

    <Card style={styles.alertCard}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={styles.alertIcon}><Text style={styles.alertIconText}>!</Text></View>
        <View style={{ flex: 1, gap: 5 }}><Text style={styles.alertTitle}>For current alerts, check official sources</Text><Body>Conditions and evacuation orders can change. StormReady is a planning tool, not an emergency alert authority.</Body></View>
      </Row>
      <Body>Open Updates in the bottom toolbar for current alerts and local guidance.</Body>
    </Card>

    <Text style={styles.footer}>Check local emergency-management guidance for your area.</Text>
  </Page>;
}

function Shortcut({ href, title, subtitle, symbol, tint }: { href: Href; title: string; subtitle: string; symbol: string; tint: string }) {
  const { dark } = useAppTheme();
  const styles = dark ? darkStyles : lightStyles;
  return <Link href={href} asChild>
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}. ${subtitle}`} style={({ pressed }) => [styles.shortcut, pressed && { opacity: 0.78 }]}>
      <View style={[styles.shortcutIcon, { backgroundColor: tint }]}><Text style={styles.shortcutSymbol}>{symbol}</Text></View>
      <View style={{ flex: 1, gap: 4 }}><Text style={styles.shortcutTitle}>{title}</Text><Text style={styles.shortcutSubtitle}>{subtitle}</Text></View>
    </Pressable>
  </Link>;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  brandRow: { minHeight: 40, marginBottom: 1, gap: 9 },
  brandMark: { width: 32, height: 32, borderRadius: 10, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  brandMarkText: { color: '#FFFFFF', fontSize: 17, fontWeight: '900' },
  brand: { color: colors.tealDark, fontSize: 11, fontWeight: '900', letterSpacing: 1.35 },
  progressCard: { backgroundColor: colors.primary, borderColor: colors.primary, padding: 20, gap: 17 },
  cardEyebrow: { color: colors.primaryContainer, fontSize: 11, fontWeight: '700', letterSpacing: 0.7 },
  progressTitle: { color: '#FFFFFF', fontSize: 22, lineHeight: 27, letterSpacing: -0.45, fontWeight: '800' },
  counter: { width: 54, height: 54, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.10)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  counterTop: { color: '#FFFFFF', fontSize: 19, lineHeight: 21, fontWeight: '800' },
  counterBottom: { color: colors.forestMuted, fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  nextStep: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 2 },
  stepDot: { width: 30, height: 30, borderRadius: 11, backgroundColor: 'rgba(189,228,199,0.14)', alignItems: 'center', justifyContent: 'center' },
  stepDotText: { color: colors.lime, fontSize: 17, fontWeight: '700' },
  nextLabel: { color: colors.forestMuted, fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  nextTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  nextDetail: { color: '#C3D7CE', fontSize: 12, lineHeight: 17 },
  sectionHeading: { gap: 4, marginTop: 2 },
  sectionTitle: { color: colors.ink, fontSize: 19, fontWeight: '800', letterSpacing: -0.35 },
  sectionNote: { color: colors.muted, fontSize: 12 },
  shortcuts: { gap: 10 },
  shortcut: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 13, padding: 13, borderRadius: 19, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line },
  shortcutIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  shortcutSymbol: { color: colors.tealDark, fontSize: 21, fontWeight: '700' },
  shortcutTitle: { color: colors.ink, fontSize: 14, fontWeight: '800' },
  shortcutSubtitle: { color: colors.muted, fontSize: 12, lineHeight: 17 },
  alertCard: { backgroundColor: colors.surfaceContainerLow, borderColor: colors.outlineVariant },
  alertIcon: { width: 29, height: 29, borderRadius: 10, backgroundColor: colors.amberBg, alignItems: 'center', justifyContent: 'center' },
  alertIconText: { color: colors.amber, fontWeight: '900' },
  alertTitle: { color: colors.ink, fontSize: 15, lineHeight: 20, fontWeight: '800' },
  footer: { color: colors.muted, fontSize: 11, lineHeight: 16, textAlign: 'center', paddingHorizontal: 12 },
});
const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);
