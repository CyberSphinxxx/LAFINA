import type { PomodoroPhase } from '../../../storage';
import type { ThemeColors } from '../../contexts/ThemeContext';

/** Accent per phase, from the theme so dark mode follows. */
export const phaseAccent = (colors: ThemeColors, phase: PomodoroPhase): string =>
  phase === 'focus' ? colors.red : phase === 'shortBreak' ? colors.success : colors.yellow;
