import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { clearStorageIssues, getStorageIssues, subscribeStorageIssues, type StorageIssue } from './store';
import { useAppTheme } from '../theme';

/**
 * Non-blocking notice shown when a stored document was corrupt or newer than
 * this build. The app continues with defaults instead of failing to launch.
 */
export function StorageBanner() {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [issues, setIssues] = useState<StorageIssue[]>(getStorageIssues);

  useEffect(() => subscribeStorageIssues(setIssues), []);

  if (!issues.length) return null;
  const issue = issues[0];
  return <View pointerEvents="box-none" style={[styles.wrap, { top: insets.top + 6 }]}>
    <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: colors.warningContainer, borderColor: colors.warning }]}>
      <Text style={[styles.title, { color: colors.warning }]}>Saved data needs attention</Text>
      <Text style={[styles.message, { color: colors.onSurface }]}>{issue.message}</Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss saved data notice"
        onPress={() => clearStorageIssues()}
        style={[styles.dismiss, { borderColor: colors.warning }]}
      >
        <Text style={[styles.dismissText, { color: colors.warning }]}>Dismiss</Text>
      </Pressable>
    </View>
  </View>;
}

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 12, right: 12, zIndex: 100 },
  banner: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 5, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 6 },
  title: { fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  message: { fontSize: 12, lineHeight: 17 },
  dismiss: { minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', marginTop: 3, borderWidth: 1, borderRadius: 9, paddingHorizontal: 10, paddingVertical: 5 },
  dismissText: { fontSize: 11, fontWeight: '700' },
});
