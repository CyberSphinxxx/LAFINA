import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Colors, Fonts, Spacing } from '../theme';

interface ErrorBoundaryProps {
  children: React.ReactNode;
  /** Human-readable name of the region being protected, used in the diagnostic. */
  label: string;
  /**
   * When this value changes the boundary clears a captured error, so navigating
   * away from a crashed screen and back gives it a clean mount instead of a
   * permanently poisoned subtree.
   */
  resetKey?: string | number | boolean | null;
  /** Called after a successful reset so the parent can rebuild its own state. */
  onReset?: () => void;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render-time failures so one broken subtree cannot take the app down.
 *
 * A single undefined field from a corrupt SQLite row used to unmount the whole
 * Android activity and drop the student back to the home screen mid-call. The
 * boundary keeps the rest of the app alive and offers a way back instead.
 *
 * React only supports error boundaries as class components, so this is the one
 * deliberate exception to the project's functional-component rule.
 */
export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error(
      `[ErrorBoundary:${this.props.label}] caught a render failure:`,
      error,
      info.componentStack,
    );
  }

  componentDidUpdate(previous: ErrorBoundaryProps): void {
    if (this.state.error && previous.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  private handleReset = (): void => {
    this.setState({ error: null });
    this.props.onReset?.();
  };

  render(): React.ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <View style={styles.container} accessibilityRole="alert">
        <Text style={styles.title}>{`${this.props.label} could not be shown`}</Text>
        <Text style={styles.body}>
          Your reminders, notes, and tasks are still saved on this device.
        </Text>
        <TouchableOpacity
          style={styles.button}
          onPress={this.handleReset}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel="Retry"
          accessibilityHint="Rebuilds this part of the app."
        >
          <Text style={styles.buttonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xl,
  },
  title: {
    fontFamily: Fonts.heading,
    fontSize: 20,
    fontWeight: '800',
    color: Colors.error,
    textAlign: 'center',
  },
  body: {
    fontFamily: Fonts.body,
    fontSize: 14,
    color: Colors.textMuted,
    textAlign: 'center',
    marginTop: 10,
  },
  button: {
    marginTop: Spacing.xl,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    backgroundColor: Colors.blue,
  },
  buttonText: {
    fontFamily: Fonts.body,
    fontSize: 15,
    fontWeight: '700',
    color: Colors.textLight,
  },
});
