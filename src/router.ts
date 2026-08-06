// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { Bundle } from './types.ts';

export interface ViewCtx {
  root: HTMLElement;
  data: Bundle;
  params: URLSearchParams;
}

export const VIEWS = [
  { id: 'overview', label: 'Overview' },
  { id: 'prices', label: 'Prices' },
  { id: 'flows', label: 'Flows' },
  { id: 'choke', label: 'The Choke' },
  { id: 'map', label: 'Map' },
  { id: 'dispersion', label: 'Dispersion' },
  { id: 'stock', label: 'Stock' },
  { id: 'seasons', label: 'Seasons' },
  { id: 'zones', label: 'Zones' },
] as const;

export const VIEW_IDS = VIEWS.map((v) => v.id) as unknown as string[];

/** All state worth a URL goes through here, so every view is linkable. */
export function goto(view: string, extra: Record<string, string> = {}): void {
  const p = new URLSearchParams();
  p.set('view', view);
  for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v);
  location.hash = p.toString();
}

export function parseHash(known: string[]): { view: string; params: URLSearchParams } {
  const raw = location.hash.replace(/^#/, '');
  const params = new URLSearchParams(raw);
  const view = params.get('view') ?? (raw && !raw.includes('=') ? raw : 'overview');
  return { view: known.includes(view) ? view : 'overview', params };
}
