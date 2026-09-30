/**
 * Where the things a walkthrough step points at are on screen.
 *
 * A view that can be spotlighted registers itself with `tourTargetRef(anchor)`
 * as its ref; the tour measures it only when a step needs it. The desktop app
 * finds these with `data-tour` attributes, which React Native does not have.
 */

import type { TourAnchor } from './tourSteps';

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Measurable {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
}

const targets = new Map<TourAnchor, Measurable>();
const refCallbacks = new Map<TourAnchor, (node: Measurable | null) => void>();

/** A stable ref for the view to spotlight for `anchor`. */
export const tourTargetRef = (anchor: TourAnchor): ((node: Measurable | null) => void) => {
  let callback = refCallbacks.get(anchor);
  if (!callback) {
    callback = (node) => {
      if (node) targets.set(anchor, node);
      else targets.delete(anchor);
    };
    refCallbacks.set(anchor, callback);
  }
  return callback;
};

/** Where a view is in the window, or null when it has no size (not laid out, not shown). */
export const measureInWindow = (node: Measurable | null | undefined): Promise<ScreenRect | null> =>
  new Promise((resolve) => {
    if (!node) {
      resolve(null);
      return;
    }
    try {
      node.measureInWindow((x, y, width, height) =>
        resolve(width > 0 && height > 0 ? { x, y, width, height } : null),
      );
    } catch {
      resolve(null);
    }
  });

/** Where the view registered for `anchor` is in the window, or null when there is none. */
export const measureTourTarget = (anchor: TourAnchor): Promise<ScreenRect | null> =>
  measureInWindow(targets.get(anchor));
