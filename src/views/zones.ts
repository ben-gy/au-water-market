// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { ViewCtx } from '../router.ts';
import type { Zone } from '../types.ts';
import { esc, isoDate, ml, num, pct, perML, zoneLabel } from '../format.ts';
import { glossaryHtml, glossaryIcon } from '../glossary.ts';
import { panel } from './svg.ts';
import { stateColor, STATE_ABBR } from '../colors.ts';
import { openZone } from '../zoneDrawer.ts';
import { prefs } from '../data.ts';

type SortKey = 'volume' | 'trades' | 'vwap' | 'net' | 'name';

export function renderZones({ root, data }: ViewCtx): void {
  const p = panel({
    title: `Every trading zone ${glossaryIcon('tradingzone')}`,
    subtitle: `All ${num(data.zones.length)} zones that have registered a trade since 2008, with their all-time volume, average price and ${glossaryHtml('netbalance', 'net balance')}. Click any row for that zone's full price history and its trading partners. This is the finest geography the source contains — there are no buyer or seller names anywhere in it.`,
  });

  let sort: SortKey = prefs.get('zones.sort', 'volume') as SortKey;
  let query = '';
  let state = prefs.get('zones.state', '');

  const controls = document.createElement('div');
  controls.className = 'controls';
  const search = document.createElement('input');
  search.type = 'search';
  search.placeholder = 'Search zones…';
  search.setAttribute('aria-label', 'Search trading zones');
  search.style.minWidth = '220px';
  const stateSel = document.createElement('select');
  stateSel.setAttribute('aria-label', 'Filter by state');
  const states = [...new Set(data.zones.map((z) => z.state).filter((s): s is string => !!s))].sort();
  stateSel.innerHTML = `<option value="">All states</option>${states.map((s) => `<option value="${esc(s)}"${s === state ? ' selected' : ''}>${esc(s)}</option>`).join('')}`;
  const l1 = document.createElement('label'); l1.append(search);
  const l2 = document.createElement('label'); l2.append('State', stateSel);
  controls.append(l1, l2);
  p.body.appendChild(controls);

  const host = document.createElement('div');
  host.className = 'table-wrap';
  p.body.appendChild(host);

  const draw = () => {
    const q = query.trim().toLowerCase();
    let rows = data.zones.filter((z) =>
      (!state || z.state === state)
      && (!q || z.name.toLowerCase().includes(q) || (z.system ?? '').toLowerCase().includes(q)));
    rows = [...rows].sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'vwap') return (b.vwap ?? -1) - (a.vwap ?? -1);
      return (b[sort] as number) - (a[sort] as number);
    });
    const shown = rows.slice(0, 200);
    if (!shown.length) {
      host.innerHTML = '<div class="empty">No trading zone matches that search.</div>';
      return;
    }
    const th = (k: SortKey, label: string, cls = '') =>
      `<th class="sortable ${cls}" data-sort="${k}">${label}${sort === k ? '<span class="arrow">▼</span>' : ''}</th>`;
    host.innerHTML = `<table><thead><tr>
      ${th('name', 'Trading zone')}
      <th>State</th>
      ${th('volume', 'Volume traded', 'num')}
      ${th('trades', 'Trades', 'num')}
      ${th('vwap', 'Average price', 'num')}
      ${th('net', 'Net balance', 'num')}
      <th class="num">Priced</th>
      <th class="num">Last trade</th>
    </tr></thead><tbody>${shown.map((z) => `<tr class="clickable" data-slug="${esc(z.slug)}">
      <td><span class="zone-link">${esc(zoneLabel(z.name, z.state))}</span></td>
      <td><span class="pill" style="background:${esc(stateColor(z.state))}">${esc(STATE_ABBR[z.state ?? ''] ?? z.state ?? '—')}</span></td>
      <td class="num">${esc(ml(z.volume))}</td>
      <td class="num">${num(z.trades)}</td>
      <td class="num">${esc(perML(z.vwap))}</td>
      <td class="num">${z.net >= 0 ? '+' : ''}${esc(ml(z.net))}</td>
      <td class="num">${esc(pct(z.pricedShare, 0))}</td>
      <td class="num">${esc(isoDate(z.last))}</td>
    </tr>`).join('')}</tbody></table>
    ${rows.length > shown.length ? `<p class="note">Showing the ${shown.length} largest of ${num(rows.length)} matching zones — narrow the search to see more.</p>` : ''}`;
  };

  host.addEventListener('click', (e) => {
    const th = (e.target as Element).closest<HTMLElement>('th.sortable');
    if (th?.dataset.sort) {
      sort = th.dataset.sort as SortKey;
      prefs.set('zones.sort', sort);
      draw();
      return;
    }
    const tr = (e.target as Element).closest<HTMLElement>('tr.clickable');
    if (tr?.dataset.slug) openZone(data, tr.dataset.slug);
  });

  let t: ReturnType<typeof setTimeout> | null = null;
  search.addEventListener('input', () => {
    if (t) clearTimeout(t);
    t = setTimeout(() => { query = search.value; draw(); }, 300);
  });
  stateSel.addEventListener('change', () => { state = stateSel.value; prefs.set('zones.state', state); draw(); });

  draw();
  root.appendChild(p.section);

  // Leaderboards — the same data cut three ways, because "biggest" means three
  // different things to three different readers.
  const boards = panel({
    title: 'Leaderboards',
    subtitle: 'The biggest markets, the dearest water, and the regions that buy most from elsewhere.',
  });
  const grid = document.createElement('div');
  grid.className = 'insights';
  grid.append(
    board(data, 'Most traded', (z) => z.volume, (z) => ml(z.volume), (z) => z.volume > 0),
    board(data, 'Dearest water', (z) => z.vwap ?? 0, (z) => perML(z.vwap), (z) => z.tradesPriced >= 300),
    board(data, 'Biggest net buyers', (z) => z.net, (z) => `+${ml(z.net)}`, (z) => z.net > 0),
  );
  boards.body.appendChild(grid);
  root.appendChild(boards.section);
}

function board(
  data: ViewCtx['data'],
  title: string,
  key: (z: Zone) => number,
  fmt: (z: Zone) => string,
  filter: (z: Zone) => boolean,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'insight info';
  const rows = data.zones.filter(filter).sort((a, b) => key(b) - key(a)).slice(0, 8);
  card.innerHTML = `<h3>${esc(title)}</h3><ol class="board">${rows.map((z) => `
    <li><button type="button" class="zone-link" data-slug="${esc(z.slug)}">${esc(zoneLabel(z.name, z.state))}</button><span>${esc(fmt(z))}</span></li>`).join('')}</ol>`;
  card.addEventListener('click', (e) => {
    const s = (e.target as Element).closest<HTMLElement>('.zone-link')?.dataset.slug;
    if (s) openZone(data, s);
  });
  return card;
}
