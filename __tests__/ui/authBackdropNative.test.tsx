import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NativeModules, Text } from 'react-native';

jest.mock('../../src/ui/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: false,
    toggleTheme: jest.fn(),
    colors: {
      authGradientYellow: '#F8E81C',
      authGradientCrimson: '#D8163F',
      authGradientBlue: '#2A10F0',
      authVeil: 'rgba(255, 255, 255, 0.12)',
    },
  }),
}));

// Support is read once, when the component loads, so it is in place before the require below.
(NativeModules as Record<string, unknown>).LafinaGrainient = { isSupported: () => true };
const { AuthBackdrop } = require('../../src/ui/components/auth/AuthBackdrop') as typeof import('../../src/ui/components/auth/AuthBackdrop');

describe('sign-in backdrop with the native Grainient', () => {
  it('draws the animated gradient in the logo colours, with the desktop settings', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <AuthBackdrop>
          <Text>Login card</Text>
        </AuthBackdrop>,
      );
    });
    const views = tree.root.findAll((node) => (node.type as unknown) === 'LafinaGrainientView');
    expect(views).toHaveLength(1);
    expect(views[0].props).toMatchObject({
      color1: '#F8E81C',
      color2: '#D8163F',
      color3: '#2A10F0',
      timeSpeed: 0.12,
      warpStrength: 0.6,
      zoom: 0.85,
      animate: true,
    });
    expect(tree.root.findByProps({ children: 'Login card' })).toBeTruthy();
    act(() => tree.unmount());
  });
});
