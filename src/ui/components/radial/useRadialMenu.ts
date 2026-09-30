import type React from 'react';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useWindowDimensions, Vibration } from 'react-native';
import { computeRadialLayout, hitTestRadial } from '../../../utils';
import type { RadialLayout } from '../../../utils';

export interface RadialMenuItem {
  key: string;
  label: string;
  icon: React.ComponentType<{ size: number; color: string }>;
  /** Shown with a lock: the item opens, but its screen asks for Student Pro. */
  locked?: boolean;
}

/**
 * Smallest distance from the Mic's centre to each item's centre. The layout
 * pushes past it when the menu holds enough items to need the room.
 */
export const RADIAL_RADIUS = 140;

/** Room an item's bubble needs between its centre and the screen edge. */
const ITEM_EDGE_MARGIN = 36;

export interface RadialMenuState {
  open: boolean;
  highlighted: number | null;
  layout: RadialLayout;
  openMenu: () => void;
  close: () => void;
  select: (key: string) => void;
  /** Finger movement from the press point while held. */
  drag: (dx: number, dy: number) => void;
  /** Finger lifted: selects what it rests on, or leaves the menu open to tap. */
  release: (dx: number | null, dy: number | null) => void;
}

/**
 * State for the Mic button's radial menu: hold to open, slide onto an item
 * and let go to pick it. Letting go anywhere else leaves the menu open, so it
 * also works as a tap menu.
 */
export const useRadialMenu = (
  items: RadialMenuItem[],
  onSelect: (key: string) => void
): RadialMenuState => {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const highlightedRef = useRef<number | null>(null);
  const { width } = useWindowDimensions();
  const layout = useMemo(
    () =>
      computeRadialLayout(items.length, RADIAL_RADIUS, {
        maxHalfWidth: Math.max(0, width / 2 - ITEM_EDGE_MARGIN),
      }),
    [items.length, width]
  );

  const highlight = useCallback((index: number | null) => {
    if (index === highlightedRef.current) return;
    highlightedRef.current = index;
    setHighlighted(index);
    if (index !== null) Vibration.vibrate(8);
  }, []);

  const openMenu = useCallback(() => {
    highlightedRef.current = null;
    setHighlighted(null);
    setOpen(true);
    Vibration.vibrate(15);
  }, []);

  const close = useCallback(() => {
    highlightedRef.current = null;
    setHighlighted(null);
    setOpen(false);
  }, []);

  const select = useCallback(
    (key: string) => {
      close();
      onSelect(key);
    },
    [close, onSelect]
  );

  const drag = useCallback(
    (dx: number, dy: number) => highlight(hitTestRadial(dx, dy, layout)),
    [highlight, layout]
  );

  const release = useCallback(
    (dx: number | null, dy: number | null) => {
      const index = dx === null || dy === null ? null : hitTestRadial(dx, dy, layout);
      if (index === null || !items[index]) {
        highlight(null);
        return;
      }
      select(items[index].key);
    },
    [highlight, items, layout, select]
  );

  return { open, highlighted, layout, openMenu, close, select, drag, release };
};
