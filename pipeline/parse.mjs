// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Pure parsing and aggregation for the BOM water market files. Deliberately
// dependency-free and free of any I/O so that `npm test` can import it on CI
// without installing the pipeline's own tree — a split the factory learned the
// hard way when a test suite could only run after a 292 MB download.
//
// Every function here exists because the source file has a way of being wrong
// that still renders as a believable chart. The comments name the failure.

/**
 * One CSV record. Every field in these files is quoted, and free-text zone
 * names contain commas ("Very High (Class 1, 2, 5, 6, 9 & Licences)") and the
 * occasional embedded quote, so splitting on "," is not an option.
 */
export function parseCsvLine(line) {
  const out = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { out.push(field); field = ''; }
    else field += c;
  }
  out.push(field);
  return out;
}

/** Sentinels. `NA`, `Undefined` and `Unassigned` are three DIFFERENT things in
 *  these files and none of them is an empty string. Treating them as equal is
 *  how a "no data" zone becomes a real one with a name. */
export const MISSING = new Set(['', 'NA', 'N/A', 'null', 'NULL']);
export const isMissing = (v) => v == null || MISSING.has(String(v).trim());

/** dd-mm-yyyy → yyyy-mm-dd. The files are NOT ISO, and dd-mm vs mm-dd is
 *  indistinguishable for the first twelve days of any month — which is why this
 *  validates the ranges rather than trusting the order. */
export function toIso(d) {
  if (isMissing(d)) return null;
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(d).trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const day = +dd, mon = +mm, year = +yyyy;
  if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
  if (year < 1900 || year > 2200) return null;
  return `${yyyy}-${mm}-${dd}`;
}

/** Australian water year runs 1 July → 30 June. `waterYear('2026-02-14')` is
 *  2025, i.e. the 2025-26 season. Using the calendar year splits every season
 *  in half and destroys the June sell-down signal entirely. */
export function waterYear(iso) {
  if (!iso) return null;
  const y = +iso.slice(0, 4), m = +iso.slice(5, 7);
  return m >= 7 ? y : y - 1;
}
export const waterYearLabel = (y) => `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
/** 0 = July … 11 = June. The seasonal clock is meaningless on calendar months. */
export const waterMonthIndex = (iso) => (+iso.slice(5, 7) + 5) % 12;

export function toNumber(v) {
  if (isMissing(v)) return null;
  const n = Number(String(v).trim());
  return Number.isFinite(n) ? n : null;
}

/**
 * THE ZERO-PRICE TRAP — the single most dangerous thing in this dataset.
 *
 * 43.6% of all allocation rows (41.3% within the southern Basin) carry
 * net_price = 0. They are not free water: they are zero-consideration
 * transfers — carryover between a holder's own accounts, intra-corporate
 * movements, environmental water holder reallocations. They are REAL volume
 * and must be counted in any flow, but including them in a price average drags
 * every headline down roughly 40% while the chart still looks entirely
 * plausible.
 *
 * So the rule is two different filters over one table: priced rows drive price,
 * all rows drive volume. `isPriced` is the price filter and nothing else.
 *
 * NOMINAL CONSIDERATION is the second half of the same trap, and `net_price > 0`
 * alone does not catch it. 5,558 southern-Basin rows (2.27% of otherwise-priced
 * rows) carry a token amount — very often exactly $1.00 for an entire parcel —
 * which is a legal formality, not a market price. The tell is that the source's
 * OWN `price_per_ML` column reads 0 for them: the Bureau does not regard them as
 * priced either. Deferring to that judgement rather than inventing a dollar
 * threshold, this excludes them too.
 *
 * It matters twice over. It lifts the 2022-23 trough from $48.94 to $54.38
 * (+11%), and — because a cluster of $1.00 trades drags a zone-month's MEDIAN to
 * $1.00 — it removes price-dispersion readings of "12,222% of the median" that
 * are pure arithmetic noise dressed up as a market finding.
 */
export const isPriced = (netPrice, qty, pricePerMl) =>
  netPrice != null && qty != null && netPrice > 0 && qty > 0
  && !(pricePerMl != null && pricePerMl <= 0);

/**
 * THE MIS-KEYED ALLOCATION PRICE.
 *
 * An allocation is one season's water. An entitlement is that water every year
 * for ever. An allocation can therefore never rationally cost more than the
 * entitlement — you would buy the entitlement instead — and Australia's
 * allocation market has never legitimately cleared much above $1,000/ML even at
 * the 2019-20 drought peak, when the whole-year volume-weighted average was
 * $528.
 *
 * The file nevertheless contains implied unit prices up to $620,000/ML. These
 * are keying errors, very often an entitlement price written into an allocation
 * record. There are only 349 of them above $2,000/ML (0.13% of priced rows), but
 * they carry $99.6 million, and in a VOLUME-weighted average that is decisive:
 * two rows at $7,335 and $7,350/ML in November 2024 supplied 59.4% of every
 * dollar traded in their zone that month and lifted its price from $163/ML to
 * $389/ML — which is exactly where the site's "widest gap: +197.4%" headline
 * came from. The gap was two bad rows.
 *
 * The ceiling is deliberately set at 2x the highest price the market has ever
 * plausibly reached, so it removes keying errors without touching a real drought
 * spike. Excluded from PRICE only; the volume is still real water that moved.
 */
export const MAX_PLAUSIBLE_ALLOCATION_PRICE = 2000;
export const isPlausibleAllocationPrice = (netPrice, qty) =>
  netPrice != null && qty != null && qty > 0 && netPrice / qty <= MAX_PLAUSIBLE_ALLOCATION_PRICE;

/**
 * Volume-weighted average price.
 *
 * NEVER average the file's own `price_per_ML` column: it is integer-rounded per
 * row, so a 1 ML novelty trade at $900 carries exactly as much weight as a
 * 10,000 ML deal at $180. Always sum(net_price) / sum(quantity_traded).
 */
export function vwap(sumPrice, sumQty) {
  if (!(sumQty > 0)) return null;
  return sumPrice / sumQty;
}

/**
 * Is this entitlement trade a LIMITED-TERM LEASE rather than a sale?
 *
 * It matters because the site's whole premise is that an entitlement is the
 * right to water *for ever*. Leasing one for three years is a different product
 * at a different price, and pooling the two answers neither question.
 *
 * Only 281 of 31,128 priced high-reliability southern-Basin rows (0.90%) are
 * genuine leases — but they are large and cheap per megalitre, so in a
 * VOLUME-weighted average they punch far above their count: they drag the
 * 2019-20 price down 37% on their own, and pooling them turned a +15% rise
 * across the drought years into a +71% one.
 *
 * THE TRAP IN THE OBVIOUS TEST. `duration_of_lease` is not blank-or-a-term: it
 * holds '' for 17,044 rows and the STRING '0' for 13,802 more, and '0' means
 * "not a lease". Testing `duration !== ''` therefore classifies 13,802 ordinary
 * transfers as leases, and because agencies switched from blank to '0' in
 * 2016-17 it invents a reporting break where 94% of the market appears to
 * become leases overnight. Only a duration strictly greater than zero is a
 * lease.
 */
export function isLease(duration) {
  if (isMissing(duration)) return false;
  const n = Number(String(duration).trim());
  return Number.isFinite(n) && n > 0;
}

/** Median and inter-quartile spread for the dispersion view. Sorted ascending;
 *  linear interpolation between ranks, the same convention as numpy's default. */
export function quantile(sortedAsc, q) {
  const n = sortedAsc.length;
  if (n === 0) return null;
  if (n === 1) return sortedAsc[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  if (lo === hi) return sortedAsc[lo];
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/**
 * THE RAGGED-SNAPSHOT TRAP, and a 16,231x error.
 *
 * Entitlements_On_Issue carries four `reporting_as_at_date` values, and they
 * are NOT four national snapshots. As at this build:
 *
 *   30-06-2024  all 8 states
 *   30-06-2025  all 8 states           <- the newest COMPLETE picture
 *   30-06-2026  QLD, VIC, WA only
 *   31-07-2026  NSW, plus a single 170 ML South Australia row
 *
 * Take max(date) the obvious way and the site reports South Australia holding
 * 170 ML instead of 2,759,336 ML, and six of eight states holding nothing at
 * all. The 170 renders as a small bar next to large ones: it looks like a fact.
 *
 * The fix is to refuse to mix dates for a national total. This returns the most
 * recent date at which EVERY state that has ever reported is present AND holds
 * at least `floor` of its own historical maximum — so a state that appears with
 * a token row cannot qualify a snapshot.
 */
export function pickCompleteSnapshot(byDateState, { floor = 0.5 } = {}) {
  const dates = [...new Set(byDateState.map((r) => r.date))];
  const allStates = [...new Set(byDateState.map((r) => r.state))];
  const peak = new Map();
  for (const r of byDateState) peak.set(r.state, Math.max(peak.get(r.state) ?? 0, r.quantity));

  const key = (d) => [d.slice(6), d.slice(3, 5), d.slice(0, 2)].join('');
  const ordered = dates.sort((a, b) => key(b).localeCompare(key(a))); // newest first

  for (const d of ordered) {
    const rows = byDateState.filter((r) => r.date === d);
    if (rows.length !== allStates.length) continue;
    if (rows.some((r) => r.quantity < floor * (peak.get(r.state) ?? 0))) continue;
    return { date: d, states: rows.sort((a, b) => b.quantity - a.quantity) };
  }
  return null;
}

/**
 * THE REPORTING-LAG TRAP — the recent window is systematically a lie.
 *
 * ~44 agencies report trades to the Bureau in arrears, so the trailing weeks
 * hold only a fraction of the trades that will eventually land there: about
 * 100 in the last seven days against ~1,100 a week five weeks earlier. Any
 * "this week's water price" is computed off a biased sample of whatever
 * happened to be registered fast.
 *
 * Nothing here deletes those rows — they are real trades. This marks the
 * boundary so every view can shade it and no leaderboard can be driven by it.
 */
export function provisionalFrom(maxIso, weeks = 6) {
  if (!maxIso) return null;
  const t = Date.parse(`${maxIso}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return new Date(t - weeks * 7 * 86400000).toISOString().slice(0, 10);
}

/** Stable slug for hash-routing a zone. Zone names carry slashes, commas,
 *  ampersands and long sub-source clauses, so this must be lossy-but-unique;
 *  the caller asserts uniqueness across the zone set. */
export function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

/** An accumulator for one price series bucket. Kept explicit rather than a
 *  tuple so a mis-ordered destructure cannot silently swap price and volume. */
export function makeBucket() {
  return { sumPrice: 0, sumQty: 0, tradesPriced: 0, tradesAll: 0, qtyAll: 0 };
}
export function addTrade(b, netPrice, qty, pricePerMl) {
  b.tradesAll += 1;
  if (qty != null && qty > 0) b.qtyAll += qty;
  if (isPriced(netPrice, qty, pricePerMl)) { b.sumPrice += netPrice; b.sumQty += qty; b.tradesPriced += 1; }
  return b;
}
export function finishBucket(b) {
  return {
    vwap: vwap(b.sumPrice, b.sumQty),
    volume: b.qtyAll,
    volumePriced: b.sumQty,
    trades: b.tradesAll,
    tradesPriced: b.tradesPriced,
    // The share the price is actually computed from. Surfaced, not hidden:
    // a bucket that is 95% unpriced has a VWAP that means very little, and the
    // reader is entitled to know that without reading the methodology.
    pricedShare: b.tradesAll > 0 ? b.tradesPriced / b.tradesAll : 0,
  };
}
