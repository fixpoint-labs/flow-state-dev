# Trading Desk — Agent Guide

The trading-desk is a multi-agent flow that produces a structured
trade recommendation for a given ticker. It's a real app — live market data,
durable re-openable reports, a real imported portfolio — built on a non-trivial
flow with capabilities, a self-contained tool catalog, per-tool files, and
fixture/live data modes. It lives in `labs/`, not `examples/`: past a teaching
snippet, still research software.

The pipeline is organized by **identity, not phase**: participants live under
`agents/` (one directory per analyst group / trader / risk / PM / etc.), the
tool catalog lives under `tools/`, and the only code that knows execution order
lives under `orchestration/`. "Phase" survives as render-time labels
(`component: "phase-*"`), not as code structure.

When modifying this app, follow the conventions below. The patterns here
are also written up in the project-level docs — read those first if you
haven't:

- [`docs/contributing/best-practices.md`](../../docs/contributing/best-practices.md) — hard rules (BP-001 through BP-020)
- [`docs/contributing/building-apps.md`](../../docs/contributing/building-apps.md) — patterns and tradeoffs
- [`docs/architecture/capabilities.md`](../../docs/architecture/capabilities.md) — capability model

## Layout

The tree is grouped by **identity** (`agents/`), **catalog** (`tools/`), and
**composition** (`orchestration/`). The flow contract stays at the root.

```
src/flows/trading-desk/
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
  prompts/_partials/             shared prompt fragments ({% render %} targets); the loader anchors
                                 PARTIALS_DIR here, so this stays at the flow root (not per-agent)

  agents/                        participants grouped by identity; each module exports its BUNDLED step
    _recipe/                     shared per-group factories
      define-analyst.ts          defineAnalyst — per-analyst sub-sequencer factory (was phase-1/analyst.ts)
      approach-generator.ts      createApproachGenerator — fast-model approach preamble (was lib/)
      memo-writer.ts             defineMemoWriter — per-group markWriting / markError / commit factory (was lib/)
      memo-setup.ts              defineMemoSetup — pre-create memo scaffolds per group (was lib/)
    analysts/                    the nine analysts (was phase-1/)
      analysts.ts                the analyst sub-sequencers (each ~10 lines via defineAnalyst)
      thesis-schema.ts           Thesis output shape (shared by every analyst generator + writer)
      setup.ts                   setupPhase1Memos (defineMemoSetup)
      writer.ts                  markWriting / commitMemo / markError (defineMemoWriter)
      prompts/                   per-analyst *.prompt.md system prompts
    research/                    bull / bear / research manager (was phase-2/)
      generators.ts round-robin.ts validate-citations.ts writer.ts setup.ts prompts.ts
      prompts/                   bull/bear/manager *.prompt.md
      tools/find_counter_evidence.ts  FLOW-COUPLED tool (imports memo keys — NOT in the catalog)
    lenses/                      the lens pack (was phase-2b/ + lens-owned lib + resource)
      lens-generator.ts lens-step.ts lens-verdict-schema.ts lens-body-sections.ts writer.ts setup.ts
      lenses.ts                  LENS_PACK config (was lib/lenses.ts)
      convergence-math.ts        pure convergence math (was lib/convergence-math.ts)
      lens-convergence-resource.ts  the lens-owned convergence resource (§2.4)
      prompts/                   lens.prompt.md
    trader/                      trader.ts approach.ts writer.ts setup.ts prompts/ (was phase-3/; owns its output schema)
    risk/                        personas.ts (3) consolidator.ts schemas.ts approach.ts writer.ts setup.ts prompts/ (was phase-4/)
    scenario-forecaster/         scenario-forecaster.ts approach.ts writer.ts setup.ts prompts/ (was phase-5/)
    portfolio-manager/           portfolio-manager.ts approach.ts writer.ts setup.ts prompts/ (was phase-5/; owns its output schema)
    thesis-validator/            thesis-validator.ts approach.ts writer.ts setup.ts prompts/ (was phase-6/)

  tools/                         THE catalog — self-contained, liftable
    data/                        one file per data tool — get_*.ts + discover_*_context.ts (mode branch + provider chain)
    schemas.ts                   shared zod schemas + ToolName / ToolInput / ToolOutput
    empty-payloads.ts            schema-valid zeros for "unavailable" results
    indicators-math.ts           pure RSI/MACD/ATR/SMA functions
    index.ts                     barrel re-export
    runtime/                     tool runtime (was lib/)
      cache.ts                   process-wide TTL cache (getOrFetch)
      fixtures.ts                loadFixture(tool, args)
      discover.ts                web-search → DiscoveryPayload shape
    providers/                   external API clients — stateless, throw on failure (was ../providers/)
      finnhub.ts                 Finnhub fetch helpers (incl. institutional ownership)
      fred.ts                    FRED per-series fetch + retry (macro indicators + NFCI)
      yahoo.ts                   Yahoo Finance fetch helpers (quoteSummary + fundamentals-timeseries)
      yahoo-timeseries.ts        pure mapper: fundamentals-timeseries → 3 statements
      edgar.ts                   SEC EDGAR client (ticker→CIK lookup + companyfacts fetch)
      edgar-filings.ts           EDGAR filings: submissions list, section extraction, red-flag probes
      edgar-companyfacts.ts      pure mapper: us-gaap companyfacts → 3 statements
      eight-k-items.ts           pure mapper: 8-K item codes → typed material events with signal tier
      web.ts                     homepage meta + web-search fallback
      xai.ts                     Grok (xAI) credentials + model id

  orchestration/                 composition only — the ONLY code that knows execution order
    analyze.ts                   the analyze sequence + guard wiring (was flow.ts's analyzePipeline body)
    stages.ts                    per-group setup taps + fan-out / round-robin / chain assembly (was every phase-*/index.ts)
    guards.ts                    seedSession, checkTickerResolvable, checkPhase1HasData/FundamentalsAndProfile, setInstructions

  lib/                           pure IO-free utilities — neither tool-runtime nor recipe
    helpers.ts                   tickerDate / asDataBlock / memoLabel / attributedTools
    format.ts                    shared prompt formatters (memo, debate, contributions)
    prompt.ts                    loadPrompt(path) — resolves *.prompt.md relative to the flow root
    ticker-resolver.ts           pre-flight ticker probe
    concurrency.ts               mapLimit — bounded + retried fan-out
    valuation.ts valuation-spine.ts fair-value.ts expected-return.ts
    rating-engine.ts setup-score.ts sector-resolution.ts   (analysis / scoring math)

  portfolio/                     Portfolio domain (Spine B) — accounts (holdings inline) + CSV + getQuotes
    portfolio-schema.ts          pure leaf: account schema (holdings inline), holdingSchema/Holding, CanonicalRow
    portfolio-csv.ts             pure leaf: tolerant CSV parser (synonym mapping, validation, dedupe-merge)
    portfolio-resources.ts       BP-019 leaf: accountsCollection (user-scoped, flow-isolated; holdings live inline)
    portfolio-quotes-resource.ts session-scoped resource getQuotes writes (sendAction returns no output)
    portfolio-actions.ts         saveAccount / deleteAccount / importHoldings / deleteHolding handlers
    get-quotes.ts                getQuotes read handler (last-close per ticker, fixture/live, null degrades)
    portfolio-pdf.ts             pure leaf: strict pdfExtractionSchema + reconcile() + canonical mapping
    portfolio-pdf-resource.ts    session-scoped pdfImport scratch resource (dialog reads via useResource)
    extract-pdf-text.server.ts   NODE-ONLY: unpdf (worker-free pdfjs) — PDF bytes → statement text
    extract-holdings-generator.ts broker-agnostic LLM transcription (statement text → strict rows)
    extract-holdings-action.ts   sequencer: decode bytes → extractPdfText → generator → commit pdfImport

fixtures/<TICKER>/2026-05-06/    pinned snapshot for fixture mode
```

### Conventions enforced by this layout

- **A participant is found in one place.** Each agent group under `agents/`
  bundles its generators, its memo `setup.ts` + `writer.ts`, its output schema,
  and its `prompts/`. To read or edit the trader you open `agents/trader/`, not
  three scattered files.
- **Shared factories live in `agents/_recipe/`.** `defineMemoWriter`,
  `defineMemoSetup`, `createApproachGenerator`, and `defineAnalyst` capture the
  shapes every group repeats. Each group's `setup.ts` and `writer.ts` is ≤ 15
  lines + the per-group commit projections.
- **Single-consumer output schemas live next to the generator that emits
  them.** `agents/trader/trader.ts` and `agents/portfolio-manager/portfolio-manager.ts`
  declare their output schemas inline; the writer imports the type back. Multi-
  consumer schemas (the analysts' `thesisOutputSchema`, risk's persona +
  risk-assessment schemas) stay in a `thesis-schema.ts` / `schemas.ts` file in
  the group.
- **`tools/` is the self-contained catalog.** `tools/data/` is one file per
  data tool, `tools/providers/` is external API clients (stateless,
  throw-on-failure, no caching — callers wrap with `getOrFetch` from
  `tools/runtime/cache.ts`), `tools/runtime/` is the cache + fixtures +
  discovery runtime. A flow-coupled tool (one that imports flow internals, like
  `find_counter_evidence`) stays with its consumer under `agents/`, NOT in the
  catalog.
- **`orchestration/` is the only code that knows execution order.** `stages.ts`
  assembles each group's setup tap + step into a stage; `analyze.ts` chains the
  stages behind the guards; `flow.ts` is `defineFlow` only. Import direction is
  one-way: orchestration imports agents; agents never import orchestration
  (BP-019 — acyclic).
- **`lib/` is for pure IO-free utilities that are neither tool-runtime nor a
  recipe** — formatters, the ticker resolver, concurrency, and the valuation /
  scoring math. Identity lives in `registry.ts`; contract lives in
  `resources.ts` / `state.ts` / `flow-schema.ts`.

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
path. Persistence is `developmentOnly: true` filesystem store — history does not
survive an ephemeral/serverless redeploy; swap the `lib/server.ts` `stores:`
seam for a real store before relying on it.

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
the `portfolio/` flow folder (Spine B). It is the durable record of what the user
owns; it does NOT do portfolio-aware analysis or sizing (a later slice).

- **Data model — one collection; holdings live inside the account.** `accounts`
  (`accounts/*`, keyed `accountId`) is the only collection — user-scoped +
  `flowIsolation: true`, so it persists under `{userId}:trading-desk` on the
  existing filesystem store (no new store adapter, no `StoreRegistry` change).
  Each account record carries its positions inline as
  `accountStateSchema.holdings: Holding[]` (a `Holding` is exactly a
  `CanonicalRow`). The per-account record is the write unit: an import is ONE
  write to one account, not one write per ticker. That suits this small,
  rarely-changing, batch-written JSON — there is no concurrent-row-write race to
  isolate, so the earlier per-holding-key scheme was over-modeled. The same
  ticker in two accounts is simply two entries, one per account's array.
- **Schemas are RESOURCE STATE, not generator outputs.** `.default()` /
  `.nullable()` are fine (BP-016 only constrains generator outputs). Do NOT add
  them to `output-schemas-strict.spec.ts`. Cost basis is **average cost
  (informational)**, forward-compatible to tax-lots; tax-lots / realized P/L /
  dividends are documented future seams, not built.
- **CSV import** (`portfolio-csv.ts`) is a PURE, browser-safe parser: a synonym
  table maps real brokerage headers, bad rows are REPORTED (with 1-based row
  numbers) never thrown, duplicate tickers merge to a quantity-weighted average
  cost, a bare `price` column maps to cost basis with a warning. The dialog runs
  it client-side for the live preview; the `importHoldings` action re-parses
  server-side (never trusts the client) and returns an `ImportReport`. Default
  mode is `upsert` (non-destructive); `replace-account` is destructive, non-atomic
  (RISK-P6), and requires a typed `REPLACE` confirmation. See
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
  currently a static "extracting" state.
- **Prices** come from `getQuotes` — a read handler that reuses
  `get_price_history`'s fetch idiom directly (`loadFixture` / `getOrFetch`, NOT
  `block.run()` — BP-011-safe) and takes the last bar's `close`. A missing /
  unavailable price degrades to `null` (UI shows `—`), never a fabricated number;
  live mode never silently substitutes fixture data. Because `sendAction` returns
  a request envelope (NOT the handler output) in this runtime, `getQuotes` writes
  its result to the session-scoped `portfolioQuotes` resource; the pane reads it
  via `useResource` after `session.refresh()`. **The pane always requests `live`
  prices, decoupled from the analysis fixture/live toggle** — holdings are real,
  and fixtures only cover the 3 demo tickers (AAPL/JPM/NVDA), so a fixture-priced
  real portfolio is mostly `—`. The live fan-out is **bounded + retried** via the
  shared `lib/concurrency.ts` `mapLimit` (cap `QUOTE_CONCURRENCY`, per-ticker
  `QUOTE_RETRIES` with backoff) so a 20+ holding portfolio doesn't trip Yahoo's
  rate limiter and drop a random subset to `—`.
- **Derived money math** (market value, weight %, unrealized P/L, rollups) lives
  in `components/portfolio/portfolio-format.ts` (pure) and is computed in
  `useMemo` (BP-010), never stored — it depends on a live quote and the whole-
  portfolio total. Money figures are labeled display approximations; a live +
  as-of provenance line sits near the totals.
- **Empty-state binding (spec §12.1):** user-scoped reads need a bound session
  snapshot. We take the honest empty-state CTA (option b), NOT auto-minting a junk
  session (option a) — the pane prompts the user to run an analysis first when no
  session exists. Once any session is bound, Add Account / Import work.

## Portfolio-aware analysis + lens pack (Slice 5)

A run can carry the live portfolio so the trader and the PM size against real
positions, and a pack of documented-methodology investor LENSES re-reads the
evidence to produce a convergence signal the PM uses for sizing conviction.

- **The portfolio snapshot is built CLIENT-SIDE at dispatch.** Slice 4 stores
  `quantity` / `costBasis` per holding but NOT market value, weight, NAV, or
  sector. `app/page.tsx` reads the Slice-4 `accounts` + the live
  `portfolioQuotes` resource and calls
  `portfolio/build-portfolio-context.ts` (a pure leaf) to compute the snapshot:
  per-holding `marketValue = quantity × live quote`, `totalNav = Σ known
  marketValue + Σ cash`, `weightPct = marketValue / totalNav`. A ticker with no
  live quote degrades to `marketValue: null` / `weightPct: null` — NEVER a
  fabricated price. The snapshot carries `snapshotAsOf` (the quotes' as-of) and
  `pricedHoldings` / `totalHoldings` so the prompt + UI label staleness and
  coverage honestly. The flow freezes it onto session state at `seedSession`
  (the `userThesis` precedent) and NEVER recomputes weights. Null → the run is
  portfolio-blind exactly as before. The input/state field names are the flow's
  own (`portfolioContextInput`), mapped from the Slice-4 account shape in the
  builder.
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
  memo. The steps are chained SEQUENTIALLY (not `.parallel`) for a runtime
  reason: this runtime does not merge all parallel branches' collection writes
  back into the continuation's resource cache, so a convergence tap after a
  parallel fan-out reads a stale view (3 of 4 lens memos still `pending`). A
  sequential chain commits each memo before the next runs, so the convergence
  tap sees all N. Sequential ≠ debate — each lens is still blind. Lens verdict
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
[`capability.ts`](src/flows/trading-desk/capability.ts).

### Adding a Phase 1 analyst

Each analyst is one `defineAnalyst({ shortName, tools, generator })` call.
The factory captures the universal recipe: `markWriting → .map(tickerDate)
→ .parallel(attributedTools) → generator → commitMemo, rescue(markError)`.
The call site supplies only what varies — the role's tools and its
synthesis generator. See [`agents/analysts/analysts.ts`](src/flows/trading-desk/agents/analysts/analysts.ts)
for the nine existing analysts.

To add another:

1. Add the agent to `AGENTS` and `PHASE_1_MEMO_KEYS` in `registry.ts`.
2. Add a new `discover_<role>_context.ts` tool if it needs web discovery,
   plus any role-specific `get_*` tools (in `tools/data/`).
3. Write the generator (output `thesisOutputSchema`).
4. Call `defineAnalyst({...})` in `agents/analysts/analysts.ts`.
5. Wire it into the `analystFanOut` `.parallel({...})` in `orchestration/stages.ts`.

### Adding a group setup or writer

Two factories collapse the per-group boilerplate (both in `agents/_recipe/`):

- `defineMemoSetup({ phaseId, agentTeam, keys, activePhase })` in
  `agents/_recipe/memo-setup.ts` — pre-creates the group's memos in `pending`. The
  memoStatus seed is derived from `Object.keys(keys)` so adding a new
  memo to a group is a one-line edit to `registry.ts`.
- `defineMemoWriter({ phaseId, agentTeam, keys, errorMessageFallback,
  errorTextPlaceholder? })` in `agents/_recipe/memo-writer.ts` — returns
  `{ markWriting, markError, defineCommit }`. Each group's `writer.ts`
  destructures `markWriting` and `markError`, then calls
  `writer.defineCommit({ shortName, inputSchema, project, afterCommit? })`
  for each commit handler. `project` returns the patch applied on top of
  the standard `status: "published" / completedAt / errorMessage: null`
  fields; `afterCommit` runs any group-terminal session-state work (the PM
  group uses it to flip `runComplete`).

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

## Adding a new tool

Tools follow the per-tool-file pattern. Each tool file owns its mode
branch, provider preference, and fallback chain.

```ts
// tools/data/get_my_tool.ts
import { handler } from "@flow-state-dev/core";
import { getOrFetch } from "../runtime/cache";
import { loadFixture } from "../runtime/fixtures";
import { fetchFromProviderA } from "../providers/providerA";
import { emptyPayload } from "../empty-payloads";
import { pickMode, toolInputSchemas, toolOutputSchemas } from "../schemas";

export const get_my_tool = handler({
  name: "get_my_tool",
  description: "...",
  inputSchema: toolInputSchemas.get_my_tool,
  outputSchema: toolOutputSchemas.get_my_tool,
  execute: async (input, ctx) => {
    if (pickMode(ctx) === "fixture") return loadFixture("get_my_tool", input);
    return getOrFetch("get_my_tool", input, async () => {
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
5. Add a curated fixture JSON under
   `fixtures/<TICKER>/2026-05-06/<tool-file-name>.json` so fixture mode
   still works.

If the tool needs a new external API, add its fetch helper to a new
`tools/providers/<provider>.ts` file (one per provider). Keep it stateless — read
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

Fixtures are a single pinned snapshot at `2026-05-06` (the
`FIXTURE_SNAPSHOT` constant in
[`tools/runtime/fixtures.ts`](src/flows/trading-desk/tools/runtime/fixtures.ts)). The
loader ignores `args.date` and always reads from the snapshot directory. The
returned payload carries the fixture's own `asOf` field, so analysts see the
actual data date.

When adding a new ticker to fixture coverage:

1. Create `fixtures/<TICKER>/2026-05-06/`.
2. Drop in one JSON per tool (see existing `fixtures/NVDA/2026-05-06/` for
   the shape — names match `fixtureFileName(tool)`). The Phase 1 file set
   includes `insider-transactions.json` (90 days of Form 4 rows for the
   news analyst).
3. The framework needs no other registration.

## Live mode

Live mode wires Finnhub → Yahoo → FRED → Polymarket as the upstream
providers, plus the `fetch` tool from `@flow-state-dev/tools` for article
bodies, plus Grok (xAI) for social sentiment when `XAI_API_KEY` is set.
Required environment variables:

```
FINNHUB_API_KEY=...      # finnhub.io — fundamentals snapshot, prices, news, insider transactions, institutional ownership
FRED_API_KEY=...         # research.stlouisfed.org — macro indicators + NFCI financial conditions
XAI_API_KEY=...          # xai — Grok-backed social sentiment via xSearch (optional)
```

Polymarket, Yahoo Finance, and SEC EDGAR don't require keys.

The macro-flow tools added for the macro-reflexive lens's data needs:
`get_cross_asset_flow` (Macro Analyst) computes risk-on/risk-off ETF spreads
from Yahoo (keyless) — stocks/bonds, credit, cyclicals/defensives,
high-beta/low-vol — into a composite risk-appetite read plus the name's return
vs the broad tape, and reads the Chicago Fed NFCI from FRED for liquidity
directionality (the `liquidity` sub-block is null when `FRED_API_KEY` is
absent; the ETF read still stands). `get_institutional_ownership` (Quant
Analyst) reads 13F institutional positioning from Finnhub `/stock/ownership`
(premium-gated on some plans; degrades to `unavailable`, never fabricated,
when absent). Net-liquidity (WALCL − RRP − TGA) and options/COT positioning
are documented follow-ups, not built. The lens reads both via the Macro and
Quant memos (`phase1MemosFull`) — there is no lens-specific data wiring.

The three financial statements (`get_balance_sheet` / `get_income_statement`
/ `get_cashflow`) source from **SEC EDGAR XBRL companyfacts first, then Yahoo
`fundamentals-timeseries`, then empty payload**. EDGAR is the authoritative
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
[`tools/data/get_social_sentiment.ts`](src/flows/trading-desk/tools/data/get_social_sentiment.ts)
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
