---
sidebar_position: 5
title: A walkthrough of the Trading Desk example
---

# A walkthrough of the Trading Desk example

The Trading Desk example is a five-phase multi-agent pipeline that turns a ticker and a date into a structured trade decision. Five analyst sub-agents read different data sources, two researchers argue bull versus bear, a synthesizer writes an investment thesis, a trader proposes a trade, three risk officers critique it, and a portfolio manager makes the final call.

It is a teaching demo. The agents reason in plain English about stocks because that domain has public, structured prior art to model against. Don't trade real money on it.

This walkthrough names the framework pieces the example uses, in roughly the order they show up during a run. Read [Anatomy of a Flow](/guides/anatomy-of-a-flow) first if the words "block," "generator," and "sequencer" don't already mean something concrete to you.

## The pipeline at a glance

Phase 1 fans out five analyst sub-agents in parallel. Each reads its own data sources and writes a typed `Thesis` memo with claims, evidence, risks, and a recommendation. The technical analyst reads a wide indicator set (RSI, MACD, ATR, SMA50/200, Bollinger Bands, VWMA, Stochastic, KDJ, OBV). The news analyst reads headlines, macro indicators, and 90 days of insider Form 4 transactions. The company-profile analyst renders structured business identity, sector, industry, description, and scale, from a deterministic provider fetch, so the rest of the pipeline reasons from data instead of training priors.

Phase 2 runs a bounded bull-versus-bear loop. A research manager synthesizes the debate into an `InvestmentThesis` with explicit `unresolvedDisagreements`.

Phase 3 turns that thesis into a single typed `TradeProposal`: direction, size, stop, target, holding period.

Phase 4 runs three risk officers in round-robin order, then a consolidator emits a `RiskAssessment` with recommended adjustments attributed back to specific personas.

Phase 5 reads everything upstream and emits a `PortfolioDecision` with a five-tier final rating, accepted-or-rejected risk adjustments, key dependencies, and a rationale that cites each stage.

Every agent in Phases 3–5 streams a one-sentence approach preamble before its structured memo, so the transcript shows the agent's plan in plain English seconds before the typed output lands. The preamble is display-only — it's not fed back into the structured generator.

```
analysts (x5 in parallel)
  → bull/bear debate → research manager
    → trader
      → risk officers (x3 round-robin) → risk consolidator
        → portfolio manager
```

Each arrow above is a `.then()` in a sequencer. The whole flow is one chain.

## Phase 1: Parallel sub-agents

A sequencer is the composition primitive. It takes blocks and chains them. The `.parallel()` step on a sequencer runs a set of branches concurrently and produces a single combined output.

Phase 1 uses one `.parallel()` step with five branches. Each branch is itself a sub-sequencer that mirrors the same shape:

```ts
sequencer({ name: "analyst-fundamentals" })
  .tap(markWriting("fundamentals"))         // mark memo as in-progress
  .map(tickerDate)                          // pull ticker+date from session
  .parallel({ /* pre-fetch tools */ })
  .then(fundamentalsGenerator)              // LLM call → typed Thesis
  .tap(commitMemo("fundamentals"))          // write to memo resource
  .rescue([{ block: markError("fundamentals") }]);
```

A few teaching moments live in that one declaration.

The analyst is not a special "agent" type. It's a sequencer composed of a handler (the silent state-mutating block kind), a generator (the LLM-calling block kind), and another handler. Any block composes with any other. There is no agent-versus-workflow split.

The five memo slots get pre-created in `pending` by a setup tap that runs before the parallel block. The right-pane navigator sees five placeholder cards from the start of the phase, not just as each analyst completes. That kind of "show the work as it happens" UI falls out of pre-creating the resource entries.

Resources are the live data layer. Each analyst writes its typed memo to a session-scoped resource collection. React reads it through `useResourceCollectionItem`. The framework handles the SSE plumbing; your component is a renderer.

The per-branch `.rescue()` matters too. If the news fetch fails, only the news memo flips to `error`. The other four analysts still complete.

## Phase 2: Round Robin with a synthesizer

Phase 2 introduces a pattern from `@flow-state-dev/patterns`. A pattern is a pre-built sequencer composition that solves a recurring shape. Round Robin runs a roster of agents in fixed order for N rounds and exits when either the round cap is hit or an optional runtime predicate says to stop.

The example calls `roundRobin()` once. `maxRounds: 2` is the hard cap; a `terminateWhen` predicate reads `session.state.maxDebateRounds` and exits early when the configured target is reached. The pattern's optional referee slot is left empty — the bull/bear panel doesn't have an automated argument-quality audit requirement here. The synthesizer slot is `false` because three downstream consolidator generators synthesize different views of the transcript (bull thesis, bear thesis, research manager's investment thesis).

Why Round Robin over Debate? The research manager that runs after the loop is a synthesizer, not a verdict-picker. Debate's at-end judge expects "who won" reasoning, which doesn't match what the research manager does. Round Robin's optional per-round referee is a different concern (argument-quality auditing, not termination), so it stays empty here.

Model selection is handled by the `tradingDesk` capability. `uses: [tradingDesk]` resolves the model from `costPreset` at runtime, so the same instance serves both cost presets without per-variant build-time fan-out. One round-robin, two capability paths.

## Phase 3: An approach preamble, then the structured trader

The trader runs two generators in sequence. First, a fast-model **approach preamble** streams a one-sentence plan in plain English: how the trader will weigh the thesis against the analyst evidence. Then the structured `TradeProposal` generator runs. The preamble is display-only — its text is not fed into the structured generator and does not influence the memo. It exists so the transcript pane shows the trader thinking before the typed card lands.

Reading the upstream thesis happens through a capability. A capability bundles resources, tools, and context formatters; the generator opts in declaratively:

```ts
uses: [tradingDesk.presets({ investmentThesis: true })]
```

That one line means: install the resource that the investment thesis lives in, and format it into the generator's prompt context. No manual wiring of `context: { ... }` functions, no threading the resource through sequencer state. Adding a new generator that needs the thesis is one preset flag.

The preamble lives in the same step sequencer as the trader, inserted with one `.then()`:

```ts
sequencer({ name: "phase-3-trader-step" })
  .tap(markWritingP3("trader"))
  .then(traderApproachGenerator)   // ← fast-model preamble, streams
  .then(traderGenerator)            // structured TradeProposal
  .tap(commitTraderMemo)
  .rescue([{ block: markErrorP3("trader") }]);
```

`agentType: "primary"` on the trader generator tells the framework to render the structured output as a card in the transcript. The transcript renderer reads the item type and dispatches to the right component. No custom event handling in the React layer.

### An in-flow factory

All six preamble generators in Phases 3–5 are built via a small `createApproachGenerator` factory that lives next to the `tradingDesk` capability in `services/approach-generator.ts`. The factory bakes in the parts that are shared across every preamble — `agentType: "sub"` (streams a message item, no struct card), `model: "intent/utility"` (always-fast, regardless of `costPreset`), and the user-instruction template — and each call site supplies only what varies: name, agent name, artifact name, prompt, and capability presets.

```ts
export const traderApproachGenerator = createApproachGenerator({
  name: "trader-approach-generator",
  agentName: PHASE_3_MEMO_KEYS.trader.agentName,
  artifactName: "TradeProposal",
  prompt: TRADER_APPROACH_PROMPT,
  uses: [tradingDesk.presets({ investmentThesis: true })],
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

## Running it

```bash
pnpm install
pnpm --filter @flow-state-dev/example-trading-desk dev
```

The top bar exposes a ticker input, a date, a cost preset (`fast` or `full`), and a data source toggle (`fixture` or `live`). A disclaimer band sits above the transcript: this is a demo, not investment advice.

On a fresh run, you'll see the five analyst cards appear in `pending` right away. They flip to `writing` as each analyst starts its generator call, then to `done` as the memos commit. The bull and bear cards follow. Then the trade proposal, then the three risk persona cards, then the consolidated risk assessment, then the PM Hero on the right.

The `fast` preset completes well under a minute on one provider key. `full` takes longer because the debate runs two rounds against larger models.

For provider keys, at least one of `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is required for model resolution. Yahoo Finance is keyless. `FINNHUB_API_KEY` is optional for live news and insider transactions; without it those tools return `unavailable` and the news analyst treats the missing data as missing signal, not bearish.

## Session lifecycle and persistence

Sessions are ephemeral by default in flow-state-dev. The trading-desk example opts into persistence by passing `createFilesystemStores` to the API router:

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

- Browse the source: `examples/trading-desk/` in the repo. Each phase is its own directory.
- [Capabilities](/docs/fundamentals/capabilities) — how the `tradingDesk` capability bundles resources, model selection, and context formatters into one import.
- [Patterns overview](/docs/patterns/overview) — the catalog of pre-built compositions, including Round Robin.

## Attribution

Inspired by [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) (Apache-2.0). Independent reimplementation derived from the paper — Y. Xiao et al., *TradingAgents: Multi-Agents LLM Financial Trading Framework*, [arXiv:2412.20138](https://arxiv.org/abs/2412.20138).
