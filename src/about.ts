// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import { openOverlay, closeButton } from './overlay.ts';
import { auDate, isoDate, num } from './format.ts';
import type { Bundle } from './types.ts';

export function renderAbout(d: Bundle): void {
  const m = d.meta;
  openOverlay({
    panelClass: 'modal',
    label: 'About Water Market',
    lockScroll: true,
    build: (panel, close) => {
      const head = document.createElement('div');
      head.className = 'modal-head';
      head.innerHTML = '<h2>About this site<span class="sub" style="display:block">What the data is, where it comes from, and what it cannot tell you</span></h2>';
      head.appendChild(closeButton(close, 'Close about panel'));

      const body = document.createElement('div');
      body.className = 'modal-body';
      body.innerHTML = `
        <p>Australia has one of the world's largest markets in water rights. Every
        registered trade is reported to the Bureau of Meteorology by around 44 state
        agencies, and the Bureau publishes the lot. This site turns those files into
        something you can actually read.</p>

        <h3>The two markets</h3>
        <p><strong>Allocation</strong> trades sell water for the current season only —
        once it is used, it is gone. <strong>Entitlement</strong> trades sell the
        perpetual right to receive a share of water every year, for ever. They are
        different assets with different prices, and since 2019 they have moved in
        opposite directions.</p>

        <h3>Where the data comes from</h3>
        <ul>
          <li><strong>${num(m.allocation.rows)}</strong> allocation trades,
              ${isoDate(m.allocation.first)} – ${isoDate(m.allocation.last)}</li>
          <li><strong>${num(m.entitlements.rows)}</strong> entitlement trades,
              ${isoDate(m.entitlements.first)} – ${isoDate(m.entitlements.last)}</li>
          <li><strong>${num(m.onIssue.rows)}</strong> entitlement records on issue,
              national snapshot at ${auDate(m.onIssue.snapshot)}</li>
        </ul>
        <p>Source files are refreshed by the Bureau daily; this site rebuilds monthly.
        Data last collected ${isoDate(m.generated.slice(0, 10))}${m.sources.allocation?.lastModified
          ? `, and the source files were themselves last updated ${new Date(m.sources.allocation.lastModified).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}`
          : ''}.</p>

        <h3>How prices are calculated</h3>
        <p>Every price here is <strong>volume-weighted</strong>: total dollars divided
        by total megalitres, not the average of each trade's price. A simple average
        would let a one-megalitre novelty trade count as much as a ten-thousand-megalitre
        deal.</p>
        <p><strong>${(m.allocation.zeroPriceShare * 100).toFixed(1)}%</strong> of
        allocation trades carry no price at all. These are zero-consideration transfers —
        water moved between accounts of the same owner, carryover between seasons, or
        environmental reallocations. They are counted as <em>volume</em>, because the
        water genuinely moved, but excluded from every <em>price</em>. Including them
        would drag every headline price down by about <strong>70%</strong> — the
        all-time southern-Basin average falls from $149.87 to $45.54 a megalitre —
        while the chart still looked entirely plausible.</p>
        <p>A further <strong>${num(m.allocation.nominalPrice)}</strong> trades carry a
        token amount — very often exactly one dollar for an entire parcel — which is a
        legal formality rather than a market price. The Bureau's own per-megalitre column
        reads zero for those rows, and this site follows that judgement and excludes them
        from prices too.</p>

        <h3>What this data cannot tell you</h3>
        <ul>
          <li><strong>There are no buyers or sellers.</strong> The source contains no
          names, no ABNs, no ownership. Trading zone to trading zone is the finest
          resolution that exists, so nothing here can tell you who owns Australia's
          water — and this site makes no such claim.</li>
          <li><strong>The most recent weeks are incomplete.</strong> Agencies report in
          arrears, so the six weeks before ${isoDate(m.allocation.last)} hold only a
          fraction of the trades that will eventually appear. Those weeks are shaded on
          every monthly chart, and the season currently under way is excluded from every
          headline figure. They are not removed from the completed water year they fall
          inside — a handful of days of the 2025-26 season sit in that window — so the
          most recent completed year may shift slightly as late trades arrive.</li>
          <li><strong>Some states stopped reporting.</strong> Western Australia filed 329
          entitlement trades in 2024-25 and none at all in 2025-26; the Northern
          Territory's last was in 2013 and the ACT's in 2018. Where a state did not file
          enough records to measure, this site shows no turnover figure for it rather
          than a nought — a gap in the paperwork is not a market where nothing moved.</li>
          <li><strong>Reliability classes do not harmonise across borders.</strong>
          Terms like "Surety 5" and "Very High (Class 1, 2, 5, 6, 9 &amp; Licences)" are
          raw state-register strings. The headline price series is restricted to the
          southern Murray-Darling Basin, where High and Low mean roughly the same thing
          on both sides of a state line.</li>
          <li><strong>This is not water in a dam.</strong> Entitlements on issue are
          rights on a register, not storage. Nothing here reports how full anything is.</li>
          <li><strong>Leases are excluded from entitlement prices.</strong> The source
          mixes outright sales with limited-term leases of the same right. A three-year
          lease is a different product at a different price, so the
          ${num(m.entitlements.leases)} genuine leases are kept out of the permanent
          price series and out of the turnover figures. They are few but large, and
          pooling them had turned a 15% rise across the drought years into a 71% one.</li>
          <li><strong>${num(m.allocation.misKeyed)} allocation records carry an
          impossible price</strong> — implied unit prices reach $620,000 a megalitre,
          which is either entitlement territory or a keying error. One season's water
          cannot rationally cost more than the perpetual right, so rows above $2,000/ML
          are excluded from prices while their volume is kept. Two such rows alone had
          inflated one month's Barmah Choke gap from 27% to 197%.</li>
          <li><strong>The map is drawn at state level.</strong> ${m.notes.wrpaJoin}</li>
          <li><strong>The flow diagram is capped.</strong> ${m.notes.flowCap}</li>
        </ul>

        <h3>Licence and attribution</h3>
        <p>Water market data: Bureau of Meteorology, © Commonwealth of Australia,
        licensed under
        <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.
        State boundaries: Australian Bureau of Statistics ASGS, CC BY 4.0.
        Neither the Bureau nor the ABS endorses this site.</p>
        <p>This is not financial advice and it is not a broker's quote. If you are
        buying or selling water, check the current market with a licensed broker or
        your state water authority — the figures here are historical registered trades
        with a reporting lag.</p>`;

      panel.append(head, body);
    },
  });
}
