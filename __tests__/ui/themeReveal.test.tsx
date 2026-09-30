import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { NativeModules, Text } from 'react-native';
import { ThemeProvider, useTheme } from '../../src/ui/contexts/ThemeContext';

type Captured = ReturnType<typeof useTheme>;

const renderProvider = () => {
  const seen: Captured[] = [];
  const Probe: React.FC = () => {
    const theme = useTheme();
    seen.push(theme);
    return <Text>{theme.isDarkMode ? 'dark' : 'light'}</Text>;
  };
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    tree = ReactTestRenderer.create(
      <ThemeProvider userId={null}>
        <Probe />
      </ThemeProvider>,
    );
  });
  return { tree, latest: () => seen[seen.length - 1] };
};

describe('theme reveal', () => {
  afterEach(() => {
    delete (NativeModules as Record<string, unknown>).LafinaThemeReveal;
  });

  it('switches at once where the native reveal is missing', () => {
    const { tree, latest } = renderProvider();
    const before = latest().isDarkMode;
    act(() => latest().toggleTheme({ x: 300, y: 500 }));
    expect(latest().isDarkMode).toBe(!before);
    act(() => tree.unmount());
  });

  it('covers the screen from the touch point, switches underneath, then reveals', async () => {
    const calls: string[] = [];
    (NativeModules as Record<string, unknown>).LafinaThemeReveal = {
      capture: jest.fn(async (x: number, y: number) => {
        calls.push(`capture ${x},${y}`);
        return true;
      }),
      reveal: jest.fn(async () => {
        calls.push('reveal');
        return true;
      }),
    };
    const { tree, latest } = renderProvider();
    const before = latest().isDarkMode;

    await act(async () => {
      latest().toggleTheme({ x: 300, y: 500 });
    });

    expect(latest().isDarkMode).toBe(!before);
    expect(calls).toEqual(['capture 300,500', 'reveal']);
    act(() => tree.unmount());
  });

  it('still switches, without a reveal, when the screen cannot be captured', async () => {
    const reveal = jest.fn(async () => true);
    (NativeModules as Record<string, unknown>).LafinaThemeReveal = {
      capture: jest.fn(async () => false),
      reveal,
    };
    const { tree, latest } = renderProvider();
    const before = latest().isDarkMode;

    await act(async () => {
      latest().toggleTheme(null);
    });

    expect(latest().isDarkMode).toBe(!before);
    expect(reveal).not.toHaveBeenCalled();
    act(() => tree.unmount());
  });
});
