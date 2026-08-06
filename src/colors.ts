// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Colour is assigned ONCE per entity here and referenced everywhere. A state or
// a reliability class must be the same colour in the table pill, the bar chart,
// the flow ribbon, the map and the drill-down, or the reader has to relearn the
// legend on every view.

/** The two markets. Allocation = water for one season; entitlement = the asset. */
export const MARKET = {
  allocation: '#1f6f8b',
  entitlement: '#b06b1f',
} as const;

/** Reliability classes, only meaningful inside the southern Basin. Ordered by
 *  security of supply, and coloured along one ramp so the ordering reads. */
export const RELIABILITY: Record<string, string> = {
  High: '#14506b',
  General: '#2b7a9b',
  Medium: '#4e9ab5',
  Low: '#8fbfd0',
  Seasonal: '#c2ddE5',
};
export const RELIABILITY_ORDER = ['High', 'General', 'Medium', 'Low', 'Seasonal'];

export const STATE: Record<string, string> = {
  'New South Wales': '#1f6f8b',
  Victoria: '#2f6f4f',
  Queensland: '#8c3b2e',
  'South Australia': '#b06b1f',
  'Western Australia': '#6b4c8a',
  Tasmania: '#3f7d7a',
  'Northern Territory': '#a4553a',
  'Australian Capital Territory': '#6a6f78',
};
export const STATE_ABBR: Record<string, string> = {
  'New South Wales': 'NSW',
  Victoria: 'Vic',
  Queensland: 'Qld',
  'South Australia': 'SA',
  'Western Australia': 'WA',
  Tasmania: 'Tas',
  'Northern Territory': 'NT',
  'Australian Capital Territory': 'ACT',
};

export const RESOURCE: Record<string, string> = {
  'Surface water': '#2b7a9b',
  Groundwater: '#8a6d3b',
};

export const stateColor = (s: string | null | undefined): string => (s && STATE[s]) || '#8b93a0';
export const relColor = (r: string): string => RELIABILITY[r] ?? '#9aa6b2';

/** Diverging ramp for net importer / exporter. Blue = takes water in, ochre =
 *  sends it out. Deliberately NOT red/green: this is a balance, not a verdict,
 *  and red/green is also the commonest form of colour-blind failure. */
export function netRamp(t: number): string {
  // t in [-1, 1]
  const c = Math.max(-1, Math.min(1, t));
  if (c >= 0) {
    const k = c;
    return `rgb(${Math.round(245 - 130 * k)}, ${Math.round(247 - 90 * k)}, ${Math.round(250 - 40 * k)})`;
  }
  const k = -c;
  return `rgb(${Math.round(245 + 5 * k)}, ${Math.round(247 - 70 * k)}, ${Math.round(250 - 165 * k)})`;
}

/** Sequential ramp for the dispersion heatmap: pale where the market is tight,
 *  deep ochre where two neighbours paid very different prices the same month. */
export function spreadRamp(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(250 - 60 * k)}, ${Math.round(246 - 130 * k)}, ${Math.round(234 - 200 * k)})`;
}
