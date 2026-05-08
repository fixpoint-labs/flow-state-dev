# Trading Desk — `@flow-state-dev` example

> **Research / demo only.** Not financial advice. No execution. No P&L.

Phase 1 of a five-phase agent-pipeline showcase. A first-time developer types
a ticker, watches four analyst memo slots appear in the navigator, and
watches each transition through `pending → writing → published` with
transcript bubbles streaming live. Phases 2–5 stack on top.

This phase is the foundation: scaffolding, fixture-vs-live data layer,
two-pane streaming UI, and the first LLM stage (parallel analyst fan-out).

## What's included (Phase 1)

- **Parallel analyst fan-out** — four sub-agents (Fundamentals, Sentiment,
  News, Technical) running in parallel, each with a distinct identity.
- **Typed memo resources** — every analyst writes a structured `Thesis`-shape
  memo readable via the standard resource hook.
- **Two-pane streaming UI** — transcript on the left, theses on the right.
- **Fixture / live data toggle** — fixtures ship for `NVDA / 2026-05-06`,
  `AAPL / 2026-05-06`, and `JPM / 2026-05-06`. Live prices and fundamentals
  via `yahoo-finance2` (no key required).
- **Status-bar disclaimer** visible on every run.

## What's not in Phase 1

- Phase 2 — Bull / Bear research debate and investment thesis synthesis
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
```

Each analyst is a sub-sequencer that taps `markWriting`, runs a generator
with role-specific tools, taps `commitMemo` (or `markError` on rescue), and
publishes the structured memo body.

## Disclaimer

**Research / demo only.** Not financial advice. No execution. No P&L.
Mirrors upstream `TauricResearch/TradingAgents` positioning.

## Attribution

Inspired by [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents)
(Apache-2.0). Independent reimplementation derived from the paper —
Y. Xiao et al., *TradingAgents: Multi-Agents LLM Financial Trading
Framework*, [arXiv:2412.20138](https://arxiv.org/abs/2412.20138).
