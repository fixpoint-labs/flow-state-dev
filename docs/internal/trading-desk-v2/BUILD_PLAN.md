# Trading Desk v2 — Master BUILD PLAN

**Status:** Lead-architect build plan. Sequencing + dispatch authority for the six v2 specs.
**Branch:** `experiment/trading-desk-extended` (build here, slice by slice).
**App:** `examples/trading-desk` (`@flow-state-dev/example-trading-desk`, `private: true`).
**Date:** 2026-06-02

This plan sits **above** the six self-contained feature specs. Each spec is written so a
fresh-session executor can run it in isolation; this plan decides the order they run in, the
shared seams they must agree on, and the one place two specs genuinely conflict (the lens pack —
see §7). Read this first, then the spec for the slice you're dispatched on.

Spec index (all under `docs/internal/trading-desk-v2/`):

| # | Feature | Spec file |
|---|---------|-----------|
| 02 | Past Reports list | `02-past-reports.md` |
| 03 | New Analysis button + modal | `03-new-analysis-modal.md` |
| 04 | Portfolio section (CSV/accounts) | `04-portfolio-section.md` |
| 05 | Portfolio-aware analysis + sizing (+ lens v1) | `05-portfolio-aware-analysis.md` |
| 06 | Per-report Summary page | `06-report-summary-page.md` |
| 07 | FIX-709 investor-lens conviction | `07-fix709-lenses.md` |

> Numbering note: the specs use two different internal numbering conventions (some call Portfolio
> "feature 3", some "feature 4"). This plan refers to features by their **spec file number** (02–07)
> to avoid ambiguity. Where a spec's prose says "feature 3/4/5", map it through the table above.

---

## 1. Executive summary

v2 turns the trading desk from a single-ticker analysis demo into an app that **remembers, owns a
portfolio, and reasons about fit** — the difference between "interesting demo" and "trustworthy
enough to help manage real money." Six features:

- **Past Reports (02)** — every run becomes a durable, re-openable record with a decision snapshot.
- **New Analysis modal (03)** — the run-input surface moves out of a cramped header into a modal,
  with a reserved Portfolio slot.
- **Portfolio section (04)** — durable accounts + holdings via CSV import; the app finally knows
  what the user owns.
- **Portfolio-aware analysis (05)** — the trader and PM see the live portfolio; the PM emits a
  portfolio-fit verdict (initiate/add/trim/exit/hold + target weight + suggested account).
- **Summary page (06)** — a zero-re-run at-a-glance aggregate of a finished report.
- **Investor-lens conviction (07)** — N documented investor lenses independently re-read the
  evidence; convergence vs divergence becomes a conviction signal that shapes sizing.

### The "trustworthy with real money" bar

Every spec restates the same non-negotiables. This plan elevates them to acceptance gates that
**every** slice must hold, not just the ones that mention them:

1. **No invented numbers.** Every figure on screen traces to a named stored field. No client-side
   P&L, sizing, or returns conjured from thin air.
2. **Provenance is visible.** `dataQuality` chips, price `source`/`asOf`, fixture-vs-live — the
   user never mistakes a pinned fixture for a live quote (BP-020 spirit at the UI layer).
3. **No silent substitution.** Live mode never falls back to fixture data quietly.
4. **Honesty over completeness (BP-020).** A missing metric is surfaced (`dataGap`/`missingData`),
   never fabricated.
5. **No staged debate (FIX-655).** Where multiple agents/lenses reason, they are independent and
   parallel; any convergence number is computed arithmetic, never an LLM narrative.
6. **Stored ≠ live.** A re-opened report reads as historical (as-of date prominent, no live
   affordances). A stale portfolio snapshot is labelled as a snapshot.
7. **Decisions are auditable.** The decision-of-record (snapshot, post-clamp rating, sizing basis)
   is durable and complete.
8. **Persistence + auth honesty.** Filesystem store is `developmentOnly: true`; `USER_ID` is
   hardcoded `"devuser"`; session reads are unauthenticated by ownership. These are **known,
   loudly-documented gaps** (see §6 RISK-P1/P2), not silent ones. No slice may ship copy implying
   "your portfolio is safe in production."

These gates are real-money trust requirements. A slice that violates one is not done, regardless
of whether its own spec called the gate out.

---

## 2. THE SPINE: persistence + the portfolio domain land first

Three of the six features — **Past Reports (02)**, **Portfolio (04)**, and **Summary (06)** — are
durable-storage features. Two more — **Portfolio-aware analysis (05)** and **lenses (07)** — read
durable data the others write. The spine is therefore two things, and they must land before the
features that depend on them:

### Spine A — the persistence/decision-record seam (enables 02 + 06)

The good news, verified against the runtime in spec 02 §2 and spec 06 §2: **the persistence
mechanism already exists.** `createFilesystemStores` is wired in `lib/server.ts`; `listSessions`,
`getSessionState({ includeItems: true })` + `loadSnapshot`, `setMetadata` (shallow-merge), and
session-scoped resources all work today and survive `pnpm dev` restarts. There is **no new store
adapter, no new store interface, no new HTTP route** for 02/06.

What must land first is the **write side of the decision record** — the thing Past Reports lists and
Summary/outcome-tracking later consume:

- The `decisionSnapshot` session-scoped resource (02 §3.2) — the durable, machine-scoreable record
  of one report's terminal decision + entry context, written once at PM-commit.
- The `decision` + `reportStatus` **session-metadata projection** (02 §3.1) — the cheap list row,
  merged additively at PM-commit so the list renders from `listSessions` alone.
- The stopped-run badging in the three stop guards (02 §4.2/§5.3).

These all live **inside the existing `commitPortfolioManagerMemo` handler and the three stop
guards** (`flow.ts`, `phase-5/writer.ts`). They are the single highest-leverage change in v2:
they make every prior and future run a durable, findable, re-openable record. Past Reports is then
a read surface over that record; Summary is a second read surface over the same hydrated session.

**Why this is the spine and not "just feature 02":** the decision snapshot is the audit record the
whole real-money thesis rests on. Outcome tracking (future), Summary's decision header (06), and
the Past Reports row all read it. Get its shape right once, at the PM commit, and everything
downstream is a read. Get it wrong and every consumer inherits the defect.

### Spine B — the portfolio data model (enables 04 → 05 → 07)

The portfolio domain is genuinely new durable data and is the hard dependency for the two
analysis features:

- **04 builds the portfolio spine**: one user-scoped, flow-isolated resource collection —
  `accounts` (`accounts/*`), with each account's positions stored inline as a `holdings: Holding[]`
  array — plus the CSV parser, import actions, and the `getQuotes` read action. No store change; it
  rides the existing filesystem store under `{userId}:trading-desk`.
- **05 consumes 04**: it reads a snapshot of that portfolio at dispatch, freezes it onto session
  state, and feeds `<portfolioContext>` into the trader and PM.
- **07's sizing cap** and **06's portfolio-weight chart** also key off this data.

**Note — model simplified.** The original Spine B design used two collections (`accounts` +
`holdings`, keyed `{accountId}__{ticker}`) and a `(accountId, ticker)` composite key to get
last-write-wins isolation under the no-CAS filesystem store. That was later collapsed to ONE
collection with holdings stored inline in each account record: the data is small, rarely-changing
JSON written in batches, so the per-account record is a fine write unit and there is no
concurrent-row-write race to isolate — an import is now one write to one account, not ~21 concurrent
holding writes. The text below describing the two-collection scheme is retained for historical
context but no longer reflects the shipped model.

### What the spine does NOT require

No new store adapter. No `StoreRegistry` change (it's a fixed 11-store set). No new App Router
routes (all features use an in-page view switcher / modal / in-pane tab — see §3). No Layer-2 reorg
(see §4). These are all explicit non-goals across the specs, and the plan holds them.

---

## 3. Dependency graph + recommended build order

### Dependency graph

```
                    ┌─────────────────────────────────────────────┐
                    │  Spine A: decision-record write seam         │
                    │  (snapshot resource + metadata projection +  │
                    │   stop-guard badging, in PM commit/guards)   │
                    └───────────────┬─────────────────────────────┘
                                    │
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                        │
      ┌───────────┐          ┌────────────┐                 │
      │ 02 Past   │          │ 06 Summary │ (read-only core │
      │ Reports   │          │ page       │  needs no spine;│
      └─────┬─────┘          └─────┬──────┘  but its decision│
            │                      │         header reads the│
            │ soft-prereq          │         same PM fields)  │
            ▼                      │                          │
      ┌───────────┐                │                          │
      │ 03 New    │◄───── ThesesPane-thesis-form removal ─────┘
      │ Analysis  │       (03 §6.6 unblocks 02's read-only reuse)
      │ modal     │
      └─────┬─────┘
            │ reserves Portfolio slot in modal
            ▼
      ┌───────────────────────────────────────────┐
      │  Spine B: 04 Portfolio section             │
      │  (accounts + holdings collections, CSV,    │
      │   import actions, getQuotes)               │
      └───────────────┬───────────────────────────┘
                      │ owns the portfolio data source
                      ▼
      ┌───────────────────────────────────────────┐
      │  05 Portfolio-aware analysis + sizing      │
      │  (+ lens pack v1 — see §7 conflict ruling) │
      └───────────────┬───────────────────────────┘
                      │ writes portfolioFit + convergence
                      ▼
      ┌───────────────────────────────────────────┐
      │  06 Summary: portfolio-fit + lens strip    │
      │  blocks (additive to 06's read-only core)  │
      └───────────────────────────────────────────┘
                      ▲
      ┌───────────────┴───────────────────────────┐
      │  07 FIX-709 lens conviction (fast-follow)  │
      │  — see §7: reconcile with 05's lens model  │
      └────────────────────────────────────────────┘
```

### Recommended BUILD ORDER

The order below is the dispatch sequence. It front-loads the spine, sequences the two
`ThesesPane`/`flow.ts`/`writer.ts` editors to avoid collision, and defers the most cost-sensitive,
most-conflicted feature (lenses) to last.

1. **Slice 0 — Tracer bullet** (decision-record spine, vertical end-to-end). See below.
2. **Slice 1 — 02 Past Reports** (completes the read surface over the spine).
3. **Slice 2 — 03 New Analysis modal** (does the `ThesesPane` thesis-form removal once; reserves the Portfolio slot).
4. **Slice 3 — 06 Summary, read-only core** (decision header, conviction strip, analyst grid, factor/scenario/risk; ship §4 price-history tap).
5. **Slice 4 — 04 Portfolio section** (Spine B: accounts/holdings/CSV/getQuotes/PortfolioPane).
6. **Slice 5 — 05 Portfolio-aware analysis + lens v1** (portfolioContext, portfolioFit, the §7-ruled lens pack).
7. **Slice 6 — 06 Summary, portfolio + lens blocks** (fast-follow that fills the seams 05 created).
8. **Slice 7 — 07 lens enrichment / fast-follow** (only the delta over what §7 folds into Slice 5).

Slices 2, 3, and 4 are largely independent of each other (modal UI / summary read / portfolio
domain) and can be parallelized **if** the `app/page.tsx` view-switcher contract (§8) is agreed
first. Slices 5–7 are a strict chain.

### TRACER BULLET — Slice 0 (the smallest end-to-end vertical that proves the spine)

**Goal:** prove the decision-record spine end to end — a run writes a durable, re-openable record —
**without** building the Past Reports list UI, the modal, the portfolio, or anything else.

Scope (a strict subset of spec 02):

1. **Create `decision-snapshot-resource.ts`** (02 §3.2) and register it on the flow
   (`flow.ts` `resources`).
2. **Create `report-index.ts`** schemas (`reportDecisionMetaSchema`, `reportStatusMetaSchema`,
   `parseReportRow`) (02 §3.1) — pure, browser-safe.
3. **Extend `commitPortfolioManagerMemo`** (`phase-5/writer.ts`) to (a) write the snapshot and
   (b) merge the `decision` + `reportStatus: "complete"` metadata, additively (02 §5.2). Resolve
   the `.set` vs `.patchState` verb question (02 §12.1) here, once, by reading the
   `@flow-state-dev/core` resource-handle type — this answer is reused by 05/07.
4. **Badge the three stop guards** with `setMetadata({ reportStatus: "stopped" })` (02 §5.3).
5. **Tests** (02 §8 cases 1–6): `parseReportRow` (complete/legacy/malformed/stopped) + the
   PM-commit snapshot+metadata write + a stop-guard badge.

**Verification (the tracer "lands"):** run `fsdev run` (or the phase-5 writer test harness) for one
ticker to completion; confirm the session metadata now carries `decision` + `reportStatus`, the
`decisionSnapshot` resource hydrates on re-select with zero model spend, the four tuple keys are
**not** clobbered (so `findSessionForTuple` still matches), and legacy sessions still parse. Then
`pnpm --filter @flow-state-dev/example-trading-desk typecheck && test`.

**Why this is the right tracer:** it touches the exact spine seam every durable feature depends on
(the PM commit write path), proves persistence + rehydration end to end, exercises the
non-clobbering metadata-merge contract that the whole Past Reports keying rests on, and resolves
the resource-write-verb question that 05 and 07 also need — all with **zero new UI** and **zero new
store work**. Slice 1 then becomes "render rows over a record that already exists."

---

## 4. Relationship to the Layer-2 identity reorg (FIX-702)

**Recommendation: the reorg is ADDITIVE and DEFERRABLE. Do NOT do it before, or as part of, any v2
feature. Build every v2 slice on today's phase-segmented tree.**

This is unambiguous and every spec agrees (02 §9, 04 §9, 05 §7.4, 06 §8, 07 §2/§9). The grounds,
from the Layer-2 reorg design doc itself (`docs/oversight/TRADING_DESK_LAYER2_REORG_2026-06-01.md`):

- The reorg's own verdict (§9 of that doc) is **"hold the reorg until FIX-702's shapes are
  frozen,"** because doing it now hand-rolls a private dialect of a primitive that is still in spec
  review. Running it under v2 risks the "do it twice" trap — two large diffs to the flagship
  example, the first throwaway (§8 of that doc).
- FIX-702's `materializeAgent` **hardcodes `outputSchema: z.string()`** (reorg doc §6.1). Every v2
  structured-output participant — the PM's `portfolioFit`, the lens verdict schema — **cannot** be
  expressed as a FIX-702 Agent without losing its typed output. So even if we wanted registry
  Agents, v2's new participants can't be them yet. They stay plain generators. This is precisely
  the highest-value pressure-test finding the reorg doc says to feed back into FIX-702 review.
- The reorg's flat `usesCapabilities: string[]` can't express `tradingDesk.presets({...})` (reorg
  doc §6.2) — and every v2 generator uses parameterized presets.

**The one genuinely-safe, genuinely-additive slice of the reorg** (reorg doc §10.3) is the
**tools-extraction half**: moving `phase-1/tools/*` + the tool runtime out of the phase namespace
into a self-contained `tools/` catalog. It has no Layer-2 dependency and is pure reuse win. But it
is **not on the v2 critical path** and touches files (the tool imports) that 04's `getQuotes` and
06's price-history tap both reference. **Recommendation: do not interleave it with v2.** Land all
six v2 features first, then do tools-extraction (or the full reorg, once FIX-702 freezes) as a
clean, separate diff. v2 ships faster and the reorg ships cleaner.

**What v2 should do for the reorg's benefit (cheap, do it):** design the lens pack's persona shape
to mirror the eventual Persona model (07 §9 already does this — `{ corePrinciples,
characteristicQuestions, weights, disqualifiers, horizon, sizingPhilosophy }`). That makes the
later migration a move, not a rewrite, at zero cost now. That is the full extent of v2's obligation
to the reorg.

---

## 5. Per-feature status table

Specs were adversarially reviewed; the digest carried no per-feature blocking verdicts, so
"verdict" below is **this plan's** readiness call from reading each spec against the runtime. "Top
required fixes" are the load-bearing items an executor must resolve (most are open questions the
spec already flags).

| # | Feature | Verdict | Top required fixes (must resolve in-slice) | Depends-on |
|---|---------|---------|---------------------------------------------|------------|
| 02 | Past Reports | **Ready** | Resolve resource write verb `.set` vs `.patchState` (§12.1); the tuple-sync re-open interaction (§6.5) is the #1 bug risk — set header tuple before `selectSession`; `entryPrice: null` reserved (don't ship outcome scoring). | None (spine) |
| 03 | New Analysis modal | **Ready** | Do the `ThesesPane` thesis-form removal exactly once (coordinate with 02); reuse `handleRun`/`pendingDispatch` — do NOT reimplement the dispatch handshake; Portfolio slot must be visibly disabled (no fake portfolio scoping). | None; soft-prereq for 02's read-only reuse |
| 04 | Portfolio section | **Ready, largest** | Empty-state session binding for user-scoped resource reads (§12.1) — pick (a) auto-create session or (b) empty-state CTA; `getQuotes` vs null-price-first (§12.2); `price`-column ambiguity heuristic (§12.4); `replace-account` confirmation UX (§12.6). | Spine B owner — nothing blocks it |
| 05 | Portfolio-aware analysis + lens v1 | **Ready w/ ruling** | §7 lens-model reconciliation (this plan rules: 05 owns lens v1); `selectedAccountIds` in the keying tuple? (§10.2 — recommend no for v1); cost-gate the lens pack on `full` (§10.4); re-run resets `lensConvergence` resource (§10.5); align `portfolioContextInput` field names with 04's actual resource shape. | **04** (data); falls back to portfolio-blind if 04 absent |
| 06 | Summary page | **Ready** | Default tab finished→Summary vs Theses (§11.1); ship price-history §4 tap or cut to trade-levels-only (§11.2); confirm `priceHistoryResource` client-read mirrors `valuationSpine` (§11.4); portfolio-fit + lens blocks are seams only until 05 lands (§9.5). | Read-only core: none. Portfolio/lens blocks: 04+05 / 05-or-07 |
| 07 | FIX-709 lenses | **Fast-follow, conflicts w/ 05** | §7 ruling: 07 is the **enrichment delta** over 05's lens v1, not a parallel second lens system; reconcile phase placement (07's `phase-7` post-decision vs 05's `phase-2b` pre-decision) — this plan picks one; pack size 4 vs 5 (§15.1); sequential vs parallel (§15.2); Forensic-Skeptic-as-permanent-bear biasing `divergent` (§15.5). | 05 (lens foundation), 06 (render home), 04 (sizing cap data) |

---

## 6. Risk register (real-money + framework)

| ID | Sev | Risk | Mitigation |
|----|-----|------|------------|
| RISK-P1 | **HIGH** | **Dev-only persistence.** `createFilesystemStores({ developmentOnly: true })` loses all history (reports + portfolio) on a serverless/ephemeral redeploy. Shipping "your portfolio" on it invites data-loss with real money. | Loud user-facing doc + changeset note on every durable feature (02/04). The store is a single `lib/server.ts` seam → swap to `@flow-state-dev/store-sqlite`/postgres for real use, no code change beyond the seam. Never ship copy implying production durability. |
| RISK-P2 | **HIGH** | **No read authorization.** `getSession`/`getSessionState` accept any sessionId; `USER_ID` is hardcoded `"devuser"`. Multi-user deploy → one user reads another's reports/portfolio by id. | Out of scope to fix in v2 (record, don't hide). Gate any real multi-user deploy on: a real `userId` threaded through `FlowProvider` + ownership checks on session/resource reads. Documented in 02 §10.2, 04 §10.2-3, 05 §8. |
| RISK-P3 | **MED** | **Stale data presented as live.** Re-opened reports + frozen portfolio snapshots can show pinned-fixture or stale prices as if current. | As-of date prominent; no "live" affordances on stored reports (02 §10.4); price `source`/`asOf` + fixture/live chip on portfolio (04 §10.4); snapshot as-of near the fit panel (05 §8). UI-layer BP-020. |
| RISK-P4 | **MED** | **Entry-price gap breaks outcome scoring.** The snapshot reserves `entryPrice: null` because no clean entry price exists until 06's price-history resource lands. Scoring against null is worse than not scoring. | Reserve the field now (02 §4.3); source it from 06's `priceHistoryResource` when that lands; **do not ship outcome scoring against a null entry price** (02 §11). |
| RISK-P5 | **MED** | **Money math in JS floats.** Portfolio totals/weights/P&L accumulate float error; avg-cost collapse is tax-wrong. | v1 uses `number`; label totals as display approximations and cost basis as "average cost (informational)" (04 §10.5/§10.8). Schema is forward-compatible to integer-cents / tax-lots (04 §2.5). Do not imply tax accuracy. |
| RISK-P6 | **MED** | **`replace-account` import is non-atomic.** Delete-then-create with no transaction; a crash mid-import leaves a partial account (no CAS, no rollback). | Document as a known gap (04 §10.7). Default mode is `upsert` (non-destructive). Consider a typed confirmation for `replace-account` (04 §12.6). |
| RISK-F1 | **HIGH (framework)** | **Lens-pack double-build / conflict.** Specs 05 and 07 define incompatible lens systems (different phase, schema, sizing semantics). Building both as-written ships two lens models. | §7 ruling: **one lens pack.** 05 builds lens v1 (foundation + convergence resource); 07 is the enrichment delta. Phase placement decided in §7. The convergence resource shape is owned by one file. |
| RISK-F2 | **MED (framework)** | **Strict-output regression (BP-016).** The lens verdict + `portfolioFit` are generator outputs; this example has been bitten by strict-mode failures 3×. | Both new generator schemas added to `test/output-schemas-strict.spec.ts` as explicit cases (05 §6, 07 §7). Enums-of-literals + empty-string sentinels only; no record/optional/default/union. |
| RISK-F3 | **MED (framework)** | **Lens cost multiplier.** N parallel/sequential heavy generators per run multiply token spend. | Cost-gate: lenses run on `costPreset === "full"` only (07 §6.5, 05 §10.4). `fast` skips the pack entirely. Tune N (default 4–5) against observed run cost before growing. |
| RISK-F4 | **MED (framework)** | **Shared-file write collisions across slices.** `flow.ts`, `state.ts`, `resources.ts`, `capability.ts`, `phase-5/writer.ts`, `agents.ts`, `theses-pane.tsx`, `app/page.tsx` are each touched by 3–5 features. | Serialize the slices that edit the same hot file (see §8 ownership). The `ThesesPane` thesis-form removal happens once in 03. The `app/page.tsx` view-switcher contract is fixed before parallelizing 02/04. |
| RISK-F5 | **LOW (framework)** | **Import cycles (BP-019).** New resources/formatters (portfolio, lens, price-history) can create capability↔resource cycles. | Every new resource/schema in its own leaf file importing only core+zod; capability imports the leaf, generator imports the capability (05 §2.7 note, 07 §6.2 guard, 06 §4.1). |
| RISK-F6 | **LOW (real-money)** | **Convergence mis-read as truth.** A "convergent" lens panel means philosophies agree, not that the call is correct; "divergent" is information, not failure. | UI copy: "robust across philosophies," never "high probability of being right"; robustness adjusts sizing **down only**, never up (07 §13). Under-claiming robustness is the safe failure mode. |

---

## 7. How FIX-709 convergence/divergence threads into sizing + summary — and the conflict ruling

### The conflict (must be resolved before Slice 5)

Specs **05** and **07** both build a lens pack, and they are **not compatible as written**:

| Dimension | Spec 05 (`phase-2b`) | Spec 07 (`phase-7`) |
|-----------|----------------------|----------------------|
| Phase placement | After Phase 2, **before** Phase 3/5 | After Phase 6, **after** the PM decision |
| What lenses read | Post-Phase-2 evidence bundle (pre-decision) | Post-Phase-5 bundle **including the PM verdict** |
| Sizing linkage | Convergence feeds the PM **as a context input** in the same run (PM reasons with it) | Convergence is **post-hoc**; caps the PM's sizing after the fact, no PM re-run |
| Verdict schema | `lensVerdictOutputSchema` shape A (stance bullish/neutral/bearish, conviction, keyDriver, dataGap) | `lensVerdictOutputSchema` shape B (5-tier `lensRating`, `sizingStance` enum, `decisiveEvidence[]`, `missingData[]`) |
| Default pack | 5 lenses (incl. mechanical-deep-value, GARP) | 4 lenses (defers deep-value + GARP to FIX-705) |
| Convergence resource | `lensConvergenceResource` (agreementScore, netLean, classification) | `lensConvergenceResource` (robustnessScore, signal, buy/hold/sell sides) |

These are two coherent but **mutually exclusive** designs. Building both produces two lens systems,
two `lensConvergenceResource` definitions, and contradictory sizing semantics.

### Ruling

**One lens pack. 05 owns the lens foundation; 07 is the enrichment delta.** Concretely:

1. **Adopt 07's phase placement and honesty model, but 05's sizing linkage.** Run lenses as their
   own phase that reads the **pre-decision** bundle (05's instinct), because the conviction signal
   is most useful **as an input the PM reasons with** — that is the FIX-709 thesis: convergence →
   conviction → size, *inside* the decision, not bolted on after. 07's post-hoc "cap after the
   fact, no PM re-run" is the more conservative design, but it makes the lens panel a second-opinion
   sticker rather than a sizing input, which is weaker for the real-money goal. **Place the lens
   pack after Phase 2 (as `phase-2b` per 05 §4.3), feed convergence into the PM as context (05
   §4.5), and let the PM emit `portfolioFit` sized by it.** Drop 07's `phase-7`-after-PM placement
   and its option-A post-hoc cap.

   > Rationale grounded in the specs: 05 §4.5 ("Convergence → conviction → size: high agreementScore
   > justifies larger targetWeightPct; divergent pulls toward smaller/hold") is the stronger
   > real-money design than 07 §6.8-A ("post-hoc cap, lenses re-read the PM's own output"). 07 itself
   > flags that reading the PM's output creates a circular loop (07 §6.8-B rejected). Reading the
   > **pre-decision** bundle avoids that circularity entirely.

2. **Verdict schema: use a single STRICT `lensVerdictOutputSchema`.** Reconcile to one shape that
   carries both the stance (for convergence math) and the honesty fields (`dataGap`/`missingData`).
   05's shape is sufficient for sizing; add 07's `missingData` honesty array. One file, one schema,
   added to the strict walker once.

3. **Pack size: start at 4 (07's roster), gate on `full`.** 07's 4-lens roster (quality-value,
   cycle-risk, macro-reflexive, forensic-skeptic) is the cost-conscious, FIX-705-unblocked floor.
   05's 5th/6th lenses (mechanical-deep-value, GARP) are FIX-705-blocked per 07 §3 and must NOT ship
   in v1. The pack is a config array so adding them later is one edit.

4. **Convergence is deterministic, computed in a handler, never an LLM output** (both specs agree —
   05 §2.5, 07 §5). This is the FIX-655 honesty guarantee and is non-negotiable. One
   `computeLensConvergence` handler, unit-tested on the classification boundaries (the
   intent-encoding test).

### First-build vs fast-follow

- **First build (in Slice 5, with 05):** the lens pack foundation — the persona pack, the per-lens
  generator factory, the STRICT verdict schema, the deterministic convergence handler + resource,
  the cost gate, and the PM consuming `<lensConvergence>` to size `portfolioFit`. This is the
  minimum that makes convergence a *sizing input*, which is the whole point.
- **Fast-follow (Slice 6 + Slice 7):** the **Summary rendering** of the lens strip (06 §9 seam) and
  the **per-lens memo cards / convergence strip** in the report view (07 §10). These are pure
  consumers of the resource Slice 5 writes; they have no sizing logic and can land after.

So: **convergence/divergence is born inside sizing (Slice 5) and rendered as a fast-follow
(Slices 6–7).** It threads into sizing via the PM reading `<lensConvergence>` and stating the
`convictionBasis` (the conviction→size link, 05 §2.6/§4.5); it threads into Summary via the lens
strip card reading the same convergence resource (06 §9, 07 §10b). Sizing only ever adjusts **down**
on divergence (RISK-F6) — convergence removes a cap, it never inflates.

> **Dispatch note for the executors of 05 and 07:** both specs are valid reading material, but
> neither is buildable verbatim. The 05 executor builds the foundation under the §7 ruling (phase
> placement = pre-decision, schema = reconciled, pack = 4, sizing = PM-consumes-context). The 07
> executor builds **only the rendering/enrichment delta** not already in Slice 5, and treats 07's
> `phase-7` placement / post-hoc-cap / 5-tier-rating-verdict as **superseded by this ruling.**

---

## 8. What each subsequent implementation workflow should own

Each slice is a dispatchable unit. Ownership is drawn so that hot shared files (RISK-F4) are edited
by one slice at a time, and so each executor has a clean acceptance gate.

**Shared contract to fix before parallelizing (all UI slices depend on it):** the `app/page.tsx`
view-switcher. All of 02, 04, 06 introduce in-page view branching; 03 slims the TopBar. Agree the
`TradingDeskApp` `view` enum (`"desk" | "reports" | "portfolio"`) and that the modal (03) is
orthogonal (reachable from every view) **before** dispatching 02/04 in parallel. Author the TopBar
nav as its own flex group (02 §6.4) so it coexists with the slimmed-header button (03).

- **Slice 0 (Tracer) owns:** `decision-snapshot-resource.ts`, `report-index.ts`, the
  `commitPortfolioManagerMemo` snapshot+metadata write, stop-guard badging, and the resource-write-
  verb resolution. **Acceptance:** a run produces a durable, rehydrating decision record; tuple
  keying intact; legacy rows parse; typecheck+test green. **Touches:** `flow.ts`, `phase-5/writer.ts`.

- **Slice 1 (02 Past Reports) owns:** `PastReportsPane`, `ReportRow`, the in-page reports view, the
  TopBar nav toggle, the open-report tuple-sync fix (§6.5 — the #1 bug). **Acceptance:** prior runs
  list newest-first with decision chips and re-open with zero model spend; legacy/stopped/in-progress
  rows render. **Touches:** `app/page.tsx`, `topbar.tsx`, new `components/reports/*`.

- **Slice 2 (03 New Analysis modal) owns:** `NewAnalysisDialog`, the TopBar slimming, **the
  one-and-only `ThesesPane` thesis-form removal** (03 §6.6 — this unblocks 02's read-only reuse),
  the reserved Portfolio slot. Reuse `handleRun`/`pendingDispatch` unchanged. **Acceptance:** modal
  starts an identical run to today's header form; header carries no run-input fields; sub-20-char
  thesis still warns. **Touches:** `topbar.tsx`, `theses-pane.tsx`, `app/page.tsx`, new
  `new-analysis-dialog.tsx`.

- **Slice 3 (06 Summary read-only core) owns:** `components/summary/*` (aggregate + decision header
  + conviction strip + analyst grid + factor/scenario/risk panels + inline-SVG charts), the
  in-`ThesesPane` Theses|Summary tab, and the optional price-history tap + resource (06 §4 —
  recommend shipping it; it also closes RISK-P4's entry-price gap). **Acceptance:** finished report
  shows an at-a-glance summary from stored state, zero re-run; degrades gracefully on missing memos;
  disclaimer stays visible. **Touches:** `theses-pane.tsx`, `flow.ts` (tap only), new
  `price-history-resource.ts` + `store-price-history.ts`.

- **Slice 4 (04 Portfolio section) owns Spine B:** `portfolio/` flow folder (schema, CSV parser,
  resources, actions, getQuotes), `components/portfolio/*`, the Portfolio view + nav. **Acceptance:**
  paste a brokerage CSV into a chosen account; same ticker in two accounts = two rows; survives
  restart; null price degrades gracefully; parser + action tests pass. **Touches:** `flow.ts`,
  `app/page.tsx`, `topbar.tsx`, `status-bar.tsx`, new `portfolio/*` + `components/portfolio/*`.

- **Slice 5 (05 Portfolio-aware + lens v1) owns the analysis brain + the §7-ruled lens foundation:**
  `analyzeInputSchema`/`sessionStateSchema` portfolio fields, `seedSession` freeze, `portfolioContext`
  + `lensConvergence` presets, the lens phase (placement per §7 ruling), the STRICT reconciled lens
  verdict schema, the deterministic convergence handler+resource, `portfolioFit` on the PM output +
  commit-derived echo fields, prompt rewrites, PmHero portfolio-fit panel + lens strip, the cost
  gate. **Acceptance:** with a portfolio, PM emits `portfolioFit` referencing the existing position;
  without one, it degrades to portfolio-blind; lens pack runs on `full`, convergence is deterministic
  and unit-tested; strict walker passes. **Touches:** the most files — coordinate it to run after 04
  lands. **Reads** 04's portfolio resource (align field names).

- **Slice 6 (06 Summary portfolio + lens blocks) owns the fast-follow fill:** the portfolio
  weight-before/after chart (06 §9.5 seam) and the lens-convergence strip in the Summary, reading
  the resources Slice 5 wrote. **Acceptance:** Summary shows portfolio fit + lens convergence for a
  run that had them; omits cleanly for runs that didn't. **Touches:** `components/summary/*` only.

- **Slice 7 (07 lens enrichment) owns only the delta over Slice 5:** per-lens memo cards
  (`LensCard`), the report-view convergence strip, sidebar/`PHASE_GROUPS` wiring, and any roster/UX
  refinements (pack tuning, forensic-skeptic bias handling). **It does NOT rebuild the lens pack,
  schema, or convergence handler** — those landed in Slice 5 under the §7 ruling. **Acceptance:**
  each lens renders as a card with the honesty (`missingData`) line; convergence strip carries the
  three required honesty lines. **Touches:** `theses-pane.tsx`, `agents.ts`, new
  `components/theses/lens-*.tsx`.

---

## 8a. Resolved decisions (carried forward from Slice 0 — override the spec prose)

These were resolved during Slice 0 against the **real** `@flow-state-dev/core` runtime. The specs
predate them; where a spec says otherwise, follow this.

- **Single-resource write verb is `.patchState(fullObject)`, NOT `.set(...)`.** Specs 02/05/07 wrote
  `resource.set(...)`. `.set()` does **not** exist on a single-resource handle — `ResourceRef`
  (`packages/core/src/types/resource.ts`) exposes `patchState` / `setState` / `updateState`;
  `.set()`/`create`/`upsert` live only on resource *collections*. The `decisionSnapshot` and the
  forthcoming `lensConvergence` + portfolio-fit resources (Slices 5/7) are **single** resources →
  use `patchState`. Verified live precedent: `valuationSpine.patchState(spine)`. On a defaultless
  nullable single resource, the first `patchState` initializes it, so passing the full object is
  correct.
- **Session-metadata writes are additive via `ctx.session.setMetadata({ metadata: {...} })`.** The
  runtime shallow-merges (`createExecutionContext.ts:1662`: `{ ...current.metadata, ...input.metadata }`),
  so writing only the new keys preserves the four tuple keys `findSessionForTuple` matches on
  (`ticker`/`date`/`costPreset`/`dataSource`). Any metadata write in 05/07 follows this — never write
  the whole metadata bag.
- **The decision-of-record stores the POST-CLAMP `finalRating`.** Slice 0 snapshots the value after
  `clampRatingToBand`, not the raw PM rating, and a regression test forces a band-out clamp to lock
  it. Sizing/outcome consumers (05/07) read the snapshot's `finalRating` as the rating the desk
  acted on.

## 9. Bottom line

Build the spine first (Slice 0 tracer proves it end to end), complete the read surfaces over it
(02, 06-core), do the one-time `ThesesPane` cleanup in the modal slice (03), then build the
portfolio domain (04) and the analysis brain that consumes it (05, which folds in the single
reconciled lens pack per §7). Render the portfolio-fit and lens signals as fast-follows (06-blocks,
07). Hold the Layer-2 reorg entirely until FIX-702 freezes — it is additive, deferrable, and off
the v2 critical path. Keep the eight real-money trust gates (§1) green on every slice. That order is
reviewable slice by slice, front-loads the durable-data correctness decisions, and resolves the one
genuine spec conflict before it can ship twice.

## 10. Follow-ups / deferred backlog (post-Slice-4b)

Captured during the Slice 4b (PDF import) + always-live-pricing work. Neither is on the Slice 5
critical path — Slice 5 can proceed against the current model. Each is self-contained for an
isolated executor session.

### Follow-up A — Durable last-price cache (persist price + `lastRefreshedAt`)

**Problem.** `getQuotes` writes only to the **session-scoped** `portfolioQuotes` resource (transient).
The durable holding (user-scoped) carries no price, so prices vanish across sessions until re-fetched,
and there is no "last known price / how stale" surface. Now that the portfolio always fetches **live**
(see commit "always price the portfolio live"), a durable cache is the natural complement.

**Task.** On each live quote fetch, also persist `{ price, asOf, lastRefreshedAt, source }` to a
durable store and surface "prices last refreshed <when>" in the pane.

**Decision needed.** Store the price on the holding vs a separate durable cache. **Lean: a
user-scoped `quoteCache` collection keyed by ticker** — it avoids re-writing account records on each
refresh and naturally dedupes a ticker held in two accounts (which, under the inline-holdings model,
is two separate entries — one per account's array — that would otherwise each carry their own copy of
the price). A per-ticker cache keeps one price per ticker regardless of how many accounts hold it.

**Real-money gates.** A persisted price MUST carry its own `asOf` so a stale cached price is shown
**as stale**, never as live; never fabricate a price to fill the cache; a cache miss still degrades to
`—`.

### Follow-up B — Split the portfolio into its own flow

**Problem.** The `trading-desk` flow currently owns BOTH the analysis pipeline AND all portfolio
actions (`saveAccount`/`deleteAccount`/`importHoldings`/`deleteHolding`/`getQuotes`/
`extractHoldingsFromPdf`) + the portfolio resources. This couples portfolio management to the analysis
flow's lifecycle. Portfolio management is a distinct concern.

**Task.** Extract a standalone `portfolio` flow (its own `defineFlow` with the portfolio actions, the
user-scoped `accounts`/`holdings` collections, `getQuotes`, and PDF import), leaving `trading-desk` as
the analysis flow. Slice 5's portfolio-aware analysis then reads the portfolio flow's resources
cross-flow.

**Caveats / open questions.**
- **Data migration.** User-scoped + `flowIsolation: true` resources persist under `{userId}:trading-desk`
  today; a `portfolio` flow changes the key to `{userId}:portfolio` — existing holdings would need a
  migration or a dual-read shim.
- **Session/binding.** The empty-state binding (spec §12.1) currently reuses an *analysis* session
  snapshot to read user-scoped data; a standalone portfolio flow needs its own session/binding story.
- **Sequencing.** Dovetails with the Layer-2 identity reorg (§4) and the standalone-flow direction —
  sequence with FIX-702 rather than ahead of it.
