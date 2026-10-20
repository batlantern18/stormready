import { Stack, Redirect, useSegments } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { ActivityIndicator, AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { configureNotificationHandler } from '../notifications/channels';
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

  return <>
    <ThemedStatusBar />
    <StorageBanner />
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="kit" options={{ presentation: 'modal' }} />
    </Stack>
  </>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <ThemeProvider>
          <PlanProvider>
            <AppShell />
          </PlanProvider>
        </ThemeProvider>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
