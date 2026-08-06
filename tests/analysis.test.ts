// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import { describe, expect, it } from 'vitest';
import { anomalies, change, chokeSummary, decoupling, juneEffect, median, rollingMean, topZones } from '../src/analysis.ts';
import { money, ml, perML, monthLabel, auDate, isoDate, num, pct, signedPct, esc, escTip, dollars } from '../src/format.ts';
import type { Bundle } from '../src/types.ts';

const bundle = (over: Partial<Bundle> = {}): Bundle => ({
  meta: {} as Bundle['meta'],
  prices: {
    allocationMonthly: [],
    allocationYearly: [
      { wy: 2019, label: '2019-20', vwap: 527.05, volume: 1_270_947, trades: 16_398, pricedShare: 0.57, complete: true },
      { wy: 2022, label: '2022-23', vwap: 48.94, volume: 2_144_742, trades: 10_127, pricedShare: 0.6, complete: true },
      { wy: 2026, label: '2026-27', vwap: 247.77, volume: 104_795, trades: 648, pricedShare: 0.36, complete: false },
    ],
    nationalYearly: [],
    entitlementYearly: [
      { wy: 2019, label: '2019-20', byRel: { High: { vwap: 3394, volume: 233_882, trades: 1467, tradesPriced: 1467 } }, complete: true },
      { wy: 2022, label: '2022-23', byRel: { High: { vwap: 5797, volume: 62_274, trades: 1467, tradesPriced: 1467 } }, complete: true },
    ],
    provisionalFrom: '2026-06-22',
  },
  zones: [],
  choke: { above: 'A', below: 'B', months: [] },
  flows: { zones: [], byYear: {}, coverage: {} },
  stock: { date: '30-06-2025', total: 0, byState: [], detail: [], churn: [], churnYear: '2025-26' },
  dispersion: { zones: [], cells: [] },
  seasons: { rows: [] },
  stateNet: { byYear: {} },
  ...over,
});

describe('change', () => {
  it('computes a percentage move', () => {
    expect(change(100, 150)).toBe(50);
    expect(change(100, 50)).toBe(-50);
  });
  it('refuses to divide by zero or by a missing value', () => {
    expect(change(0, 50)).toBeNull();
    expect(change(null, 50)).toBeNull();
    expect(change(50, null)).toBeNull();
    expect(change(50, Number.NaN)).toBeNull();
  });
});

describe('decoupling — the site’s central claim', () => {
  it('reproduces the real −90.7% / +70.8% divergence', () => {
    const d = decoupling(bundle(), 2019, 2022);
    expect(d.allocationChange).toBeCloseTo(-90.7, 1);
    expect(d.entitlementChange).toBeCloseTo(70.8, 1);
    expect(d.fromLabel).toBe('2019-20');
    expect(d.toLabel).toBe('2022-23');
  });
  it('is null-safe when a year has no priced trades', () => {
    const d = decoupling(bundle(), 1990, 2022);
    expect(d.allocationChange).toBeNull();
  });
});

describe('chokeSummary', () => {
  const months = [
    { m: '2025-08', above: { vwap: 210, volume: 1, trades: 9 }, below: { vwap: 300, volume: 1, trades: 9 }, spread: 42.4 },
    { m: '2025-09', above: { vwap: 215, volume: 1, trades: 9 }, below: { vwap: 303, volume: 1, trades: 9 }, spread: 41.0 },
    { m: '2026-06', above: { vwap: 141, volume: 1, trades: 9 }, below: { vwap: 94, volume: 1, trades: 9 }, spread: -33.2 },
  ];
  it('counts only the months where downstream cost more', () => {
    const s = chokeSummary(months);
    expect(s.months).toBe(3);
    expect(s.premium).toBe(2);
  });
  it('finds the widest gap', () => {
    expect(chokeSummary(months).widest?.m).toBe('2025-08');
  });
  it('honours the since-month filter', () => {
    expect(chokeSummary(months, '2026-01').months).toBe(1);
  });
  it('reports the median rather than the mean, so one outlier cannot carry it', () => {
    expect(chokeSummary(months).medianSpread).toBe(41);
  });
});

describe('juneEffect', () => {
  const rows = [
    { wy: 2024, wmi: 11, vwap: 145, volume: 294_863, trades: 100 },
    { wy: 2023, wmi: 11, vwap: 150, volume: 290_000, trades: 100 },
    { wy: 2024, wmi: 10, vwap: 333, volume: 81_712, trades: 100 },
    { wy: 2023, wmi: 4, vwap: 320, volume: 80_000, trades: 100 },
  ];
  it('finds June both cheaper and much larger', () => {
    const j = juneEffect(rows);
    expect(j.volumeRatio).toBeGreaterThan(3);
    expect(j.priceRatio).toBeLessThan(0.6);
  });
  it('ignores months with no price rather than treating them as zero', () => {
    const j = juneEffect([...rows, { wy: 2020, wmi: 11, vwap: null, volume: 1000, trades: 2 }]);
    expect(j.junePrice).not.toBeNull();
    expect(Number.isFinite(j.junePrice as number)).toBe(true);
  });
});

describe('rollingMean', () => {
  it('averages over the window', () => {
    expect(rollingMean([1, 2, 3, 4], 2)).toEqual([null, 1.5, 2.5, 3.5]);
  });
  it('keeps a gap as a GAP — never zero-fills, which would draw a fake crash', () => {
    const out = rollingMean([100, null, null, 100], 3);
    // The critical property: a missing month NEVER becomes a 0 that draws the
    // line down to the axis and reads as a price collapse that never happened.
    expect(out.some((v) => v === 0)).toBe(false);
    // A window holding only one real value is too thin to average, so it stays
    // a gap rather than being smoothed into a fabricated point.
    expect(out[2]).toBeNull();
    // Once two real values are in range, it resumes.
    expect(rollingMean([100, 200, null, 300], 3)[1]).toBe(150);
  });
  it('returns null where the window has too little to say', () => {
    expect(rollingMean([5], 3)[0]).toBeNull();
  });
});

describe('anomalies — two DIFFERENT kinds of outlier', () => {
  const d = {
    zones: ['Cheap', 'Normal', 'Dear', 'Disorderly'],
    cells: [
      { z: 0, m: '2025-01', n: 40, p25: 40, p50: 50, p75: 55, rel: 0.3 },
      { z: 1, m: '2025-01', n: 40, p25: 90, p50: 100, p75: 108, rel: 0.18 },
      { z: 2, m: '2025-01', n: 40, p25: 180, p50: 200, p75: 215, rel: 0.175 },
      { z: 3, m: '2025-01', n: 40, p25: 60, p50: 100, p75: 190, rel: 1.3 },
    ],
  };
  it('flags a zone priced far from the month’s market as a LEVEL outlier', () => {
    const a = anomalies(d);
    const zones = a.levelOutliers.map((o) => o.zone);
    expect(zones).toContain('Cheap');
    expect(zones).toContain('Dear');
  });
  it('flags a wide internal spread as a SPREAD outlier, separately', () => {
    const a = anomalies(d);
    expect(a.spreadOutliers.map((o) => o.zone)).toEqual(['Disorderly']);
  });
  it('does NOT call an expensive-but-tight zone disorderly', () => {
    const a = anomalies(d);
    expect(a.spreadOutliers.map((o) => o.zone)).not.toContain('Dear');
  });
  it('ignores cells with too few trades to measure', () => {
    const thin = { zones: ['A', 'B', 'C', 'D'], cells: d.cells.map((c) => ({ ...c, n: 3 })) };
    expect(anomalies(thin).levelOutliers).toHaveLength(0);
  });
});

describe('topZones', () => {
  const zones = [
    { name: 'Big', volume: 100, trades: 10, tradesPriced: 500, vwap: 50, net: -20 },
    { name: 'Small', volume: 10, trades: 100, tradesPriced: 5, vwap: 900, net: 40 },
  ] as Bundle['zones'];
  it('sorts by the requested key', () => {
    expect(topZones(zones, 'volume')[0].name).toBe('Big');
    expect(topZones(zones, 'trades')[0].name).toBe('Small');
    expect(topZones(zones, 'net')[0].name).toBe('Small');
  });
  it('requires a real sample before ranking on price', () => {
    // 'Small' has the higher vwap but only 5 priced trades behind it.
    expect(topZones(zones, 'vwap').map((z) => z.name)).toEqual(['Big']);
  });
});

describe('median', () => {
  it('handles even and odd lengths and empties', () => {
    expect(median([1, 2, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe('formatters', () => {
  it('shows cents on cheap water and none on dear water', () => {
    expect(money(48.94)).toBe('$48.94');
    expect(money(5972.42)).toBe('$5,972');
    expect(perML(281.06)).toBe('$281.06/ML');
  });
  it('scales megalitres to the unit irrigators use', () => {
    expect(ml(500)).toBe('500 ML');
    expect(ml(40_314_767)).toBe('40.31 million ML');
    expect(ml(828_222)).toBe('828.2 GL');
  });
  it('returns an em dash rather than NaN for missing numbers', () => {
    expect(money(null)).toBe('—');
    expect(ml(undefined)).toBe('—');
    expect(perML(null)).toBe('—');
    expect(num(Number.NaN)).toBe('—');
    expect(pct(null)).toBe('—');
    expect(isoDate(null)).toBe('—');
  });
  it('formats dates from both of the source’s conventions', () => {
    expect(auDate('30-06-2025')).toBe('30 June 2025');
    expect(isoDate('2026-08-03')).toBe('3 Aug 2026');
    expect(monthLabel('2026-02')).toBe('Feb 2026');
  });
  it('signs a percentage change', () => {
    expect(signedPct(48.5)).toBe('+48.5%');
    expect(signedPct(-33.2)).toBe('-33.2%');
  });
  it('abbreviates money at scale', () => {
    expect(dollars(587_018_984)).toBe('$587.0m');
    expect(dollars(1_200_000_000)).toBe('$1.20bn');
  });
  it('escapes for HTML, and newlines only in the innerHTML variant', () => {
    expect(esc('<b>&"')).toBe('&lt;b&gt;&amp;&quot;');
    // setAttribute path keeps a RAW newline; the innerHTML path must encode it,
    // and using the wrong one renders a literal "&#10;" to the reader.
    expect(escTip('a\nb')).toBe('a&#10;b');
    expect(esc('a\nb')).toBe('a\nb');
  });
});
