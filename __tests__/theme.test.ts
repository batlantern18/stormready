import { darkColors, lightColors, type Palette } from '../src/theme';

/** WCAG 2.1 relative luminance. */
function relativeLuminance(hex: string) {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map(index => parseInt(value.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map(channel =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4),
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1 (identical) to 21 (black on white). */
export function contrastRatio(foreground: string, background: string) {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [high, low] = a > b ? [a, b] : [b, a];
  return (high + 0.05) / (low + 0.05);
}

const AA_TEXT = 4.5;
const AA_LARGE_TEXT = 3;

/** Foreground/background pairs used for body text in the app. */
const TEXT_PAIRS: [keyof Palette, keyof Palette][] = [
  ['onSurface', 'surface'],
  ['onSurface', 'surfaceContainerLowest'],
  ['onSurface', 'surfaceContainerLow'],
  ['onSurface', 'mint'],
  ['onSurfaceVariant', 'surface'],
  ['onSurfaceVariant', 'surfaceContainerLowest'],
  ['onSurfaceVariant', 'surfaceContainerLow'],
  ['muted', 'surface'],
  ['muted', 'paper'],
  ['muted', 'surfaceContainerLow'],
  ['primary', 'surface'],
  ['primary', 'paper'],
  ['primary', 'surfaceContainerLowest'],
  ['primary', 'primaryContainer'],
  ['tealDark', 'surface'],
  ['tealDark', 'paper'],
  ['tealDark', 'mint'],
  ['tealDark', 'surfaceContainerLow'],
  ['ink', 'mint'],
  ['ink', 'paper'],
  ['ink', 'surface'],
  ['error', 'surface'],
  ['red', 'surface'],
  ['red', 'paper'],
  ['warning', 'surface'],
  ['amber', 'surface'],
  ['amber', 'amberBg'],
  ['warning', 'warningContainer'],
  ['success', 'surface'],
  ['success', 'paper'],
  ['blue', 'surface'],
  ['blue', 'tertiaryContainer'],
  ['onPrimary', 'primary'],
  ['onSecondary', 'secondary'],
  ['onPrimaryContainer', 'primaryContainer'],
  ['lime', 'navy'],
  ['forestMuted', 'navy'],
];

/** Borders of interactive controls, which need the non-text 3:1 ratio. */
const CONTROL_PAIRS: [keyof Palette, keyof Palette][] = [
  ['outline', 'surface'],
  ['outline', 'surfaceContainerLowest'],
  ['teal', 'surface'],
];

const palettes: [string, Palette][] = [
  ['light', lightColors as Palette],
  ['dark', darkColors as Palette],
];

describe.each(palettes)('%s palette contrast', (name, colors) => {
  it.each(TEXT_PAIRS)('%s on %s meets WCAG AA for body text', (foreground, background) => {
    const ratio = contrastRatio(colors[foreground], colors[background]);
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(CONTROL_PAIRS)('%s on %s meets the 3:1 control boundary ratio', (foreground, background) => {
    const ratio = contrastRatio(colors[foreground], colors[background]);
    expect(ratio).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
  });

  it('exposes the same token names in both palettes', () => {
    expect(Object.keys(darkColors).sort()).toEqual(Object.keys(lightColors).sort());
  });
});
