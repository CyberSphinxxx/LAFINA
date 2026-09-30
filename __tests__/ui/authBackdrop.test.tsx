import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';
import { AuthBackdrop } from '../../src/ui/components/auth/AuthBackdrop';

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

describe('sign-in backdrop without the native Grainient', () => {
  it('shows the screen on a still gradient, as on an APK that predates the view', () => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <AuthBackdrop>
          <Text>Welcome card</Text>
        </AuthBackdrop>,
      );
    });
    expect(tree.root.findByProps({ testID: 'auth-backdrop' })).toBeTruthy();
    expect(tree.root.findByProps({ children: 'Welcome card' })).toBeTruthy();
    expect(tree.root.findAll((node) => (node.type as unknown) === 'LafinaGrainientView')).toHaveLength(0);
    act(() => tree.unmount());
  });
});
