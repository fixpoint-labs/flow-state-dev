# Goal: a mixed-asset statement imports complete, typed, and valued

**Contract.** A brokerage statement that is mostly NOT equities — bonds, a
money-market fund, cash, a crypto pair — must import as a complete book of typed,
valued holdings, not collapse to a small equity sliver. Before FIX-773 the
importer DROPPED CUSIP-identified bonds, money-market funds, and cash at the door,
so a 50%-bonds book imported as a handful of stocks plus a cash number. After
FIX-773 every row is preserved with an `asset_class` + `asset_type`, and NAV
includes the bond + money-market mass.

**Real path.** This path has no model — the import is deterministic TS
(`parsePortfolioCsv` → `classifyInstrument`) persisted through the `app.holdings`
repository over an embedded PGlite (the real dev DB engine), then valued by
`buildPortfolioContext`. The check runs the REAL production code — not mocks — by
executing, by hand and outside the default lane, the specs that pin the contract:
`holdings-taxonomy-repository` (typed bond/option/cash round-trip over real
PGlite), `build-portfolio-context` (mixed-book NAV includes the non-equity mass),
`classify-instrument` (the per-row classification table), and `portfolio-pdf` (the
`assetType` + `markPrice` survive the PDF→CSV import round-trip).

**Pass criterion.** All four real-path specs pass: a bond CUSIP / money-market
fund / crypto pair persist as typed holdings (none dropped); the bond's carried
statement mark survives the import round-trip; and `totalNav` sums the equity
(quote) + bond (mark) + money-market (par) + crypto (quote) values rather than
only the equity + crypto.

**Anti-game.** The build-context spec includes an UNPRICED bond that must
contribute `null` (never a fabricated value) to keep NAV honest — so "includes
the bond mass" can't be faked by valuing what can't be valued.

**Model.** none — the import + valuation are deterministic TS over real PGlite; no LLM is in this path.

**Run.** Out of CI, by hand (no model cost):

```
pnpm tsx goals/trading-desk-portfolio/multi-asset-import/run.mts
```

## Verdict log

- 2026-06-29 — **PASS**. Full trading-desk suite green (868) including the four
  real-path specs; a manually-driven mixed book (AAPL equity + a Treasury CUSIP
  bond at 98.5 + a 5000-unit money-market fund at par + 0.5 BTC) persisted 4/4
  typed holdings and valued NAV at $39,970, including the $6,970 bond +
  money-market mass the old importer discarded.

- 2026-07-25 — **PASS** (none). 4 real-path spec files, 83 tests, green over real PGlite. Run during the goals/lib migration (runner scaffolding only; no product code changed).
