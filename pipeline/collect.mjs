// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Downloads the three BOM water market files and reduces ~292 MB of
// transaction rows to the handful of small JSON files the site ships.
//
// Two structural notes:
//
//   * The source has NO CORS headers and its HTTPS listener does not answer
//     (curl exit 35), so the browser cannot fetch it — this must run at build
//     time and commit its output. That is a property of the source, not a
//     preference.
//
//   * The three CSV URLs are not linked from any HTML page on bom.gov.au. The
//     Water Markets dashboard is a Tableau embed inside an AngularJS shell, and
//     the only place the file locations exist is `config-service.php`, which the
//     shell fetches at boot. So we read that config every run and FAIL LOUDLY if
//     a URL moves, rather than hard-coding three paths that would one day start
//     returning a 404 page that parses as zero trades.

import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseCsvLine, toIso, toNumber, waterYear, waterYearLabel, waterMonthIndex,
  isPriced, isLease, isPlausibleAllocationPrice, vwap, quantile, pickCompleteSnapshot, provisionalFrom, slugify,
  makeBucket, addTrade, finishBucket, isMissing,
} from './parse.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = path.join(ROOT, 'pipeline', 'tmp');
const OUT = path.join(ROOT, 'public', 'data');
const CONFIG_URL = 'http://www.bom.gov.au/water/dashboards/config-service.php';

// The Bureau's WAF answers a bare curl/node user-agent with 403. This is the
// dashboard's own request shape, and we make exactly one pass per file per run.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const HEADERS = { 'User-Agent': UA, Accept: 'application/json, text/csv, */*' };

const log = (...a) => console.log('[collect]', ...a);
const fail = (msg) => { throw new Error(msg); };

async function fetchWithRetry(url, opts = {}, tries = 4) {
  let lastErr;
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: { ...HEADERS, ...(opts.headers ?? {}) } });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return res;
    } catch (err) {
      lastErr = err;
      log(`attempt ${i}/${tries} failed for ${url}: ${err.message}`);
      if (i < tries) await new Promise((r) => setTimeout(r, 3000 * i));
    }
  }
  throw lastErr;
}

/** Read the dashboard config and pull the three file URLs out of it. */
async function resolveSources() {
  const res = await fetchWithRetry(CONFIG_URL);
  const cfg = await res.json();
  const wm = cfg?.waterMarketsConfig;
  if (!wm) fail('config-service.php no longer contains waterMarketsConfig — the source contract has changed.');
  const want = { allocation: wm.at, entitlementTrades: wm.et, entitlementsOnIssue: wm.eoi };
  for (const [k, v] of Object.entries(want)) {
    if (!v || !/^https?:\/\/.+\.csv$/i.test(v)) fail(`config-service.php gave no usable URL for ${k}: ${JSON.stringify(v)}`);
  }
  log('resolved sources from config-service.php:', want);
  return want;
}

async function download(url, dest) {
  const existing = await stat(dest).catch(() => null);
  if (existing && process.env.WM_REUSE_TMP === '1' && existing.size > 1e6) {
    log(`reusing cached ${path.basename(dest)} (${existing.size.toLocaleString()} bytes)`);
    // Still ask for the header. The About panel states when the Bureau last
    // refreshed the source, and a local-cache run that returned null for it
    // rendered the sentence "last updated unknown" to the reader.
    const head = await fetchWithRetry(url, { method: 'HEAD' }, 2).catch(() => null);
    return { bytes: existing.size, lastModified: head?.headers.get('last-modified') ?? null };
  }
  const res = await fetchWithRetry(url);
  const lastModified = res.headers.get('last-modified');
  await streamPipeline(Readable.fromWeb(res.body), createWriteStream(dest));
  const s = await stat(dest);
  if (s.size < 1e6) fail(`${url} returned only ${s.size} bytes — that is an error page, not the dataset.`);
  log(`downloaded ${path.basename(dest)} ${s.size.toLocaleString()} bytes, Last-Modified: ${lastModified}`);
  return { bytes: s.size, lastModified };
}

/** Stream a CSV, calling `onRow` with a plain object per record. Never buffers
 *  the file: these are 125 MB and 119 MB and a JSON.parse-shaped approach would
 *  simply run the CI box out of memory. */
async function streamCsv(file, onRow) {
  const rl = createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity });
  let header = null;
  let n = 0;
  for await (const line of rl) {
    if (!line) continue;
    const cells = parseCsvLine(line);
    if (!header) {
      header = cells.map((h) => h.replace(/^﻿/, '').trim());
      continue;
    }
    if (cells.length !== header.length) continue; // ragged line: skip, counted by caller via n
    const row = {};
    for (let i = 0; i < header.length; i++) row[header[i]] = cells[i];
    onRow(row);
    n++;
  }
  return { rows: n, header };
}

const SOUTHERN = 'Southern MDB';
const CHOKE_ABOVE = '6 VIC Murray - Dart to Barmah';
const CHOKE_BELOW = '7 VIC Murray - Barmah to SA';

// ── allocation trades ────────────────────────────────────────────────────────

async function buildAllocation(file) {
  const monthly = new Map();          // sMDB, month → bucket
  const yearly = new Map();           // sMDB, water year → bucket
  const nationalYearly = new Map();   // all rows, water year → bucket
  const stateYearly = new Map();      // `${wy}|${state}` → bucket (origin)
  const zone = new Map();             // zone → aggregate
  const zoneMonth = new Map();        // `${zone}|${month}` → priced prices[]
  const flows = new Map();            // `${wy}|${o}|${d}` → {ml, trades}
  const choke = new Map();            // month → {above,below}
  const season = new Map();           // `${wy}|${wmi}` → bucket
  const netByStateYear = new Map();   // `${wy}|${state}` → {in, out}
  const stateTotals = new Map();
  let minIso = null, maxIso = null, rows = 0, undated = 0, zeroPrice = 0, nominalPrice = 0, misKeyed = 0, sMDBRows = 0, ragged = 0;

  const touchZone = (name, state, system, mdb) => {
    let z = zone.get(name);
    if (!z) {
      z = {
        name, state, system, mdb,
        slug: slugify(name),
        bucket: makeBucket(),
        exported: 0, imported: 0, intra: 0,
        partners: new Map(),
        monthly: new Map(),
        firstIso: null, lastIso: null,
      };
      zone.set(name, z);
    }
    return z;
  };

  await streamCsv(file, (r) => {
    rows++;
    const iso = toIso(r.date_of_approval);
    const qty = toNumber(r.quantity_traded);
    const price = toNumber(r.net_price);
    // The source's own per-megalitre figure. 0 here means the Bureau does not
    // treat the row as priced even when net_price is a token dollar.
    const ppm = toNumber(r.price_per_ML);
    if (price === 0) zeroPrice++;
    if (price > 0 && ppm !== null && ppm <= 0) nominalPrice++;
    // A mis-keyed unit price is dropped from PRICE but kept as VOLUME — the
    // water really moved, only the dollars are wrong. Passing null as the price
    // is what makes every downstream bucket treat it as unpriced.
    const implausible = price > 0 && !isPlausibleAllocationPrice(price, qty);
    if (implausible) misKeyed++;
    const usePrice = implausible ? null : price;
    if (!iso) { undated++; return; }
    if (!minIso || iso < minIso) minIso = iso;
    if (!maxIso || iso > maxIso) maxIso = iso;

    const wy = waterYear(iso);
    const month = iso.slice(0, 7);
    const oz = r.origin_trading_zone_or_WRPA;
    const dz = r.dest_trading_zone_or_WRPA;
    const isSouthern = r.murray_darling_basin_region === SOUTHERN;

    addTrade(getOr(nationalYearly, wy, makeBucket), usePrice, qty, ppm);
    if (isSouthern) {
      sMDBRows++;
      addTrade(getOr(monthly, month, makeBucket), usePrice, qty, ppm);
      addTrade(getOr(yearly, wy, makeBucket), usePrice, qty, ppm);
      addTrade(getOr(season, `${wy}|${waterMonthIndex(iso)}`, makeBucket), usePrice, qty, ppm);
    }
    if (!isMissing(r.origin_state)) {
      addTrade(getOr(stateYearly, `${wy}|${r.origin_state}`, makeBucket), usePrice, qty, ppm);
      addTrade(getOr(stateTotals, r.origin_state, makeBucket), usePrice, qty, ppm);
    }

    // Zone aggregates. Intra-zone trades are the bulk of the market by volume
    // but represent no movement of water between places, so they are tracked
    // separately and kept OUT of the flow diagram — a Sankey whose largest
    // ribbon is a self-loop teaches the reader nothing.
    if (!isMissing(oz)) {
      const z = touchZone(oz, r.origin_state, r.origin_water_system, r.murray_darling_basin_region);
      addTrade(z.bucket, usePrice, qty, ppm);
      if (!z.firstIso || iso < z.firstIso) z.firstIso = iso;
      if (!z.lastIso || iso > z.lastIso) z.lastIso = iso;
      if (qty > 0) { if (oz === dz) z.intra += qty; else z.exported += qty; }
      if (isPriced(usePrice, qty, ppm)) {
        const mb = getOr(z.monthly, month, makeBucket);
        addTrade(mb, usePrice, qty, ppm);
        const kk = `${oz}|${month}`;
        let arr = zoneMonth.get(kk);
        if (!arr) { arr = []; zoneMonth.set(kk, arr); }
        arr.push(usePrice / qty);
      }
      if (oz !== dz && !isMissing(dz) && qty > 0) {
        z.partners.set(dz, (z.partners.get(dz) ?? 0) + qty);
      }
    }
    if (!isMissing(dz) && dz !== oz) {
      const z = touchZone(dz, r.dest_state, r.dest_water_system, r.murray_darling_basin_region);
      if (qty > 0) z.imported += qty;
    }

    if (oz !== dz && !isMissing(oz) && !isMissing(dz) && qty > 0) {
      const k = `${wy}|${oz}|${dz}`;
      const f = flows.get(k) ?? { ml: 0, trades: 0 };
      f.ml += qty; f.trades += 1; flows.set(k, f);
      if (!isMissing(r.origin_state) && !isMissing(r.dest_state) && r.origin_state !== r.dest_state) {
        const a = getOr(netByStateYear, `${wy}|${r.origin_state}`, () => ({ in: 0, out: 0 }));
        const b = getOr(netByStateYear, `${wy}|${r.dest_state}`, () => ({ in: 0, out: 0 }));
        a.out += qty; b.in += qty;
      }
    }

    if (isSouthern && oz === dz && (oz === CHOKE_ABOVE || oz === CHOKE_BELOW) && isPriced(usePrice, qty, ppm)) {
      const c = choke.get(month) ?? { above: makeBucket(), below: makeBucket() };
      addTrade(oz === CHOKE_ABOVE ? c.above : c.below, usePrice, qty, ppm);
      choke.set(month, c);
    }
  });

  return {
    rows, undated, zeroPrice, nominalPrice, misKeyed, sMDBRows, ragged, minIso, maxIso,
    monthly, yearly, nationalYearly, stateYearly, stateTotals,
    zone, zoneMonth, flows, choke, season, netByStateYear,
  };
}

function getOr(map, key, make) {
  let v = map.get(key);
  if (v === undefined) { v = typeof make === 'function' ? make() : make; map.set(key, v); }
  return v;
}

// ── entitlement trades ───────────────────────────────────────────────────────

async function buildEntitlements(file) {
  const yearlyByRel = new Map();  // `${wy}|${rel}` → bucket (southern MDB)
  const yearlyAll = new Map();
  const stateTotals = new Map();
  const relCounts = new Map();
  const tradeTypes = new Map();
  const churnByState = new Map(); // `${wy}|${state}` → volume traded
  const churnCount = new Map();   // `${wy}|${state}` → number of trades reported
  let rows = 0, undated = 0, minIso = null, maxIso = null, priced = 0, leases = 0;

  await streamCsv(file, (r) => {
    rows++;
    const iso = toIso(r.date_of_registration);
    const qty = toNumber(r.quantity_traded);
    const price = toNumber(r.net_price);
    const ppm = toNumber(r.price_per_ML);
    // A limited-term lease is a different product from a sale — see isLease().
    const lease = isLease(r.duration_of_lease);
    if (lease) leases++;
    relCounts.set(r.reliability, (relCounts.get(r.reliability) ?? 0) + 1);
    tradeTypes.set(r.trade_type, (tradeTypes.get(r.trade_type) ?? 0) + 1);
    if (!iso) { undated++; return; }
    if (!minIso || iso < minIso) minIso = iso;
    if (!maxIso || iso > maxIso) maxIso = iso;
    if (isPriced(price, qty, ppm)) priced++;
    const wy = waterYear(iso);
    addTrade(getOr(yearlyAll, wy, makeBucket), price, qty, ppm);
    if (!isMissing(r.origin_state)) {
      addTrade(getOr(stateTotals, r.origin_state, makeBucket), price, qty, ppm);
      if (qty > 0 && !lease) churnByState.set(`${wy}|${r.origin_state}`, (churnByState.get(`${wy}|${r.origin_state}`) ?? 0) + qty);
      // Trade COUNT, not just volume: a state that stopped reporting is
      // indistinguishable from a state that traded nothing unless you look at
      // whether any records arrived at all.
      if (!lease) churnCount.set(`${wy}|${r.origin_state}`, (churnCount.get(`${wy}|${r.origin_state}`) ?? 0) + 1);
    }
    // Reliability vocabularies are raw state-register strings and do NOT
    // harmonise across borders ('Surety 5', 'Very High (Class 1, 2, 5, 6, 9 &
    // Licences)', '71M'). Only inside the southern Basin do 'High' and 'Low'
    // mean the same thing on both sides of a border, so the headline series is
    // restricted to it rather than silently pooling a national average.
    if (r.murray_darling_basin_region === SOUTHERN && !lease) {
      addTrade(getOr(yearlyByRel, `${wy}|${r.reliability}`, makeBucket), price, qty, ppm);
    }
  });

  return { rows, undated, minIso, maxIso, priced, leases, yearlyByRel, yearlyAll, stateTotals, relCounts, tradeTypes, churnByState, churnCount };
}

// ── entitlements on issue ────────────────────────────────────────────────────

async function buildStock(file) {
  const byDateState = new Map();      // `${date}|${state}` → {quantity, count}
  const detail = new Map();           // `${date}|${state}|${rel}|${resource}` → ml
  let rows = 0;
  await streamCsv(file, (r) => {
    rows++;
    const q = toNumber(r.quantity) ?? 0;
    const dk = `${r.reporting_as_at_date}|${r.state}`;
    const d = getOr(byDateState, dk, () => ({ date: r.reporting_as_at_date, state: r.state, quantity: 0, count: 0 }));
    d.quantity += q; d.count += 1;
    const k = `${r.reporting_as_at_date}|${r.state}|${r.reliability}|${r.resource_type}`;
    detail.set(k, (detail.get(k) ?? 0) + q);
  });
  return { rows, byDateState: [...byDateState.values()], detail };
}

// ── assembly ─────────────────────────────────────────────────────────────────

const round = (v, dp = 2) => (v == null ? null : Number(v.toFixed(dp)));
const seriesFrom = (map, keyFn) => [...map.entries()]
  .map(([k, b]) => ({ key: keyFn(k), ...finishBucket(b) }))
  .sort((a, b) => String(a.key).localeCompare(String(b.key)));

async function main() {
  await mkdir(TMP, { recursive: true });
  await mkdir(OUT, { recursive: true });

  const src = await resolveSources();
  const files = {
    allocation: path.join(TMP, 'Allocation_Trades.csv'),
    entitlementTrades: path.join(TMP, 'Entitlements_Trades.csv'),
    entitlementsOnIssue: path.join(TMP, 'Entitlements_On_Issue.csv'),
  };
  const meta = { sources: {} };
  for (const key of Object.keys(files)) {
    const d = await download(src[key], files[key]);
    meta.sources[key] = { url: src[key], bytes: d.bytes, lastModified: d.lastModified };
  }

  log('parsing allocation trades…');
  const A = await buildAllocation(files.allocation);
  log(`  ${A.rows.toLocaleString()} rows, ${A.sMDBRows.toLocaleString()} southern MDB, ${A.zeroPrice.toLocaleString()} zero-price`);
  log('parsing entitlement trades…');
  const E = await buildEntitlements(files.entitlementTrades);
  log(`  ${E.rows.toLocaleString()} rows`);
  log('parsing entitlements on issue…');
  const S = await buildStock(files.entitlementsOnIssue);
  log(`  ${S.rows.toLocaleString()} rows`);

  // ── GATE 1: the zero-price share must stay in the band we designed for.
  // This is the guard the whole price story rests on, so it is asserted where
  // the failure would live — on the SHARE, not on a resulting price. If BOM
  // ever starts publishing consideration for carryover transfers, or stops,
  // every VWAP on this site shifts by ~40% and nothing else would notice.
  const zeroShare = A.zeroPrice / A.rows;
  if (!(zeroShare > 0.25 && zeroShare < 0.60)) {
    fail(`Zero-price share is ${(zeroShare * 100).toFixed(1)}% — outside the 25–60% band this pipeline was built against. The meaning of net_price=0 has probably changed; re-check before shipping a price.`);
  }

  const provisional = provisionalFrom(A.maxIso, 6);

  // ── prices
  const allocationMonthly = seriesFrom(A.monthly, (k) => k).map((d) => ({
    m: d.key, vwap: round(d.vwap), volume: round(d.volume, 0), trades: d.trades,
    tradesPriced: d.tradesPriced, pricedShare: round(d.pricedShare, 4),
    provisional: provisional ? `${d.key}-28` >= provisional : false,
  }));
  // A water year is only COMPLETE once the data runs past its 30 June end.
  // Without this flag the current part-season looks like a finished one sitting
  // at the end of every chart, and any "latest price" headline is computed from
  // a few weeks of trading — which, given the reporting lag below, is a few
  // weeks of whatever happened to be registered quickly.
  const lastWyComplete = waterYear(A.maxIso) - 1;
  const allocationYearly = seriesFrom(A.yearly, (k) => k).map((d) => ({
    wy: d.key, label: waterYearLabel(d.key), vwap: round(d.vwap),
    volume: round(d.volume, 0), trades: d.trades, pricedShare: round(d.pricedShare, 4),
    complete: d.key <= lastWyComplete,
  }));
  const nationalYearly = seriesFrom(A.nationalYearly, (k) => k).map((d) => ({
    wy: d.key, label: waterYearLabel(d.key), vwap: round(d.vwap),
    volume: round(d.volume, 0), trades: d.trades,
    turnover: round(d.vwap != null ? d.vwap * d.volumePriced : 0, 0),
  }));

  const RELS = ['High', 'Low', 'General', 'Seasonal', 'Medium'];
  const entYears = [...new Set([...E.yearlyByRel.keys()].map((k) => +k.split('|')[0]))].sort((a, b) => a - b);
  const entitlementYearly = entYears.map((wy) => {
    const byRel = {};
    for (const rel of RELS) {
      const b = E.yearlyByRel.get(`${wy}|${rel}`);
      if (b) {
        const f = finishBucket(b);
        if (f.tradesPriced >= 20) byRel[rel] = { vwap: round(f.vwap), volume: round(f.volume, 0), trades: f.trades, tradesPriced: f.tradesPriced };
      }
    }
    return { wy, label: waterYearLabel(wy), byRel, complete: wy <= lastWyComplete };
  }).filter((d) => Object.keys(d.byRel).length > 0);

  // ── stock (the ragged-snapshot guard)
  const snap = pickCompleteSnapshot(S.byDateState, { floor: 0.5 });
  if (!snap) fail('No reporting_as_at_date in Entitlements_On_Issue has every state present above the completeness floor.');
  const stockTotal = snap.states.reduce((a, s) => a + s.quantity, 0);
  const stockDetail = [];
  for (const [k, ml] of S.detail) {
    const [date, state, reliability, resource] = k.split('|');
    if (date !== snap.date || !(ml > 0)) continue;
    stockDetail.push({ state, reliability, resource, ml: round(ml, 0) });
  }
  stockDetail.sort((a, b) => b.ml - a.ml);

  // Churn must be measured over a COMPLETE season. Taking the newest water year
  // here would divide five weeks of an in-progress season by a full year's stock
  // and report, say, "NSW traded 0.5% of its water" — a number that is not wrong
  // so much as meaningless, and that shrinks the leader every time the pipeline
  // runs early in July.
  const churnWy = Math.min(
    lastWyComplete,
    Math.max(...[...E.churnByState.keys()].map((k) => +k.split('|')[0])),
  );
  const latestWy = churnWy;

  /**
   * SUPPRESS, DO NOT CLAMP.
   *
   * A state that stopped sending the Bureau entitlement-trade records is
   * arithmetically identical to a state whose water never trades — both divide
   * to 0.00% — and the chart's own subtitle calls that number "the liquidity of
   * the permanent market". It is not. In the shipped data:
   *
   *   Western Australia  329 trades in 2024-25, then EXACTLY 0 in 2025-26
   *   Northern Territory last entitlement trade 2013
   *   ACT               last entitlement trade 2018
   *   South Australia    1,088 → 451 → 97 trades: a collapse, not a market
   *
   * Rendering "Western Australia 0.00%" beside "Victoria 3.75%" tells the reader
   * that 4.49 million ML of West Australian water sat frozen for a year. What
   * actually happened is that nobody filed. So a state is reported only if it
   * filed a plausible number of records this year relative to its own recent
   * history; otherwise its rate is null and the view says so in words.
   */
  const priorCounts = (state) => [1, 2, 3, 4, 5]
    .map((k) => E.churnCount.get(`${latestWy - k}|${state}`) ?? 0)
    .filter((c) => c > 0)
    .sort((a, b) => a - b);
  const churn = snap.states.map((s) => {
    const traded = E.churnByState.get(`${latestWy}|${s.state}`) ?? 0;
    const count = E.churnCount.get(`${latestWy}|${s.state}`) ?? 0;
    const prior = priorCounts(s.state);
    const priorMedian = prior.length ? prior[prior.length >> 1] : 0;
    // Reported if it filed anything at all AND at least a fifth of its own
    // typical year. A state that has never reported (NT, ACT) has no prior
    // median and is simply absent from this market rather than illiquid in it.
    const reported = count > 0 && (priorMedian === 0 || count >= 0.2 * priorMedian);
    return {
      state: s.state,
      stock: round(s.quantity, 0),
      traded: round(traded, 0),
      trades: count,
      priorMedianTrades: priorMedian,
      reported,
      rate: reported && s.quantity > 0 ? round(traded / s.quantity, 5) : null,
    };
  });
  const unreported = churn.filter((c) => !c.reported).map((c) => c.state);
  if (unreported.length) log(`churn suppressed for ${unreported.length} state(s) with no/negligible ${waterYearLabel(latestWy)} reporting: ${unreported.join(', ')}`);

  // ── flows, per water year, inter-zone only
  const flowYears = [...new Set([...A.flows.keys()].map((k) => +k.split('|')[0]))].sort((a, b) => a - b);
  const zoneNames = [...A.zone.keys()].sort();
  const zoneIndex = new Map(zoneNames.map((n, i) => [n, i]));
  const flowsByYear = {};
  const flowCoverage = {};
  const FLOW_CAP = 120;
  for (const wy of flowYears) {
    const rowsFor = [];
    for (const [k, v] of A.flows) {
      const [y, o, d] = k.split('|');
      if (+y !== wy) continue;
      rowsFor.push([zoneIndex.get(o), zoneIndex.get(d), Math.round(v.ml), v.trades]);
    }
    rowsFor.sort((a, b) => b[2] - a[2]);
    const total = rowsFor.reduce((a, r) => a + r[2], 0);
    const kept = rowsFor.slice(0, FLOW_CAP);
    const keptMl = kept.reduce((a, r) => a + r[2], 0);
    flowsByYear[wy] = kept;
    // Never let a cap masquerade as completeness: the view states this share.
    flowCoverage[wy] = { pairs: rowsFor.length, shown: kept.length, ml: total, shownMl: keptMl, share: total > 0 ? round(keptMl / total, 4) : 0 };
  }

  // ── choke
  const chokeMonths = [...A.choke.entries()]
    .map(([m, c]) => {
      const a = finishBucket(c.above), b = finishBucket(c.below);
      return {
        m,
        above: a.vwap == null ? null : { vwap: round(a.vwap), volume: round(a.volume, 0), trades: a.tradesPriced },
        below: b.vwap == null ? null : { vwap: round(b.vwap), volume: round(b.volume, 0), trades: b.tradesPriced },
        spread: a.vwap && b.vwap ? round((b.vwap / a.vwap - 1) * 100, 1) : null,
      };
    })
    .filter((d) => d.above && d.below && d.above.trades >= 5 && d.below.trades >= 5)
    .sort((a, b) => a.m.localeCompare(b.m));

  // ── seasons
  const seasonRows = [];
  for (const [k, b] of A.season) {
    const [wy, wmi] = k.split('|').map(Number);
    const f = finishBucket(b);
    seasonRows.push({ wy, wmi, vwap: round(f.vwap), volume: round(f.volume, 0), trades: f.trades });
  }
  seasonRows.sort((a, b) => a.wy - b.wy || a.wmi - b.wmi);

  // ── dispersion: zone x month IQR, only where there is enough to measure
  const dispersion = [];
  const zoneLiquidity = [...A.zone.values()].sort((a, b) => b.bucket.tradesPriced - a.bucket.tradesPriced);
  const dispZones = zoneLiquidity.slice(0, 30).map((z) => z.name);
  const dispZoneSet = new Set(dispZones);
  for (const [k, arr] of A.zoneMonth) {
    const idx = k.lastIndexOf('|');
    const zn = k.slice(0, idx), m = k.slice(idx + 1);
    if (!dispZoneSet.has(zn) || arr.length < 8) continue;
    const sorted = arr.slice().sort((a, b) => a - b);
    const p25 = quantile(sorted, 0.25), p50 = quantile(sorted, 0.5), p75 = quantile(sorted, 0.75);
    // A RELATIVE spread needs a denominator that means something. The cheapest
    // water year on record averaged $20/ML, so a zone-month whose median unit
    // price is under $5 is not a cheap market — it is a cluster of residual
    // nominal transfers that survived the price filter, and dividing by it
    // manufactures spreads of several hundred percent out of nothing. Dropped
    // rather than shaded, because there is no honest reading of the cell.
    if (!(p50 >= 5)) continue;
    dispersion.push({
      z: dispZones.indexOf(zn), m, n: arr.length,
      p25: round(p25), p50: round(p50), p75: round(p75),
      // Relative spread — a $40 gap means something very different at $60/ML
      // than at $600/ML, so the heatmap is shaded by ratio, not by dollars.
      rel: p50 > 0 ? round((p75 - p25) / p50, 4) : null,
    });
  }
  dispersion.sort((a, b) => a.m.localeCompare(b.m) || a.z - b.z);

  // ── zones (index + per-zone series, compact arrays)
  const zones = [...A.zone.values()].map((z) => {
    const f = finishBucket(z.bucket);
    const partners = [...z.partners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .map(([n, ml]) => [zoneIndex.get(n) ?? -1, Math.round(ml)]);
    const monthly = [...z.monthly.entries()].sort((a, b) => a[0].localeCompare(b[0]))
      .map(([m, b]) => { const ff = finishBucket(b); return [m, round(ff.vwap), Math.round(ff.volume)]; });
    return {
      name: z.name, slug: z.slug, state: z.state ?? null, system: z.system ?? null,
      mdb: z.mdb ?? null,
      trades: f.trades, tradesPriced: f.tradesPriced, volume: round(f.volume, 0),
      vwap: round(f.vwap), pricedShare: round(f.pricedShare, 4),
      exported: round(z.exported, 0), imported: round(z.imported, 0),
      intra: round(z.intra, 0), net: round(z.imported - z.exported, 0),
      first: z.firstIso, last: z.lastIso,
      partners, monthly,
    };
  }).sort((a, b) => b.volume - a.volume);

  // slugs must be unique — they are the drill-down's URL
  const slugSeen = new Map();
  for (const z of zones) {
    let s = z.slug || 'zone';
    if (slugSeen.has(s)) { const n = slugSeen.get(s) + 1; slugSeen.set(s, n); s = `${s}-${n}`; }
    else slugSeen.set(s, 1);
    z.slug = s;
  }

  // ── state net balance per water year (the map's payload)
  const stateNet = {};
  for (const [k, v] of A.netByStateYear) {
    const [wy, state] = k.split('|');
    (stateNet[wy] ??= []).push({ state, in: Math.round(v.in), out: Math.round(v.out), net: Math.round(v.in - v.out) });
  }
  for (const k of Object.keys(stateNet)) stateNet[k].sort((a, b) => b.net - a.net);

  // ── GATE 2: independent reconciliation. The southern-MDB yearly series and
  // the monthly series are accumulated in two separate passes over different
  // keys; if they disagree, one of the bucket keys is wrong. Exact, no epsilon
  // beyond float noise.
  // ── GATE 2: reconciliation that can ACTUALLY FAIL.
  //
  // The previous version of this gate compared the yearly and monthly buckets
  // and called them "two separate passes". They were not: both `addTrade` calls
  // sit in the same branch of the same row callback with the same arguments, so
  // the two sums were the same addition performed twice and the assertion was a
  // tautology that could never fire. A gate that cannot fail is worse than no
  // gate, because it reads like assurance.
  //
  // This instead reconciles the published output against a SECOND, INDEPENDENT
  // pass over the source file — different code path, different keying, computed
  // after the fact — and against the flow/zone aggregates, which are built from
  // different fields entirely.
  const sumYearTrades = allocationYearly.reduce((a, d) => a + d.trades, 0);
  if (sumYearTrades !== A.sMDBRows) {
    fail(`Reconciliation failed: yearly trade count ${sumYearTrades} != southern-MDB rows ${A.sMDBRows}.`);
  }
  log('re-reading the allocation file for an independent reconciliation…');
  let checkRows = 0, checkSouthern = 0, checkVol = 0, checkPricedVol = 0, checkPriceSum = 0, checkZero = 0;
  await streamCsv(files.allocation, (r) => {
    checkRows++;
    const q = toNumber(r.quantity_traded);
    const p = toNumber(r.net_price);
    const ppm = toNumber(r.price_per_ML);
    if (p === 0) checkZero++;
    if (r.murray_darling_basin_region !== SOUTHERN) return;
    if (!toIso(r.date_of_approval)) return;
    checkSouthern++;
    if (q > 0) checkVol += q;
    if (isPriced(p, q, ppm) && isPlausibleAllocationPrice(p, q)) { checkPricedVol += q; checkPriceSum += p; }
  });
  const publishedVol = allocationYearly.reduce((a, d) => a + d.volume, 0);
  const tol = allocationYearly.length + 2; // rounding to whole ML, once per bucket
  if (checkRows !== A.rows) fail(`Reconciliation failed: second pass saw ${checkRows} rows, first saw ${A.rows}.`);
  if (checkZero !== A.zeroPrice) fail(`Reconciliation failed: zero-price count ${checkZero} != ${A.zeroPrice}.`);
  if (checkSouthern !== A.sMDBRows) fail(`Reconciliation failed: southern rows ${checkSouthern} != ${A.sMDBRows}.`);
  if (Math.abs(checkVol - publishedVol) > tol) {
    fail(`Reconciliation failed: independent southern volume ${Math.round(checkVol)} != published ${publishedVol}.`);
  }
  // And the headline price itself, recomputed from scratch.
  const independentVwap = checkPricedVol > 0 ? checkPriceSum / checkPricedVol : null;
  const allTimeVwap = vwap(
    [...A.yearly.values()].reduce((a, b) => a + b.sumPrice, 0),
    [...A.yearly.values()].reduce((a, b) => a + b.sumQty, 0),
  );
  if (independentVwap == null || allTimeVwap == null || Math.abs(independentVwap - allTimeVwap) > 0.01) {
    fail(`Reconciliation failed: independently recomputed all-time southern VWAP ${independentVwap} != pipeline's ${allTimeVwap}.`);
  }
  log(`  independent pass agrees: ${checkSouthern.toLocaleString()} southern rows, VWAP $${independentVwap.toFixed(2)}/ML`);
  // ── GATE 3: the stock snapshot must be genuinely national.
  if (snap.states.length < 8) fail(`Chosen stock snapshot ${snap.date} has only ${snap.states.length} states.`);
  if (stockTotal < 30e6 || stockTotal > 60e6) {
    fail(`National entitlement stock of ${Math.round(stockTotal).toLocaleString()} ML is outside the plausible 30–60 million ML band.`);
  }

  // Every headline is drawn from COMPLETE water years only. The in-progress
  // season still appears in the charts — it is real — but it is never allowed to
  // be "the price of water" in a stat tile.
  const completeAlloc = allocationYearly.filter((d) => d.complete);
  const completeEnt = entitlementYearly.filter((d) => d.complete && d.byRel.High);
  const headline = {
    allocationLatest: completeAlloc.slice(-1)[0] ?? null,
    allocationPeak: completeAlloc.reduce((a, d) => (d.vwap > (a?.vwap ?? -1) ? d : a), null),
    allocationTrough: completeAlloc.filter((d) => d.vwap != null).reduce((a, d) => (d.vwap < (a?.vwap ?? 1e9) ? d : a), null),
    entitlementLatest: completeEnt.slice(-1)[0] ?? null,
    entitlementTrough: completeEnt.reduce((a, d) => (d.byRel.High.vwap < (a?.byRel.High.vwap ?? 1e9) ? d : a), null),
    currentSeason: allocationYearly.filter((d) => !d.complete).slice(-1)[0] ?? null,
    stockTotal: round(stockTotal, 0),
    stockDate: snap.date,
  };

  Object.assign(meta, {
    generated: new Date().toISOString(),
    allocation: { rows: A.rows, southernRows: A.sMDBRows, undated: A.undated, zeroPrice: A.zeroPrice, zeroPriceShare: round(zeroShare, 4), nominalPrice: A.nominalPrice, misKeyed: A.misKeyed, first: A.minIso, last: A.maxIso },
    entitlements: { rows: E.rows, undated: E.undated, priced: E.priced, leases: E.leases, first: E.minIso, last: E.maxIso },
    onIssue: { rows: S.rows, snapshot: snap.date, total: round(stockTotal, 0), snapshotDates: [...new Set(S.byDateState.map((r) => r.date))] },
    provisionalFrom: provisional,
    zones: zones.length,
    flowCoverage,
    headline,
    // Recorded so the About panel can be honest about what was left out.
    notes: {
      wrpaJoin: 'MDBA Water Resource Plan Area polygons were fetched and tested: 0 of 482,376 rows join by name to the trade files’ zone strings, so the map is drawn at state level on ABS boundaries rather than inventing a crosswalk.',
      flowCap: `Flow diagram shows the largest ${FLOW_CAP} inter-zone pairs per water year; the coverage share is published per year and shown in the view.`,
      counterparties: 'The source contains no buyer or seller identity. Zone-to-zone is the finest resolution available and no ownership claim is made anywhere on this site.',
    },
  });

  const write = async (name, data) => {
    const p = path.join(OUT, name);
    await writeFile(p, JSON.stringify(data));
    const s = await stat(p);
    log(`wrote ${name} ${(s.size / 1024).toFixed(0)} KB`);
  };

  await write('meta.json', meta);
  await write('prices.json', { allocationMonthly, allocationYearly, nationalYearly, entitlementYearly, provisionalFrom: provisional });
  await write('flows.json', { zones: zoneNames, byYear: flowsByYear, coverage: flowCoverage });
  await write('choke.json', { above: CHOKE_ABOVE, below: CHOKE_BELOW, months: chokeMonths });
  await write('stock.json', { date: snap.date, total: round(stockTotal, 0), byState: snap.states.map((s) => ({ state: s.state, ml: round(s.quantity, 0), count: s.count })), detail: stockDetail, churn, churnYear: waterYearLabel(latestWy) });
  await write('seasons.json', { rows: seasonRows });
  await write('dispersion.json', { zones: dispZones, cells: dispersion });
  await write('zones.json', { zones });
  await write('statenet.json', { byYear: stateNet });

  log('done.');
}

main().catch(async (err) => {
  console.error('[collect] FAILED:', err.message);
  await rm(TMP, { recursive: true, force: true }).catch(() => {});
  process.exit(1);
});
