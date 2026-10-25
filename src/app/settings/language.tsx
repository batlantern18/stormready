import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import type { LocalePreference } from '../../storage/keys';
import { Body, Card, Header, MotionPressable, Page, Pill, Row } from '../../ui';
import { darkColors, lightColors, type Palette, useAppTheme } from '../../theme';
import { useT, type TranslationKey } from '../../i18n';
import { formatDate } from '../../i18n/format';

const CHOICES: { value: LocalePreference; labelKey: TranslationKey; detailKey: TranslationKey }[] = [
  { value: 'system', labelKey: 'language.system', detailKey: 'language.system.detail' },
  { value: 'en', labelKey: 'language.en', detailKey: 'language.en.detail' },
  { value: 'es', labelKey: 'language.es', detailKey: 'language.es.detail' },
];

/**
 * F10 — the language screen. Choosing applies immediately (no restart — the
 * locale context re-renders every mounted screen) and is stored in the
 * existing theme document (R-L10-3).
 */
export default function Language() {
  const router = useRouter();
  const { dark, colors, locale, setLocale } = useAppTheme();
  const { t } = useT();
  const styles = dark ? darkStyles : lightStyles;

  return <Page>
    <Row style={styles.chromeGap}>
      <MotionPressable accessibilityRole="button" accessibilityLabel={t('common.back')} onPress={() => router.back()} style={styles.back}>
        <Text style={[styles.backText, { color: colors.primary }]}>← {t('common.back')}</Text>
      </MotionPressable>
      <View style={{ flex: 1 }} />
      <Pill tone="blue">{t('language.eyebrow')}</Pill>
    </Row>

    <Header
      eyebrow={t('language.eyebrow')}
      title={t('language.title')}
      subtitle={t('language.subtitle')}
    />

    <Card>
      <Body style={{ fontSize: 12 }}>{t('language.body')}</Body>
      {CHOICES.map(choice => <Row key={choice.value} style={[styles.choice, { borderTopColor: colors.outlineVariant }]}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text
            accessibilityRole="radio"
            accessibilityState={{ selected: locale === choice.value }}
            onPress={() => setLocale(choice.value)}
            style={{ color: colors.ink, fontWeight: locale === choice.value ? '800' : '600', fontSize: 15 }}
          >
            {locale === choice.value ? '◉ ' : '○ '}{t(choice.labelKey)}
          </Text>
          <Body style={{ fontSize: 12 }}>{t(choice.detailKey)}</Body>
        </View>
        {locale === choice.value ? <Pill tone="green">{t('language.current')}</Pill> : null}
      </Row>)}
    </Card>

    <Card style={{ backgroundColor: colors.sand, borderColor: colors.sand }}>
      <Text style={{ color: colors.ink, fontWeight: '800', fontSize: 16 }}>{t('language.dates.title')}</Text>
      <Body style={{ fontSize: 12 }}>{t('language.dates.body')}</Body>
      <Body style={{ fontSize: 12 }}>{t('language.dates.example', { en: formatDate('2026-03-03', 'en'), es: formatDate('2026-03-03', 'es') })}</Body>
      <Body style={{ fontSize: 11 }}>{t('language.dates.note')}</Body>
    </Card>

    <Card style={{ backgroundColor: colors.surfaceContainerLow }}>
      <Body style={{ fontSize: 12 }}>{t('language.scope')}</Body>
      <Body style={{ fontSize: 11 }}>{t('language.scope.note')}</Body>
    </Card>
  </Page>;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  chromeGap: { gap: 10 },
  back: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  backText: { fontSize: 15, fontWeight: '700' },
  choice: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, marginTop: 4, paddingBottom: 6 },
});

const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);
