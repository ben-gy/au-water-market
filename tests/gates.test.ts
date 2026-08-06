// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Gates against the ACTUAL shipped data files, not fixtures.
//
// These are the assertions that catch a bad pipeline run before it reaches a
// reader: internal consistency, plausible magnitudes, and the specific silent
// corruptions this source is capable of. If the Bureau changes the meaning of a
// column, this is where it should surface.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bundle } from '../src/types.ts';

const DATA = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'data');
const read = <T>(f: string): T => JSON.parse(readFileSync(path.join(DATA, f), 'utf8')) as T;

const meta = read<Bundle['meta']>('meta.json');
const prices = read<Bundle['prices']>('prices.json');
const stock = read<Bundle['stock']>('stock.json');
const choke = read<Bundle['choke']>('choke.json');
const flows = read<Bundle['flows']>('flows.json');
const zones = read<{ zones: Bundle['zones'] }>('zones.json').zones;
const dispersion = read<Bundle['dispersion']>('dispersion.json');
const seasons = read<Bundle['seasons']>('seasons.json');
const stateNet = read<Bundle['stateNet']>('statenet.json');

describe('meta', () => {
  it('covers the whole published record', () => {
    expect(meta.allocation.rows).toBeGreaterThan(400_000);
    expect(meta.entitlements.rows).toBeGreaterThan(140_000);
    expect(meta.onIssue.rows).toBeGreaterThan(500_000);
    expect(meta.allocation.first <= '2008-07-01').toBe(true);
  });
  it('every row carries a usable date — an undated row would vanish silently', () => {
    expect(meta.allocation.undated).toBe(0);
    expect(meta.entitlements.undated).toBe(0);
  });
  it('the zero-price share sits in the band the price logic assumes', () => {
    // If this moves, every VWAP on the site moves ~40% with it.
    expect(meta.allocation.zeroPriceShare).toBeGreaterThan(0.25);
    expect(meta.allocation.zeroPriceShare).toBeLessThan(0.6);
  });
  it('marks a provisional window rather than presenting the tail as complete', () => {
    expect(meta.provisionalFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(meta.provisionalFrom! < meta.allocation.last).toBe(true);
  });
});

describe('prices', () => {
  it('RECONCILES: yearly and monthly volume agree to rounding', () => {
    const y = prices.allocationYearly.reduce((a, d) => a + d.volume, 0);
    const m = prices.allocationMonthly.reduce((a, d) => a + d.volume, 0);
    expect(Math.abs(y - m)).toBeLessThan(prices.allocationYearly.length + prices.allocationMonthly.length);
  });
  it('RECONCILES: yearly trade counts equal the southern-MDB row count exactly', () => {
    const t = prices.allocationYearly.reduce((a, d) => a + d.trades, 0);
    expect(t).toBe(meta.allocation.southernRows);
  });
  it('has no negative or absurd prices', () => {
    for (const d of prices.allocationYearly) {
      if (d.vwap == null) continue;
      expect(d.vwap).toBeGreaterThan(0);
      expect(d.vwap).toBeLessThan(10_000);
    }
  });
  it('marks exactly the seasons that have finished as complete', () => {
    const incomplete = prices.allocationYearly.filter((d) => !d.complete);
    // At most one season can be under way at a time.
    expect(incomplete.length).toBeLessThanOrEqual(1);
    if (incomplete.length) expect(incomplete[0].wy).toBe(Math.max(...prices.allocationYearly.map((d) => d.wy)));
  });
  it('every headline is drawn from a COMPLETE water year', () => {
    for (const k of ['allocationLatest', 'allocationPeak', 'allocationTrough'] as const) {
      expect(meta.headline[k]?.complete).toBe(true);
    }
    expect(meta.headline.entitlementLatest?.complete).toBe(true);
    expect(meta.headline.currentSeason?.complete).toBe(false);
  });
  it('THE CENTRAL CLAIM holds in the shipped data: the markets decoupled', () => {
    // The claim is DIRECTIONAL — one market collapsed while the other rose —
    // and the gate asserts that, not a magnitude. An earlier version demanded
    // ">50%" because leases were inflating the entitlement rise to 71%; when
    // the lease filter landed and the honest figure became 14.9%, that gate
    // failed. It was measuring the artefact, not the finding.
    const a19 = prices.allocationYearly.find((d) => d.wy === 2019)!.vwap!;
    const a22 = prices.allocationYearly.find((d) => d.wy === 2022)!.vwap!;
    const e19 = prices.entitlementYearly.find((d) => d.wy === 2019)!.byRel.High.vwap;
    const e22 = prices.entitlementYearly.find((d) => d.wy === 2022)!.byRel.High.vwap;
    expect(a22 / a19 - 1).toBeLessThan(-0.85);   // allocation collapsed
    expect(e22 / e19 - 1).toBeGreaterThan(0.05); // entitlement rose over the SAME years
  });
  it('LEASE CONTAMINATION GUARD: entitlement prices exclude limited-term leases', () => {
    // Leases are 0.9% of rows but large and cheap, so in a volume-weighted
    // average they dominate: pooling them halves the 2019-20 price and turns a
    // +15% rise into +71%. If this count ever hits zero, the filter has broken.
    expect(meta.entitlements.leases).toBeGreaterThan(1000);
    const e19 = prices.entitlementYearly.find((d) => d.wy === 2019)!.byRel.High.vwap;
    // Pooled it was $3,404/ML; lease-free it is ~$5,409. Anything near the
    // pooled figure means leases have crept back in.
    expect(e19).toBeGreaterThan(4500);
  });
  it('MIS-KEYED PRICE GUARD: no allocation year exceeds a plausible ceiling', () => {
    // The file contains implied unit prices up to $620,000/ML.
    expect(meta.allocation.misKeyed).toBeGreaterThan(100);
    for (const d of prices.allocationYearly) {
      if (d.vwap != null) expect(d.vwap).toBeLessThan(2000);
    }
  });
  it('reports the priced share for every year, so a thin price is visible', () => {
    for (const d of prices.allocationYearly) {
      expect(d.pricedShare).toBeGreaterThanOrEqual(0);
      expect(d.pricedShare).toBeLessThanOrEqual(1);
    }
  });
});

describe('stock — the ragged-snapshot guard, on the real file', () => {
  it('uses a snapshot where all eight states are present', () => {
    expect(stock.byState).toHaveLength(8);
  });
  it('does NOT use the newest date, which is a partial', () => {
    // The newest date in the file has only NSW plus a 170 ML SA stub.
    const key = (d: string) => [d.slice(6), d.slice(3, 5), d.slice(0, 2)].join('');
    const newest = [...meta.onIssue.snapshotDates].sort((a, b) => key(b).localeCompare(key(a)))[0];
    expect(stock.date).not.toBe(newest);
  });
  it('South Australia is millions of ML, not the 170 ML stub', () => {
    const sa = stock.byState.find((s) => s.state === 'South Australia')!;
    expect(sa.ml).toBeGreaterThan(1_000_000);
  });
  it('the national total is plausible and equals the sum of its states', () => {
    const sum = stock.byState.reduce((a, s) => a + s.ml, 0);
    expect(Math.abs(sum - stock.total)).toBeLessThan(10);
    expect(stock.total).toBeGreaterThan(30e6);
    expect(stock.total).toBeLessThan(60e6);
  });
  it('churn is a rate between 0 and 1 where reported, never a raw volume', () => {
    for (const c of stock.churn) {
      if (c.rate == null) continue;
      expect(c.rate).toBeGreaterThan(0);
      expect(c.rate).toBeLessThan(1);
    }
  });
  it('churn is measured over a COMPLETE season, not the one under way', () => {
    // This shipped wrong once: churn was computed on the in-progress water
    // year, dividing five weeks of trading by a full year's stock and reporting
    // "NSW traded 0.5% of its water" — a figure that would shrink every time
    // the pipeline ran early in July.
    const incomplete = prices.allocationYearly.filter((d) => !d.complete).map((d) => d.label);
    expect(incomplete).not.toContain(stock.churnYear);
    const complete = prices.allocationYearly.filter((d) => d.complete).map((d) => d.label);
    expect(complete).toContain(stock.churnYear);
  });
  it('the churn leader is a plausible annual turnover, not a partial-year artefact', () => {
    const top = [...stock.churn]
      .filter((c) => c.stock > 100_000 && c.reported && c.rate != null)
      .sort((a, b) => (b.rate as number) - (a.rate as number))[0];
    expect(top.rate as number).toBeGreaterThan(0.01); // a real market turns over >1% a year
  });

  // SUPPRESS, DON'T CLAMP — a reporting gap must never render as 0% liquidity.
  it('SUPPRESSES churn for states that stopped reporting, rather than showing 0%', () => {
    // Western Australia filed 329 entitlement trades in 2024-25 and exactly 0 in
    // 2025-26. Shown as "0.00%" beside Victoria's 3.75% it claims 4.49 million ML
    // of West Australian water sat frozen for a year. It did not; nobody filed.
    const wa = stock.churn.find((c) => c.state === 'Western Australia');
    expect(wa).toBeDefined();
    expect(wa!.trades).toBe(0);
    expect(wa!.reported).toBe(false);
    expect(wa!.rate).toBeNull();
  });
  it('never publishes a rate of exactly 0 — that value can only mean "did not report"', () => {
    for (const c of stock.churn) {
      if (c.rate === null) { expect(c.reported).toBe(false); continue; }
      expect(c.reported).toBe(true);
      expect(c.rate).toBeGreaterThan(0);
    }
  });
  it('states that have never reported (NT, ACT) are suppressed too, not shown as illiquid', () => {
    for (const s of ['Northern Territory', 'Australian Capital Territory']) {
      const c = stock.churn.find((x) => x.state === s)!;
      expect(c.reported).toBe(false);
      expect(c.rate).toBeNull();
    }
  });
});

describe('nominal-consideration guard, on the real file', () => {
  it('records how many trades carried a token price', () => {
    expect(meta.allocation.nominalPrice).toBeGreaterThan(1000);
    // If this ever exceeded the zero-price count, the column's meaning changed.
    expect(meta.allocation.nominalPrice).toBeLessThan(meta.allocation.zeroPrice);
  });
  it('no dispersion cell has a median low enough to manufacture a spread', () => {
    // A median of $1/ML produced a front-page card reading "12,222% of the
    // median". The cheapest water year on record averaged $20/ML.
    for (const c of dispersion.cells) expect(c.p50).toBeGreaterThanOrEqual(5);
  });
  it('no relative spread is absurd any more', () => {
    const worst = Math.max(...dispersion.cells.map((c) => c.rel ?? 0));
    // 47.6x is a REAL bimodal groundwater zone-month (median $12.50/ML against an
    // upper quartile of $605), not an artefact — the $1 noise that produced
    // 339x and 33,948x readings is gone. Views express spreads this large as a
    // dollar range rather than a percentage of a small median.
    expect(worst).toBeLessThan(60);
  });
  it('the Barmah Choke gap is no longer driven by two mis-keyed rows', () => {
    // Nov 2024 read +197.4% because two rows at ~$7,340/ML supplied 59% of the
    // month's dollars. With the ceiling applied it reads +26.9%.
    const nov = choke.months.find((m) => m.m === '2024-11');
    expect(nov).toBeDefined();
    expect(nov!.spread!).toBeLessThan(60);
    expect(nov!.below!.vwap).toBeLessThan(250);
  });
});

describe('choke', () => {
  it('only reports months where BOTH zones had a real sample', () => {
    for (const m of choke.months) {
      expect(m.above!.trades).toBeGreaterThanOrEqual(5);
      expect(m.below!.trades).toBeGreaterThanOrEqual(5);
    }
  });
  it('the spread is consistent with the two prices it is derived from', () => {
    for (const m of choke.months.slice(0, 50)) {
      const expected = (m.below!.vwap / m.above!.vwap - 1) * 100;
      expect(Math.abs(m.spread! - expected)).toBeLessThan(0.15);
    }
  });
  it('THE FINDING: water below the Choke usually costs more', () => {
    const recent = choke.months.filter((m) => m.m >= '2023-07');
    const premium = recent.filter((m) => (m.spread ?? 0) > 0).length;
    expect(recent.length).toBeGreaterThan(24);
    expect(premium / recent.length).toBeGreaterThan(0.75);
  });
});

describe('flows', () => {
  it('indexes every pair into the zone name list', () => {
    for (const [, rows] of Object.entries(flows.byYear)) {
      for (const [o, d] of rows) {
        expect(flows.zones[o]).toBeTruthy();
        expect(flows.zones[d]).toBeTruthy();
      }
    }
  });
  it('contains NO self-loops — an intra-zone trade moves no water anywhere', () => {
    for (const rows of Object.values(flows.byYear)) {
      for (const [o, d] of rows) expect(o).not.toBe(d);
    }
  });
  it('publishes the coverage share for every year, so the cap is never silent', () => {
    for (const y of Object.keys(flows.byYear)) {
      const c = flows.coverage[y];
      expect(c).toBeDefined();
      expect(c.share).toBeGreaterThan(0);
      expect(c.share).toBeLessThanOrEqual(1);
      expect(c.shown).toBeLessThanOrEqual(c.pairs);
    }
  });
  it('every volume is positive', () => {
    for (const rows of Object.values(flows.byYear)) for (const [, , v] of rows) expect(v).toBeGreaterThan(0);
  });
});

describe('zones', () => {
  it('slugs are unique — they are the drill-down’s address', () => {
    const s = new Set(zones.map((z) => z.slug));
    expect(s.size).toBe(zones.length);
  });
  it('no slug is empty', () => {
    for (const z of zones) expect(z.slug.length).toBeGreaterThan(0);
  });
  it('net balance equals imported minus exported', () => {
    for (const z of zones.slice(0, 200)) expect(Math.abs(z.net - (z.imported - z.exported))).toBeLessThan(2);
  });
  it('partner indices resolve to real zone names', () => {
    for (const z of zones.slice(0, 100)) {
      for (const [i] of z.partners) expect(flows.zones[i]).toBeTruthy();
    }
  });
  it('monthly series are chronological and carry no NaN', () => {
    for (const z of zones.slice(0, 60)) {
      let prev = '';
      for (const [m, v] of z.monthly) {
        expect(m > prev).toBe(true);
        prev = m;
        if (v != null) expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('dispersion', () => {
  it('quartiles are ordered', () => {
    for (const c of dispersion.cells) {
      expect(c.p25).toBeLessThanOrEqual(c.p50);
      expect(c.p50).toBeLessThanOrEqual(c.p75);
    }
  });
  it('every cell indexes a real zone and meets the sample floor', () => {
    for (const c of dispersion.cells) {
      expect(dispersion.zones[c.z]).toBeTruthy();
      expect(c.n).toBeGreaterThanOrEqual(8);
    }
  });
  it('relative spread is non-negative', () => {
    for (const c of dispersion.cells) if (c.rel != null) expect(c.rel).toBeGreaterThanOrEqual(0);
  });
});

describe('seasons and state balances', () => {
  it('month indices are water-year months', () => {
    for (const r of seasons.rows) {
      expect(r.wmi).toBeGreaterThanOrEqual(0);
      expect(r.wmi).toBeLessThanOrEqual(11);
    }
  });
  it('THE JUNE EFFECT is present in the shipped data', () => {
    const june = seasons.rows.filter((r) => r.wmi === 11);
    const other = seasons.rows.filter((r) => r.wmi !== 11);
    const med = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
    expect(med(june.map((r) => r.volume))).toBeGreaterThan(med(other.map((r) => r.volume)) * 1.5);
  });
  it('cross-border balances sum to roughly zero — one state’s export is another’s import', () => {
    for (const rows of Object.values(stateNet.byYear)) {
      const net = rows.reduce((a, r) => a + r.net, 0);
      const gross = rows.reduce((a, r) => a + Math.abs(r.net), 0);
      if (gross > 0) expect(Math.abs(net) / gross).toBeLessThan(0.02);
    }
  });
});
