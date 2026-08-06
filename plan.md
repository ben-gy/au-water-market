# Site Plan: Water Market

## Overview
- **Name:** Water Market
- **Repo name:** au-water-market
- **Tagline:** Every water trade in Australia — what a megalitre costs, which way it flows, and what a bottleneck in a river is worth.

### Naming Convention
"Water Market" carries no country code; the index entry sets `country: "AU"` and
lab.benrichardson.dev renders the flag. It does not collide with **au-dams**
("Dam Levels"), which is a live storage-level feed and shares nothing with this
site but a publisher and the word *water* — see Duplication below.

## Target Audience
Irrigators in the southern Murray-Darling Basin — a cotton grower at Hillston, a
dairy farmer in the Goulburn, an almond producer below the Barmah Choke — who
buy and sell water every season and today have no free way to see what the
market actually paid. Alongside them: water brokers, agricultural lenders and
valuers pricing an entitlement as collateral, farm economists, MDB reporters,
and the ordinary reader who has heard "water is traded like shares in Australia"
and wants to see it.

They are mostly on a phone, in a shed or a ute, often deciding something with
money attached. They are not naive about water — they know what "high
reliability" means — but they are not analysts either, and they will not tolerate
a chart they have to decode.

## Value Proposition
The Bureau of Meteorology publishes every registered water trade in Australia —
482,376 allocation trades and 156,679 entitlement trades back to 2007 — and then
buries them behind a Tableau embed with no download link. The three CSVs are not
referenced by any HTML page on bom.gov.au; you can only find them by reading the
dashboard's own JavaScript bundle. ABARES used to publish an analysis of this
market and stopped at 2016-17.

So there is a decade-wide hole where a public view of Australia's water market
should be. This site fills it: volume-weighted prices computed the correct way,
the flows between trading zones, and two findings nobody else publishes — the
decoupling of the temporary and permanent markets, and the dollar value the
market itself puts on the Barmah Choke.

## Data Sources
| Source | URL | What it provides | Update frequency | Auth required? |
|--------|-----|-------------------|-----------------|----------------|
| BOM Water Markets — allocation trades | `http://waterstorageapp.bom.gov.au/prod/MarketsData/Allocation_Trades.csv` | 482,376 temporary (one-season) trades, 2008-07-01 → present: origin/dest zone, volume, price, date | Daily rebuild | No |
| BOM Water Markets — entitlement trades | `http://waterstorageapp.bom.gov.au/prod/MarketsData/Entitlements_Trades.csv` | 156,679 permanent trades, 2007-07-01 → present: + reliability class, trade type | Daily rebuild | No |
| BOM Water Markets — entitlements on issue | `http://waterstorageapp.bom.gov.au/prod/MarketsData/Entitlements_On_Issue.csv` | 578,376 rows, one per entitlement: the 40.5 million ML stock by state/system/reliability | Snapshots (30 Jun, plus partials) | No |
| BOM dashboard config | `http://www.bom.gov.au/water/dashboards/config-service.php` | The only contract for the three URLs above — re-read each run, fail loudly on drift | Continuous | No |
| MDBA Water Resource Plan Areas (surface water) | `https://data.gov.au/geoserver/murray-darling-basin-water-resource-plan-areas-surface-water/wfs?...outputFormat=json` | 19 real WRPA polygons, CC BY 4.0, for the map | Static | No |
| ABS ASGS state boundaries | `patterns/geo/au-states.geojson` | State outlines for non-MDB context | Static | No |

**Licence:** BOM water market pages are CC BY 4.0. Attribution: *"Bureau of
Meteorology, © Commonwealth of Australia. Licensed under CC BY 4.0."* MDBA WRPA
boundaries CC BY 4.0. Both appear in the footer, the About panel and JSON-LD.

## Duplication check
`au-dams` is live BOM **storage levels** (how full 26 dams are). This is the
**market** — prices, volumes, origin→destination. Zero shared columns, rows or
entities; different host path (`/prod/MarketsData/`), different config key.
**Deliberate constraint: this site will NOT show storage levels or dam context.**
That is the one move that would turn a distinct site into an overlap, and the
temptation (using storage as a proxy for supply) is explicitly resisted —
seasonal allocation determinations are a different dataset and are not in these
files.

## Key Features
1. **The price spread** — monthly volume-weighted allocation price against the
   permanent entitlement price by reliability, 2008→now, drought years banded.
2. **Flow between zones** — where the water physically goes, as a directed flow
   diagram over 344 trading zones, scrubbing by water year.
3. **The Barmah Choke wedge** — the price of the same water above and below a
   physical channel constraint, month by month, with the spread beneath.
4. **Net importer / exporter map** — real MDBA WRPA polygons coloured by net
   megalitres bought minus sold.
5. **Dispersion heatmap** — zone × month shaded by within-cell price spread: where
   the market is thin and two neighbours pay wildly different prices.
6. **Entitlement stock & churn** — treemap of the 40.5 million ML on issue, and
   how much of it changes hands.
7. **The seasonal clock** — the June end-of-water-year dump, one ring per year.
8. **Zone drill-down** — click any zone anywhere and get its price history, its
   counterparties, its net balance, its liquidity.

## Style Direction
**Tone:** calm, practical, agricultural — not a trading terminal.
**Colour palette:** a light river palette. Paper-white ground, deep river blue as
the primary accent, a dry ochre for scarcity/price-high and a green-teal for
volume/wet. The temptation is a black Bloomberg terminal; that would be wrong
for a grower reading it in daylight on a cracked phone screen, and it would
overstate the immediacy of a dataset that reports in arrears.
**UI density:** balanced. Dense enough to respect an expert reader, spacious
enough to survive sunlight and a thumb.
**Dark/light theme:** light.
**Reference sites for tone:** the ABS's better data releases; fuelaustralia.org
for the "practical tool a non-analyst trusts" feel.

## Technical Architecture
- **Stack:** Vanilla TypeScript + Vite (no React — this is one page of views, not
  a component tree).
- **Data strategy:** **pipeline.** The source has no CORS headers and is broken
  over HTTPS, so client-side fetch is impossible. A cron re-downloads 292 MB,
  aggregates server-side, and commits small JSON to `public/data/`.
  **Cadence: monthly** — the source rebuilds daily, but monthly is the fastest
  cadence this factory permits, and it is more than proportional to a market
  whose last four weeks are structurally incomplete anyway (see traps).
- **Key libraries:** Leaflet (map, from npm). Everything else hand-rolled SVG.

## Data traps this build must survive
Every one of these was hit during source validation and each fails **silently**:
1. **41.3% of allocation rows have `net_price = 0`** — zero-consideration
   transfers (carryover, intra-corporate, environmental). Exclude from price,
   INCLUDE in volume. Backwards = every price ~40% too low and nothing looks
   wrong. *Test asserts the unpriced share per view, not the final number.*
2. **Never average `price_per_ML`** — it is integer-rounded per row, so a 1 ML
   novelty trade outvotes a 10,000 ML deal. Always `sum(net_price)/sum(quantity)`.
3. **`Entitlements_On_Issue` snapshots are ragged** — 30-06-2026 has only QLD/VIC/WA;
   31-07-2026 has NSW plus a 170 ML SA stub. `max(date)` reports South Australia
   holding 170 ML instead of 2,759,336 — a 16,000× error that renders as a
   plausible small bar. Take the latest snapshot **per state**, with a
   completeness floor.
4. **The trailing weeks are a lie** — 102 trades in the last 7 days vs ~1,100/week
   five weeks back. Shade 6 weeks provisional; never let the newest month drive a
   leaderboard.
5. **Vocabularies are raw state-register strings** and do not harmonise
   (`Surety 5`, `Very High (Class 1, 2, 5, 6, 9 & Licences)`, `71M`). Flagship
   price series restricted to the southern MDB; no silent national pooling.
6. **HTTP only** (HTTPS fails, curl 35), **no CORS**, dd-mm-yyyy dates, all fields
   quoted, `NA`/`Undefined`/`Unassigned` are distinct sentinels, and the QLD zone
   column is named differently in each of the three files.
7. **No counterparties exist** — zone-to-zone is the finest resolution. No
   "who owns Australia's water" framing is supportable and none will be made.

## Layout
Sticky header (brand + word-only tabs + About). Content max-width 1680px. Each
view is a titled panel with a subtitle explaining what it shows and a legend.
Below 768px panels stack, the flow diagram and heatmap get their own
`overflow-x: auto` scrollers, and the drill-down becomes a full-width sheet.

## Pages/Views
Hash-routed single page: Overview · Prices · Flows · The Choke · Map · Dispersion ·
Stock · Seasons · Explorer. Zone drill-down overlays any of them.

## Visualization Strategy
| View | Form | Question it answers | Why this form |
|---|---|---|---|
| Prices | Dual-series line + banded area | When does water-for-a-year decouple from water-forever? | Two decoupled price series over 18 years is a time-series question; nothing else shows divergence as directly |
| Flows | Directed flow / Sankey over zones | Which way does the water actually move, and does drought reverse it? | Every row *is* an origin→destination pair with a volume — this is the data's native shape |
| The Choke | Paired line + spread columns | What is a physical bottleneck in a river worth per megalitre? | A same-month paired comparison; the spread is the story and needs its own axis |
| Map | Choropleth on real MDBA WRPA polygons | Which regions structurally buy, which sell, and has one flipped? | Signed net balance is inherently geographic |
| Dispersion | Zone × month matrix heatmap | Where is the market thin and disorderly? | Only transaction-level data can show within-cell spread; no published index can |
| Stock | Treemap + churn bars | How liquid is the permanent market really? | Composition of a 40.5m ML stock is hierarchical |
| Seasons | Radial clock, one ring per year | Is the June sell-down growing, and what does it cost sellers? | Month-of-year is cyclical; a linear axis hides the repeat |
| Explorer | Sortable, filterable table | Any specific question the views don't answer | Always include |

Nine views, seven structurally distinct idioms. Colour is assigned once per
entity (reliability class, state, resource type) and reused across every view.

## Actionable insights
- **Leaderboards:** most expensive zones, most liquid zones, biggest net importers.
- **Per-unit normalisation:** price is already per-ML; churn is normalised by stock
  on issue so Victoria's 7.5m ML and NSW's 15.2m ML compare fairly.
- **Drill-down:** every zone name anywhere on the site opens its dossier
  (`#zone=slug`), URL-addressable.
- **Anomaly detection:** `src/analysis.ts` flags zone-months whose price dispersion
  or price level is a statistical outlier, and surfaces them as insight cards.
