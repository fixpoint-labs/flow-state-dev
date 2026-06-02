# Design: Trading Desk Example (FIX-564)

The trading desk is a five-phase, twenty-agent stock-research pipeline assembled out of flow-state-dev primitives. It takes a `(ticker, date)` input, fans out to nine analyst memos (including a Company Profile renderer that grounds the desk in the underlying business identity, a Market Analyst that establishes the sector/peer/theme context, a Macro Analyst that owns the global economic and geopolitical regime plus its transmission to the specific name, a Quant Analyst that provides cross-sectional factor ranks, statistical composites, risk-regime statistics, and short-interest positioning, and a Disclosure Analyst that reads SEC filings, consensus estimates, and earnings-call transcripts to surface material disclosures and guidance divergence), runs a bull/bear debate consolidated by a research manager, asks a trader for a structured trade proposal, runs a three-way risk critique consolidated into a typed risk assessment, and ends with a portfolio manager committing a typed `PortfolioDecision`. The example exists to exercise the framework: capabilities, resource collections, round-robin and per-step rescue patterns, BP-016 strict schemas, cost-preset routing, and identity-aware transcript rendering. It is not a trading product and is not advice. The pipeline shape and persona structure are a reimplementation in spirit of Tauric Research's [`TradingAgents`](https://github.com/TauricResearch/TradingAgents) (Apache-2.0); the framework wiring, schemas, and rendering are original.

## 1. Pipeline shape

The flow is one outer sequencer that chains five sub-sequencers. Each phase is a container with a `phase-*` component name so the transcript pane fires a divider.

```
analyzePipeline
  .step(seedSession)
  .step(phase1Pipeline)   // setupPhase1Memos → parallel(9 analysts)
  .step(phase2Pipeline)   // setupPhase2Memos → deriveDebateGoal → router → bullStep → bearStep → researchManagerStep
  .step(phase3Pipeline)   // setupPhase3Memos → traderStep
  .step(phase4Pipeline)   // setupPhase4Memos → aggressiveStep → conservativeStep → neutralStep → riskAssessmentStep
  .step(phase5Pipeline)   // setupPhase5Memos → portfolioManagerStep
```

See [`flow.ts`](../../../examples/trading-desk/src/flows/trading-desk/flow.ts) for the actual composition. Each phase pre-creates its memo slots in `pending` so the sidebar can scaffold every entry before any generator runs. The cheap preset (`costPreset: "fast"`) finishes well under a minute. The full preset (`costPreset: "full"`) takes longer-form generations and an extra round of bull/bear debate.

## 2. Identity registry

Twenty agents across six phases live in a single `AGENTS` table in [`agents.ts`](../../../examples/trading-desk/src/flows/trading-desk/agents.ts). Each entry carries `role`, `glyph` (two-character badge mark), `hue` (OKLCH degrees for the per-agent accent), and `team`. Every agent ships from day one — Phase 2–5 entries render in `pending` styling before their phases run. `PHASE_GROUPS` buckets them for the sidebar.

Per-phase registries (`PHASE_1_MEMO_KEYS` through `PHASE_5_MEMO_KEYS`) map a short name (`fundamentals`, `bull`, `trader`, `aggressive`, `portfolioManager`) to `{ agentName, memoKey, collectionKey }`. `memoKey` is the full storage key (`memos/p1/fundamentals`). `collectionKey` is the bare suffix the framework auto-prefixes when you call `collection.create("p1/fundamentals")`. `ALL_MEMO_KEYS` merges every per-phase registry — the navigator iterates this single object.

Phase 1's nine analysts span a three-tier context taxonomy: Company (bottom-up) → Market/Sector (mid) → Macro (top-down). Company Profile grounds the desk in the individual business (sector, industry, description, scale). The Disclosure Analyst is the primary-source reader in the bottom-up tier: it reads SEC filings (10-K annual reports), sell-side consensus estimates, and earnings-call transcripts to surface material disclosures, risk factors, management guidance, and where consensus expectations diverge from management's own language. The Market Analyst fills the mid-tier: sector positioning, peer posture, theme momentum, and sector-specific regulatory or supply-chain overhang. The Macro Analyst owns the top tier: the global economic regime (rates, inflation, growth cycle, yield curve, credit, FX, commodities) and geopolitical overhang, plus a transmission map showing how those forces reach the specific name. The Quant Analyst provides a systematic, numbers-only layer: cross-sectional factor ranks (momentum, value, quality, size, low-vol), statistical composites (Altman Z'', Piotroski F-Score), risk-regime statistics (beta, realized-vol regime, correlation regime), and short-interest positioning. The remaining four analysts (Fundamentals, Sentiment, News, Technical) cut across levels depending on their data sources.

The transcript pane in [`transcript-pane.tsx`](../../../examples/trading-desk/components/transcript/transcript-pane.tsx) keeps a `PRIMARY_STRUCT_AGENTS` set that gates which agents emit structured-output cards: `researchManager`, `trader`, `portfolioManager`. Persona agents and analysts emit memos that show up in the right pane but not as transcript cards.

## 3. Data flow via resources

Every memo is a session-scoped resource in the `memos/**` collection defined in [`resources.ts`](../../../examples/trading-desk/src/flows/trading-desk/resources.ts). The shared `memoStateSchema` carries the common Thesis-shape fields (`headline`, `rating`, `body`, `metrics`, `startedAt`, `completedAt`, `errorMessage`) plus per-phase extension fields. Phase 2's `InvestmentThesis` adds `stance`, `conviction`, `keyRisks`, `keyOpportunities`, `unresolvedDisagreements`. Phase 3's `TradeProposal` adds `direction`, `sizePct`, `stopPrice`, `targetPrice`, `holdingPeriod`, `invalidationCriteria`, `dependsOn`. Phase 4's persona/assessment fields add `posture`, `raisedRisks`, `proposedAdjustments`, `dismissedRisks`, `criticalRisks`, `recommendedAdjustments`, `confidenceCalibration`. Phase 5's `PortfolioDecision` adds `decisionSummary`, `finalRating`, `decisionConfidence`, `acceptedAdjustments`, `keyDependencies`, `upstreamReferences`, `agreesWithTrader`. All extension fields are `nullable` and default to `null` so the same schema validates a memo at any stage.

The Phase 1 fundamentals analyst computes a Tier 1 valuation set from raw statement payloads before the LLM sees them: enterprise value, EV multiples, book and cash-flow yields, leverage metrics, growth-adjusted reads, and dividend yield. Each metric is null when its inputs are unobserved, following the same null-as-honest-signal discipline as the per-tool `source: "unavailable"` pattern. The derivation is a pure function (`computeValuation` in `lib/valuation.ts`) injected as a `<valuation>` context block alongside the raw `<data>` block. No new provider call.

Per-phase `setupPhaseNMemos` taps pre-create each memo in `pending` so the navigator shows the correct scaffold from the start of the phase, before any generator runs. The `session.memoStatus[shortName]` mirror is what `useClientData` reads in the navigator to flicker `pending → writing → published` live during a run.

One `contributions` resource holds the Phase 2 bull/bear round-robin transcript: `phase2Contributions`. The downstream Phase 2 consolidators read it via the `tradingDesk` capability's `phase2Debate` preset rather than threading it through sequencer state. Phase 4 doesn't use `roundRobin()` (see §6 below) — its consolidator reads the three persona memos via the `riskCritiques` preset instead.

The collection declares `client.state: { read: true }` with no projection. That deliberate choice ships the whole memo state to the client so the renderer can dispatch on `body`, `metrics`, `headline`, and the per-phase extension fields without a second fetch.

## 4. State and stream architecture

Session state lives in [`state.ts`](../../../examples/trading-desk/src/flows/trading-desk/state.ts). The flow exposes seven keys to the client: `ticker`, `date`, `costPreset`, `dataSource`, `activePhase`, `maxDebateRounds`, `memoStatus`, and `runComplete`. `seedSession` at the head of `analyze` patches every per-run field — including resetting `memoStatus` to `{}` and `runComplete` to `false` — so a re-run starts from a clean navigator.

`activePhase` drives the transcript pane's phase-divider rendering. `runComplete` flips to `true` only when the Phase 5 commit handler succeeds (`commitPortfolioManagerMemo` patches it at the end of [`writer.ts`](../../../examples/trading-desk/src/flows/trading-desk/phase-5/writer.ts)), giving the status bar a terminal "complete" signal that doesn't require counting items.

Every memo state transition is a dual write. `markWriting`, `commitMemo`, and `markError` (see [`memo-writer.ts`](../../../examples/trading-desk/src/flows/trading-desk/memo-writer.ts) for the Phase 1 originals; later phases copy the shape) both patch the resource state and write `session.memoStatus[shortName]`. The reason for both: resource snapshots batch to terminal status, but session state-change items propagate immediately through the stream. The sidebar wants to flicker live, so it reads `memoStatus`. The memo body wants the consolidated terminal snapshot, so it reads the resource.

The parallel Phase 1 fan-out uses `setStateRecord` instead of `patchState` for `memoStatus` writes — atomic per-key updates avoid the read-modify-write race a `{...prev, [name]: ...}` pattern would hit with nine concurrent analysts.

## 5. The `tradingDesk` capability

Every generator in the pipeline opts into one capability, defined in [`trading-desk-capability.ts`](../../../examples/trading-desk/src/flows/trading-desk/services/trading-desk-capability.ts). The `core` preset is always on. It selects the model — `intent/utility` on `fast`, `intent/chat` on `full` — and injects `<ticker>` and `<date>` context tags from session state. No generator carries its own `model:` slot.

Opt-in presets bundle resources and context formatters for specific upstream artifacts: `investmentThesis`, `tradeProposal`, `riskAssessment`, `phase1Memos`, `bullThesis`, `bearThesis`, `bullContributions`, `bearContributions`, `phase2Debate`, `riskCritiques`. Each opt-in preset declares the resources it reads, so the generator's `resources:` slot stays empty in most cases.

Cost-preset gating lives inside the preset, not at the call site. The `*Full` variants (`phase1MemosFull`, `phase2DebateFull`, `riskCritiquesFull`) declare the same resources as their always-on counterparts, but their context formatters render an empty string when `costPreset !== "full"`. Generators list everything they might want in one static call:

```ts
uses: [
  tradingDesk.presets({
    investmentThesis: true,
    phase1MemosFull: true,
    phase2DebateFull: true,
  }),
],
```

The trader in [`phase-3/trader.ts`](../../../examples/trading-desk/src/flows/trading-desk/phase-3/trader.ts) and the portfolio manager in [`phase-5/portfolio-manager.ts`](../../../examples/trading-desk/src/flows/trading-desk/phase-5/portfolio-manager.ts) are the canonical templates. Phase 2 generators use the always-on `phase1Memos` / `phase2Debate` because those memos load regardless of preset. The two flavors coexist because the same content has two gating policies — full-only in P3/4/5, always-on in P2.

Resources flow through the static preset, so generators don't need to mirror them on their own `resources:` slot. The previous dynamic-`uses` pattern (where a `(ctx) => ...` lambda added presets at runtime and a separate `resources:` slot covered the resources those presets needed) is gone from this example.

## 6. Structured-output schemas at each convergence point

Four typed outputs anchor the pipeline. `InvestmentThesis` from the Phase 2 research manager. `TradeProposal` from the Phase 3 trader. `RiskAssessment` from the Phase 4 consolidator. `PortfolioDecision` from the Phase 5 portfolio manager. Each is enforced by `outputSchema` and validated through `makeSchemaStrict` before serialization.

BP-016 governs the rules. No `z.optional` / `z.default` / `z.nullable` reachable from any output field — strict mode requires every property to be in `required`. Enums of literals only — no shape-varying `z.union`. No `z.record` — OpenAI strict rejects `additionalProperties: true`. A regression spec at [`test/output-schemas-strict.spec.ts`](../../../examples/trading-desk/test/output-schemas-strict.spec.ts) walks each post-strict schema and fails if any forbidden node survives. That walker exists because this class of bug bit Phase 1 (and Phase 2 by inheritance) repeatedly during development.

The `{ h, p, items }` body section shape lives in `resources.ts` and is shared across every memo body. Section fields are nullable in resource state but every generator populates them as `{ h, p }` (with `items` left null). That's consistent across phases — keeping the renderer free of per-phase branches.

## 7. Cost-preset routing

`costPreset` enters the flow as an `analyze` input parameter and `seedSession` patches it onto session state. From there it does three jobs.

The capability's `core` preset reads it to pick the model intent per generator call. Per-generator dynamic `uses` entries pick which preset bundles to activate — `fast` keeps the prompt minimal; `full` adds analyst memos, full debate transcripts, and persona memos. The Phase 2 `phase2RoundRobinRouter` picks one of four pre-built `roundRobin()` instances by `(maxDebateRounds, costPreset)`. The pattern's `maxRounds` and `model` are fixed at construction time, so router selection is how runtime variation happens — see [`phase-2/round-robin.ts`](../../../examples/trading-desk/src/flows/trading-desk/phase-2/round-robin.ts).

A single control-plane surface (`costPreset`) toggles prompt depth, model tier, and debate length together. No per-generator branching outside the capability.

## 8. Per-step rescue and error isolation

Every per-memo step is its own sub-sequencer: `mark-writing → generator → commit`, wrapped in `.rescue([{ block: markError }])`. The trader step in [`phase-3/index.ts`](../../../examples/trading-desk/src/flows/trading-desk/phase-3/index.ts) is the smallest example. Phase 2 uses the same shape three times (bull, bear, research manager). Phase 4 wraps each persona step (chained in fixed order) in its own rescue, plus a final rescue around the consolidator.

The reason: a single outer rescue over a multi-step chain is undiagnosable. You can't tell which step failed without scanning state, and downstream steps never run after the rescue. Per-step rescue surfaces the failing memo's identity directly via the captured `errorMessage` and keeps the pipeline producing whatever artifacts the surviving steps can still emit.

The `formatMemoBlock` helper renders an "unavailable" sentinel when a memo's `headline` is null, so a downstream prompt that depends on an upstream errored memo degrades gracefully rather than throwing.

`session.runComplete` only flips when the Phase 5 commit handler succeeds. A PM failure leaves `runComplete: false` even though the flow itself completes — the right semantics for a "did we get a decision out" signal.

## 9. Why these patterns over alternatives

**Round Robin over Debate in Phase 2.** Both ship in `@flow-state-dev/patterns`. Phase 2 picks Round Robin because the research manager is a synthesizer, not a judge. Earlier Round Robin required a judge to terminate the loop; the trading desk filled that with a stub judge that always returned `done: false`. FIX-597 reshaped the pattern: the judge slot is now an optional per-round *referee* focused on argument-quality auditing (not termination), and termination is `maxRounds` plus an optional runtime `terminateWhen` predicate. Phase 2 uses the reshaped factory directly with `terminateWhen` reading `maxDebateRounds` from session state. Debate still differs structurally — its at-end verdict-judge picks a winner over the transcript — and Round Robin's per-round referee is a different concern. Picking Debate here would mean filling its judge slot with a placeholder when there's no real judging to do; the reshape makes the right primitive obvious without any placeholder.

**Plain sequencer chain plus consolidator in Phase 4.** Phase 4 does not use `roundRobin()`. None of the pattern's distinguishing features fit: single pass (no debate cycling), no referee, heterogeneous roster (the neutral persona has its own output schema), and the personas read prior critiques from the structured persona memos rather than from a shared free-form transcript. The three persona steps run as `aggressiveStep.step(conservativeStep).step(neutralStep)` inside `phase4Pipeline`, each emitting its typed critique in one LLM call and committing it to its persona memo. Conservative and neutral pull prior critiques via memo-backed `context` entries on their generator definitions. The `riskAssessmentGenerator` runs as a downstream step that synthesises the three persona memos into a typed `RiskAssessment` — its own memo with its own typed schema. Phase 2's bull/bear round-robin remains the canonical `roundRobin()` demo in this example.

**Single generator in Phase 5.** No roster. No debate. No consolidator. The weight is in the typed output shape — `PortfolioDecision` carries seven extension fields, structured `acceptedAdjustments` per category, derived `agreesWithTrader` (computed at commit time from `finalRating` vs `trader.direction`), and derived `upstreamReferences`. The orchestration is intentionally trivial. The phase mirrors Phase 3's shape — `setup → markWriting → generator → commit → rescue` — and puts the complexity where it belongs: the schema and the prompt.

## 10. What would be painful without flow-state-dev

Three classes of work the framework absorbs that would otherwise be a couple thousand lines of plumbing.

*Typed resource pre-creation plus live status mirror.* The pipeline pre-creates 18 memo slots so the navigator scaffolds correctly, then transitions each through `pending → writing → published` with a dual write — resource patch plus session-state mirror — so the sidebar can flicker live mid-stream. Without the framework you'd hand-roll a resource registry, a per-key status map, a state-mutation API that handles concurrent writers without races, and the SSE plumbing to ship state changes mid-stream. The framework gives you `defineResourceCollection`, `setStateRecord`, `client.expose`, and `useClientData`. The example uses all four.

*Structured outputs that show up as identity-aware transcript cards.* Setting `agentType: "primary"` with an `agentName` drawn from the canonical `AGENTS` table is the entire mechanism for getting a `TxStruct` card emitted in the transcript with the right glyph and hue. The renderer picks the per-agent accent from the same table. Without the framework you'd reinvent agent identity, manage card emission yourself, and write per-agent rendering rules. With the framework, the only registration step is the `PRIMARY_STRUCT_AGENTS` set on the transcript pane that gates which agents get cards.

*Capability-driven context injection.* The `tradingDesk` capability owns model selection, ticker/date context, and per-artifact preset bundles across 17 generators. Adding a generator means writing `uses: [tradingDesk.presets({ ... })]` and the capability handles the rest. Without it, every generator carries its own `model:`, `resources:`, and `context:` boilerplate, and a "base class for trading-desk generators" emerges that doesn't compose well with anything else. The capability also means tests can swap out a single preset to override what generators see — without touching the generators themselves.

This would all be possible without the framework. It would be a couple thousand lines of plumbing instead of a handful of declarative slots, and the seams would be in load-bearing places.

## 11. Extension points

- **Live data sources.** Wire `FINNHUB_API_KEY` / `FRED_API_KEY` for live news, sentiment, and macro tools; the per-tool fixture/live branch is already in place under `phase-1/tools/`.
- **A new risk persona.** Add an entry to `PHASE_4_MEMO_KEYS`, write a new persona generator (copying one of the three in [`phase-4/personas.ts`](../../../examples/trading-desk/src/flows/trading-desk/phase-4/personas.ts)), add a persona step + commit handler and chain it into `phase4Pipeline`, optionally add a preset to the capability. The touch points are localized.
- **A different final-decision shape.** Swap `portfolioDecisionOutputSchema`, update the PM prompt, update the PM Hero renderer. Nothing upstream of Phase 5 reads back from the PM memo — PM is the only consumer of itself.

## 12. References

- Tauric Research, `TradingAgents` (Apache-2.0): https://github.com/TauricResearch/TradingAgents
- Yijia Xiao, Edward Sun, Di Luo, Wei Wang. *TradingAgents: Multi-Agents LLM Financial Trading Framework*. arXiv:2412.20138.
- Internal: FIX-559 (Phase 1), FIX-561 (Phase 2), FIX-562 (Phase 3), FIX-563 (Phase 4), FIX-564 (Phase 5).
- Codebase entry points: [`flow.ts`](../../../examples/trading-desk/src/flows/trading-desk/flow.ts) (chain), [`services/trading-desk-capability.ts`](../../../examples/trading-desk/src/flows/trading-desk/services/trading-desk-capability.ts) (capability), [`phase-3/trader.ts`](../../../examples/trading-desk/src/flows/trading-desk/phase-3/trader.ts) and [`phase-5/portfolio-manager.ts`](../../../examples/trading-desk/src/flows/trading-desk/phase-5/portfolio-manager.ts) (canonical generator templates), [`test/output-schemas-strict.spec.ts`](../../../examples/trading-desk/test/output-schemas-strict.spec.ts) (BP-016 regression).
