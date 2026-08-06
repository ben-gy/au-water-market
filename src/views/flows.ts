// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Where the water actually goes. Every row in the source is an origin →
// destination pair with a volume, so a flow diagram is the data's native shape
// rather than a decoration bolted onto it.
//
// Intra-zone trades (origin === destination) are EXCLUDED here on purpose: they
// are the majority of volume but represent no movement between places, and a
// Sankey whose largest ribbon is a self-loop teaches the reader nothing.

import type { ViewCtx } from '../router.ts';
import { esc, ml, num, pct, zoneLabel } from '../format.ts';
import { glossaryHtml } from '../glossary.ts';
import { legend, makeSvg, panel, ribbon, svgEl } from './svg.ts';
import { stateColor, STATE_ABBR } from '../colors.ts';
import { openZone } from '../zoneDrawer.ts';
import { prefs } from '../data.ts';

export function renderFlows({ root, data }: ViewCtx): void {
  const years = Object.keys(data.flows.byYear).map(Number).sort((a, b) => b - a);
  const complete = new Set(data.prices.allocationYearly.filter((y) => y.complete).map((y) => y.wy));
  const initial = Number(prefs.get('flows.year', String(years.find((y) => complete.has(y)) ?? years[0])));
  let year = years.includes(initial) ? initial : years[0];

  const p = panel({
    title: 'Which way the water moves',
    subtitle: `Every trade between two different ${glossaryHtml('tradingzone', 'trading zones')} in the selected ${glossaryHtml('wateryear', 'water year')}, sized by megalitres. Sellers on the left, buyers on the right. Trades within a single zone are excluded — they are most of the market by volume, but no water changes place.`,
    wide: true,
  });

  const controls = document.createElement('div');
  controls.className = 'controls';
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Water year');
  sel.innerHTML = years.map((y) => `<option value="${y}"${y === year ? ' selected' : ''}>${y}-${String((y + 1) % 100).padStart(2, '0')}${complete.has(y) ? '' : ' (under way)'}</option>`).join('');
  const lab = document.createElement('label');
  lab.append('Water year', sel);
  controls.appendChild(lab);
  p.section.querySelector('.panel-head')!.appendChild(controls);

  const host = document.createElement('div');
  p.body.appendChild(host);

  const coverageNote = document.createElement('p');
  coverageNote.className = 'note';
  p.body.appendChild(coverageNote);

  // The route table is created up front so the year handler can redraw both it
  // and the diagram from one place — an earlier version left the table wired to
  // a custom event that nothing ever dispatched, so it silently kept showing
  // the first year selected no matter what the reader picked.
  const tablePanel = panel({ title: 'The largest routes', subtitle: 'The same trades, as numbers. Click either end to open that zone.' });
  const tableHost = document.createElement('div');
  tableHost.className = 'table-wrap';
  tableHost.addEventListener('click', (e) => {
    const s = (e.target as Element).closest<HTMLElement>('.zone-link')?.dataset.slug;
    if (s) openZone(data, s);
  });
  tablePanel.body.appendChild(tableHost);

  let drawnStats = { ribbons: 0, left: 0, right: 0, ml: 0 };
  const draw = () => {
    host.innerHTML = '';
    const { el, stats } = sankey(data, year);
    drawnStats = stats;
    host.appendChild(el);
    renderRouteTable(tableHost, data, year);
    const c = data.flows.coverage[String(year)];
    if (c) {
      // Never let a cap masquerade as completeness.
      // Two caps apply, and the caption must describe the one the reader can
      // see: the pipeline keeps the 120 largest routes, and the diagram then
      // draws only those whose BOTH ends are among the 14 biggest sellers and
      // 14 biggest buyers. Quoting only the first overstates the picture.
      const drawn = drawnStats;
      coverageNote.innerHTML = `The diagram draws ${num(drawn.ribbons)} routes between the ${num(drawn.left)} largest sellers and ${num(drawn.right)} largest buyers — <strong>${pct(drawn.ml / c.ml, 1)}</strong> of the ${ml(c.ml)} that moved between zones this year, across ${num(c.pairs)} routes in total. The table below lists the largest by volume; the rest is a long tail.`;
    }
  };
  sel.addEventListener('change', () => {
    year = Number(sel.value);
    prefs.set('flows.year', String(year));
    draw();
  });
  draw();

  p.section.querySelector('.panel-head')!.appendChild(legend(
    [...new Set(data.zones.map((z) => z.state).filter((s): s is string => !!s))]
      .sort()
      .map((s) => ({ color: stateColor(s), label: STATE_ABBR[s] ?? s })),
  ));
  root.appendChild(p.section);
  // A Sankey is bad at exact values, so the same trades appear as numbers too.
  root.appendChild(tablePanel.section);
}

function sankey(data: ViewCtx['data'], year: number): { el: HTMLElement; stats: { ribbons: number; left: number; right: number; ml: number } } {
  const pairs = data.flows.byYear[String(year)] ?? [];
  const names = data.flows.zones;
  const zoneByName = new Map(data.zones.map((z) => [z.name, z]));

  if (!pairs.length) {
    const e = document.createElement('div');
    e.className = 'empty';
    e.textContent = 'No inter-zone trades were registered in this water year.';
    return { el: e, stats: { ribbons: 0, left: 0, right: 0, ml: 0 } };
  }

  // Node totals per side
  const outMl = new Map<number, number>();
  const inMl = new Map<number, number>();
  for (const [o, d, m] of pairs) {
    outMl.set(o, (outMl.get(o) ?? 0) + m);
    inMl.set(d, (inMl.get(d) ?? 0) + m);
  }
  const LEFT_N = 14, RIGHT_N = 14;
  const left = [...outMl.entries()].sort((a, b) => b[1] - a[1]).slice(0, LEFT_N);
  const right = [...inMl.entries()].sort((a, b) => b[1] - a[1]).slice(0, RIGHT_N);
  const leftSet = new Map(left.map(([i], k) => [i, k]));
  const rightSet = new Map(right.map(([i], k) => [i, k]));
  const shown = pairs.filter(([o, d]) => leftSet.has(o) && rightSet.has(d));

  const W = 1080;
  const GAP = 10;
  const rowH = 26;
  const H = Math.max(360, Math.max(left.length, right.length) * (rowH + GAP) + 60);
  const M = { top: 34, bottom: 20 };
  const colW = 15;
  const xL = 300, xR = W - 300;

  const totalLeft = left.reduce((a, [, v]) => a + v, 0);
  const totalRight = right.reduce((a, [, v]) => a + v, 0);
  const availH = H - M.top - M.bottom - GAP * (Math.max(left.length, right.length) - 1);
  const scaleL = availH / Math.max(1, totalLeft);
  const scaleR = availH / Math.max(1, totalRight);

  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', `Water flows between trading zones in ${year}`);
  svg.style.minWidth = '900px';

  const posL = new Map<number, { y: number; h: number; cursor: number }>();
  let cy = M.top;
  for (const [idx, v] of left) {
    const h = Math.max(3, v * scaleL);
    posL.set(idx, { y: cy, h, cursor: cy });
    cy += h + GAP;
  }
  const posR = new Map<number, { y: number; h: number; cursor: number }>();
  cy = M.top;
  for (const [idx, v] of right) {
    const h = Math.max(3, v * scaleR);
    posR.set(idx, { y: cy, h, cursor: cy });
    cy += h + GAP;
  }

  const head1 = svgEl('text', { x: xL, y: 20, 'text-anchor': 'end', class: 'axis-title' }, svg);
  head1.textContent = 'SOLD FROM';
  const head2 = svgEl('text', { x: xR, y: 20, 'text-anchor': 'start', class: 'axis-title' }, svg);
  head2.textContent = 'BOUGHT BY';

  // ribbons, largest first so small ones stay clickable on top
  const ribbons = svgEl('g', {}, svg);
  for (const [o, d, m, trades] of [...shown].sort((a, b) => b[2] - a[2])) {
    const L = posL.get(o)!, R = posR.get(d)!;
    const h0 = Math.max(1.2, m * scaleL), h1 = Math.max(1.2, m * scaleR);
    const y0 = L.cursor + h0 / 2, y1 = R.cursor + h1 / 2;
    L.cursor += h0; R.cursor += h1;
    const zo = zoneByName.get(names[o]);
    const path = svgEl('path', {
      d: ribbon(xL + colW, y0, xR - colW, y1, h0, h1),
      fill: stateColor(zo?.state ?? null), opacity: 0.32, class: 'mark',
    }, ribbons);
    path.setAttribute('data-tip', `${zoneLabel(names[o])}\n  ↓ ${ml(m)} across ${num(trades)} trades\n${zoneLabel(names[d])}`);
    path.setAttribute('aria-label', `${ml(m)} from ${zoneLabel(names[o])} to ${zoneLabel(names[d])}`);
    path.addEventListener('mouseenter', () => path.setAttribute('opacity', '0.62'));
    path.addEventListener('mouseleave', () => path.setAttribute('opacity', '0.32'));
  }

  const node = (idx: number, x: number, p: { y: number; h: number }, side: 'l' | 'r', total: number) => {
    const z = zoneByName.get(names[idx]);
    const g = svgEl('g', { class: 'mark clickable' }, svg);
    svgEl('rect', { x: side === 'l' ? x : x - colW, y: p.y, width: colW, height: p.h, fill: stateColor(z?.state ?? null), rx: 2 }, g);
    const t = svgEl('text', {
      x: side === 'l' ? x - 8 : x + 8, y: p.y + p.h / 2 + 4,
      'text-anchor': side === 'l' ? 'end' : 'start', class: 'axis',
    }, g);
    const nm = zoneLabel(names[idx], z?.state);
    t.textContent = nm.length > 40 ? `${nm.slice(0, 38)}…` : nm;
    g.setAttribute('data-tip', `${nm}\n${side === 'l' ? 'Sold' : 'Bought'} ${ml(total)} this year`);
    g.setAttribute('aria-label', nm);
    if (z) {
      g.style.cursor = 'pointer';
      g.addEventListener('click', () => openZone(data, z.slug));
    }
  };
  for (const [idx, v] of left) node(idx, xL, posL.get(idx)!, 'l', v);
  for (const [idx, v] of right) node(idx, xR, posR.get(idx)!, 'r', v);

  const wrap = document.createElement('div');
  wrap.className = 'chart';
  wrap.appendChild(svg);
  return {
    el: wrap,
    stats: { ribbons: shown.length, left: left.length, right: right.length, ml: shown.reduce((a, r) => a + r[2], 0) },
  };
}

function renderRouteTable(wrap: HTMLElement, data: ViewCtx['data'], year: number): void {
  const pairs = (data.flows.byYear[String(year)] ?? []).slice(0, 25);
  const names = data.flows.zones;
  const bySlug = new Map(data.zones.map((z) => [z.name, z.slug]));
  if (!pairs.length) {
    wrap.innerHTML = '<div class="empty">No inter-zone trades in this water year.</div>';
    return;
  }
  wrap.innerHTML = `<table><thead><tr>
    <th>From</th><th>To</th><th class="num">Volume</th><th class="num">Trades</th>
  </tr></thead><tbody>${pairs.map(([o, d, m, t]) => `<tr>
    <td><span class="zone-link" data-slug="${esc(bySlug.get(names[o]) ?? '')}">${esc(zoneLabel(names[o]))}</span></td>
    <td><span class="zone-link" data-slug="${esc(bySlug.get(names[d]) ?? '')}">${esc(zoneLabel(names[d]))}</span></td>
    <td class="num">${esc(ml(m))}</td><td class="num">${num(t)}</td>
  </tr>`).join('')}</tbody></table>`;
}
