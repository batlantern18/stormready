import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { DRILLS } from '../scenarios/drills';
import { daysSinceDrill, lastDrill } from '../scenarios/model';
import { usePlan } from '../plan';
import { Action, Body, Card, Header, MotionPressable, Page, Pill, Row } from '../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../theme';
import { useT, type TranslationKey } from '../i18n';
import { formatDateShort } from '../i18n/format';

/** Localized names for the five shipped scenarios (data ids never shown raw). */
const DRILL_NAME_KEYS: Record<string, TranslationKey> = {
  'power-outage': 'drills.name.power_outage',
  evacuation: 'drills.name.evacuation',
  'shelter-night': 'drills.name.shelter_night',
  'home-medical': 'drills.name.home_medical',
  'communication-failure': 'drills.name.communication_failure',
};

/**
 * F08 — the drill launcher: the five scenarios, their length, and the drill
 * history. Drills are practice, never a test (R-DRL-3), so the copy is
 * deliberately gentle and the 60-day prompt is a nudge, not a nag.
 */
export default function DrillList() {
  const plan = usePlan();
  const router = useRouter();
  const { colors, dark } = useAppTheme();
  const { t, locale } = useT();
  const styles = dark ? darkStyles : lightStyles;

  const results = plan.drills.results;
  const previous = lastDrill(results);
  const since = daysSinceDrill(results, new Date());
  const due = since !== null && since >= 60;

  return <Page>
    <Row style={styles.chromeGap}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('drills.eyebrow')}</Pill>
    </Row>

    <Header
      eyebrow={t('drills.eyebrow')}
      title={t('drills.title')}
      subtitle={t('drills.subtitle')}
    />

    <Card style={{ backgroundColor: colors.navy, borderColor: colors.navy }}>
      <Text style={{ color: '#B5F1E4', fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>{t('drills.rotation.tag')}</Text>
      <Text style={{ color: '#FFFFFF', fontSize: 20, fontWeight: '800' }}>
        {previous
          ? t('drills.rotation.last', { days: since ?? 0 })
          : t('drills.rotation.never')}
      </Text>
      <Body style={{ color: '#C3D7CE' }}>{t('drills.rotation.body')}</Body>
    </Card>

    {due ? <Card style={{ backgroundColor: colors.sand, borderColor: colors.sand }}>
      <Row><Pill tone="amber">{t('drills.due.tag')}</Pill></Row>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{t('drills.due.title')}</Text>
      <Body>{t('drills.due.body')}</Body>
    </Card> : null}

    <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('drills.scenarios')}</Text>
      <Body style={{ fontSize: 12 }}>{t('drills.scenarios.body')}</Body>
      {DRILLS.map(drill => <View key={drill.id} style={[styles.row, { borderTopColor: colors.outlineVariant }]}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 15 }}>
            {DRILL_NAME_KEYS[drill.id] ? t(DRILL_NAME_KEYS[drill.id]) : drill.title}
          </Text>
          <Body style={{ fontSize: 12 }}>{t(`drills.scenarios.${drill.id.replace(/-/g, '_')}` as TranslationKey)}</Body>
          <Body style={{ fontSize: 11 }}>{t('drills.length', { minutes: drill.minutes, steps: drill.steps.length })}</Body>
        </View>
        <Action title={t('drills.start')} small onPress={() => router.push(`/drill/${drill.id}`)} />
      </View>)}
      <Body style={{ fontSize: 11 }}>{t('drills.disclaimer')}</Body>
    </Card>

    {results.length ? <Card>
      <Row>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('drills.history')}</Text>
        <Pill>{results.length}</Pill>
      </Row>
      {[...results]
        .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
        .slice(0, 8)
        .map((result, index) => <View key={result.id} style={[styles.row, index > 0 && { borderTopColor: colors.outlineVariant }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>
              {t('drills.record.title', {
                name: DRILL_NAME_KEYS[result.drillId]
                  ? t(DRILL_NAME_KEYS[result.drillId])
                  : result.drillId,
                date: formatDateShort(result.completedAt, locale),
              })}
            </Text>
            <Body style={{ fontSize: 12 }}>
              {t('drills.record.summary', {
                ready: Object.values(result.answers).filter(answer => answer === 'ready').length,
                total: drillStepCount(result.drillId),
                notYet: Object.values(result.answers).filter(answer => answer === 'not-yet').length,
              })}
            </Body>
          </View>
        </View>)}
    </Card> : null}
  </Page>;
}

/** The step total of a stored drill (0 when the id is unknown). */
function drillStepCount(drillId: string): number {
  return DRILLS.find(drill => drill.id === drillId)?.steps.length ?? 0;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  chromeGap: { gap: 10 },
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { fontSize: 15, fontWeight: '700' },
  heading: { color: colors.onSurface, fontWeight: '800', fontSize: 17 },
  row: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 12, flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
});

const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);
