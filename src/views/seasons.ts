// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Month-of-water-year is a CYCLE, and a linear axis hides the thing that makes
// it interesting: the same shape repeating every June, eighteen times over. So
// this is a radial clock, one ring per season.

import type { ViewCtx } from '../router.ts';
import { juneEffect } from '../analysis.ts';
import { esc, ml, num, perML, WATER_MONTHS } from '../format.ts';
import { glossaryIcon } from '../glossary.ts';
import { legend, makeSvg, panel, scale, svgEl } from './svg.ts';

export function renderSeasons({ root, data }: ViewCtx): void {
  const j = juneEffect(data.seasons.rows);

  const stats = document.createElement('div');
  stats.className = 'stats';
  stats.innerHTML = [
    ['June volume', `${j.volumeRatio?.toFixed(1) ?? '—'}×`, 'the volume of a typical month'],
    ['June price', `${j.priceRatio != null ? `${((1 - j.priceRatio) * 100).toFixed(0)}% lower` : '—'}`, 'than a typical month'],
    ['Typical June', ml(j.juneVolume), `at ${perML(j.junePrice)}`],
    ['Typical other month', ml(j.otherVolume), `at ${perML(j.otherPrice)}`],
  ].map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(v)}</div><div class="d">${esc(d)}</div></div>`).join('');
  root.appendChild(stats);

  const p = panel({
    title: `The shape of a water year ${glossaryIcon('wateryear')}`,
    subtitle: 'Allocations reset on 1 July, so water left unused on 30 June is worth nothing the next morning. Every ring is one season — 2008-09 at the centre, the newest on the outside — running clockwise from July. Each segment is one month, shaded by how much water changed hands: the darker the block, the bigger the month. The June band darkens in almost every ring.',
    legend: legend([
      { color: '#c8dde6', label: 'Earlier seasons' },
      { color: '#1f6f8b', label: 'Recent seasons' },
    ]),
  });
  p.body.appendChild(clock(data));
  root.appendChild(p.section);

  const p2 = panel({
    title: 'Volume and price by month of the season',
    subtitle: 'The same data unrolled. Volume peaks in June as sellers clear their accounts; the price falls at exactly the moment the most water is for sale.',
    legend: legend([
      { color: '#9dc4d4', label: 'Median volume traded' },
      { color: '#b06b1f', label: 'Median price', shape: 'line' },
    ]),
  });
  p2.body.appendChild(monthProfile(data));
  root.appendChild(p2.section);
}

function clock(data: ViewCtx['data']): HTMLElement {
  const size = 560, cx = size / 2, cy = size / 2 + 10;
  const rInner = 62, rOuter = size / 2 - 44;
  const rows = data.seasons.rows;
  const years = [...new Set(rows.map((r) => r.wy))].sort((a, b) => a - b);
  const maxVol = Math.max(...rows.map((r) => r.volume));
  const byKey = new Map(rows.map((r) => [`${r.wy}|${r.wmi}`, r]));

  const wrap = document.createElement('div');
  wrap.className = 'chart no-scroll';
  const svg = makeSvg(size, size + 12);
  svg.setAttribute('aria-label', 'Volume of water traded by month of the water year, one ring per season');
  svg.style.maxWidth = '620px';
  svg.style.margin = '0 auto';

  const ringH = (rOuter - rInner) / years.length;
  const A = (wmi: number) => (wmi / 12) * Math.PI * 2 - Math.PI / 2;

  const arc = (r0: number, r1: number, a0: number, a1: number) => {
    const p = (r: number, a: number) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M${p(r0, a0)}A${r0} ${r0} 0 ${large} 1 ${p(r0, a1)}L${p(r1, a1)}A${r1} ${r1} 0 ${large} 0 ${p(r1, a0)}Z`;
  };

  years.forEach((wy, yi) => {
    const r0 = rInner + yi * ringH;
    const r1 = r0 + ringH - 1.2;
    const t = years.length > 1 ? yi / (years.length - 1) : 1;
    for (let wmi = 0; wmi < 12; wmi++) {
      const row = byKey.get(`${wy}|${wmi}`);
      if (!row || row.volume <= 0) continue;
      const a0 = A(wmi) + 0.012, a1 = A(wmi + 1) - 0.012;
      // Radius is fixed per ring (it encodes the YEAR); volume is encoded by
      // colour intensity, so that a big year cannot swamp the ring geometry.
      const k = Math.min(1, row.volume / maxVol);
      const path = svgEl('path', {
        d: arc(r0, r1, a0, a1),
        fill: `rgb(${Math.round(232 - 200 * k * (0.45 + 0.55 * t))}, ${Math.round(243 - 132 * k * (0.45 + 0.55 * t))}, ${Math.round(248 - 109 * k * (0.45 + 0.55 * t))})`,
        stroke: '#fff', 'stroke-width': 0.4, class: 'mark',
      }, svg);
      path.setAttribute('data-tip', [
        `${WATER_MONTHS[wmi]} — ${wy}-${String((wy + 1) % 100).padStart(2, '0')} season`,
        `Volume ${ml(row.volume)}`,
        `Price ${perML(row.vwap)}`,
        `${num(row.trades)} trades`,
      ].join('\n'));
      path.setAttribute('aria-label', `${WATER_MONTHS[wmi]} ${wy}: ${ml(row.volume)}`);
    }
  });

  for (let wmi = 0; wmi < 12; wmi++) {
    const a = A(wmi + 0.5);
    const r = rOuter + 18;
    const t = svgEl('text', {
      x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) + 4,
      'text-anchor': 'middle', class: 'axis',
      'font-weight': wmi === 11 ? 700 : 400,
      fill: wmi === 11 ? 'var(--status-warn)' : 'var(--text-muted)',
    }, svg);
    t.textContent = WATER_MONTHS[wmi];
  }
  const c1 = svgEl('text', { x: cx, y: cy - 6, 'text-anchor': 'middle', class: 'axis-title' }, svg);
  c1.textContent = '2008-09';
  const c2 = svgEl('text', { x: cx, y: cy + 10, 'text-anchor': 'middle', class: 'axis' }, svg);
  c2.textContent = 'inner ring';
  const c3 = svgEl('text', { x: cx, y: cy + 26, 'text-anchor': 'middle', class: 'axis' }, svg);
  c3.textContent = `outer ${years[years.length - 1]}-${String((years[years.length - 1] + 1) % 100).padStart(2, '0')}`;

  wrap.appendChild(svg);
  return wrap;
}

function monthProfile(data: ViewCtx['data']): HTMLElement {
  const W = 980, H = 300;
  const M = { top: 18, right: 58, bottom: 40, left: 62 };
  const rows = data.seasons.rows;
  const med = (xs: number[]) => {
    if (!xs.length) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const months = Array.from({ length: 12 }, (_, wmi) => {
    const r = rows.filter((x) => x.wmi === wmi);
    return {
      wmi,
      volume: med(r.map((x) => x.volume)),
      price: med(r.map((x) => x.vwap).filter((v): v is number => v != null)),
    };
  });
  const maxV = Math.max(...months.map((m) => m.volume)) * 1.12;
  const maxP = Math.max(...months.map((m) => m.price)) * 1.15;
  const x = scale(0, 11, M.left + 34, W - M.right - 34);
  const yv = scale(0, maxV, H - M.bottom, M.top);
  const yp = scale(0, maxP, H - M.bottom, M.top);

  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', 'Median volume and price by month of the water year');

  for (let i = 0; i <= 4; i++) {
    const v = (maxV * i) / 4;
    svgEl('line', { x1: M.left, x2: W - M.right, y1: yv(v), y2: yv(v), stroke: 'var(--border-subtle)' }, svg);
    const t = svgEl('text', { x: M.left - 8, y: yv(v) + 3.5, 'text-anchor': 'end', class: 'axis' }, svg);
    t.textContent = `${Math.round(v / 1000)}k`;
  }
  const bw = (W - M.left - M.right - 68) / 12 - 8;
  months.forEach((m) => {
    const h = H - M.bottom - yv(m.volume);
    const rect = svgEl('rect', {
      x: x(m.wmi) - bw / 2, y: yv(m.volume), width: bw, height: Math.max(1, h),
      fill: m.wmi === 11 ? '#b06b1f' : '#9dc4d4', rx: 2, class: 'mark',
    }, svg);
    rect.setAttribute('data-tip', `${WATER_MONTHS[m.wmi]}\nMedian volume ${ml(m.volume)}\nMedian price ${perML(m.price)}`);
    rect.setAttribute('aria-label', `${WATER_MONTHS[m.wmi]} median volume ${ml(m.volume)}`);
    const t = svgEl('text', { x: x(m.wmi), y: H - M.bottom + 16, 'text-anchor': 'middle', class: 'axis' }, svg);
    t.textContent = WATER_MONTHS[m.wmi];
  });

  const path = months.map((m, i) => `${i ? 'L' : 'M'}${x(m.wmi).toFixed(1)} ${yp(m.price).toFixed(1)}`).join('');
  svgEl('path', { d: path, fill: 'none', stroke: '#b06b1f', 'stroke-width': 2.6, 'stroke-linejoin': 'round' }, svg);
  months.forEach((m) => {
    const c = svgEl('circle', { cx: x(m.wmi), cy: yp(m.price), r: 4, fill: '#b06b1f', class: 'mark' }, svg);
    c.setAttribute('data-tip', `${WATER_MONTHS[m.wmi]}\nMedian price ${perML(m.price)}`);
  });
  for (let i = 0; i <= 4; i++) {
    const v = (maxP * i) / 4;
    const t = svgEl('text', { x: W - M.right + 8, y: yp(v) + 3.5, class: 'axis', fill: '#b06b1f' }, svg);
    t.textContent = `$${Math.round(v)}`;
  }
  const lt = svgEl('text', { x: M.left - 8, y: M.top + 2, 'text-anchor': 'end', class: 'axis-title' }, svg);
  lt.textContent = 'ML';

  wrap.appendChild(svg);
  return wrap;
}
