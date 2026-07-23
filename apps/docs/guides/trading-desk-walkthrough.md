---
sidebar_position: 5
title: A walkthrough of the Trading Desk
---

# A walkthrough of the Trading Desk

The Trading Desk is a five-phase multi-agent pipeline that turns a ticker and a date into a structured trade decision. Nine analyst sub-agents read different data sources, two researchers argue bull versus bear, a synthesizer writes an investment thesis, a trader proposes a trade, three risk officers critique it, and a portfolio manager makes the final call. It's a real app — live data, durable reports, a real portfolio — that lives in `labs/`.

This walkthrough uses it to show how the framework's pieces fit together. The agents reason in plain English about stocks because that domain has public, structured prior art to model against. It's research software. Don't trade real money on it.

This walkthrough names the framework pieces the example uses, in roughly the order they show up during a run. Read [Anatomy of a Flow](/guides/anatomy-of-a-flow) first if the words "block," "generator," and "sequencer" don't already mean something concrete to you.

## The pipeline at a glance

Phase 1 fans out nine analyst sub-agents in parallel. Each reads its own data sources and writes a typed `Thesis` memo with claims, evidence, risks, and a recommendation. The technical analyst reads a wide indicator set (RSI, MACD, ATR, SMA50/200, Bollinger Bands, VWMA, Stochastic, KDJ, OBV). The news analyst reads headlines and 90 days of insider Form 4 transactions. The sentiment analyst reads 7-day X/Twitter sentiment via Grok's `xSearch` hosted tool when an xAI key is configured; without one, sentiment runs on `unavailable`. The company-profile analyst renders structured business identity, sector, industry, description, and scale, from a deterministic provider fetch, so the rest of the pipeline reasons from data instead of training priors. The market analyst examines sector positioning, how the company's closest peers are trading, and which sector-level themes (regulatory shifts, supply-chain changes, rotation flows) carry momentum or overhang. The macro analyst reads the global economic regime (rates, inflation, growth cycle, yield curve, credit spreads, dollar, oil) from FRED, alongside macro and geopolitical news headlines that stay available even when the FRED feed is down (with deeper web search on the full preset). When a Massive key is configured it also reads a benchmark futures curve (equity-index, crude, gold, and Treasury futures) for a cross-asset read of the day's risk tone and where each curve sits in contango or backwardation. It then maps how those top-down forces transmit to the specific name through channels like rate sensitivity, FX exposure, or supply-chain risk. Each economic series degrades on its own, so one unavailable indicator no longer blanks the whole memo. The quant analyst provides a systematic, numbers-only layer: cross-sectional factor ranks (momentum, value, quality, size, low-vol percentiles within the peer set), statistical composites (Altman Z'' for bankruptcy risk and Piotroski F-Score for financial strength), risk-regime statistics (OLS beta, realized-vol regime, correlation regime), short-interest positioning data, and, when a Massive key is configured, an options-chain read (at-the-money implied volatility, the IV term-structure tilt, 25-delta skew, and the put/call open-interest balance — the forward risk the options market is pricing). The disclosure analyst reads SEC filings (10-K/10-Q periodic reports) and surfaces recent material corporate events typed by 8-K item code (the SEC filing form a company files when a material event occurs, such as an executive change, a strategic agreement, or a results announcement), giving downstream reasoning an explicit catalyst signal. It also reads sell-side consensus estimates and earnings-call transcripts to surface risk factors, management guidance, and where the Street's expectations diverge from management's own language. The fundamentals analyst reads the balance sheet, income statement, and cash-flow statement, then derives a capital-structure-aware valuation set (enterprise value, EV multiples, Price/Book, FCF yield, earnings yield, ROA, net debt, dividend yield) from those statements, with each metric null when its inputs are not present.

Phase 2 runs a bounded bull-versus-bear loop. A research manager synthesizes the debate into an `InvestmentThesis` with explicit `unresolvedDisagreements`.

Phase 3 turns that thesis into a single typed `TradeProposal`: direction, size, stop, target, holding period.

Phase 4 runs three risk officers in round-robin order, then a consolidator emits a `RiskAssessment` with recommended adjustments attributed back to specific personas.

Phase 5 reads everything upstream and emits a `PortfolioDecision` with a five-tier final rating, accepted-or-rejected risk adjustments, key dependencies, and a rationale that cites each stage.

Every agent in Phases 3–5 streams a one-sentence approach preamble before its structured memo, so the transcript shows the agent's plan in plain English seconds before the typed output lands. The preamble is display-only — it's not fed back into the structured generator.

```
analysts (x9 in parallel)
  → bull/bear debate → research manager
    → trader
      → risk officers (x3 round-robin) → risk consolidator
        → portfolio manager
```

Each arrow above is a `.step()` in a sequencer. The whole flow is one chain.

## Phase 1: Parallel sub-agents

A sequencer is the composition primitive. It takes blocks and chains them. The `.parallel()` step on a sequencer runs a set of branches concurrently and produces a single combined output.

Phase 1 uses one `.parallel()` step with nine branches. Each branch is itself a sub-sequencer that mirrors the same shape:

```ts
sequencer({ name: "analyst-fundamentals" })
  .tap(markWriting("fundamentals"))         // mark memo as in-progress
  .map(tickerDate)                          // pull ticker+date from session
  .parallel({ /* pre-fetch tools */ })
  .step(fundamentalsGenerator)              // LLM call → typed Thesis
  .tap(commitAnalystMemo("fundamentals"))   // write to memo resource
  .rescue([{ block: markError("fundamentals") }]);
```

A few teaching moments live in that one declaration.

The analyst is not a special "agent" type. It's a sequencer composed of a handler (the silent state-mutating block kind), a generator (the LLM-calling block kind), and another handler. Any block composes with any other. There is no agent-versus-workflow split.

The nine memo slots get pre-created in `pending` by a setup tap that runs before the parallel block. The right-pane navigator sees nine placeholder cards from the start of the phase, not just as each analyst completes. That kind of "show the work as it happens" UI falls out of pre-creating the resource entries.

Resources are the live data layer. Each analyst writes its typed memo to a session-scoped resource collection. React reads it through `useResourceCollectionItem`. The framework handles the SSE plumbing; your component is a renderer.

The per-branch `.rescue()` matters too. If the news fetch fails, only the news memo flips to `error`. The other eight analysts still complete.

### Investigation and citations

Phase 1 analysts are aggressively grounded by default — the `<grounding>` clause tells every generator to operate strictly on upstream-provided data. That floor is good for anti-hallucination but leaves a real gap: an analyst that recognises the numbers don't tell the whole story has no way to look. The trading-desk closes that gap with a two-step pattern that mirrors how the news analyst already worked.

Each non-News analyst gains a deterministic discovery step in its parallel block (`discover_fundamentals_context`, `discover_sentiment_context`, `discover_technical_context`, `discover_profile_context`, `discover_market_context`, `discover_macro_context`). The discovery tool calls a generic web search and returns up to five numbered URLs the analyst can read with `fetch` when the structured data leaves a material question open. Pick two or three at most.

Every URL the analyst relies on goes into a required `citations` field on the thesis output. The analyst-card renderer shows them as a "Sources" footer with `target="_blank"` anchors. A reviewer can audit which sources backed which claim without leaving the memo.

The whole investigative slice — the `fetch` tool, the `<investigation>` clause that codifies the citation contract, and the discovery tool calls — is gated on `costPreset === "full"`. On `fast` the `fetch` tool is absent, the clause is suppressed entirely (not rendered as an empty tag), and each discovery tool short-circuits to a `source: "skipped"` payload before any provider call. The cheap demo path stays free of web fetches; the full path investigates and cites.

The gating lives in one place — an `investigate` preset on the `tradingDesk` capability — that every Phase 1 generator opts into. The preset's `tools` resolver returns `[fetchArticle]` on full and `[]` on fast; its context entry returns the clause string on full and `null` on fast. Two coordinated seams, same session-state key, no leakage.

## Phase 2: Round Robin with a synthesizer

Phase 2 introduces a pattern from `@flow-state-dev/patterns`. A pattern is a pre-built sequencer composition that solves a recurring shape. Round Robin runs a roster of agents in fixed order for N rounds and exits when either the round cap is hit or an optional runtime predicate says to stop.

The example calls `roundRobin()` once. `maxRounds: 2` is the hard cap; a `terminateWhen` predicate reads `session.state.maxDebateRounds` and exits early when the configured target is reached. The pattern's optional referee slot is left empty — the bull/bear panel doesn't have an automated argument-quality audit requirement here. The synthesizer slot is `false` because three downstream consolidator generators synthesize different views of the transcript (bull thesis, bear thesis, research manager's investment thesis).

Why Round Robin over Debate? The research manager that runs after the loop is a synthesizer, not a verdict-picker. Debate's at-end judge expects "who won" reasoning, which doesn't match what the research manager does. Round Robin's optional per-round referee is a different concern (argument-quality auditing, not termination), so it stays empty here.

Model selection is handled by the `tradingDesk` capability. `uses: [tradingDesk]` resolves the model from `costPreset` at runtime, so the same instance serves both cost presets without per-variant build-time fan-out. One round-robin, two capability paths.

## Phase 3: An approach preamble, then the structured trader

The trader runs two generators in sequence. First, a fast-model **approach preamble** streams a one-sentence plan in plain English: how the trader will weigh the thesis against the analyst evidence. Then the structured `TradeProposal` generator runs. The preamble is display-only — its text is not fed into the structured generator and does not influence the memo. It exists so the transcript pane shows the trader thinking before the typed card lands.

Reading the upstream thesis happens through a capability. A capability bundles resources, tools, and context formatters; the generator opts in declaratively:

```ts
uses: [tradingDesk.with({ investmentThesis: true })]
```

That one line means: install the resource that the investment thesis lives in, and format it into the generator's prompt context. No manual wiring of `context: { ... }` functions, no threading the resource through sequencer state. Adding a new generator that needs the thesis is one preset flag.

The preamble lives in the same step sequencer as the trader, inserted with one `.step()`:

```ts
sequencer({ name: "phase-3-trader-step" })
  .tap(markWriting("trader"))
  .step(traderApproachGenerator)   // ← fast-model preamble, streams
  .step(traderGenerator)            // structured TradeProposal
  .tap(commitTraderMemo)
  .rescue([{ block: markError("trader") }]);
```

`itemVisibility: { client: true, history: true }` on the trader generator tells the framework to render the structured output as a card in the transcript. The transcript renderer reads the item type and dispatches to the right component. No custom event handling in the React layer.

### An in-flow factory

All six preamble generators in Phases 3–5 are built via a small `createApproachGenerator` factory that lives next to the `tradingDesk` capability in `services/approach-generator.ts`. The factory bakes in the parts that are shared across every preamble — `itemVisibility: { client: true, history: false }` (streams a message item, no struct card), `model: "intent/utility"` (always-fast, regardless of `costPreset`), and the user-instruction template — and each call site supplies only what varies: name, agent name, artifact name, prompt, and capability presets.

```ts
export const traderApproachGenerator = createApproachGenerator({
  name: "trader-approach-generator",
  agentName: PHASE_3_MEMO_KEYS.trader.agentName,
  artifactName: "TradeProposal",
  prompt: TRADER_APPROACH_PROMPT,
  uses: [tradingDesk.with({ investmentThesis: true })],
});
```

The factory deliberately stays inside the example. There's exactly one consumer of this pattern today — these six call sites. The line we want to teach: a pattern lives inside the consumer until a second consumer justifies promoting it to `@flow-state-dev/patterns`. Not every reusable shape needs to be a framework export to be a real pattern.

The honest tradeoff: each Phase 3–5 agent runs one extra fast-model call per session for the preamble. Cost stays bounded because the preamble always resolves to `intent/utility` — block-level model wins over the capability's cost-preset-driven model — so the `full` preset doesn't escalate the preambles too.

## Phase 4: Personas in fixed order, then a consolidator

Same Round Robin primitive, used differently. The roster has three slots, each overridden with a custom sub-sequencer that wraps a structured-output generator: `aggressive-risk-generator`, `conservative-risk-generator`, `neutral-risk-generator`. Each persona makes two LLM calls — a fast-model approach preamble that previews the persona's stance in character, then the structured-output generator that emits the typed critique. The preamble is the persona's only transcript-visible output; personas are `sub` agents and don't emit structured cards, so the right-pane memos navigator carries the typed critique while the transcript carries the preamble. `maxRounds: 1` — a single pass — and no referee.

The pattern's `synthesizer` slot is left empty (`synthesizer: false`). A downstream `riskAssessmentGenerator` runs as a separate step in the phase pipeline so the consolidated artifact is its own memo, separate from the round-robin's running transcript. The consolidator gets its own preamble too, streamed before the consolidator's structured memo runs.

Per-persona `.rescue` matters here for the same reason it mattered in Phase 1: if the conservative critique fails, only that memo flips to `error`. The aggressive and neutral critiques still run. The consolidator downstream still has two of three inputs to work with.

The consolidator's `RiskAssessment` carries `recommendedAdjustments` across three axes: sizing, holding period, and invalidation. Each adjustment is attributed back to the persona that argued for it (`source: "aggressiveRisk" | "conservativeRisk" | "neutralRisk"`). Phase 5 picks these up by name and decides which to accept.

## Phase 5: The final decision

Like the trader, the portfolio manager streams an approach preamble before its structured decision lands. The PM then reads everything upstream and emits a single `PortfolioDecision`. It carries:

- A five-tier `finalRating`: Sell, Underweight, Hold, Overweight, Buy.
- A self-reported `decisionConfidence`.
- `acceptedAdjustments`: for each of the three risk-team recommendations, the PM marks `applied: true | false` with reasoning. The decision is explicit about which critiques it took on board and which it didn't.
- `keyDependencies`: the contestable judgment calls the decision rests on. The places a reviewer should push back if anything moves.
- A structured prose rationale that cites each upstream stage by name.

The right-pane PM Hero is the marquee surface. It renders the rating bar, the metrics row, the accepted-adjustments panel, the key dependencies, and a static list of upstream references (the storage keys of the memos the PM consumed). The same resource hook that drives every other memo's view drives this one. No special-case data flow.

One honest tradeoff. `decisionConfidence` is self-reported. The PM is asked to be honest about uncertainty, not to predict accuracy. If you wanted calibration, you'd score these against outcomes, and the example does not do that.

### The risk-appetite mandate

The decision also reads a risk-appetite mandate. A mandate is a setting that says how much downside this book will accept per unit of upside. You pick one before a run, or set a default on the account. The desk takes the scenario distribution from the forecaster and computes a reward-to-risk figure from it: probability-weighted upside over downside, with the downside weighted more heavily for a cautious mandate. It checks that figure against the mandate's bar, which is a minimum reward-to-risk, a return hurdle, a confidence floor, and a worst-case loss the book can absorb.

What the mandate moves is the position size and an explicit worth-it verdict, not the rating. The rating stays anchored to the valuation read, so it means the same thing across books and stays comparable. A name can be a Buy on its merits and still fail a conservative mandate. When that happens the desk sizes it to a token position and says so. Run the same ticker under a conservative income mandate and an aggressive growth one, hold everything else fixed, and you watch the size and the verdict move while the rating holds.

Three presets ship. This is a demonstration of gating a sizing decision on an explicit, documented standard. It is not production risk governance, and not advice.

The per-run mandate can also inherit from a durable, user-set portfolio policy. That policy is an Investment Policy Statement, a plain record of what the book is aiming for: a target mix across asset classes, standing rules like a maximum weight for any one name or a list of names never to add, and a time horizon. You write it once in the Portfolio view and it sticks. When a run starts, the desk reads it, so the appetite dial can come from the standing policy instead of being picked fresh each time. The standing constraints shape the size too: the recommended weight respects the single-name cap, and an excluded name is never recommended as an add. It is policy-gated sizing for a demo, not a production IPS governance framework, and not advice.

### The evidence gate

The mandate and the portfolio policy are both optional. One sizing rule is not: an evidence-sufficiency gate that runs on every decision. Before the desk can add to a position it checks that the call rests on real evidence. It looks at three things: whether the valuation work was grounded, whether the reward-to-risk figure has an actual distribution behind it, and whether the core financial statements came back. If any one of those is thin or missing, the run may not add exposure. An `initiate` or `add` collapses to a `hold`, and the size is capped at whatever the book already holds.

This exists to keep a data gap from reading as a signal. Missing evidence is not bearish and not bullish. It's absent. So the gate never touches the rating, which stays anchored to whatever the desk could actually observe. It only holds back new money. And because it's derived from the same deterministic checks that produce the valuation spine and the reward-to-risk figure, not from the model's own read of its confidence, it fires the same way every time on the same inputs. It's the cheapest kind of discipline: the desk declines to size up when it can't show its work.

## Custom instructions and steerability

The status bar carries a settings gear that opens a free-text dialog: one global block applied to every phase, and one block per phase for narrower guidance. Edits persist for the user across every run and survive server restarts. It's the example's first user-scoped resource, which makes it a useful walkthrough of three things: how to declare scope and isolation on a resource, where to inject prompt context once and have it reach every agent, and how to read user-scope state from the client without writing a new endpoint.

### The user-scoped resource

The resource holds six strings and is declared user-scope with `flowIsolation: true`. Isolation means the record is stored under `{userId}:trading-desk`, so trading-desk instructions never leak into another flow that happens to share the same user identity. `client.expose` opts every field into the session snapshot so the settings dialog can read persisted state without an extra fetch.

```ts
export const specialInstructionsResource = defineResource({
  scope: "user",
  flowIsolation: true,
  ref: "tradingDeskSpecialInstructions",
  stateSchema: specialInstructionsStateSchema,
  default: EMPTY_INSTRUCTIONS,
  writable: true,
  client: {
    expose: ["global", "phase1", "phase2", "phase3", "phase4", "phase5"],
  },
});
```

### The injection seam

The `tradingDesk` capability has a `default: ["core"]` preset that every one of the pipeline's seventeen generators already pulls in. Adding the resource and a `userInstructions` context entry on `core` reaches every generator with no per-generator edits. The formatter returns an empty string when both the global and active-phase fields are blank — the XML renderer then suppresses the wrapping tag, so an unset state produces zero prompt content rather than an empty `<userInstructions/>` placeholder.

```ts
core: {
  resources: { specialInstructions: specialInstructionsResource },
  model: (_input, ctx) => `intent/${ctx.session.state.costPreset}`,
  context: [
    {
      ticker: (_input, ctx) => ctx.session.state.ticker,
      date: (_input, ctx) => ctx.session.state.date,
      userInstructions: (_input, ctx) =>
        formatUserInstructions(
          ctx.resources.specialInstructions?.state,
          ctx.session.state.activePhase,
        ),
    },
    GROUNDING_CLAUSE,
  ],
},
```

### The settings UI

The dialog reads persisted state with `useResource(session, "specialInstructions")`, which projects from the session snapshot using the `expose` list above. Saving dispatches the `setInstructions` flow action, which patches the resource. The framework's snapshot refresh on action completion is enough to re-render the indicator in the status bar — no manual cache invalidation, no `useEffect` to refetch.

The gear stays disabled until the user has run at least one analysis. `useResource` projects from a session snapshot, and there is no session before the first run. Acceptable as a tradeoff for a demo; a more general "settings before any work" UX would lazily create a sentinel session at page load.

### Why this shape

A few alternatives were considered and rejected. Adding a per-generator context entry across seventeen generators would have worked, but the capability-preset path is the codebase's preferred shape and it survives the addition of new agents. Reading user-scope state via a dedicated action would have required parsing the SSE stream for the response payload — `ExecuteActionResponse` does not carry handler return values, so the snapshot-driven read is the framework-native primitive. A pre-fetch from a new REST endpoint would have been the wrong tool for an example-local feature.

The generalized take on this pattern — "Projects": resource-backed agent state with optional cross-flow sharing — is tracked separately. The version here is deliberately narrow: trading-desk only, no templates, no versioning, no per-agent scope.

## Running it

```bash
pnpm install
pnpm --filter @flow-state-dev/trading-desk dev
```

The top bar exposes a ticker input, a date, a cost preset (`fast` or `full`), a data source toggle (`fixture` or `live`), and a risk-appetite mandate selector (leave it on the default to run without one). A disclaimer band sits above the transcript: this is a demo, not investment advice.

On a fresh run, you'll see the nine analyst cards appear in `pending` right away. They flip to `writing` as each analyst starts its generator call, then to `done` as the memos commit. The bull and bear cards follow. Then the trade proposal, then the three risk persona cards, then the consolidated risk assessment, then the PM Hero on the right.

The `fast` preset completes well under a minute on one provider key. `full` takes longer because the debate runs two rounds against larger models.

For provider keys, at least one of `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is required for model resolution. Yahoo Finance is keyless. `FINNHUB_API_KEY` is optional for live news and insider transactions; without it those tools return `unavailable` and the news analyst treats the missing data as missing signal, not bearish. `XAI_API_KEY` is optional for live social sentiment via Grok; without it, `get_social_sentiment` returns `unavailable` and the sentiment analyst applies the same missing-signal treatment. `FMP_API_KEY` is optional for earnings-call transcripts; without it, the disclosure analyst still runs on EDGAR filings (keyless) and Finnhub ratings (existing key). `MASSIVE_API_KEY` is optional and paid (Massive bills per product, so options and futures are separate subscriptions); without it the quant analyst's options-chain read and the macro analyst's futures-curve read return `unavailable`, and both apply the same missing-signal treatment.

## Session lifecycle and persistence

Sessions are ephemeral by default in flow-state-dev. The trading desk opts into persistence by passing `createFilesystemStores` to the API router:

```ts
// lib/server.ts
const dataDir = process.env.FSDEV_DATA_DIR
  ?? path.join(process.cwd(), ".fsdev", "data");

export const router = createFlowApiRouter({
  registry,
  modelResolver,
  stores: createFilesystemStores({ rootDir: dataDir }),
});
```

That alone makes runs survive a restart. The second piece is identifying which session a run belongs to. Every run is named by the four user-visible inputs: ticker, date, cost preset, and data source. The page does a small lookup before dispatch:

```ts
// app/page.tsx
const targetId = findSessionForTuple(flow.sessions, tuple)
  ?? (await sessionClient.createSession({
       flowKind: "trading-desk",
       userId: "devuser",
       title: titleForTuple(tuple),   // e.g., "NVDA · 2026-05-06 · fast · fixture"
       metadata: tuple,
     })).id;
```

Reuse on match, create on miss. Same tuple lands in the same session, so memo resources overwrite in place. The session state mirror (`memoStatus`, `runComplete`) resets to its initial values via `seedSession` at the start of each request, so a reused session reads as "fresh data" rather than stale phase progress.

Changing any one input — ticker, date, preset, or source — produces a different tuple, no match, and a new session whose title and metadata both reflect the new combination.

For the generalized pattern (resolve-or-create by metadata, with the current caveats around server-side filtering), see [Looking up sessions by metadata](/docs/persistence/overview#looking-up-sessions-by-metadata).

## Where to look next

- Browse the source: `labs/trading-desk/` in the repo. Each phase is its own directory.
- [Capabilities](/docs/fundamentals/capabilities) — how the `tradingDesk` capability bundles resources, model selection, and context formatters into one import.
- [Patterns overview](/docs/patterns/overview) — the catalog of pre-built compositions, including Round Robin.

## Attribution

Inspired by [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) (Apache-2.0). Independent reimplementation derived from the paper — Y. Xiao et al., *TradingAgents: Multi-Agents LLM Financial Trading Framework*, [arXiv:2412.20138](https://arxiv.org/abs/2412.20138).
