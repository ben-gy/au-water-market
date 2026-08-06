// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Pure analysis. No DOM, no fetch — so every finding the site asserts can be
// tested against a fixture instead of against a screenshot.

import type { Bundle, ChokeMonth, Dispersion, YearPoint, Zone } from './types.ts';

export interface Insight {
  severity: 'info' | 'warn' | 'alert';
  title: string;
  detail: string;
  /** Where to send the reader to see it for themselves. */
  view?: string;
  zone?: string;
}

export const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Change between two water years, as a percentage. Null-safe on both ends so a
 *  year with no priced trades cannot produce an Infinity that renders as "∞%". */
export function change(from: number | null | undefined, to: number | null | undefined): number | null {
  if (from == null || to == null || !Number.isFinite(from) || !Number.isFinite(to) || from === 0) return null;
  return (to / from - 1) * 100;
}

/** The decoupling: allocation price against high-reliability entitlement price
 *  over the same complete water years. This is the site's central claim, so it
 *  is computed rather than asserted. */
export function decoupling(b: Bundle, fromWy: number, toWy: number) {
  const a0 = b.prices.allocationYearly.find((d) => d.wy === fromWy);
  const a1 = b.prices.allocationYearly.find((d) => d.wy === toWy);
  const e0 = b.prices.entitlementYearly.find((d) => d.wy === fromWy)?.byRel.High;
  const e1 = b.prices.entitlementYearly.find((d) => d.wy === toWy)?.byRel.High;
  return {
    fromLabel: a0?.label ?? '', toLabel: a1?.label ?? '',
    allocationFrom: a0?.vwap ?? null, allocationTo: a1?.vwap ?? null,
    entitlementFrom: e0?.vwap ?? null, entitlementTo: e1?.vwap ?? null,
    allocationChange: change(a0?.vwap, a1?.vwap),
    entitlementChange: change(e0?.vwap, e1?.vwap),
  };
}

/** How often water below the Choke cost more than water above it. */
export function chokeSummary(months: ChokeMonth[], sinceMonth?: string) {
  const rows = months.filter((m) => m.spread != null && (!sinceMonth || m.m >= sinceMonth));
  const premium = rows.filter((m) => (m.spread ?? 0) > 0).length;
  const spreads = rows.map((m) => m.spread as number);
  const widest = rows.reduce<ChokeMonth | null>((a, m) => ((m.spread ?? -1e9) > (a?.spread ?? -1e9) ? m : a), null);
  return { months: rows.length, premium, medianSpread: median(spreads), widest };
}

/** Liquidity leaderboard: which zones actually have a working market. */
export function topZones(zones: Zone[], by: 'volume' | 'trades' | 'vwap' | 'net', n = 12): Zone[] {
  const scored = zones.filter((z) => (by === 'vwap' ? z.tradesPriced >= 200 : true));
  return [...scored].sort((a, b) => {
    const av = (a[by] ?? 0) as number, bv = (b[by] ?? 0) as number;
    return by === 'net' ? bv - av : bv - av;
  }).slice(0, n);
}

/**
 * Anomaly detection over zone-months.
 *
 * Two distinct things are flagged and they are NOT the same finding:
 *  - a zone whose price level is far from the market's that month (an isolated
 *    or constrained zone), and
 *  - a zone whose INTERNAL spread is wide (a disorderly market, where two
 *    neighbours paid very different prices for identical water).
 * Conflating them would call every expensive zone "disorderly".
 */
/** Below this, a relative spread is arithmetic rather than economics: the
 *  cheapest water year on record averaged $20/ML, so a median unit price of a
 *  dollar or two is residual nominal consideration, and dividing by it produced
 *  a front-page card reading "12,222% of the median ($1/ML)". */
const MIN_MEANINGFUL_PRICE = 5;

export function anomalies(d: Dispersion, minN = 20, topN = 8) {
  const byMonth = new Map<string, { z: number; p50: number; rel: number | null; n: number }[]>();
  for (const c of d.cells) {
    if (c.n < minN || !(c.p50 >= MIN_MEANINGFUL_PRICE)) continue;
    const arr = byMonth.get(c.m) ?? [];
    arr.push({ z: c.z, p50: c.p50, rel: c.rel, n: c.n });
    byMonth.set(c.m, arr);
  }
  const levelOutliers: { m: string; zone: string; p50: number; marketMedian: number; ratio: number; n: number }[] = [];
  const spreadOutliers: { m: string; zone: string; rel: number; p50: number; p25: number; p75: number; n: number }[] = [];
  const cellByKey = new Map(d.cells.map((c) => [`${c.z}|${c.m}`, c]));
  for (const [m, arr] of byMonth) {
    if (arr.length < 4) continue;
    const mm = median(arr.map((a) => a.p50));
    if (mm == null || mm <= 0) continue;
    for (const a of arr) {
      const ratio = a.p50 / mm;
      if (ratio >= 1.6 || ratio <= 0.55) {
        levelOutliers.push({ m, zone: d.zones[a.z], p50: a.p50, marketMedian: mm, ratio, n: a.n });
      }
      if (a.rel != null && a.rel >= 0.8) {
        const c = cellByKey.get(`${a.z}|${m}`);
        // Carry the actual quartile prices. A spread expressed as a percentage
        // of the median stops communicating anything once it passes a few
        // hundred percent; "$10/ML to $605/ML" always does.
        spreadOutliers.push({ m, zone: d.zones[a.z], rel: a.rel, p50: a.p50, p25: c?.p25 ?? a.p50, p75: c?.p75 ?? a.p50, n: a.n });
      }
    }
  }
  levelOutliers.sort((a, b) => Math.abs(b.ratio - 1) - Math.abs(a.ratio - 1));
  spreadOutliers.sort((a, b) => b.rel - a.rel);
  return { levelOutliers: levelOutliers.slice(0, topN), spreadOutliers: spreadOutliers.slice(0, topN) };
}

/** The June sell-down, measured rather than asserted. */
export function juneEffect(rows: Bundle['seasons']['rows']) {
  const june = rows.filter((r) => r.wmi === 11 && r.vwap != null);
  const others = rows.filter((r) => r.wmi !== 11 && r.vwap != null);
  const juneVol = median(june.map((r) => r.volume));
  const otherVol = median(others.map((r) => r.volume));
  const junePrice = median(june.map((r) => r.vwap as number));
  const otherPrice = median(others.map((r) => r.vwap as number));
  return {
    juneVolume: juneVol, otherVolume: otherVol,
    junePrice, otherPrice,
    volumeRatio: juneVol != null && otherVol ? juneVol / otherVol : null,
    priceRatio: junePrice != null && otherPrice ? junePrice / otherPrice : null,
  };
}

/** The cards on the Insights panel. Every one names its numbers. */
export function buildInsights(b: Bundle): Insight[] {
  const out: Insight[] = [];
  const h = b.meta.headline;
  const complete = b.prices.allocationYearly.filter((d) => d.complete);

  if (h.allocationPeak && h.allocationTrough && h.allocationLatest) {
    const d = decoupling(b, h.allocationPeak.wy, 2022);
    if (d.allocationChange != null && d.entitlementChange != null) {
      out.push({
        severity: 'alert',
        title: 'The two water markets have decoupled',
        detail: `Between ${d.fromLabel} and ${d.toLabel} the price of water for one season fell ${Math.abs(d.allocationChange).toFixed(0)}% — from ${fmt(d.allocationFrom)} to ${fmt(d.allocationTo)} per megalitre — while the price of a permanent high-reliability entitlement rose ${d.entitlementChange.toFixed(0)}%, from ${fmt(d.entitlementFrom)} to ${fmt(d.entitlementTo)}. The asset kept appreciating through the wettest years on record.`,
        view: 'prices',
      });
    }
  }

  const ch = chokeSummary(b.choke.months, '2023-07');
  if (ch.months >= 12 && ch.widest) {
    out.push({
      severity: 'warn',
      title: 'A bottleneck in the river has a price',
      detail: `Water below the Barmah Choke cost more than water above it in ${ch.premium} of the last ${ch.months} months, by a median of ${ch.medianSpread?.toFixed(1)}%. The widest gap was ${ch.widest.spread?.toFixed(1)}% in ${ch.widest.m}. Both zones sit on the same river; the difference is that the channel between them physically cannot carry the water.`,
      view: 'choke',
    });
  }

  const j = juneEffect(b.seasons.rows);
  if (j.volumeRatio && j.priceRatio) {
    out.push({
      severity: 'info',
      title: 'Every June, the market floods and the price falls',
      detail: `Allocations reset on 1 July, so unused water is worthless the next day. In a typical June ${j.volumeRatio.toFixed(1)}× as much water changes hands as in an ordinary month, at ${(100 - j.priceRatio * 100).toFixed(0)}% below the typical price. Sellers who wait pay for waiting.`,
      view: 'seasons',
    });
  }

  const an = anomalies(b.dispersion);
  if (an.spreadOutliers.length) {
    const s = an.spreadOutliers[0];
    out.push({
      severity: 'warn',
      title: 'In some places, neighbours pay very different prices',
      detail: `Across ${s.n} trades inside ${s.zone} in ${s.m}, the cheapest quarter went for under ${fmt(s.p25)} a megalitre while the dearest quarter went for over ${fmt(s.p75)} — for water in the same zone in the same month. In a well-informed market that gap should be small.`,
      view: 'dispersion',
    });
  }

  const latest = complete.slice(-1)[0];
  const prior = complete.slice(-2)[0];
  if (latest && prior) {
    const c = change(prior.vwap, latest.vwap);
    if (c != null && Math.abs(c) >= 25) {
      out.push({
        severity: c > 0 ? 'alert' : 'info',
        title: `Allocation prices ${c > 0 ? 'rose' : 'fell'} ${Math.abs(c).toFixed(0)}% in ${latest.label}`,
        detail: `The southern Basin's volume-weighted allocation price moved from ${fmt(prior.vwap)} in ${prior.label} to ${fmt(latest.vwap)} in ${latest.label}, across ${latest.trades.toLocaleString('en-AU')} trades.`,
        view: 'prices',
      });
    }
  }

  // Only states that actually reported. Comparing a real turnover rate against a
  // state that simply stopped filing would be a finding about paperwork
  // presented as a finding about markets.
  const churn = [...b.stock.churn]
    .filter((c) => c.stock > 100_000 && c.reported && c.rate != null)
    .sort((a, b2) => (b2.rate as number) - (a.rate as number));
  if (churn.length >= 2) {
    const top = churn[0], bottom = churn[churn.length - 1];
    out.push({
      severity: 'info',
      title: 'Holding a lot of water is not the same as trading it',
      detail: `In ${b.stock.churnYear}, ${top.state} turned over ${((top.rate as number) * 100).toFixed(1)}% of its ${(top.stock / 1e6).toFixed(2)} million ML of entitlements, while ${bottom.state} turned over just ${((bottom.rate as number) * 100).toFixed(1)}% of its ${(bottom.stock / 1e6).toFixed(2)} million ML.`,
      view: 'stock',
    });
  }

  return out;
}

const fmt = (v: number | null): string => (v == null ? '—' : v >= 1000 ? `$${Math.round(v).toLocaleString('en-AU')}` : `$${v.toFixed(2)}`);

/** Rolling mean over a numeric series, keeping nulls as gaps rather than zeroes.
 *  A zero-filled gap in a price chart draws a line to the floor and reads as a
 *  crash that never happened. */
export function rollingMean(xs: (number | null)[], window: number): (number | null)[] {
  return xs.map((_, i) => {
    const slice = xs.slice(Math.max(0, i - window + 1), i + 1).filter((v): v is number => v != null);
    if (slice.length < Math.min(window, 2)) return null;
    return slice.reduce((a, b) => a + b, 0) / slice.length;
  });
}

/** The set of complete water years, newest first — used by every year selector
 *  so an in-progress season cannot be the default anywhere. */
export const completeYears = (years: YearPoint[]): YearPoint[] => years.filter((y) => y.complete);
