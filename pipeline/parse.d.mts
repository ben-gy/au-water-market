// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Types for the dependency-free pipeline parser. The implementation stays plain
// ESM JavaScript so `node pipeline/collect.mjs` runs on a bare Node 20 with no
// build step, while `npm test` still type-checks against it.

export declare function parseCsvLine(line: string): string[];

export declare const MISSING: Set<string>;
export declare function isMissing(v: unknown): boolean;

export declare function toIso(d: unknown): string | null;
export declare function waterYear(iso: string | null): number | null;
export declare function waterYearLabel(y: number): string;
export declare function waterMonthIndex(iso: string): number;
export declare function toNumber(v: unknown): number | null;

export declare function isPriced(netPrice: number | null, qty: number | null, pricePerMl?: number | null): boolean;
export declare function vwap(sumPrice: number, sumQty: number): number | null;
export declare function quantile(sortedAsc: number[], q: number): number | null;

export interface SnapshotRow { date: string; state: string; quantity: number }
export interface SnapshotPick { date: string; states: SnapshotRow[] }
export declare function pickCompleteSnapshot(
  byDateState: SnapshotRow[],
  opts?: { floor?: number },
): SnapshotPick | null;

export declare function provisionalFrom(maxIso: string | null, weeks?: number): string | null;
export declare function slugify(s: string): string;

export interface Bucket {
  sumPrice: number;
  sumQty: number;
  tradesPriced: number;
  tradesAll: number;
  qtyAll: number;
}
export interface FinishedBucket {
  vwap: number | null;
  volume: number;
  volumePriced: number;
  trades: number;
  tradesPriced: number;
  pricedShare: number;
}
export declare function makeBucket(): Bucket;
export declare function addTrade(b: Bucket, netPrice: number | null, qty: number | null, pricePerMl?: number | null): Bucket;
export declare function finishBucket(b: Bucket): FinishedBucket;
