// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Net importer / exporter, drawn on real ABS state boundaries.
//
// WHY STATE LEVEL. The obvious choice would be the MDBA Water Resource Plan
// Area polygons, and they were fetched and tested — 19 real CC BY 4.0 features.
// But zero of the 482,376 trade rows join to them: the trade files carry zone
// strings like "New South Wales Murray Regulated River Water Source / that part
// of the water source downstream of the River Murray at Picnic Point", and the
// polygons are named "Barwon-Darling Watercourse". Building a 344-row crosswalk
// by hand would be inventing a join, and inventing a join is how a map ends up
// confidently wrong. `origin_state` is a clean eight-value field that joins
// exactly, so the map is drawn there and the finer geography lives in the zone
// table instead.

import L from 'leaflet';
import type { ViewCtx } from '../router.ts';
import { esc, ml } from '../format.ts';
import { glossaryIcon } from '../glossary.ts';
import { legend, panel } from './svg.ts';
import { netRamp, STATE_ABBR } from '../colors.ts';
import { prefs } from '../data.ts';

interface StateFeatureProps { code?: string; name?: string }

export async function renderMap({ root, data }: ViewCtx): Promise<void> {
  const years = Object.keys(data.stateNet.byYear).map(Number).sort((a, b) => b - a);
  const complete = new Set(data.prices.allocationYearly.filter((y) => y.complete).map((y) => y.wy));
  const initial = Number(prefs.get('map.year', String(years.find((y) => complete.has(y)) ?? years[0])));
  let year = years.includes(initial) ? initial : years[0];

  const p = panel({
    title: `Which states send water, and which receive it ${glossaryIcon('netbalance')}`,
    subtitle: 'Megalitres transferred <em>in</em> minus megalitres transferred <em>out</em>, counting only trades that crossed a state border. Because every record carries both an origin and a destination, the balance is exact rather than modelled. Blue states receive more water than they send; ochre states send more than they receive. This counts <em>water movement</em>, not purchases — roughly four in ten transfers carry no price at all, and a carryover or environmental reallocation moves water just as a sale does.',
    legend: legend([
      { color: netRamp(0.9), label: 'Net receiver — more water in than out' },
      { color: netRamp(0), label: 'Balanced' },
      { color: netRamp(-0.9), label: 'Net sender — more water out than in' },
    ]),
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

  // isolation:isolate lives on .map-frame in CSS: without it Leaflet's panes
  // (z-index up to 1000) escape and paint over modals and drawers.
  const frame = document.createElement('div');
  frame.className = 'map-frame';
  const el = document.createElement('div');
  el.className = 'map-el';
  frame.appendChild(el);
  p.body.appendChild(frame);

  const tableHost = document.createElement('div');
  tableHost.className = 'table-wrap';
  p.body.appendChild(tableHost);
  root.appendChild(p.section);

  let geo: GeoJSON.FeatureCollection;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL ?? '/'}data/au-states.geojson`.replace(/\/{2,}/g, '/'));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    geo = await res.json();
  } catch (err) {
    el.replaceWith(Object.assign(document.createElement('div'), {
      className: 'error-box',
      textContent: `Could not load state boundaries: ${(err as Error).message}`,
    }));
    renderTable();
    return;
  }

  const map = L.map(el, { scrollWheelZoom: true, attributionControl: true }).setView([-28.5, 134], 4);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a> · Boundaries: ABS ASGS (CC BY 4.0)',
    maxZoom: 10,
  }).addTo(map);

  let layer: L.GeoJSON | null = null;

  const draw = () => {
    const rows = data.stateNet.byYear[String(year)] ?? [];
    const byState = new Map(rows.map((r) => [r.state, r]));
    const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.net)));

    layer?.remove();
    layer = L.geoJSON(geo, {
      style: (f) => {
        const name = (f?.properties as StateFeatureProps)?.name ?? '';
        const r = byState.get(name);
        return {
          fillColor: r ? netRamp(r.net / maxAbs) : '#f0f3f5',
          weight: 1, color: '#ffffff', fillOpacity: 0.92,
        };
      },
      onEachFeature: (f, lyr) => {
        const name = (f.properties as StateFeatureProps)?.name ?? '';
        const r = byState.get(name);
        // Every polygon gets a tooltip, including the ones with no trades —
        // silence on hover reads as a broken map, not as "no data".
        lyr.bindTooltip(
          r
            ? `<strong>${esc(name)}</strong><br>Net ${r.net >= 0 ? '+' : ''}${esc(ml(r.net))}<br>In ${esc(ml(r.in))} · Out ${esc(ml(r.out))}`
            : `<strong>${esc(name)}</strong><br>No cross-border trades this year`,
          { sticky: true },
        );
        lyr.on('mouseover', () => (lyr as L.Path).setStyle({ weight: 2.5, color: '#10222c' }));
        lyr.on('mouseout', () => (lyr as L.Path).setStyle({ weight: 1, color: '#ffffff' }));
      },
    }).addTo(map);
    renderTable();
  };

  function renderTable(): void {
    const rows = data.stateNet.byYear[String(year)] ?? [];
    if (!rows.length) {
      tableHost.innerHTML = '<div class="empty">No cross-border trades in this water year.</div>';
      return;
    }
    tableHost.innerHTML = `<table><thead><tr>
      <th>State</th><th class="num">Received</th><th class="num">Sent</th><th class="num">Net balance</th>
    </tr></thead><tbody>${rows.map((r) => `<tr>
      <td><span class="pill" style="background:${esc(netRamp(r.net / Math.max(1, Math.max(...rows.map((q) => Math.abs(q.net))))))};color:#10222c">${esc(STATE_ABBR[r.state] ?? r.state)}</span> ${esc(r.state)}</td>
      <td class="num">${esc(ml(r.in))}</td>
      <td class="num">${esc(ml(r.out))}</td>
      <td class="num"><strong>${r.net >= 0 ? '+' : ''}${esc(ml(r.net))}</strong></td>
    </tr>`).join('')}</tbody></table>`;
  }

  sel.addEventListener('change', () => {
    year = Number(sel.value);
    prefs.set('map.year', String(year));
    draw();
  });
  draw();

  const note = document.createElement('p');
  note.className = 'note';
  note.innerHTML = `Only trades that crossed a <strong>state border</strong> count here — the great majority of trading happens within a single state and nets to zero at this scale. ${esc(data.meta.notes.wrpaJoin)}`;
  p.body.appendChild(note);

  // Leaflet measures its container on creation; if the panel was still laying
  // out, that measurement is zero and the map renders as a grey box.
  requestAnimationFrame(() => map.invalidateSize());
  setTimeout(() => map.invalidateSize(), 250);
}
