// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import './styles.css';
import { loadBundle } from './data.ts';
import { initTooltip } from './components/tooltip.ts';
import { VIEWS, VIEW_IDS, parseHash, type ViewCtx } from './router.ts';
import { closeAllOverlays, closeButton, openOverlay } from './overlay.ts';
import { GLOSSARY } from './glossary.ts';
import { openZone } from './zoneDrawer.ts';
import { renderAbout } from './about.ts';
import type { Bundle } from './types.ts';

import { renderOverview } from './views/overview.ts';
import { renderPrices } from './views/prices.ts';
import { renderFlows } from './views/flows.ts';
import { renderChoke } from './views/choke.ts';
import { renderMap } from './views/map.ts';
import { renderDispersion } from './views/dispersion.ts';
import { renderStock } from './views/stock.ts';
import { renderSeasons } from './views/seasons.ts';
import { renderZones } from './views/zones.ts';

type Renderer = (ctx: ViewCtx) => void | Promise<void>;

const RENDERERS: Record<string, Renderer> = {
  overview: renderOverview,
  prices: renderPrices,
  flows: renderFlows,
  choke: renderChoke,
  map: renderMap,
  dispersion: renderDispersion,
  stock: renderStock,
  seasons: renderSeasons,
  zones: renderZones,
};

const app = document.getElementById('app')!;
let data: Bundle | null = null;
let controller: AbortController | null = null;

function shell(): void {
  app.innerHTML = `
    <button class="skip" type="button" id="skip-link">Skip to content</button>
    <header class="site-header">
      <div class="header-inner">
        <a class="brand" href="#view=overview">
          <svg class="brand-mark" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">
            <path d="M2 13c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2 2.2-2 4.4-2"/>
            <path d="M2 18c2.2 0 2.2 2 4.4 2s2.2-2 4.4-2 2.2 2 4.4 2 2.2-2 4.4-2"/>
            <path d="M12 2v7M12 2l3 3M12 2 9 5"/>
          </svg>
          <span class="brand-txt"><h1>Water Market</h1><small>Australian water trading</small></span>
        </a>
        <nav class="tabs" id="tabs" aria-label="Views"></nav>
        <div class="header-actions">
          <button class="icon-btn" id="about-btn" type="button" aria-label="About this site and its data">?</button>
        </div>
      </div>
    </header>
    <main class="main-content" id="main"><div class="loading">Loading Australia's water market…<div class="skeleton" style="margin-top:16px"></div></div></main>
    <footer class="site-footer">
      <div class="footer-inner">
        <span>Data: <a href="https://www.bom.gov.au/water/market/" target="_blank" rel="noopener">Bureau of Meteorology water market data</a> · © Commonwealth of Australia, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>. Boundaries: ABS ASGS (CC BY 4.0).</span>
        <span>Built by <a href="https://benrichardson.dev/">benrichardson.dev</a> · <a href="https://lab.benrichardson.dev" target="_blank" rel="noopener">more tools &amp; sites</a></span>
      </div>
    </footer>`;

  const tabs = document.getElementById('tabs')!;
  // Words only — never a count badge in a nav label.
  tabs.innerHTML = VIEWS.map((v) => `<a href="#view=${v.id}" data-view="${v.id}">${v.label}</a>`).join('');
  document.getElementById('about-btn')!.addEventListener('click', () => {
    if (data) renderAbout(data);
  });
  // A button, not an <a href="#main">. This site is hash-routed, so an anchor
  // would set location.hash = '#main', which parseHash reads as a view name,
  // fails to match, and falls back to Overview — sending every keyboard user
  // who uses the skip link back to the front page.
  document.getElementById('skip-link')!.addEventListener('click', () => {
    const main = document.getElementById('main')!;
    main.setAttribute('tabindex', '-1');
    main.focus();
    main.scrollIntoView();
  });
}

function setActiveTab(view: string): void {
  for (const a of document.querySelectorAll<HTMLAnchorElement>('#tabs a')) {
    if (a.dataset.view === view) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

function showError(main: HTMLElement, err: unknown): void {
  const msg = err instanceof Error ? err.message : String(err);
  main.innerHTML = '';
  const box = document.createElement('div');
  box.className = 'error-box';
  box.innerHTML = `<p><strong>Could not load the water market data.</strong></p><p>${msg}</p>`;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Try again';
  retry.addEventListener('click', () => { void boot(); });
  box.appendChild(retry);
  main.appendChild(box);
}

async function route(): Promise<void> {
  if (!data) return;
  const main = document.getElementById('main')!;
  const { view, params } = parseHash(VIEW_IDS);
  setActiveTab(view);
  // A drawer opened on one view must not float over the next one.
  closeAllOverlays();
  main.innerHTML = '';
  try {
    await RENDERERS[view]({ root: main, data, params });
  } catch (err) {
    showError(main, err);
    return;
  }
  const zone = params.get('zone');
  if (zone) openZone(data, zone);
  if (!params.get('keepScroll')) window.scrollTo({ top: 0 });
}

/** The glossary popover. Delegated so it works on marks rendered later, and
 *  dismissible by click-away, Escape, scroll and resize — a popover that
 *  survives a scroll ends up pointing at nothing. */
function initGlossary(): void {
  let pop: HTMLDivElement | null = null;
  const close = () => { pop?.remove(); pop = null; };
  document.addEventListener('click', (e) => {
    const btn = (e.target as Element).closest<HTMLElement>('button.gloss');
    if (!btn) { if (pop && !(e.target as Element).closest('.gloss-pop')) close(); return; }
    e.preventDefault();
    e.stopPropagation();
    const term = GLOSSARY[btn.dataset.term ?? ''];
    close();
    if (!term) return;
    pop = document.createElement('div');
    pop.className = 'gloss-pop';
    pop.setAttribute('role', 'dialog');
    pop.setAttribute('aria-label', term.term);
    pop.innerHTML = `<h4></h4><p></p>`;
    pop.querySelector('h4')!.textContent = term.term;
    pop.querySelector('p')!.textContent = term.definition;
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = r.left - 8;
    let top = r.bottom + 8;
    if (left + pr.width > window.innerWidth - 10) left = window.innerWidth - pr.width - 10;
    if (top + pr.height > window.innerHeight - 10) top = Math.max(10, r.top - pr.height - 8);
    pop.style.left = `${Math.max(10, left)}px`;
    pop.style.top = `${top}px`;
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  window.addEventListener('scroll', close, { passive: true });
  window.addEventListener('resize', close);
}

async function boot(): Promise<void> {
  const main = document.getElementById('main')!;
  main.innerHTML = '<div class="loading">Loading Australia\'s water market…<div class="skeleton" style="margin-top:16px"></div></div>';
  controller?.abort();
  controller = new AbortController();
  try {
    data = await loadBundle(controller.signal);
  } catch (err) {
    if ((err as Error).name === 'AbortError') return;
    showError(main, err);
    return;
  }
  await route();
}

shell();
initTooltip();
initGlossary();
window.addEventListener('hashchange', () => { void route(); });
void boot();

// Exported for the About modal's "how this was built" link and for tests that
// want to assert the overlay contract against the real implementation.
export { openOverlay, closeButton };
