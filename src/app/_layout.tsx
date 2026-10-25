import { Stack, Redirect, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { configureNotificationHandler } from '../notifications/channels';
import { I18nProvider } from '../i18n';
import { LockGate } from '../privacy/LockGate';
import { PlanProvider, usePlan } from '../plan';
import { StorageBanner } from '../storage/StorageBanner';
import { flushAll } from '../storage/store';
import { ThemeProvider, useAppTheme } from '../theme';

function ThemedStatusBar() {
  const { dark } = useAppTheme();
  return <StatusBar style={dark ? 'light' : 'dark'} />;
}

function AppShell() {
  const plan = usePlan();
  const segments = useSegments();
  const { colors } = useAppTheme();

  useEffect(() => {
    configureNotificationHandler();
    // Make sure a debounced write is not lost when the app leaves the foreground.
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') void flushAll();
    });
    return () => subscription.remove();
  }, []);

  if (!plan.ready) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.surface }}>
      <ActivityIndicator color={colors.primary} />
    </View>;
  }

  if (!plan.onboarded && segments[0] !== 'onboarding') {
    return <>
      <StorageBanner />
      <Redirect href="/onboarding/welcome" />
    </>;
  }

  return <LockGate>
    <ThemedStatusBar />
    <StorageBanner />
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="kit" options={{ presentation: 'modal' }} />
      <Stack.Screen name="readiness" />
      <Stack.Screen name="inventory" />
      <Stack.Screen name="go-bags" />
      <Stack.Screen name="go-bags/[id]" />
      <Stack.Screen name="medical" />
      <Stack.Screen name="communication" />
      <Stack.Screen name="drill" />
      <Stack.Screen name="drill/[id]" />
      <Stack.Screen name="settings/privacy" />
      <Stack.Screen name="settings/transfer" />
      <Stack.Screen name="settings/language" />
    </Stack>
  </LockGate>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider>
          {/* I18nProvider sits inside ThemeProvider (it reads the locale
              preference) and above every screen that calls useT(). */}
          <I18nProvider>
            <PlanProvider>
              <AppShell />
            </PlanProvider>
          </I18nProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
