// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

export interface YearPoint {
  wy: number;
  label: string;
  vwap: number | null;
  volume: number;
  trades: number;
  pricedShare: number;
  /** False for the season currently under way. Never headline an incomplete year. */
  complete: boolean;
}

export interface MonthPoint {
  m: string;
  vwap: number | null;
  volume: number;
  trades: number;
  tradesPriced: number;
  pricedShare: number;
  /** Inside the reporting-lag window: real trades, but a biased sample. */
  provisional: boolean;
}

export interface RelPoint { vwap: number; volume: number; trades: number; tradesPriced: number }
export interface EntYear { wy: number; label: string; byRel: Record<string, RelPoint>; complete: boolean }

export interface Prices {
  allocationMonthly: MonthPoint[];
  allocationYearly: YearPoint[];
  nationalYearly: { wy: number; label: string; vwap: number | null; volume: number; trades: number; turnover: number }[];
  entitlementYearly: EntYear[];
  provisionalFrom: string | null;
}

export interface Zone {
  name: string;
  slug: string;
  state: string | null;
  system: string | null;
  mdb: string | null;
  trades: number;
  tradesPriced: number;
  volume: number;
  vwap: number | null;
  pricedShare: number;
  exported: number;
  imported: number;
  intra: number;
  net: number;
  first: string | null;
  last: string | null;
  partners: [number, number][];
  monthly: [string, number | null, number][];
}

export interface ChokeMonth {
  m: string;
  above: { vwap: number; volume: number; trades: number } | null;
  below: { vwap: number; volume: number; trades: number } | null;
  spread: number | null;
}

export interface Coverage { pairs: number; shown: number; ml: number; shownMl: number; share: number }

export interface Flows {
  zones: string[];
  byYear: Record<string, [number, number, number, number][]>;
  coverage: Record<string, Coverage>;
}

export interface Stock {
  date: string;
  total: number;
  byState: { state: string; ml: number; count: number }[];
  detail: { state: string; reliability: string; resource: string; ml: number }[];
  /** `rate` is null where the state did not report enough entitlement trades
   *  this year to measure liquidity at all — a reporting gap, not a frozen
   *  market. Never render a null as 0%. */
  churn: { state: string; stock: number; traded: number; trades: number; priorMedianTrades: number; reported: boolean; rate: number | null }[];
  churnYear: string;
}

export interface Dispersion {
  zones: string[];
  cells: { z: number; m: string; n: number; p25: number; p50: number; p75: number; rel: number | null }[];
}

export interface SeasonRow { wy: number; wmi: number; vwap: number | null; volume: number; trades: number }

export interface StateNet { byYear: Record<string, { state: string; in: number; out: number; net: number }[]> }

export interface Meta {
  generated: string;
  sources: Record<string, { url: string; bytes: number; lastModified: string | null }>;
  allocation: { rows: number; southernRows: number; undated: number; zeroPrice: number; zeroPriceShare: number; nominalPrice: number; misKeyed: number; first: string; last: string };
  entitlements: { rows: number; undated: number; priced: number; leases: number; first: string; last: string };
  onIssue: { rows: number; snapshot: string; total: number; snapshotDates: string[] };
  provisionalFrom: string | null;
  zones: number;
  flowCoverage: Record<string, Coverage>;
  headline: {
    allocationLatest: YearPoint | null;
    allocationPeak: YearPoint | null;
    allocationTrough: YearPoint | null;
    entitlementLatest: EntYear | null;
    entitlementTrough: EntYear | null;
    currentSeason: YearPoint | null;
    stockTotal: number;
    stockDate: string;
  };
  notes: Record<string, string>;
}

export interface Bundle {
  meta: Meta;
  prices: Prices;
  zones: Zone[];
  choke: { above: string; below: string; months: ChokeMonth[] };
  flows: Flows;
  stock: Stock;
  dispersion: Dispersion;
  seasons: { rows: SeasonRow[] };
  stateNet: StateNet;
}
