// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { ViewCtx } from '../router.ts';
import { goto } from '../router.ts';
import { buildInsights, decoupling } from '../analysis.ts';
import { auDate, esc, escTip, isoDate, ml, num, perML, zoneLabel } from '../format.ts';
import { glossaryHtml } from '../glossary.ts';
import { MARKET } from '../colors.ts';
import { legend, linePath, logScale, makeSvg, panel, scale, svgEl } from './svg.ts';
import { openZone } from '../zoneDrawer.ts';

export function renderOverview({ root, data }: ViewCtx): void {
  const h = data.meta.headline;

  // ── stat tiles. Every one is a COMPLETE water year; the season under way is
  // shown separately and labelled, never used as "the price of water".
  const stats = document.createElement('div');
  stats.className = 'stats';
  const tile = (k: string, v: string, d: string, cls = '') => `
    <div class="stat"><div class="k">${k}</div><div class="v ${cls}">${esc(v)}</div><div class="d">${d}</div></div>`;

  const dec = decoupling(data, 2019, 2022);
  stats.innerHTML = [
    tile(glossaryHtml('allocation', 'Allocation price'), perML(h.allocationLatest?.vwap ?? null),
      `${esc(h.allocationLatest?.label ?? '')} · ${num(h.allocationLatest?.trades ?? 0)} trades`),
    tile(glossaryHtml('entitlement', 'Entitlement price'), perML(h.entitlementLatest?.byRel.High?.vwap ?? null),
      `high reliability · ${esc(h.entitlementLatest?.label ?? '')}`),
    tile(glossaryHtml('onissue', 'Entitlements on issue'), ml(h.stockTotal),
      `all Australia · at ${auDate(h.stockDate)}`),
    tile('Trades on record', num(data.meta.allocation.rows + data.meta.entitlements.rows),
      `${isoDate(data.meta.entitlements.first)} – ${isoDate(data.meta.allocation.last)}`),
  ].join('');
  root.appendChild(stats);

  // ── the thesis, stated in plain words with its own numbers attached.
  const lead = panel({
    title: 'Two water markets, moving in opposite directions',
    // Both endpoint years are NAMED. "over the identical years" without saying
    // which years invites the reader to assume the comparison is the whole
    // record, and lets a cherry-picked window pass unexamined.
    subtitle: `The price of water for <em>one season</em> and the price of water <em>for ever</em> used to rise and fall together. Between ${esc(dec.fromLabel)} and ${esc(dec.toLabel)} they came apart: allocation prices fell ${dec.allocationChange != null ? Math.abs(dec.allocationChange).toFixed(0) : '—'}% — from ${esc(perML(dec.allocationFrom))} to ${esc(perML(dec.allocationTo))} — while high-reliability entitlement prices <em>rose</em> ${dec.entitlementChange != null ? dec.entitlementChange.toFixed(0) : '—'}%, from ${esc(perML(dec.entitlementFrom))} to ${esc(perML(dec.entitlementTo))}. The line below shows the whole record, not just those two years.`,
    legend: legend([
      { color: MARKET.allocation, label: 'Allocation — water for this season ($/ML)', shape: 'line' },
      { color: MARKET.entitlement, label: 'Entitlement — water for ever, high reliability ($/ML)', shape: 'line' },
    ]),
  });
  lead.body.appendChild(decouplingChart(data));
  const note = document.createElement('p');
  note.className = 'note';
  note.innerHTML = `Both series are ${glossaryHtml('vwap', 'volume-weighted')} and restricted to the ${glossaryHtml('smdb', 'southern Murray-Darling Basin')}. The vertical scale is logarithmic because the two markets are two orders of magnitude apart — on a linear axis the allocation line would be flat against the floor.`;
  lead.body.appendChild(note);
  root.appendChild(lead.section);

  // ── insights
  const ins = panel({
    title: 'What the data shows',
    subtitle: 'Findings computed from the registered trades, not editorial. Each one names the numbers behind it.',
  });
  const grid = document.createElement('div');
  grid.className = 'insights';
  for (const i of buildInsights(data)) {
    const card = document.createElement('article');
    card.className = `insight ${i.severity}`;
    const t = document.createElement('h3');
    t.textContent = i.title;
    const p = document.createElement('p');
    p.textContent = i.detail;
    card.append(t, p);
    if (i.view) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'jump';
      b.textContent = 'See it →';
      b.addEventListener('click', () => goto(i.view as string));
      card.appendChild(b);
    }
    grid.appendChild(card);
  }
  ins.body.appendChild(grid);
  root.appendChild(ins.section);

  // ── biggest markets, clickable straight into the dossier
  const big = panel({
    title: 'Where the market actually is',
    subtitle: `Australia trades water in ${num(data.meta.zones)} ${glossaryHtml('tradingzone', 'trading zones')}, but a handful carry most of it. Click any zone for its full history.`,
  });
  const top = [...data.zones].sort((a, b) => b.volume - a.volume).slice(0, 10);
  const maxV = top[0]?.volume ?? 1;
  const wrap = document.createElement('div');
  wrap.className = 'bars';
  wrap.innerHTML = top.map((z) => {
    const w = Math.max(1, (z.volume / maxV) * 100);
    return `<button class="barrow" type="button" data-slug="${esc(z.slug)}" data-tip="${escTip(`${z.name}\n${ml(z.volume)} traded all-time\n${z.tradesPriced.toLocaleString('en-AU')} priced trades\nAverage ${perML(z.vwap)}`)}">
      <span class="barlabel">${esc(zoneLabel(z.name, z.state))}</span>
      <span class="bartrack"><span class="barfill" style="width:${w}%"></span></span>
      <span class="barval">${esc(ml(z.volume))}</span>
    </button>`;
  }).join('');
  wrap.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('.barrow');
    if (b?.dataset.slug) openZone(data, b.dataset.slug);
  });
  big.body.appendChild(wrap);
  root.appendChild(big.section);
}

/** The flagship chart: two price series on one log axis, 18 water years. */
function decouplingChart(data: ViewCtx['data']): HTMLElement {
  const W = 980, H = 380;
  const M = { top: 16, right: 20, bottom: 40, left: 62 };
  const years = data.prices.allocationYearly;
  const ent = new Map(data.prices.entitlementYearly.map((d) => [d.wy, d.byRel.High?.vwap ?? null]));

  const wys = years.map((y) => y.wy);
  const x = scale(Math.min(...wys), Math.max(...wys), M.left, W - M.right);
  const vals = [
    ...years.map((y) => y.vwap).filter((v): v is number => v != null),
    ...[...ent.values()].filter((v): v is number => v != null),
  ];
  const y = logScale(Math.min(...vals) * 0.8, Math.max(...vals) * 1.2, H - M.bottom, M.top);

  const chart = document.createElement('div');
  chart.className = 'chart';
  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', 'Allocation and entitlement water prices by water year, logarithmic scale');

  const g = svgEl('g', { class: 'grid' }, svg);
  for (const v of [20, 50, 100, 200, 500, 1000, 2000, 5000]) {
    const yy = y(v);
    if (yy < M.top || yy > H - M.bottom) continue;
    svgEl('line', { x1: M.left, x2: W - M.right, y1: yy, y2: yy }, g);
    const t = svgEl('text', { x: M.left - 8, y: yy + 3.5, 'text-anchor': 'end', class: 'axis' }, svg);
    t.textContent = v >= 1000 ? `$${v / 1000}k` : `$${v}`;
  }
  const ax = svgEl('g', { class: 'axis' }, svg);
  for (const yr of years) {
    if (yr.wy % 3 !== 2008 % 3) continue;
    const t = svgEl('text', { x: x(yr.wy), y: H - M.bottom + 16, 'text-anchor': 'middle' }, ax);
    t.textContent = yr.label;
  }

  // The in-progress season, shaded so it cannot be mistaken for a finished year.
  const partial = years.find((yr) => !yr.complete);
  if (partial) {
    svgEl('rect', {
      x: x(partial.wy) - 6, y: M.top, width: (W - M.right) - x(partial.wy) + 6,
      height: H - M.bottom - M.top, class: 'prov',
    }, svg);
    // Sits at the FOOT of the band, not the head: at the top it lands squarely
    // on the entitlement line, which runs along the ceiling of this chart.
    const lab = svgEl('text', { x: x(partial.wy) - 4, y: H - M.bottom - 6, class: 'prov-label', 'text-anchor': 'end' }, svg);
    lab.textContent = 'season under way ▸';
  }

  const allocPts = years.map((yr) => (yr.vwap == null ? null : { x: x(yr.wy), y: y(yr.vwap) }));
  const entPts = years.map((yr) => { const v = ent.get(yr.wy); return v == null ? null : { x: x(yr.wy), y: y(v) }; });
  svgEl('path', { d: linePath(entPts), fill: 'none', stroke: MARKET.entitlement, 'stroke-width': 2.6, 'stroke-linejoin': 'round' }, svg);
  svgEl('path', { d: linePath(allocPts), fill: 'none', stroke: MARKET.allocation, 'stroke-width': 2.6, 'stroke-linejoin': 'round' }, svg);

  for (const yr of years) {
    const av = yr.vwap, ev = ent.get(yr.wy) ?? null;
    if (av != null) {
      const c = svgEl('circle', { cx: x(yr.wy), cy: y(av), r: 4, fill: MARKET.allocation, class: 'mark' }, svg);
      c.setAttribute('data-tip', `${yr.label} — allocation\n${perML(av)}\n${ml(yr.volume)} traded across ${num(yr.trades)} trades${yr.complete ? '' : '\nSeason still under way'}`);
      c.setAttribute('aria-label', `${yr.label} allocation ${perML(av)}`);
    }
    if (ev != null) {
      const c = svgEl('circle', { cx: x(yr.wy), cy: y(ev), r: 4, fill: MARKET.entitlement, class: 'mark' }, svg);
      c.setAttribute('data-tip', `${yr.label} — entitlement (high reliability)\n${perML(ev)}`);
      c.setAttribute('aria-label', `${yr.label} entitlement ${perML(ev)}`);
    }
  }

  // Annotate the two endpoints of the claim rather than leaving the reader to
  // find them: a chart that requires a caption to be understood needs the
  // caption drawn on it.
  const peak = data.meta.headline.allocationPeak;
  if (peak?.vwap != null) {
    const px = x(peak.wy), py = y(peak.vwap);
    svgEl('line', { x1: px, y1: py - 10, x2: px, y2: py - 26, stroke: MARKET.allocation, 'stroke-width': 1, 'stroke-dasharray': '2 2' }, svg);
    const t = svgEl('text', { x: px, y: py - 30, 'text-anchor': 'middle', class: 'axis-title', fill: MARKET.allocation }, svg);
    t.textContent = `drought peak ${perML(peak.vwap)}`;
  }

  chart.appendChild(svg);
  return chart;
}
