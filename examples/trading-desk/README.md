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

Defaults to `NVDA / 2026-05-06`. Change ticker or date in the top bar and
press **re-run**.

## Live data toggle

Set `dataSource: "live"` when invoking `analyze` to use real data. Phase 1
supports live prices and fundamentals via `yahoo-finance2` (no key); news
and sentiment remain fixture-only with a noted follow-on.

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
