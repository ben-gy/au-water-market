// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

import type { Bundle } from './types.ts';

const BASE = `${import.meta.env.BASE_URL ?? '/'}data`.replace(/\/{2,}/g, '/');

async function getJson<T>(name: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}/${name}`, { signal });
  if (!res.ok) throw new Error(`Could not load ${name} (HTTP ${res.status})`);
  return (await res.json()) as T;
}

/**
 * Loads everything the site needs in one go — the whole payload is ~1.1 MB and
 * every view is a click away, so a per-view fetch would only trade a smaller
 * first paint for a stall on every tab.
 */
export async function loadBundle(signal: AbortSignal): Promise<Bundle> {
  const [meta, prices, zones, choke, flows, stock, dispersion, seasons, stateNet] = await Promise.all([
    getJson<Bundle['meta']>('meta.json', signal),
    getJson<Bundle['prices']>('prices.json', signal),
    getJson<{ zones: Bundle['zones'] }>('zones.json', signal),
    getJson<Bundle['choke']>('choke.json', signal),
    getJson<Bundle['flows']>('flows.json', signal),
    getJson<Bundle['stock']>('stock.json', signal),
    getJson<Bundle['dispersion']>('dispersion.json', signal),
    getJson<Bundle['seasons']>('seasons.json', signal),
    getJson<Bundle['stateNet']>('statenet.json', signal),
  ]);
  return { meta, prices, zones: zones.zones, choke, flows, stock, dispersion, seasons, stateNet };
}

/** Preference persistence. Wrapped because Safari in private mode throws on
 *  localStorage access rather than returning null, which would take the whole
 *  boot down over a remembered sort order. */
export const prefs = {
  get(key: string, fallback: string): string {
    try { return localStorage.getItem(`wm:${key}`) ?? fallback; } catch { return fallback; }
  },
  set(key: string, value: string): void {
    try { localStorage.setItem(`wm:${key}`, value); } catch { /* ignore */ }
  },
};
