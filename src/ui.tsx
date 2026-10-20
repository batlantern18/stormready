import React from 'react';
import Animated, { ReduceMotion, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, TextStyle, View, ViewStyle, type PressableProps, type PressableStateCallbackType } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { darkColors, lightColors, type Palette, useAppTheme } from './theme';

export function Page({ children, scroll = true }: React.PropsWithChildren<{ scroll?: boolean }>) {
  const { dark } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  return <SafeAreaView style={s.safe} edges={['top']}>
    {scroll
      ? <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={s.page} showsVerticalScrollIndicator={false}>{children}</ScrollView>
      : <View style={{ flex: 1 }}>{children}</View>}
  </SafeAreaView>;
}

export function Header({ eyebrow, title, subtitle }: { eyebrow?: string; title: string; subtitle?: string }) {
  const { dark } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  return <View style={s.header}>
    {eyebrow ? <Text style={s.eyebrow}>{eyebrow.toUpperCase()}</Text> : null}
    <Text style={s.title}>{title}</Text>
    {subtitle ? <Text style={s.subtitle}>{subtitle}</Text> : null}
  </View>;
}

export function Card({ children, style }: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  const { dark } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  return <View style={[s.card, style]}>{children}</View>;
}

export function Label({ children, style }: React.PropsWithChildren<{ style?: StyleProp<TextStyle> }>) {
  const { dark } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  return <Text style={[s.label, style]}>{children}</Text>;
}

export function Body({ children, style }: React.PropsWithChildren<{ style?: StyleProp<TextStyle> }>) {
  const { dark } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  return <Text style={[s.body, style]}>{children}</Text>;
}

export function Field({ label, value, onChangeText, placeholder, keyboardType, multiline }: {
  label: string; value: string; onChangeText: (v: string) => void; placeholder?: string;
  keyboardType?: 'default' | 'numeric' | 'phone-pad'; multiline?: boolean;
}) {
  const { dark, colors } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  return <View style={s.fieldGroup}>
    <Text style={s.label}>{label}</Text>
    <TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} placeholderTextColor={colors.onSurfaceVariant}
      keyboardType={keyboardType} multiline={multiline}
      style={[s.input, multiline && { minHeight: 88, textAlignVertical: 'top' }]} />
  </View>;
}

export function Action({ title, onPress, kind = 'primary', small = false }: {
  title: string; onPress: () => void; kind?: 'primary' | 'secondary' | 'quiet'; small?: boolean;
}) {
  const { dark } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const reducedMotion = useReducedMotion();
  const pressIn = () => { if (!reducedMotion) scale.set(withTiming(0.975, { duration: 110, reduceMotion: ReduceMotion.System })); };
  const pressOut = () => { if (!reducedMotion) scale.set(withTiming(1, { duration: 110, reduceMotion: ReduceMotion.System })); };
  return <Animated.View style={animatedStyle}>
    <Pressable accessibilityRole="button" onPress={onPress} onPressIn={pressIn} onPressOut={pressOut}
      android_ripple={kind === 'primary' ? { color: 'rgba(255,255,255,0.18)' } : { color: 'rgba(0,107,94,0.10)' }}
      style={[s.action, kind === 'primary' ? s.primary : kind === 'secondary' ? s.secondary : s.quiet, small && s.actionSmall]}>
      <Text style={[s.actionText, kind !== 'primary' && s.actionTextTonal, small && s.actionTextSmall]}>{title}</Text>
    </Pressable>
  </Animated.View>;
}

export function Pill({ children, tone = 'green', maxFontSizeMultiplier }: React.PropsWithChildren<{ tone?: 'green' | 'amber' | 'blue'; maxFontSizeMultiplier?: number }>) {
  const { dark, colors } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  const container = tone === 'amber' ? colors.warningContainer : tone === 'blue' ? colors.tertiaryContainer : colors.primaryContainer;
  const foreground = tone === 'amber' ? colors.warning : tone === 'blue' ? colors.tertiary : colors.primary;
  return <View style={[s.pill, { backgroundColor: container }]}><Text maxFontSizeMultiplier={maxFontSizeMultiplier} style={[s.pillText, { color: foreground }]}>{children}</Text></View>;
}

/**
 * A progress bar that announces its value to a screen reader. The bar holds no
 * text, so a large system font cannot clip inside the fixed-height track.
 */
export function ProgressBar({ value, max, label, tint, track }: {
  value: number;
  max: number;
  label: string;
  tint?: string;
  track?: string;
}) {
  const { colors } = useAppTheme();
  const percent = max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0;
  return <View
    accessibilityRole="progressbar"
    accessibilityLabel={label}
    accessibilityValue={{ min: 0, max, now: value }}
    style={[sharedStyles.progressTrack, { backgroundColor: track ?? 'rgba(255,255,255,0.20)' }]}
  >
    <View style={[sharedStyles.progressFill, { width: `${percent}%`, backgroundColor: tint ?? colors.primaryContainer }]} />
  </View>;
}

export function Row({ children, style }: React.PropsWithChildren<{ style?: StyleProp<ViewStyle> }>) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, style]}>{children}</View>;
}

export function ToggleRow({ title, detail, value, onPress, disabled }: {
  title: string;
  detail?: string;
  value: boolean;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { dark, colors } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  return <Pressable
    accessibilityRole="switch"
    accessibilityLabel={title}
    accessibilityState={{ checked: value, disabled }}
    disabled={disabled}
    onPress={onPress}
    style={({ pressed }) => [s.toggleRow, pressed && { opacity: 0.82 }, disabled && { opacity: 0.5 }]}
  >
    <View style={{ flex: 1, gap: 3 }}>
      <Text style={s.label}>{title}</Text>
      {detail ? <Text style={s.toggleDetail}>{detail}</Text> : null}
    </View>
    <View style={[s.switchTrack, { backgroundColor: value ? colors.primary : colors.surfaceContainerHighest, borderColor: value ? colors.primary : colors.outline }]}>
      <View style={[s.switchThumb, { backgroundColor: value ? colors.onPrimary : colors.onSurfaceVariant, transform: [{ translateX: value ? 20 : 0 }] }]} />
    </View>
  </Pressable>;
}

export function Stepper({ label, detail, value, min, max, onChange }: {
  label: string;
  detail?: string;
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  const { dark } = useAppTheme();
  const s = dark ? darkStyles : lightStyles;
  return <View style={s.stepper}>
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={s.stepperLabel}>{label}</Text>
      {detail ? <Text style={s.stepperDetail}>{detail}</Text> : null}
    </View>
    <View style={s.stepperControls}>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`Decrease ${label}`}
        accessibilityState={{ disabled: value <= min }}
        disabled={value <= min}
        onPress={() => onChange(Math.max(min, value - 1))}
        style={[s.stepperButton, value <= min && s.stepperButtonDisabled]}
      >
        <Text style={s.stepperSymbol}>−</Text>
      </MotionPressable>
      <Text accessibilityLabel={`${label}: ${value}`} style={s.stepperValue}>{value}</Text>
      <MotionPressable
        accessibilityRole="button"
        accessibilityLabel={`Increase ${label}`}
        accessibilityState={{ disabled: value >= max }}
        disabled={value >= max}
        onPress={() => onChange(Math.min(max, value + 1))}
        style={[s.stepperButton, value >= max && s.stepperButtonDisabled]}
      >
        <Text style={s.stepperSymbol}>+</Text>
      </MotionPressable>
    </View>
  </View>;
}

const createStyles = (colors: Palette) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.surface },
  page: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 120, gap: 16 },
  header: { gap: 9, marginBottom: 3 },
  eyebrow: { fontSize: 12, lineHeight: 16, letterSpacing: 0.7, fontWeight: '700', color: colors.primary },
  title: { fontSize: 32, letterSpacing: -0.8, fontWeight: '700', color: colors.onSurface, lineHeight: 39 },
  subtitle: { color: colors.onSurfaceVariant, fontSize: 16, lineHeight: 23, maxWidth: 390 },
  card: { backgroundColor: colors.surfaceContainerLowest, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: colors.outlineVariant, gap: 16, shadowColor: '#12251F', shadowOpacity: 0.045, shadowRadius: 5, shadowOffset: { width: 0, height: 2 }, elevation: 1 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600', color: colors.onSurface },
  body: { color: colors.onSurfaceVariant, fontSize: 14, lineHeight: 21 },
  fieldGroup: { gap: 8, marginBottom: 14 },
  input: { borderWidth: 1, borderColor: colors.outline, borderRadius: 12, backgroundColor: colors.surfaceContainerHighest, minHeight: 56, paddingHorizontal: 16, paddingVertical: 14, color: colors.onSurface, fontSize: 16 },
  action: { minHeight: 48, paddingHorizontal: 22, paddingVertical: 13, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  primary: { backgroundColor: colors.primary },
  secondary: { backgroundColor: colors.secondaryContainer },
  quiet: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.outline },
  actionSmall: { minHeight: 44, paddingVertical: 9, paddingHorizontal: 16, borderRadius: 12 },
  actionText: { fontSize: 14, lineHeight: 20, fontWeight: '600', letterSpacing: 0.1, color: colors.onPrimary },
  actionTextTonal: { color: colors.onSecondaryContainer },
  actionTextSmall: { fontSize: 13 },
  pill: { minHeight: 28, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5, alignSelf: 'flex-start', justifyContent: 'center' },
  progressTrack: { height: 7, borderRadius: 8, overflow: 'hidden' },
  progressFill: { height: 7, borderRadius: 8 },
  pillText: { fontSize: 11, lineHeight: 16, fontWeight: '700', letterSpacing: 0.2 },
  toggleRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 8 },
  toggleDetail: { color: colors.onSurfaceVariant, fontSize: 12, lineHeight: 17 },
  switchTrack: { width: 46, height: 28, borderRadius: 14, borderWidth: 1, padding: 3, justifyContent: 'center' },
  switchThumb: { width: 20, height: 20, borderRadius: 10 },
  stepper: { minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
  stepperLabel: { color: colors.onSurface, fontSize: 14, fontWeight: '600' },
  stepperDetail: { color: colors.onSurfaceVariant, fontSize: 12, lineHeight: 17 },
  stepperControls: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepperButton: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surfaceContainerHigh, borderWidth: 1, borderColor: colors.outlineVariant },
  stepperButtonDisabled: { opacity: 0.4 },
  stepperSymbol: { color: colors.primary, fontSize: 22, lineHeight: 25, fontWeight: '700' },
  stepperValue: { minWidth: 38, textAlign: 'center', color: colors.onSurface, fontSize: 18, fontWeight: '800' },
});
const sharedStyles = StyleSheet.create({
  progressTrack: { height: 7, borderRadius: 8, overflow: 'hidden' },
  progressFill: { height: 7, borderRadius: 8 },
});

const lightStyles = createStyles(lightColors);
const darkStyles = createStyles(darkColors as Palette);

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

/** Shared, reduced-motion-aware tactile feedback for custom app controls. */
export function MotionPressable({ onPressIn, onPressOut, style, ...props }: PressableProps) {
  const reducedMotion = useReducedMotion();
  const scale = useSharedValue(1);
  const animatedStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const pressIn = (event: Parameters<NonNullable<PressableProps['onPressIn']>>[0]) => {
    if (!reducedMotion && !props.disabled) scale.set(withTiming(0.97, { duration: 120, reduceMotion: ReduceMotion.System }));
    onPressIn?.(event);
  };
  const pressOut = (event: Parameters<NonNullable<PressableProps['onPressOut']>>[0]) => {
    if (!reducedMotion) scale.set(withTiming(1, { duration: 120, reduceMotion: ReduceMotion.System }));
    onPressOut?.(event);
  };
  return <AnimatedPressable
    {...props}
    onPressIn={pressIn}
    onPressOut={pressOut}
    style={(state: PressableStateCallbackType) => [typeof style === 'function' ? style(state) : style, animatedStyle]}
  />;
}
