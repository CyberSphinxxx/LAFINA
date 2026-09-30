import { computeRadialLayout, hitTestRadial } from '../../src/utils/radialMenu';

describe('radial menu geometry', () => {
  const layout = computeRadialLayout(5, 140);

  it('fans five items symmetrically above the button, first on the left', () => {
    const angles = layout.items.map((item) => Math.round(item.angleDeg));
    expect(angles).toEqual([144, 117, 90, 63, 36]);
    const middle = layout.items[2];
    expect(middle.x).toBeCloseTo(0);
    expect(middle.y).toBeCloseTo(-layout.radius);
    expect(layout.items[0].x).toBeCloseTo(-layout.items[4].x);
    expect(layout.items[0].y).toBeCloseTo(layout.items[4].y);
    expect(layout.items.every((item) => item.y < 0)).toBe(true);
  });

  it('opens the arc wide enough that neighbours cannot collide', () => {
    // A bubble is 56 across and carries a label; 92 apart is the floor that
    // keeps two of them legible side by side.
    for (let index = 1; index < layout.items.length; index += 1) {
      const previous = layout.items[index - 1];
      const current = layout.items[index];
      const gap = Math.hypot(current.x - previous.x, current.y - previous.y);
      expect(gap).toBeGreaterThanOrEqual(92);
    }
  });

  it('pulls the arc in rather than hanging items off a narrow screen', () => {
    const narrow = computeRadialLayout(5, 140, { maxHalfWidth: 144 });
    expect(narrow.radius).toBeLessThan(layout.radius);
    expect(Math.max(...narrow.items.map((item) => Math.abs(item.x)))).toBeLessThanOrEqual(144);
    // A roomy screen leaves the preferred arc alone.
    expect(computeRadialLayout(5, 140, { maxHalfWidth: 400 }).radius).toBe(layout.radius);
  });

  it('never collapses the arc, however little room it is given', () => {
    expect(computeRadialLayout(5, 140, { maxHalfWidth: 10 }).radius).toBe(110);
  });

  it('keeps two items apart and one item straight up', () => {
    const two = computeRadialLayout(2, 140);
    expect(two.items.map((item) => Math.round(item.angleDeg))).toEqual([125, 55]);
    expect(two.radius).toBe(140);
    expect(computeRadialLayout(1, 140).items[0].angleDeg).toBe(90);
    expect(computeRadialLayout(0, 140).items).toEqual([]);
  });

  it('picks the item a finger points at', () => {
    for (let index = 0; index < layout.items.length; index += 1) {
      const { x, y } = layout.items[index];
      expect(hitTestRadial(x, y, layout)).toBe(index);
      // Short of the item, but clearly on its way there.
      expect(hitTestRadial(x * 0.5, y * 0.5, layout)).toBe(index);
    }
  });

  it('selects nothing near the button, far away, or below it', () => {
    expect(hitTestRadial(5, -10, layout)).toBeNull();
    expect(hitTestRadial(0, -400, layout)).toBeNull();
    expect(hitTestRadial(0, 80, layout)).toBeNull();
  });

  it('lets the outermost items catch a finger that drifts past them', () => {
    // Straight left and straight right are past the arc's ends.
    expect(hitTestRadial(-100, 0, layout)).toBe(0);
    expect(hitTestRadial(100, 0, layout)).toBe(4);
  });
});
