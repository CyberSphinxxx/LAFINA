/**
 * Geometry for the Mic button's radial menu.
 *
 * Items fan out in an arc above the button, first item on the left. Offsets
 * use screen axes — x to the right, y downwards — relative to the button's
 * centre, so they can be applied as translations and compared with a finger's
 * movement directly.
 */

export interface RadialItemPosition {
  /** Direction from the centre, in degrees: 0 is right, 90 is straight up. */
  angleDeg: number;
  /** Offset of the item's centre from the button's centre. */
  x: number;
  y: number;
}

export interface RadialLayout {
  radius: number;
  items: RadialItemPosition[];
  /** Half the angle between neighbours: how far off an item a finger may be. */
  halfSectorDeg: number;
  /**
   * Extra angle the two outermost items accept, on their outer side: the arc
   * that is left between them and the horizontal. Without it a finger flung
   * straight out sideways — past the end of the fan — would select nothing.
   */
  edgeSlackDeg: number;
}

/** Degrees of arc per gap between items, within the bounds below. */
const SPREAD_PER_GAP_DEG = 30;
const MIN_SPREAD_DEG = 70;
/**
 * The arc never opens wider than this. Past it the outermost items drop level
 * with the Mic, where the tab bar is, instead of standing clear above it.
 */
const MAX_SPREAD_DEG = 108;
/**
 * Space each item needs along the arc, centre to centre. A bubble is 56 wide
 * and its label sits under it, so neighbours this far apart clear each other
 * with room to read between them.
 */
const MIN_ITEM_SEPARATION = 92;
/** However tight the screen, the arc never closes in past this. */
const ABSOLUTE_MIN_RADIUS = 110;

export interface RadialLayoutOptions {
  /**
   * How far either side of the button an item's centre may sit. Pass the
   * screen's half-width less the room a bubble needs, and the arc pulls itself
   * in on a narrow phone rather than hanging items off the edge.
   */
  maxHalfWidth?: number;
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/**
 * Lays `count` items out on an arc centred straight above the button.
 *
 * `minRadius` is a floor, not the answer: the arc is pushed out until
 * neighbours are `MIN_ITEM_SEPARATION` apart, because a fixed radius crowds
 * the items into each other as soon as the menu holds more than a few.
 */
export const computeRadialLayout = (
  count: number,
  minRadius: number,
  { maxHalfWidth = Infinity }: RadialLayoutOptions = {}
): RadialLayout => {
  if (count <= 0) return { radius: minRadius, items: [], halfSectorDeg: 0, edgeSlackDeg: 0 };
  const spread =
    count === 1
      ? 0
      : Math.min(MAX_SPREAD_DEG, Math.max(MIN_SPREAD_DEG, (count - 1) * SPREAD_PER_GAP_DEG));
  const step = count === 1 ? 0 : spread / (count - 1);
  // Chord between neighbours is 2·r·sin(step/2); solve it for r.
  const spacingRadius =
    count === 1 ? 0 : MIN_ITEM_SEPARATION / (2 * Math.sin(toRadians(step / 2)));
  // The outermost item reaches r·sin(spread/2) sideways; cap r so it stays in.
  const widthRadius =
    spread === 0 ? Infinity : maxHalfWidth / Math.sin(toRadians(spread / 2));
  const radius = Math.max(
    ABSOLUTE_MIN_RADIUS,
    Math.min(Math.max(minRadius, Math.ceil(spacingRadius)), Math.floor(widthRadius))
  );
  const items = Array.from({ length: count }, (_, index) => {
    const angleDeg = 90 + spread / 2 - index * step;
    return {
      angleDeg,
      x: radius * Math.cos(toRadians(angleDeg)),
      y: -radius * Math.sin(toRadians(angleDeg)),
    };
  });
  return {
    radius,
    items,
    halfSectorDeg: count === 1 ? 45 : step / 2,
    edgeSlackDeg: count === 1 ? 45 : 90 - spread / 2,
  };
};

/** Smallest angle between two directions, 0 to 180. */
const angleBetween = (a: number, b: number): number => Math.abs(((a - b + 540) % 360) - 180);

export interface RadialHitOptions {
  /** Movement inside this radius selects nothing, so a hold can be let go. */
  deadZone?: number;
  /** Movement beyond this distance selects nothing. */
  maxDistance?: number;
}

/**
 * The item a finger `dx`/`dy` away from where it pressed is pointing at, or
 * null when it rests near the button, drifts too far, or points between items.
 */
export const hitTestRadial = (
  dx: number,
  dy: number,
  layout: RadialLayout,
  { deadZone = 28, maxDistance = layout.radius + 64 }: RadialHitOptions = {}
): number | null => {
  const distance = Math.hypot(dx, dy);
  if (layout.items.length === 0 || distance < deadZone || distance > maxDistance) return null;

  const angle = (Math.atan2(-dy, dx) * 180) / Math.PI;
  let best: number | null = null;
  let bestGap = Infinity;
  layout.items.forEach((item, index) => {
    const gap = angleBetween(angle, item.angleDeg);
    if (gap < bestGap) {
      bestGap = gap;
      best = index;
    }
  });
  if (best === null) return null;

  const isEdge = best === 0 || best === layout.items.length - 1;
  const tolerance = layout.halfSectorDeg + (isEdge ? layout.edgeSlackDeg : 0);
  return bestGap <= tolerance ? best : null;
};
