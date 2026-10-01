/**
 * UI chaos tests: a render-time crash must not take the whole app down.
 *
 * One undefined field from a corrupt SQLite row used to unmount the Android
 * activity and drop the student back to the home screen, mid-call.
 */
import React from 'react';
import { Text, TouchableOpacity } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import type { ReactTestRenderer as Renderer } from 'react-test-renderer';
import { ErrorBoundary } from '../../src/ui/components/ErrorBoundary';

const Bomb = ({ shouldThrow }: { shouldThrow: boolean }): React.ReactElement => {
  if (shouldThrow) {
    throw new Error('Cannot read properties of undefined (reading title)');
  }
  return <Text>recovered content</Text>;
};

const visibleText = (tree: Renderer): string[] =>
  tree.root
    .findAllByType(Text)
    .flatMap(node => node.props.children)
    .filter((child): child is string => typeof child === 'string');

describe('ErrorBoundary', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('renders the protected subtree when nothing fails', () => {
    let tree!: Renderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <ErrorBoundary label="Notes">
          <Bomb shouldThrow={false} />
        </ErrorBoundary>,
      );
    });

    expect(visibleText(tree)).toContain('recovered content');
  });

  it('swaps a crashed subtree for a retry screen and logs the diagnostic', () => {
    let tree!: Renderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <ErrorBoundary label="Notes">
          <Bomb shouldThrow />
        </ErrorBoundary>,
      );
    });

    expect(visibleText(tree)).toContain('Notes could not be shown');
    expect(visibleText(tree)).toContain('Retry');
    const diagnostic = consoleErrorSpy.mock.calls.find(call =>
      String(call[0]).includes('[ErrorBoundary:Notes]'),
    );
    expect(diagnostic).toBeDefined();
    expect(diagnostic?.[1]).toBeInstanceOf(Error);
  });

  it('rebuilds the subtree when the user retries after the failure clears', () => {
    let tree!: Renderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <ErrorBoundary label="Calendar">
          <Bomb shouldThrow />
        </ErrorBoundary>,
      );
    });
    expect(visibleText(tree)).toContain('Calendar could not be shown');

    // The underlying problem is transient: the parent re-renders with good data.
    ReactTestRenderer.act(() => {
      tree.update(
        <ErrorBoundary label="Calendar">
          <Bomb shouldThrow={false} />
        </ErrorBoundary>,
      );
    });
    expect(visibleText(tree)).toContain('Calendar could not be shown');

    ReactTestRenderer.act(() => {
      tree.root.findByType(TouchableOpacity).props.onPress();
    });

    expect(visibleText(tree)).toContain('recovered content');
    expect(visibleText(tree)).not.toContain('Calendar could not be shown');
  });

  it('clears a captured error when the region key changes', () => {
    let tree!: Renderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <ErrorBoundary label="Calendar" resetKey="calendar">
          <Bomb shouldThrow />
        </ErrorBoundary>,
      );
    });
    expect(visibleText(tree)).toContain('Calendar could not be shown');

    ReactTestRenderer.act(() => {
      tree.update(
        <ErrorBoundary label="Calendar" resetKey="notes">
          <Bomb shouldThrow={false} />
        </ErrorBoundary>,
      );
    });

    expect(visibleText(tree)).toContain('recovered content');
  });

  it('notifies the parent after a successful reset', () => {
    const onReset = jest.fn();
    let tree!: Renderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(
        <ErrorBoundary label="Profile" onReset={onReset}>
          <Bomb shouldThrow />
        </ErrorBoundary>,
      );
    });
    ReactTestRenderer.act(() => {
      tree.update(
        <ErrorBoundary label="Profile" onReset={onReset}>
          <Bomb shouldThrow={false} />
        </ErrorBoundary>,
      );
    });

    ReactTestRenderer.act(() => {
      tree.root.findByType(TouchableOpacity).props.onPress();
    });

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
