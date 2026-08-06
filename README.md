# Water Market

**Every registered water trade in Australia — what a megalitre costs, which way it flows, and what a bottleneck in a river is worth.**

🔗 **Live:** [https://au-water-market.benrichardson.dev](https://au-water-market.benrichardson.dev)

## What is this?

Australia runs one of the largest markets in water rights in the world. Every
registered trade is reported to the Bureau of Meteorology by around 44 state and
territory agencies, and the Bureau publishes the lot: 482,376 allocation trades
back to 2008, 156,679 permanent entitlement trades back to 2007, and a register
of all 40.31 million megalitres of entitlement on issue.

It then buries them. The three CSV files are not linked from any page on
bom.gov.au — the Water Markets dashboard is a Tableau embed inside an AngularJS
shell, and the only place the file locations exist is a `config-service.php`
endpoint the shell fetches at boot. ABARES used to publish an analysis of this
market and stopped at 2016-17. So there is a decade-wide hole where a public view
of Australia's water market should be.

This site fills it. It computes prices the correct way — volume-weighted, and
excluding the 43.6% of trades that carry no price because they are transfers
between accounts of the same owner — and then shows two things nobody else
publishes: that the market for water-for-one-season and the market for
water-forever have come apart since the 2019-20 drought, and that the Barmah
Choke, a stretch of the Murray too narrow to carry the water people want to move
through it, has a price.

Getting those two findings right took more care than getting them at all. Three
separate conventions in the source will each produce a confident, plausible, and
wrong answer: a token one-dollar consideration that the Bureau's own
per-megalitre column marks as unpriced; limited-term **leases** pooled in with
outright sales, which are 0.9% of rows but large enough in a volume-weighted
average to turn a 15% price rise into a 71% one; and mis-keyed unit prices up to
$620,000/ML, two of which alone had inflated one month's Choke gap from 27% to
197%. Each is filtered, disclosed in the About panel, and pinned by a test.

## Who is this for?

Irrigators in the southern Murray-Darling Basin who buy and sell water every
season and currently have no free way to see what the market actually paid — a
cotton grower at Hillston, a dairy farmer in the Goulburn, an almond producer
below the Choke. Alongside them: water brokers, agricultural lenders and valuers
pricing an entitlement as collateral, farm economists, Basin reporters, and the
reader who has heard that Australia trades water like shares and wants to see it.

## Data Sources

| Source | What it provides | Update frequency |
|--------|-------------------|-----------------|
| BOM Water Markets — allocation trades | 482,376 temporary (one-season) trades, 2008-07-01 → present: origin/destination zone, volume, price, date | Rebuilt daily |
| BOM Water Markets — entitlement trades | 156,679 permanent trades, 2007-07-01 → present, with reliability class | Rebuilt daily |
| BOM Water Markets — entitlements on issue | 578,376 records: the 40.31 million ML stock by state, system and reliability | Snapshots at 30 June |
| ABS ASGS state boundaries | Real state and territory geometry for the map | Static |

All BOM water market data © Commonwealth of Australia, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Features

- **The price spread** — allocation price against permanent entitlement price by reliability class, 18 water years, on a log axis because the two markets are two orders of magnitude apart.
- **Flow diagram** — every trade between two different trading zones, sized by megalitres, scrubbing by water year. Intra-zone trades are excluded: they are most of the market by volume but no water changes place.
- **The Barmah Choke** — the same water priced above and below a physical channel constraint, month by month, with the spread charted beneath.
- **Net importer / exporter map** — real ABS boundaries coloured by megalitres bought minus sold across state borders.
- **Dispersion heatmap** — trading zone × month, shaded by how far apart the prices paid inside each cell were. Only transaction-level data can produce this; no published index can.
- **Entitlement stock treemap** — the 40.31 million ML on issue by state and resource type, with turnover normalised against it.
- **Seasonal clock** — one ring per season, showing the June sell-down that repeats every year as allocations reset.
- **Zone drill-down** — every zone name anywhere on the site opens its price history, trading partners and net balance, addressable by URL.

## Tech Stack

- **Runtime:** Vanilla TypeScript (no framework — this is one page of views, not a component tree)
- **Build:** Vite 6
- **Testing:** Vitest — 135 tests
- **Hosting:** GitHub Pages (static, no backend)
- **Data:** GitHub Actions pipeline, monthly
- **Maps:** Leaflet 1.9 (from npm, never a CDN) over real ABS ASGS boundaries
- Charts are hand-rolled SVG. There is no charting library.

## Local Development

```bash
npm install
npm run dev
npm test
npm run build
npm run preview
```

To re-run the data pipeline (downloads ~292 MB):

```bash
node pipeline/collect.mjs
```

Set `WM_REUSE_TMP=1` to reuse anything already in `pipeline/tmp/`.

## How it works

The pipeline reads `config-service.php` to discover the three CSV URLs — failing
loudly if they move, rather than silently parsing a 404 page as zero trades —
then streams 292 MB of transaction rows and reduces them to about 670 KB of JSON
in `public/data/`. The browser never touches the source: it is served over plain
HTTP only (the HTTPS listener does not answer) and sends no CORS headers.

Three gates run before anything is written, and each is asserted where the
failure would actually live:

1. **The zero-price band.** 43.6% of allocation rows have `net_price = 0`. If
   that share ever leaves the 25–60% band the meaning of the column has changed,
   and every price on the site would move ~40% without anything looking wrong.
2. **Independent reconciliation.** Volume accumulated by water year and by month
   are two separate passes over different keys; they must agree exactly, and the
   yearly trade count must equal the southern-MDB row count.
3. **A genuinely national stock snapshot.** `Entitlements_On_Issue` has four
   reporting dates and they are not four national snapshots — the newest holds
   NSW plus a single 170 ML South Australia row. Taking `max(date)` reports South
   Australia holding 170 ML instead of 2,759,336: a 16,231× error that renders as
   a perfectly plausible small bar. The pipeline takes the newest date at which
   every state is present and above a completeness floor.

A fourth rule is about what the site refuses to say. Turnover is **suppressed,
not clamped**: Western Australia filed 329 entitlement trades in 2024-25 and
exactly none in 2025-26, and the Northern Territory has not filed since 2013.
Divided by their stock those become "0.00%", which sits beside Victoria's 3%
looking like a market where nothing moves. It is a gap in the paperwork. States
that did not file enough records get no rate at all and the view says why.

## Known limitations

- **There are no buyers or sellers.** The source contains no names, no ABNs, no
  ownership. Zone-to-zone is the finest resolution that exists, so nothing here
  can say who owns Australia's water — and the site makes no such claim.
- **The last six weeks are incomplete.** Agencies report in arrears (~100 trades
  in the last seven days against ~1,100 a week five weeks earlier). That window
  is shaded on every chart and never drives a headline.
- **The map is state-level.** MDBA Water Resource Plan Area polygons were fetched
  and tested: 0 of 482,376 rows join to them by name. Rather than hand-author a
  344-row crosswalk, the map uses `origin_state`, which joins exactly.
- **Reliability classes do not harmonise across borders.** The headline series is
  restricted to the southern Murray-Darling Basin for that reason.
- **This is not dam storage.** Entitlements on issue are rights on a register.

## License

[GNU Affero General Public License v3.0 or later](./LICENSE), with an attribution
requirement added under section 7(b) — see [ADDITIONAL-TERMS.md](./ADDITIONAL-TERMS.md).

A separate commercial licence without the AGPL's source-disclosure obligations is
available on request: <hi@ben.gy>.

Third-party components keep their own licences — see [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).
Data sources keep theirs, and their attribution requirements are listed in the site's
own About panel and footer.
