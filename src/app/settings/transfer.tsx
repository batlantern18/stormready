import React, { useEffect, useRef, useState } from 'react';
import { Modal, StyleSheet, Text, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import QRCode from 'react-native-qrcode-svg';
import { useRouter } from 'expo-router';
import {
  DEFAULT_EXPORT_OPTIONS,
  buildEnvelope,
  mergeEnvelope,
  parseEnvelope,
  previewImport,
  type ExportOptions,
  type ImportPreview,
  type PlanEnvelope,
} from '../../transfer/model';
import { pickPlanFile, shareEnvelope } from '../../transfer/file';
import { newId } from '../../util/id';
import { usePlan } from '../../plan';
import { Action, Body, Card, Header, MotionPressable, Page, Pill, Row, ToggleRow } from '../../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../../theme';
import { useT, type TranslationKey } from '../../i18n';
import { formatDate } from '../../i18n/format';
import { assembleTransferQrFrames, makeTransferQrFrames, parseTransferQrFrame } from '../../transfer/qr';

const OPTION_KEYS: { key: keyof ExportOptions; nameKey: TranslationKey; detailKey: TranslationKey }[] = [
  { key: 'household', nameKey: 'transfer.section.household', detailKey: 'transfer.section.detail.household' },
  { key: 'checklist', nameKey: 'transfer.section.checklist', detailKey: 'transfer.section.detail.checklist' },
  { key: 'destination', nameKey: 'transfer.section.destination', detailKey: 'transfer.section.detail.destination' },
  { key: 'zone', nameKey: 'transfer.section.zone', detailKey: 'transfer.section.detail.zone' },
  { key: 'communication', nameKey: 'transfer.section.communication', detailKey: 'transfer.section.detail.communication' },
  { key: 'medical', nameKey: 'transfer.section.medical', detailKey: 'transfer.section.detail.medical' },
  { key: 'goBags', nameKey: 'transfer.section.go_bags', detailKey: 'transfer.section.detail.go_bags' },
  { key: 'inventory', nameKey: 'transfer.section.inventory', detailKey: 'transfer.section.detail.inventory' },
];

/** Preview section names are internal strings; every one the model emits is keyed. */
const SECTION_NAME_KEYS: Record<string, TranslationKey> = {
  household: 'transfer.section.household',
  checklist: 'transfer.section.checklist',
  destination: 'transfer.section.destination',
  zone: 'transfer.section.zone',
  communication: 'transfer.section.communication',
  'communication contacts': 'transfer.section.contacts',
  'meeting point': 'transfer.section.meeting_point',
  communication_plan: 'transfer.section.plan',
  medical: 'transfer.section.medical',
  'medical plan': 'transfer.section.medical',
  'go-bags': 'transfer.section.go_bags',
  inventory: 'transfer.section.inventory',
};

/** R-EXP-5: a plain explanation for every "skipped" line, keyed where known. */
const SKIPPED_REASON_KEYS: Record<string, TranslationKey> = {
  'already imported — this file has nothing new for that part': 'transfer.reason.already',
  'Your device already has a zone on record. Importing never overwrites it — zones are verified locally, by you.': 'transfer.reason.zone',
  'The file has no go-bags in it': 'transfer.reason.empty',
};

/**
 * F06 — Household Transfer. Export writes a self-contained `.stormready-plan`
 * file to the system share sheet; import reads one, shows a preview
 * (R-EXP-3), and merges or replaces only on an explicit choice. R-EXP-1:
 * medical and inventory ship untoggled. R-EXP-7: no network anywhere.
 */
export default function Transfer() {
  const plan = usePlan();
  const router = useRouter();
  const { colors, dark } = useAppTheme();
  const { t, locale } = useT();
  const styles = dark ? darkStyles : lightStyles;

  const [options, setOptions] = useState<ExportOptions>(DEFAULT_EXPORT_OPTIONS);
  const [exportError, setExportError] = useState('');
  const [importing, setImporting] = useState(false);
  const [pending, setPending] = useState<{ envelope: PlanEnvelope; preview: ImportPreview } | null>(null);
  const [readError, setReadError] = useState('');
  const [done, setDone] = useState<{ added: number; conflicts: number; skipped: number } | null>(null);
  const [qrFrames, setQrFrames] = useState<string[] | null>(null);
  const [qrFrameIndex, setQrFrameIndex] = useState(0);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanCount, setScanCount] = useState(0);
  const [scanTotal, setScanTotal] = useState(0);
  const [scanError, setScanError] = useState('');
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const qrCollection = useRef<{ sessionId: string; total: number; frames: Map<number, string> } | null>(null);
  const scanComplete = useRef(false);

  useEffect(() => {
    if (!qrFrames || qrFrames.length < 2) return;
    const timer = setInterval(() => setQrFrameIndex(index => (index + 1) % qrFrames.length), 850);
    return () => clearInterval(timer);
  }, [qrFrames]);

  const toggle = (key: keyof ExportOptions) => setOptions(current => ({ ...current, [key]: !current[key] }));

  const createEnvelope = (): PlanEnvelope | null => {
    setExportError('');
    setDone(null);
    const profileId = plan.profileId || 'default';
    const profile = plan.doc.profiles[profileId] ?? plan.doc.profiles.default;
    if (!profile) {
      setExportError(t('transfer.export.error'));
      return null;
    }
    return buildEnvelope(profile, options, {
      planId: newId('plan'),
      exportedAt: new Date().toISOString(),
    });
  };

  const exportPlan = async () => {
    const envelope = createEnvelope();
    if (!envelope) return;
    try {
      const shared = await shareEnvelope(envelope);
      if (!shared) setExportError(t('transfer.share.unavailable'));
    } catch {
      setExportError(t('transfer.export.error'));
    }
  };

  const showQrCode = () => {
    const envelope = createEnvelope();
    if (!envelope) return;
    try {
      setQrFrames(makeTransferQrFrames(envelope, newId('qr')));
      setQrFrameIndex(0);
    } catch {
      setExportError(t('transfer.qr.tooLarge'));
    }
  };

  const closeScanner = () => {
    setScanOpen(false);
    qrCollection.current = null;
    scanComplete.current = false;
    setScanCount(0);
    setScanTotal(0);
    setScanError('');
  };

  const startScanner = () => {
    qrCollection.current = null;
    scanComplete.current = false;
    setPending(null);
    setDone(null);
    setReadError('');
    setScanCount(0);
    setScanTotal(0);
    setScanError('');
    setScanOpen(true);
  };

  const handleQrScan = ({ data }: { data: string }) => {
    if (scanComplete.current) return;
    const frame = parseTransferQrFrame(data);
    if (!frame) return;
    let collection = qrCollection.current;
    if (!collection || collection.sessionId !== frame.sessionId) {
      collection = { sessionId: frame.sessionId, total: frame.total, frames: new Map() };
      qrCollection.current = collection;
      setScanCount(0);
      setScanTotal(frame.total);
      setScanError('');
    }
    if (collection.total !== frame.total || collection.frames.has(frame.index)) return;
    collection.frames.set(frame.index, frame.chunk);
    setScanCount(collection.frames.size);
    const serialized = assembleTransferQrFrames(collection.frames, collection.total);
    if (!serialized) return;

    scanComplete.current = true;
    try {
      const result = parseEnvelope(JSON.parse(serialized));
      if (!result.ok) {
        setScanError(result.reason);
        scanComplete.current = false;
        qrCollection.current = null;
        return;
      }
      setPending({ envelope: result.envelope, preview: previewImport(plan, result.envelope) });
      closeScanner();
    } catch {
      setScanError(t('transfer.qr.invalid'));
      scanComplete.current = false;
      qrCollection.current = null;
    }
  };

  const importPlan = async () => {
    setReadError('');
    setPending(null);
    setDone(null);
    setImporting(true);
    try {
      const picked = await pickPlanFile();
      if (picked.ok === 'cancelled') return;
      if (picked.ok) setPending({ envelope: picked.envelope, preview: previewImport(plan, picked.envelope) });
      else setReadError(picked.reason);
    } finally {
      setImporting(false);
    }
  };

  const applyImport = (mode: 'merge' | 'replace') => {
    if (!pending) return;
    const merged = mergeEnvelope(plan.doc, pending.envelope, mode);
    plan.replaceDoc(merged);
    setDone({
      added: pending.preview.added.length,
      conflicts: pending.preview.conflicts.length,
      skipped: pending.preview.skipped.length,
    });
    setPending(null);
  };

  const sectionLabel = (section: string): string => {
    const key = SECTION_NAME_KEYS[section];
    return key ? t(key) : section;
  };

  const reasonLabel = (reason: string): string => {
    const key = SKIPPED_REASON_KEYS[reason];
    return key ? t(key) : reason;
  };

  return <Page>
    <Row style={styles.chromeGap}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('transfer.eyebrow')}</Pill>
    </Row>

    <Header
      eyebrow={t('transfer.eyebrow')}
      title={t('transfer.title')}
      subtitle={t('transfer.subtitle')}
    />

    <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('transfer.export.title')}</Text>
      <Body style={{ fontSize: 12 }}>{t('transfer.export.body')}</Body>
      {OPTION_KEYS.map(row => <ToggleRow
        key={row.key}
        title={t(row.nameKey)}
        detail={t(row.detailKey)}
        value={options[row.key]}
        onPress={() => toggle(row.key)}
      />)}
      <Action title={t('transfer.export.create')} onPress={() => void exportPlan()} />
      <Action title={t('transfer.qr.show')} kind="secondary" onPress={showQrCode} />
      <Body style={{ fontSize: 11 }}>{t('transfer.export.warning')}</Body>
      <Body style={{ fontSize: 11 }}>{t('transfer.qr.note')}</Body>
      {exportError ? <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 12 }}>{exportError}</Text> : null}
    </Card>

    <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('transfer.import.title')}</Text>
      <Body style={{ fontSize: 12 }}>{t('transfer.import.body')}</Body>
      <Action title={importing ? t('transfer.import.reading') : t('transfer.import.choose')} kind="secondary" disabled={importing} onPress={() => void importPlan()} />
      <Action title={t('transfer.qr.scan')} kind="secondary" onPress={startScanner} />
      {readError ? <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 12 }}>{readError}</Text> : null}
      {done ? <Card style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
        <Text style={{ color: colors.tealDark, fontWeight: '800', fontSize: 15 }}>{t('transfer.import.done')}</Text>
        <Body style={{ color: colors.tealDark, fontSize: 12 }}>
          {t('transfer.import.done.body', { added: done.added, conflicts: done.conflicts, skipped: done.skipped })}
        </Body>
      </Card> : null}

      {pending ? <View style={{ gap: 12, marginTop: 6 }}>
        <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{t('transfer.preview.title')}</Text>
        <Body style={{ fontSize: 12 }}>{t('transfer.preview.exportedAt', { date: formatDate(pending.preview.exportedAt, locale) })}</Body>
        <PreviewList
          heading={t('transfer.preview.added', { count: pending.preview.added.length })}
          rows={pending.preview.added.map(row => t('transfer.preview.row', { section: sectionLabel(row.section), count: row.count }))}
          tone="green"
        />
        <PreviewList
          heading={t('transfer.preview.conflicts', { count: pending.preview.conflicts.length })}
          rows={pending.preview.conflicts.map(row => t('transfer.preview.row', { section: sectionLabel(row.section), count: row.count }))}
          tone="amber"
        />
        <PreviewList
          heading={t('transfer.preview.skipped', { count: pending.preview.skipped.length })}
          rows={pending.preview.skipped.map(row => `${sectionLabel(row.section)} — ${reasonLabel(row.reason)}`)}
          tone="blue"
        />
        <Row style={{ gap: 9 }}>
          <View style={{ flex: 1 }}><Action title={t('transfer.import.merge')} onPress={() => applyImport('merge')} /></View>
          <View style={{ flex: 1 }}><Action title={t('transfer.import.replace')} kind="secondary" onPress={() => applyImport('replace')} /></View>
        </Row>
        <Body style={{ fontSize: 11 }}>{t('transfer.preview.note')}</Body>
      </View> : null}
    </Card>

    <Card style={{ backgroundColor: colors.surfaceContainerLow }}>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('transfer.how.title')}</Text>
      <Body>{t('transfer.how.body')}</Body>
      <Body style={{ fontSize: 11 }}>{t('transfer.how.note')}</Body>
    </Card>

    <Modal visible={qrFrames !== null} animationType="slide" presentationStyle="fullScreen" onRequestClose={() => setQrFrames(null)}>
      <View style={styles.qrModal}>
        <Text style={[styles.heading, { color: colors.ink }]}>{t('transfer.qr.title')}</Text>
        <Body style={{ textAlign: 'center' }}>{t('transfer.qr.send.help')}</Body>
        {qrFrames?.length ? <>
          <View style={styles.qrCodeBox}>
            <QRCode value={qrFrames[qrFrameIndex]} size={270} ecl="M" quietZone={12} color={colors.ink} backgroundColor={colors.surface} />
          </View>
          <Text style={{ color: colors.ink, fontSize: 15, fontWeight: '700' }}>{t('transfer.qr.part', { current: qrFrameIndex + 1, total: qrFrames.length })}</Text>
          <Body style={{ textAlign: 'center' }}>{t('transfer.qr.send.keepOpen')}</Body>
        </> : null}
        <Body style={{ fontSize: 11, textAlign: 'center' }}>{t('transfer.qr.note')}</Body>
        <Action title={t('common.done')} kind="secondary" onPress={() => setQrFrames(null)} />
      </View>
    </Modal>

    <Modal visible={scanOpen} animationType="slide" presentationStyle="fullScreen" onRequestClose={closeScanner}>
      <View style={styles.scanModal}>
        <Text style={[styles.heading, { color: colors.ink }]}>{t('transfer.qr.scan.title')}</Text>
        <Body style={{ textAlign: 'center' }}>{t('transfer.qr.scan.help')}</Body>
        {!cameraPermission ? <Body>{t('transfer.qr.camera.loading')}</Body> : !cameraPermission.granted ? <View style={{ alignSelf: 'stretch', gap: 10 }}>
          <Body>{t('transfer.qr.camera.permission')}</Body>
          <Action title={t('transfer.qr.camera.allow')} onPress={() => void requestCameraPermission()} />
        </View> : scanOpen ? <View style={styles.cameraFrame}>
          <CameraView
            style={styles.camera}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={handleQrScan}
          />
        </View> : null}
        {scanTotal > 0 ? <Text accessibilityRole="text" accessibilityLiveRegion="polite" style={{ color: colors.ink, fontWeight: '700', textAlign: 'center' }}>
          {t('transfer.qr.scan.progress', { received: scanCount, total: scanTotal })}
        </Text> : null}
        {scanError ? <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 12, textAlign: 'center' }}>{scanError}</Text> : null}
        <Action title={t('common.cancel')} kind="secondary" onPress={closeScanner} />
      </View>
    </Modal>
  </Page>;
}

function PreviewList({ heading, rows, tone }: { heading: string; rows: string[]; tone: 'green' | 'amber' | 'blue' }) {
  const { colors } = useAppTheme();
  if (!rows.length) return null;
  return <View style={{ gap: 4 }}>
    <Row><Pill tone={tone}>{heading}</Pill></Row>
    {rows.map(row => <Text key={row} style={{ color: colors.onSurface, fontSize: 13 }}>• {row}</Text>)}
  </View>;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  chromeGap: { gap: 10 },
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { fontSize: 15, fontWeight: '700' },
  heading: { color: colors.onSurface, fontWeight: '800', fontSize: 17 },
  qrModal: { flex: 1, backgroundColor: colors.surface, padding: 22, alignItems: 'center', justifyContent: 'center', gap: 18 },
  qrCodeBox: { padding: 12, borderRadius: 18, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  scanModal: { flex: 1, backgroundColor: colors.surface, padding: 22, alignItems: 'center', justifyContent: 'center', gap: 18 },
  cameraFrame: { width: '100%', aspectRatio: 1, overflow: 'hidden', borderRadius: 20, backgroundColor: colors.outline },
  camera: { flex: 1 },
});

const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);
