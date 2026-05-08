# Trading Desk — `@flow-state-dev` example

> **Research / demo only.** Not financial advice. No execution. No P&L.

A multi-phase agent-pipeline showcase. A first-time developer types a ticker,
watches analyst memo slots appear in the navigator, then watches a bull/bear
debate unfold and a research manager synthesize an investment thesis. Phases
3–5 stack on top.

## What's included (Phases 1 + 2)

Phase 1 — analyst fan-out:

- **Parallel analyst fan-out** — four sub-agents (Fundamentals, Sentiment,
  News, Technical) running in parallel, each with a distinct identity.
- **Typed memo resources** — every analyst writes a structured `Thesis`-shape
  memo readable via the standard resource hook.
- **Two-pane streaming UI** — transcript on the left, theses on the right.
- **Fixture / live data toggle** — fixtures ship for `NVDA / 2026-05-06`,
  `AAPL / 2026-05-06`, and `JPM / 2026-05-06`. Live prices and fundamentals
  via `yahoo-finance2` (no key required).
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

## What's not yet shipped

- Phase 3 — Trader synthesis and structured trade proposal
- Phase 4 — Risk debate (aggressive / conservative / neutral)
- Phase 5 — Portfolio manager final decision, full README, architecture doc

## Run it

```bash
pnpm install
pnpm --filter @flow-state-dev/example-trading-desk dev
```

Defaults to `NVDA / 2026-05-06`. The top bar exposes four controls:

- **ticker** — text input, defaults to `NVDA`.
- **date** — text input, defaults to `2026-05-06`.
- **preset** — `fast` (cheap utility models) or `full` (higher-tier chat models).
  Resolved via the model resolver's `intent/utility` and `intent/chat` intents,
  so the concrete model depends on which provider key is configured.
- **source** — `fixture` (canonical hand-curated JSON) or `live` (Yahoo Finance
  for prices and fundamentals; news and sentiment fall back to fixtures with a
  noted follow-on).

Press **re-run** to dispatch a new `analyze` request.

The cheap-preset run completes end-to-end in well under a minute on default
models with one provider key configured. Each analyst writes a structured
`Thesis` resource observable via `useResourceCollection`; the navigator's live
`pending → writing → published` flicker comes from `useClientData` reading the
session-state `memoStatus` mirror.

## Provider keys

The flow uses the framework's model resolver. Configure at least one provider
key (typically `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`) so the `intent/utility`
and `intent/chat` intents can resolve. The example does not bundle a
default-model assumption — extend `lib/server.ts`'s `createModelResolver` call
if you want to wire intents to specific gateway models.

`yahoo-finance2` is keyless. The live source for news and sentiment is a
fixture fallback today; setting `FINNHUB_API_KEY` for true live news + Finnhub
sentiment lands in a follow-on.

## Architecture in brief

```
analyze
  └─ seedSession                  (patch session state from input)
  └─ phase-1-analysts             (sub-sequencer, container item)
        ├─ setupPhase1Memos       (.tap — pre-create 4 memos in `pending`)
        └─ parallel
             ├─ fundamentalsAnalyst
             ├─ sentimentAnalyst
             ├─ newsAnalyst
             └─ technicalAnalyst
  └─ phase-2-research-debate      (sub-sequencer, container item)
        ├─ setupPhase2Memos       (.tap — pre-create 3 memos in `pending`)
        ├─ deriveDebateGoal       (.then — { goal } from session state)
        ├─ phase2RoundRobinRouter (.then — picks one of four pre-built
        │                            roundRobin instances by
        │                            (maxDebateRounds, costPreset))
        ├─ stashContributions     (.tap — capture loop transcript)
        ├─ consolidateBullMemo    (.then — write `BullThesis`)
        ├─ consolidateBearMemo    (.then — write `BearThesis`)
        └─ researchManagerGenerator (.then — write `InvestmentThesis`)
```

Each analyst is a sub-sequencer that taps `markWriting`, runs a generator
with role-specific tools, taps `commitMemo` (or `markError` on rescue), and
publishes the structured memo body.

### Why Round Robin and not Debate

Both `roundRobin()` and `debate()` ship in `@flow-state-dev/patterns`. Phase
2 picks Round Robin because the research manager is a *synthesizer*, not a
judge. Round Robin's judge slot is a loop terminator — Phase 2 fills it
with a 3-line stub that always returns `done: false` and leans on
`maxRounds` for termination, which is the pattern's documented idiom for
fixed-length loops. Debate's judge is the pattern's identity, so using
Debate without a real judge would be reaching for the wrong primitive.

Phase 4's risk debate uses `debate()` because it has a real risk judge.
The cross-phase split reflects the actual structural difference, not a
shortcoming of either pattern.

### Per-preset routing

Round Robin's `model` and `maxRounds` are fixed at construction time. Phase
2 needs both to vary by session state, so `phase2RoundRobinRouter` picks
among four pre-built instances — one per `(maxRounds, costPreset)`
combination — at runtime. This trades verbosity in `phase-2/round-robin.ts`
for explicitness everywhere else.

## Disclaimer

**Research / demo only.** Not financial advice. No execution. No P&L.
Mirrors upstream `TauricResearch/TradingAgents` positioning.

## Attribution

Inspired by [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents)
(Apache-2.0). Independent reimplementation derived from the paper —
Y. Xiao et al., *TradingAgents: Multi-Agents LLM Financial Trading
Framework*, [arXiv:2412.20138](https://arxiv.org/abs/2412.20138).
