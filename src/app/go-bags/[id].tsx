import React, { useMemo, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { setPackedFor, removeLineFromBag, bagProgress, missingLineIds, bagToText } from '../../gobag/model';
import type { GoBag } from '../../plan-schema';
import { calculateKit } from '../../kit/calculator';
import { CATEGORY_LABELS, CATEGORY_ORDER, type KitCategory } from '../../kit/catalog';
import { usePlan } from '../../plan';
import { Action, Body, Card, Disclosure, Field, Header, MotionPressable, Page, Pill, ProgressBar, Row } from '../../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../../theme';
import { useT } from '../../i18n';

/**
 * F02 — one bag, one screen. Quantities come from the current kit (R-BAG-1:
 * ids only; vanished kit lines stay listed as "Not in your current kit"),
 * progress is derived (R-BAG-3), and sharing is text-only (R-BAG-5).
 */
export default function GoBagDetail() {
  const plan = usePlan();
  const router = useRouter();
  const { colors, dark } = useAppTheme();
  const { t } = useT();
  const styles = dark ? darkStyles : lightStyles;
  const { id } = useLocalSearchParams<{ id: string }>();
  const [pickerOpen, setPickerOpen] = useState(false);

  const bag = plan.goBags.bags.find(item => item.id === id);
  const kitLines = useMemo(
    () => calculateKit(plan.household, plan.medical, plan.communication),
    [plan.household, plan.medical, plan.communication],
  );

  const patchBag = (bagId: string, patch: Partial<GoBag>) =>
    plan.setGoBags({ bags: plan.goBags.bags.map(item => item.id === bagId ? { ...item, ...patch } : item) });

  if (!bag) {
    return <Page>
      <Row style={styles.chromeGap}>
        <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
          <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
        </MotionPressable>
        <View style={{ flex: 1 }} />
      </Row>
      <Header eyebrow={t('gobag.eyebrow')} title={t('gobag.missing')} />
      <Card>
        <Body>{t('gobag.missing.body')}</Body>
        <Action title={t('gobags.openList')} kind="secondary" onPress={() => router.replace('/go-bags')} />
      </Card>
    </Page>;
  }

  const progress = bagProgress(bag);
  const missing = missingLineIds(bag, kitLines.map(line => line.id));
  const inBag = bag.itemIds;
  const pickables = kitLines.filter(line => !inBag.includes(line.id));

  const togglePacked = (itemId: string, packed: boolean) =>
    plan.setGoBags({ bags: plan.goBags.bags.map(item => item.id === bag.id ? setPackedFor(item, itemId, packed) : item) });

  const removeLine = (itemId: string) =>
    plan.setGoBags({ bags: plan.goBags.bags.map(item => item.id === bag.id ? removeLineFromBag(item, itemId) : item) });

  const addLine = (itemId: string) =>
    plan.setGoBags({ bags: plan.goBags.bags.map(item => (item.id === bag.id && !item.itemIds.includes(itemId)) ? { ...item, itemIds: [...item.itemIds, itemId] } : item) });

  const share = async () => {
    await Share.share({
      title: t('gobag.share.title'),
      message: bagToText(bag, kitLines, plan.household),
    }).catch(() => {});
  };

  const grouped = new Map<KitCategory, { id: string; label: string; quantity: number; unit: string; unitPlural: string; note?: string }[]>();
  for (const line of kitLines) {
    if (!inBag.includes(line.id)) continue;
    const group = grouped.get(line.category) ?? [];
    group.push(line);
    grouped.set(line.category, group);
  }

  return <Page>
    <Row style={styles.chromeGap}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('gobag.eyebrow')}</Pill>
    </Row>

    <Header eyebrow={t('gobag.eyebrow')} title={bag.name} subtitle={t('gobag.subtitle')} />

    <Card style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={{ color: colors.tealDark, fontSize: 10, fontWeight: '800', letterSpacing: 1 }}>{t('gobag.progressTag')}</Text>
          <Text style={{ color: colors.ink, fontSize: 22, fontWeight: '900' }}>
            {progress.percent === null ? t('gobag.progress.empty') : t('gobag.progress', { packed: progress.packed, total: progress.total })}
          </Text>
        </View>
      </Row>
      <ProgressBar
        value={progress.packed}
        max={progress.total || 1}
        label={t('gobag.progress', { packed: progress.packed, total: progress.total })}
        tint={colors.tealDark}
        track={colors.surfaceContainerHigh}
      />
      <Body style={{ color: colors.tealDark }}>{t('gobag.progress.note')}</Body>
    </Card>

    {missing.length ? <Card style={{ backgroundColor: colors.amberBg, borderColor: colors.amberBg }}>
      <Row><Pill tone="amber">{t('gobag.missingTag')}</Pill></Row>
      <Body>{t('gobag.missing.body')}</Body>
      {missing.map(lineId => <Row key={lineId} style={{ paddingTop: 4 }}>
        <Text style={{ flex: 1, color: colors.ink, fontWeight: '600', fontSize: 14 }}>{lineId}</Text>
        <Action title={t('gobag.missing.remove')} small kind="secondary" onPress={() => removeLine(lineId)} />
      </Row>)}
    </Card> : null}

    {CATEGORY_ORDER.map(category => {
      const group = grouped.get(category);
      if (!group?.length) return null;
      return <Card key={category}>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{CATEGORY_LABELS[category]}</Text>
        {group.map((line, index) => <View key={line.id} style={[styles.lineRow, index > 0 && { borderTopColor: colors.outlineVariant }]}>
          <Row style={{ gap: 10 }}>
            <Text
              onPress={() => togglePacked(line.id, !bag.packed[line.id])}
              accessibilityRole="checkbox"
              accessibilityLabel={`${line.label} — ${t('gobag.packed')}`}
              accessibilityState={{ checked: Boolean(bag.packed[line.id]) }}
              style={{ flex: 1, color: colors.ink, fontWeight: '700', fontSize: 15 }}
            >
              {bag.packed[line.id] ? '☑ ' : '☐ '}{line.label}
            </Text>
            <Text style={{ color: colors.muted, fontSize: 13, fontWeight: '600' }}>
              {line.quantity === 1 ? line.unit : `${line.quantity} ${line.unitPlural}`}
            </Text>
            <Action title={t('gobag.remove')} small kind="quiet" onPress={() => removeLine(line.id)} />
          </Row>
        </View>)}
      </Card>;
    })}

    <Card>
      <Row>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('gobag.add.title')}</Text>
        <Action title={pickerOpen ? t('common.done') : t('gobag.add.action')} kind={pickerOpen ? 'quiet' : 'secondary'} small onPress={() => setPickerOpen(v => !v)} />
      </Row>
      <Body style={{ fontSize: 12 }}>{t('gobag.add.body')}</Body>
      {pickerOpen ? <Disclosure>
        {pickables.length ? pickables.map(line => <Row key={line.id} style={[styles.lineRow, { borderTopColor: colors.outlineVariant }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.ink, fontWeight: '700', fontSize: 14 }}>{line.label}</Text>
            <Body style={{ fontSize: 11 }}>{line.basis}</Body>
          </View>
          <Action title={t('gobag.add.choose')} small kind="secondary" onPress={() => addLine(line.id)} />
        </Row>) : <Body style={{ fontSize: 12 }}>{t('gobag.add.none')}</Body>}
      </Disclosure> : null}
    </Card>

    <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('gobag.details')}</Text>
      <Field label={t('gobags.fields.name')} value={bag.name} onChangeText={name => patchBag(bag.id, { name: name.slice(0, 80) })} placeholder={t('gobags.fields.name.placeholder')} />
      <Field label={t('gobags.fields.owner')} value={bag.owner} onChangeText={owner => patchBag(bag.id, { owner: owner.slice(0, 80) })} placeholder={t('gobags.fields.owner.placeholder')} />
      <Field label={t('gobags.fields.location')} value={bag.location} onChangeText={location => patchBag(bag.id, { location: location.slice(0, 80) })} placeholder={t('gobags.fields.location.placeholder')} />
      <Field label={t('gobag.details.note')} value={bag.note} onChangeText={note => patchBag(bag.id, { note: note.slice(0, 200) })} multiline placeholder={t('gobag.details.note.placeholder')} />
      <Action title={t('gobag.share.action')} onPress={() => void share()} />
      <Body style={{ fontSize: 11 }}>{t('gobag.share.note')}</Body>
    </Card>
  </Page>;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  chromeGap: { gap: 10 },
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { fontSize: 15, fontWeight: '700' },
  heading: { color: colors.onSurface, fontWeight: '800', fontSize: 17 },
  lineRow: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 10, marginTop: 10 },
});

const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);
