import React, { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { privacyDescriptorList } from '../../storage/wipe';
import { clearPin, isFourDigits, pinSupported, readPin, writePin } from '../../privacy/lock';
import { usePlan } from '../../plan';
import { Action, Body, Card, Field, Header, MotionPressable, Page, Pill, Row } from '../../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../../theme';
import { useT } from '../../i18n';

const WIPE_CONFIRMATION = 'DELETE';

/**
 * F12b — the plain-language privacy screen: what is stored (generated from
 * `keys.ts` so the two cannot drift, R-WIP-4), the optional device-local PIN
 * (R-WIP-3), and the two-step "Delete all my data" flow (R-WIP-1/2).
 */
export default function Privacy() {
  const plan = usePlan();
  const router = useRouter();
  const { colors, dark } = useAppTheme();
  const { t } = useT();
  const styles = dark ? darkStyles : lightStyles;

  const [pin, setPin] = useState(false);
  const [pinBusy, setPinBusy] = useState(false);
  const [pinStep, setPinStep] = useState<'off' | 'enter' | 'confirm'>('off');
  const [firstPin, setFirstPin] = useState('');
  const [draftPin, setDraftPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [wipeStep, setWipeStep] = useState<'off' | 'warn' | 'type'>('off');
  const [typed, setTyped] = useState('');
  const [wipeError, setWipeError] = useState('');

  useEffect(() => {
    let active = true;
    readPin().then(value => {
      if (active) setPin(value !== null);
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  const descriptors = privacyDescriptorList();

  const enablePin = async () => {
    if (!isFourDigits(draftPin)) {
      setPinError(t('privacy.pin.invalid'));
      return;
    }
    if (pinStep === 'enter') {
      setFirstPin(draftPin);
      setDraftPin('');
      setPinError('');
      setPinStep('confirm');
      return;
    }
    if (draftPin !== firstPin) {
      setPinError(t('privacy.pin.mismatch'));
      setDraftPin('');
      return;
    }
    setPinBusy(true);
    try {
      await writePin(draftPin);
      setPin(true);
      setPinStep('off');
      setFirstPin('');
      setDraftPin('');
      setPinError('');
    } catch {
      setPinError(t('privacy.pin.unavailable'));
    } finally {
      setPinBusy(false);
    }
  };

  const disablePin = async () => {
    setPinBusy(true);
    try {
      await clearPin();
      setPin(false);
      setPinStep('off');
      setDraftPin('');
    } finally {
      setPinBusy(false);
    }
  };

  const confirmWipe = () => {
    if (typed.trim() !== WIPE_CONFIRMATION) {
      setWipeError(t('privacy.wipe.type.error', { word: WIPE_CONFIRMATION }));
      return;
    }
    setWipeStep('off');
    setTyped('');
    setWipeError('');
    void plan.wipeAll();
    // R-WIP-2: the provider dispatches to a fresh, non-onboarded document, and
    // the root layout redirects to onboarding on the next render.
  };

  return <Page>
    <Row style={styles.chromeGap}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('privacy.eyebrow')}</Pill>
    </Row>

    <Header
      eyebrow={t('privacy.eyebrow')}
      title={t('privacy.title')}
      subtitle={t('privacy.subtitle')}
    />

    <Card style={{ backgroundColor: colors.mint, borderColor: colors.mint }}>
      <Text style={{ color: colors.tealDark, fontWeight: '800', fontSize: 17 }}>{t('privacy.principle.title')}</Text>
      <Body style={{ color: colors.tealDark }}>{t('privacy.principle.body')}</Body>
    </Card>

    <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('privacy.stored.title')}</Text>
      <Body style={{ fontSize: 12 }}>{t('privacy.stored.body')}</Body>
      {descriptors.map((descriptor, index) => <View key={descriptor.key} style={[styles.lineRow, index > 0 && { borderTopColor: colors.outlineVariant }]}>
        <Row style={{ gap: 8 }}>
          <Text style={{ flex: 1, color: colors.ink, fontWeight: '700', fontSize: 14 }}>{descriptor.title}</Text>
          {descriptor.sensitive ? <Pill tone="amber">{t('privacy.stored.sensitive')}</Pill> : null}
        </Row>
        <Body style={{ fontSize: 12 }}>{descriptor.description}</Body>
      </View>)}
    </Card>

    <Card>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('privacy.lock.title')}</Text>
          <Body style={{ fontSize: 12 }}>{t('privacy.lock.body')}</Body>
        </View>
        {!pinSupported() ? <Pill tone="blue">{t('privacy.lock.unavailable')}</Pill> : <Pill tone={pin ? 'green' : 'blue'}>{pin ? t('privacy.lock.on') : t('privacy.lock.off')}</Pill>}
      </Row>
      {pinSupported() && !pin && pinStep === 'off' ? <Action title={t('privacy.lock.enable')} kind="secondary" disabled={pinBusy} onPress={() => { setPinStep('enter'); setDraftPin(''); setPinError(''); }} /> : null}
      {pin && pinStep === 'off' ? <>
        <Body style={{ fontSize: 12 }}>{t('privacy.lock.on.body')}</Body>
        <Action title={t('privacy.lock.disable')} kind="quiet" disabled={pinBusy} onPress={() => void disablePin()} />
      </> : null}
      {pinStep !== 'off' ? <>
        <Field
          label={pinStep === 'enter' ? t('privacy.pin.choose') : t('privacy.pin.repeat')}
          value={draftPin}
          onChangeText={value => setDraftPin(value.replace(/\D/g, '').slice(0, 4))}
          placeholder="••••"
        />
        {pinError ? <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 12 }}>{pinError}</Text> : null}
        <Action title={pinStep === 'enter' ? t('privacy.pin.next') : t('privacy.pin.save')} disabled={pinBusy} onPress={() => void enablePin()} />
        <Body style={{ fontSize: 11 }}>{t('privacy.pin.note')}</Body>
      </> : null}
      <Body style={{ fontSize: 11 }}>{t('privacy.lock.recovery')}</Body>
    </Card>

    <Card>
      <Text style={[styles.heading, dark && { color: colors.ink }]}>{t('privacy.authorities.title')}</Text>
      <Body>{t('privacy.authorities.body')}</Body>
      <Action title="Ready.gov ↗" kind="secondary" small onPress={() => void Linking.openURL('https://www.ready.gov/').catch(() => {})} />
      <Action title="Protección Civil ↗" kind="secondary" small onPress={() => void Linking.openURL('https://www.gob.mx/proteccioncivil').catch(() => {})} />
      <Body style={{ fontSize: 11 }}>{t('privacy.authorities.note')}</Body>
    </Card>

    <Card style={{ backgroundColor: colors.amberBg, borderColor: colors.amberBg }}>
      <Row><Pill tone="amber">{t('privacy.wipe.tag')}</Pill></Row>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 17 }}>{t('privacy.wipe.title')}</Text>
      {wipeStep === 'off' ? <>
        <Body style={{ fontSize: 12 }}>{t('privacy.wipe.body')}</Body>
        <Action title={t('privacy.wipe.action')} onPress={() => { setWipeStep('warn'); setTyped(''); }} />
      </> : wipeStep === 'warn' ? <>
        <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 15 }}>{t('privacy.wipe.warn.title')}</Text>
        <Body style={{ fontSize: 12 }}>{t('privacy.wipe.warn.body')}</Body>
        {descriptors.map(descriptor => <Text key={descriptor.key} style={{ color: colors.ink, fontSize: 13 }}>• {descriptor.title}</Text>)}
        <Body style={{ fontSize: 12 }}>{t('privacy.wipe.warn.extra')}</Body>
        <Row style={{ gap: 9 }}>
          <View style={{ flex: 1 }}><Action title={t('privacy.wipe.next')} kind="primary" onPress={() => setWipeStep('type')} /></View>
          <View style={{ flex: 1 }}><Action title={t('common.cancel')} kind="quiet" onPress={() => setWipeStep('off')} /></View>
        </Row>
      </> : <>
        <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 15 }}>{t('privacy.wipe.type.title')}</Text>
        <Field label={t('privacy.wipe.type')} value={typed} onChangeText={value => { setTyped(value); setWipeError(''); }} placeholder={WIPE_CONFIRMATION} />
        {wipeError ? <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 12 }}>{wipeError}</Text> : null}
        <Action title={t('privacy.wipe.confirm')} onPress={confirmWipe} />
        <Body style={{ fontSize: 11 }}>{t('privacy.wipe.type.note')}</Body>
      </>}
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
