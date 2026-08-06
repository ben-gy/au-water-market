// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 Ben Richardson <hi@ben.gy>
//
// Assume the reader has never bought water. Every piece of jargon on the site
// carries an ℹ button wired to one of these entries.

export interface Term { term: string; definition: string }

export const GLOSSARY: Record<string, Term> = {
  allocation: {
    term: 'Allocation (temporary trade)',
    definition:
      'Water for this season only. An allocation trade sells megalitres that have actually been allocated to a licence this water year — once used, they are gone. This is the market irrigators trade in and out of during a season depending on rainfall, and it is the price that swings most violently: from $19.80/ML in 2011-12 to $527.05/ML at the 2019-20 drought peak.',
  },
  entitlement: {
    term: 'Entitlement (permanent trade)',
    definition:
      'The perpetual right to receive a share of water every year, for ever. Selling an entitlement is selling the asset itself, not this year\'s water — closer to selling farmland than to selling a crop. Entitlements are bought by irrigators expanding, and by investors; they are used as loan collateral and appear on balance sheets.',
  },
  megalitre: {
    term: 'Megalitre (ML)',
    definition:
      'One million litres — an Olympic swimming pool is about 2.5 ML. It is the unit every Australian water market price is quoted in. A gigalitre (GL) is 1,000 ML.',
  },
  reliability: {
    term: 'Reliability class',
    definition:
      'How likely you are to actually receive your entitlement in a given year. "High reliability" water is delivered in almost every year and trades at a large premium; "low reliability" or "general security" water arrives only in wetter years. In 2025-26 high-reliability entitlement traded at $5,972/ML against $1,229/ML for low — the gap is the price of certainty.',
  },
  vwap: {
    term: 'Volume-weighted average price',
    definition:
      'Total dollars paid divided by total megalitres traded, rather than the average of each trade\'s price. It is the honest way to summarise a market: a simple average lets a one-megalitre novelty trade count as much as a ten-thousand-megalitre deal. Every price on this site is volume-weighted.',
  },
  zeroprice: {
    term: 'Zero-consideration transfer',
    definition:
      'A registered trade with no money attached — water moved between accounts of the same owner, carryover between seasons, or a reallocation by an environmental water holder. They are 43.6% of all allocation trades. This site counts them as volume, because the water really moved, but excludes them from every price, because including them would drag every headline price down by roughly 40%.',
  },
  tradingzone: {
    term: 'Trading zone',
    definition:
      'The rulebook divides rivers into zones, and water can only be traded between zones where it can physically and legally be delivered. Zones are the finest geography in this data — there are no buyer or seller names anywhere in the source, so zone-to-zone is as close as anyone can get to "who traded with whom".',
  },
  choke: {
    term: 'The Barmah Choke',
    definition:
      'A narrow stretch of the River Murray near Barmah where the channel physically cannot carry more than about 8,500 ML a day. It is the bottleneck of the southern Basin: water above it cannot always get below it when demand is high downstream. Because the market prices each side separately, the cost of that constraint shows up directly as a price gap.',
  },
  smdb: {
    term: 'Southern Murray-Darling Basin',
    definition:
      'The connected system of the Murray, Goulburn, Murrumbidgee and their neighbours across Victoria, New South Wales and South Australia. It is where nearly all of Australia\'s water trading happens, and it is the only region where reliability classes mean roughly the same thing on both sides of a state border — which is why the headline price series is restricted to it.',
  },
  wateryear: {
    term: 'Water year',
    definition:
      'The season runs 1 July to 30 June, not January to December. Allocations reset on 1 July, which is why unused water is dumped onto the market each June and the price collapses — and why splitting the data by calendar year would cut every season in half.',
  },
  provisional: {
    term: 'Provisional (reporting lag)',
    definition:
      'About 44 state agencies report trades to the Bureau in arrears, so the most recent weeks hold only a fraction of the trades that will eventually appear — roughly 100 in the last seven days against about 1,100 a week five weeks earlier. Those weeks are shaded on every chart and are never allowed to drive a headline.',
  },
  dispersion: {
    term: 'Price dispersion',
    definition:
      'How far apart the prices paid in the same zone in the same month were. A tight spread means a well-functioning market where everyone pays about the same; a wide one means information is not reaching everybody, and two neighbours can pay very different prices for identical water on the same day.',
  },
  churn: {
    term: 'Churn (turnover rate)',
    definition:
      'The share of the permanent entitlements on issue that changed hands in a year. It measures how liquid the asset market is — a state can hold an enormous stock of water rights and still have very few of them trade.',
  },
  onissue: {
    term: 'Entitlements on issue',
    definition:
      'The total stock of permanent water rights that exist on the register — 40.31 million ML across Australia at 30 June 2025. This is the pool the permanent market trades pieces of; it is not water in storage, and it is not what will actually be delivered this year.',
  },
  netbalance: {
    term: 'Net balance',
    definition:
      'Megalitres traded in, minus megalitres traded out. A positive balance means a region is structurally buying water from elsewhere; negative means it is selling. Because every trade in this data has both an origin and a destination, the balance is exact rather than estimated.',
  },
};

/** Term text followed by its ℹ button. */
export const glossaryHtml = (key: string, label?: string): string => {
  const t = GLOSSARY[key];
  if (!t) return label ?? key;
  return `${label ?? t.term}<button class="gloss" type="button" data-term="${key}" aria-label="What is ${t.term}?">i</button>`;
};

/**
 * JUST the ℹ button, with no term text.
 *
 * Use this when the surrounding prose already names the concept. Calling
 * `glossaryHtml(key)` in that position appends the term a second time and
 * renders headings like "The Barmah Choke The Barmah Choke ⓘ".
 */
export const glossaryIcon = (key: string): string => {
  const t = GLOSSARY[key];
  if (!t) return '';
  return `<button class="gloss" type="button" data-term="${key}" aria-label="What is ${t.term}?">i</button>`;
};
