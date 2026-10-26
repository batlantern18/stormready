import { Tabs } from 'expo-router';
import { ColorValue, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../theme';

export default function TabLayout() {
  const { colors } = useAppTheme();
  return (
    <Tabs screenOptions={{
      headerShown: false,
      tabBarActiveTintColor: colors.tealDark,
      tabBarInactiveTintColor: colors.muted,
      tabBarStyle: { height: 80, paddingTop: 7, paddingBottom: 8, borderTopWidth: 1, borderTopColor: colors.outlineVariant, backgroundColor: colors.surfaceContainer, elevation: 0 },
      tabBarItemStyle: { marginHorizontal: 3, marginVertical: 3, borderRadius: 16, elevation: 0, shadowOpacity: 0 },
      tabBarActiveBackgroundColor: 'transparent',
      tabBarButton: props => {
        const { ref, ...buttonProps } = props;
        return <Pressable {...buttonProps} ref={ref as never} android_ripple={{ color: 'transparent' }} style={[props.style, styles.tabBarButton]} />;
      },
      tabBarLabelStyle: { fontSize: 11, fontWeight: '600', letterSpacing: 0.1 },
    }}>
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarAccessibilityLabel: 'Home', tabBarIcon: ({ color, focused }) => <TabIcon symbol="⌂" color={color} focused={focused} /> }} />
      <Tabs.Screen name="plan" options={{ title: 'Prepare', tabBarAccessibilityLabel: 'Prepare, your household plan', tabBarIcon: ({ color, focused }) => <TabIcon symbol="✓" color={color} focused={focused} /> }} />
      <Tabs.Screen name="map" options={{ title: 'Map', tabBarAccessibilityLabel: 'Map, shelters and your zone', tabBarIcon: ({ color, focused }) => <TabIcon symbol="⌖" color={color} focused={focused} /> }} />
      <Tabs.Screen name="updates" options={{ title: 'Updates', tabBarAccessibilityLabel: 'Updates, current weather and safety alerts', tabBarIcon: ({ color, focused }) => <TabIcon symbol="!" color={color} focused={focused} /> }} />
      <Tabs.Screen name="power" options={{ title: 'Power', tabBarAccessibilityLabel: 'Power, backup power planner', tabBarIcon: ({ color, focused }) => <TabIcon symbol="⏻" color={color} focused={focused} /> }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarAccessibilityLabel: 'Settings, privacy and reminders', tabBarIcon: ({ color, focused }) => <TabIcon symbol="⚙" color={color} focused={focused} /> }} />
    </Tabs>
  );
}

/**
 * The glyph is decorative: the tab already carries a title and an accessible
 * label, so the symbol is hidden from screen readers to avoid a double read.
 */
function TabIcon({ symbol, color, focused }: { symbol: string; color: ColorValue; focused: boolean }) {
  return <View
    accessibilityElementsHidden
    importantForAccessibility="no-hide-descendants"
    style={[styles.iconIndicator, focused && styles.iconIndicatorActive]}
  >
    <Text style={{ color, fontSize: 21, lineHeight: 24, fontWeight: '600' }}>{symbol}</Text>
  </View>;
}

const styles = StyleSheet.create({
  tabBarButton: { backgroundColor: 'transparent', borderWidth: 0, outlineWidth: 0, outlineColor: 'transparent', elevation: 0, shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0, minHeight: 44, justifyContent: 'center' },
  iconIndicator: { width: 60, height: 36, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  iconIndicatorActive: { backgroundColor: 'transparent' },
});
