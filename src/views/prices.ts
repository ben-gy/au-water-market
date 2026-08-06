// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { ViewCtx } from '../router.ts';
import { MARKET, RELIABILITY, RELIABILITY_ORDER, relColor } from '../colors.ts';
import { dollars, esc, ml, monthLabel, monthShort, num, pct, perML } from '../format.ts';
import { glossaryHtml, glossaryIcon } from '../glossary.ts';
import { rollingMean } from '../analysis.ts';
import { legend, linePath, logScale, logTicks, makeSvg, panel, scale, svgEl } from './svg.ts';
import { prefs } from '../data.ts';

export function renderPrices({ root, data }: ViewCtx): void {
  // ── monthly allocation price, the series irrigators actually watch
  const p1 = panel({
    title: `Allocation price, month by month ${glossaryIcon('allocation')}`,
    subtitle: `What a megalitre of water for <em>this season</em> cost in the ${glossaryHtml('smdb', 'southern Murray-Darling Basin')}, every month since July 2008. The heavy line is a 3-month rolling average; the shaded band on the right is the ${glossaryHtml('provisional', 'reporting-lag window')}, where trades are still arriving.`,
    legend: legend([
      { color: MARKET.allocation, label: 'Monthly volume-weighted price', shape: 'line' },
      { color: '#9dc4d4', label: 'Volume traded (ML)' },
    ]),
  });
  p1.body.appendChild(monthlyChart(data));
  root.appendChild(p1.section);

  // ── entitlement by reliability
  const p2 = panel({
    title: `Entitlement price by reliability class ${glossaryIcon('reliability')}`,
    subtitle: 'The permanent market. Each line is a class of water right, priced per megalitre of entitlement — the cost of owning the right for ever, rather than using it once. A year is shown only where at least 20 priced trades support it.',
    legend: legend(RELIABILITY_ORDER.filter((r) => RELIABILITY[r]).map((r) => ({ color: relColor(r), label: r, shape: 'line' as const }))),
  });
  p2.body.appendChild(entitlementChart(data));
  root.appendChild(p2.section);

  // ── turnover
  const p3 = panel({
    title: 'How much money moves',
    subtitle: 'Total value of priced allocation trades nationally, by water year. Volume and price move independently — the biggest years by volume are not the biggest by value.',
    legend: legend([{ color: MARKET.allocation, label: 'Turnover ($)' }]),
  });
  p3.body.appendChild(turnoverChart(data));
  root.appendChild(p3.section);

  // ── the honest table
  const p4 = panel({
    title: 'Every water year',
    subtitle: `The numbers behind the charts, including how much of each year's market actually carried a price. Where the priced share is low, treat that year's price as thin.`,
  });
  p4.body.appendChild(yearTable(data));
  root.appendChild(p4.section);
}

function monthlyChart(data: ViewCtx['data']): HTMLElement {
  const W = 980, H = 400;
  const M = { top: 16, right: 20, bottom: 42, left: 60 };
  const rows = data.prices.allocationMonthly;
  const x = scale(0, Math.max(1, rows.length - 1), M.left, W - M.right);
  const priced = rows.map((r) => r.vwap).filter((v): v is number => v != null);
  const y = logScale(Math.max(1, Math.min(...priced) * 0.8), Math.max(...priced) * 1.25, H - M.bottom, M.top + 70);
  const maxVol = Math.max(...rows.map((r) => r.volume));
  const yv = scale(0, maxVol, H - M.bottom, M.top);

  const chart = document.createElement('div');
  chart.className = 'chart';
  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', 'Monthly volume-weighted allocation water price, southern Murray-Darling Basin');

  const g = svgEl('g', { class: 'grid' }, svg);
  for (const v of logTicks(Math.min(...priced), Math.max(...priced))) {
    const yy = y(v);
    if (yy < M.top || yy > H - M.bottom) continue;
    svgEl('line', { x1: M.left, x2: W - M.right, y1: yy, y2: yy }, g);
    const t = svgEl('text', { x: M.left - 8, y: yy + 3.5, 'text-anchor': 'end', class: 'axis' }, svg);
    t.textContent = v >= 1000 ? `$${v / 1000}k` : `$${v}`;
  }

  // provisional band
  const firstProv = rows.findIndex((r) => r.provisional);
  if (firstProv >= 0) {
    svgEl('rect', { x: x(firstProv), y: M.top, width: (W - M.right) - x(firstProv), height: H - M.bottom - M.top, class: 'prov' }, svg);
    const t = svgEl('text', { x: x(firstProv) - 4, y: M.top + 11, class: 'prov-label', 'text-anchor': 'end' }, svg);
    t.textContent = 'still arriving ▸';
  }

  // volume as faint columns behind the price
  const bw = Math.max(1, (W - M.left - M.right) / rows.length - 0.6);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const h = H - M.bottom - yv(r.volume);
    if (h <= 0) continue;
    const rect = svgEl('rect', { x: x(i) - bw / 2, y: yv(r.volume), width: bw, height: h, fill: '#9dc4d4', opacity: 0.5, class: 'mark' }, svg);
    rect.setAttribute('data-tip', tipFor(r));
  }

  const pts = rows.map((r, i) => (r.vwap == null ? null : { x: x(i), y: y(r.vwap) }));
  svgEl('path', { d: linePath(pts), fill: 'none', stroke: MARKET.allocation, 'stroke-width': 1.1, opacity: 0.45 }, svg);
  const roll = rollingMean(rows.map((r) => r.vwap), 3);
  svgEl('path', {
    d: linePath(roll.map((v, i) => (v == null ? null : { x: x(i), y: y(v) }))),
    fill: 'none', stroke: MARKET.allocation, 'stroke-width': 2.4, 'stroke-linejoin': 'round',
  }, svg);

  // Hover targets are full-height columns so a thin line is still easy to hit
  // with a finger; the visible marks alone would be a 2px target.
  for (let i = 0; i < rows.length; i++) {
    const hit = svgEl('rect', { x: x(i) - bw / 2, y: M.top, width: Math.max(bw, 5), height: H - M.bottom - M.top, fill: 'transparent', class: 'mark' }, svg);
    hit.setAttribute('data-tip', tipFor(rows[i]));
    hit.setAttribute('aria-label', `${monthLabel(rows[i].m)}: ${perML(rows[i].vwap)}`);
  }

  const ax = svgEl('g', { class: 'axis' }, svg);
  for (let i = 0; i < rows.length; i += 12) {
    const t = svgEl('text', { x: x(i), y: H - M.bottom + 15, 'text-anchor': 'middle' }, ax);
    t.textContent = monthShort(rows[i].m);
  }
  const yt = svgEl('text', { x: M.left - 8, y: M.top + 60, 'text-anchor': 'end', class: 'axis-title' }, svg);
  yt.textContent = '$/ML';

  chart.appendChild(svg);
  return chart;
}

const tipFor = (r: { m: string; vwap: number | null; volume: number; trades: number; tradesPriced: number; pricedShare: number; provisional: boolean }): string =>
  [
    monthLabel(r.m),
    `Price ${perML(r.vwap)}`,
    `Volume ${ml(r.volume)}`,
    `${num(r.trades)} trades, ${num(r.tradesPriced)} with a price (${pct(r.pricedShare, 0)})`,
    r.provisional ? 'Provisional — trades still being reported' : null,
  ].filter(Boolean).join('\n');

function entitlementChart(data: ViewCtx['data']): HTMLElement {
  const W = 980, H = 340;
  const M = { top: 16, right: 20, bottom: 40, left: 62 };
  const rows = data.prices.entitlementYearly;
  const wys = rows.map((r) => r.wy);
  const x = scale(Math.min(...wys), Math.max(...wys), M.left, W - M.right);
  const all: number[] = [];
  for (const r of rows) for (const k of RELIABILITY_ORDER) { const v = r.byRel[k]?.vwap; if (v != null) all.push(v); }
  const y = logScale(Math.min(...all) * 0.75, Math.max(...all) * 1.25, H - M.bottom, M.top);

  const chart = document.createElement('div');
  chart.className = 'chart';
  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', 'Permanent entitlement price by reliability class and water year');

  const g = svgEl('g', { class: 'grid' }, svg);
  for (const v of logTicks(Math.min(...all), Math.max(...all))) {
    const yy = y(v);
    if (yy < M.top || yy > H - M.bottom) continue;
    svgEl('line', { x1: M.left, x2: W - M.right, y1: yy, y2: yy }, g);
    const t = svgEl('text', { x: M.left - 8, y: yy + 3.5, 'text-anchor': 'end', class: 'axis' }, svg);
    t.textContent = v >= 1000 ? `$${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : `$${v}`;
  }

  const partial = rows.find((r) => !r.complete);
  if (partial) {
    svgEl('rect', { x: x(partial.wy) - 5, y: M.top, width: (W - M.right) - x(partial.wy) + 5, height: H - M.bottom - M.top, class: 'prov' }, svg);
  }

  for (const rel of RELIABILITY_ORDER) {
    if (!RELIABILITY[rel]) continue;
    const pts = rows.map((r) => { const v = r.byRel[rel]?.vwap; return v == null ? null : { x: x(r.wy), y: y(v) }; });
    if (pts.every((p) => p == null)) continue;
    svgEl('path', { d: linePath(pts), fill: 'none', stroke: relColor(rel), 'stroke-width': 2.3, 'stroke-linejoin': 'round' }, svg);
    for (const r of rows) {
      const d = r.byRel[rel];
      if (!d) continue;
      const c = svgEl('circle', { cx: x(r.wy), cy: y(d.vwap), r: 3.6, fill: relColor(rel), class: 'mark' }, svg);
      c.setAttribute('data-tip', `${r.label} — ${rel} reliability\n${perML(d.vwap)}\n${ml(d.volume)} of entitlement traded\n${num(d.tradesPriced)} priced trades${r.complete ? '' : '\nSeason still under way'}`);
      c.setAttribute('aria-label', `${r.label} ${rel} ${perML(d.vwap)}`);
    }
  }

  const ax = svgEl('g', { class: 'axis' }, svg);
  for (const r of rows) {
    if (r.wy % 3 !== 2007 % 3) continue;
    const t = svgEl('text', { x: x(r.wy), y: H - M.bottom + 15, 'text-anchor': 'middle' }, ax);
    t.textContent = r.label;
  }
  chart.appendChild(svg);
  return chart;
}

function turnoverChart(data: ViewCtx['data']): HTMLElement {
  const W = 980, H = 260;
  const M = { top: 16, right: 20, bottom: 40, left: 66 };
  const rows = data.prices.nationalYearly;
  const max = Math.max(...rows.map((r) => r.turnover));
  const x = scale(0, Math.max(1, rows.length - 1), M.left + 14, W - M.right - 14);
  const y = scale(0, max * 1.08, H - M.bottom, M.top);

  const chart = document.createElement('div');
  chart.className = 'chart';
  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', 'National allocation market turnover by water year');
  const g = svgEl('g', { class: 'grid' }, svg);
  for (let i = 0; i <= 4; i++) {
    const v = (max * 1.08 * i) / 4;
    svgEl('line', { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v) }, g);
    const t = svgEl('text', { x: M.left - 8, y: y(v) + 3.5, 'text-anchor': 'end', class: 'axis' }, svg);
    t.textContent = dollars(v);
  }
  const bw = Math.max(4, (W - M.left - M.right - 28) / rows.length - 5);
  rows.forEach((r, i) => {
    const h = Math.max(0, H - M.bottom - y(r.turnover));
    const rect = svgEl('rect', {
      x: x(i) - bw / 2, y: y(r.turnover), width: bw, height: h,
      fill: MARKET.allocation, rx: 2, class: 'mark',
      opacity: r.wy === Math.max(...rows.map((q) => q.wy)) ? 0.45 : 1,
    }, svg);
    rect.setAttribute('data-tip', `${r.label}\nTurnover ${dollars(r.turnover)}\nVolume ${ml(r.volume)}\nAverage ${perML(r.vwap)}\n${num(r.trades)} trades`);
    rect.setAttribute('aria-label', `${r.label} turnover ${dollars(r.turnover)}`);
    if (i % 2 === 0) {
      const t = svgEl('text', { x: x(i), y: H - M.bottom + 15, 'text-anchor': 'middle', class: 'axis' }, svg);
      t.textContent = r.label;
    }
  });
  chart.appendChild(svg);
  return chart;
}

function yearTable(data: ViewCtx['data']): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const ent = new Map(data.prices.entitlementYearly.map((d) => [d.wy, d.byRel]));
  const sortKey = prefs.get('prices.sort', 'wy');
  const rows = [...data.prices.allocationYearly].sort((a, b) => (sortKey === 'wy' ? b.wy - a.wy : (b.vwap ?? 0) - (a.vwap ?? 0)));
  wrap.innerHTML = `
    <table>
      <thead><tr>
        <th>Water year</th>
        <th class="num">Allocation $/ML</th>
        <th class="num">Volume</th>
        <th class="num">Trades</th>
        <th class="num">Priced share</th>
        <th class="num">Entitlement (high) $/ML</th>
        <th class="num">Entitlement (low) $/ML</th>
      </tr></thead>
      <tbody>${rows.map((r) => {
        const e = ent.get(r.wy);
        return `<tr>
          <td>${esc(r.label)}${r.complete ? '' : ' <span class="pill" style="background:var(--status-warn)">under way</span>'}</td>
          <td class="num">${esc(perML(r.vwap))}</td>
          <td class="num">${esc(ml(r.volume))}</td>
          <td class="num">${num(r.trades)}</td>
          <td class="num">${esc(pct(r.pricedShare, 0))}</td>
          <td class="num">${esc(e?.High ? perML(e.High.vwap) : '—')}</td>
          <td class="num">${esc(e?.Low ? perML(e.Low.vwap) : '—')}</td>
        </tr>`;
      }).join('')}</tbody>
    </table>`;
  return wrap;
}
