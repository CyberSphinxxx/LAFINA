import { BookOpen, Layers, Mic, Timer, Users } from 'lucide-react-native';
import type { ShellMode } from '../CustomTabBar';
import type { RadialMenuItem } from './useRadialMenu';

/** Opens the voice assistant, the same as tapping the Mic. */
export const RADIAL_MIC_KEY = 'mic';

/**
 * What the Mic's radial menu offers, left to right. Business shells get the
 * Pomodoro and the Mic, as on desktop; students get the study tools too.
 * Items that need Student Pro are shown locked rather than hidden, and their
 * screens explain the plan.
 */
export const buildRadialItems = (mode: ShellMode, hasPro: boolean): RadialMenuItem[] => {
  const pomodoro: RadialMenuItem = { key: 'pomodoro', label: 'Pomodoro', icon: Timer };
  const mic: RadialMenuItem = { key: RADIAL_MIC_KEY, label: 'Mic', icon: Mic };
  if (mode !== 'student') return [pomodoro, mic];
  return [
    pomodoro,
    { key: 'flashcards', label: 'Flashcards', icon: Layers, locked: !hasPro },
    mic,
    { key: 'studynotes', label: 'Study Notes', icon: BookOpen, locked: !hasPro },
    { key: 'meetings', label: 'Meetings', icon: Users, locked: !hasPro },
  ];
};
