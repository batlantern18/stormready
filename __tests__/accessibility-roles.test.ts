/// <reference types="node" />
import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

// React Native's TypeScript type for accessibilityRole ends in `| string`, so
// TypeScript happily accepts web/ARIA-only roles such as "status". Android does
// not: it throws `java.lang.IllegalArgumentException: Invalid accessibility
// role value` while mounting the view, which tears down the whole root view and
// leaves a blank screen. Keep this list in sync with React Native's
// AccessibilityRole type (minus the `| string` escape hatch).
const SUPPORTED_ROLES = new Set([
  'none', 'button', 'dropdownlist', 'togglebutton', 'link', 'search', 'image',
  'keyboardkey', 'text', 'adjustable', 'imagebutton', 'header', 'summary',
  'alert', 'checkbox', 'combobox', 'menu', 'menubar', 'menuitem', 'progressbar',
  'radio', 'radiogroup', 'scrollbar', 'spinbutton', 'switch', 'tab', 'tabbar',
  'tablist', 'timer', 'list', 'toolbar', 'grid', 'pager', 'scrollview',
  'horizontalscrollview', 'viewgroup', 'webview', 'drawerlayout',
  'slidingdrawer', 'iconmenu',
]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe('accessibility roles', () => {
  it('only uses roles Android can mount', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(join(__dirname, '..', 'src'))) {
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/accessibilityRole=(?:"([^"]+)"|\{'([^']+)'\})/g)) {
        const role = match[1] ?? match[2];
        if (role && !SUPPORTED_ROLES.has(role)) offenders.push(`${file}: ${role}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
