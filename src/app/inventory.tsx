import React, { useMemo, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { LIMITS, clampInventoryEntry, isFutureIsoDate, type InventoryEntry } from '../plan-schema';
import {
  coverageFor,
  entryFor,
  expiryReport,
  orphanEntries,
  stampRotation,
  type CoverageLine,
} from '../inventory/model';
import { rotationDateFor } from '../inventory/rotation';
import { calculateKit } from '../kit/calculator';
import { usePlan } from '../plan';
import { Action, Body, Card, Disclosure, Field, Header, MotionPressable, Page, Pill, Row, Stepper, ToggleRow } from '../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../theme';
import { useT } from '../i18n';
import { formatDateShort } from '../i18n/format';

export default function Inventory() {
  const plan = usePlan();
  const router = useRouter();
  const { colors, dark } = useAppTheme();
  const { t, locale } = useT();
  const styles = dark ? darkStyles : lightStyles;
  const [editingId, setEditingId] = useState<string | null>(null);

  const kitLines = useMemo(() => calculateKit(plan.household, plan.medical, plan.communication), [plan.household, plan.medical, plan.communication]);
  const coverage = coverageFor(kitLines, plan.inventory);
  const shelfLifeFor = (id: string) => kitLines.find(line => line.id === id)?.shelfLifeMonths;
  const expiry = expiryReport(plan.inventory.entries, new Date());
  const expired = expiry.expired;
  const expiring = expiry.expiringSoon;
  const orphans = orphanEntries(plan.inventory.entries, kitLines.map(line => line.id));
  const rotation = plan.inventory.entries.water || plan.inventory.entries.food
    ? rotationDateFor(entryFor(plan.inventory, 'water') ?? { itemId: 'water', owned: true, quantityOwned: 0, purchasedAt: null, expiresAt: null, note: '' }, shelfLifeFor('water'))
    : null;
  const needsStamp = ['water', 'food'].some(id => {
    const entry = plan.inventory.entries[id];
    return entry?.owned && !entry.purchasedAt;
  });

  const update = (entries: Record<string, InventoryEntry>, lastRotationAt = plan.inventory.lastRotationAt) => {
    plan.setInventory({ entries, lastRotationAt });
  };

  const startRotation = () => {
    update(stampRotation(plan.inventory.entries, ['water', 'food'], new Date().toISOString()).entries, new Date().toISOString());
  };

  const markAllUntracked = () => {
    if (Object.keys(plan.inventory.entries).length === 0) return;
    Alert.alert(t('inventory.reset.title'), t('inventory.reset.body'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('inventory.reset.confirm'), style: 'destructive', onPress: () => plan.setInventory({ entries: {}, lastRotationAt: null }) },
    ]);
  };

  const tracked = kitLines.filter(line => plan.inventory.entries[line.id] || line.id === 'water' || line.id === 'food');

  return <Page>
    <Row style={{ gap: 10 }}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('inventory.eyebrow')}</Pill>
    </Row>

    <Header
      eyebrow={t('inventory.eyebrow')}
      title={t('inventory.title')}
      subtitle={t('inventory.subtitle')}
    />

    <Card style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
      <Text style={[styles.heading, { color: colors.tealDark }]}>{t('inventory.coverage.title')}</Text>
      {coverage.map(line => <CoverageRow key={line.itemId} line={line} />)}
      <Body>{t('inventory.coverage.body')}</Body>
    </Card>

    {expired.length || expiring.length ? <Card style={{ backgroundColor: colors.amberBg, borderColor: colors.amberBg }}>
      <Row><Pill tone="amber">{t('inventory.replaceNow')}</Pill></Row>
      {[...expired, ...expiring].map(entry => <View key={entry.itemId} style={{ paddingVertical: 6 }}>
        <Row style={{ gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.ink, fontWeight: '800' }}>{kitLines.find(line => line.id === entry.itemId)?.label ?? entry.itemId}</Text>
            <Body>
              {expired.some(exp => exp.itemId === entry.itemId) ? t('inventory.expiredOn', { date: formatDateShort(entry.expiresAt, locale) }) : t('inventory.expiresOn', { date: formatDateShort(entry.expiresAt, locale) })}
            </Body>
          </View>
          <Action title={t('inventory.edit')} small kind="secondary" onPress={() => setEditingId(entry.itemId)} />
        </Row>
      </View>)}
      <Body>{t('inventory.replaceNow.body')}</Body>
    </Card> : null}

    {needsStamp ? <Card>
      <Row><Pill>{t('inventory.rotation.tag')}</Pill></Row>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('inventory.rotation.title')}</Text>
      <Body>{t('inventory.rotation.body')}</Body>
      <Action title={t('inventory.rotation.start')} onPress={startRotation} />
    </Card> : rotation ? <Body style={{ fontSize: 12 }}>
      {t('inventory.rotation.next', { date: formatDateShort(rotation, locale) })}
    </Body> : null}

    <Card>
      <Row>
        <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('inventory.tracked')}</Text>
        <Action title={t('inventory.reset.action')} kind="quiet" small onPress={markAllUntracked} />
      </Row>
      <Body style={{ fontSize: 12 }}>{t('inventory.tracked.body')}</Body>
      {tracked.map(line => {
        const entry = plan.inventory.entries[line.id];
        return <View key={line.id} style={{ borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant, paddingTop: 10, marginTop: 10 }}>
          <Row style={{ gap: 10 }}>
            <Text onPress={() => setEditingId(editingId === line.id ? null : line.id)} accessibilityRole="button" style={{ flex: 1, color: colors.ink, fontWeight: '700', fontSize: 15 }}>
              {editingId === line.id ? '▾ ' : '▸ '}{line.label}
            </Text>
            {entry ? <Pill tone={entry.owned ? 'green' : 'amber'}>{entry.owned ? t('inventory.owned') : t('inventory.notOwned')}</Pill> : <Pill tone="blue">{t('inventory.untracked')}</Pill>}
          </Row>
          {entry && editingId !== line.id ? <Body style={{ fontSize: 12 }}>
            {entry.owned ? t('inventory.summary', {
              quantity: entry.quantityOwned,
              purchased: entry.purchasedAt ? formatDateShort(entry.purchasedAt, locale) : t('inventory.noDate'),
              expires: entry.expiresAt ? formatDateShort(entry.expiresAt, locale) : t('inventory.noDate'),
            }) : t('inventory.notOwned.body')}
            {entry.note ? `\n${t('inventory.note.label')}: ${entry.note}` : ''}
          </Body> : null}
          {editingId === line.id ? <Disclosure>
            <EntryEditor
              label={line.label}
              requiredQuantity={line.quantity}
              entry={entry}
              onChange={next => update(next.itemId
                ? { ...plan.inventory.entries, [next.itemId]: next }
                : { ...plan.inventory.entries, [line.id]: { ...next, itemId: line.id } })}
              onClose={() => setEditingId(null)}
            />
          </Disclosure> : null}
        </View>;
      })}
    </Card>

    {orphans.length ? <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('inventory.orphans')}</Text>
      <Body style={{ fontSize: 12 }}>{t('inventory.orphans.body')}</Body>
      {orphans.map(entry => <Row key={entry.itemId} style={{ paddingTop: 8 }}>
        <Text style={{ flex: 1, color: colors.ink, fontWeight: '600', fontSize: 14 }}>{entry.itemId}</Text>
        <Action title={t('inventory.orphans.remove')} small kind="secondary" onPress={() => {
          const next = { ...plan.inventory.entries };
          delete next[entry.itemId];
          update(next);
        }} />
      </Row>)}
    </Card> : null}

    <Card style={{ backgroundColor: colors.surfaceContainerLow }}>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('inventory.how.title')}</Text>
      <Body>{t('inventory.how.body')}</Body>
      <Body style={{ fontSize: 11 }}>{t('inventory.how.note')}</Body>
    </Card>
  </Page>;
}

function CoverageRow({ line }: { line: CoverageLine }) {
  const { colors } = useAppTheme();
  const { t } = useT();
  return <View style={{ paddingVertical: 6, gap: 4 }}>
    <Row style={{ gap: 10 }}>
      <Text style={{ flex: 1, color: colors.ink, fontWeight: '700' }}>
        {line.itemId === 'water' ? t('inventory.coverage.water') : t('inventory.coverage.food')}
      </Text>
      <Text style={{ color: line.covered ? colors.success : colors.amber, fontWeight: '800', fontSize: 13 }}>
        {line.covered ? t('inventory.coverage.covered') : t('inventory.coverage.missing', { owned: line.owned, required: line.required })}
      </Text>
    </Row>
    <View style={{ height: 7, borderRadius: 8, backgroundColor: colors.surfaceContainerHigh, overflow: 'hidden' }}>
      <View style={{ width: `${Math.min(100, line.percent ?? 0)}%`, height: 7, borderRadius: 8, backgroundColor: line.covered ? colors.success : colors.primary }} />
    </View>
  </View>;
}

function EntryEditor({ label, requiredQuantity, entry, onChange, onClose }: {
  label: string;
  requiredQuantity: number;
  entry: InventoryEntry | undefined;
  onChange: (entry: InventoryEntry) => void;
  onClose: () => void;
}) {
  const { colors } = useAppTheme();
  const { t } = useT();
  const current = entry ?? { itemId: '', owned: false, quantityOwned: 0, purchasedAt: null, expiresAt: null, note: '' };
  const [owned, setOwned] = React.useState(current.owned);
  const [quantity, setQuantity] = React.useState(current.owned ? current.quantityOwned : requiredQuantity);
  const [purchased, setPurchased] = React.useState(toShortDate(current.purchasedAt));
  const [expires, setExpires] = React.useState(toShortDate(current.expiresAt));
  const [note, setNote] = React.useState(current.note);

  const purchasedError = owned && purchased && !isValidShortDate(purchased) ? t('inventory.date.invalid') : '';
  const expiresError = owned && expires && !isValidShortDate(expires) ? t('inventory.date.invalid') : '';
  const futureError = owned && purchased && isValidShortDate(purchased) && isFutureIsoDate(purchased, new Date().toISOString())
    ? t('inventory.date.future') : '';

  const save = () => {
    if (!owned) {
      onChange(clampInventoryEntry({ ...current, itemId: current.itemId, owned: false, quantityOwned: current.quantityOwned, purchasedAt: null, expiresAt: null, note }));
      onClose();
      return;
    }
    onChange(clampInventoryEntry({
      ...current,
      itemId: current.itemId,
      owned: true,
      quantityOwned: quantity,
      purchasedAt: purchased && isValidShortDate(purchased) ? purchased : null,
      expiresAt: expires && isValidShortDate(expires) ? expires : null,
      note: note.slice(0, LIMITS.inventoryNote),
    }));
    onClose();
  };

  return <View style={{ gap: 12, marginTop: 10 }}>
    {purchasedError ? <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 12 }}>{purchasedError}</Text> : null}
    {expiresError ? <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 12 }}>{expiresError}</Text> : null}
    {futureError ? <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 12 }}>{futureError}</Text> : null}
    <ToggleRow title={t('inventory.owned')} detail={t('inventory.owned.detail', { quantity: requiredQuantity })} value={owned} onPress={() => setOwned(!owned)} />
    <Stepper
      label={t('inventory.quantity')}
      detail={current.itemId ? undefined : `${t('inventory.suggested')}: ${requiredQuantity}`}
      value={quantity}
      min={LIMITS.inventoryQuantity.min}
      max={LIMITS.inventoryQuantity.max}
      onChange={setQuantity}
    />
    <Field label={t('inventory.purchased')} value={purchased} onChangeText={setPurchased} placeholder={t('inventory.date.example')} />
    <Field label={t('inventory.expires')} value={expires} onChangeText={setExpires} placeholder={t('inventory.date.example')} />
    <Field label={t('inventory.note.label')} value={note} onChangeText={setNote} multiline placeholder={t('inventory.note.placeholder')} />
    <Row style={{ gap: 9 }}>
      <View style={{ flex: 1 }}><Action title={t('inventory.save')} onPress={save} /></View>
      <View style={{ flex: 1 }}><Action title={t('common.cancel')} kind="quiet" onPress={onClose} /></View>
    </Row>
  </View>;
}

function toShortDate(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return iso.length <= 10 ? iso : date.toISOString().slice(0, 10);
}

function isValidShortDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && value.length === 10;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { fontSize: 15, fontWeight: '700' },
  heading: { color: colors.tealDark, fontWeight: '800', fontSize: 17 },
});
const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);
