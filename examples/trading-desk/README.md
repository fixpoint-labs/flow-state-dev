# Trading Desk — `@flow-state-dev` example

> **Research / demo only.** Not financial advice. No execution. No P&L.

A multi-phase agent-pipeline showcase. A first-time developer types a ticker,
watches analyst memo slots appear in the navigator, then watches a bull/bear
debate unfold and a research manager synthesize an investment thesis. Phases
3–5 stack on top.

## What's included (Phases 1–4)

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

Phase 3 — trader synthesis:

- **Single-shot structured synthesis** — one trader generator, no loop.
  Reads the Phase 2 `InvestmentThesis` and writes a typed `TradeProposal`.
- **Typed extension fields** — `direction`, `sizePct`, `stopPrice`,
  `targetPrice`, `holdingPeriod`, `invalidationCriteria`, `dependsOn`.
  These keep the trader's output auditable rather than opaque LLM JSON,
  and let Phase 4 (risk) and Phase 5 (PM) read structured values without
  parsing strings.
- **Cost-preset gates prompt depth** — the cheap preset reads the thesis
  and its extension fields only; the full preset adds the four analyst
  memos and the full bull/bear debate transcript.

Phase 4 — risk debate:

- **Three risk personas in fixed round-robin order** — `aggressiveRisk`
  (push for outsized sizing), `conservativeRisk` (push for tighter risk),
  `neutralRisk` (filter signal from noise). The pattern is Round Robin
  with structured roster overrides — three custom generators replace the
  default `{ text }` agents so each persona's contribution and its typed
  critique fields come from a single LLM call.
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
  preset adds the four analyst memos and the full bull/bear debate
  transcript.

## What's not yet shipped

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
        ├─ consolidateBullMemo    (.then — write `BullThesis`)
        ├─ consolidateBearMemo    (.then — write `BearThesis`)
        └─ researchManagerGenerator (.then — write `InvestmentThesis`)
  └─ phase-3-trader               (sub-sequencer, container item)
        ├─ setupPhase3Memos       (.tap — pre-create p3/trader in `pending`)
        └─ traderStep
             ├─ markWritingP3
             ├─ traderGenerator   (.then — write `TradeProposal`)
             ├─ commitTraderMemo  (.tap)
             └─ markErrorP3       (.rescue)
  └─ phase-4-risk-debate          (sub-sequencer, container item)
        ├─ setupPhase4Memos       (.tap — pre-create 4 p4 memos in `pending`)
        ├─ deriveRiskGoal         (.then — { goal } from session state)
        ├─ phase4RoundRobin       (.then — single round, stub judge,
        │                            three roster slots overridden with
        │                            structured-output persona generators)
        │     ├─ aggressiveStep   (markWriting + generator + commit +
        │     │                     toContributionShape, rescue → markError)
        │     ├─ conservativeStep (symmetric)
        │     └─ neutralStep      (symmetric, neutral schema)
        └─ riskAssessmentStep     (.then — consolidator, write
                                     `RiskAssessment`; rescue → markError)
```

The four Phase 2 `roundRobin()` instances share one
`phase2Contributions` resource (registered on the flow). Phase 4 follows
the same pattern with its own `phase4Contributions` resource. The
consolidation generators declare these on their `resources:` slot and
read entries via `ctx.resources`.

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

Phase 4's risk debate uses `roundRobin()` for a different reason: there
is no judge at all. The three risk personas (aggressive, conservative,
neutral) are not adversaries — they are different postures contributing
to a multi-angled critique. The neutral persona's job is to filter, not
to win, and a downstream consolidation generator synthesizes the three
persona memos into a single `RiskAssessment` that Phase 5 reads. Debate's
anonymized-shuffled-transcript-then-judge identity does not match: Phase
4 wants attributed contributions and a synthesizer, not a verdict.

Phase 4 differs from Phase 2 in two ways. First, all three roster slots
are overridden with custom structured-output generators rather than the
pattern's default `{ text }` agents — each persona's contribution and
its typed critique fields come from one LLM call. Second, the
synthesizer slot is left empty (`synthesizer: false`) and the
`riskAssessmentGenerator` runs as a separate downstream step, so the
consolidated artifact is its own memo rather than the pattern's return
value.

### Per-preset routing

Round Robin's `model` and `maxRounds` are fixed at construction time.
Phase 2 needs both to vary by session state, so `phase2RoundRobinRouter`
picks among four pre-built instances at runtime — one per
`(maxRounds, costPreset)` combination. The four routes share one
`contributions` resource (via the pattern's `contributions` config
field), which is what lets the router's resource-merge succeed.

## Disclaimer

**Research / demo only.** Not financial advice. No execution. No P&L.
Mirrors upstream `TauricResearch/TradingAgents` positioning.

## Attribution

Inspired by [TauricResearch/TradingAgents](https://github.com/TauricResearch/TradingAgents)
(Apache-2.0). Independent reimplementation derived from the paper —
Y. Xiao et al., *TradingAgents: Multi-Agents LLM Financial Trading
Framework*, [arXiv:2412.20138](https://arxiv.org/abs/2412.20138).
