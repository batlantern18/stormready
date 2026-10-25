import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { bagProgress, createBag, missingLineIds, suggestedPersonalBags, type BagProgress } from '../gobag/model';
import { calculateKit } from '../kit/calculator';
import { newId } from '../util/id';
import { usePlan } from '../plan';
import { BAG_TEMPLATES } from '../gobag/templates';
import type { GoBagTemplate } from '../plan-schema';
import { Action, Body, Card, Field, Header, MotionPressable, Page, Pill, ProgressBar, Row, Stepper } from '../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../theme';
import { useT, type TranslationKey } from '../i18n';

/**
 * F02 — the "Grab list": every bag in one view — name, owner, packed count,
 * location (plan flow point 1) — with the add-bag flow (name, owner, location,
 * template) and per-bag completion. Live here so the runner screen
 * `go-bags/[id]` stays focused on the bag itself.
 */
export default function GoBags() {
  const plan = usePlan();
  const router = useRouter();
  const { colors, dark } = useAppTheme();
  const { t } = useT();
  const styles = dark ? darkStyles : lightStyles;
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [owner, setOwner] = useState('');
  const [location, setLocation] = useState('');
  const [template, setTemplate] = useState<GoBagTemplate>('personal');

  const bags = plan.goBags.bags;
  const kitLineIds = useMemo(
    () => calculateKit(plan.household, plan.medical, plan.communication).map(line => line.id),
    [plan.household, plan.medical, plan.communication],
  );
  const templates = useMemo(() => Object.values(BAG_TEMPLATES), []);

  const closeAdd = () => {
    setAdding(false);
    setName('');
    setOwner('');
    setLocation('');
    setTemplate('personal');
  };

  const create = (chosen: GoBagTemplate) => {
    const bag = createBag(chosen, {
      id: newId('bag'),
      name,
      owner,
      location,
      createdAt: new Date().toISOString(),
    });
    plan.setGoBags({ bags: [...bags, bag] });
    closeAdd();
    router.push(`/go-bags/${bag.id}`);
  };

  const suggestForEveryone = () => {
    const suggestions = suggestedPersonalBags(
      plan.household,
      index => newId(`bag-${index}`),
      new Date().toISOString(),
    );
    if (!suggestions.length) return;
    plan.setGoBags({ bags: [...bags, ...suggestions] });
  };

  const remove = (id: string, progress: BagProgress) => {
    const bag = bags.find(item => item.id === id);
    if (!bag) return;
    Alert.alert(
      t('gobags.remove.title', { name: bag.name.length > 40 ? `${bag.name.slice(0, 40)}…` : bag.name }),
      t('gobags.remove.body', { packed: progress.packed, total: progress.total }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('gobags.remove.confirm'),
          style: 'destructive',
          onPress: () => plan.setGoBags({ bags: bags.filter(item => item.id !== id) }),
        },
      ],
    );
  };

  // One shared editor so the empty state and the list state offer the same
  // flow: a household with no bags can still create its first one.
  const addForm = adding ? <Card>
    <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('gobags.templates.title')}</Text>
    <Body style={{ fontSize: 12 }}>{t('gobags.templates.note')}</Body>
    {templates.map(definition => <Row key={definition.template} style={[styles.templateRow, { borderTopColor: colors.outlineVariant }]}>
      <View style={{ flex: 1, gap: 2 }}>
        <Text onPress={() => setTemplate(definition.template)} accessibilityRole="radio" accessibilityState={{ selected: template === definition.template }} style={{ color: colors.ink, fontWeight: '700', fontSize: 15 }}>
          {template === definition.template ? '◉ ' : '○ '}{definition.title}
        </Text>
        <Body style={{ fontSize: 12 }}>{definition.scenario}</Body>
        <Body style={{ fontSize: 11 }}>{t('gobags.templates.items', { count: definition.itemIds.length })}</Body>
      </View>
    </Row>)}
    <Field label={t('gobags.fields.name')} value={name} onChangeText={setName} placeholder={t('gobags.fields.name.placeholder')} />
    <Field label={t('gobags.fields.owner')} value={owner} onChangeText={setOwner} placeholder={t('gobags.fields.owner.placeholder')} />
    <Field label={t('gobags.fields.location')} value={location} onChangeText={setLocation} placeholder={t('gobags.fields.location.placeholder')} />
    <Row style={{ gap: 9 }}>
      <View style={{ flex: 1 }}><Action title={t('gobags.create')} onPress={() => create(template)} /></View>
      <View style={{ flex: 1 }}><Action title={t('common.cancel')} kind="quiet" onPress={closeAdd} /></View>
    </Row>
  </Card> : null;

  return <Page>
    <Row style={styles.chromeGap}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('gobags.eyebrow')}</Pill>
    </Row>

    <Header
      eyebrow={t('gobags.eyebrow')}
      title={t('gobags.title')}
      subtitle={t('gobags.subtitle')}
    />

    {bags.length === 0 ? <Card style={{ backgroundColor: colors.sand, borderColor: colors.sand }}>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('gobags.emptyTitle')}</Text>
      <Body>{t('gobags.emptyBody')}</Body>
      <Row style={{ gap: 9 }}>
        <View style={{ flex: 1 }}><Action title={t('gobags.add')} onPress={() => setAdding(true)} /></View>
        <View style={{ flex: 1 }}><Action title={t('gobags.suggest')} kind="secondary" onPress={suggestForEveryone} /></View>
      </Row>
    </Card> : null}
    {addForm}
    {bags.length === 0 ? null : <>
      <Row style={{ gap: 9 }}>
        <View style={{ flex: 1 }}><Action title={t('gobags.add')} onPress={() => setAdding(v => !v)} /></View>
        <View style={{ flex: 1 }}><Action title={t('gobags.suggest')} kind="secondary" onPress={suggestForEveryone} /></View>
      </Row>

      {bags.map(bag => {
        const progress = bagProgress(bag);
        const missing = missingLineIds(bag, kitLineIds).length;
        return <Card key={bag.id}>
          <Row style={{ alignItems: 'flex-start' }}>
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: colors.ink, fontSize: 18, fontWeight: '800' }} onPress={() => router.push(`/go-bags/${bag.id}`)} accessibilityRole="button">
                {bag.name}
              </Text>
              {bag.owner ? <Body style={{ fontSize: 13 }}>{t('gobags.ownerLine', { owner: bag.owner })}</Body> : null}
              {bag.location ? <Body style={{ fontSize: 13 }}>{t('gobags.locationLine', { location: bag.location })}</Body> : null}
              <Pill tone={progress.percent === null ? 'blue' : progress.percent >= 100 ? 'green' : progress.percent < 50 ? 'amber' : 'green'}>
                {progress.percent === null
                  ? t('gobags.progress.empty')
                  : t('gobags.progress', { packed: progress.packed, total: progress.total })}
              </Pill>
            </View>
            {progress.percent !== null ? <View style={{ width: 96, gap: 6, alignItems: 'flex-end' }}>
              {progress.percent < 50 ? <Pill tone="amber">{t('gobags.half')}</Pill> : null}
              {missing ? <Body style={{ fontSize: 11 }}>{t('gobags.outOfKit', { count: missing })}</Body> : null}
            </View> : null}
          </Row>
          <ProgressBar
            value={progress.packed}
            max={progress.total || 1}
            label={t('gobags.progress', { packed: progress.packed, total: progress.total })}
            tint={progress.percent !== null && progress.percent < 50 ? colors.amber : colors.primary}
            track={colors.surfaceContainerHigh}
          />
          <Row style={{ gap: 9 }}>
            <View style={{ flex: 1 }}><Action title={t('gobags.open')} kind="secondary" small onPress={() => router.push(`/go-bags/${bag.id}`)} /></View>
            <View style={{ flex: 1 }}><Action title={t('gobags.remove.action')} kind="quiet" small onPress={() => remove(bag.id, progress)} /></View>
          </Row>
        </Card>;
      })}
    </>}

    <Card style={{ backgroundColor: colors.surfaceContainerLow }}>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('gobags.how.title')}</Text>
      <Body>{t('gobags.how.body')}</Body>
      <Body style={{ fontSize: 11 }}>{t('gobags.how.note')}</Body>
    </Card>
  </Page>;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  chromeGap: { gap: 10 },
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { fontSize: 15, fontWeight: '700' },
  heading: { color: colors.onSurface, fontWeight: '800', fontSize: 17 },
  templateRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 12 },
});

const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);
