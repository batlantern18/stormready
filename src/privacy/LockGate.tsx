import React, { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { LOCK_AFTER_MS, isFourDigits, pinSupported, pinsMatch, readPin } from './lock';
import { Body, Action } from '../ui';
import { useAppTheme } from '../theme';
import { useT } from '../i18n';

/**
 * F12b — the app-lock gate (R-WIP-11): with a PIN enabled, the app asks for
 * it on launch and after 5 minutes in the background. The gate is an
 * absolutely positioned, full-screen overlay: nothing underneath is
 * reachable until the PIN is entered. It is a device-local lock, not an
 * account, and the only remedy for a forgotten PIN is uninstalling the app.
 *
 * R-WIP-5: this gate never triggers a wipe — it only blocks interaction.
 */
export function LockGate({ children }: React.PropsWithChildren) {
  const { colors } = useAppTheme();
  const { t } = useT();
  const [pinKnown, setPinKnown] = useState(false);
  const [locked, setLocked] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState(false);
  const backgroundSince = useRef<number | null>(null);

  useEffect(() => {
    let active = true;
    readPin().then(value => {
      if (!active) return;
      setPinKnown(value !== null);
      setLocked(value !== null); // lock on launch while a PIN exists
    }).catch(() => {});
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (!pinSupported()) return;
      if (state === 'active') {
        const since = backgroundSince.current;
        backgroundSince.current = null;
        readPin().then(value => {
          const hasPin = value !== null;
          setPinKnown(hasPin);
          if (hasPin && since !== null && Date.now() - since >= LOCK_AFTER_MS) {
            setLocked(true);
            setDraft('');
          }
        }).catch(() => {});
      } else if (pinKnown) {
        backgroundSince.current = Date.now();
      }
    });
    return () => subscription.remove();
  }, [pinKnown]);

  if (!pinKnown || !locked) return <>{children}</>;

  const unlock = () => {
    readPin().then(stored => {
      if (pinsMatch(stored, draft)) {
        setLocked(false);
        setDraft('');
        setError(false);
      } else {
        setError(true);
        setDraft('');
      }
    }).catch(() => {
      setLocked(false); // the keystore failed — never a dead end
    });
  };

  return <>
    {children}
    <View accessibilityViewIsModal style={[styles.overlay, { backgroundColor: colors.surface }]} pointerEvents="auto">
      <View style={styles.sheet}>
        <Text maxFontSizeMultiplier={1.4} style={{ color: colors.onSurface, fontSize: 26, lineHeight: 33, fontWeight: '800', letterSpacing: -0.5 }}>
          {t('lock.title')}
        </Text>
        <Body>{t('lock.body')}</Body>
        <View accessibilityLabel={t('lock.pinLabel')} style={styles.dots}>
          {[0, 1, 2, 3].map(index => <View
            key={index}
            style={[styles.dot, { borderColor: colors.outline, backgroundColor: draft.length > index ? colors.primary : 'transparent' }]}
          />)}
        </View>
        <View style={styles.pad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => <LockKey key={digit} label={digit} colors={colors} onPress={() => { setDraft(value => (value + digit).slice(0, 4)); setError(false); }} />)}
          <View style={[styles.key, { opacity: 0 }]} />
          <LockKey label="0" colors={colors} onPress={() => { setDraft(value => (value + '0').slice(0, 4)); setError(false); }} />
          <LockKey label="⌫" colors={colors} onPress={() => setDraft(value => value.slice(0, -1))} />
        </View>
        {error ? <Text accessibilityRole="alert" style={{ color: colors.red, fontSize: 13, fontWeight: '600' }}>{t('lock.wrong')}</Text> : <Text style={{ color: colors.muted, fontSize: 13 }}>{t('lock.entered', { count: draft.length })}</Text>}
        <View style={styles.actions}>
          <Action title={t('lock.unlock')} disabled={!isFourDigits(draft)} onPress={unlock} />
        </View>
        <Body style={{ fontSize: 11, textAlign: 'center' }}>{t('lock.recovery')}</Body>
      </View>
    </View>
  </>;
}

function LockKey({ label, onPress, colors }: { label: string; onPress: () => void; colors: { primary: string; surfaceContainerHigh: string; onSurface: string } }) {
  const { t } = useT();
  const reducedLabel = label === '⌫' ? t('lock.delete') : label;
  return <Text
    accessibilityRole="button"
    accessibilityLabel={reducedLabel}
    onPress={onPress}
    maxFontSizeMultiplier={1.3}
    style={[styles.key, { backgroundColor: colors.surfaceContainerHigh, color: colors.onSurface }]}
  >
    {label}
  </Text>;
}

const styles = StyleSheet.create({
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', zIndex: 999, elevation: 999, padding: 24 },
  sheet: { width: '100%', maxWidth: 340, gap: 14, alignItems: 'center' },
  dots: { flexDirection: 'row', gap: 12, marginVertical: 4 },
  dot: { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5 },
  pad: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, justifyContent: 'center' },
  key: { width: 64, height: 56, borderRadius: 16, fontSize: 22, fontWeight: '700', textAlign: 'center', textAlignVertical: 'center', lineHeight: 54 },
  actions: { width: 220 },
});
