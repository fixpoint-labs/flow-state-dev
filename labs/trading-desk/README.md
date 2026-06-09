# Trading Desk

> **Research only.** Not financial advice. No order execution. No P&L tracking.

A multi-phase AI research desk for a single stock. Type a ticker: analyst memo
slots appear in the navigator, a bull/bear debate unfolds, a research manager
synthesizes an investment thesis, a trader proposes a sized trade, three risk
officers critique it, and a portfolio manager hands down a five-tier rating plus
a portfolio-fit verdict. Five phases, twenty-plus agents, one structured artifact
at every convergence point.

Built on `@flow-state-dev`. It lives in `labs/`, not `examples/`, because it has
outgrown a teaching snippet: it pulls live market data, imports a real portfolio,
persists re-openable reports, and reasons about position sizing across accounts.
It is still research software — see "What this is not" — but a working app, not a
demo.

## What's included

Phase 1 — analyst fan-out:

- **Parallel analyst fan-out** — nine sub-agents (Fundamentals, Sentiment,
  News, Technical, Company Profile, Market, Macro, Quant, Disclosure) running
  in parallel, each with a distinct identity.
- **Investigative discovery + auditable citations** — on the `full` cost
  preset each analyst gets a deterministic per-role web-search step
  (`discover_*_context`) that surfaces up to 5 numbered URLs. The analyst
  may read 2–3 via the `fetch` tool when the structured data leaves a
  material question open. Every URL it relies on goes into a `citations`
  field that renders as a "Sources" footer on the analyst card. The
  `fast` preset keeps the cheap path cheap — discovery returns
  `source: "skipped"`, `fetch` is absent, and the `<investigation>` clause
  is suppressed from the prompt. The contract lives in the `investigate`
  preset of the `tradingDesk` capability.
- **Company Profile grounding** — a renderer-style analyst that fetches
  structured business identity (sector, industry, business description,
  scale) from public providers and writes it as a memo, so downstream
  phases reason from a data-derived baseline rather than the model's
  training priors. Live mode merges Finnhub and Yahoo so each fills in
  what the other doesn't carry; when the description is still thin, two
  web-enrichment backstops kick in — a homepage `<meta name="description">`
  fetch and a web search via `@flow-state-dev/tools/search`'s
  auto-detected provider (Tavily / Exa / Perplexity / Serper / Brave).
  Each backstop fails soft to `null`. Returns an explicit `unavailable`
  memo when the ticker cannot be resolved.
- **Typed memo resources** — every analyst writes a structured `Thesis`-shape
  memo readable via the standard resource hook.
- **Two-pane streaming UI** — transcript on the left, theses on the right.
- **Fixture / live data toggle** — fixtures ship for `NVDA / 2026-05-06`,
  `AAPL / 2026-05-06`, and `JPM / 2026-05-06`. Live prices and fundamentals
  via `yahoo-finance2` (no key required).
- **Wider technical indicator set** — RSI, MACD, ATR, SMA50/200, trend label,
  Bollinger Bands, VWMA(20), Stochastic Oscillator (%K/%D), KDJ, and OBV. The
  math is delegated to the `trading-signals` library with two small
  hand-rolled helpers (VWMA, KDJ).
- **Tier 1 valuation metrics** — the fundamentals analyst derives enterprise
  value, EV multiples (EV/Sales, EV/EBIT, EV/FCF), Price/Book, FCF yield,
  earnings yield, ROA, net debt, ROIC, PEG/PEGY, and dividend yield from
  already-fetched statements. Each metric is null when its inputs are absent;
  proxy metrics (EV/EBIT, ROIC, PEG) are labeled as approximations. No new
  provider calls.
- **Insider transactions signal** — the news analyst reads 90 days of Form 4
  filings (`get_insider_transactions`, Finnhub-only; returns `unavailable`
  on failure, like other single-provider tools).
- **Disclosure signal** — the disclosure analyst reads the latest SEC filing
  (10-K / 10-Q / 8-K) text, sell-side ratings and earnings beat/miss history,
  and (optionally) the latest earnings-call transcript. It also surfaces recent
  material corporate events typed by 8-K item code (leadership changes, material
  agreements, earnings, restructurings) as a dated, source-linked catalyst
  signal within a trailing 90-day window. `get_sec_filings` is keyless (EDGAR,
  no new API call for material events), `get_analyst_estimates` uses Finnhub
  (existing key), `get_earnings_transcript` requires `FMP_API_KEY` (free tier,
  optional). When a source is unavailable the analyst applies the standard
  missing-signal treatment — the filing + ratings read ships without the
  transcript, and "none observed" when there are no recent material events.
- **Social sentiment signal** — the sentiment analyst reads 7-day X/Twitter
  sentiment via Grok's `xSearch` hosted tool (`get_social_sentiment`,
  xAI-only via `XAI_API_KEY`; returns `unavailable` on absence, like other
  single-provider tools). The payload carries both the numeric score and a
  `posts` array of representative X excerpts (handle + one-sentence
  verbatim quote + per-post polarity), so the analyst reasons from the
  actual quotes rather than a single non-deterministic score.
  `shortInterestPct` is `null` on the xAI path — short interest can't be
  measured from chatter, and a fabricated 0 would read as "no shorts."
- **Derivatives & futures signals (Massive)** — two signals the desk has no
  other provider for, sourced from Massive.com (rebranded Polygon.io). The
  quant analyst reads an options-chain snapshot (`get_options_chain`): ATM
  implied vol, IV term structure, 25-delta skew, and the put/call open-interest
  balance. The macro analyst reads a benchmark futures curve
  (`get_futures_curve`): front-month levels and session change for ES / NQ / CL
  / GC / ZN, contango/backwardation, and a composite cross-asset risk tone.
  Both are Massive-only (no fallback); each derived field is nullable and the
  tools return `unavailable` when no key/entitlement is present, like other
  single-provider tools.
- **Status-bar disclaimer** visible on every run.

Phase 2 — research debate:

- **Bounded bull-vs-bear loop** — the Round Robin pattern drives a fixed
  number of turns where each side argues from the analyst memos and prior
  contributions. Cheap preset runs one round; full preset runs two.
- **Three p2 memos** — `bullResearcher`, `bearResearcher`, and
  `researchManager` each cycle `pending → writing → published`. Bull and
  bear consolidate their loop turns into typed `BullThesis` / `BearThesis`
  memos. The research manager synthesizes both into an `InvestmentThesis`.
- **Explicit unresolved disagreements** — the `InvestmentThesis` carries a
  `unresolvedDisagreements` list. Empty is acceptable but should be the
  exception on a non-trivial trade. Phase 3+ read this directly to reason
  about non-convergence.
- **Identity-driven transcript** — each turn shows the round number and the
  speaking agent; the research manager's structured thesis renders as a
  collapsible card in the transcript.

Phase 3 — trader synthesis:

- **Approach preamble** — a fast-model (`intent/utility`) free-text step
  streams a one-sentence plan to the transcript before the structured
  trader runs. Display-only; not fed into the trader.
- **Single-shot structured synthesis** — one trader generator, no loop.
  Reads the Phase 2 `InvestmentThesis` and writes a typed `TradeProposal`.
- **Typed extension fields** — `direction`, `sizePct`, `stopPrice`,
  `targetPrice`, `holdingPeriod`, `invalidationCriteria`, `dependsOn`.
  These keep the trader's output auditable rather than opaque LLM JSON,
  and let Phase 4 (risk) and Phase 5 (PM) read structured values without
  parsing strings.
- **Cost-preset gates prompt depth** — the cheap preset reads the thesis
  and its extension fields only; the full preset adds the nine analyst
  memos and the full bull/bear debate transcript.

Phase 4 — risk debate:

- **Per-agent approach preambles** — each of the three personas and the
  consolidator stream a short fast-model (`intent/utility`) preamble
  before their structured generator runs. Personas are `sub` agents and
  don't emit struct cards, so the preambles are their only
  transcript-visible output; the structured critique still lands in the
  memos pane.
- **Three risk personas in fixed order** — `aggressiveRisk`
  (push for outsized sizing), `conservativeRisk` (push for tighter risk),
  `neutralRisk` (filter signal from noise). Each runs as its own step in
  a plain sequencer chain. Personas after the first read prior critiques
  from the persona memos via memo-backed `context` entries on their
  generator definitions — no shared transcript resource.
- **Four p4 memos** — three persona critiques plus a consolidated
  `riskAssessment`. The persona memos are the audit trail; the
  `riskAssessment` is the artifact Phase 5 reads.
- **Neutral filters, doesn't argue** — the neutral persona reads the
  aggressive and conservative memos in order and populates
  `dismissedRisks` with the load-bearing call on what does not warrant
  action. A consolidator then re-filters and attributes recommendations
  back to specific personas.
- **Per-persona rescue keeps the loop running** — each roster slot wraps
  its generator in a small sub-sequencer with its own `.rescue`, so a
  single persona's failure flips only that memo to `error` and the
  remaining personas still run.
- **Cost-preset gates prompt depth** — the cheap preset reads the trade
  proposal, the investment thesis, and prior persona memos; the full
  preset adds the nine analyst memos and the full bull/bear debate
  transcript.

Phase 5 — portfolio manager:

- **Approach preamble** — same shape as Phase 3: a fast-model preview of
  how the PM intends to weigh the trade proposal against the risk
  assessment, streamed before the structured decision lands.
- **Final converging step** — a single `portfolioManager` generator reads
  the always-on upstream artifacts (Phase 2 investment thesis, Phase 3
  trade proposal, Phase 4 risk assessment) and writes a typed
  `PortfolioDecision`. On the `full` preset it also reads the nine
  analyst memos, the full bull/bear debate transcript, and the three
  persona risk critiques.
- **Five-tier rating** — `finalRating` is one of `Sell`, `Underweight`,
  `Hold`, `Overweight`, `Buy`. The vocabulary mirrors the design
  reference and the TradingAgents v0.2.2+ scale; a `decisionSummary`
  field carries the one-line subhead, and `decisionConfidence` (0.0–1.0)
  is the PM's self-reported uncertainty.
- **Explicit accept-or-override** — for each of the three risk-team
  recommended adjustments (sizing, holding period, invalidation), the
  PM marks `applied: true | false` with a one-sentence reason. Rubber-
  stamping is fine if the risk team is right; overriding is fine if the
  PM can name what they missed. The structured field is the dissent
  surface.
- **PM Hero, same plumbing as every other memo** — the right-pane PM
  Hero renders the rating bar, the design-mandated metrics row (rating
  / ticker / window / size / stop / target), the accepted-adjustments
  panel, the key dependencies list, and a static list of upstream
  references. It dispatches off the same `useResourceCollectionItem`
  hook every other memo uses. No special-case data flow for the marquee
  surface.
- **Derived, not LLM-emitted** — `agreesWithTrader` is computed at
  commit time by comparing `finalRating`'s implied direction
  (Buy/Overweight → long, Hold → flat, Underweight/Sell → short)
  against the trader memo's `direction` field. `upstreamReferences`
  is built from the canonical memo-key maps. Asking the LLM to mirror
  values it has no reason to know would add hallucination surface
  for no gain.
- **`session.runComplete` flips on success** — the flag resets to
  `false` at `seedSession` and becomes `true` only after the PM memo
  publishes, so the status bar (and any future affordance) can render
  a terminal "complete" state without inferring it from item counts.

Portfolio-aware analysis + lens pack (optional):

- **A supplied portfolio makes sizing concrete** — when a run carries a
  portfolio snapshot (the user's accounts + live quotes, read server-side at
  `seedSession` from the shared user-scoped `accounts` and `portfolioQuotes`
  resources and frozen onto session state), the trader and PM see a
  `<portfolioContext>` block: existing position, current weight, available
  cash, account types. The PM then emits a `portfolioFit` verdict —
  `action` (initiate / add / trim / exit / hold), a `targetWeightPct`, a
  sizing rationale that references the existing position, a concentration
  read, and a suggested account validated against the real account list
  (a hallucinated label resolves to none, never an invented account).
  With no portfolio data the run stays portfolio-blind exactly as before.
  Market value, NAV, and weight are computed from stored quantity × a
  sourced live quote; a missing quote degrades to a dash, never a
  fabricated price, and the panel shows the snapshot's as-of so a frozen
  snapshot never reads as live.
- **An investor-lens convergence signal (Phase 2b, `full` only)** — after
  Phase 2, four documented-methodology lenses (Quality-Value, Cycle/Risk,
  Macro-Reflexive, Forensic-Skeptic) independently re-read the same
  evidence bundle and each emit their own verdict, blind to one another. A
  deterministic handler — not an LLM — computes whether they converge or
  diverge, and the PM reads that as a conviction input: a call that holds
  across philosophies can take the PM's full size, a philosophy-dependent
  one is sized down. It is independent parallel reading, not a staged
  debate, and convergence means "robust across philosophies," not "likely
  correct." On the `fast` preset the pack is skipped entirely.

## Run it

```bash
pnpm install
pnpm --filter @flow-state-dev/trading-desk dev
```

Defaults to `NVDA / 2026-05-06`. The top bar exposes four controls:

- **ticker** — text input, defaults to `NVDA`.
- **date** — text input, defaults to `2026-05-06`.
- **preset** — `fast` (cheap utility models) or `full` (higher-tier chat models).
  Resolved via the model resolver's `intent/utility` and `intent/chat` intents,
  so the concrete model depends on which provider key is configured.
- **source** — `fixture` (canonical hand-curated JSON) or `live` (SEC EDGAR +
  Yahoo Finance + Finnhub + FRED + Polymarket for structured data; Grok via
  `xSearch` for social sentiment when `XAI_API_KEY` is set; tools whose provider
  key is absent return `unavailable`). The three financial statements
  (balance sheet, income statement, cash flow) come from SEC EDGAR XBRL
  filings first, falling back to Yahoo for non-US filers.

Press **re-run** to dispatch a new `analyze` request.

The cheap-preset run completes end-to-end in well under a minute on default
models with one provider key configured. Each analyst writes a structured
`Thesis` resource observable via `useResourceCollection`; the navigator's live
`pending → writing → published` flicker comes straight from that resource. The
memos collection is `client: { live: true }`, so each status change streams to
the client inline and `useResourceCollectionList` reflects it with no refetch —
there is no separate session-state status field to keep in sync.

## Persistence and sessions

Analysis history survives server restarts. Each run is one session, and the
four inputs at the top of the page name it: `(ticker, date, preset, source)`.

- Re-running with the same four inputs reuses the existing session and
  refreshes its data. Memo resources have deterministic keys, so they
  overwrite in place (the setup taps re-create each memo in `pending`);
  `runComplete` resets via `seedSession` at the start of each request.
- Changing any one of the four inputs starts a new session. Its title is
  derived from the tuple (`NVDA · 2026-05-06 · fast · fixture`), so prior
  runs stay identifiable for a future session-browser UI.

Data lives under `labs/trading-desk/.fsdev/data/` (already covered by the root
`.gitignore`'s `**/.fsdev/**` rule). To wipe history, delete the directory.
To redirect storage — for an isolated test run, for example — set
`FSDEV_DATA_DIR`:

```bash
FSDEV_DATA_DIR=/tmp/td-test pnpm --filter @flow-state-dev/trading-desk dev
```

The wiring lives in [`lib/server.ts`](lib/server.ts) (filesystem stores) and
[`app/page.tsx`](app/page.tsx) (the resolve-or-create logic that runs on each
**re-run** click). See also [Persistence overview](../../apps/docs/docs/persistence/overview.md)
for the generalized pattern.

## Custom instructions

The status bar carries a gear icon that opens a settings dialog where you can
author free-text instructions that shape how the desk reasons — one global
block applied to every phase plus one block per phase for narrower guidance.
"Hold for days, not quarters", "weight balance-sheet quality over momentum",
"treat litigation risk as the top concern" — that kind of thing.

**Setting instructions.** The gear is enabled after the first analysis run
(the dialog reads the user-scope resource through a session snapshot, so it
needs a session to exist). Open it, type into any field, click Save. Empty
fields produce no prompt content. Edits take effect on the next analysis
run; the in-flight run, if any, is untouched.

**How injection works.** The `tradingDesk` capability's always-on `core`
preset renders a `<userInstructions>` block into every generator's prompt
with a short framing sentence followed by the global block and the active
phase's block. When both are empty the wrapper tag is suppressed entirely —
no `<userInstructions/>` leaks into the prompt when nothing is set.

**Where it's stored.** Per user, under `.fsdev/data/users/<userId>/` (the
resource is user-scoped with `flowIsolation: false`, so it stores under bare
`{userId}` — shared across flows for the same user, and readable by the
analysis flow without a flow-namespaced key). The directory is covered by
`.gitignore`.

## Provider keys

The flow uses the framework's model resolver. Configure at least one provider
key (typically `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) so the `intent/utility`
and `intent/chat` intents can resolve. The app does not bundle a
default-model assumption — extend `lib/server.ts`'s `createModelResolver` call
if you want to wire intents to specific gateway models.

`yahoo-finance2` is keyless. `FINNHUB_API_KEY` enables live Finnhub-backed
tools (fundamentals, prices, news, insider transactions); without it those
tools return `unavailable` and the relevant analyst treats the result as
missing signal. `XAI_API_KEY` enables live social sentiment via Grok's
`xSearch` over X/Twitter; without it, `get_social_sentiment` returns
`unavailable` and the sentiment analyst applies the same missing-signal
treatment. `FMP_API_KEY` (optional, free tier) enables earnings-call
transcripts via `get_earnings_transcript`; without it the disclosure
analyst still runs on EDGAR filings and Finnhub ratings alone.
`MASSIVE_API_KEY` (optional, **paid** — Massive bills per asset-class product:
options is the Starter tier, futures a separate subscription) enables
`get_options_chain` (quant analyst) and `get_futures_curve` (macro analyst);
without it, or without the matching product entitlement, both return
`unavailable` and the analysts apply the missing-signal treatment. EOD /
delayed data is fine — the desk runs on an as-of date.

Live investigative discovery on the `full` preset uses
`@flow-state-dev/tools/search`'s auto-detected provider — Tavily, Exa,
Perplexity, Serper, Brave, or Perplexity Sonar — whichever has a key in
the environment. `TAVILY_API_KEY` is the recommended default. With no
provider key the discovery tools emit `source: "unavailable"` per BP-020
(no silent fallback to fixture data on the live path) and analysts
skip investigation accordingly.

## Architecture in brief

```
analyze
  └─ seedSession                  (patch session state from input)
  └─ phase-1-analysts             (sub-sequencer, container item)
        ├─ setupPhase1Memos       (.tap — pre-create 9 memos in `pending`)
        └─ parallel
             ├─ fundamentalsAnalyst
             ├─ sentimentAnalyst
             ├─ newsAnalyst
             ├─ technicalAnalyst
             ├─ companyProfileAnalyst
             ├─ marketAnalyst
             ├─ macroAnalyst
             ├─ quantAnalyst
             └─ disclosureAnalyst
  └─ phase-2-research-debate      (sub-sequencer, container item)
        ├─ setupPhase2Memos       (.tap — pre-create 3 memos in `pending`)
        ├─ deriveDebateGoal       (.step — { goal } from session state)
        ├─ phase2RoundRobinRouter (.step — picks one of four pre-built
        │                            roundRobin instances by
        │                            (maxDebateRounds, costPreset))
        ├─ consolidateBullMemo    (.step — write `BullThesis`)
        ├─ consolidateBearMemo    (.step — write `BearThesis`)
        └─ researchManagerGenerator (.step — write `InvestmentThesis`)
  └─ phase-3-trader               (sub-sequencer, container item)
        ├─ setupPhase3Memos       (.tap — pre-create p3/trader in `pending`)
        └─ traderStep              (defineMemoStep)
             ├─ markWriting("trader")
             ├─ traderApproachGenerator (sub, streams message item)
             ├─ traderGenerator   (.step — write `TradeProposal`)
             ├─ commitTraderMemo  (.tap)
             └─ markError("trader")  (.rescue)
  └─ phase-4-risk-debate          (sub-sequencer, container item)
        ├─ setupPhase4Memos       (.tap — pre-create 4 p4 memos in `pending`)
        ├─ aggressiveStep         (.step — markWriting + approach preamble +
        │                            generator + commit; rescue → markError)
        ├─ conservativeStep       (.step — symmetric; reads aggressive memo)
        ├─ neutralStep            (.step — symmetric, neutral schema; reads
        │                            aggressive + conservative memos)
        └─ riskAssessmentStep     (.step — approach preamble + consolidator,
                                     write `RiskAssessment`; rescue → markError)
  └─ phase-5-portfolio-manager    (sub-sequencer, container item)
        ├─ setupPhase5Memos       (.tap — pre-create p5/portfolio-manager
        │                            in `pending`)
        └─ portfolioManagerStep    (defineMemoStep)
             ├─ markWriting("portfolioManager")
             ├─ portfolioManagerApproachGenerator (sub, streams message item)
             ├─ portfolioManagerGenerator (.step — write `PortfolioDecision`)
             ├─ commitPortfolioManagerMemo (.tap — also flips
             │                                `session.runComplete = true`)
             └─ markError("portfolioManager")  (.rescue)
```

All eight Phase 3–6 approach preamble generators are built via the
`createApproachGenerator` factory in
[`agents/_recipe/approach-generator.ts`](src/flows/analysis/agents/_recipe/approach-generator.ts).
The factory locks the shared policy (`itemVisibility: { client: true, history: false }`,
`model: "intent/utility"`, the user-instruction template) and exposes
only the per-agent knobs.

The four Phase 2 `roundRobin()` instances share one
`phase2Contributions` resource (registered on the flow). The
consolidation generators declare this on their `resources:` slot and
read entries via `ctx.resources`. Phase 4 doesn't use `roundRobin()`
(see "Why Round Robin and not Debate" below), so there's no Phase 4
contributions resource.

Each analyst is built by `defineAnalyst`, which composes the analyst body
(role-specific tools + synthesis generator) and delegates the memo lifecycle
to `defineMemoStep`: tap `markWriting`, run the body, tap `commitAnalystMemo`
(or `markError` on rescue), publishing the structured memo body.

### Why Round Robin and not Debate

Both `roundRobin()` and `debate()` ship in `@flow-state-dev/patterns`. Phase
2 picks Round Robin because the research manager is a *synthesizer*, not a
judge. Round Robin's judge slot is a loop terminator — Phase 2 fills it
with a 3-line stub that always returns `done: false` and leans on
`maxRounds` for termination, which is the pattern's documented idiom for
fixed-length loops. Debate's judge is the pattern's identity, so using
Debate without a real judge would be reaching for the wrong primitive.

Phase 4's risk panel does NOT use `roundRobin()` — it's a plain
sequencer chain. The prose framing ("three risk officers in round-robin
order") sounds like the pattern, but none of `roundRobin()`'s
distinguishing features fit: single pass (no debate cycling), no
referee, heterogeneous roster (the neutral persona has its own output
schema), and the personas read prior critiques from the structured
persona memos rather than from a shared free-form transcript. The
memo-backed read is the richer source — using `roundRobin()` here
would force every persona through an adapter that flattens the typed
output to text and then read that text back instead of the typed
fields. The three persona steps run as
`aggressiveStep.step(conservativeStep).step(neutralStep)` inside
`phase4Pipeline`, and the `riskAssessmentGenerator` runs as a separate
downstream step that synthesizes the three persona memos into a single
`RiskAssessment` that Phase 5 reads.

### Per-preset routing

Round Robin's `model` and `maxRounds` are fixed at construction time.
Phase 2 needs both to vary by session state, so `phase2RoundRobinRouter`
picks among four pre-built instances at runtime — one per
`(maxRounds, costPreset)` combination. The four routes share one
`contributions` resource (via the pattern's `contributions` config
field), which is what lets the router's resource-merge succeed.

### Phase 5 — single generator, weight in the schema

The portfolio manager is one generator with no roster, no debate, no
consolidator. The orchestration is intentionally trivial; the weight is
in the typed output shape. `PortfolioDecision` carries several structured
extension fields (`finalRating`, `decisionSummary`, `decisionConfidence`,
`acceptedAdjustments`, `keyDependencies`, `upstreamReferences`,
`agreesWithTrader`) on top of the standard memo body, and the
`acceptedAdjustments` shape forces the PM to mark `applied: true | false`
with reasoning for each of the three risk-team recommendations
(sizing / holdingPeriod / invalidation). Putting the dissent surface
in the schema means it can't get lost in prose.

`agreesWithTrader` and `upstreamReferences` are derived at commit time
rather than emitted by the LLM. `agreesWithTrader` is a boolean
comparison between `finalRating`'s implied direction and the trader
memo's `direction` field; `upstreamReferences` is a static lookup
into the canonical memo-key maps. Both are fully determined by other
stored values, so asking the LLM for them would only add hallucination
surface.

The PM Hero renderer reads from the same `useResourceCollectionItem`
hook every other memo uses. The marquee surface has no special-case
data flow.

**The decision turns on three orthogonal axes**, each documented
methodology rather than advice:

- **Valuation envelope** (the deterministic spine, FIX-715): bounds
  `finalRating` to a band implied by expected return, margin of safety,
  and the setup score. The PM may step outside the band only with a logged
  `ratingOverrideReason`.
- **Portfolio-fit** (FIX-728): sizes the position against the real book —
  current weight, cash, concentration, tax-account suitability — and the
  investor-lens convergence (robustness across philosophies, sized down on
  divergence, never up).
- **Risk-appetite mandate** (FIX-752): a variable, user-selectable
  standard for "is this risk worth it." The desk derives a reward-to-risk
  figure from the Phase 5a scenario buckets — probability-weighted upside
  over downside, with the downside weighted by the mandate's loss-aversion
  — and judges it against the mandate's bar (a reward-to-risk floor, a
  return hurdle, a confidence floor, and a worst-case capacity line). The
  mandate moves the position SIZE and an explicit worth-it verdict; it does
  NOT move the rating, which stays the valuation-anchored,
  cross-book-comparable signal. A name can be a Buy on its merits yet fail
  a conservative book's mandate and size to a token. Three presets ship
  (`conservative-income`, `balanced`, `aggressive-growth`); the mandate is
  a per-run choice, or a default stored on the account, with the
  most-conservative selected-account default binding when no per-run choice
  is made. Run the same name under two mandates and the size and the
  verdict move while the rating holds. See `mandateFit` on
  `PortfolioDecision` and the pack in `lib/risk-mandate.ts`.

## What this is not

- **Not a trading product.** It does not execute and it does not track
  P&L. It can reason about a *supplied* portfolio snapshot (see
  "Portfolio-aware analysis" above), but that snapshot is dev-only and
  frozen at dispatch, the sizing is documented-methodology not advice, and
  with no portfolio supplied `sizePct` is still a suggested percentage of a
  notional NAV in the 0.5–2.5 range for a normal-conviction trade. The
  risk-appetite mandate is the same: a pedagogical demonstration of
  parameterized risk gating, not production risk governance.
- **Not a backtest.** There is no historical evaluation, no calibration
  against outcomes, no measure of decision quality. The Portfolio
  Manager's `decisionConfidence` is self-reported uncertainty, not a
  prediction of accuracy.
- **Not a recommendation system.** The five-tier rating is informative
  scale, not actionable signal. Two distinct ticker × date inputs may
  produce indistinguishable ratings even when the underlying setups
  differ; that's a property of any LLM-driven analytic that lacks
  ground truth.
- **Not a complete data layer.** Fixture mode ships hand-curated JSON
  snapshots at `2026-05-06` for NVDA / AAPL / JPM. Live mode wires SEC
  EDGAR (authoritative US filings, keyless) for the financial statements
  with Yahoo Finance as fallback, and Yahoo for prices and the valuation
  snapshot (keyless). A field a provider doesn't report reads `null`
  (unobserved), never a fabricated 0. Don't extrapolate from a fixture run
  to a real-data run.

## Further reading

- [Architecture deep-dive](../../docs/internal/design/trading-desk.md) — in-repo design doc covering pipeline shape, identity, resource flow, pattern choices, and the work the framework absorbs.
- [Public guide](../../apps/docs/guides/trading-desk-walkthrough.md) — published Docusaurus walkthrough of the app phase by phase.

## Disclaimer

**Research / demo only.** Not financial advice. No execution. No P&L.
Mirrors upstream `TauricResearch/TradingAgents` positioning.

## Attribution

Inspired by [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents)
(Apache-2.0). Independent reimplementation derived from the paper —
Y. Xiao et al., *TradingAgents: Multi-Agents LLM Financial Trading
Framework*, [arXiv:2412.20138](https://arxiv.org/abs/2412.20138).
