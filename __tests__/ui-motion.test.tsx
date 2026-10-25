import React from 'react';
import { Text } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { Action, Disclosure, MotionPressable, ProgressBar, Row, ToggleRow } from '../src/ui';
import { ThemeProvider } from '../src/theme';

/**
 * The v1.2 craft pass.
 *
 * These are not pixel assertions — they are contracts. The press feel has to
 * be the same everywhere, the progress bar has to announce its real value to
 * a screen reader, and the switch has to expose its state honestly.
 */

describe('press feedback (one feel for the whole app)', () => {
  it('Action renders a pressable', async () => {
    await render(
      <ThemeProvider>
        <Action title="Save" />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('a disabled Action reports its disabled state', async () => {
    await render(
      <ThemeProvider>
        <Action title="Save" disabled />
      </ThemeProvider>,
    );
    expect(screen.getByRole('button', { name: 'Save' }).props.accessibilityState).toEqual({ disabled: true });
  });

  it('MotionPressable forwards the accessibility label it was given', async () => {
    await render(
      <ThemeProvider>
        <MotionPressable accessibilityRole="button" accessibilityLabel="Back">
          <Text>Back</Text>
        </MotionPressable>
      </ThemeProvider>,
    );
    expect(screen.getByLabelText('Back')).toBeTruthy();
  });
});

describe('ProgressBar', () => {
  it('announces its value to a screen reader', async () => {
    await render(
      <ThemeProvider>
        <ProgressBar value={12} max={28} label="Water coverage" />
      </ThemeProvider>,
    );
    const bar = screen.getByRole('progressbar', { name: 'Water coverage' });
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 28, now: 12 });
  });

  it('reports a value above the maximum honestly', async () => {
    await render(
      <ThemeProvider>
        <ProgressBar value={40} max={28} label="Water coverage" />
      </ThemeProvider>,
    );
    expect(screen.getByRole('progressbar', { name: 'Water coverage' }).props.accessibilityValue.now).toBe(40);
  });

  it('survives a maximum of zero instead of dividing by zero', async () => {
    await render(
      <ThemeProvider>
        <ProgressBar value={0} max={0} label="Nothing" />
      </ThemeProvider>,
    );
    expect(screen.getByRole('progressbar', { name: 'Nothing' })).toBeTruthy();
  });
});

describe('ToggleRow', () => {
  it('exposes a switch whose state follows the value', async () => {
    await render(
      <ThemeProvider>
        <ToggleRow title="Rotation reminder" value onPress={() => {}} />
      </ThemeProvider>,
    );
    const toggle = screen.getByRole('switch', { name: 'Rotation reminder' });
    expect(toggle.props.accessibilityState.checked).toBe(true);
  });

  it('renders the detail line when one is given', async () => {
    await render(
      <ThemeProvider>
        <ToggleRow title="Rotation reminder" detail="Once a year" value={false} onPress={() => {}} />
      </ThemeProvider>,
    );
    expect(screen.getByText('Once a year')).toBeTruthy();
  });
});

describe('Disclosure', () => {
  it('shows its children', async () => {
    await render(
      <ThemeProvider>
        <Disclosure>
          <Text>Editor panel</Text>
        </Disclosure>
      </ThemeProvider>,
    );
    expect(screen.getByText('Editor panel')).toBeTruthy();
  });
});
