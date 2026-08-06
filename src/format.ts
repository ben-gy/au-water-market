// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** The water year runs July→June, so a "season" chart indexes months from July. */
export const WATER_MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];

export const num = (v: number | null | undefined, dp = 0): string =>
  v == null || !Number.isFinite(v) ? '—' : v.toLocaleString('en-AU', { minimumFractionDigits: dp, maximumFractionDigits: dp });

/** Water prices span three orders of magnitude ($19/ML to $6,000/ML), so cents
 *  matter at the bottom of the range and are noise at the top. */
export const money = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) >= 1000) return `$${num(v, 0)}`;
  return `$${num(v, 2)}`;
};

export const perML = (v: number | null | undefined): string => (v == null ? '—' : `${money(v)}/ML`);

/** Megalitres run from single digits to 15 million, so the unit moves with it.
 *  1 GL = 1,000 ML; a gigalitre is the unit irrigators actually speak in. */
export const ml = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${num(v / 1_000_000, 2)} million ML`;
  if (a >= 10_000) return `${num(v / 1000, 1)} GL`;
  return `${num(v, 0)} ML`;
};

export const mlShort = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${num(v / 1_000_000, 1)}M`;
  if (a >= 1000) return `${num(v / 1000, a >= 10_000 ? 0 : 1)}k`;
  return num(v, 0);
};

export const pct = (v: number | null | undefined, dp = 1): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '' : ''}${num(v * 100, dp)}%`;

export const signedPct = (v: number | null | undefined, dp = 1): string =>
  v == null || !Number.isFinite(v) ? '—' : `${v > 0 ? '+' : ''}${num(v, dp)}%`;

export const dollars = (v: number | null | undefined): string => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e9) return `$${num(v / 1e9, 2)}bn`;
  if (a >= 1e6) return `$${num(v / 1e6, 1)}m`;
  if (a >= 1e3) return `$${num(v / 1e3, 0)}k`;
  return `$${num(v, 0)}`;
};

/** '2026-02' → 'Feb 2026' */
export const monthLabel = (m: string): string => {
  const [y, mm] = m.split('-');
  return `${MONTHS[+mm - 1]} ${y}`;
};
/** '2026-02' → "Feb '26" — for a crowded axis. */
export const monthShort = (m: string): string => {
  const [y, mm] = m.split('-');
  return `${MONTHS[+mm - 1]} '${y.slice(2)}`;
};

/** '30-06-2025' (the file's own dd-mm-yyyy) → '30 June 2025' */
export const auDate = (d: string): string => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d);
  if (!m) return d;
  const full = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  return `${+m[1]} ${full[+m[2] - 1]} ${m[3]}`;
};

/** ISO '2026-08-03' → '3 Aug 2026' */
export const isoDate = (d: string | null): string => {
  if (!d) return '—';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return d;
  return `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]}`;
};

/**
 * Display name for a trading zone.
 *
 * Some rows carry 'Undefined' or 'Unassigned' in the zone column — 1.93 million
 * ML between them, 1.76% of all traded volume, and concentrated in the early
 * years (445,607 ML in 2010-11 alone, enough to be a leading ribbon in that
 * year's flow diagram). They are real trades whose zone the reporting agency
 * did not record, but printed raw they read as a PLACE named "Undefined", which
 * is worse than saying nothing.
 *
 * Relabelled here rather than dropped, because the volume genuinely happened and
 * every total must still add up. `isMissing()` in the pipeline deliberately does
 * NOT treat these as missing — 'Undefined' is also a real reliability class, and
 * conflating the two would silently delete rows.
 */
const NO_ZONE = new Set(['Undefined', 'Unassigned', 'NA', 'Unknown', '']);
export const zoneLabel = (name: string | null | undefined, state?: string | null): string => {
  if (name == null) return 'Zone not recorded';
  return NO_ZONE.has(name.trim()) ? `Zone not recorded${state ? ` (${state})` : ''}` : name;
};

/**
 * Escape for a `data-tip` ATTRIBUTE set via setAttribute/textContent paths.
 * Newlines stay RAW here — the tooltip element uses textContent + white-space:
 * pre-line, so a literal "\n" is what produces a line break. Passing the HTML
 * entity instead renders the characters "&#10;" to the reader, which has
 * shipped before.
 */
export const tip = (...lines: (string | null | undefined)[]): string =>
  lines.filter(Boolean).join('\n');

/** Escape for insertion into an innerHTML string. */
export const esc = (s: unknown): string =>
  String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** Escape for a `data-tip` written INTO an innerHTML string — here the newline
 *  must become an entity or the attribute is terminated by the raw byte. */
export const escTip = (s: string): string => esc(s).replace(/\n/g, '&#10;');
