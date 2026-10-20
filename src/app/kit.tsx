import React from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { calculateKit } from '../kit/calculator';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../kit/catalog';
import { formatQuantity, householdSummary, kitToText } from '../kit/format';
import { usePlan } from '../plan';
import { Action, Body, Card, Header, MotionPressable as Pressable, Page, Pill, Row } from '../ui';
import { useAppTheme } from '../theme';

export default function KitScreen() {
  const plan = usePlan();
  const router = useRouter();
  const { colors } = useAppTheme();
  const lines = calculateKit(plan.household);

  const share = async () => {
    await Share.share({
      title: 'My StormReady emergency kit',
      message: kitToText(lines, plan.household),
    }).catch(() => {});
  };

  return <Page>
    <Row style={{ gap: 10 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← Back</Text>
      </Pressable>
      <View style={{ flex: 1 }} />
      <Pill>WORKS OFFLINE</Pill>
    </Row>

    <Header
      eyebrow="Emergency kit"
      title="Sized for your household."
      subtitle="Every quantity shows its basis and source. This is a planning baseline, not an official requirement."
    />

    <Card style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
      <Text style={[styles.summaryLabel, { color: colors.tealDark }]}>YOUR HOUSEHOLD</Text>
      <Text style={[styles.summary, { color: colors.ink }]}>{householdSummary(plan.household)}</Text>
      <Body>Change these details in Prepare. Your kit updates automatically and stays on this device.</Body>
      <View style={{ flexDirection: 'row', gap: 9 }}>
        <View style={{ flex: 1 }}><Action title="Share kit list" onPress={() => void share()} /></View>
        <View style={{ flex: 1 }}><Action title="Edit household" kind="secondary" onPress={() => router.dismissTo('/(tabs)/plan')} /></View>
      </View>
    </Card>

    {CATEGORY_ORDER.map(category => {
      const group = lines.filter(line => line.category === category);
      if (!group.length) return null;
      return <Card key={category}>
        <Text style={[styles.category, { color: colors.onSurface }]}>{CATEGORY_LABELS[category]}</Text>
        {group.map((line, index) => <View key={line.id} style={[styles.line, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant }]}>
          <Row style={{ alignItems: 'flex-start', gap: 12 }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={[styles.lineLabel, { color: colors.onSurface }]}>{line.label}</Text>
              <Text style={[styles.basis, { color: colors.onSurfaceVariant }]}>Basis: {line.basis}</Text>
            </View>
            <Text accessibilityLabel={formatQuantity(line)} style={[styles.quantity, { color: colors.primary }]}>{formatQuantity(line)}</Text>
          </Row>
          {line.note ? <Text style={[styles.note, { color: colors.onSurfaceVariant }]}>{line.note}</Text> : null}
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={`Open source: ${line.source.label}`}
            onPress={() => void Linking.openURL(line.source.url).catch(() => {})}
            style={styles.source}
          >
            <Text style={[styles.sourceText, { color: colors.primary }]}>{line.source.label} ↗</Text>
          </Pressable>
        </View>)}
      </Card>;
    })}

    <Card style={{ backgroundColor: colors.surfaceContainerLow }}>
      <Text style={[styles.category, { color: colors.onSurface }]}>How to use this list</Text>
      <Body>Review quantities for your own circumstances. Heat, pregnancy, illness, medical equipment, and pets can change what you need. Replace expired supplies at the start of each season.</Body>
      <Body style={{ fontSize: 11 }}>Sources are official U.S. preparedness guidance. Local authorities may recommend different amounts for your area.</Body>
    </Card>
  </Page>;
}

const styles = StyleSheet.create({
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 2 },
  backText: { fontSize: 14, fontWeight: '700' },
  summaryLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 1 },
  summary: { fontSize: 22, lineHeight: 28, fontWeight: '800', letterSpacing: -0.3 },
  category: { fontSize: 18, fontWeight: '800', letterSpacing: -0.2 },
  line: { paddingVertical: 12, gap: 5 },
  lineLabel: { fontSize: 14, lineHeight: 19, fontWeight: '700' },
  basis: { fontSize: 11, lineHeight: 16 },
  quantity: { fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'right', maxWidth: 100 },
  note: { fontSize: 11, lineHeight: 16 },
  source: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' },
  sourceText: { fontSize: 12, fontWeight: '700' },
});
