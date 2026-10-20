// Shared Jest setup for StormReady.
// AsyncStorage ships an in-memory mock that matches its public API.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// R-TST-4: no test may reach the network. Tests that exercise a request
// replace this mock with their own `fetch` implementation.
globalThis.fetch = () => Promise.reject(
  new Error('Network requests are blocked in tests. Mock globalThis.fetch instead.'),
);

// Let React's `act` environment be used by the testing library.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Reanimated 4 needs a native worklets module that does not exist under Jest,
// so the app's small animation surface is replaced with a self-contained mock.
jest.mock('react-native-reanimated', () => {
  const React = require('react');
  const { View, Text, ScrollView, Image, Pressable } = require('react-native');

  const passthrough = (Component) => React.forwardRef((props, ref) => {
    const { entering, exiting, layout, sharedTransitionTag, ...rest } = props;
    return React.createElement(Component, { ...rest, ref });
  });

  const Animated = {
    View: passthrough(View),
    Text: passthrough(Text),
    ScrollView: passthrough(ScrollView),
    Image: passthrough(Image),
    createAnimatedComponent: (Component) => passthrough(Component),
  };

  const transition = () => ({ duration: () => ({ reduceMotion: () => ({}) }) });

  return {
    __esModule: true,
    default: Animated,
    ReduceMotion: { System: 'system', Always: 'always', Never: 'never' },
    useSharedValue: (initial) => {
      const holder = { value: initial };
      return {
        get: () => holder.value,
        set: (next) => { holder.value = next; },
        value: initial,
      };
    },
    useAnimatedStyle: (factory) => factory(),
    useReducedMotion: () => false,
    withTiming: (to) => to,
    withSpring: (to) => to,
    FadeIn: transition(),
    FadeOut: transition(),
    FadeInDown: transition(),
    FadeOutDown: transition(),
    Layout: transition(),
    Pressable,
  };
});
