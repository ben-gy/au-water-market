// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// One overlay implementation, shared by the drawer, the About modal and the
// glossary popover.
//
// THE DISMISSAL CONTRACT — all four exits, always, none of them optional:
//   1. a ✕ with a real 44x44 hit area,
//   2. a tap anywhere on the scrim,
//   3. Escape from anywhere on the page,
//   4. and the panel must actually be gone afterwards, in COMPUTED STYLE.
//
// Three things that have shipped broken before and are handled deliberately:
//
//   * The SCRIM listener is `pointerdown` — it covers mouse, touch and pen in
//     one handler, and a scrim is never focusable so nothing is lost. The
//     BUTTON listener is `click`, because a <button> synthesises a click from
//     Enter and Space, and `pointerdown` alone would make the ✕ dead to every
//     keyboard and screen-reader user. One event family per control either way:
//     attaching both double-fires on a phone, which closes and instantly
//     reopens the overlay and reads as "the close button does nothing".
//
//   * The panel is DETACHED from the DOM when closed rather than left in place
//     under a `hidden` attribute. An off-screen fixed box is still a real box
//     on iOS Safari and silently gives the page a horizontal scroll that
//     `overflow-x: clip` neither prevents nor lets `scrollWidth` detect.
//
//   * Focus moves into the panel on open and returns to the trigger on close,
//     and is trapped while open — an overlay that declares `aria-modal` without
//     doing any of that is lying to assistive technology.

export interface OverlayHandle {
  host: HTMLDivElement;
  panel: HTMLElement;
  scrim: HTMLDivElement;
  close: () => void;
  isOpen: () => boolean;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * The body scroll lock is derived from the DOM, never from a counter.
 *
 * A counter drifts the moment an overlay leaves by any route the counter does
 * not know about — a thrown builder, a view swap that replaces children, a
 * future caller that removes the host directly — and a drifted counter leaves
 * `overflow: hidden` welded onto the body, which reads to the user as a page
 * that has stopped scrolling for no reason. Asking the document how many
 * overlays are actually open cannot drift.
 */
function syncScrollLock(): void {
  const open = document.querySelectorAll('.overlay-host[data-lock-scroll]').length;
  document.body.classList.toggle('drawer-open', open > 0);
}

export function openOverlay(opts: {
  panelClass: string;
  label: string;
  lockScroll?: boolean;
  build: (panel: HTMLElement, close: () => void) => void;
  onClose?: () => void;
}): OverlayHandle {
  const trigger = document.activeElement as HTMLElement | null;

  const host = document.createElement('div');
  host.className = 'overlay-host';

  const scrim = document.createElement('div');
  scrim.className = 'scrim';
  scrim.setAttribute('aria-hidden', 'true');

  const panel = document.createElement('div');
  panel.className = opts.panelClass;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-label', opts.label);

  host.append(scrim, panel);

  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey, true);
    host.remove();
    syncScrollLock();
    opts.onClose?.();
    // Return focus to whatever opened this, if it is still on the page.
    if (trigger && document.contains(trigger)) trigger.focus();
  };

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
    if (e.key !== 'Tab') return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  // pointerdown, not click: fires for mouse, touch and pen alike, and still
  // fires where a synthetic click would not.
  scrim.addEventListener('pointerdown', (e) => { e.preventDefault(); close(); });
  document.addEventListener('keydown', onKey, true);

  opts.build(panel, close);
  if (opts.lockScroll) host.setAttribute('data-lock-scroll', '');
  document.body.appendChild(host);
  syncScrollLock();

  // Move focus into the panel: the close button if nothing better exists.
  const target = panel.querySelector<HTMLElement>('.icon-close') ?? panel;
  if (target === panel) panel.setAttribute('tabindex', '-1');
  target.focus();

  return { host, panel, scrim, close, isOpen: () => !closed };
}

/**
 * Close every open overlay.
 *
 * Called on view navigation. Without it a drawer opened on one view stays
 * floating over the next one — the reader appears to navigate "behind" a panel,
 * and on a phone the panel is full-width so the new view is entirely hidden.
 * Removing the host runs the same teardown as the ✕, including the scroll lock.
 */
export function closeAllOverlays(): void {
  for (const host of [...document.querySelectorAll('.overlay-host')]) host.remove();
  syncScrollLock();
}

/** The mandatory ✕. `click`, not `pointerdown`, so Enter and Space reach it. */
export function closeButton(onClose: () => void, label = 'Close'): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = 'icon-close';
  b.type = 'button';
  b.setAttribute('aria-label', label);
  b.textContent = '✕';
  b.addEventListener('click', onClose);
  return b;
}
