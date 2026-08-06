// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
// Global hover tooltip driven by [data-tip] attributes anywhere in the document.
// Ported from the au-flights implementation (canonical factory pattern).
let tip: HTMLDivElement | null = null;

function ensure(): HTMLDivElement {
  if (!tip) {
    tip = document.createElement('div');
    tip.className = 'hover-tip';
    tip.setAttribute('role', 'tooltip');
    document.body.appendChild(tip);
  }
  return tip;
}

function position(el: HTMLDivElement, x: number, y: number): void {
  const pad = 12;
  const rect = el.getBoundingClientRect();
  let left = x + 14;
  let top = y + 14;
  if (left + rect.width + pad > window.innerWidth) left = x - rect.width - 14;
  if (top + rect.height + pad > window.innerHeight) top = y - rect.height - 14;
  el.style.left = `${Math.max(pad, left)}px`;
  el.style.top = `${Math.max(pad, top)}px`;
}

export function initTooltip(): void {
  let activeText = '';

  /**
   * TOUCH AND KEYBOARD.
   *
   * Bound to mouseover/mousemove/mouseout alone, every number this site can
   * tell you — the price, the volume, the trade count behind a bar — is
   * unreachable on a phone and unreachable from a keyboard. That is most
   * readers, on a site aimed at people standing in a paddock.
   *
   * `pointerdown` with pointerType touch/pen shows the tip where the finger
   * lands; a second tap elsewhere dismisses it. `focusin` covers keyboard
   * users on anything focusable.
   */
  const showAt = (target: Element, x: number, y: number) => {
    const text = target.getAttribute('data-tip') ?? '';
    if (!text) return false;
    activeText = text;
    const el = ensure();
    el.textContent = text;
    el.classList.add('visible');
    position(el, x, y);
    return true;
  };
  document.addEventListener('pointerdown', (e) => {
    const pe = e as PointerEvent;
    if (pe.pointerType === 'mouse') return;
    const target = (e.target as Element).closest('[data-tip]');
    if (!target) { tip?.classList.remove('visible'); return; }
    showAt(target, pe.clientX, pe.clientY);
  }, { passive: true });
  document.addEventListener('focusin', (e) => {
    const target = (e.target as Element).closest('[data-tip]');
    if (!target) { tip?.classList.remove('visible'); return; }
    const r = target.getBoundingClientRect();
    showAt(target, r.left + r.width / 2, r.top + r.height);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') tip?.classList.remove('visible');
  });

  document.addEventListener('mouseover', (e) => {
    const target = (e.target as Element).closest('[data-tip]');
    if (!target) return;
    const text = target.getAttribute('data-tip') ?? '';
    if (!text) return;
    activeText = text;
    const el = ensure();
    el.textContent = text;
    el.classList.add('visible');
    position(el, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mousemove', (e) => {
    if (!tip || !tip.classList.contains('visible')) return;
    const target = (e.target as Element).closest('[data-tip]');
    if (!target || target.getAttribute('data-tip') !== activeText) {
      tip.classList.remove('visible');
      return;
    }
    position(tip, (e as MouseEvent).clientX, (e as MouseEvent).clientY);
  });
  document.addEventListener('mouseout', (e) => {
    const target = (e.target as Element).closest('[data-tip]');
    if (target && tip) tip.classList.remove('visible');
  });
}
