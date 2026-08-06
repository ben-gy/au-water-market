// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The view no other public site has: a physical constraint in a river, priced
// by the market on either side of it.

import type { ViewCtx } from '../router.ts';
import { chokeSummary } from '../analysis.ts';
import { esc, ml, monthLabel, monthShort, num, perML, signedPct } from '../format.ts';
import { glossaryHtml, glossaryIcon } from '../glossary.ts';
import { legend, linePath, makeSvg, panel, scale, svgEl, ticks } from './svg.ts';

const ABOVE_C = '#2f6f4f';
const BELOW_C = '#b06b1f';

export function renderChoke({ root, data }: ViewCtx): void {
  const months = data.choke.months;
  const all = chokeSummary(months);
  const recent = chokeSummary(months, '2023-07');

  const stats = document.createElement('div');
  stats.className = 'stats';
  stats.innerHTML = [
    ['Months below cost more', `${recent.premium} of ${recent.months}`, 'since July 2023'],
    ['Median premium', signedPct(recent.medianSpread), 'below the Choke, recent months'],
    ['Widest gap', signedPct(recent.widest?.spread ?? null), recent.widest ? esc(monthLabel(recent.widest.m)) : ''],
    ['Whole record', `${all.premium} of ${all.months}`, 'months with a premium below'],
  ].map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(v)}</div><div class="d">${d}</div></div>`).join('');
  root.appendChild(stats);

  const p = panel({
    title: `The Barmah Choke ${glossaryIcon('choke')}`,
    subtitle: `Two trading zones on the same river, separated by a stretch of channel that physically cannot carry more than about 8,500 megalitres a day. Water above the Choke and water below it are the same water — but when demand downstream is high, the water above cannot get there, and the market prices the difference. Only trades <em>within</em> each zone are compared, so this is like for like.`,
    legend: legend([
      { color: ABOVE_C, label: `Above the Choke — ${data.choke.above}`, shape: 'line' },
      { color: BELOW_C, label: `Below the Choke — ${data.choke.below}`, shape: 'line' },
    ]),
  });
  p.body.appendChild(chokeChart(months));
  const note = document.createElement('p');
  note.className = 'note';
  note.innerHTML = `A month appears only where <strong>both</strong> zones had at least five priced trades within them, so a gap here means a thin market, not a missing number. Prices are ${glossaryHtml('vwap', 'volume-weighted')}.`;
  p.body.appendChild(note);
  root.appendChild(p.section);

  const p2 = panel({
    title: 'The gap, month by month',
    subtitle: 'How much more a megalitre cost below the Choke than above it. Bars above the line are a downstream premium — the ordinary state of affairs. Bars below it are the rarer case, when water downstream was the cheaper of the two.',
  });
  p2.body.appendChild(spreadChart(months));
  root.appendChild(p2.section);
}

function chokeChart(months: ViewCtx['data']['choke']['months']): HTMLElement {
  const W = 980, H = 360;
  const M = { top: 16, right: 20, bottom: 40, left: 58 };
  const x = scale(0, Math.max(1, months.length - 1), M.left, W - M.right);
  const vals = months.flatMap((m) => [m.above?.vwap, m.below?.vwap].filter((v): v is number => v != null));
  const y = scale(0, Math.max(...vals) * 1.1, H - M.bottom, M.top);

  const chart = document.createElement('div');
  chart.className = 'chart';
  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', 'Water price above and below the Barmah Choke, by month');

  // Round ticks, not max/5 — evenly dividing the maximum gives an axis labelled
  // $178, $355, $533, $711, $888, which is arithmetically fine and unreadable.
  const g = svgEl('g', { class: 'grid' }, svg);
  for (const v of ticks(0, Math.max(...vals) * 1.1, 5)) {
    svgEl('line', { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v) }, g);
    const t = svgEl('text', { x: M.left - 8, y: y(v) + 3.5, 'text-anchor': 'end', class: 'axis' }, svg);
    t.textContent = `$${Math.round(v)}`;
  }

  // The band between the two lines IS the story, so it is filled: where ochre
  // shows, downstream water cost more.
  const bandPts: string[] = [];
  const backPts: string[] = [];
  months.forEach((m, i) => {
    if (m.above && m.below) {
      bandPts.push(`${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(m.below.vwap).toFixed(1)}`);
      backPts.unshift(`L${x(i).toFixed(1)} ${y(m.above.vwap).toFixed(1)}`);
    }
  });
  if (bandPts.length) {
    svgEl('path', { d: `${bandPts.join('')}${backPts.join('')}Z`, fill: BELOW_C, opacity: 0.14 }, svg);
  }

  svgEl('path', { d: linePath(months.map((m, i) => (m.above ? { x: x(i), y: y(m.above.vwap) } : null))), fill: 'none', stroke: ABOVE_C, 'stroke-width': 2.2 }, svg);
  svgEl('path', { d: linePath(months.map((m, i) => (m.below ? { x: x(i), y: y(m.below.vwap) } : null))), fill: 'none', stroke: BELOW_C, 'stroke-width': 2.2 }, svg);

  const bw = Math.max(3, (W - M.left - M.right) / months.length);
  months.forEach((m, i) => {
    const hit = svgEl('rect', { x: x(i) - bw / 2, y: M.top, width: bw, height: H - M.bottom - M.top, fill: 'transparent', class: 'mark' }, svg);
    hit.setAttribute('data-tip', [
      monthShort(m.m),
      `Above the Choke  ${perML(m.above?.vwap ?? null)}  (${num(m.above?.trades ?? 0)} trades, ${ml(m.above?.volume ?? 0)})`,
      `Below the Choke  ${perML(m.below?.vwap ?? null)}  (${num(m.below?.trades ?? 0)} trades, ${ml(m.below?.volume ?? 0)})`,
      `Downstream premium ${signedPct(m.spread)}`,
    ].join('\n'));
    hit.setAttribute('aria-label', `${m.m}: above ${perML(m.above?.vwap ?? null)}, below ${perML(m.below?.vwap ?? null)}`);
  });

  const ax = svgEl('g', { class: 'axis' }, svg);
  for (let i = 0; i < months.length; i += Math.max(1, Math.round(months.length / 12))) {
    const t = svgEl('text', { x: x(i), y: H - M.bottom + 15, 'text-anchor': 'middle' }, ax);
    t.textContent = monthShort(months[i].m);
  }
  chart.appendChild(svg);
  return chart;
}

function spreadChart(months: ViewCtx['data']['choke']['months']): HTMLElement {
  const W = 980, H = 250;
  const M = { top: 16, right: 20, bottom: 40, left: 58 };
  const rows = months.filter((m) => m.spread != null);
  const x = scale(0, Math.max(1, rows.length - 1), M.left + 6, W - M.right - 6);
  const maxAbs = Math.max(...rows.map((m) => Math.abs(m.spread as number))) * 1.1;
  const y = scale(-maxAbs, maxAbs, H - M.bottom, M.top);

  const chart = document.createElement('div');
  chart.className = 'chart';
  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', 'Price premium below the Barmah Choke relative to above, by month');
  const g = svgEl('g', { class: 'grid' }, svg);
  for (const v of [-maxAbs / 2, 0, maxAbs / 2]) {
    svgEl('line', { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v) }, g);
    const t = svgEl('text', { x: M.left - 8, y: y(v) + 3.5, 'text-anchor': 'end', class: 'axis' }, svg);
    t.textContent = `${v > 0 ? '+' : ''}${Math.round(v)}%`;
  }
  svgEl('line', { x1: M.left, x2: W - M.right, y1: y(0), y2: y(0), stroke: 'var(--border-strong)', 'stroke-width': 1.2 }, svg);

  const bw = Math.max(2, (W - M.left - M.right - 12) / rows.length - 1.2);
  rows.forEach((m, i) => {
    const s = m.spread as number;
    const y0 = y(0), y1 = y(s);
    const rect = svgEl('rect', {
      x: x(i) - bw / 2, y: Math.min(y0, y1), width: bw, height: Math.max(1, Math.abs(y1 - y0)),
      fill: s >= 0 ? BELOW_C : ABOVE_C, rx: 1, class: 'mark',
    }, svg);
    rect.setAttribute('data-tip', `${monthShort(m.m)}\nDownstream premium ${signedPct(s)}\nAbove ${perML(m.above?.vwap ?? null)} · Below ${perML(m.below?.vwap ?? null)}`);
    rect.setAttribute('aria-label', `${m.m} premium ${signedPct(s)}`);
  });
  const ax = svgEl('g', { class: 'axis' }, svg);
  for (let i = 0; i < rows.length; i += Math.max(1, Math.round(rows.length / 12))) {
    const t = svgEl('text', { x: x(i), y: H - M.bottom + 15, 'text-anchor': 'middle' }, ax);
    t.textContent = monthShort(rows[i].m);
  }
  chart.appendChild(svg);
  return chart;
}
