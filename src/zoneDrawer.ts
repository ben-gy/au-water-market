// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// The drill-down. Every zone name anywhere on the site opens this, and the hash
// carries the slug so a zone is a linkable address.

import { closeButton, openOverlay } from './overlay.ts';
import { esc, isoDate, ml, monthLabel, monthShort, num, pct, perML, zoneLabel } from './format.ts';
import { linePath, logScale, makeSvg, scale, svgEl } from './views/svg.ts';
import { stateColor, STATE_ABBR, MARKET } from './colors.ts';
import type { Bundle, Zone } from './types.ts';

let openSlug: string | null = null;

export function openZone(data: Bundle, slug: string): void {
  const zone = data.zones.find((z) => z.slug === slug);
  if (!zone) return;
  if (openSlug === slug && document.querySelector('.drawer')) return;
  openSlug = slug;

  // Make the zone addressable without re-running the whole route (which would
  // tear the drawer down again the moment it opened).
  const p = new URLSearchParams(location.hash.replace(/^#/, ''));
  p.set('zone', slug);
  p.set('keepScroll', '1');
  history.replaceState(null, '', `#${p.toString()}`);

  openOverlay({
    panelClass: 'drawer',
    label: `${zone.name} — trading zone detail`,
    lockScroll: true,
    build: (panel, close) => {
      const head = document.createElement('div');
      head.className = 'drawer-head';
      head.innerHTML = `<h2>${esc(zoneLabel(zone.name, zone.state))}
        <span class="sub" style="display:block">${esc(zone.system ?? 'Water system not recorded')}${zone.state ? ` · ${esc(zone.state)}` : ''}${zone.mdb && zone.mdb !== 'NA' ? ` · ${esc(zone.mdb)}` : ''}</span></h2>`;
      head.appendChild(closeButton(close, `Close ${zone.name}`));

      const body = document.createElement('div');
      body.className = 'drawer-body';

      const kv = document.createElement('dl');
      kv.className = 'kv';
      kv.innerHTML = [
        ['Volume traded, all time', ml(zone.volume)],
        ['Average price', perML(zone.vwap)],
        ['Trades', `${num(zone.trades)} (${num(zone.tradesPriced)} priced)`],
        ['Sold to other zones', ml(zone.exported)],
        ['Bought from other zones', ml(zone.imported)],
        ['Traded within the zone', ml(zone.intra)],
        ['Net balance', `${zone.net >= 0 ? '+' : ''}${ml(zone.net)}`],
        ['Share of trades with a price', pct(zone.pricedShare, 0)],
        ['First trade', isoDate(zone.first)],
        ['Latest trade', isoDate(zone.last)],
      ].map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
      body.appendChild(kv);

      if (zone.monthly.length >= 3) {
        const h = document.createElement('h3');
        h.style.cssText = 'font-size:.88rem;margin:6px 0 6px';
        h.textContent = 'Price history';
        body.append(h, priceSpark(zone));
      } else {
        const e = document.createElement('p');
        e.className = 'note';
        e.textContent = 'Too few priced months in this zone to draw a price history.';
        body.appendChild(e);
      }

      if (zone.partners.length) {
        const h = document.createElement('h3');
        h.style.cssText = 'font-size:.88rem;margin:16px 0 6px';
        h.textContent = 'Where its water goes';
        const list = document.createElement('div');
        list.className = 'bars';
        const max = Math.max(...zone.partners.map(([, v]) => v));
        list.innerHTML = zone.partners.map(([idx, v]) => {
          const name = data.flows.zones[idx] ?? 'Unknown';
          const target = data.zones.find((z) => z.name === name);
          return `<button class="barrow" type="button" data-slug="${esc(target?.slug ?? '')}">
            <span class="barlabel">${esc(zoneLabel(name, target?.state))}</span>
            <span class="bartrack"><span class="barfill" style="width:${Math.max(2, (v / max) * 100)}%"></span></span>
            <span class="barval">${esc(ml(v))}</span></button>`;
        }).join('');
        list.addEventListener('click', (e) => {
          const s = (e.target as Element).closest<HTMLElement>('.barrow')?.dataset.slug;
          if (s && s !== zone.slug) { close(); openZone(data, s); }
        });
        body.append(h, list);
      } else {
        const e = document.createElement('p');
        e.className = 'note';
        e.textContent = 'This zone has no recorded trades out to other zones — all of its trading happens internally.';
        body.appendChild(e);
      }

      const foot = document.createElement('p');
      foot.className = 'note';
      foot.innerHTML = `<span class="pill" style="background:${esc(stateColor(zone.state))}">${esc(STATE_ABBR[zone.state ?? ''] ?? zone.state ?? '—')}</span>
        Prices are volume-weighted and exclude zero-consideration transfers. The source names no buyers or sellers.`;
      body.appendChild(foot);

      panel.append(head, body);
    },
    onClose: () => {
      openSlug = null;
      const q = new URLSearchParams(location.hash.replace(/^#/, ''));
      q.delete('zone');
      q.delete('keepScroll');
      history.replaceState(null, '', `#${q.toString()}`);
    },
  });
}

function priceSpark(zone: Zone): HTMLElement {
  const W = 500, H = 190;
  const M = { top: 12, right: 12, bottom: 26, left: 46 };
  const rows = zone.monthly.filter(([, v]) => v != null) as [string, number, number][];
  const x = scale(0, Math.max(1, rows.length - 1), M.left, W - M.right);
  const vals = rows.map(([, v]) => v);
  const lo = Math.min(...vals), hi = Math.max(...vals);
  const y = hi / Math.max(lo, 0.01) > 25
    ? logScale(lo * 0.85, hi * 1.15, H - M.bottom, M.top)
    : scale(0, hi * 1.15, H - M.bottom, M.top);

  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', `Price history for ${zone.name}`);
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) * i) / 3;
    svgEl('line', { x1: M.left, x2: W - M.right, y1: y(v), y2: y(v), stroke: 'var(--border-subtle)' }, svg);
    const t = svgEl('text', { x: M.left - 6, y: y(v) + 3.5, 'text-anchor': 'end', class: 'axis' }, svg);
    t.textContent = `$${Math.round(v)}`;
  }
  svgEl('path', {
    d: linePath(rows.map(([, v], i) => ({ x: x(i), y: y(v) }))),
    fill: 'none', stroke: MARKET.allocation, 'stroke-width': 2, 'stroke-linejoin': 'round',
  }, svg);
  const bw = Math.max(2, (W - M.left - M.right) / Math.max(1, rows.length));
  rows.forEach(([m, v, vol], i) => {
    const hit = svgEl('rect', { x: x(i) - bw / 2, y: M.top, width: bw, height: H - M.top - M.bottom, fill: 'transparent', class: 'mark' }, svg);
    hit.setAttribute('data-tip', `${monthLabel(m)}\n${perML(v)}\n${ml(vol)} traded`);
  });
  const ax = svgEl('g', { class: 'axis' }, svg);
  for (let i = 0; i < rows.length; i += Math.max(1, Math.round(rows.length / 5))) {
    const t = svgEl('text', { x: x(i), y: H - M.bottom + 14, 'text-anchor': 'middle' }, ax);
    t.textContent = monthShort(rows[i][0]);
  }
  wrap.appendChild(svg);
  return wrap;
}
