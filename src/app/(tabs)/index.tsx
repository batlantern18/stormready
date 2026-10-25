import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Link } from 'expo-router';
import { usePlan } from '../../plan';
import { visibleTasks } from '../../plan-schema';
import { zoneSummary } from '../../zone/verification';
import { calculateKit } from '../../kit/calculator';
import { coverageFor } from '../../inventory/model';
import { seasonCheck } from '../../readiness/season';
import { BAND_LABEL_KEYS, FACTOR_LABEL_KEYS, SEASON_LABEL } from '../../readiness/labels';
import { readinessScore } from '../../readiness/score';
import { daysSinceDrill, isDrillDue } from '../../scenarios/model';
import { bagProgress } from '../../gobag/model';
import { Action, Body, Card, Header, Page, Pill, ProgressBar, Row } from '../../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../../theme';
import { useT, type TranslationKey } from '../../i18n';

export default function Home() {
  const plan = usePlan();
  const { dark, colors } = useAppTheme();
  const { t } = useT();
  const styles = dark ? darkStyles : lightStyles;
  const visible = visibleTasks(plan.tasks, plan.household);
  const completed = visible.filter(task => task.done).length;
  const next = visible.find(task => !task.done);
  const zone = zoneSummary(plan.zone);
  const now = useMemo(() => new Date(), []);
  const kitLines = useMemo(
    () => calculateKit(plan.household, plan.medical, plan.communication),
    [plan.household, plan.medical, plan.communication],
  );
  const coverage = coverageFor(kitLines, plan.inventory).filter(line => line.itemId === 'water' || line.itemId === 'food');
  const score = useMemo(() => readinessScore({
    household: plan.household,
    tasks: plan.tasks,
    kitLines,
    inventory: plan.inventory,
    zone: plan.zone,
    goBags: plan.goBags,
    medical: plan.medical,
    communication: plan.communication,
    drills: plan.drills.results,
  }, now), [plan.household, plan.tasks, kitLines, plan.inventory, plan.zone, plan.goBags, plan.medical, plan.communication, plan.drills.results, now]);
  const topGap = score.topGaps[0];
  const season = seasonCheck(plan.household.country, plan.household.state, now, plan.inventory.lastRotationAt);
  const drillDays = daysSinceDrill(plan.drills.results, now);
  const drillDue = isDrillDue(plan.drills.results, now);
  const halfBags = plan.goBags.bags.filter(bag => {
    const progress = bagProgress(bag);
    return progress.percent !== null && progress.percent < 50;
  });

  return <Page>
    <Row style={styles.brandRow}>
      <Image style={styles.brandMark} source={require('../../../assets/icon.png')} />
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

    <View style={styles.sectionHeading}><Text style={styles.sectionTitle}>{t('home.sections.ready')}</Text><Text style={styles.sectionNote}>{t('home.sections.ready.note')}</Text></View>

    {/* F09 — the readiness card: band, honest score, and the top gap with a fix. */}
    <Card style={{ gap: 12 }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={{ color: colors.tealDark, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>{t('home.readiness.tag')}</Text>
          <Text style={{ color: colors.ink, fontSize: 17, fontWeight: '800' }}>
            {t('home.readiness.score', { score: score.total })} · <Text style={{ color: colors.primary }}>{t(BAND_LABEL_KEYS[score.band])}</Text>
          </Text>
          {topGap ? <Body style={{ fontSize: 12 }}>{t('home.readiness.topGap', { gap: factorTitle(topGap.id, t) })}</Body> : <Body style={{ fontSize: 12 }}>{t('home.readiness.noGap')}</Body>}
        </View>
        <Text style={{ color: colors.primary, fontSize: 27, fontWeight: '900' }}>{score.total}</Text>
      </Row>
      <Row style={{ gap: 9 }}>
        <View style={{ flex: 1 }}>
          <Link href="/readiness" asChild>
            <Action title={t('home.readiness.open')} kind="secondary" small />
          </Link>
        </View>
      </Row>
    </Card>

    {season ? <Card style={{ backgroundColor: colors.sand, borderColor: colors.sand }}>
      <Row><Pill tone="amber">{t('home.season.tag')}</Pill></Row>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 15 }}>{t(SEASON_LABEL[season.season.id])}</Text>
      <Body style={{ fontSize: 12 }}>{t('home.season.body', { from: season.season.startDay.label })}</Body>
      <Row style={{ gap: 9 }}>
        <View style={{ flex: 1 }}>
          <Link href="/inventory" asChild>
            <Action title={t('home.season.rotate')} kind="secondary" small />
          </Link>
        </View>
        <View style={{ flex: 1 }}>
          <Link href="/readiness" asChild>
            <Action title={t('home.season.readiness')} kind="quiet" small />
          </Link>
        </View>
      </Row>
    </Card> : null}

    <Card style={{ gap: 4 }}>
      <Text style={{ color: colors.tealDark, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>{t('home.updates.tag')}</Text>
      {coverage.length || drillDue || drillDays !== null || halfBags.length ? <>
        {coverage.map(line => <Row key={line.itemId} style={{ paddingVertical: 5, alignItems: 'flex-start' }}>
          <Body style={{ flex: 1, fontSize: 13 }}>
            {line.itemId === 'water' ? t('home.updates.water') : t('home.updates.food')}
          </Body>
          <Pill tone={line.covered ? 'green' : 'amber'}>
            {line.covered ? t('home.updates.covered') : t('inventory.coverage.missing', { owned: line.owned, required: line.required })}
          </Pill>
        </Row>)}
        {drillDue ? <Row style={{ paddingVertical: 5 }}>
          <Body style={{ flex: 1, fontSize: 13 }}>{t('home.updates.drillDue')}</Body>
          <Link href="/drill" asChild>
            <Action title={t('home.updates.practise')} kind="secondary" small />
          </Link>
        </Row> : drillDays !== null ? <Row style={{ paddingVertical: 5 }}>
          <Body style={{ flex: 1, fontSize: 13 }}>{t('home.updates.drill', { days: drillDays })}</Body>
          <Link href="/drill" asChild>
            <Action title={t('home.updates.practise')} kind="quiet" small />
          </Link>
        </Row> : null}
        {halfBags.map(bag => <Row key={bag.id} style={{ paddingVertical: 5 }}>
          <Body style={{ flex: 1, fontSize: 13 }}>{t('home.updates.bag', { name: bag.name })}</Body>
          <Link href={`/go-bags/${bag.id}`} asChild>
            <Action title={t('gobags.open')} kind="quiet" small />
          </Link>
        </Row>)}
      </> : <Body style={{ fontSize: 12 }}>{t('home.updates.empty')}</Body>}
    </Card>

    <Card style={styles.alertCard}>
      <Row style={{ alignItems: 'flex-start', gap: 10 }}>
        <View style={styles.alertIcon}><Text style={styles.alertIconText}>!</Text></View>
        <View style={{ flex: 1, gap: 5 }}><Text style={styles.alertTitle}>For current alerts, check official sources</Text><Body>Conditions and evacuation orders can change. StormReady is a planning tool, not an emergency alert authority.</Body></View>
      </Row>
      <Body>Open Updates in the bottom toolbar for current alerts and local guidance.</Body>
    </Card>

    <Text style={styles.footer}>Check local emergency-management guidance for your area. Official sources are the final authority for alerts and evacuation orders.</Text>
  </Page>;
}

/** The localized title of a readiness factor, mapped through `FACTOR_LABEL_KEYS`. */
function factorTitle(factorId: string, t: (key: TranslationKey, params?: Record<string, string | number>) => string): string {
  const key = FACTOR_LABEL_KEYS[factorId];
  return key ? t(key) : factorId;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  brandRow: { minHeight: 40, marginBottom: 1, gap: 9 },
  brandMark: { width: 32, height: 32, borderRadius: 10 },
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
