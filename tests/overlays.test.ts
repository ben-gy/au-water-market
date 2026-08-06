// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// THE DISMISSAL CONTRACT, asserted by COMPUTED STYLE.
//
// "The handler ran" proves nothing. Aurora Australis shipped with a working ✕,
// a working scrim handler AND working Escape, and was still impossible to
// dismiss, because a missing `[hidden] { display: none !important }` meant an
// author `display` rule outranked the UA stylesheet and the overlay stayed
// painted no matter what the handlers set. Only a computed-style assertion —
// or, as here, an assertion that the node has genuinely left the document —
// catches that.

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { openOverlay, closeButton } from '../src/overlay.ts';

// jsdom has no PointerEvent, and the scrim is deliberately bound to
// `pointerdown` — so without this the touch path could not be tested at all,
// which is exactly the path that has shipped broken before.
if (typeof globalThis.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    readonly pointerType: string;
    readonly isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? 'mouse';
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  globalThis.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}

const shown = (el: Element | null) =>
  Boolean(el?.isConnected)
  && getComputedStyle(el as Element).display !== 'none'
  && getComputedStyle(el as Element).visibility !== 'hidden';

function openTest(label = 'Test overlay') {
  return openOverlay({
    panelClass: 'drawer',
    label,
    lockScroll: true,
    build: (panel, close) => {
      const head = document.createElement('div');
      head.className = 'drawer-head';
      head.appendChild(closeButton(close, 'Close test overlay'));
      const body = document.createElement('div');
      body.className = 'drawer-body';
      const link = document.createElement('button');
      link.textContent = 'inner';
      body.appendChild(link);
      panel.append(head, body);
    },
  });
}

/** A real touch sequence, not `.click()`. A control wired to `click` with a
 *  `touchstart` sibling double-fires and instantly reopens, which the user
 *  experiences as a dead close button — only this path exposes it. */
function touch(el: Element): void {
  for (const type of ['pointerdown', 'pointerup']) {
    el.dispatchEvent(new PointerEvent(type, {
      bubbles: true, cancelable: true, composed: true, pointerType: 'touch', isPrimary: true,
    }));
  }
}

describe('overlay dismissal contract', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    document.body.className = '';
    // The mandatory guard, exactly as it appears in styles.css.
    const style = document.createElement('style');
    style.textContent = '[hidden]{display:none !important} .drawer{display:flex} .scrim{position:fixed;inset:0}';
    document.head.appendChild(style);
  });
  afterEach(() => {
    document.body.replaceChildren();
    document.body.className = '';
  });

  it('BASELINE: nothing is showing before an overlay is opened', () => {
    const leaked = [...document.querySelectorAll('[hidden]')].filter(shown);
    expect(leaked).toEqual([]);
    expect(document.querySelector('.drawer')).toBeNull();
  });

  it('opens, and the panel is genuinely visible', () => {
    const h = openTest();
    expect(shown(h.panel)).toBe(true);
    expect(h.isOpen()).toBe(true);
    h.close();
  });

  it('EXIT 1: the ✕ closes it, and the panel is gone in computed style', () => {
    const h = openTest();
    const btn = h.panel.querySelector<HTMLButtonElement>('.icon-close')!;
    expect(btn).toBeTruthy();
    btn.click();
    expect(shown(h.panel)).toBe(false);
    expect(h.panel.isConnected).toBe(false);
    expect(h.isOpen()).toBe(false);
  });

  it('EXIT 2: a mouse pointerdown on the scrim closes it', () => {
    const h = openTest();
    h.scrim.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerType: 'mouse' }));
    expect(shown(h.panel)).toBe(false);
    expect(h.panel.isConnected).toBe(false);
  });

  it('EXIT 3: Escape closes it from anywhere on the page', () => {
    const h = openTest();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shown(h.panel)).toBe(false);
    expect(h.panel.isConnected).toBe(false);
  });

  it('EXIT 4: a REAL touch sequence on the scrim closes it, and it does not reopen', () => {
    const h = openTest();
    touch(h.scrim);
    expect(shown(h.panel)).toBe(false);
    expect(h.panel.isConnected).toBe(false);
    // No second handler resurrects it on the following frame.
    expect(document.querySelectorAll('.drawer').length).toBe(0);
  });

  it('the ✕ is reachable by KEYBOARD — it must be bound to click, not pointerdown', () => {
    const h = openTest();
    const btn = h.panel.querySelector<HTMLButtonElement>('.icon-close')!;
    // A <button> synthesises a click from Enter and Space. If the handler were
    // on pointerdown, this would do nothing and the overlay would be a trap for
    // every keyboard and screen-reader user.
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(h.panel.isConnected).toBe(false);
  });

  it('the scrim has a real hit area and is not pointer-events:none', () => {
    const h = openTest();
    const cs = getComputedStyle(h.scrim);
    expect(cs.position).toBe('fixed');
    expect(cs.pointerEvents).not.toBe('none');
    h.close();
  });

  it('declares aria-modal AND actually moves focus into the panel', () => {
    const h = openTest();
    expect(h.panel.getAttribute('role')).toBe('dialog');
    expect(h.panel.getAttribute('aria-modal')).toBe('true');
    expect(h.panel.getAttribute('aria-label')).toBeTruthy();
    expect(h.panel.contains(document.activeElement)).toBe(true);
    h.close();
  });

  it('returns focus to the trigger when closed', () => {
    const trigger = document.createElement('button');
    trigger.textContent = 'open';
    document.body.appendChild(trigger);
    trigger.focus();
    const h = openTest();
    expect(document.activeElement).not.toBe(trigger);
    h.close();
    expect(document.activeElement).toBe(trigger);
  });

  it('locks body scroll while open and releases it on close', () => {
    const h = openTest();
    expect(document.body.classList.contains('drawer-open')).toBe(true);
    h.close();
    expect(document.body.classList.contains('drawer-open')).toBe(false);
  });

  it('nested overlays release the scroll lock only when the LAST one closes', () => {
    const a = openTest('first');
    const b = openTest('second');
    b.close();
    expect(document.body.classList.contains('drawer-open')).toBe(true);
    a.close();
    expect(document.body.classList.contains('drawer-open')).toBe(false);
  });

  it('closing twice is harmless', () => {
    const h = openTest();
    h.close();
    h.close();
    expect(h.isOpen()).toBe(false);
  });

  it('removes its keydown listener on close, so Escape cannot close a later overlay twice', () => {
    const h = openTest();
    h.close();
    const h2 = openTest();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(h2.isOpen()).toBe(false);
    // Nothing is left behind in the DOM at all.
    expect(document.querySelectorAll('.overlay-host').length).toBe(0);
  });

  it('leaves NO detached-but-displayed box behind — the iOS horizontal-scroll trap', () => {
    // An overlay parked at translateX(100%) is still a real box on iOS Safari
    // and silently gives the page a sideways scroll that overflow-x:clip
    // neither prevents nor lets scrollWidth detect. Detaching is the fix, and
    // this asserts the panel really is detached rather than merely off-screen.
    const h = openTest();
    h.close();
    expect(document.querySelectorAll('.drawer').length).toBe(0);
    expect(document.querySelectorAll('.scrim').length).toBe(0);
  });
});
