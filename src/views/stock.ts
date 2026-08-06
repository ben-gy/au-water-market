// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { ViewCtx } from '../router.ts';
import { auDate, esc, ml, num, pct } from '../format.ts';
import { glossaryHtml, glossaryIcon } from '../glossary.ts';
import { legend, makeSvg, panel, scale, svgEl } from './svg.ts';
import { squarify } from '../utils/squarify.ts';
import { RESOURCE, stateColor, STATE_ABBR } from '../colors.ts';

export function renderStock({ root, data }: ViewCtx): void {
  const s = data.stock;

  const stats = document.createElement('div');
  stats.className = 'stats';
  const top = s.byState[0];
  const mostLiquid = [...s.churn]
    .filter((c) => c.stock > 100_000 && c.reported && c.rate != null)
    .sort((a, b) => (b.rate as number) - (a.rate as number))[0];
  stats.innerHTML = [
    [glossaryHtml('onissue', 'Total on issue'), ml(s.total), `at ${auDate(s.date)}`],
    ['Largest holder', `${esc(STATE_ABBR[top.state] ?? top.state)} ${ml(top.ml)}`, `${pct(top.ml / s.total, 0)} of the national stock`],
    ['Separate entitlements', num(s.byState.reduce((a, x) => a + x.count, 0)), 'individual rights on the register'],
    [glossaryHtml('churn', 'Most traded'), `${esc(STATE_ABBR[mostLiquid?.state] ?? mostLiquid?.state ?? '—')} ${pct(mostLiquid?.rate ?? 0, 1)}`, `of its stock changed hands in ${esc(s.churnYear)}`],
  ].map(([k, v, d]) => `<div class="stat"><div class="k">${k}</div><div class="v">${esc(v)}</div><div class="d">${d}</div></div>`).join('');
  root.appendChild(stats);

  const p = panel({
    title: 'Every water right in Australia',
    subtitle: `The ${ml(s.total)} of permanent ${glossaryHtml('entitlement', 'entitlements')} on issue at ${auDate(s.date)}, grouped by state and then by whether the water comes from a river or from underground. Area is megalitres. This is the pool the permanent market trades pieces of — it is <em>not</em> water sitting in a dam, and it is not what will actually be delivered this year.`,
    legend: legend(Object.entries(RESOURCE).map(([k, v]) => ({ color: v, label: k }))),
  });
  p.body.appendChild(treemap(data));
  root.appendChild(p.section);

  const p2 = panel({
    title: `How much of it actually trades ${glossaryIcon('churn')}`,
    subtitle: `Holding a great deal of water is not the same as trading it. This is the share of each state's entitlement stock that changed hands in ${esc(s.churnYear)} — the liquidity of the permanent market, normalised so a small state and a large one can be compared.`,
  });
  p2.body.appendChild(churnChart(data));
  root.appendChild(p2.section);

  const p3 = panel({ title: 'By state and reliability', subtitle: 'The same stock, as numbers.' });
  p3.body.appendChild(stockTable(data));
  root.appendChild(p3.section);
}

function treemap(data: ViewCtx['data']): HTMLElement {
  const W = 980, H = 460;
  const s = data.stock;
  const wrap = document.createElement('div');
  wrap.className = 'chart';
  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', 'Treemap of entitlements on issue by state and resource type');

  // Outer level: states, using the canonical squarified layout.
  const states = s.byState.filter((x) => x.ml > 0);
  const outer = squarify(states.map((x) => x.ml), W, H);

  states.forEach((st, i) => {
    const r = outer[i];
    if (!(r.w > 0.5 && r.h > 0.5)) return;
    const g = svgEl('g', {}, svg);
    svgEl('rect', { x: r.x, y: r.y, width: r.w, height: r.h, fill: stateColor(st.state), opacity: 0.15 }, g);

    // Inner level: resource type within the state, laid out inside the parent
    // rect with the parent's origin applied — the step a hand-rolled treemap
    // usually gets wrong, stacking every child at (0,0).
    const inner = s.detail.filter((d) => d.state === st.state);
    const byRes = new Map<string, number>();
    for (const d of inner) byRes.set(d.resource, (byRes.get(d.resource) ?? 0) + d.ml);
    const kids = [...byRes.entries()].sort((a, b) => b[1] - a[1]);
    const pad = Math.min(3, r.w / 8, r.h / 8);
    const ir = squarify(kids.map(([, v]) => v), Math.max(0, r.w - pad * 2), Math.max(0, r.h - pad * 2));
    kids.forEach(([res, v], k) => {
      const c = ir[k];
      if (!(c.w > 0.5 && c.h > 0.5)) return;
      const rect = svgEl('rect', {
        x: r.x + pad + c.x, y: r.y + pad + c.y, width: c.w, height: c.h,
        fill: RESOURCE[res] ?? '#8b93a0', opacity: 0.88, rx: 2, class: 'mark',
      }, g);
      rect.setAttribute('data-tip', `${st.state}\n${res}\n${ml(v)}\n${pct(v / s.total, 1)} of the national stock`);
      rect.setAttribute('aria-label', `${st.state} ${res} ${ml(v)}`);
    });

    if (r.w > 74 && r.h > 34) {
      // Classes, not inline font-size attributes: an attribute cannot be
      // overridden by the mobile media query, and these were rendering at
      // 6.6 CSS px on a phone.
      const t1 = svgEl('text', { x: r.x + 8, y: r.y + 18, fill: '#10222c', class: 'tm-label', 'pointer-events': 'none' }, g);
      t1.textContent = STATE_ABBR[st.state] ?? st.state;
      const t2 = svgEl('text', { x: r.x + 8, y: r.y + 33, fill: '#10222c', class: 'tm-sub', 'pointer-events': 'none', opacity: 0.8 }, g);
      t2.textContent = ml(st.ml);
    }
  });

  wrap.appendChild(svg);
  return wrap;
}

function churnChart(data: ViewCtx['data']): HTMLElement {
  // Only states that actually filed. A state that stopped reporting divides to
  // 0.00% and would otherwise sit at the bottom of a "liquidity" chart looking
  // like a market where nothing moves.
  const rows = [...data.stock.churn]
    .filter((c) => c.stock > 0 && c.reported && c.rate != null)
    .sort((a, b) => (b.rate as number) - (a.rate as number));
  const missing = data.stock.churn.filter((c) => c.stock > 0 && !c.reported);

  const wrap = document.createElement('div');
  wrap.className = 'chart';
  if (!rows.length) {
    wrap.innerHTML = '<div class="empty">No state reported enough entitlement trades this year to measure turnover.</div>';
    return wrap;
  }
  const W = 980, rowH = 34, H = rows.length * rowH + 44;
  const M = { left: 190, right: 92, top: 24 };
  const max = Math.max(...rows.map((r) => r.rate as number)) * 1.12;
  const x = scale(0, max, M.left, W - M.right);

  const svg = makeSvg(W, H);
  svg.setAttribute('aria-label', 'Share of entitlement stock traded, by state');

  for (let i = 0; i <= 4; i++) {
    const v = (max * i) / 4;
    svgEl('line', { x1: x(v), x2: x(v), y1: M.top - 8, y2: H - 14, stroke: 'var(--border-subtle)' }, svg);
    const t = svgEl('text', { x: x(v), y: M.top - 12, 'text-anchor': 'middle', class: 'axis' }, svg);
    t.textContent = `${(v * 100).toFixed(1)}%`;
  }

  rows.forEach((r, i) => {
    const rate = r.rate as number;
    const y = M.top + i * rowH;
    const lbl = svgEl('text', { x: M.left - 10, y: y + 18, 'text-anchor': 'end', class: 'axis' }, svg);
    lbl.textContent = r.state;
    const w = Math.max(2, x(rate) - M.left);
    const rect = svgEl('rect', { x: M.left, y: y + 5, width: w, height: rowH - 14, fill: stateColor(r.state), rx: 3, class: 'mark' }, svg);
    rect.setAttribute('data-tip', `${r.state}\n${pct(rate, 2)} of its entitlements traded in ${data.stock.churnYear}\n${ml(r.traded)} traded out of ${ml(r.stock)} on issue\n${num(r.trades)} trades reported`);
    rect.setAttribute('aria-label', `${r.state} ${pct(rate, 2)}`);
    const v = svgEl('text', { x: M.left + w + 8, y: y + 19, class: 'axis' }, svg);
    v.textContent = pct(rate, 2);
  });

  wrap.appendChild(svg);

  // Say plainly what is missing and why, rather than plotting a zero.
  if (missing.length) {
    const note = document.createElement('p');
    note.className = 'note';
    note.innerHTML = `<strong>Not shown:</strong> ${missing.map((m) => `${esc(m.state)} (${m.trades === 0 ? 'no entitlement trades reported at all' : `${num(m.trades)} trades against a recent norm of ${num(m.priorMedianTrades)}`})</span>`).join(', ')}.
      These states hold ${esc(ml(missing.reduce((a, m) => a + m.stock, 0)))} of entitlement between them, but they did not file enough records in ${esc(data.stock.churnYear)} to measure turnover. That is a gap in the reporting, not a market where nothing moved — so no rate is shown for them.`;
    wrap.appendChild(note);
  }
  return wrap;
}

function stockTable(data: ViewCtx['data']): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'table-wrap';
  const agg = new Map<string, number>();
  for (const d of data.stock.detail) agg.set(`${d.state}|${d.reliability}`, (agg.get(`${d.state}|${d.reliability}`) ?? 0) + d.ml);
  const rows = [...agg.entries()].map(([k, v]) => { const [state, rel] = k.split('|'); return { state, rel, ml: v }; })
    .sort((a, b) => b.ml - a.ml).slice(0, 40);
  wrap.innerHTML = `<table><thead><tr>
    <th>State</th><th>Reliability class</th><th class="num">On issue</th><th class="num">Share of national</th>
  </tr></thead><tbody>${rows.map((r) => `<tr>
    <td><span class="pill" style="background:${esc(stateColor(r.state))}">${esc(STATE_ABBR[r.state] ?? r.state)}</span></td>
    <td>${esc(r.rel)}</td>
    <td class="num">${esc(ml(r.ml))}</td>
    <td class="num">${esc(pct(r.ml / data.stock.total, 2))}</td>
  </tr>`).join('')}</tbody></table>
  <p class="note">Reliability labels are raw state-register terms and do not mean the same thing across borders — "Surety 5" in Queensland and "High" in Victoria are not comparable. Showing the 40 largest combinations.</p>`;
  return wrap;
}
