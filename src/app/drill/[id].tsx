import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, FadeOut, FadeOutUp, ReduceMotion } from 'react-native-reanimated';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { drillById, suggestedTasksFor, scoreDrill } from '../../scenarios/model';
import { type DrillDefinition, type DrillStep } from '../../scenarios/drills';
import { newId } from '../../util/id';
import { usePlan } from '../../plan';
import { Action, Body, Card, Header, MotionPressable, Page, Pill, Row } from '../../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../../theme';
import { useT, type TranslationKey } from '../../i18n';
import { formatDateShort } from '../../i18n/format';

type DrillAnswer = 'ready' | 'not-yet' | 'skipped';

/** Localized scenario names (same ids as the list screen). */
const DRILL_NAME_KEYS: Record<string, TranslationKey> = {
  'power-outage': 'drills.name.power_outage',
  evacuation: 'drills.name.evacuation',
  'shelter-night': 'drills.name.shelter_night',
  'home-medical': 'drills.name.home_medical',
  'communication-failure': 'drills.name.communication_failure',
};

/** F08 — the runner: one step per screen (a big prompt, an optional hint,
 * three honest answers), a local countdown (R-DRL-4: no alarm, no sound, no
 * scheduled notification), and a debrief. "Not yet" offers a checklist task
 * and the user chooses (R-DRL-2); nothing is added silently.
 */
export default function DrillRun() {
  const plan = usePlan();
  const router = useRouter();
  const { colors, dark } = useAppTheme();
  const { t, locale } = useT();
  const styles = dark ? darkStyles : lightStyles;
  const { id } = useLocalSearchParams<{ id: string }>();

  const definition = useMemo<DrillDefinition | null>(() => drillById(id), [id]);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, DrillAnswer>>({});
  const [secondsLeft, setSecondsLeft] = useState((definition?.minutes ?? 5) * 60);
  const [offerTask, setOfferTask] = useState<DrillStep['taskLink'] | null>(null);
  const [savedResultId, setSavedResultId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const steps = definition?.steps ?? [];
  const finished = index >= steps.length;
  // R-DRL-4: the drill's own silent countdown is the timer, so elapsed time is
  // derived from it and nothing reads the wall clock during render.
  const totalSeconds = (definition?.minutes ?? 5) * 60;
  const durationSeconds = Math.max(0, totalSeconds - secondsLeft);

  useEffect(() => {
    if (finished) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => setSecondsLeft(value => Math.max(0, value - 1)), 1000);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [finished]);

  if (!definition) {
    return <Page scroll={false}>
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 20 }}>
        <Text style={{ color: colors.onSurface, fontWeight: '800', fontSize: 18 }}>{t('drill.missing')}</Text>
        <Body>{t('drill.missing.body')}</Body>
        <Action title={t('drills.openList')} kind="secondary" onPress={() => router.replace('/drill')} />
      </View>
    </Page>;
  }

  const answer = (step: DrillStep, value: DrillAnswer) => {
    setAnswers(current => ({ ...current, [step.id]: value }));
    if (value === 'not-yet' && step.taskLink) {
      setOfferTask(step.taskLink);
      return;
    }
    setOfferTask(null);
    setIndex(current => current + 1);
  };

  const continueToNext = () => {
    setOfferTask(null);
    setIndex(current => current + 1);
  };

  const acceptTask = (task: NonNullable<DrillStep['taskLink']>) => {
    plan.addTask({ id: newId('task'), title: task.title, detail: task.detail, category: task.category, done: false });
    continueToNext();
  };

  const clock = `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`;

  if (finished) {
    const score = scoreDrill(definition, answers);
    const notYet = suggestedTasksFor(definition, answers);

    const save = () => {
      const resultId = savedResultId ?? newId('drill');
      if (savedResultId) return;
      plan.addDrillResult({
        id: resultId,
        drillId: definition.id,
        completedAt: new Date().toISOString(),
        durationSeconds,
        answers,
        suggestedTasks: notYet.map(task => ({ id: newId('task'), title: task.title, detail: task.detail, category: task.category })),
      });
      setSavedResultId(resultId);
    };

    const share = async () => {
      const day = formatDateShort(new Date(), locale);
      await Share.share({
        title: t('drill.share.title'),
        message: [
          `StormReady drill · ${definition.title}`,
          `${day}: ${t('drill.debrief.score', { ready: score.ready, total: score.total })}`,
          notYet.length ? `Not yet:\n${notYet.map(task => `- ${task.title}`).join('\n')}` : '',
        ].filter(Boolean).join('\n'),
      }).catch(() => {});
    };

    return <Page>
      <Row style={styles.chromeGap}>
        <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.replace('/drill')} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← {t('drills.done.back')}</Text>
        </MotionPressable>
        <View style={{ flex: 1 }} />
        <Pill tone="blue">{t('drill.debrief.tag')}</Pill>
      </Row>

      <Header
        eyebrow={t('drill.debrief.tag')}
        title={t('drill.debrief.title')}
        subtitle={DRILL_NAME_KEYS[definition.id] ? t(DRILL_NAME_KEYS[definition.id]) : definition.title}
      />

      <Card style={{ backgroundColor: colors.navy, borderColor: colors.navy }}>
        <Text style={{ color: '#B5F1E4', fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>{t('drill.debrief.scoreTag')}</Text>
        <Text style={{ color: '#FFFFFF', fontSize: 24, fontWeight: '800' }}>
          {t('drill.debrief.score', { ready: score.ready, total: score.total })}
        </Text>
        <Body style={{ color: '#C3D7CE' }}>{t('drill.debrief.score.copy', { count: score.total - score.ready })}</Body>
        {score.skipped ? <Body style={{ color: '#C3D7CE', fontSize: 12 }}>{t('drill.debrief.skipped', { count: score.skipped })}</Body> : null}
      </Card>

      {notYet.length ? <Card>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('drill.debrief.notYet')}</Text>
        {notYet.map(task => <Row key={task.title} style={[styles.row, { borderTopColor: colors.outlineVariant }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>{task.title}</Text>
            <Body style={{ fontSize: 12 }}>{task.detail}</Body>
          </View>
          <Action title={t('drill.task.add')} small kind={savedResultId ? 'quiet' : 'secondary'} onPress={() => plan.addTask({ id: newId('task'), title: task.title, detail: task.detail, category: task.category, done: false })} />
        </Row>)}
      </Card> : <Card style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
        <Text style={{ color: colors.tealDark, fontWeight: '800', fontSize: 16 }}>{t('drill.debrief.allReady')}</Text>
        <Body style={{ color: colors.tealDark }}>{t('drill.debrief.allReady.body')}</Body>
      </Card>}

      <Card>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('drill.debrief.question')}</Text>
        <Body>{definition.debrief}</Body>
      </Card>

      <Card>
        <Row style={{ gap: 9 }}>
          <View style={{ flex: 1 }}>
            <Action title={savedResultId ? t('drill.save.done') : t('drill.save')} onPress={save} />
          </View>
          <View style={{ flex: 1 }}><Action title={t('drill.share')} kind="secondary" onPress={() => void share()} /></View>
        </Row>
        {savedResultId ? <Body style={{ fontSize: 11 }}>{t('drill.save.note')}</Body> : null}
        <Body style={{ fontSize: 11 }}>{t('drills.disclaimer')}</Body>
      </Card>
    </Page>;
  }

  const step = steps[index];
  return <Page>
    <Row style={styles.chromeGap}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('drill.step.counter', { index: index + 1, total: steps.length })}</Pill>
      <Pill tone={secondsLeft < 60 ? 'amber' : 'green'}>{clock}</Pill>
    </Row>

    <Header eyebrow={t('drill.eyebrow')} title={definition.title} subtitle={definition.scenario} />

    {offerTask ? <Animated.View key="offer" entering={FadeIn.duration(160).reduceMotion(ReduceMotion.System)} exiting={FadeOut.duration(120).reduceMotion(ReduceMotion.System)}>
      <Card style={{ backgroundColor: colors.amberBg, borderColor: colors.amberBg }}>
        <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{t('drill.task.offer')}</Text>
        <Body style={{ fontSize: 12 }}>{t('drill.task.offer.body')}</Body>
        <Row style={{ gap: 9 }}>
          <View style={{ flex: 1 }}><Action title={t('drill.task.add')} onPress={() => acceptTask(offerTask)} /></View>
          <View style={{ flex: 1 }}><Action title={t('drill.task.skip')} kind="quiet" onPress={continueToNext} /></View>
        </Row>
      </Card>
    </Animated.View> : <Animated.View key={step.id} entering={FadeInDown.duration(180).reduceMotion(ReduceMotion.System)} exiting={FadeOutUp.duration(140).reduceMotion(ReduceMotion.System)}>
      <Card>
        <Text style={{ color: colors.ink, fontSize: 24, lineHeight: 33, fontWeight: '800', letterSpacing: -0.4 }}>{step.prompt}</Text>
        {step.hint ? <Body>{t('drill.hint', { hint: step.hint })}</Body> : null}
        <Row style={{ gap: 9 }}>
          <View style={{ flex: 1 }}><Action title={t('drill.answer.ready')} onPress={() => answer(step, 'ready')} /></View>
          <View style={{ flex: 1 }}><Action title={t('drill.answer.notYet')} kind="secondary" onPress={() => answer(step, 'not-yet')} /></View>
        </Row>
        <Row style={{ gap: 9 }}>
          <View style={{ flex: 1 }}><Action title={t('drill.answer.skip')} kind="quiet" onPress={() => answer(step, 'skipped')} /></View>
        </Row>
      </Card>
    </Animated.View>}

    <Body style={{ fontSize: 11 }}>{t('drills.disclaimer')}</Body>
  </Page>;
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
