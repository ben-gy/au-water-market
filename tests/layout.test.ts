// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// POSITIONAL assertions, not area assertions.
//
// An area-only test passes on a visually broken layout: a treemap that stacks
// every cell at the same origin conserves total area perfectly and renders as
// garbage. That shipped once. So these tests check bounds, overlap, flushness
// and NaN — the properties you would notice by looking at it.

import { describe, expect, it } from 'vitest';
import { squarify, type Rect } from '../src/utils/squarify.ts';
import { scale, logScale, ticks, logTicks, linePath, areaPath, ribbon } from '../src/views/svg.ts';

const overlapArea = (a: Rect, b: Rect): number => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
};

describe('squarify — the treemap layout', () => {
  const W = 800, H = 400;
  const values = [15_223_906, 7_534_132, 6_904_898, 4_491_246, 2_759_336, 2_675_636, 640_299, 85_313];

  it('returns one rect per value, in input order', () => {
    const r = squarify(values, W, H);
    expect(r).toHaveLength(values.length);
    r.forEach((x, i) => expect(x.index).toBe(i));
  });

  it('produces no NaN or undefined coordinates', () => {
    for (const r of squarify(values, W, H)) {
      for (const k of ['x', 'y', 'w', 'h'] as const) {
        expect(Number.isFinite(r[k])).toBe(true);
      }
    }
  });

  it('keeps every rect inside the canvas', () => {
    for (const r of squarify(values, W, H)) {
      expect(r.x).toBeGreaterThanOrEqual(-0.01);
      expect(r.y).toBeGreaterThanOrEqual(-0.01);
      expect(r.x + r.w).toBeLessThanOrEqual(W + 0.01);
      expect(r.y + r.h).toBeLessThanOrEqual(H + 0.01);
    }
  });

  it('NO PAIRWISE OVERLAP — the assertion an area test cannot make', () => {
    const rects = squarify(values, W, H);
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        expect(overlapArea(rects[i], rects[j])).toBeLessThan(0.5);
      }
    }
  });

  it('conserves total area', () => {
    const total = squarify(values, W, H).reduce((a, r) => a + r.w * r.h, 0);
    expect(total).toBeCloseTo(W * H, -1);
  });

  it('sizes rects proportionally to their values', () => {
    const r = squarify(values, W, H);
    const a0 = r[0].w * r[0].h, a1 = r[1].w * r[1].h;
    expect(a0 / a1).toBeCloseTo(values[0] / values[1], 1);
  });

  it('survives degenerate inputs without NaN', () => {
    expect(() => squarify([], W, H)).not.toThrow();
    for (const r of squarify([0, 0], W, H)) expect(Number.isFinite(r.w)).toBe(true);
    for (const r of squarify([1], 0, 0)) expect(Number.isFinite(r.h)).toBe(true);
    for (const r of squarify([5, 1], 100, 0)) expect(Number.isFinite(r.x)).toBe(true);
  });

  it('places a single value across the whole canvas', () => {
    const [r] = squarify([42], W, H);
    expect(r.w).toBeCloseTo(W, 4);
    expect(r.h).toBeCloseTo(H, 4);
  });

  it('nested layout stays inside its parent once the origin is applied', () => {
    // The step a hand-rolled treemap usually gets wrong: children laid out in
    // parent-local space and then drawn at page coordinates.
    const parent = squarify(values, W, H)[0];
    const pad = 3;
    const kids = squarify([700, 300], parent.w - pad * 2, parent.h - pad * 2);
    for (const k of kids) {
      expect(parent.x + pad + k.x).toBeGreaterThanOrEqual(parent.x - 0.01);
      expect(parent.x + pad + k.x + k.w).toBeLessThanOrEqual(parent.x + parent.w + 0.01);
      expect(parent.y + pad + k.y + k.h).toBeLessThanOrEqual(parent.y + parent.h + 0.01);
    }
  });
});

describe('scales', () => {
  it('maps a domain onto a range', () => {
    const s = scale(0, 10, 0, 100);
    expect(s(0)).toBe(0);
    expect(s(5)).toBe(50);
    expect(s(10)).toBe(100);
  });
  it('does not produce NaN on a zero-width domain — which would erase the chart', () => {
    const s = scale(5, 5, 0, 100);
    expect(Number.isFinite(s(5))).toBe(true);
  });
  it('log scale spreads three orders of magnitude', () => {
    const s = logScale(10, 10_000, 300, 0);
    expect(s(10)).toBeCloseTo(300, 5);
    expect(s(10_000)).toBeCloseTo(0, 5);
    // $100 sits at a third of the way up, not pinned to the floor as it would
    // be on a linear axis where $6,000 sets the top.
    expect(s(100)).toBeCloseTo(200, 5);
  });
  it('log scale is finite for zero and negative inputs', () => {
    const s = logScale(1, 100, 0, 100);
    expect(Number.isFinite(s(0))).toBe(true);
    expect(Number.isFinite(s(-5))).toBe(true);
  });
});

describe('ticks', () => {
  it('produces round numbers inside the domain', () => {
    const t = ticks(0, 100, 5);
    expect(t.every((v) => v >= 0 && v <= 100)).toBe(true);
    // The algorithm snaps to a 1/2/5×10ⁿ step, so 0..100 in ~5 steps is a step
    // of 20, not 25. "Round" means round on that scale, not evenly divided.
    expect(t).toEqual([0, 20, 40, 60, 80, 100]);
    expect(t.every((v) => Number.isInteger(v))).toBe(true);
  });
  it('does not hang or return junk on a degenerate domain', () => {
    expect(ticks(5, 5)).toEqual([5]);
    expect(ticks(10, 1)).toEqual([10]);
  });
  it('log ticks stay inside the domain', () => {
    const t = logTicks(20, 6000);
    expect(t.every((v) => v >= 20 && v <= 6000)).toBe(true);
    expect(t).toContain(100);
  });
});

describe('linePath — gaps must stay gaps', () => {
  it('draws a continuous run', () => {
    expect(linePath([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe('M0.00 0.00L1.00 1.00');
  });
  it('BREAKS at a null instead of bridging it — a bridge invents data', () => {
    const d = linePath([{ x: 0, y: 0 }, null, { x: 2, y: 2 }]);
    expect(d).toBe('M0.00 0.00M2.00 2.00');
    expect(d).not.toContain('L');
  });
  it('never emits NaN into the path', () => {
    const d = linePath([{ x: Number.NaN, y: 0 }, { x: 1, y: 1 }]);
    expect(d).not.toContain('NaN');
  });
  it('is empty for an empty series rather than throwing', () => {
    expect(linePath([])).toBe('');
    expect(linePath([null, null])).toBe('');
  });
});

describe('areaPath', () => {
  it('closes each run back to the baseline', () => {
    const d = areaPath([{ x: 0, y: 10 }, { x: 5, y: 5 }], 100);
    expect(d.startsWith('M0.00 10.00')).toBe(true);
    expect(d).toContain('100.00');
    expect(d.endsWith('Z')).toBe(true);
  });
  it('emits one closed shape per run, not one spanning the gap', () => {
    const d = areaPath([{ x: 0, y: 1 }, { x: 1, y: 1 }, null, { x: 3, y: 1 }, { x: 4, y: 1 }], 10);
    expect((d.match(/Z/g) ?? [])).toHaveLength(2);
  });
  it('skips a single-point run that has no area', () => {
    expect(areaPath([{ x: 0, y: 1 }], 10)).toBe('');
  });
});

describe('ribbon', () => {
  it('produces a closed path with finite coordinates', () => {
    const d = ribbon(0, 10, 100, 50, 20, 8);
    expect(d).not.toContain('NaN');
    expect(d.endsWith('Z')).toBe(true);
    expect(d.startsWith('M0 0')).toBe(true);
  });
  it('stays within the vertical extent implied by its endpoints and widths', () => {
    const y0 = 100, y1 = 200, w0 = 20, w1 = 40;
    const nums = ribbon(0, y0, 500, y1, w0, w1).match(/-?\d+(\.\d+)?/g)!.map(Number);
    const ys = nums.filter((_, i) => i % 2 === 1);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(y0 - w0 / 2 - 0.01);
    expect(Math.max(...ys)).toBeLessThanOrEqual(y1 + w1 / 2 + 0.01);
  });
});
