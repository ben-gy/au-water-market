// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Small SVG helpers shared by every hand-rolled chart. There is deliberately no
// charting library here: the views this site needs (a decoupling pair, a
// price-wedge, a dispersion matrix, a seasonal clock) are not what a chart
// library is good at, and the ones it is good at are four lines of arithmetic.

const NS = 'http://www.w3.org/2000/svg';

export function svgEl<K extends keyof SVGElementTagNameMap>(
  name: K,
  attrs: Record<string, string | number> = {},
  parent?: SVGElement,
): SVGElementTagNameMap[K] {
  const el = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (parent) parent.appendChild(el);
  return el;
}

export function makeSvg(width: number, height: number, cls = ''): SVGSVGElement {
  const svg = svgEl('svg', {
    viewBox: `0 0 ${width} ${height}`,
    width: '100%',
    // A viewBox alone leaves the element with no intrinsic height in a flex
    // parent on Safari, which collapses the chart to nothing.
    height,
    preserveAspectRatio: 'xMidYMid meet',
    role: 'img',
  });
  if (cls) svg.setAttribute('class', cls);
  return svg;
}

/** Linear scale. Guards a zero-width domain, which otherwise yields NaN for
 *  every point and an SVG that renders as literally nothing. */
export function scale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (!Number.isFinite(span) || span === 0) return () => (r0 + r1) / 2;
  return (v: number) => r0 + ((v - d0) / span) * (r1 - r0);
}

/** Log scale for price axes that span $19 to $6,000 — on a linear axis the
 *  entire pre-2015 market is a flat line pinned to the floor. */
export function logScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const lo = Math.log10(Math.max(d0, 0.01));
  const hi = Math.log10(Math.max(d1, d0 * 1.0001, 0.02));
  const span = hi - lo;
  if (!Number.isFinite(span) || span === 0) return () => (r0 + r1) / 2;
  return (v: number) => r0 + ((Math.log10(Math.max(v, 0.01)) - lo) / span) * (r1 - r0);
}

/** Nice round ticks for a linear axis. */
export function ticks(d0: number, d1: number, count = 5): number[] {
  if (!Number.isFinite(d0) || !Number.isFinite(d1) || d1 <= d0) return [d0];
  const raw = (d1 - d0) / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 1.5 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(d0 / step) * step; v <= d1 + 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

/** Decade ticks for a log axis (1, 2, 5 per decade). */
export function logTicks(d0: number, d1: number): number[] {
  const out: number[] = [];
  const lo = Math.floor(Math.log10(Math.max(d0, 0.01)));
  const hi = Math.ceil(Math.log10(Math.max(d1, 0.02)));
  for (let e = lo; e <= hi; e++) {
    for (const m of [1, 2, 5]) {
      const v = m * 10 ** e;
      if (v >= d0 && v <= d1) out.push(v);
    }
  }
  return out;
}

/** A polyline path that BREAKS at nulls instead of bridging them. A gap filled
 *  with zero draws a spike to the axis and reads as a crash that never
 *  happened; a gap bridged with a straight line invents data. */
export function linePath(points: ({ x: number; y: number } | null)[]): string {
  let d = '';
  let pen = false;
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`;
    pen = true;
  }
  return d;
}

export function areaPath(points: ({ x: number; y: number } | null)[], baseY: number): string {
  const runs: { x: number; y: number }[][] = [];
  let cur: { x: number; y: number }[] = [];
  for (const p of points) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) { if (cur.length) runs.push(cur); cur = []; continue; }
    cur.push(p);
  }
  if (cur.length) runs.push(cur);
  return runs.filter((r) => r.length > 1).map((r) => {
    const head = r.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join('');
    return `${head}L${r[r.length - 1].x.toFixed(2)} ${baseY.toFixed(2)}L${r[0].x.toFixed(2)} ${baseY.toFixed(2)}Z`;
  }).join('');
}

/** A cubic ribbon from one point to another, used by the flow diagram. */
export function ribbon(x0: number, y0: number, x1: number, y1: number, w0: number, w1: number): string {
  const mx = (x0 + x1) / 2;
  return [
    `M${x0} ${y0 - w0 / 2}`,
    `C${mx} ${y0 - w0 / 2} ${mx} ${y1 - w1 / 2} ${x1} ${y1 - w1 / 2}`,
    `L${x1} ${y1 + w1 / 2}`,
    `C${mx} ${y1 + w1 / 2} ${mx} ${y0 + w0 / 2} ${x0} ${y0 + w0 / 2}`,
    'Z',
  ].join('');
}

/** Section scaffold every view uses, so titles, subtitles and legends are
 *  consistent and no chart ever ships without an explanation. */
export function panel(opts: { title: string; subtitle?: string; legend?: HTMLElement; wide?: boolean }): {
  section: HTMLElement; body: HTMLDivElement;
} {
  const section = document.createElement('section');
  section.className = 'panel';
  const head = document.createElement('div');
  head.className = 'panel-head';
  const h = document.createElement('h2');
  h.innerHTML = opts.title;
  head.appendChild(h);
  if (opts.subtitle) {
    const p = document.createElement('p');
    p.className = 'panel-sub';
    p.innerHTML = opts.subtitle;
    head.appendChild(p);
  }
  if (opts.legend) head.appendChild(opts.legend);
  const body = document.createElement('div');
  body.className = opts.wide ? 'panel-body scroll-x' : 'panel-body';
  section.append(head, body);
  return { section, body };
}

export function legend(items: { color: string; label: string; shape?: 'line' | 'box' }[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'legend';
  for (const it of items) {
    const s = document.createElement('span');
    s.className = 'legend-item';
    const sw = document.createElement('i');
    sw.className = it.shape === 'line' ? 'sw sw-line' : 'sw';
    sw.style.background = it.color;
    s.append(sw, document.createTextNode(it.label));
    el.appendChild(s);
  }
  return el;
}
