import React from 'react';
import { Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, type Href } from 'expo-router';
import { usePlan } from '../plan';
import { darkColors, lightColors, useAppTheme, type Palette } from '../theme';
import { MotionPressable } from '../ui';

/** Marks onboarding complete before leaving the flow. */
export function useOnboardingFinish() {
  const plan = usePlan();
  const router = useRouter();
  return (href: Href = '/(tabs)') => {
    plan.completeOnboarding();
    // Let the provider commit before the root layout evaluates the redirect.
    setTimeout(() => router.replace(href), 0);
  };
}

export function OnboardingPage({ step, eyebrow, title, subtitle, children, footer }: React.PropsWithChildren<{
  step: 1 | 2 | 3 | 4;
  eyebrow: string;
  title: string;
  subtitle?: string;
  footer?: React.ReactNode;
}>) {
  const { dark } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  const finish = useOnboardingFinish();
  return <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
    <View style={s.topbar}>
      <View style={s.progress} accessibilityLabel={`Step ${step} of 4`}>
        {[1, 2, 3, 4].map(index => <View key={index} style={[s.dot, index <= step && s.dotActive]} />)}
        <Text style={s.stepText}>STEP {step} OF 4</Text>
      </View>
      <MotionPressable accessibilityRole="button" accessibilityLabel="Skip onboarding" onPress={() => finish('/(tabs)')} style={s.skip}>
        <Text style={s.skipText}>Skip for now</Text>
      </MotionPressable>
    </View>
    <ScrollView
      keyboardShouldPersistTaps="handled"
      showsVerticalScrollIndicator={false}
      contentContainerStyle={s.scroll}
    >
      <View style={s.content}>
        <Text style={s.eyebrow}>{eyebrow.toUpperCase()}</Text>
        <Text style={s.title}>{title}</Text>
        {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
        {children}
      </View>
    </ScrollView>
    {footer ? <View style={s.footer}>{footer}</View> : null}
  </SafeAreaView>;
}

export function FormError({ children }: React.PropsWithChildren) {
  const { dark } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  return <Text accessibilityRole="alert" style={s.error}>{children}</Text>;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  topbar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.outlineVariant },
  progress: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 18, height: 4, borderRadius: 2, backgroundColor: colors.outlineVariant },
  dotActive: { backgroundColor: colors.primary },
  stepText: { marginLeft: 5, color: colors.onSurfaceVariant, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  skip: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  skipText: { color: colors.primary, fontSize: 13, fontWeight: '700' },
  scroll: { paddingHorizontal: 20, paddingTop: 24, paddingBottom: 28 },
  content: { gap: 16, maxWidth: 520, width: '100%', alignSelf: 'center' },
  eyebrow: { color: colors.primary, fontSize: 11, fontWeight: '800', letterSpacing: 1.1 },
  title: { color: colors.onSurface, fontSize: 31, lineHeight: 37, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: colors.onSurfaceVariant, fontSize: 16, lineHeight: 23 },
  footer: { gap: 9, paddingHorizontal: 20, paddingTop: 12, paddingBottom: Platform.OS === 'android' ? 14 : 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.outlineVariant, backgroundColor: colors.surface },
  error: { color: colors.error, fontSize: 12, lineHeight: 17 },
});

const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);
