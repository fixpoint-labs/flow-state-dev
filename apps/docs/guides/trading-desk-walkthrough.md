---
sidebar_position: 5
title: A walkthrough of the Trading Desk example
---

# A walkthrough of the Trading Desk example

The Trading Desk example is a five-phase multi-agent pipeline that turns a ticker and a date into a structured trade decision. Four analyst sub-agents read different data sources, two researchers argue bull versus bear, a synthesizer writes an investment thesis, a trader proposes a trade, three risk officers critique it, and a portfolio manager makes the final call.

It is a teaching demo. The agents reason in plain English about stocks because that domain has public, structured prior art to model against. Don't trade real money on it.

This walkthrough names the framework pieces the example uses, in roughly the order they show up during a run. Read [Anatomy of a Flow](/guides/anatomy-of-a-flow) first if the words "block," "generator," and "sequencer" don't already mean something concrete to you.

## The pipeline at a glance

Phase 1 fans out four analyst sub-agents in parallel. Each reads its own data sources and writes a typed `Thesis` memo with claims, evidence, risks, and a recommendation.

Phase 2 runs a bounded bull-versus-bear loop. A research manager synthesizes the debate into an `InvestmentThesis` with explicit `unresolvedDisagreements`.

Phase 3 turns that thesis into a single typed `TradeProposal`: direction, size, stop, target, holding period.

Phase 4 runs three risk officers in round-robin order, then a consolidator emits a `RiskAssessment` with recommended adjustments attributed back to specific personas.

Phase 5 reads everything upstream and emits a `PortfolioDecision` with a five-tier final rating, accepted-or-rejected risk adjustments, key dependencies, and a rationale that cites each stage.

```
analysts (x4 in parallel)
  → bull/bear debate → research manager
    → trader
      → risk officers (x3 round-robin) → risk consolidator
        → portfolio manager
```

Each arrow above is a `.then()` in a sequencer. The whole flow is one chain.

## Phase 1: Parallel sub-agents

A sequencer is the composition primitive. It takes blocks and chains them. The `.parallel()` step on a sequencer runs a set of branches concurrently and produces a single combined output.

Phase 1 uses one `.parallel()` step with four branches. Each branch is itself a sub-sequencer that mirrors the same shape:

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

The four memo slots get pre-created in `pending` by a setup tap that runs before the parallel block. The right-pane navigator sees four placeholder cards from the start of the phase, not just as each analyst completes. That kind of "show the work as it happens" UI falls out of pre-creating the resource entries.

Resources are the live data layer. Each analyst writes its typed memo to a session-scoped resource collection. React reads it through `useResourceCollectionItem`. The framework handles the SSE plumbing; your component is a renderer.

The per-branch `.rescue()` matters too. If the news fetch fails, only the news memo flips to `error`. The other three analysts still complete.

## Phase 2: Round Robin with a synthesizer

Phase 2 introduces a pattern from `@flow-state-dev/patterns`. A pattern is a pre-built sequencer composition that solves a recurring shape. Round Robin runs a roster of agents in fixed order for N rounds, with a "judge" slot that decides when to stop.

The example fills the judge with a three-line stub that always returns `done: false` and leans on `maxRounds: 1` (or `2`, on the full preset) for termination. That is the documented idiom for fixed-length loops. The judge slot exists for variable-length debates; if you don't need one, stub it out.

Why Round Robin over Debate? The research manager that runs after the loop is a synthesizer, not a judge. Debate's judge slot expects "is the question resolved" reasoning, which doesn't match what the research manager does. Reaching for Debate would mean filling its judge slot with a placeholder. That's reaching for the wrong primitive.

Round Robin's `model` and `maxRounds` are fixed at construction time. Varying them at runtime (cheap versus full preset, one round versus two) means picking among pre-built instances via a router. A router is the block kind that selects another block to run based on input or state. Trading Desk constructs four Round Robin instances (the `(maxRounds, preset)` matrix) and routes among them by reading `session.state.costPreset`. One extra block, no special-case branching.

## Phase 3: A single typed-output generator

The trader is one generator. No loop, no pattern, no sub-sequencer. Just an LLM call with a structured output schema (`TradeProposal`).

Reading the upstream thesis happens through a capability. A capability bundles resources, tools, and context formatters; the generator opts in declaratively:

```ts
uses: [tradingDesk.presets({ investmentThesis: true })]
```

That one line means: install the resource that the investment thesis lives in, and format it into the generator's prompt context. No manual wiring of `context: { ... }` functions, no threading the resource through sequencer state. Adding a new generator that needs the thesis is one preset flag.

`agentType: "primary"` on the generator tells the framework to render the structured output as a card in the transcript. The transcript renderer reads the item type and dispatches to the right component. No custom event handling in the React layer.

## Phase 4: Personas in fixed order, then a consolidator

Same Round Robin primitive, used differently. The roster has three slots, each overridden with a custom sub-sequencer that wraps a structured-output generator: `aggressive-risk-generator`, `conservative-risk-generator`, `neutral-risk-generator`. Each persona's contribution and its typed critique fields come from one LLM call.

The pattern's `synthesizer` slot is left empty (`synthesizer: false`). A downstream `riskAssessmentGenerator` runs as a separate step in the phase pipeline so the consolidated artifact is its own memo, separate from the round-robin's running transcript.

Per-persona `.rescue` matters here for the same reason it mattered in Phase 1: if the conservative critique fails, only that memo flips to `error`. The aggressive and neutral critiques still run. The consolidator downstream still has two of three inputs to work with.

The consolidator's `RiskAssessment` carries `recommendedAdjustments` across three axes: sizing, holding period, and invalidation. Each adjustment is attributed back to the persona that argued for it (`source: "aggressiveRisk" | "conservativeRisk" | "neutralRisk"`). Phase 5 picks these up by name and decides which to accept.

## Phase 5: The final decision

The portfolio manager reads everything upstream and emits a single `PortfolioDecision`. It carries:

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

On a fresh run, you'll see the four analyst cards appear in `pending` right away. They flip to `writing` as each analyst starts its generator call, then to `done` as the memos commit. The bull and bear cards follow. Then the trade proposal, then the three risk persona cards, then the consolidated risk assessment, then the PM Hero on the right.

The `fast` preset completes well under a minute on one provider key. `full` takes longer because the debate runs two rounds against larger models.

For provider keys, at least one of `OPENAI_API_KEY` or `ANTHROPIC_API_KEY` is required for model resolution. Yahoo Finance is keyless. `FINNHUB_API_KEY` is optional for live news; without it the news analyst sees empty headlines and reasons accordingly.

## Where to look next

- Browse the source: `examples/trading-desk/` in the repo. Each phase is its own directory.
- [Capabilities](/docs/fundamentals/capabilities) — how the `tradingDesk` capability bundles resources, model selection, and context formatters into one import.
- [Patterns overview](/docs/patterns/overview) — the catalog of pre-built compositions, including Round Robin.

## Attribution

Inspired by [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents) (Apache-2.0). Independent reimplementation derived from the paper — Y. Xiao et al., *TradingAgents: Multi-Agents LLM Financial Trading Framework*, [arXiv:2412.20138](https://arxiv.org/abs/2412.20138).
