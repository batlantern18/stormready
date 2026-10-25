import React, { useMemo } from 'react';
import { Linking, Share, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { calculateKit } from '../kit/calculator';
import { CATEGORY_LABELS, CATEGORY_ORDER } from '../kit/catalog';
import { formatQuantity, householdSummary, kitToText } from '../kit/format';
import { coverageFor } from '../inventory/model';
import { usePlan } from '../plan';
import { Action, Body, Card, Header, MotionPressable as Pressable, Page, Pill, Row } from '../ui';
import { useAppTheme } from '../theme';
import { useT } from '../i18n';

export default function KitScreen() {
  const plan = usePlan();
  const router = useRouter();
  const { colors } = useAppTheme();
  const { t } = useT();
  const lines = calculateKit(plan.household, plan.medical, plan.communication);
  const coverage = useMemo(() => coverageFor(lines, plan.inventory), [lines, plan.inventory]);

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

    {/* F01 — kit coverage against what the household actually owns. */}
    <Card>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.summaryLabel, { color: colors.tealDark }]}>{t('kit.coverage.tag')}</Text>
          <Text style={[styles.category, { color: colors.onSurface }]}>{t('kit.coverage.title')}</Text>
        </View>
        <Pill tone="blue">{t('kit.coverage.tracked', { count: Object.keys(plan.inventory.entries).length })}</Pill>
      </Row>
      {coverage.map(line => <View key={line.itemId} style={{ gap: 3, paddingVertical: 6 }}>
        <Row style={{ gap: 10 }}>
          <Text style={{ flex: 1, color: colors.ink, fontWeight: '700', fontSize: 14 }}>
            {line.itemId === 'water' ? t('inventory.coverage.water') : t('inventory.coverage.food')}
          </Text>
          <Text style={{ color: line.covered ? colors.success : colors.amber, fontWeight: '800', fontSize: 12 }}>
            {line.covered ? t('inventory.coverage.covered') : t('inventory.coverage.missing', { owned: line.owned, required: line.required })}
          </Text>
        </Row>
        <View style={{ height: 7, borderRadius: 8, backgroundColor: colors.surfaceContainerHigh, overflow: 'hidden' }}>
          <View style={{ width: `${Math.min(100, line.percent ?? 0)}%`, height: 7, borderRadius: 8, backgroundColor: line.covered ? colors.success : colors.primary }} />
        </View>
      </View>)}
      <Body style={{ fontSize: 12 }}>{t('kit.coverage.body')}</Body>
      <Row style={{ gap: 9 }}>
        <View style={{ flex: 1 }}><Action title={t('kit.coverage.open')} kind="secondary" onPress={() => router.push('/inventory')} /></View>
      </Row>
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
