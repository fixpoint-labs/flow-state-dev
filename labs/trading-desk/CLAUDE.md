# Trading Desk — Agent Guide

The trading-desk is a multi-agent app (package `@flow-state-dev/trading-desk`)
that produces a structured trade recommendation for a given ticker. It's a real
app — live market data, durable re-openable reports, a real imported portfolio —
built on **two purpose-named flows** (`analysis` for the research pipeline,
`portfolio` for PDF extract / theses / mandate) plus **`domain/portfolio/`**
for shared money math, parsers, and write services behind REST. The package and
app stay "trading-desk"; only the flows are renamed to reflect what they do.
It lives in `labs/`, not `examples/`: past a teaching snippet, still research
software.

The pipeline is organized by **identity, not phase**: participants live under
`agents/` (one directory per analyst group / trader / risk / PM / etc.), the
tool catalog lives under `tools/`, and the only code that knows execution order
lives under `orchestration/`. "Phase" survives as render-time labels
(`component: "phase-*"`), not as code structure.

When modifying this app, follow the conventions below. The patterns here
are also written up in the project-level docs — read those first if you
haven't:

- [`docs/contributing/best-practices.md`](../../docs/contributing/best-practices.md) — hard rules (BP-001–BP-039): universal rules + the situational index live here; per-category situational rule text lives in [`docs/contributing/best-practices/`](../../docs/contributing/best-practices/) (e.g. `generators.md`, `resources.md`)
- [`docs/contributing/building-apps.md`](../../docs/contributing/building-apps.md) — patterns and tradeoffs
- [`docs/architecture/capabilities.md`](../../docs/architecture/capabilities.md) — capability model

## Layout

The app has **two flows** under `flows/`, plus a **`domain/portfolio/`** package for shared portfolio logic (schemas, parsers, math, write services). Routes and the analysis seed import from domain; the portfolio flow keeps only flow-shaped work.

- **`analysis/`** — the research pipeline (the five-phase analyst→researcher→trader→risk→PM sequence). Previously named `trading-desk`.
- **`portfolio/`** — flow-shaped portfolio work only: PDF extract, theses, mandate. Account/holdings/ledger CRUD and quote refresh live in REST + domain services.

The analysis flow's tree is grouped by **identity** (`agents/`), **catalog** (`tools/`), and **composition** (`orchestration/`). The flow contract stays at the root.

```
lib/                           Shared backend utilities and application services
  cache.ts                      process-wide TTL + in-flight request deduping
  concurrency.ts                mapLimit + sleep for bounded provider fan-out
  portfolio-market-data.ts      live portfolio quote/kind policy over providers
  providers/                    Shared external API clients — stateless, throw on failure
    types.ts                    Provider-owned request + normalized data contracts
    finnhub.ts                  Finnhub fetch helpers (incl. institutional ownership)
    fred.ts                     FRED per-series fetch + retry (macro indicators + NFCI)
    yahoo.ts                    Yahoo Finance fetch helpers (quoteSummary + fundamentals-timeseries)
    yahoo-timeseries.ts         pure mapper: fundamentals-timeseries → 3 statements
    edgar.ts                    SEC EDGAR client (ticker→CIK lookup + companyfacts fetch)
    edgar-filings.ts            EDGAR filings: submissions list, section extraction, red-flag probes
    edgar-companyfacts.ts       pure mapper: us-gaap companyfacts → 3 statements
    eight-k-items.ts            pure mapper: 8-K item codes → typed material events with signal tier
    web.ts                      homepage meta + web-search fallback
    xai.ts                      Grok (xAI) credentials + model id
    massive.ts                  Massive.com client — options-chain snapshot + futures front/next

flows/analysis/
  flow.ts                        flow definition — defineFlow only (actions, resources, session state)
  state.ts                       sessionStateSchema (ticker, date, costPreset, dataSource, ...)
  flow-schema.ts                 analyzeInputSchema (the required caller input)
  analyze-input.ts               the analyze action input adapter
  registry.ts                    AGENTS map + per-phase memo key registries (was agents.ts — still hand-rolled)
  resources.ts                   memosCollection + thesisSection + phase2Contributions
  report-index.ts                Past Reports: browser-safe metadata schemas + parseReportRow + relativeTime
  decision-snapshot-resource.ts  durable, machine-scoreable decision-of-record (session-scoped, PM-commit)
  price-history-resource.ts      thinned { date, close } series + provenance (surface-owned)
  valuation-spine-resource.ts    the shared valuation spine (surface-owned)
  special-instructions*.ts       per-run special-instructions resource + helpers
  compute-spine.ts               .tap that computes + stores the valuation spine
  store-price-history.ts         .tap that persists the thinned price series
  capability.ts                  the tradingDesk capability — single import for every generator
  build-portfolio-context.ts     pure leaf: builds the portfolio snapshot from accounts + quotes
  prompts/_partials/             shared prompt fragments ({% render %} targets); the loader anchors
                                 PARTIALS_DIR here, so this stays at the flow root (not per-agent)

  agents/                        participants grouped by identity; each module exports its BUNDLED step
    _recipe/                     shared per-group factories
      define-analyst.ts          defineAnalyst — thin wrapper over defineMemoStep (composes the body, delegates the lifecycle)
      approach-generator.ts      createApproachGenerator — fast-model approach preamble (was lib/)
      memo-writer.ts             defineMemoStep + key-driven markWriting / markError + publishMemo (the ONE memo lifecycle)
      memo-setup.ts              defineMemoSetup — pre-create memo scaffolds per group (was lib/)
    analysts/                    the nine analysts (was phase-1/)
      analysts.ts                the analyst sub-sequencers (each ~10 lines via defineAnalyst)
      thesis-schema.ts           Thesis output shape (shared by every analyst generator + writer)
      setup.ts                   setupPhase1Memos (defineMemoSetup)
      writer.ts                  commitAnalystMemo (commit projection only; the lifecycle lives in defineMemoStep)
      prompts/                   per-analyst *.prompt.md system prompts
    research/                    bull / bear / research manager (was phase-2/)
      generators.ts round-robin.ts validate-citations.ts writer.ts setup.ts prompts.ts
      prompts/                   bull/bear/manager *.prompt.md
      tools/find_counter_evidence.ts  FLOW-COUPLED tool (imports memo keys — NOT in the catalog)
    lenses/                      the lens pack (was phase-2b/ + lens-owned lib + resource)
      lens-generator.ts lens-verdict-schema.ts lens-body-sections.ts writer.ts setup.ts
      lenses.ts                  LENS_PACK config (was lib/lenses.ts)
      convergence-math.ts        pure convergence math (was lib/convergence-math.ts)
      lens-convergence-resource.ts  the lens-owned convergence resource (§2.4)
      prompts/                   lens.prompt.md
    trader/                      trader.ts approach.ts writer.ts setup.ts prompts/ (was phase-3/; owns its output schema)
    risk/                        personas.ts (3) consolidator.ts schemas.ts approach.ts writer.ts setup.ts prompts/ (was phase-4/)
    scenario-forecaster/         scenario-forecaster.ts approach.ts writer.ts setup.ts prompts/ (was phase-5/)
    portfolio-manager/           portfolio-manager.ts approach.ts writer.ts setup.ts prompts/ (was phase-5/; owns its output schema)
    thesis-validator/            thesis-validator.ts approach.ts writer.ts setup.ts prompts/ (was phase-6/)

  tools/                         analysis handlers + schemas + runtime
    data/                        one file per data tool — get_*.ts + discover_*_context.ts (mode branch + provider chain)
    schemas.ts                   shared zod schemas + ToolName / ToolInput / ToolOutput
    empty-payloads.ts            schema-valid zeros for "unavailable" results
    indicators-math.ts           pure RSI/MACD/ATR/SMA functions
    index.ts                     barrel re-export
    runtime/                     tool runtime (was lib/)
      fixtures.ts                loadFixture(tool, args)
      recorder.ts                recordFixture — stable-serialize + write to corpus
      resolve.ts                 resolveToolPayload — single dispatch for fixture/live/record
      discover.ts                web-search → DiscoveryPayload shape
  orchestration/                 composition only — the ONLY code that knows execution order
    analyze.ts                   the analyze sequence + guard wiring (was flow.ts's analyzePipeline body)
    stages.ts                    per-group setup taps + fan-out / round-robin / chain assembly (was every phase-*/index.ts)
    guards.ts                    seedSession, checkTickerResolvable, checkPhase1HasData/FundamentalsAndProfile, setInstructions

  lib/                           pure IO-free utilities — neither tool-runtime nor recipe
    helpers.ts                   tickerDate / asDataBlock / memoLabel / attributedTools
    format.ts                    shared prompt formatters (memo, debate, contributions)
    app-root.ts                  APP_ROOT — package root resolved once (module-relative, cwd fallback)
    prompt.ts                    loadPrompt(path) — resolves *.prompt.md relative to the flow root
    ticker-resolver.ts           pre-flight ticker probe
    valuation.ts valuation-spine.ts fair-value.ts expected-return.ts
    rating-engine.ts setup-score.ts sector-resolution.ts   (analysis / scoring math)

domain/portfolio/               Shared portfolio domain (Spine B) — imported by REST, UI, analysis seed
  schema/                        Browser-safe zod leaves: portfolio, ledger, tax, thesis, mandate,
                                   transaction-import
  parsers/                       CSV / OFX / PDF reconcile + transaction-file dispatcher
  math/                          Pure leaves: lots, value-holding, health, tax-estimate, holding-period,
                                   realized-gains, classify-instrument
  services/                      portfolio-writes + get-quotes + reconcile-fund-classification
                                   (plain functions; market-data dependencies are injected)
flows/portfolio/                Flow-shaped portfolio work only (not domain CRUD)
  flow.ts                        defineFlow — extractHoldingsFromPdf + saveThesis/deleteThesis +
                                   save/clearPortfolioMandate (CRUD + quote refresh are REST)
  state.ts                       sessionStateSchema (minimal; this flow has no run state)
  portfolio-resources.ts         BP-019 leaf: pdfImportResource + thesesCollection + portfolioMandate
                                   Accounts/holdings/prices live in app.* tables (see db/)
  thesis-actions.ts              saveThesis / deleteThesis (reactive cross-flow resource writes)
  portfolio-mandate-actions.ts   savePortfolioMandate / clearPortfolioMandate
  extract-pdf-text.server.ts     NODE-ONLY: unpdf — PDF bytes → statement text
  extract-holdings-generator.ts  broker-agnostic LLM transcription (statement text → strict rows)
  extract-holdings-action.ts     sequencer: decode bytes → extractPdfText → generator → commit pdfImport

fixtures/<TICKER>/<DATE>/        date-addressed snapshots for fixture mode (`FIXTURE_SNAPSHOT` is the default date)
db/                             App-owned relational layer (FIX-772) — accounts + holdings + prices, NOT a resource
  schema.ts                      Drizzle `app` Postgres schema: accounts + holdings + ledger + realized-gains
                                   + tax-profiles + quotes (last-known price, FIX-823) tables
  client.ts                      createDb (node-postgres, deploy) + createMigratedPgliteDb (embedded dev)
  repository.ts                  createPortfolioRepository + toAccountStates — the typed data-access surface
  portfolio-db.ts                getBacking() (PGlite dev / shared pg.Pool deploy) + getRepository() singleton
  migrations/                    drizzle-kit generated SQL + journal (run in-process on PGlite dev, via
                                 scripts/migrate.ts on deploy)
app/api/portfolio/              REST surface over domain services + repository — reads AND writes:
  accounts/route.ts               GET list · POST save · DELETE
  holdings/route.ts               DELETE one holding · holdings/import/route.ts POST (CSV import)
  ledger/route.ts                 GET list · POST record manual event
  transactions/import/route.ts    POST (OFX/QFX/QBO file import)
  income/route.ts                 GET ledger-derived dividends + interest
  quotes/route.ts                 GET last-known prices · quotes/refresh/route.ts POST (fetch live + upsert)

fixtures/<TICKER>/2026-05-06/    pinned snapshot for fixture mode
```

### Conventions enforced by this layout

- **A participant is found in one place.** Each agent group under `agents/`
  bundles its generators, its memo `setup.ts` + `writer.ts`, its output schema,
  and its `prompts/`. To read or edit the trader you open `agents/trader/`, not
  three scattered files.
- **Shared factories live in `agents/_recipe/`.** `defineMemoStep`,
  `defineMemoSetup`, `createApproachGenerator`, and `defineAnalyst` capture the
  shapes every group repeats. Each group's `setup.ts` and `writer.ts` is ≤ 15
  lines + the per-group commit projections.
- **Single-consumer output schemas live next to the generator that emits
  them.** `agents/trader/trader.ts` and `agents/portfolio-manager/portfolio-manager.ts`
  declare their output schemas inline; the writer imports the type back. Multi-
  consumer schemas (the analysts' `thesisOutputSchema`, risk's persona +
  risk-assessment schemas) stay in a `thesis-schema.ts` / `schemas.ts` file in
  the group.
- **`tools/` owns the analysis tool catalog and runtime.** `tools/data/` is one
  file per data tool and `tools/runtime/` is the fixture, recording, and
  discovery runtime. Shared external API clients live at `lib/providers/` (stateless,
  throw-on-failure, no caching — callers apply their own policy). A flow-coupled
  tool (one that imports flow internals, like
  `find_counter_evidence`) stays with its consumer under `agents/`, NOT in the
  catalog.
- **`orchestration/` is the only code that knows execution order.** `stages.ts`
  assembles each group's setup tap + step into a stage; `analyze.ts` chains the
  stages behind the guards; `flow.ts` is `defineFlow` only. Import direction is
  one-way: orchestration imports agents; agents never import orchestration
  (BP-019 — acyclic).
- **`lib/` is for pure IO-free utilities that are neither tool-runtime nor a
  recipe** — formatters, the ticker resolver, and the valuation /
  scoring math. Identity lives in `registry.ts`; contract lives in
  `resources.ts` / `state.ts` / `flow-schema.ts`.
- **`lib/` is the shared backend layer.** Generic cache/concurrency helpers
  and provider-composition services live here so REST routes, scripts, domains,
  and flows can reuse them without importing through a flow.
- **Portfolio domain vs portfolio flow.** Money math, parsers, schemas used by
  routes/UI/analysis, and write/quote services live under `domain/portfolio/`.
  `flows/portfolio/` keeps only `defineFlow`, resources, thesis/mandate
  actions, and the PDF extract pipeline. If a module has no `ctx.resources` /
  generator / `defineFlow` dependency, it belongs in domain. Shared vendor
  clients live under `lib/providers/`; portfolio-specific live quote, cache,
  retry, and fallback policy lives in `lib/portfolio-market-data.ts` and is
  injected into the domain services. Analysis fixtures remain flow-owned and
  never enter the portfolio quote-refresh path.

## Past Reports

The app lists prior runs in a **Past Reports** view (TopBar nav toggle →
`components/reports/`). There is **no separate reports store**: the index *is*
the session list. Each run is one persisted session, and `listSessions` already
returns its `metadata` bag. Two seams make a run a durable, re-openable record:

- **`report-index.ts`** (browser-safe; zod + types only) — the metadata
  projection. At PM-commit the writer **additively merges** `decision` +
  `reportStatus: "complete"` into session metadata (shallow-merge, so the four
  tuple keys `ticker/date/costPreset/dataSource` that `findSessionForTuple`
  matches on are preserved). `parseReportRow(summary)` turns a `SessionSummary`
  into a render-ready row, degrading gracefully on legacy / in-progress /
  malformed metadata (never throws). `reportRowTuple` / `relativeTime` are pure
  helpers used by the list.
- **`decision-snapshot-resource.ts`** — the full, machine-scoreable
  decision-of-record (session-scoped, written once at PM-commit via
  `patchState`). Separate from the metadata row (the cheap list projection) and
  the memo (the human-rendered thesis). It records the **post-clamp**
  `finalRating`; `entryPrice`/outcome fields are reserved `null` for a future
  outcome-tracking feature.

**Re-opening a report runs zero models.** The Past Reports view switcher lives
in `app/page.tsx` (`view: "desk" | "reports"`, with `"portfolio"` reserved on
`TradingDeskView` for a later slice). Opening a row sets the four header inputs
to the row's tuple **before** `selectSession`, so the tuple-sync effect resolves
back to the opened session and never re-dispatches or mis-keys the run. The
stored report rehydrates through the existing `useSession` + `ThesesPane` read
path. Persistence is Postgres-shaped (FIX-772): embedded PGlite in dev (persisted
under `.fsdev/pglite`, survives restarts) and real Postgres via `DATABASE_URL` in
deployment. The store backing is wired in `db/portfolio-db.ts` / `lib/server.ts`.

## Summary view

Each report has a **Theses | Summary** tab toggle inside `ThesesPane`. The
**Summary** tab (`components/summary/`) is an at-a-glance aggregate of a finished
report, built **entirely from already-stored session state — zero re-run, zero
model spend.** A finished report (not streaming, items present) auto-opens on
Summary; a streaming run stays on Theses; a manual tab pick or sidebar selection
sticks (ref-guarded, mirroring the auto-follow idiom).

- **`components/summary/aggregate.ts`** is the one place null-handling and the
  stance→conviction-axis mapping live. `buildReportSummary(memosByKey, spine)` is
  a **pure** function (UI-layer only — not a generator output, BP-016 does not
  apply) mapping `Map<shortName, MemoState | null>` + the valuation spine to a
  `ReportSummary` view model. Every field traces to a named stored field; absent
  inputs collapse to `null` so the components stay dumb. Unit-tested in
  `test/report-summary-aggregate.spec.ts` (the stance→axis mapping is the
  intent-encoding test).
- The view reads `useResourceCollectionList(session, "memos", { limit: 50 })`
  (all ~20 memos in one page), `useResource(session, "valuationSpine")`,
  `useResource(session, "priceHistory")`, and the stop fields via `useClientData`.
  Each `item.topic` (bare collection key) is reverse-mapped to a short name. The
  aggregate is built in `useMemo` (BP-010), not an effect.
- **Charts are inline SVG / CSS bars — no chart library** (`charts/bar-group`,
  `charts/scenario-strip`, `charts/price-overlay`). A chart never renders against
  missing data; it shows a `ChartEmpty` gap note. The price overlay draws the
  stored `priceHistory` close series with stop/target/fair-value/close overlay
  lines; with `< 2` bars or a `source: "unavailable"` slice it falls back to a
  trade-levels list.
- **Price-history persistence:** `price-history-resource.ts` (leaf, BP-019) +
  `store-price-history.ts` (a `.tap()` after the spine tap in `flow.ts`). The tap
  reads the warm tool cache / fixture the technical analyst already populated — no
  extra fetch, no `block.run()` — and persists a thinned `{ date, close }` series
  + provenance `source`. On any miss it leaves the resource null and the chart
  degrades. Tested in `test/store-price-history.spec.ts`.
- **Real-money gates:** no fabricated numbers, `dataQuality` chips for
  provenance, missing metrics shown as `—`/gap (never invented), a stopped run
  shows only its stop banner, the `StatusBar` not-advice disclaimer stays visible.
  `sizePct` is labeled "% of NAV" (the trader's proposal), never a dollar amount.
- **Portfolio-fit + lens blocks (Slice 6):** the Summary renders a portfolio-fit
  weight before/after block (current → target weight + Δ, action chip, validated
  suggested account, snapshot-as-of) and a lens-convergence card, both read
  straight from the PM memo's `portfolioFit` / `lensConvergence` mirrors with no
  recompute, and both omitted cleanly when their field is null (a portfolio-blind
  run, or a `fast`-preset run that skipped the lens pack). The lens read is a
  dedicated card (not extra `ConvictionStrip` dots) so the per-lens dataGap,
  dissenters, and robustness framing survive. Phase 6 `alignment` is labeled
  **"Thesis alignment"**, never "portfolio fit".

## Portfolio view

The app has a **Portfolio** view (TopBar nav → `components/portfolio/`) backed by
the `portfolio` flow (`flows/portfolio/`). It is the durable record of what
the user owns; it does NOT do portfolio-aware analysis or sizing (a later slice).
The pane is section-switched (FIX-885): a sidebar (`portfolio-section-nav.tsx` —
desktop left rail / mobile segmented strip) picks between the **Accounts**
perspective (an `AccountsActionsBar` — add account / an `ImportMenu` grouping the
three imports / add transaction / backfill splits — above the card grid →
`AccountDetail`) and the **Gains & Taxes** perspective (`gains-taxes-section.tsx`
— the tax-estimate card + `RealizedYearCards`: household by-year cards you drill
into, toggling between capital gains and total realized income = gains +
dividends + interest, off the pure `realized-income-by-year.ts` model). Only
refresh-prices + totals + provenance stay on the pinned toolbar; account actions
live in the Accounts perspective. The third perspective is the **Health**
perspective (FIX-762, `health-section.tsx`) — the deterministic household view:
ticker-merged exposure, asset-class + sector breakdowns, concentration reads
(largest name, top-N, effective positions = 1/HHI) with warn/alert flags, cash
level, and coverage. It computes client-side from the pure aggregation leaf
`domain/portfolio/math/portfolio-health.ts` (`summarizePortfolioHealth`, reusing
`value-holding` + the `inconsistent_history` gate — one copy of the money math),
self-contained like `GainsTaxesSection`. The one axis with no on-holding data —
sector — is backed by a new global `app.instrument_classifications` table
(ticker PK, no TTL, lazy Yahoo `resolveSector` fill via
`app/api/portfolio/classifications/route.ts` + `use-classifications.ts`; failures
returned but never persisted, retried later). The same leaf runs server-side at
`seedSession` to inject a compact `health` block into the trader/PM
`<portfolioContext>` (`build-portfolio-context.ts` → `format.ts`), and it gives
the long-dead `holdings[].sector` field its first producer. Funds (ETF / mutual
fund) are honestly opaque — `lookThrough: "none"`, exempt from single-name flags,
bucketed as "Funds (no look-through)"; ETF look-through is FIX-801. Drift-vs-
target and standing-constraint compliance (`computeAllocationDrift`) is the
FIX-761-gated follow-up slice — the `health.drift` context field and the
allocation view's target overlay stay empty until the durable mandate lands.

- **Data model — app-owned relational tables (FIX-772).** Accounts and holdings
  are NO LONGER an FSD resource. They live in real Postgres tables in a dedicated
  `app` schema: `app.accounts` (PK `id` = the old `accountId`, `user_id` is the
  household key) and `app.holdings` (one row per `(account_id, ticker)`, FK to
  accounts with `ON DELETE CASCADE`, `holdings_ticker_idx` for the cross-account
  rollup). They are reached through the typed **portfolio repository**
  (`db/repository.ts`, `getRepository()` from `db/portfolio-db.ts`). The same
  ticker in two accounts is two rows — exactly the cross-account query shape the
  household / sleeves / review-loop work needs. The store backing is Postgres in
  both dev (embedded PGlite at `.fsdev/pglite`, no Docker) and deployment (real
  Postgres via `DATABASE_URL`), shared with the framework store on one pool/
  instance; `db/portfolio-db.ts` owns that backing. See the FIX-772 spec and the
  `db/` layer (`schema.ts`, `client.ts`, `repository.ts`, `migrations/`).
  **FIX-773 extended each holding row** with a two-level asset taxonomy:
  `asset_class` (one of `equity / fixed_income / cash / crypto / alternative`)
  and `asset_type` (one of `equity / etf / mutual_fund / bond / money_market /
  crypto / option / other`), plus a discriminated `attributes` jsonb column that
  carries per-type fields — bond: `cusip` + carried `markPrice`; option:
  `underlying / strike / expiry / right / multiplier` + `markPrice`;
  cash_equivalent: no extra fields. `markPrice` is the carried per-UNIT statement
  value (statement `value ÷ quantity`, a finite positive number; a negative/zero
  OCR typo is rejected to null), NOT a raw quoted price — so `quantity × markPrice`
  reconstructs the position value regardless of quoting convention. Speculative
  fields with no producer and no consumer (`coupon / maturity / yield`) are cut
  per BP-038; JSONB means adding them later (with a real producer) is free.
  Classification is denormalized per holding row; a security-master table is a
  deferred option, not built. The classifier lives in
  `domain/portfolio/math/classify-instrument.ts`.
- **Domain types vs persistence.** `accountStateSchema` / `holdingSchema`
  (`portfolio-schema.ts`) are now DOMAIN types — input/CSV validation and the
  inline-holdings `AccountState` shape the repository projects (`toAccountStates`)
  for the seed + UI. The Drizzle tables (`db/schema.ts`) are the persistence.
  These zod schemas are NOT generator outputs, so `.default()` / `.nullable()`
  are fine (BP-016 only constrains generator outputs) — do NOT add them to
  `output-schemas-strict.spec.ts`. Cost basis is **average cost (informational)**
  on the holdings snapshot; **realized gains** are now derived and persisted
  per-lot (FIX-874, see below) and **dividends/interest** are aggregated from the
  ledger (FIX-774). Specific-lot tax-lots and wash-sale math remain deferred.
- **CSV import** (`portfolio-csv.ts`) is a PURE, browser-safe parser: a synonym
  table maps real brokerage headers, bad rows are REPORTED (with 1-based row
  numbers) never thrown, duplicate tickers merge to a quantity-weighted average
  cost, a bare `price` column maps to cost basis with a warning. The dialog runs
  it client-side for the live preview; the `importHoldings` action re-parses
  server-side (never trusts the client) and returns an `ImportReport`. Default
  mode is `upsert` (non-destructive); `replace-account` is destructive, non-atomic
  (RISK-P6), and requires a typed `REPLACE` confirmation. FIX-773 added two
  optional columns: `assetType` (synonyms: `assettype`, `type` — NOT `assetclass`,
  which is a class-level column whose values aren't valid instrument types) — a
  per-row classification hint; absent or unrecognized values are inferred from
  the symbol shape server-side — and `markPrice` (the carried statement mark the
  PDF round-trip uses for bond and option rows). Non-equity rows (bond CUSIPs,
  crypto pairs, and OCC option symbols — which the equity ticker regex rejects but
  the importer now accepts) import as typed holdings rather than being rejected. See
  `docs/portfolio-csv-format.md`.
- **PDF import** uploads the PDF BYTES and extracts the text SERVER-SIDE. The
  dialog (`import-pdf-dialog.tsx`) base64-encodes the file and dispatches
  `extractHoldingsFromPdf`; the action's first step decodes the bytes and calls
  `extract-pdf-text.server.ts`, which extracts with **`unpdf`** (a worker-free,
  serverless pdfjs build) on the Node main thread. There is **no browser pdfjs
  worker and no `/public` build step** — the old client extractor needed a web
  worker whose URL turbopack resolved unreliably (the import hung), and a direct
  `pdfjs-dist` server path then tripped over its "fake worker" chunk under
  turbopack. unpdf has no worker at all (and is kept out of the server bundle via
  `serverExternalPackages` in `next.config.mjs`). Uploading the bytes is no new
  privacy exposure:
  the extracted holdings already go to the server + the LLM. After extraction the
  LLM transcribes the text (`extract-holdings-generator`) into strict rows on the
  session-scoped `pdfImport` resource; the dialog reads them via `useResource`,
  runs the pure `reconcile()` for review, and the CONFIRM path serializes to CSV
  through the EXISTING `importHoldings` (same as the CSV path). Streaming the
  extraction progress to the dialog is a documented follow-up — the phase UX is
  currently a static "extracting" state. FIX-773 replaced the old per-row drop
  heuristic with a full CLASSIFIER (`classify-instrument.ts`): CUSIP-shaped tickers
  → bond, `$1.00 XX`-style lines → money_market, `CASH` lines → cash_equivalent,
  OCC option symbols → option. Rows are skipped only for no ticker, null/zero
  quantity, or a symbol the CSV import transport can't carry (spaces / >12 chars /
  special characters — `isImportableSymbol`, the shared gate the CSV parser and the
  PDF `classifyRow` both use, so review and commit agree); nothing is dropped by
  asset type. A bond/option mark is persisted only from `value ÷ quantity` — never
  the raw price column — so a value-less bond/option row carries a null mark (shows
  "—") rather than valuing NAV off by a quoting-convention factor.
  The canonical CSV the CONFIRM path serializes now carries `assetType` and
  `markPrice` columns so the classification and the bond's statement mark survive
  the single import gate into `importHoldings`.
- **Prices** come from `refreshQuotes` — a server helper that reuses
  `get_price_history`'s fetch idiom directly (`loadFixture` / `getOrFetch`, NOT
  `block.run()` — BP-011-safe) and takes the last bar's `close`. A missing /
  unavailable price degrades to `null` (UI shows `—`), never a fabricated number;
  the refresh path never reads analysis fixtures. **`refreshQuotes` persists live,
  non-null-priced quotes to the durable, ticker-keyed `app.quotes` table (FIX-823 —
  `price`, `as_of`, `source`, `fetched_at`, one GLOBAL row per ticker), via
  `repo.upsertQuotes`.** Null-priced quotes are dropped (a provider miss keeps the
  prior last-known row). Market value stays
  DERIVED (`quantity × price`) — never persisted onto the holding, so it can't go
  stale on a trade when the price didn't move. **The refresh is a plain REST route,
  NOT a flow action:** the pane `POST`s `/api/portfolio/quotes/refresh` (which
  derives + filters the held ticker set server-side, then fetches + upserts) and,
  once that awaited write resolves, refetches `GET /api/portfolio/quotes` via the
  `use-quotes.ts` hook — the same `await REST write → refetch` idiom the import
  handlers use, mirroring the `backfillSplits` route. This replaced the original
  `getQuotes` flow action, whose `sendAction` resolved at stream-attach (before the
  upsert committed), forcing the pane to await the SSE stream's `isStreaming`
  falling edge to know the write had landed; the route settles only after the write,
  so there is no settle race and the refresh needs no bound session.
  **The pane always requests live prices, completely separate from the analysis
  fixture/live toggle.** The live fan-out is **bounded + retried** via the shared
  `lib/concurrency.ts` `mapLimit` (cap `QUOTE_CONCURRENCY`, per-ticker
  `QUOTE_RETRIES` with backoff) so a 20+ holding portfolio doesn't trip Yahoo's
  rate limiter and drop a random subset to `—`. **FIX-773 introduced per-type
  valuation** via `domain/portfolio/math/value-holding.ts` (`resolveHoldingPrice` /
  `holdingMarketValue`): equity / ETF / mutual-fund / crypto holdings use the live
  quote (`usesLiveQuote` gates the pane's quote fan-out to exactly these types);
  money market and cash-equivalent holdings value at par ($1.00/share); bond and
  option holdings use the carried per-unit statement mark (`attributes.markPrice`).
  Market value is uniformly `quantity × price` for every type — the mark is the
  per-unit statement value, so no contract multiplier or quoting-convention factor
  is re-applied (the multiplier is descriptive metadata only). Any row with no
  applicable price still degrades to `—` (real-money gate). The resolved price's
  provenance (`quote` / `statement` / `par`) is surfaced in the HoldingsTable as a
  marker + tooltip so a statement mark is never read as a live quote.
  `build-portfolio-context.ts` NAV now includes bond and money-market mass. The
  HoldingsTable shows a compact asset-type chip alongside each row, plus a per-
  holding `priceAsOf` (FIX-823) so a quote-sourced price labels its own staleness
  (par / statement / unavailable carry no as-of). Bonds use the carried statement
  mark in v1; durable last-known-price persistence across sessions is **FIX-823
  (done — `app.quotes`)**, and ETF look-through is FIX-801 (deferred).
- **Derived money math** (market value, weight %, unrealized P/L, rollups) lives
  in `components/portfolio/portfolio-format.ts` (pure) and is computed in
  `useMemo` (BP-010), never stored — it depends on a live quote and the whole-
  portfolio total. Money figures are labeled display approximations; a live +
  as-of provenance line sits near the totals.
- **Analysis is equity-gated (FIX-773).** The `checkAssetTypeSupported` guard in
  `orchestration/guards.ts` classifies the analyzed symbol via
  `classify-instrument.ts` (before ticker resolution, no provider call) and stops
  the run with `stoppedReason: "unsupported-asset-type"` ONLY on the unambiguously
  non-equity shapes — a bond CUSIP, an OCC option, a `…-USD` crypto pair. A
  ticker-shaped symbol passes to the resolver, including the cash-equivalent
  placeholders `CASH` / `USD` (themselves real tickers — Pathward, a ProShares
  ETF), so resolution is the arbiter for whether a real instrument exists. ETF and
  crypto analysis are tracked in FIX-777, which this unblocks (the crypto stop is
  lifted there).
- **Empty-state binding (spec §12.1):** user-scoped reads need a bound session
  snapshot. We take the honest empty-state CTA (option b), NOT auto-minting a junk
  session (option a) — the pane prompts the user to run an analysis first when no
  session exists. Once any session is bound, Add Account / Import work.

## Transaction ledger (FIX-774)

The desk records a typed, append-only **transaction ledger** — the realized-P/L
and dividend history the `accountLedgerSchema` "FUTURE SEAM" in
`portfolio-schema.ts` always promised. A *ledger event* is one row per cash or
share movement (a buy, sell, dividend, interest, deposit, withdrawal, transfer,
or fee). It is an app-owned table on the FIX-772 model layer, NOT a resource —
the same `app` Postgres schema as accounts/holdings, reached through the same
`getRepository()`.

- **The table — `app.ledger_events` (`db/schema.ts`).** Event-id PK,
  `account_id` FK with `ON DELETE CASCADE`, denormalized `user_id` for the
  household ownership guard and rollups. Money/quantity are `numeric` (exact in
  storage; the repository coerces to JS number at the read boundary, RISK-P5).
  `type`/`source` are plain `text` (the enum is enforced at the zod boundary in
  `ledger-schema.ts`), so a new event kind needs no enum-alter migration. A
  `voided_at` tombstone marks a correction (and, once FIX-853 lands, a Plaid
  cancellation) — derivation and rollups skip voided rows, but they are never
  physically deleted (audit trail).

- **One idempotent ingestion contract (`ingestLedgerEvents`).** Every writer maps
  to the source-agnostic `LedgerEventInput` (`ledger-schema.ts`) and ingests
  through this one repository method — manual entry today; FIX-775 (file import)
  and FIX-853 (Plaid sync) later, so they add no new ingestion path. In one
  transaction it ownership-guards every referenced account against `userId` (a
  foreign account throws and the batch rolls back), dedups, and recomputes basis.
  **Two-tier dedup:** a `(source, external_id)` partial unique index catches a
  same-source retry (manual rows leave `external_id` null), and an always-computed
  content `fingerprint` — `sha256(account|tradeDate|type|ticker|quantity|amount)`
  at a fixed numeric scale — catches a duplicate with no external id. The batch is
  also deduped in memory first, so two conflicting rows in one batch can't trip an
  intra-statement conflict and `inserted + deduplicated` always equals the input
  count. The fingerprint *recipe* is contract (changing the covered fields later
  is a data migration, so it is fixed now); the per-feed normalizers that map
  Plaid/OFX representations onto it land with FIX-775/FIX-853.

- **Positions are derived, not declared (`lots.ts`).** `deriveLots` is a PURE
  FIFO reduction over the non-voided events: share-adding events (driven by the
  SIGN of `quantity`, not the type label, so a buy, a reinvested dividend, and a
  transfer-in are uniform) push lots; sells/transfers-out consume them
  oldest-first. `materializePositions` runs inside the ingest/void transaction
  and MATERIALIZES the derived positions into the holdings table — **the ledger
  is the authority wherever it has share history**: a derived open position is
  UPSERTED (quantity, weighted average cost → `holdings.costBasis`, earliest
  open-lot date → `holdings.acquiredDate` — a snapshot row disagreeing with real
  trade history is overwritten), a fully-closed position's row is DELETED (the
  Portfolio view shows active holdings only; history and income stay in the
  ledger), a ticker whose share history is entirely voided keeps its row with
  basis cleared (a correction returns it to snapshot authority), and a
  CSV/PDF-snapshot-only ticker (no ledger share history) is untouched. So a
  transaction-file import alone produces a visible portfolio — no snapshot
  needed. A transfer-in with no acquisition record is a **basis-unknown** lot:
  it writes `null` cost, never zero (zero-fill would massively overstate gains).
  FIFO is the IRS default; specific-lot sales, wash sales, and corporate-action
  basis allocation are deferred.

- **Income is aggregated from the ledger at read time (`getIncomeSummary`).**
  Dividends + interest per `(account, ticker)`, summing non-voided events (FIX-874
  adds a year-dimensioned `getIncomeSummaryByYear` alongside it) —
  deliberately NOT a holdings column, because income survives a position closing
  (the holdings row is deleted; the dividends were still earned). Ticker-less
  rows are account-level income (interest, MMF sweeps). Read via
  `GET /api/portfolio/income` (the `ledger` route precedent); the Portfolio UI
  shows a Dividends column on active holdings ("—" when no history — never $0
  asserted from ignorance) and a per-account Income tab that includes closed
  positions (tagged `closed`). The Portfolio view's Accounts perspective is an
  account summary-card grid (value, cash, uP/L as $ and %, position count);
  clicking a card opens `AccountDetail` with Holdings / Transactions / Income /
  Realized Gains tabs — there is no flat all-accounts table layout anymore.

- **Holding-period term is classified PER LOT
  (`components/portfolio/holding-term.ts`).** The Holdings Term column reads
  "Long", "Short · N mo to long", or an honest mixed "xL / yS · N mo" split — a
  position bought across dates is never labeled by its earliest lot alone. The
  long boundary is the IRS rule (held MORE than one year; the anniversary day
  itself is still short), and the countdown is calendar months until the LAST
  short lot turns long. Lots derive client-side from the already-fetched ledger
  via `deriveLots` (a pure leaf — no extra route); a CSV-snapshot-only holding
  falls back to its declared `acquiredDate` as one pseudo-lot, and undated
  shares render "—" / "N undated" — never guessed into a term.

- **Manual entry (`recordManualEvent`).** The user-driven writer. The request
  omits `source`/`external_id`; the function fixes `source: "manual"` (a manual row
  can't claim to be a Plaid/file row) and ingests through the same contract. This
  is the path for a transfer-in basis hole — set `basisUnknown` and the derived
  lot is flagged. The UI both reads (`GET /api/portfolio/ledger`) and writes
  (`POST /api/portfolio/ledger`) the ledger through plain REST routes — accounts/
  holdings/ledger are basic CRUD, so they're routes over the repository, not flow
  actions (FIX-736 follow-up; see `portfolio-writes.ts`). The transactions pane +
  add-transaction dialog live in `components/portfolio/`.

- **Limitations (v1).** FIFO only; no wash sales or corporate-action basis math;
  single-currency. Non-equity events (bonds/options/MMF) are recorded with their
  symbol; the holdings table now carries a full asset-type classification (FIX-773),
  but the ledger event rows themselves are not asset-classified — per-event type
  inference is a separate, deferred concern. Analysis is equity-gated (see above).
  Two manual events with an identical fingerprint (same account/date/type/ticker/
  quantity/amount) dedup to one — the same dedup that makes re-submits idempotent
  also collapses a genuine identical second fill, so record a distinguishing detail
  if both must land. Live sync (Plaid) is FIX-853, and historical file import
  (OFX/CSV) is FIX-775 — both write through this issue's `ingestLedgerEvents`
  contract.

## File import (OFX/QFX/QBO) — FIX-775

Imports a brokerage transaction-history file to bootstrap the ledger from real
trades, so basis is reconstructed (FIX-774 derivation) instead of declared. The
first *second source* through FIX-774's `ingestLedgerEvents` contract: it adds a
normalizer, not a new ingestion path. One parser covers the whole OFX family
(QFX/QBO/raw OFX, 1.x SGML and 2.x XML — `ofx-js` auto-detects).

Files: `portfolio-ofx.ts` (pure browser-safe parser — runs in both the dialog
preview and the server route), `transaction-file.ts` (format dispatcher),
`importTransactionFile` in `portfolio-writes.ts` behind `POST
/api/portfolio/transactions/import` (re-parses server-side, injects `accountId`
+ `source: "file"`, returns a `FileImportReport`), `ImportTransactionsDialog`. Format grammar, the aggregate→canonical mapping, and
the v1 limitations live in [`docs/transaction-import-formats.md`](docs/transaction-import-formats.md);
the real-file goal check is `goals/transaction-file-import/reconstructs-basis-from-ofx/`.

Two load-bearing decisions:

- **Signs normalize by aggregate TYPE, not the file's convention** (buy
  `+qty`/`−amount`, sell `−qty`/`+amount`). This is what makes cross-source dedup
  work — a file backfill and a Plaid sync of the same trade hit the same FIX-774
  fingerprint.
- **Honest over silently-wrong.** Anything FIFO can't model is surfaced, never
  fed to the lot math: the corporate actions it still can't model (`RETOFCAP`,
  `CLOSUREOPT`) and short opens → `skipped`/warned, CUSIP-only securities →
  `unresolvedSecurities`, malformed rows (no date, no amount, blank FITID) →
  skipped. Stock splits are the exception — they are now ingested (see below).
  The parser never fabricates a value to make a row land.

### Tax-lot CSV (FIX-895)

The second format on this path: brokerage **tax-lot CSVs** (an *unrealized*
open-lots file and a *realized* closed-lots file), sniffed after OFX fails
(`portfolio-tax-lot-csv.ts` → `detectTaxLotCsv` / `parseTaxLotCsv`). Unrealized
rows become `buy`s; realized rows become linked `buy`+`sell` pairs that reproduce
the exact disposal the broker reported. The load-bearing extension is **lot
identity on the ledger**: a nullable `lotKey` on acquisitions and `closesLotKey`
on disposals (`ledger_events` columns + `LedgerEventInput`), so `deriveLots`
consumes the *specific* broker-matched lot instead of FIFO-guessing — FIFO stays
the fallback for feeds that carry no lot identity. A **one-source-per-ticker seam**
(`assertOneSourcePerTicker` in `db/repository.ts`) refuses mixing keyed and unkeyed
share history for a ticker in either order, so tax-lot imports go into a **fresh,
dedicated account**; a refusal renders as a normal `FileImportReport` (0 inserts +
guidance). Because the lot fields join `computeFingerprint` unconditionally, the
recipe is only safe on a cleared ledger — a **one-time fresh-start wipe** (`pnpm
db:clean` in dev, `pnpm ledger-reset` on deploy, gated by a `rollout_markers`
sentinel the deploy migrator checks) precedes it. The shared CSV primitives live
in `parsers/csv-utils.ts` (both parsers import them, acyclically). Full grammar in
[`docs/transaction-import-formats.md`](docs/transaction-import-formats.md).

## Stock splits / corporate actions (FIX-876)

Positions are FIFO-derived from the ledger, and the ledger now models **stock
splits** — the one corporate action naive FIFO can't ignore. Before this, a
split's pre-split trades (small share counts, big prices) and post-split trades
(10× shares, 1/10 price) lived in mismatched units, so FIFO over-sold the small
pre-split lots with the larger post-split sells, netted the position negative, and
`materializePositions` silently deleted the holdings row. NVDA's 10-for-1 split
(2024-06-10) did exactly this in `WF: Investing Accounts`.

- **A split is a first-class ledger event.** `ledgerEventTypeSchema` includes
  `"split"`; a `split` row carries no share delta or cash (`quantity: null`,
  `amount: 0`) — its ratio lives on a nullable `attributes` jsonb column as
  `{ numerator, denominator }` (10-for-1 → `{10, 1}`; reverse 1-for-10 →
  `{1, 10}`). `ledger-schema.ts` validates the boundary in `refineLedgerEvent`: a
  `split` requires valid attributes + a ticker + null quantity + zero amount;
  every other kind must leave `attributes` null. The fingerprint **excludes**
  numerator/denominator, so a manual split and a same-date file re-import dedup to
  one — the residual failure is only the cross-DATE case (record at the ex-date).

- **`deriveLots` rebases open lots (`lots.ts`).** A `split` is recognized by its
  `type`, not the sign of `quantity`. It multiplies the ticker's OPEN lots
  (`quantity × ratio`, `costPerShare ÷ ratio`) while **preserving each lot's
  acquisition date** (the IRS holding period is unchanged by a split). It sorts
  **before** same-day trades (a split is effective at the open, so same-day trades
  are already in post-split units — applying it after would double-adjust). Forward
  and reverse splits both flow through this one rule. `deriveLots` also returns an
  `oversold: Set<string>` — the post-rebase inconsistency signal a legitimately-
  split position never trips.

- **The inconsistent-position guard (`materializePositions`).** An acquired ticker
  that derives to no open position **and** is `oversold` (disposals exceed
  everything ever held — impossible without an unaccounted corporate action) is
  **never silently deleted**. It materializes a **flagged** row (`quantity: 0`,
  basis cleared, `dataQuality: "inconsistent_history"`) surfaced in `HoldingsTable`
  + the mobile card with a ⚠ marker. A clean net-zero close
  still deletes. Recording the missing split **self-heals** the flagged row (the
  oversell disappears, the position derives, the upsert clears the flag to null).

- **One-click resolve (`inferSplit` / `previewSplitResult` + `ResolveSplitDialog`).**
  The flagged ⚠ marker is a **button** that opens a resolver pre-filled with a
  DETECTED split. Two pure browser-safe leaves in `lots.ts` back it: `inferSplit`
  reads the ticker's largest date-ordered price CLIFF (a split divides the price by
  the ratio), snaps it to a standard ratio, and VERIFIES the candidate actually
  clears the over-sell before returning it (a guess that doesn't reconcile → null,
  never fabricated); `previewSplitResult` dry-runs `deriveLots` with the candidate
  split appended so the dialog shows the **resulting** position (shares / avg cost /
  value) LIVE as the user edits the ratio/date — the "verify the amount before you
  confirm" gate. Confirm is disabled until the ratio resolves the over-sell, and
  records through the same manual-ledger POST path (`recordManualEvent`); the row
  self-heals on refetch. Detection is a heuristic (single forward/reverse split;
  a sparse or very volatile history may not auto-detect — the ratio/date stay
  editable and previewed).

- **Import + entry surfaces.** The OFX importer ingests `SPLIT` (`portfolio-ofx.ts`
  `handleSplit`: ratio from `NUMERATOR`/`DENOMINATOR`, fallback `NEWUNITS`/
  `OLDUNITS`; `FRACCASH` → a separate cash row + warning; no usable ratio →
  skipped). A "Split" type in the add-transaction dialog records one by hand
  through the same contract. Transaction import gains a **reset-account mode**
  (`mode: "append" | "replace"`): `replace` atomically wipes the account's ledger
  and repopulates from the file (behind a typed `REPLACE` confirmation that warns
  it removes manual entries), via `repo.replaceLedgerFromFile`.

- **Provider split backfill (`backfillSplits`).** The bulk complement to the
  per-ticker resolve flow: a "Backfill splits" button on the Portfolio pane
  (`POST /api/portfolio/splits/backfill`) fetches every held ticker's split
  history from Yahoo (keyless, `fetchYahooSplits` in the analysis providers —
  dotted class shares normalized `BRK.B → BRK-B`, one retry on a flaky 404) and
  materializes the missing `split` events (`source: "provider"`, the same
  `attributes: { numerator, denominator }` shape) through `ingestLedgerEvents`.
  Only splits on/after the account's first trade in the ticker are written; a
  per-ticker provider failure is collected, not fatal; idempotent (a re-run, or
  an OFX/manual split of the same date, dedups on the fingerprint). The domain
  function takes the fetcher as a parameter (`SplitFetcher`) so the portfolio
  layer doesn't import the provider layer and tests inject a stub.

- **The NVDA data fix** is a one-time recorded event, not a schema hack:
  `pnpm --filter @flow-state-dev/trading-desk nvda-split` records the 2024-06-10
  10:1 split into `WF: Investing Accounts` through the real `ingestLedgerEvents`
  contract (idempotent — re-running dedups), restoring the derived 121.9346-share
  position.

- **Limitations (accepted).** A split rebases **ledger-derived** lots (from
  imported/recorded trades). A holding that exists only as a **CSV/PDF snapshot**
  (no ledger share history) has no lots to rebase, so recording a split against it
  is a no-op on the derived quantity — the split still shows in the transactions
  list, but the position won't change until its trade history is in the ledger
  (import the trades, or use a transaction-file import). Cross-source split dedup
  is date-sensitive: the fingerprint excludes numerator/denominator (so a manual
  split and a same-date file re-import of the *same* split collapse to one), which
  means a split recorded at two *different* dates double-applies (→ ratio²) and two
  *same-date* splits with *different* ratios dedup to whichever landed first —
  record at the broker **ex-date**, and use reset mode to correct a mis-entered
  split. A full account reset destroys manual corrections by design — the guard
  makes the resulting gap *visible* (a flagged row), not silent. Backfill is lazy
  (existing accounts re-materialize only when next touched). Return-of-capital /
  option closures / spinoffs / mergers / cash-in-lieu math / multi-currency and a
  forward splits feed (FIX-804) stay out of scope.

## Realized gains + tax estimate (FIX-874)

The realized side of the book — every sale's gain/loss, short/long classified,
plus a rough current-year tax estimate. A planning estimate, explicitly not
filing-grade. Full methodology in [`docs/tax-estimate.md`](docs/tax-estimate.md).

- **Derivation & persistence.** `deriveLots` (`lots.ts`) now returns a third
  `disposals` array (`RealizedDisposal`, `realized-gains.ts`) — one record per
  (sell event × consumed FIFO lot), emitted ONLY on `type === "sell"` (a
  `transfer`-out consumes lots but is not a taxable disposition).
  `materializeRealizedGains` (`repository.ts`) mirrors `materializePositions`:
  a full recompute into `app.realized_gains` on the SAME ingest/void seam, so
  realized gains stay live and **retract on a void**. Unlike
  `materializePositions`, its DELETE is UNCONDITIONAL (no early-return) — an
  all-voided account must clear its stale rows. Concurrency is a per-account
  `pg_advisory_xact_lock` (acquired in SORTED account order — deadlock-free),
  with `(disposal_event_id, lot_index)` unique as defense-in-depth. Exported
  `backfillRealizedGains()` is the rollout surface (loop every account under the
  lock; idempotent) — run from BOTH the deploy migrator (`scripts/migrate.ts`)
  AND dev startup (`db/portfolio-db.ts`, the PGlite branch), so sells imported
  before the migration materialize without waiting for a later ingest/void in
  either environment.
- **Honest basis, two axes (never zero-filled).** Term follows the
  acquisition-DATE axis (a transfer-in or over-sell → `term: "unknown"`);
  `costBasis`/`gain` follow the amount-known axis (a no-price buy → null gain, a
  currency mismatch → null both). A disposal feeds the ST/LT tax buckets only
  when `gain !== null` AND `term !== "unknown"`; the rest surface as
  `basisUnknownProceeds`/count. `holding-period.ts` (`longBoundary` +
  `classifyTerm`) is the ONE copy of the IRS ST/LT rule — `holding-term.ts`
  imports `longBoundary` from it (BP-034).
- **An over-sold sale's gains are excluded, not phantom.** When a sale over-sells
  (a post-split sale against pre-split lots before the split is backfilled),
  `deriveLots` nulls the `costBasis`/`gain` of EVERY lot it matched — not just the
  unmatched remainder — with `basisUnknown: "oversold-unreconciled"`, keeping the
  real proceeds. The matched lots are in mismatched units, so their gains are
  untrustworthy; nulling them keeps the tax estimate from reporting a fabricated
  loss (the holdings row is already flagged `inconsistent_history`). They
  self-heal once the split is recorded and the sale reconciles.
- **Totals sum the KNOWN portion of a mixed rolled-up row.** When a priced
  disposal and a basis-unknown one share a `(ticker, year, term, currency)` group,
  the display row reads "—" (one null contributor), but the year/grand/account
  totals still count the known gain and note the exact excluded-disposal count —
  the row model carries `knownGain` / `unknownGainCount` alongside the collapsed
  display `gain` so a mixed group never drops its known gain from the total
  (`realized-gains-row-model.ts`).
- **Proceeds-unknown marker.** An OFX sell with no `TOTAL`/`UNITPRICE` is
  recorded with a `proceedsUnknown` reason (`ledger_events.proceeds_unknown`),
  so derivation nulls proceeds/gain and excludes it rather than fabricating a
  loss off `amount:0`. The marker joins `computeFingerprint` **only when set**,
  so a placeholder can't dedup-collide with a genuine $0 sale while genuine rows
  keep byte-identical hashes (no fingerprint-recompute migration). Import-only —
  the manual route forces it null.
- **Shared ingest invariant + currency.** `ingestLedgerEvents` (the one boundary
  every writer funnels through — manual, file, future Plaid) enforces the
  share-event invariant (only buy/sell/transfer carry a non-null quantity; a
  quantity-bearing row needs a ticker; buy `+`, sell `−`, transfer either) — a
  violation throws + rolls back the batch — and normalizes `currency`
  (`.trim().toUpperCase()` + 3-letter check) so the tax route's exact
  `currency === "USD"` filter is trustworthy.
- **Year-dimensioned income.** `getIncomeSummaryByYear` groups by
  `(account, ticker, year, currency)` alongside the untouched all-time
  `getIncomeSummary`.
- **Tax profile + upper-bound estimate.** `app.tax_profiles` (filing status +
  marginal ordinary rate + LTCG rate + optional flat state rate). The estimate
  (`tax-estimate.ts`, `estimateTaxLiability`) is a deliberate UPPER BOUND — user
  rates applied directly to each bucket, no bracket tables. Keeps ST/LT netting +
  Schedule-D cross-net, the $3k/$1.5k-MFS loss cap + carryforward (display-only),
  per-bucket income floors, and a taxable-account/USD filter
  (`summarizeForTaxEstimate`, shared by the route and its goal-check test). Only
  `account.type === "taxable"` accounts feed it.
- **REST.** One composite `GET /api/portfolio/tax?userId&year` (profile +
  all-year realized + all-year income-by-year + the current-year estimate,
  composed in-handler via the pure leaf — no `getTaxEstimate` method); `year`
  scopes ONLY the estimate; `PUT /api/portfolio/tax-profile` writes the profile.
- **UI.** A per-account **Realized Gains** tab (`realized-gains-table.tsx` +
  `realized-gains-row-model.ts` — rolled up by ticker/year/term/currency, `—` for
  null basis) and a household **tax-estimate card** + **profile dialog**
  (`use-tax.ts`). `useTax` refetch joins the fan-out after every ledger mutation,
  a profile save, AND every account save/delete (account type/currency and the FK
  cascade are tax inputs).
- **Limitations (v1).** FIFO only; sell-only realization; no wash sales /
  corporate actions / NIIT; dividends assumed qualified; flat state rate;
  display-approximation (JS-number) figures; multi-currency excluded from the
  estimate. Two proceeds-unknown edges, both import-only (the marker is written
  at import time): an OFX no-proceeds sell imported BEFORE this release was
  stored as `amount:0` with no marker — indistinguishable from a genuine $0 sale,
  so the backfill derives it as a real capital loss and it can't be reclassified
  post-hoc without mis-nulling genuine $0 sales; and correcting a placeholder
  needs a VOID + re-record, not a re-import (the corrected row shares the
  `(account, source, externalId)` dedup key and dedups away). A
  void-and-reimport correction path is the tracked follow-up (FIX-878).

## Per-position thesis records (FIX-760)

The durable "why" behind a holding — entry rationale, invalidation conditions,
time horizon, optional target/stop, and a link to the originating report.

- **Why a resource, not a table.** Unlike accounts/holdings/ledger (which earned
  the FIX-772 `app.*` tables with FK cascades + cross-account `GROUP BY ticker`
  rollups + FIFO lot derivation), a thesis is a **flat household × ticker
  document** — no FK, no join, no aggregation — and it is **agent-facing state**
  (the seed injects it into the trader/PM prompts). That is the resource sweet
  spot, so it is a **user-scoped resource collection**, not a relational table.
  Being a resource buys the live client read path (`useResourceCollectionList`)
  and `resource_change` streaming for free — no bespoke read route, no manual
  refetch. (This is the inverse of FIX-858: holdings/positions are genuinely
  relational and need FIX-858's API-backed-resource projection to reach the
  surface; a thesis just *is* a resource.)

- **The collection — `thesesCollection` (`portfolio-resources.ts`).** Pattern
  `theses/*`, `scope: "user"`, `flowIsolation: false` (keys at bare
  `theses/{TICKER}` under the user — a per-user, cross-flow resource, not flow-
  isolated).
  `client: { state: { read: true }, live: true }`. The mutation verbs take the
  **bare** key (`thesisKey(ticker)` = the canonical upper-case ticker); the
  framework prepends the `theses/` prefix, so the stored key / client `item.topic`
  is `theses/{TICKER}`. Keyed household × ticker, NOT per account — intent is
  about the name. There is deliberately **no holdings link** — a thesis can
  outlive an exited position (post-mortem) and exist before a buy settles
  (adopt-then-buy).

- **The schema leaf — `domain/portfolio/schema/thesis-schema.ts`.** Browser-safe
  (imports only `zod`): `thesisInputSchema` (the user-suppliable fields the editor
  validates and the action re-validates), `thesisRecordSchema` (the collection's
  state shape, adds `createdAt`/`updatedAt`), `tripwireSchema`. NOT generator
  outputs — `.default()`/`.nullable()` are fine; do NOT add them to
  `output-schemas-strict.spec.ts` (the `accountStateSchema` precedent).

- **Two write paths, one collection.** The portfolio flow owns the hand-edit
  path — `saveThesis` / `deleteThesis` (`flows/portfolio/thesis-actions.ts`),
  ticker canonicalized to upper-case. The analysis flow owns the derive-from-report
  path — `adoptThesis` (`orchestration/adopt-thesis-action.ts`), which reads the
  session's decision snapshot + trader memo SERVER-SIDE (v1 is derive-only; the
  user edits afterward) and upserts with the `sourceSessionId` captured
  automatically. Both `ctx.resources.theses.upsert(thesisKey, ...)` — overwrite in
  place, no revision history in v1; the action stamps `createdAt` (preserved on
  edit) / `updatedAt`. The trader memo's `invalidationCriteria` is a `string[]`,
  joined to a bullet list for the thesis's freeform field.

- **Injection — read at seed, frozen, trader + PM only.** `seedSession` reads the
  thesis off the collection (`ctx.resources.theses.getOptional(thesisKey(ticker))`)
  and freezes it onto `state.standingThesis` (the `portfolioContext` /
  `riskMandate` snapshot pattern; does NOT join the keying tuple). The
  `standingThesis` capability preset renders `<standing-thesis>` from frozen state
  (object-form context, so the key auto-kebabs — the `portfolioContext` /
  `riskMandate` precedent; suppressed to null when absent), opted into by the
  trader (P3) and PM (P5) ONLY — the analysts stay blind so the independent
  evidence is uncontaminated. **`<standing-thesis>` is distinct from
  `userThesis`'s self-wrapped `<userThesis>`** (the Phase 6 hypothesis-under-audit)
  — never the same tag.

- **`hasStandingThesis` echo (snapshot + RunSummary).** The PM commit derives
  `hasStandingThesis` from frozen state (never LLM-emitted, the
  `hasPortfolioContext` precedent) onto the decision snapshot, mirrored to
  `RunSummary`. It is the deterministic PASS signal the
  `goals/trading-desk-thesis/standing-thesis-injected` goal check reads.

- **Read path is the resource itself.** The Portfolio + report UI read the
  collection via `use-theses.ts` (`useResourceCollectionList(session, "theses")`,
  live — no route, no refetch). A per-holding indicator flows through the holdings
  row model so both the table and the stacked-card layout show it.

- **Limitations (v1).** Household × ticker only (per-sleeve theses defer to
  FIX-771); overwrite on edit, no revision history; `adoptThesis` is derive-only
  (no edit-before-save). The review loop that re-checks tripwires and fills the
  snapshot `outcome*` fields is FIX-763 (this is its blocker).

## Responsive / mobile layout

The desk branches its **shell** at the `lg` breakpoint (1024px); content
components and data hooks are shared, never forked (FIX-757). Follows the
kitchen-sink precedent (FIX-184): both shells render, CSS picks one — no
`useMediaQuery`, no hydration risk.

- **The two shells live in `app/page.tsx`.** Desktop (`hidden lg:grid`) is the
  original fixed-viewport grid (`44px / 1fr / 28px` rows, TopBar + view-switched
  main + StatusBar), unchanged. Mobile (`lg:hidden`, `height: 100svh`) stacks
  `MobileHeader` → one full-width surface → `MobileStatusLine` → `BottomNav`.
  The mobile `<main>` is a single-cell grid so each pane stretches to fill both
  axes without its own sizing classes.
- **Mobile navigation** (`components/mobile/`): `mobileTab`
  (`"report" | "transcript" | "portfolio" | "history"`) in `page.tsx` is the
  single source of truth; it is independent of the desktop `view` state. The
  bottom tab bar's center **New** slot is an ACTION (opens the New Analysis
  sheet), never a destination — it must not join the `MobileTab` union. Opening
  a past report on mobile reuses `handleOpenReport` (tuple-first, zero model
  spend) and then routes to the Report tab.
- **Pane reflow rules:** `ThesesPane`'s 200px `MemoSidebar` is `hidden lg:block`
  inline and opens as a native `<dialog>` drawer below `lg` (the "Phases"
  button) — same imperative open/close idiom as the app's other dialogs, so
  ESC/focus-trap/backdrop come from the browser. `HoldingsTable` renders the 10-column table only when its own
  container is ≥ `@3xl` (a CSS container query, not a viewport breakpoint) and
  stacks one card per holding below that — both layouts read the SAME
  `buildHoldingRowModel` view model (`test/holdings-row-model.spec.ts`), so the
  real-money `—`-for-missing gate and P/L coloring hold in both by
  construction.
- **The StatusBar splits on mobile.** Run metrics condense into
  `MobileStatusLine`; the instructions gear moves to `MobileHeader`; the
  not-advice disclaimer — a real-money gate — stays visible in the mobile shell
  (it renders in `MobileStatusLine`, above the tab bar). Never ship a mobile
  layout that hides it.
- **Chrome conventions:** the mobile shell uses `100svh` (NOT `vh`, which
  overflows behind mobile browser toolbars, and NOT `dvh`, which reflows on
  scroll), plus `env(safe-area-inset-top/bottom)` on the header/tab bar.
  `viewport-fit=cover` is set via the `viewport` export in `app/layout.tsx` —
  removing it silently zeroes every safe-area inset.
- **Dialogs are bottom sheets below `lg`.** Every native `<dialog>` carries
  the `td-sheet` class; the shared sheet geometry (bottom-pinned, full-width,
  `85svh` cap, safe-area padding) and the slide-up entry live in ONE
  `globals.css` rule under `@media (width < 64rem)` — the exact boundary
  Tailwind compiles `lg` to, and unlayered so it beats the dialogs' layered
  utilities. Dialogs also carry `m-auto` so the desktop modal is actually
  centered (Tailwind preflight zeroes the UA `dialog` margin). No drawer
  dependency — native `<dialog>` already provides the focus trap, ESC, and
  backdrop.

## Portfolio-aware analysis + lens pack (Slice 5)

A run can carry the live portfolio so the trader and the PM size against real
positions, and a pack of documented-methodology investor LENSES re-reads the
evidence to produce a convergence signal the PM uses for sizing conviction.

- **The portfolio snapshot is built SERVER-SIDE at `seedSession`.** The analysis
  flow's `seedSession` handler reads accounts + holdings from the app-owned
  repository (`getRepository().getPortfolio(userId)`, FIX-772; `toAccountStates`
  nests them into the inline-array shape) and the last-known prices from the
  durable `app.quotes` table (`repo.getQuotes(heldTickers)`, FIX-823 — the ticker
  set derived from the scoped holdings). It calls
  `build-portfolio-context.ts` (a pure leaf) to compute the snapshot:
  per-holding `marketValue = quantity × last-known price`, `totalNav = Σ known
  marketValue + Σ cash`, `weightPct = marketValue / totalNav`. A ticker with no
  cached price degrades to `marketValue: null` / `weightPct: null` — NEVER a
  fabricated price. The snapshot carries `snapshotAsOf` (the OLDEST quote `as_of`
  among the priced rows — honest "as of at least") and
  `pricedHoldings` / `totalHoldings` so the prompt + UI label staleness and
  coverage honestly. The flow freezes it onto session state and NEVER recomputes
  weights. Null → the run is portfolio-blind exactly as before. There is NO
  client-built snapshot bridge — the `analyze` action no longer takes a
  `portfolio` dispatch input; the data comes from the app-owned tables at seed.
- **`portfolioContext` + `lensConvergence` capability presets.** The
  `portfolioContext` preset renders `<portfolioContext>` from frozen session
  state (no resource — like `userThesis`); returns `null` to suppress the tag
  when no portfolio. The `lensConvergence` preset renders `<lensConvergence>`
  from the deterministic convergence resource (PM only). Both formatters
  (`lib/format.ts`, BP-018) GUARD on a required field, not just `!== null`: an
  unwritten nullable single resource can surface as `{}` in the generator
  context, so a partial/empty read suppresses the tag rather than throwing.
- **The trader (P3) and PM (P5) opt into `portfolioContext`.** The trader sizes
  realistically when it sees existing exposure (no output-schema change — the
  portfolio-fit verdict lives only on the PM, the final arbiter). The PM also
  opts into `lensConvergence` and emits a STRICT `portfolioFit` object on
  `portfolioDecisionOutputSchema`: `{ action ∈ initiate|add|trim|exit|hold,
  targetWeightPct, sizingRationale, concentrationRisk, suggestedAccount,
  convictionBasis }`. The commit handler DERIVES four echo fields (never trusts
  the LLM, the `agreesWithTrader` precedent): `currentWeightPct` (summed from
  the snapshot's priced rows for the ticker), `weightDeltaPct`,
  `hasPortfolioContext`, and a VALIDATED `suggestedAccount` (a label not in the
  real account list → `""` — never invent an account the user lacks).
- **The lens pack lives in `agents/lenses/` and runs PRE-DECISION** (after Phase 2,
  before Phase 3 in the orchestration order), so convergence is a CONTEXT INPUT the PM reasons with
  (convergence → conviction → size, INSIDE the decision — not a post-hoc cap).
  The pack is EXACTLY 4 lenses (`agents/lenses/lenses.ts` `LENS_PACK`): quality-value
  (Buffett/Munger), cycle-risk (Howard Marks), macro-reflexive
  (Druckenmiller/Soros), forensic-skeptic (Burry — the structural bear).
  Mechanical-deep-value + GARP are DEFERRED (they need EV-multiple/PEG numbers
  the surface lacks, FIX-705); the pack is a config array, so adding them later
  is one edit to `LENS_PACK` (`agents/lenses/lenses.ts`) + one to `LENS_IDS` in
  `registry.ts`.
- **Lenses are INDEPENDENT and BLIND, not a debate (FIX-655).** Each lens
  generator (`defineLensGenerator`, BP-024 factory) reads ONLY the shared
  post-Phase-2 bundle (`investmentThesis` + `phase1MemosFull` + `valuationSpine`)
  plus its own persona via a per-generator `context` slot — NEVER another lens's
  memo. The steps are fanned out with `.parallel`. They previously ran as a
  sequential chain to dodge a runtime bug where parallel branches' distinct-key
  collection writes clobbered each other in the continuation cache, so a
  convergence tap after the fan-out read a stale view (3 of 4 lens memos still
  `pending`). FIX-744 made distinct-key collection writes cache-consistent, so
  the convergence tap now sees all N after a parallel fan-out. Parallel ≠ debate
  — each lens is still blind. Lens verdict
  schema (`agents/lenses/lens-verdict-schema.ts`) is STRICT per BP-016 (3-tier
  `stance` + `conviction` + `missingData` honesty array; in the strict walker).
- **Convergence is DETERMINISTIC (no LLM).** `computeAndStoreConvergence` (a
  `.tap`) reads the committed lens memos, runs the pure `agents/lenses/convergence-math.ts`
  `computeConvergence` (agreementScore ≥ 0.8 → convergent, ≥ 0.5 → mixed, else
  divergent; netLean = Σ(stanceSign × conviction)/N; ties → neutral; equal-weight
  by conviction in v1), and writes `lensConvergenceResource.patchState(...)`. The
  PM memo mirrors the read so the PmHero strip reads one place. Robustness
  adjusts sizing DOWN on divergence only — it never inflates a position; the UI
  + `convictionBasis` say "robust across philosophies", never "likely correct".
- **COST GATE (RISK-F3):** the lens pack runs on `costPreset === "full"` ONLY
  (the `.stepIf(costPreset === "full", phase2bPipeline)` in `flow.ts`). On
  `fast` it is skipped entirely (no lens memos, no convergence resource); the PM
  still emits `portfolioFit`, just without a convergence-derived
  `convictionBasis`. `selectedAccountIds` does NOT join the session keying tuple
  in v1 — account selection is a refinement, not a new report. Re-runs re-default
  the lens memos (`{ replace: true }` setup) and re-`patchState` the convergence
  resource, so no stale read survives.
- **UI:** `PmHero` (`components/theses/pm-hero.tsx`) renders the portfolio-fit
  panel (action chip, current→target weights + Δ, suggested account,
  concentration, sizing, conviction, snapshot-as-of + not-advice line) and the
  lens-convergence strip (per-lens stance bars, dissenters outlined, a data-gap
  line, classification pill, the three honesty lines). Inline SVG/flex only.
  `theses-pane.tsx`'s `MemoClientData` mirrors the two shapes off `MemoState`.
  Each individual lens memo renders as a dedicated `LensCard`
  (`components/theses/lens-card.tsx`, Slice 7) — attribution + stance +
  conviction + the verdict + a ⚠ missing-data honesty line — routed from the
  `MemoDoc` dispatcher for the four lens agents; `forensic-skeptic` carries a
  "structural skeptic" label (UI only) so its by-design dissent reads as expected,
  not alarming. The deterministic convergence math is untouched by the card.

## Risk-appetite mandate (decision tier) — FIX-752

The PM's "is the risk worth it" call runs against a variable, user-set
**mandate** — the third decision axis (risk APPETITE) beside the philosophy
(lenses) and mechanics (portfolio-fit) axes. The mandate moves SIZE and an
explicit worth-it verdict; it NEVER clamps the rating (that stays the
valuation-envelope-anchored, cross-book signal — the lens / portfolio-fit
precedent that orthogonal axes adjust size and emit a verdict, never overwrite
`finalRating`).

- **The pack is config-as-data.** `lib/risk-mandate.ts` exports `MANDATE_PACK`
  (three presets: `conservative-income` / `balanced` / `aggressive-growth`), the
  `riskMandateSchema` dial shape, `resolveMandate(id)`, and
  `mostConservativeMandate(ids)`. Adding or retuning a mandate is one edit here
  (the `LENS_PACK` precedent). The dials: loss-aversion λ, reward-to-risk floor,
  return hurdle, confidence floor, max-tolerable-loss (the capacity line),
  fractional-Kelly appetite, and the two absolute size caps (soft
  `unclearedCapPct`, hard `capacityVetoCapPct`).
- **Resolution + freeze at seed.** `seedSession` (`orchestration/guards.ts`)
  resolves the effective mandate: a per-run override (`analyzeInputSchema
  .riskMandate`, a pack id) wins; else the most-conservative default among the
  SELECTED accounts (`account.riskMandate`, an OPAQUE string the analysis flow
  validates via `resolveMandate` — an unknown / stale id → mandate-blind, never
  throws); else null. The resolved dial object is frozen onto `state.riskMandate`
  (the `portfolio`-snapshot precedent — store the resolved object, not the id).
  Null → the run is mandate-blind and behaves exactly as before FIX-752.
  `riskMandate` does NOT join the keying tuple (the `selectedAccountIds`
  precedent).
- **The reward-to-risk figure is deterministic.** A post-forecast `.tap`
  (`compute-reward-to-risk.ts`, mirroring `compute-spine.ts`) reads the committed
  scenario buckets — which now carry a numeric `expectedReturnPct` — and the
  frozen mandate's λ, runs the pure `lib/reward-to-risk.ts` `computeRewardToRisk`
  (a loss-aware Gain/Loss ratio: prob-weighted upside over `λ ×` prob-weighted
  downside, plus EV and worst-case, nullable-honest with an `evidenceBasis`
  flag), and writes the surface-owned `rewardToRiskResource`. Null resource when
  no usable buckets. Surfaced to the PM via the `rewardToRisk` capability preset
  (`<rewardToRisk>`); the mandate via the `riskMandate` preset (`<riskMandate>`,
  a frozen-state read suppressed to null when mandate-blind — the `userThesis`
  pattern). The trader also opts into `riskMandate` (sizes with awareness) but
  not `rewardToRisk` (it runs before Phase 5a, so the figure does not exist yet).
- **The verdict + size gate are derived at commit; the narrative is the LLM's.**
  The PM emits a NARRATIVE-ONLY `mandateFit` (`{ rewardToRiskRead, sizeStance,
  mandateOverrideReason }`, three strict strings, all `""` when mandate-blind).
  The commit (`agents/portfolio-manager/writer.ts`) derives the bright-line check
  (the `agreesWithTrader` precedent — never trust the model for what it can
  compute): `mandateCleared` (soft gates: reward-to-risk floor, hurdle,
  confidence floor; a no-downside distribution clears the r/r floor) and
  `capacityCleared` (worst case within tolerance). It then clamps
  `portfolioFit.targetWeightPct` — the HARD capacity veto first (cap to
  `capacityVetoCapPct`, non-overridable), then the SOFT worth-it cap (cap to
  `unclearedCapPct`, lifted only by a non-empty `mandateOverrideReason`). The
  derived verdict + flags + a compact figure mirror onto the PM memo as
  `mandateDecision` (null on a mandate-blind run, so the PmHero panel reads one
  place), and a compact subset onto the decision snapshot (the FIX-614
  sensitivity-benchmark record). Two escape policies, matched to
  wealth-management semantics: appetite is soft / overridable, capacity is hard /
  non-overridable. All mandate effects are downward-only — they never inflate.
- **Phase 4 is augmented, not replaced.** The fixed aggressive / conservative /
  neutral triad is unchanged; the mandate connects to the threshold only through
  the confidence floor (a Phase 4 `overconfident` calibration already pulls
  `decisionConfidence` down, which feeds the gate). Collapsing the triad into a
  mandate-parameterized evaluator is a deliberate, deferred follow-up.
- **Real-money discipline.** The mandate is a documented, user-set standard, NOT
  advice; the reward-to-risk figure traces to the scenario distribution (no
  fabrication) and is framed as a reward-to-risk read, never a probability of
  being right. The size caps are absolute % constants in the pack — the v1
  simplification over a dynamic "don't add beyond current weight" rule.

## Portfolio mandate (IPS) — FIX-761

The durable, household-level statement of intent — the reference point that makes
"balanced," "drift," and "rebalancing" mean something. Where the FIX-752 mandate
above is the per-run appetite DIAL, the portfolio mandate is the standing POLICY:
objectives, a target allocation over the existing `assetClass` buckets, standing
constraints, a time horizon, and rebalancing bands. Full detail in
[`docs/portfolio-mandate.md`](docs/portfolio-mandate.md).

- **A resource, not a table.** The mandate is a flat household document (no FK /
  join / aggregation) and agent-facing state read at seed — the FIX-760 thesis
  reasoning exactly. So it is a user-scoped FSD resource
  (`portfolioMandateResource`, `portfolio-resources.ts`, `flowIsolation: false`),
  written by `savePortfolioMandate` / `clearPortfolioMandate`
  (`portfolio-mandate-actions.ts`), NOT an `app.*` table. Being a resource buys
  the live client read + `resource_change` streaming for free. Presence is a
  REQUIRED field (`state?.createdAt`), never `state != null` — the engine
  normalizes a cleared single resource to `{}`.

- **Reconciliation with FIX-752 (load-bearing).** ONE policy object, not two. The
  FIX-752 appetite folds in as the mandate's `riskAppetite` facet. Precedence at
  seed: `run override → account default → IPS household → null`, purely additive.
  When the IPS sets only `riskTolerance`, the seed DERIVES the appetite 1:1 via
  `toleranceToAppetite` (so a normal IPS still steers the gate);
  `account.riskMandate` is kept as a per-account exception above the household
  default (asset location). All effects downward-only.

- **Injection + freeze.** `seedSession` reads the resource, RE-VALIDATES it
  (`validatePortfolioMandate` — a business-invalid persisted record degrades to
  mandate-blind, never throws), freezes it onto `state.portfolioMandate`, and
  freezes the analyzed ticker's HOUSEHOLD weight
  (`state.householdTickerWeightPct`, from the pre-scoping account read so a scoped
  run measures a household cap against the whole book). The PM reads it via the
  `portfolioMandate` capability preset (`<portfolioMandate>`, frozen-state read,
  suppress-to-null when absent — the `standingThesis` / `riskMandate` precedent);
  the trader also opts in for size awareness.

- **PM gating (`lib/policy-gate.ts`, pure).** At commit, `computePolicyGate`
  clamps size deterministically: HARD `maxPositionWeight` cap (at-purchase,
  floored at the household weight so an over-cap hold is never force-trimmed) +
  HARD exclusion no-add (`min(target, householdWeight)`); min-cash + allocation
  drift are ADVISORY (the PM narrates). Derived from frozen state, never the LLM
  (the `agreesWithTrader` precedent); the PM's `policyFit` supplies only the two
  narrative strings. A held-but-unpriced name skips the clamp
  (`householdWeightKnown: false`) rather than coercing the weight to 0 (which
  would fabricate an exit / forced trim — BP-020). The mandate NEVER touches
  `finalRating` (the FIX-715 / FIX-752 orthogonality). The derived `policyVerdict`
  + clamp flags echo onto the memo (`policyDecision`), the decision snapshot, and
  the RunSummary (the goal-check read path).

- **NOT a generator output.** `portfolioMandateSchema` is a resource-state /
  input shape — `.default()` / `.nullable()` are fine; do NOT add it to
  `output-schemas-strict.spec.ts`. The PM's `policyFit` (two narrative strings) IS
  a generator output and is in the strict walker.

- **UI + limitations.** Editor + summary chip live in the Portfolio view
  (`components/portfolio/mandate-dialog.tsx` / `mandate-form.ts` /
  `use-portfolio-mandate.ts`); the PmHero policy block reads the memo's
  `policyDecision`. v1 is a flat household mandate (sleeves are FIX-771), targets
  the existing `assetClass` enum (custom buckets deferred), and measures no drift
  (the health view is FIX-762). See the sibling household resource,
  [Per-position thesis records (FIX-760)](#per-position-thesis-records-fix-760),
  and the per-run appetite dial,
  [Risk-appetite mandate (FIX-752)](#risk-appetite-mandate-decision-tier--fix-752).

## Evidence-sufficiency gate (always-on) — FIX-781

An always-on, deterministic capital gate — the third sibling of the FIX-752
appetite dial and the FIX-761 policy gate, but unconditional. It caps NEW
exposure whenever the evidence behind a call is too thin, so a thin/missing
substrate can never authorize adding to a position. Independent of the optional
risk mandate: it fires on mandate-blind and portfolio-blind runs alike.

- **Three evidence layers, fail-closed OR (`lib/evidence-gate.ts`, pure).**
  `computeEvidenceGate` reads (1) the valuation-spine `evidenceBasis` +
  `expectedReturn.lowConfidence`, (2) the reward-to-risk `evidenceBasis`, and (3)
  a DETERMINISTIC `criticalDataThin` signal — true when ANY of the four primary
  financial payloads (fundamentals / income / balance-sheet / cashflow) is absent
  or `source: "unavailable"`, derived by `deriveCriticalDataThin` from the tool-set
  markers, NEVER the LLM `dataQuality`. Sufficient requires all three clear; any one
  thin ⇒ `insufficient-evidence`. The OR (not AND) closes the "forecaster emits ≥3
  buckets on thin substrate → reward-to-risk reads sufficient" hole — a single
  missing statement still gates.

- **No-add, downward-only, non-overridable.** On insufficient evidence the target
  is capped to the current position (`min(target, currentWeight)`; `0` for a
  portfolio-blind / not-held name), `initiate`/`add` become `hold`, and
  `trim`/`exit`/`hold` are preserved. When the current position can't be measured
  in the run's own NAV basis (the scoped weight is `null`, held-but-unpriced) the
  numeric clamp is SKIPPED and the pre-gate size passes through — the action
  downgrade enforces the no-add, exactly the `computePolicyGate`
  `householdWeightKnown: false` precedent (never fabricate a size from an unknown
  basis). The gate NEVER touches `finalRating` (the FIX-715/752/761 orthogonality
  — observed negative evidence still rates bearish; only new exposure is gated).
  There is no override — `mandateOverrideReason` cannot clear an
  insufficient-evidence verdict.

- **The scoped current weight is computed at commit from the frozen snapshot.** The
  PM commit derives it via `householdTickerWeight(portfolio, ticker)` (the same pure
  helper `seedSession` uses for the FIX-761 household weight) over the FROZEN
  `state.portfolio` snapshot — the analyzed ticker's weight in the run's OWN scoped
  NAV basis (three-value: `0` not-held, positive held+priced, `null`
  held-but-unpriced). It is NOT a separate session field: the snapshot is the single
  source of truth, so a session predating a would-be scoped-weight field can't
  default it to a wrong value (BP-030). Distinct from the `portfolioFit.currentWeightPct`
  echo, which is a display partial-sum coercing unpriced lots to 0. The evidence
  gate uses this SCOPED weight, not the household weight the policy gate uses.

- **Derived at commit, mirrored three ways.** The PM commit
  (`agents/portfolio-manager/writer.ts`) runs the gate AFTER the mandate + policy
  gates (its input is the post-policy `gatedAction` + target), sets the final
  `portfolioFit.action`/`targetWeightPct`, and mirrors the full
  `evidenceDecision` (verdict + evidence bases + clamp flags +
  `preGateEvidenceTargetPct`/`preGateEvidenceAction`) onto the memo, the
  `evidenceVerdict` onto the decision snapshot, and the same onto the RunSummary.
  The PmHero `EvidencePanel` (`components/theses/evidence-panel.tsx`) reads the
  memo mirror. Because the gate runs last, eval clamp checks compare against
  `evidenceDecision.preGateEvidenceTargetPct` (the pre-evidence baseline), and a
  dedicated `evidence/*` deterministic invariant (`eval/invariants.ts`) recomputes
  the verdict and asserts the no-add held.

- **NOT a generator output.** `evidenceDecisionSchema` is a memo-state mirror —
  `.nullable()`/`.default()` are fine; do NOT add it to
  `output-schemas-strict.spec.ts`. The gate derives everything; the PM emits no
  evidence-specific prose (the prompt only states the symmetric "missing data is
  non-evidence in both directions" rule).

- **v1 simplifications.** The `criticalDataThin` set is the four primary financial
  payloads; a broader "underwriting-critical inputs" set is a deferred option. On a
  held-but-unpriced name the size passes through unclamped (the action still
  enforces the no-add) rather than withholding a numeric target — the Option-B
  match to the FIX-761 sibling, avoiding a nullable-target blast radius across the
  hero / summary / eval consumers. See the sibling gates,
  [Risk-appetite mandate (FIX-752)](#risk-appetite-mandate-decision-tier--fix-752)
  and [Portfolio mandate (IPS) — FIX-761](#portfolio-mandate-ips--fix-761).

## Adding a new generator

**Structured-output agents in the trader / risk / forecaster / PM /
thesis-validator groups are wrapped with an approach preamble.** Each such
agent has a sibling `<agent>ApproachGenerator` built via
`createApproachGenerator()` in
`agents/_recipe/approach-generator.ts` and inserted before the structured
generator in its step sequencer (the `approach.ts` in the group). Use the
factory — don't hand-roll a new `generator({...})` for a preamble.

Every generator in this app uses the `tradingDesk` capability for model
selection + ticker/date context. The minimum scaffold:

```ts
import { generator } from "@flow-state-dev/core";
import { tradingDesk } from "../capability";

export const myGenerator = generator({
  name: "my-generator",
  itemVisibility: { client: true, history: false }, // or { client: true, history: true } if it should emit speak rows
  agentName: AGENT_KEYS.someAgent.agentName,
  uses: [tradingDesk],                       // model + ticker + date come from here
  prompt: MY_SYSTEM_PROMPT,
  user: "Now write the X.",                  // short, declarative; no concatenated sections
  outputSchema: myOutputSchema,
});
```

If your generator needs additional context (memos, debate transcripts, etc.),
opt into the relevant presets:

```ts
uses: [tradingDesk.presets({
  phase1Memos: true,
  investmentThesis: true,
})],
```

See the capability's available presets in
[`capability.ts`](flows/analysis/capability.ts).

### The memo lifecycle: one `defineMemoStep` convention

Every participant — the nine analysts, the four lenses, the trader, the
three risk personas + risk-assessment, the scenario-forecaster, the PM, the
thesis-validator, and the three research consolidations — wears the **same**
memo lifecycle: pre-mark the memo `writing`, run the participant's body,
commit the result, and on failure rescue to `error`. There is exactly **one**
apparatus that expresses it, in
[`agents/_recipe/memo-writer.ts`](flows/analysis/agents/_recipe/memo-writer.ts):

```ts
defineMemoStep(body, { key, commit })
// builds: sequencer()
//   .tap(markWriting(key))      // pre-mark `writing`
//   .step(body)                 // the participant's pre-commit work
//   .tap(commit)                // the per-participant commit projection
//   .rescue([{ block: markError(key) }])
```

- **`body`** — the participant's pre-commit work: a bare generator, or a
  composed sub-sequencer (approach→gen, or tool-fan-out→gen). It does **no**
  memo writes. Each non-analyst/non-lens participant module exports its body.
- **`key`** — a typed memo short-name (`AnyMemoShortName = keyof typeof
  ALL_MEMO_KEYS`), **not** a raw string. A typo is a compile error, never a
  runtime skip.
- **`commit`** — the per-participant commit handler, which stays in that
  group's `agents/<group>/writer.ts`.

**Memo identity lives in the registry, not in the lifecycle.** `markWriting`
and `markError` are a single key-driven pair: they resolve `collectionKey` /
`agentName` / `agentTeam` / `phaseId` / `errorMessageFallback` /
`errorPlaceholder` from `ALL_MEMO_KEYS[key]` — the single source of truth.
The `MemoKeyEntry` type **requires** `agentTeam` / `phaseId` /
`errorMessageFallback`, so a half-specified entry won't type-check. (Phase 4
personas also carry an `errorPlaceholder`; nothing else passes a lifecycle
arg.)

**The two recipes are thin wrappers over `defineMemoStep`, not separate
apparatuses.** `defineAnalyst` composes the analyst-specific body (the tool
fan-out + synthesis generator) and delegates the lifecycle; the lens fan-out in
`orchestration/stages.ts` calls `defineMemoStep(defineLensGenerator(lens),
{ key, commit })` directly. `stages.ts` reads as a flat staffing plan — one
`defineMemoStep(...)` line per participant.

A `test/memo-step-coverage.spec.ts` coverage guard asserts that the keys placed
via `defineMemoStep` across `stages.ts` equal exactly the keys in
`ALL_MEMO_KEYS` — so a participant added to the registry but never placed (or
placed under a stale key) fails loudly.

### Adding a Phase 1 analyst

Each analyst is one `defineAnalyst({ shortName, tools, generator })` call.
The factory composes the analyst-specific body — `.map(tickerDate) →
.parallel(attributedTools) → generator` — and hands it to `defineMemoStep`,
which owns the `markWriting → body → commit → rescue(markError)` lifecycle.
The call site supplies only what varies — the role's tools and its
synthesis generator. See [`agents/analysts/analysts.ts`](flows/analysis/agents/analysts/analysts.ts)
for the nine existing analysts.

To add another:

1. Add the agent to `AGENTS` and `PHASE_1_MEMO_KEYS` in `registry.ts`.
2. Add a new `discover_<role>_context.ts` tool if it needs web discovery,
   plus any role-specific `get_*` tools (in `tools/data/`).
3. Write the generator (output `thesisOutputSchema`).
4. Call `defineAnalyst({...})` in `agents/analysts/analysts.ts`.
5. Wire it into the `analystFanOut` `.parallel({...})` in `orchestration/stages.ts`.

### Adding a group setup or writer

The per-group boilerplate splits across two `agents/_recipe/` helpers and the
registry:

- `defineMemoSetup({ phaseId, agentTeam, keys, activePhase })` in
  `agents/_recipe/memo-setup.ts` — pre-creates the group's memos in `pending`
  (the navigator reads each memo's status live off the collection, so the
  `pending` scaffolds are the only status seed — there is no session mirror).
  Adding a new memo to a group is a one-line edit to `registry.ts`.
- The **memo lifecycle is not built per group.** `markWriting` / `markError`
  are the single key-driven pair from `defineMemoStep` (see the section above);
  they read `agentTeam` / `phaseId` / `errorMessageFallback` /
  `errorPlaceholder` from the registry entry, so a `writer.ts` no longer
  declares them. A group's `writer.ts` is **just its commit handlers**: each is
  a plain `memoHandler({ name, inputSchema, execute })` whose body calls
  `publishMemo(ctx, shortName, collectionKey, patch)` (BP-024 — a helper, not a
  callback factory). `patch` is applied on top of the standard `status:
  "published" / completedAt / errorMessage: null` fields. Any group-terminal
  session-state work (the PM group flipping `runComplete`) runs inside that
  commit handler's `execute`.

### The `investigate` preset

Phase 1 analysts opt into investigative search/fetch with
`tradingDesk.presets({ investigate: true })`. The preset exposes the
`fetch` tool and the `<investigation>` clause only on `costPreset ===
"full"`; on `fast` both are absent and the prompt suppresses the
`<investigation>` tag entirely (the resolver returns `null`, not `""`).
Each analyst also wires a deterministic discovery tool
(`discover_*_context`) into its parallel data fan-out. The discovery
tools self-gate at the body level — they short-circuit to
`skippedDiscoveryPayload` before any provider call when the preset isn't
full. Two coordinated seams, same key, no leakage.

The citation contract — every claim traces to either a `<data>` field
or a URL the analyst actually fetched, and fetched URLs go in the
`citations` array — is enforced by the prompt clauses, not by runtime
validation. Body-section "Sources" is the v1 surface; inline `[n]`
markers are intentionally deferred.

If you have **costPreset-conditional** content (heavier context only on
`full`), list the `*Full` variant of the preset alongside the always-on
ones. The gating lives inside the preset — the context formatter renders
an empty string when `costPreset !== "full"`, but the resource and the
prompt tag still wire up statically. The call site stays flat:

```ts
uses: [
  tradingDesk.presets({
    investmentThesis: true,    // always on
    phase1MemosFull: true,     // empty render on `fast`, populated on `full`
    phase2DebateFull: true,    // ditto
  }),
],
```

Available `*Full` variants today: `phase1MemosFull`, `phase2DebateFull`,
`riskCritiquesFull`. Each one declares the same resources as its
always-on counterpart, so generators don't need to mirror those on their
own `resources:` slot. Add a new variant when you want a different
preset to participate in the cost gate.

### Synthesis-phase web search — the `corroborate` preset

Phase 1 has `investigate` (discovery → bounded fetch) and Phase 6 has
`verify` (ungated search+fetch, user-thesis only). The synthesis phases
in between get a third affordance: **`corroborate`** — cost-gated,
agent-initiated web `search` + `fetch` to back up a *specific* claim
before committing to it. Two presets carry it:

- **`corroborate`** — exposes the shared `search` + `fetch` tools and the
  `<corroboration>` clause, HARD-GATED on `costPreset === "full"` (the
  `investigate` gate, the `verify` tool set). Opted into by the trader
  (P3), **all three** risk personas (P4), and the PM (P5b). The risk
  triad is all-or-none on purpose: arming only one persona would tilt the
  desk's already conservative-leaning synthesis. The per-memo call cap
  (2 searches + 2 fetches) lives in the clause, not in tool state (the
  `counterEvidence` precedent). The clause requires every lookup-backed
  claim to trace to a URL the agent actually fetched, added to the
  `citations` array.
- **`reviewReferences`** — exposes `fetch` (no `search`) plus the
  `<reviewReferences>` clause, same `full` gate. For synthesis agents
  that should be able to *pull* a link the desk already surfaced but not
  run a fresh search: the scenario forecaster and the risk consolidator.

**Both presets also render the shared "references consulted" ledger** as a
`<referencesConsulted>` tag (same `full` gate as their tools/clause) so a
downstream agent reuses a link rather than re-searching the same ground.
The ledger is DERIVED from the `citations` already on every memo — there
is no separate resource. `formatReferencesConsulted` (`lib/format.ts`)
walks `ALL_MEMO_KEYS`, collects each memo's `citations`, dedups by URL
(first citer wins), and attributes each to the citing agent. Folding the
ledger into the two tool presets (rather than a standalone
`referencesConsulted` preset) makes the `fast` no-op **structural**: the
`full` gate means a persisted citation from a prior full/`verify` run can
never surface `<referencesConsulted>` on a `fast` re-run. The lenses
(independence guarantee, FIX-655) and the Phase 2 debaters (open-web
rejected by FIX-679; debate-phase search tracked separately) get neither
preset, so neither reads the ledger.

Each corroborator/reviewer's output schema carries a nullable
`citations: z.array(memoCitation)` (the Phase 1 / Phase 6 pattern,
BP-016-safe), and its writer passes it through so the memo renders a
"Sources" footer. The `citations` field's prompt contract is a shared
`{% render 'citations-field' %}` partial for the four risk prompts (whose
copies were identical); the trader/PM/forecaster variants stay inline
(their output-shape lists differ). To add another corroborator: list
`corroborate: true` (or `reviewReferences: true`) in its `uses` and add
the `citations` field to its output schema — the ledger comes with the
preset.

> **Search-provider guard.** `search` is dropped (fetch-only) when no
> web-search provider key is configured — the `@flow-state-dev/tools`
> resolver *throws* with none, which would abort the generator. The guard
> probes the tools package's own `resolveProvider({})` (try/catch) rather
> than hand-copying its env-var list, so it can't drift. The underlying
> throw-on-first-call is a tools-package bug (every search consumer hits
> it); degrading it there is a documented follow-up (BP-028).

> **Not cached.** `@flow-state-dev/tools` `search`/`fetch` have no cache
> layer (unlike the desk's own data tools, which wrap `getOrFetch`), so a
> second agent that re-`fetch`es the same URL pays a fresh request. The
> references ledger is what avoids the duplicate *search*; a cheap
> duplicate *fetch* would need caching added at the tool level — a
> `@flow-state-dev/tools` change, deliberately out of scope here.

## Adding a new tool

Tools follow the per-tool-file pattern. Each tool file owns its provider
preference and fallback chain; mode dispatch (fixture / live / record)
lives in `tools/runtime/resolve.ts` — every tool's `execute` funnels
through `resolveToolPayload`.

```ts
// tools/data/get_my_tool.ts
import { handler } from "@flow-state-dev/core";
import { resolveToolPayload } from "../runtime/resolve";
import { fetchFromProviderA } from "@/lib/providers/providerA";
import { emptyPayload } from "../empty-payloads";
import { toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_my_tool = handler({
  name: "get_my_tool",
  description: "...",
  inputSchema: toolInputSchemas.get_my_tool,
  outputSchema: toolOutputSchemas.get_my_tool,
  execute: async (input, ctx) => {
    return resolveToolPayload("get_my_tool", input, ctx, async () => {
      try { return await fetchFromProviderA(input); } catch {}
      return emptyPayload("get_my_tool", input);
    });
  },
});
```

Then:

1. Add the tool's input/output schemas to `tools/schemas.ts` (both
   `toolInputSchemas` and `toolOutputSchemas`, plus the file-name mapping
   for fixture loading).
2. Add an empty-payload builder to `tools/empty-payloads.ts`.
3. Re-export from `tools/index.ts`.
4. Add to the appropriate analyst's `tools: [...]` list in
   `agents/analysts/analysts.ts`.
5. Record a snapshot for the tool (run with `dataSource: "record"`) so
   fixture mode still works, or hand-author the fixture JSON per
   `fixtures/README.md` for edge cases.

If the tool needs a new external API, add its fetch helper to a new
`lib/providers/<provider>.ts` file (one per provider). Keep it stateless — read
keys from env, throw on any failure, no caching (the tool handler wraps the
call with `getOrFetch`). A tool that imports flow internals (memo keys, a
flow resource) is **flow-coupled** — it stays with its consumer under
`agents/<group>/tools/`, NOT in the catalog (see `find_counter_evidence`).

## Round-robin patterns

**Phase 2's bull/bear debate is the canonical `roundRobin()` example in this
app.** It uses the pattern's distinguishing features: `terminateWhen`
drives the round count from session state (`maxDebateRounds`),
`uses: [tradingDesk]` resolves the model from `costPreset`, and the two
researcher slots share a single transcript via the contributions accessor.
No referee.

Two conventions when using `roundRobin()` in this app:

1. **Always set `accessorKey` explicitly.** Default `"contributions"` collides
   when multiple round-robins coexist in the same flow. Phase 2 uses
   `accessorKey: "p2Contributions"`.

2. **Declare the contributions resource at the flow root (`resources.ts`,
   the `phase2Contributions` accessor).** Importers (the round-robin instance
   in `agents/research/round-robin.ts`, the capability, the consolidator) all
   pull from there. This keeps the group's import graph cycle-free (see BP-019).

**Phase 4 deliberately does NOT use `roundRobin()`.** It's a plain
sequencer chain — `aggressiveStep.step(conservativeStep).step(neutralStep)`
— even though the prose framing ("three risk officers in round-robin
order") sounds like the pattern. None of `roundRobin()`'s features
apply here:

- `maxRounds` would be `1` (no debate cycling).
- No synthesizer / referee.
- The roster is heterogeneous — the neutral persona has its own output
  schema, so the slots aren't interchangeable.
- The personas don't read a shared transcript; they pull prior critiques
  from the structured persona memos (`memos/p4/{aggressive,conservative}-risk`)
  via per-generator `context` entries. The memo audit trail is the
  richer source — using `roundRobin()` here would force every persona
  through an adapter that flattens the structured output to free-form
  text, then read that text back instead of the typed fields.

Reintroducing `roundRobin()` for Phase 4 would require a `deriveRiskGoal`
input adapter, a `toContributionShape` output adapter on every persona, a
contributions resource, and a debate-transcript capability preset — all
of them with no consumer. Keep it a plain chain.

## Fixture mode

`dataSource` accepts three values: `fixture`, `live`, and `record`.

Fixture mode reads from `fixtures/{TICKER}/{DATE}/` for the requested
`args.date`. The loader is date-addressed: each `{TICKER}/{DATE}/` directory
is one snapshot. `FIXTURE_SNAPSHOT` (`"2026-05-06"`) is the default date for
the curated corpus, not a pin — requesting an unknown ticker or date throws
`FixtureMissingError` loudly, never a silent fallback (in a full run the
pre-flight guard stops with `unresolvable-ticker` before the loader ever
throws). The returned payload
carries the fixture's own `asOf` field, so analysts see the actual data date.

Providers recorded as `source: "unavailable"` survive replay. The loader
preserves the `"unavailable"` tag so a recorded provider miss stays a miss;
any other source tag (`"yahoo"`, `"finnhub"`, etc.) replays as `"fixture"`.

To add a new ticker to fixture coverage, record it:

```bash
pnpm fsdev run analysis analyze -i '{"ticker":"XOM","date":"2026-06-12","dataSource":"record","costPreset":"full"}'
```

See [`fixtures/README.md`](fixtures/README.md) for the full record-mode
workflow and the hand-authoring fallback for edge cases.

## Live mode

Record mode (`dataSource: "record"`) runs the same provider chain as live mode,
so the same API keys apply. Use `costPreset: "full"` when recording to ensure
the eight `discover_*` tools run and the fixture corpus is complete.

Live mode wires Finnhub → Yahoo → FRED → Polymarket as the upstream
providers, plus the `fetch` tool from `@flow-state-dev/tools` for article
bodies, plus Grok (xAI) for social sentiment when `XAI_API_KEY` is set.
Required environment variables:

```
FINNHUB_API_KEY=...      # finnhub.io — fundamentals snapshot, prices, news, insider transactions, institutional ownership
FRED_API_KEY=...         # research.stlouisfed.org — macro indicators + NFCI financial conditions
XAI_API_KEY=...          # xai — Grok-backed social sentiment via xSearch (optional)
ALPHAVANTAGE_API_KEY=... # alphavantage.co — earnings-call transcripts + analyst estimates enrichment + insider fallback (terminal fallback / stub-completer, never primary). Free tier 25 req/day; ALPHAVANTAGE_DAILY_LIMIT tunes the in-process budget guard (0 = unlimited). Optional
MASSIVE_API_KEY=...      # massive.com (rebranded polygon.io) — options chain (Quant) + futures curve (Macro). PAID, per-product (options Starter, futures separate); optional
```

Polymarket, Yahoo Finance, and SEC EDGAR don't require keys.

Massive.com (the rebranded Polygon.io) is the desk's only **futures** and
**options** source — the two asset classes the equity providers above don't
cover. `get_options_chain` (Quant Analyst) reads an option-chain snapshot →
ATM implied vol, IV term structure, 25-delta skew, put/call OI. `get_futures_curve`
(Macro Analyst) reads a benchmark futures basket (ES/NQ/CL/GC/ZN) → front-month
levels + session change, contango/backwardation, and a composite risk tone.
Both are Massive-only (no fallback chain) and tag `source: "massive"`; bearer
auth via `MASSIVE_API_KEY`. Massive bills per asset-class product, so a key
without the options/futures entitlement 401s — which surfaces, correctly, as
`source: "unavailable"`. EOD/delayed data is acceptable (the desk runs on an
as-of date). The per-run rate-budget question for capped providers is deferred
to the multi-provider composition work (FIX-675), not built here.

The macro-flow tools added for the macro-reflexive lens's data needs:
`get_cross_asset_flow` (Macro Analyst) computes risk-on/risk-off ETF spreads
from Yahoo (keyless) — stocks/bonds, credit, cyclicals/defensives,
high-beta/low-vol — into a composite risk-appetite read plus the name's return
vs the broad tape, and reads the Chicago Fed NFCI from FRED for liquidity
directionality (the `liquidity` sub-block is null when `FRED_API_KEY` is
absent; the ETF read still stands). `get_institutional_ownership` (Quant
Analyst) reads 13F institutional positioning from Finnhub `/stock/ownership`
(premium-gated on some plans; degrades to `unavailable`, never fabricated,
when absent). Net-liquidity (WALCL − RRP − TGA) and COT positioning remain
documented follow-ups; futures (Macro, `get_futures_curve`) and options
positioning (Quant, `get_options_chain`) are now built via Massive (see Live
mode below). The lens reads both via the Macro and Quant memos
(`phase1MemosFull`) — there is no lens-specific data wiring.

The three financial statements (`get_balance_sheet` / `get_income_statement`
/ `get_cashflow`) source from **SEC EDGAR XBRL companyfacts first, then Yahoo
`fundamentals-timeseries`, then a bounded IPO-prospectus recovery, then empty
payload**. When companyfacts + Yahoo both miss the subject's valuation-critical
fields — including a newly listed issuer whose companyfacts is HTTP-success but
sparse (null revenue/operating income/FCF) — a single-flight recovery discovers
S-1 / 424B* primaries, transcribes their audited statements with one bounded
model call, hard-validates the result, and promotes it onto the spine tagged
`source: "edgar-prospectus"` (USD billions), else keeps `unavailable` with a
`financialsData.recoveryAudit` trail. It is a correctness path (that one bounded
model call may fire even on `fast`), not analyst color. See [`docs/financials-recovery.md`](docs/financials-recovery.md). EDGAR is the authoritative
US-filing source and answers even when Yahoo throttles its unauthenticated
endpoint (a 200-with-no-data response the Yahoo mapper detects and treats as a
miss). Non-US tickers have no EDGAR CIK and fall through to Yahoo. Statement
fields are nullable: a field a provider doesn't report reads `null`
(unobserved), never `0` — extends the nullable-PE discipline (FIX-692) to the
statements. The legacy Yahoo `*History` quoteSummary modules were dropped:
they returned zero-filled statements in current Yahoo responses.

`get_social_sentiment` is the only Phase 1 tool that routes between a
handler and a generator. Fixture and unavailable are handlers; the
live-Grok path is a generator with the `xSearch` provider tool installed.
The dispatch primitive is a `router` (block kinds differ across routes —
the rest of the Phase 1 tools use `if` inside a handler because every
branch is the same kind). See
[`tools/data/get_social_sentiment.ts`](flows/analysis/tools/data/get_social_sentiment.ts)
as the canonical example of a router-with-LLM-route pattern.

If a live provider fails for a given tool, the tool returns an empty payload
tagged `source: "unavailable"` (see BP-020). It does **not** fall back to
fixture data — that would silently corrupt analyst reasoning. The transcript
pill marks the result `UNAVAILABLE`; the analyst is prompted to treat it as
missing signal, not bearish.

## Running and testing

```bash
pnpm --filter @flow-state-dev/trading-desk dev          # Next.js dev server
pnpm --filter @flow-state-dev/trading-desk typecheck    # tsc --noEmit
pnpm --filter @flow-state-dev/trading-desk test         # vitest run
```

The test suite is offline — every live provider is mocked, every analyst
generator is mocked. Tests verify wiring (resources, memo transitions,
sequencer composition) rather than LLM behavior.

## Verifying changes headlessly

When you change analysis logic, verify it the way `pnpm test` can't — a real run
with a machine-readable result, not the browser. There is **no wrapper script**:
drive `fsdev run` directly. Use the **`fsd:verify-trading-desk`** skill, which
encodes the full workflow, the record→replay cost ladder, and the `RunSummary`
field reference. The short version, run from this directory (`fsdev` config
search is cwd-only):

```bash
SID=verify_$(date +%s)
# 1. The real run (trace + logs to a file; --quiet silences stderr logs).
pnpm fsdev run analysis analyze \
  -i '{"ticker":"NVDA","dataSource":"fixture","costPreset":"fast"}' \
  --session "$SID" --capture ".fsdev/headless/$SID.analyze.json" --quiet \
  > ".fsdev/headless/$SID.analyze.log" 2>&1
# 2. The zero-model read-back — the machine-readable RunSummary.
pnpm fsdev run analysis runSummary \
  -i '{}' --session "$SID" --capture ".fsdev/headless/$SID.summary.json" --quiet
# 3. The decision is the runSummary capture's result.output.
```

`fsdev run` exits **0** when the action ran (completed OR stopped) and non-zero
only on an execution error — so read the summary's `status` to tell completed
from stopped. The `runSummary` action exists because `fsdev run`'s NDJSON/capture
record items and events, not resource VALUES: the desk's decision lives in a
PGlite-backed resource, and this zero-model action is the read-path back out. Its
output is the `RunSummary` (final rating + clamps, target weight + mandate gates,
stop reason, per-memo status, session id) — the shape is in
[`flows/analysis/run-summary.ts`](flows/analysis/run-summary.ts). It
records what happened; it does NOT judge whether the run was good — that is the
job of the run-quality eval suite (`eval/`, see
[Evaluating run quality](#evaluating-run-quality) below).

A single run uses the shared `.fsdev/pglite`, so it appears in Past Reports like a
UI run; set `TRADING_DESK_DATA_DIR` to a temp dir for a throwaway run that
shouldn't. **Default to `fixture` + `fast`**; escalate to `full`, and to a
one-time `dataSource:"record"` run that populates `fixtures/<TICKER>/<DATE>/`,
only when the full flow needs data the corpus lacks — then replay from `fixture`.

**The smoke proof** is the single NVDA fixture run completing with a decision —
the
[`goals/trading-desk-headless/fixture-run-clean`](../../goals/trading-desk-headless/fixture-run-clean/goal.md)
goal check (the same two-step). Fixture mode stubs the data tools but still calls
real models, so it exercises the real generator path.

## Evaluating run quality

The headless harness above records *what happened*; the **run-quality eval suite**
(`eval/`) judges *whether it was good*. It has two layers over the same stored
run, read through a zero-model `runArtifacts` action (the deeper sibling of
`runSummary`): a **deterministic invariant layer** (pure code, zero model spend)
that catches internal contradictions — a rating outside its band, scenario
probabilities that don't cohere, a committed size that ignores the mandate gates,
snapshot/memo mirrors that disagree — and an **LLM-judge layer** that scores the
four qualitative dimensions code can't check (evidence quality, debate engagement,
PM coherence, confidence calibration) on a blinded bundle, with a pinned judge
model distinct from the desk's generators.

Three commands (from this directory):

```bash
pnpm eval sweep    --manifest <file.json> [--concurrency 2] [--out .fsdev/eval] [--data-dir <path>] [--judge-model <id>] [--no-judges] [--max-cost-usd <n>]
pnpm eval eval     --session <id> [--session <id> ...] [--data-dir <path>] [same flags]
pnpm eval variance --session <id> [--session <id> ...] [--data-dir <path>] [--k 5]
```

`sweep` uses one framework runtime and one isolated PGlite backing (`<out>/data` by
default) for the batch, with session IDs isolating concurrent runs. `eval` and
`variance` default to the shared app store; pass `--data-dir <sweep-out>/data` to
read a sweep. Each command uses one backing. `eval` evaluates already-stored
sessions; `variance` characterizes the judge's own noise so a score delta can be
told from randomness. `--max-cost-usd` is one command-wide judge budget shared
across all requested sessions; an unknown-cost failure exhausts the remaining
headroom rather than resetting the cap for the next session.
Every evaluated run appends one separable `QualityRecord` line to
`<out>/scoreboard.jsonl` (deterministic tally + per-dimension judged `{mean, std, k}`,
never a composite) with a full detail sidecar alongside. **Exit code is non-zero
when any run errored or any HARD invariant failed** — soft flags and judge scores
never gate. The goal check is
[`goals/trading-desk-eval/fixture-batch-scored`](../../goals/trading-desk-eval/fixture-batch-scored/goal.md).
Full methodology (check groups, rubric anchors, the record shape, the measured
noise bands, and the v1 limitations) is in
[`docs/run-quality-eval.md`](docs/run-quality-eval.md).
