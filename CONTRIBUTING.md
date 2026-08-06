# Contributing

Thanks for taking an interest.

## Copyright assignment is required

This project is dual-licensed: AGPL-3.0-or-later for everyone, and a separate
commercial licence for those who need one. That is only possible while a single
party holds the copyright in the whole work.

**By opening a pull request you assign copyright in your contribution to
Ben Richardson**, and confirm that you have the right to do so — that the work is
yours, and that no employer or client has a claim over it. Contributions that
cannot be assigned cannot be merged, however good they are.

Your contribution is then licensed back to you, and to everyone else, under the
AGPL like the rest of the project.

## Corrections about a price or a trade

This site reproduces a public register of registered water trades. If something
here is wrong:

- **If the register itself is wrong**, the Bureau of Meteorology is the
  authority, and the trade records come to it from around 44 state and territory
  agencies. This site cannot correct the underlying record, and a change here
  would be overwritten at the next data refresh.
- **If the register is right and this site has misrepresented it** — a
  mis-weighted price, a wrong water year, a zone attributed to the wrong state —
  that is a bug and it will be fixed. Use the Feedback link in the site footer or
  open an issue.

Please include the trading zone and the month, so the claim can be checked
against the source file directly.

## Practical notes

- `npm test` must pass. It runs without the 292 MB source download, against the
  committed JSON in `public/data/`.
- New parsing behaviour needs a test. **New gates must be proven to FAIL on the
  exact fault they claim to catch** — see the ragged-snapshot and zero-price
  tests in `tests/parse.test.ts` for the convention. A gate measured somewhere
  other than where the failure lives is worse than no gate at all.
- Every first-party source file carries an SPDX header.
- Charts are hand-rolled SVG on purpose. Please do not add a charting library.
- Please do not add analytics, trackers, or third-party fonts.
- Prices are volume-weighted and exclude zero-consideration transfers. If you
  change either of those rules, every number on the site moves — say so loudly.
