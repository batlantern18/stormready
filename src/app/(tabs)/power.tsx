import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { WebView } from 'react-native-webview';

import { POWERPLAN_HTML } from './powerplan-html';

/**
 * PowerPlan is embedded as a fully self-contained HTML bundle (all JS/CSS
 * inlined at build time — see powerplan-html.ts), so it works offline with no
 * dev server and no network requests.
 */
export default function PowerPlanScreen() {
  const source = useMemo(() => ({ html: POWERPLAN_HTML }), []);

  return (
    <WebView
      source={source}
      style={styles.webview}
      originWhitelist={['*']}
      allowsInlineMediaPlayback
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
    />
  );
}

const styles = StyleSheet.create({
  webview: { flex: 1, backgroundColor: '#f2f6f3' },
});
