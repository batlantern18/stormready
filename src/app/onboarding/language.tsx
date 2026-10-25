import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { OnboardingPage } from '../../onboarding/ui';
import { Action, Body, Card, Pill, Row } from '../../ui';
import { useAppTheme } from '../../theme';
import { useT, type TranslationKey } from '../../i18n';

const OPTIONS: { value: 'en' | 'es'; titleLabelKey: TranslationKey; noteLabelKey: TranslationKey }[] = [
  { value: 'en', titleLabelKey: 'onboarding.language.en.title', noteLabelKey: 'onboarding.language.en.note' },
  { value: 'es', titleLabelKey: 'onboarding.language.es.title', noteLabelKey: 'onboarding.language.es.note' },
];

/**
 * F10 — the first-run language prompt. It appears during onboarding when the
 * system locale is Spanish, so a Mexican user never has to find the setting.
 * The choice applies immediately (no restart) and can change later in
 * Settings → Language.
 */
export default function LanguageStep() {
  const router = useRouter();
  const { colors, setLocale, locale } = useAppTheme();
  const { t } = useT();

  const choose = (value: 'en' | 'es') => {
    setLocale(value);
    router.replace('/onboarding/household');
  };

  return <OnboardingPage
    step={1}
    eyebrow={t('onboarding.language.eyebrow')}
    title={t('onboarding.language.title')}
    subtitle={t('onboarding.language.subtitle')}
    footer={<Body style={styles.footerNote}>{t('onboarding.language.footer')}</Body>}
  >
    <Card style={{ backgroundColor: colors.navy, borderColor: colors.navy }}>
      <Row style={{ alignItems: 'flex-start' }}>
        <View style={{ flex: 1, gap: 5 }}>
          <Text style={styles.cardTitle}>{t('onboarding.language.card.title')}</Text>
          <Text style={styles.cardSubtitle}>{t('onboarding.language.card.subtitle')}</Text>
        </View>
        <Pill tone="green">SAVED ON DEVICE</Pill>
      </Row>
      <Body style={{ color: '#C3D7CE' }}>{t('onboarding.language.card.body')}</Body>
    </Card>

    <View style={{ gap: 10 }}>
      {OPTIONS.map(option => <Row
        key={option.value}
        style={[styles.choice, { borderColor: colors.outlineVariant, backgroundColor: colors.surfaceContainerLowest }]}
      >
        <View style={{ flex: 1, gap: 3 }}>
          <Text style={[styles.choiceTitle, { color: colors.onSurface, fontWeight: '700', fontSize: 15 }]}>{t(option.titleLabelKey)}</Text>
          <Text style={[styles.choiceDetail, { color: colors.onSurfaceVariant }]}>{t(option.noteLabelKey)}</Text>
        </View>
        <Action
          title={option.value === 'es' ? 'Elegir español' : 'Choose English'}
          kind="secondary"
          small
          disabled={locale === option.value}
          onPress={() => choose(option.value)}
        />
      </Row>)}
    </View>
  </OnboardingPage>;
}

const styles = StyleSheet.create({
  cardTitle: { color: '#FFFFFF', fontSize: 20, fontWeight: '800', letterSpacing: -0.3 },
  cardSubtitle: { color: '#B5F1E4', fontSize: 12 },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 16, borderWidth: 1 },
  choiceTitle: { fontSize: 14 },
  choiceDetail: { fontSize: 12 },
  footerNote: { fontSize: 12, textAlign: 'center' },
});
