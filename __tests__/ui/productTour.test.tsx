import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Text } from 'react-native';

jest.mock('../../src/ui/contexts/ThemeContext', () => ({
  useTheme: () => ({
    isDarkMode: false,
    toggleTheme: jest.fn(),
    colors: {
      cardBg: '#FFFFFF',
      textPrimary: '#111111',
      textSecondary: '#666666',
      border: '#DDDDDD',
      overlay: 'rgba(0,0,0,0.5)',
      blue: '#E6003A',
      white: '#FFFFFF',
    },
  }),
}));

import { ProductTour, placeCard, spotlightPath } from '../../src/ui/tour/ProductTour';
import { buildTourSteps, proNote } from '../../src/ui/tour/tourSteps';
import type { TourAnchor } from '../../src/ui/tour/tourSteps';
import { productTourStore } from '../../src/storage/productTourStore';
import { initDatabase } from '../../src/storage/dbInit';

const textOf = (tree: ReactTestRenderer.ReactTestRenderer): string =>
  tree.root.findAllByType(Text).map((node) => [node.props.children].flat().join('')).join(' | ');

const press = (tree: ReactTestRenderer.ReactTestRenderer, label: string): void => {
  const button = tree.root.find(
    (node) =>
      typeof node.props.onPress === 'function' &&
      (node.props.accessibilityLabel === label ||
        node.findAllByType(Text).some((text) => [text.props.children].flat().join('') === label)),
  );
  act(() => button.props.onPress());
};

describe('walkthrough steps', () => {
  /** Everything the tab bar registers as a target (see CustomTabBar). */
  const REGISTERED: TourAnchor[] = ['tab-chat', 'tab-calendar', 'tab-notes', 'tab-profile', 'mic'];

  it('points only at things the tab bar registers', () => {
    const steps = buildTourSteps({ isGuest: false, isPro: false });
    for (const step of steps) {
      if (step.anchor) expect(REGISTERED).toContain(step.anchor);
    }
    expect(steps[0].anchor).toBeUndefined();
    expect(steps[steps.length - 1].anchor).toBeUndefined();
  });

  it('speaks to guests about keeping their data', () => {
    const guest = buildTourSteps({ isGuest: true, isPro: false });
    expect(guest[0].body).toContain('guest');
    expect(guest.find((step) => step.id === 'account')?.title).toBe('Your guest session');
  });

  it('says whether the paid tools come with the plan', () => {
    expect(proNote(true)).toContain('included with your plan');
    expect(proNote(false)).toContain('need Student Pro');
    expect(buildTourSteps({ isGuest: false, isPro: false }).find((s) => s.id === 'tools')?.body).toContain(proNote(false));
  });

  it('tells people they can run it again', () => {
    const steps = buildTourSteps({ isGuest: false, isPro: true });
    expect(steps[steps.length - 1].body).toContain('again any time from Profile');
  });
});

describe('walkthrough layout', () => {
  it('cuts a hole only when there is a target', () => {
    expect(spotlightPath(400, 800, null)).toBe('M0 0H400V800H0Z');
    const withHole = spotlightPath(400, 800, { x: 10, y: 700, width: 60, height: 60 });
    expect(withHole.startsWith('M0 0H400V800H0Z')).toBe(true);
    expect(withHole).toContain('A16 16');
  });

  it('puts the card above a target at the bottom, below one at the top, and in the middle otherwise', () => {
    const area = { width: 400, height: 800 };
    expect(placeCard({ x: 10, y: 720, width: 60, height: 60 }, area, 200)).toBe(720 - 14 - 200);
    expect(placeCard({ x: 10, y: 40, width: 60, height: 60 }, area, 200)).toBe(40 + 60 + 14);
    expect(placeCard(null, area, 200)).toBe(300);
  });
});

describe('walkthrough', () => {
  it('walks through the steps, shows each screen, and reports finishing', () => {
    const steps = buildTourSteps({ isGuest: true, isPro: false });
    const onNavigate = jest.fn();
    const onFinish = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(<ProductTour steps={steps} onNavigate={onNavigate} onFinish={onFinish} />);
    });

    expect(textOf(tree)).toContain('Welcome to LAFINA');
    expect(textOf(tree)).toContain(`1 of ${steps.length}`);

    press(tree, 'Next');
    expect(textOf(tree)).toContain('Calendar');
    expect(onNavigate).toHaveBeenLastCalledWith('calendar');

    press(tree, 'Back');
    expect(textOf(tree)).toContain('Welcome to LAFINA');

    for (let i = 0; i < steps.length - 1; i += 1) press(tree, 'Next');
    expect(textOf(tree)).toContain('That is the tour');
    press(tree, 'Get started');
    expect(onFinish).toHaveBeenCalledWith(true);
    act(() => tree.unmount());
  });

  it('reports a skip as not completed', () => {
    const onFinish = jest.fn();
    let tree!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      tree = ReactTestRenderer.create(
        <ProductTour steps={buildTourSteps({ isGuest: false, isPro: false })} onNavigate={jest.fn()} onFinish={onFinish} />,
      );
    });
    press(tree, 'Skip the walkthrough');
    expect(onFinish).toHaveBeenCalledWith(false);
    act(() => tree.unmount());
  });
});

describe('walkthrough state', () => {
  beforeAll(async () => {
    await initDatabase();
  });

  it('is due after onboarding and stays due until finished or skipped', () => {
    const user = 'tour-new-user';
    expect(productTourStore.isPending(user)).toBe(false);
    productTourStore.queue(user);
    expect(productTourStore.isPending(user)).toBe(true);
    productTourStore.markSeen(user, false);
    expect(productTourStore.isPending(user)).toBe(false);
  });

  it('is not queued again for an account that has seen it', () => {
    const user = 'tour-seen-user';
    productTourStore.markSeen(user, true);
    productTourStore.queue(user);
    expect(productTourStore.isPending(user)).toBe(false);
  });

  it('is never due for someone who was already using the app', () => {
    expect(productTourStore.isPending('tour-existing-user')).toBe(false);
  });
});
