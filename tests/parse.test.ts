// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import { describe, expect, it } from 'vitest';
import {
  parseCsvLine, toIso, waterYear, waterYearLabel, waterMonthIndex, toNumber,
  isPriced, vwap, quantile, pickCompleteSnapshot, provisionalFrom, slugify,
  makeBucket, addTrade, finishBucket, isMissing,
} from '../pipeline/parse.mjs';

describe('parseCsvLine', () => {
  it('splits a plain row', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
  });
  it('keeps commas inside quoted fields — the reliability labels depend on it', () => {
    expect(parseCsvLine('"Very High (Class 1, 2, 5, 6, 9 & Licences)","ML","17.0"'))
      .toEqual(['Very High (Class 1, 2, 5, 6, 9 & Licences)', 'ML', '17.0']);
  });
  it('handles a doubled quote inside a quoted field', () => {
    expect(parseCsvLine('"He said ""go""",x')).toEqual(['He said "go"', 'x']);
  });
  it('preserves empty trailing fields, so column alignment survives', () => {
    expect(parseCsvLine('"a","","c",')).toEqual(['a', '', 'c', '']);
  });
  it('parses a real Allocation_Trades row to 17 columns', () => {
    const line = '"Surface water","Victoria","VIC Murray (SS2)","7 VIC Murray - Barmah to SA","Victoria","VIC Murray (SS2)","7 VIC Murray - Barmah to SA","ML","8.0000000000","3040","380","21-09-2009","regulated","Murray-Darling Basin","Southern MDB","NA","NA"';
    const cells = parseCsvLine(line);
    expect(cells).toHaveLength(17);
    expect(cells[8]).toBe('8.0000000000');
    expect(cells[11]).toBe('21-09-2009');
  });
});

describe('toIso', () => {
  it('converts the file’s dd-mm-yyyy', () => {
    expect(toIso('21-09-2009')).toBe('2009-09-21');
    expect(toIso('03-08-2026')).toBe('2026-08-03');
  });
  it('rejects sentinels rather than inventing a date', () => {
    for (const v of ['NA', '', 'Undefined', null, undefined]) expect(toIso(v)).toBeNull();
  });
  it('rejects an impossible month — a mm-dd file would be caught here', () => {
    expect(toIso('2009-21-09')).toBeNull();
    expect(toIso('01-13-2020')).toBeNull();
  });
  it('rejects a malformed string', () => {
    expect(toIso('2009-09-21')).toBeNull();
    expect(toIso('21/09/2009')).toBeNull();
  });
});

describe('waterYear', () => {
  it('runs July to June, not January to December', () => {
    expect(waterYear('2025-07-01')).toBe(2025);
    expect(waterYear('2026-06-30')).toBe(2025);
    expect(waterYear('2026-07-01')).toBe(2026);
    expect(waterYear('2026-02-14')).toBe(2025);
  });
  it('labels a season the way irrigators write it', () => {
    expect(waterYearLabel(2025)).toBe('2025-26');
    expect(waterYearLabel(2008)).toBe('2008-09');
    expect(waterYearLabel(1999)).toBe('1999-00');
  });
  it('indexes months from July so a seasonal chart is not cut in half', () => {
    expect(waterMonthIndex('2025-07-15')).toBe(0);
    expect(waterMonthIndex('2026-06-15')).toBe(11);
    expect(waterMonthIndex('2026-01-15')).toBe(6);
  });
});

describe('isPriced — THE ZERO-PRICE GUARD', () => {
  it('excludes zero-consideration transfers from price', () => {
    expect(isPriced(0, 100)).toBe(false);
  });
  it('excludes negative or absent prices and zero volumes', () => {
    expect(isPriced(-5, 100)).toBe(false);
    expect(isPriced(null, 100)).toBe(false);
    expect(isPriced(500, 0)).toBe(false);
    expect(isPriced(500, null)).toBe(false);
  });
  it('accepts a genuine priced trade', () => {
    expect(isPriced(3040, 8)).toBe(true);
    expect(isPriced(3040, 8, 380)).toBe(true);
  });

  // NOMINAL CONSIDERATION — the half of the trap that `netPrice > 0` misses.
  it('excludes a $1 token consideration, because the SOURCE says it is unpriced', () => {
    // A real shape: $1.00 for a 100 ML parcel. net_price passes > 0, but the
    // file's own price_per_ML is 0 — the Bureau does not treat it as a price.
    expect(isPriced(1, 100, 0)).toBe(false);
  });
  it('still accepts a small-but-real price where the source agrees it is priced', () => {
    expect(isPriced(1, 100, 0.01)).toBe(true);
  });
  it('falls back to net_price alone when price_per_ML is absent', () => {
    // Not every caller has the column; absence must not silently drop the row.
    expect(isPriced(3040, 8, null)).toBe(true);
    expect(isPriced(3040, 8, undefined)).toBe(true);
  });
  it('THE FAILURE IT PREVENTS: a cluster of $1 trades collapses a zone-month median', () => {
    // Twelve $1.00/ML nominal trades and ten real ones at ~$125/ML. With the
    // nominal rows included the MEDIAN is $1.00 and a relative spread reads as
    // 12,222% — which shipped to the front page as "markets in name only".
    const nominal = Array.from({ length: 12 }, () => ({ p: 1, q: 1, ppm: 0 }));
    const real = Array.from({ length: 10 }, () => ({ p: 12_500, q: 100, ppm: 125 }));
    const rows = [...nominal, ...real];
    const withNominal = rows.filter((r) => r.p > 0).map((r) => r.p / r.q).sort((a, b) => a - b);
    const withGuard = rows.filter((r) => isPriced(r.p, r.q, r.ppm)).map((r) => r.p / r.q).sort((a, b) => a - b);
    const med = (xs: number[]) => xs[xs.length >> 1];
    expect(med(withNominal)).toBe(1);      // the bug
    expect(med(withGuard)).toBe(125);      // the fix
    expect(withGuard).toHaveLength(10);
  });
});

describe('vwap — never average price_per_ML', () => {
  it('weights by volume, so a 1 ML novelty cannot outvote a 10,000 ML deal', () => {
    // Naive mean of (900, 180) = $540. The honest answer is ~$180.07.
    const sumPrice = 1 * 900 + 10_000 * 180;
    const sumQty = 1 + 10_000;
    expect(vwap(sumPrice, sumQty)).toBeCloseTo(180.07, 2);
  });
  it('returns null rather than Infinity on zero volume', () => {
    expect(vwap(1000, 0)).toBeNull();
  });
});

describe('bucket accumulation', () => {
  it('counts unpriced rows as VOLUME but not as PRICE', () => {
    const b = makeBucket();
    addTrade(b, 0, 1000);      // zero-consideration transfer: real water
    addTrade(b, 2000, 10);     // a $200/ML trade
    const f = finishBucket(b);
    expect(f.volume).toBe(1010);      // both count toward volume
    expect(f.volumePriced).toBe(10);  // only one toward price
    expect(f.vwap).toBe(200);
    expect(f.trades).toBe(2);
    expect(f.tradesPriced).toBe(1);
    expect(f.pricedShare).toBe(0.5);
  });
  it('a bucket of only unpriced rows has volume but NO price', () => {
    const b = makeBucket();
    addTrade(b, 0, 500);
    const f = finishBucket(b);
    expect(f.volume).toBe(500);
    expect(f.vwap).toBeNull();
    expect(f.pricedShare).toBe(0);
  });
  it('THE GUARD ITSELF: including zero rows in price would drop it ~40%', () => {
    // Reproduces the real shape — 43.6% of rows unpriced at the same volume.
    const honest = makeBucket();
    let naiveP = 0, naiveQ = 0;
    for (let i = 0; i < 1000; i++) {
      const zero = i < 436;
      const price = zero ? 0 : 200 * 10;
      addTrade(honest, price, 10);
      naiveP += price; naiveQ += 10;
    }
    const h = finishBucket(honest);
    expect(h.vwap).toBe(200);
    const naive = naiveP / naiveQ;
    expect(naive).toBeCloseTo(112.8, 1);
    // The failure this guard prevents is a 44% understatement.
    expect(1 - naive / (h.vwap as number)).toBeGreaterThan(0.4);
  });
});

describe('quantile', () => {
  it('interpolates between ranks', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4, 5], 0.25)).toBe(2);
  });
  it('handles degenerate inputs without NaN', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([7], 0.9)).toBe(7);
  });
});

describe('pickCompleteSnapshot — THE 16,000x RAGGED-SNAPSHOT GUARD', () => {
  // The real shape of Entitlements_On_Issue at build time.
  const real = [
    { date: '30-06-2024', state: 'NSW', quantity: 15_246_536 },
    { date: '30-06-2024', state: 'VIC', quantity: 7_517_870 },
    { date: '30-06-2024', state: 'SA', quantity: 2_997_943 },
    { date: '30-06-2025', state: 'NSW', quantity: 15_223_906 },
    { date: '30-06-2025', state: 'VIC', quantity: 7_534_132 },
    { date: '30-06-2025', state: 'SA', quantity: 2_759_336 },
    { date: '30-06-2026', state: 'VIC', quantity: 6_790_131 },   // VIC only
    { date: '31-07-2026', state: 'NSW', quantity: 13_950_134 },  // NSW plus…
    { date: '31-07-2026', state: 'SA', quantity: 170 },          // …a 170 ML stub
  ];

  it('picks the newest date where EVERY state is present', () => {
    const s = pickCompleteSnapshot(real);
    expect(s?.date).toBe('30-06-2025');
  });

  it('THE FAILURE IT PREVENTS: max(date) would report South Australia at 170 ML', () => {
    // Prove the naive approach really is catastrophically wrong on this input,
    // so the guard is measured against the fault it exists to stop.
    const key = (d: string) => [d.slice(6), d.slice(3, 5), d.slice(0, 2)].join('');
    const naiveDate = [...real].sort((a, b) => key(b.date).localeCompare(key(a.date)))[0].date;
    expect(naiveDate).toBe('31-07-2026');
    const naiveSa = real.find((r) => r.date === naiveDate && r.state === 'SA')!.quantity;
    const trueSa = pickCompleteSnapshot(real)!.states.find((s) => s.state === 'SA')!.quantity;
    expect(naiveSa).toBe(170);
    expect(trueSa).toBe(2_759_336);
    expect(trueSa / naiveSa).toBeGreaterThan(16_000);
  });

  it('rejects a date where a state appears only as a token row', () => {
    // Even with all three states present, a 170 ML SA is below the floor.
    const withStub = [...real, { date: '31-07-2026', state: 'VIC', quantity: 7_000_000 }];
    expect(pickCompleteSnapshot(withStub)?.date).toBe('30-06-2025');
  });

  it('returns states sorted largest first', () => {
    const s = pickCompleteSnapshot(real)!;
    expect(s.states.map((x) => x.state)).toEqual(['NSW', 'VIC', 'SA']);
  });

  it('returns null rather than guessing when nothing is complete', () => {
    expect(pickCompleteSnapshot([
      { date: '30-06-2025', state: 'NSW', quantity: 100 },
      { date: '30-06-2026', state: 'VIC', quantity: 100 },
    ])).toBeNull();
  });
});

describe('provisionalFrom', () => {
  it('marks six weeks back from the newest trade', () => {
    expect(provisionalFrom('2026-08-03', 6)).toBe('2026-06-22');
  });
  it('is null-safe', () => {
    expect(provisionalFrom(null)).toBeNull();
    expect(provisionalFrom('not-a-date')).toBeNull();
  });
});

describe('misc', () => {
  it('treats each sentinel as missing', () => {
    expect(isMissing('NA')).toBe(true);
    expect(isMissing('')).toBe(true);
    expect(isMissing('Southern MDB')).toBe(false);
    // 'Undefined' is a REAL reliability class, not a missing marker.
    expect(isMissing('Undefined')).toBe(false);
  });
  it('slugifies a zone name with slashes and punctuation', () => {
    expect(slugify('7 VIC Murray - Barmah to SA')).toBe('7-vic-murray-barmah-to-sa');
    expect(slugify('NSW Murray / downstream of Picnic Point')).toBe('nsw-murray-downstream-of-picnic-point');
  });
  it('parses the file’s long decimal quantities', () => {
    expect(toNumber('184.9000000000')).toBeCloseTo(184.9);
    expect(toNumber('NA')).toBeNull();
    expect(toNumber('')).toBeNull();
  });
});
