// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The view only transaction-level data can produce. A published price index can
// tell you what the average was; only the individual trades can tell you how
// far apart the prices in one place in one month actually were — which is the
// difference between a working market and a rumour mill.

import type { ViewCtx } from '../router.ts';
import { esc, escTip, monthLabel, num, perML, pct, zoneLabel } from '../format.ts';
import { glossaryIcon } from '../glossary.ts';
import { anomalies } from '../analysis.ts';
import { legend, panel } from './svg.ts';
import { spreadRamp } from '../colors.ts';
import { openZone } from '../zoneDrawer.ts';

export function renderDispersion({ root, data }: ViewCtx): void {
  const p = panel({
    title: `How orderly is the market? ${glossaryIcon('dispersion')}`,
    subtitle: 'Each cell is one trading zone in one month, shaded by how far apart the prices paid inside it were — the gap between the cheapest quarter and the dearest quarter, as a share of the middle price. Pale means everyone paid about the same. Deep ochre means two neighbours paid very different prices for identical water in the same place in the same month.',
    legend: legend([
      { color: spreadRamp(0.05), label: 'Tight — under 10% spread' },
      { color: spreadRamp(0.4), label: '~40%' },
      { color: spreadRamp(1), label: 'Wide — 100% or more' },
    ]),
    wide: true,
  });

  p.body.appendChild(heatmap(data));
  const note = document.createElement('p');
  note.className = 'note';
  const shownCells = data.dispersion.cells.filter((c) => c.m >= '2012-07').length;
  note.innerHTML = `The matrix starts in July 2012 and covers the ${data.dispersion.zones.length} busiest zones — ${num(shownCells)} of ${num(data.dispersion.cells.length)} measurable zone-months. Earlier years are too sparse to draw at a legible cell width, and the tables below may cite a month before the chart begins. Only zone-months with at least 8 priced trades and a median above $5/ML are measured at all; blank cells are months that fell short. Prices exclude zero-consideration and token-dollar transfers.`;
  p.body.appendChild(note);
  root.appendChild(p.section);

  // Two DIFFERENT kinds of outlier, deliberately kept apart: a zone can be
  // expensive without being disorderly, and disorderly without being expensive.
  const an = anomalies(data.dispersion, 20, 10);
  const p2 = panel({
    title: 'Where prices came apart',
    subtitle: 'Zone-months whose internal price spread was widest. These are the moments when knowing the market was worth the most money.',
  });
  // Shown as an actual price RANGE. A percentage of the median stops meaning
  // anything past a few hundred percent, and in a bimodal groundwater zone-month
  // it reaches 4,760% while being entirely real.
  p2.body.appendChild(outlierTable(data, an.spreadOutliers.map((o) => ({
    zone: o.zone, m: o.m, n: o.n,
    lead: `${perML(o.p25)} – ${perML(o.p75)}`, mid: perML(o.p50), leadLabel: 'cheapest to dearest quarter',
  }))));
  root.appendChild(p2.section);

  const p3 = panel({
    title: 'Where prices were far from everyone else',
    subtitle: 'Zone-months priced well above or below the market median for that month. An isolated zone, a delivery constraint, or a very thin market — not the same thing as a disorderly one.',
  });
  p3.body.appendChild(outlierTable(data, an.levelOutliers.map((o) => ({
    zone: o.zone, m: o.m, n: o.n,
    lead: `${o.ratio >= 1 ? '+' : ''}${((o.ratio - 1) * 100).toFixed(0)}%`,
    mid: perML(o.p50), leadLabel: 'vs market',
  }))));
  root.appendChild(p3.section);
}

function heatmap(data: ViewCtx['data']): HTMLElement {
  const zones = data.dispersion.zones;
  const months = [...new Set(data.dispersion.cells.map((c) => c.m))].sort();
  // The matrix only gets legible after ~2012, and the early sparse years push
  // every cell below a usable width — so it starts where the market does.
  const shown = months.filter((m) => m >= '2012-07');
  const cellW = 9, cellH = 20, labelW = 250, headerH = 42;
  const W = labelW + shown.length * cellW + 12;
  const H = headerH + zones.length * cellH + 10;

  const byKey = new Map(data.dispersion.cells.map((c) => [`${c.z}|${c.m}`, c]));

  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('width', String(W));
  svg.setAttribute('height', String(H));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Price dispersion by trading zone and month');
  svg.style.minWidth = `${W}px`;

  const mk = (n: string, a: Record<string, string | number>, parent: Element) => {
    const e = document.createElementNS('http://www.w3.org/2000/svg', n);
    for (const [k, v] of Object.entries(a)) e.setAttribute(k, String(v));
    parent.appendChild(e);
    return e;
  };

  // year ticks
  shown.forEach((m, i) => {
    if (!m.endsWith('-07')) return;
    const t = mk('text', { x: labelW + i * cellW, y: headerH - 24, class: 'axis', 'text-anchor': 'start' }, svg);
    t.textContent = m.slice(0, 4);
    mk('line', { x1: labelW + i * cellW - 1, x2: labelW + i * cellW - 1, y1: headerH - 18, y2: H - 10, stroke: 'var(--border-subtle)' }, svg);
  });

  zones.forEach((zn, zi) => {
    const y = headerH + zi * cellH;
    const zone = data.zones.find((z) => z.name === zn);
    const lbl = mk('text', { x: labelW - 8, y: y + cellH / 2 + 4, class: 'axis', 'text-anchor': 'end' }, svg) as SVGTextElement;
    // 250px of label at 10px monospace holds roughly 30 characters; anything
    // longer runs off the left edge of the viewBox and is simply clipped away.
    const dn = zoneLabel(zn, zone?.state);
    lbl.textContent = dn.length > 30 ? `${dn.slice(0, 29)}…` : dn;
    if (zone) {
      lbl.style.cursor = 'pointer';
      lbl.setAttribute('data-tip', escTip(`${zn}\nOpen this zone`).replace(/&#10;/g, '\n'));
      lbl.addEventListener('click', () => openZone(data, zone.slug));
    }
    shown.forEach((m, mi) => {
      const c = byKey.get(`${zi}|${m}`);
      if (!c || c.rel == null) return;
      const r = mk('rect', {
        x: labelW + mi * cellW, y: y + 1, width: cellW - 0.6, height: cellH - 2,
        fill: spreadRamp(Math.min(1, c.rel)), class: 'mark clickable',
      }, svg);
      r.setAttribute('data-tip', [
        `${zn}`,
        monthLabel(m),
        `Middle price ${perML(c.p50)}`,
        `Cheapest quarter below ${perML(c.p25)}, dearest above ${perML(c.p75)}`,
        `Spread ${pct(c.rel, 0)} of the middle price`,
        `${num(c.n)} priced trades`,
      ].join('\n'));
      r.setAttribute('aria-label', `${zn} ${m} spread ${pct(c.rel, 0)}`);
      if (zone) r.addEventListener('click', () => openZone(data, zone.slug));
    });
  });

  wrap.appendChild(svg);
  return wrap;
}

function outlierTable(
  data: ViewCtx['data'],
  rows: { zone: string; m: string; n: number; lead: string; mid: string; leadLabel: string }[],
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty">Nothing crossed the threshold.</div>';
    return wrap;
  }
  const bySlug = new Map(data.zones.map((z) => [z.name, z.slug]));
  wrap.innerHTML = `<table><thead><tr>
    <th>Trading zone</th><th>Month</th><th class="num">${esc(rows[0].leadLabel)}</th>
    <th class="num">Middle price</th><th class="num">Trades</th>
  </tr></thead><tbody>${rows.map((r) => `<tr>
    <td><span class="zone-link" data-slug="${esc(bySlug.get(r.zone) ?? '')}">${esc(zoneLabel(r.zone))}</span></td>
    <td>${esc(monthLabel(r.m))}</td>
    <td class="num"><strong>${esc(r.lead)}</strong></td>
    <td class="num">${esc(r.mid)}</td>
    <td class="num">${num(r.n)}</td>
  </tr>`).join('')}</tbody></table>`;
  wrap.addEventListener('click', (e) => {
    const s = (e.target as Element).closest<HTMLElement>('.zone-link')?.dataset.slug;
    if (s) openZone(data, s);
  });
  return wrap;
}
