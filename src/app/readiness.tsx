import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { calculateKit } from '../kit/calculator';
import { usePlan } from '../plan';
import { readinessScore, type ReadinessFactor } from '../readiness/score';
import { seasonCheck } from '../readiness/season';
import { BAND_COPY_KEYS, BAND_LABEL_KEYS, BAND_TONES, FACTOR_LABEL_KEYS, SEASON_LABEL } from '../readiness/labels';
import { Action, Body, Card, Header, MotionPressable, Page, Pill, ProgressBar, Row } from '../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../theme';
import { useT, type TranslationKey } from '../i18n';
import { formatDate } from '../i18n/format';

export default function Readiness() {
  const plan = usePlan();
  const router = useRouter();
  const { colors, dark } = useAppTheme();
  const { t, locale } = useT();
  const styles = dark ? darkStyles : lightStyles;

  const kitLines = calculateKit(plan.household, plan.medical, plan.communication);
  const score = readinessScore({
    household: plan.household,
    tasks: plan.tasks,
    kitLines,
    inventory: plan.inventory,
    zone: plan.zone,
    goBags: plan.goBags,
    medical: plan.medical,
    communication: plan.communication,
    drills: plan.drills.results,
  });
  const season = seasonCheck(plan.household.country, plan.household.state, new Date(), plan.inventory.lastRotationAt);

  const openRoute = (route: string) => router.push(route as Href);
  const reason = (factor: ReadinessFactor) =>
    factor.reasonKey ? t(factor.reasonKey as TranslationKey, factor.reasonParams) : factor.reason;

  return <Page>
    <Row style={{ gap: 10 }}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('readiness.eyebrow')}</Pill>
    </Row>

    <Header
      eyebrow={t('readiness.eyebrow')}
      title={t('readiness.title')}
      subtitle={t('readiness.subtitle')}
    />

    <Card>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text style={[styles.bigScore, dark && { color: colors.ink }]}>
            {score.total}
            <Text style={[styles.bigScoreSuffix, { color: colors.muted }]}> {t('readiness.scoreOf100')}</Text>
          </Text>
          <Pill tone={BAND_TONES[score.band]}>{t(BAND_LABEL_KEYS[score.band])}</Pill>
        </View>
        <View style={{ width: 132, gap: 6 }}>
          <ProgressBar value={score.total} max={100} label={t('readiness.progressBar')} tint={colors.primary} track={colors.surfaceContainerHigh} />
          <Text style={{ color: colors.muted, fontSize: 11 }}>{score.total} / 100</Text>
        </View>
      </Row>
      <Body>{t(BAND_COPY_KEYS[score.band])}</Body>
      <Body style={{ fontSize: 11 }}>{t('readiness.anHonestEstimate')}</Body>
    </Card>

    {/* F09 — the top three gaps first; every one names where it is fixed. */}
    {score.topGaps.length ? <Card>
      <Text style={[styles.sectionHeading, dark && { color: colors.ink }]}>{t('readiness.topGaps')}</Text>
      {score.topGaps.map((factor, index) => <View key={factor.id} style={[styles.gapRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant }]}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.ink, fontWeight: '700' }}>{factorLabel(t, factor)}</Text>
          <Body>{reason(factor)}</Body>
        </View>
        {factor.action ? <Action title={t('readiness.fix')} small kind="secondary" onPress={() => openRoute(factor.action!.route)} /> : null}
      </View>)}
    </Card> : <Card style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
      <Text style={{ color: colors.tealDark, fontWeight: '800', fontSize: 16 }}>{t('readiness.noGaps')}</Text>
      <Body style={{ color: colors.tealDark }}>{t('readiness.noGaps.body')}</Body>
    </Card>}

    {season ? <Card style={{ backgroundColor: colors.sand, borderColor: colors.sand }}>
      <Row><Pill tone="amber">{t('readiness.season.tag')}</Pill></Row>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{t(SEASON_LABEL[season.season.id])}</Text>
      <Body>{t('readiness.season.body', { from: formatDate(new Date(new Date().getFullYear(), season.season.startDay.month, season.season.startDay.day), locale) })}</Body>
      <Body>{t('readiness.season.rotateHint')}</Body>
      <Row style={{ gap: 9 }}>
        <View style={{ flex: 1 }}><Action title={t('readiness.season.reviewKit')} kind="secondary" small onPress={() => openRoute('/inventory')} /></View>
        <View style={{ flex: 1 }}><Action title={`↗ ${season.season.authority.label}`} kind="secondary" small onPress={() => openRoute('/(tabs)/updates')} /></View>
      </Row>
    </Card> : null}

    <Card>
      <Text style={[styles.sectionHeading, dark && { color: colors.ink }]}>{t('readiness.breakdown')}</Text>
      {score.factors.map(factor => <View key={factor.id} style={{ gap: 6, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant }}>
        <Row style={{ gap: 10 }}>
          <Text style={{ flex: 1, color: colors.ink, fontWeight: '700', fontSize: 14 }}>{factorLabel(t, factor)}</Text>
          <Text style={{ color: colors.muted, fontSize: 12, fontWeight: '600' }}>{Math.round(factor.earned * factor.weight)} / {factor.weight}</Text>
        </Row>
        <ProgressBar
          value={Math.round(factor.earned * factor.weight)}
          max={factor.weight}
          label={`${factorLabel(t, factor)}: ${reason(factor)}`}
          tint={factor.earned >= 1 ? colors.success : colors.primary}
          track={colors.surfaceContainerHigh}
        />
        <Text style={{ color: colors.onSurfaceVariant, fontSize: 12, lineHeight: 17 }}>{reason(factor)}</Text>
        {factor.action ? <Text onPress={() => openRoute(factor.action!.route)} accessibilityRole="button" style={{ color: colors.primary, fontSize: 13, fontWeight: '700' }}>{factor.action.label} →</Text> : null}
      </View>)}
      <Body style={{ fontSize: 11 }}>{t('readiness.breakdown.note')}</Body>
    </Card>
  </Page>;
}

function factorLabel(t: (key: TranslationKey, params?: Record<string, string | number>) => string, factor: ReadinessFactor): string {
  const key = FACTOR_LABEL_KEYS[factor.id];
  return key ? t(key) : factor.label;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { fontSize: 15, fontWeight: '700' },
  bigScore: { fontSize: 42, lineHeight: 46, fontWeight: '800', color: colors.primary, letterSpacing: -1 },
  bigScoreSuffix: { fontSize: 15, fontWeight: '600' },
  sectionHeading: { color: colors.ink, fontWeight: '800', fontSize: 17 },
  gapRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
});
const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);
