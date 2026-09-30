/**
 * `color-mix(in srgb, color amount, base)` for React Native, which has no
 * `color-mix`: the desktop tints calendar items this way, and the day view
 * needs the same solid result (a translucent colour would show the hour lines
 * through the item).
 */

type Rgb = [number, number, number];

const parse = (color: string): Rgb | null => {
  const value = color.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(value);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].split('').map((d) => d + d).join('') : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as Rgb;
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  return null;
};

const toHex = ([r, g, b]: Rgb): string =>
  `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;

/** `amount` of `color` over `base` (0–1). Falls back to `base` when either cannot be read. */
export const mixColors = (color: string, base: string, amount: number): string => {
  const top = parse(color);
  const bottom = parse(base);
  if (!top || !bottom) return base;
  const weight = Math.min(1, Math.max(0, amount));
  return toHex([0, 1, 2].map((i) => top[i] * weight + bottom[i] * (1 - weight)) as Rgb);
};
