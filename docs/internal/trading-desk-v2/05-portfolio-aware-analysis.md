# Trading Desk v2 — Feature 05: Portfolio-aware analysis (fit + sizing) + investor-lens conviction

**Status:** spec, ready for execution
**Target app:** `examples/trading-desk` (`@flow-state-dev/example-trading-desk`)
**Owner gate:** This is the flagship example, not framework source. Per the root-oversight role,
landing this needs explicit project-owner direction. The spec is written so a fresh-session
sub-agent can execute it once green-lit.

This spec covers two tightly-coupled pieces of the v2 set:

- **(4) Portfolio-aware analysis** — inject the live portfolio into the trader (Phase 3) and the
  Portfolio Manager (Phase 5), and move the PM's verdict beyond a 5-tier rating to a
  **portfolio-fit verdict**: `{ action ∈ initiate|add|trim|exit|hold, targetWeightPct,
  sizingRationale, concentrationRisk, suggestedAccount }`, sized off the FIX-709 convergence signal.
- **(6) Investor-archetype lenses (FIX-709 INSPIRATION)** — a configurable PACK of documented
  investment LENSES that each re-read the *same* post-Phase-2 evidence bundle in parallel and emit
  their own independent verdict; the desk surfaces **convergence vs divergence**. This is the
  CONVICTION input to PM sizing.

It explicitly does NOT cover: the Portfolio data model / CSV import UI (feature 3), the Past
Reports list (feature 1), the New Analysis modal (feature 2), or the Summary page (feature 5).
Those are separate specs. This spec **depends on feature 3** for the portfolio data source and
states a clean fallback if 3 is not yet landed (see Dependencies).

---

## 1. Problem & outcome

### Problem

The desk today reasons in a portfolio vacuum. Both the trader and the PM prompts hard-code a
disclaimer:

- `phase-3/prompts/trader.prompt.md:11` — *"This is a demo. You do not have portfolio context — no
  account value, no existing positions, no risk budget."*
- `phase-5/prompts/portfolio-manager.prompt.md:11` — *"This is a demo. You do not have portfolio
  context — no account value, no existing positions, no risk budget. Be honest about that…"*

So the output is a single-name buy/sell/hold rating with a size in "% of NAV" that nobody can
ground, because there is no NAV, no existing weight, no cash, no concentration picture. That is the
gap between "interesting demo" and "trustworthy enough to help manage a REAL portfolio."

Separately, every verdict today flows from **one implicit investment philosophy** (whatever the
prompts happen to encode). A buy that only holds under a momentum lens looks identical to a buy that
holds under value, GARP, and macro lenses. The reader can't tell a robust call from a
philosophy-dependent one.

### Outcome

After this feature:

1. A run can carry **selected account(s) + the live holdings/cash/weights** for those accounts.
   The data is frozen onto session state at seed time (same precedent as `userThesis`).
2. The trader and the PM both **see** a `<portfolioContext>` block: existing position in this name,
   current weight, available cash, account types, sector/factor concentration, and
   overlap/correlation with existing names (best-effort from what feature 3 supplies).
3. After Phase 2, a **lens pack** runs: N documented investment lenses each re-read the assembled
   evidence bundle in parallel and emit an independent verdict (`bullish|neutral|bearish` +
   conviction + one-line rationale + key driver). A deterministic **convergence summary**
   (`convergent | mixed | divergent` + agreement score) is computed from those verdicts — NOT by an
   LLM.
4. The PM emits a **portfolio-fit verdict**: `action`, `targetWeightPct`, `sizingRationale`
   (which references existing holdings), `concentrationRisk`, plus a `suggestedAccount`. Sizing is
   explicitly scaled by lens **convergence as the conviction input** (higher convergence → larger
   size; divergence → smaller size or hold), grounded against current weight, available cash, and
   account suitability.
5. The UI shows the portfolio-fit verdict on the PM hero and a lens-convergence strip.
6. Framing stays **"applying X's documented methodology"** and **"documented methodology / not
   financial advice."** No regulated-advice voice, no "what Buffett thinks today."

### Verifiable success criteria

- `pnpm --filter @flow-state-dev/example-trading-desk typecheck` passes.
- `pnpm --filter @flow-state-dev/example-trading-desk test` passes, including the strict-output
  walker (`test/output-schemas-strict.spec.ts`) with the new lens-verdict and portfolio-fit fields.
- With a portfolio supplied: PM memo `portfolioFit.action ∈ {initiate,add,trim,exit,hold}`,
  `targetWeightPct` is a number, and the PM body references the existing position.
- With NO portfolio supplied: the `<portfolioContext>` tag is suppressed (the formatter returns
  `null`), the prompts do not claim a portfolio exists, and `portfolioFit` is emitted in a
  schema-valid "no-portfolio" form (action = `initiate` or `hold`, weight relative to NAV-as-if).
- Lens pack runs in parallel, emits one verdict per configured lens, and a deterministic
  convergence summary is persisted. The transcript does NOT stage a fake debate (FIX-655 honesty
  lesson) — lenses are independent, parallel, and labelled as such.

---

## 2. Data model / schemas

All paths below are under
`examples/trading-desk/src/flows/trading-desk/` unless noted.

### 2.1 Caller input (`flow-schema.ts`) — NOT a generator output, defaults/records legal

Extend `analyzeInputSchema` with an optional `portfolio` object. The pipeline that already exists
runs blind to it (only Phase 3/5 and the lens pack read it), mirroring the `userThesis` precedent.

```ts
// flow-schema.ts — add to analyzeInputSchema (z.object)

/** One holding line within a selected account. Weights are caller-supplied
 *  or computed by feature 3 before dispatch; the flow does not recompute. */
const portfolioHoldingInput = z.object({
  ticker: z.string().min(1),
  account: z.string().min(1),          // account id or label, e.g. "Roth IRA"
  weightPct: z.number(),               // % of total portfolio NAV (0–100)
  marketValue: z.number().nullable().default(null),
  costBasis: z.number().nullable().default(null),
  sector: z.string().nullable().default(null),
});

/** One selected account's cash + type. */
const portfolioAccountInput = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["taxable", "traditional-ira", "roth-ira", "401k", "hsa", "other"]),
  cash: z.number(),                    // investable cash in this account
});

/** Optional per-run portfolio context. Null/absent → the run is portfolio-blind
 *  exactly as today. The pipeline (P1–P2) never sees this; only the lens pack,
 *  the trader (P3), and the PM (P5) read it via the portfolioContext preset. */
const portfolioContextInput = z.object({
  totalNav: z.number(),
  accounts: z.array(portfolioAccountInput),
  holdings: z.array(portfolioHoldingInput),
  // Pre-computed sector/factor concentration, supplied by feature 3 (it owns
  // the portfolio store). Free-keyed maps are LEGAL here (input, not output).
  sectorWeights: z.record(z.string(), z.number()).default({}),
  // Optional caller-supplied concentration/overlap notes (e.g. "3 megacap
  // semis already 22% of book"). Rendered verbatim into context.
  concentrationNotes: z.array(z.string()).default([]),
});

// new field on analyzeInputSchema:
portfolio: portfolioContextInput.nullable().default(null),
// Which account(s) the user is considering this position for. Empty → let the
// PM suggest. Subset of portfolio.accounts[].id.
selectedAccountIds: z.array(z.string()).default([]),
```

> **Note (BP-016 does not apply here):** `analyzeInputSchema` is validated by a handler, not emitted
> by a generator. `z.record()`, `.default()`, and `.nullable()` are all fine. Do not "fix" this to
> strict shape — see `state.ts` which already uses `z.record()` + `.default()`.

### 2.2 Session state (`state.ts`) — frozen at seed, NOT a generator output

Add the same shapes to `sessionStateSchema`, frozen by `seedSession`. Reuse the exact zod objects
from `flow-schema.ts` (import them) so the two never drift.

```ts
// state.ts — import the input sub-schemas and add:
portfolio: portfolioContextInput.nullable().default(null),
selectedAccountIds: z.array(z.string()).default([]),
```

Keep these OUT of `client.expose` for now — the UI reads portfolio context from feature 3's own
resource, not from session state. (If feature 5's Summary later needs to render what a run *used*,
add them to `expose` then.)

### 2.3 Lens pack config (`lib/lenses.ts`) — plain data, not a schema boundary

A lens is documented data: principles, characteristic questions, what it weights, disqualifiers,
horizon, sizing philosophy. Ship a starter pack of 5 (Burry deferred to a Phase-4-bear follow-up,
out of scope here). Each is **maximally differentiated** so convergence is meaningful.

```ts
// lib/lenses.ts
export interface InvestorLens {
  /** Stable id used in resource keys and convergence math. */
  id: string;
  /** Human label, e.g. "Quality-Value". */
  label: string;
  /** The documented practitioner whose methodology this APPLIES. Framing is
   *  "applying X's documented methodology", never "what X thinks today". */
  attribution: string;
  corePrinciples: string[];
  characteristicQuestions: string[];
  weights: string[];          // what this lens over-weights in evidence
  disqualifiers: string[];    // what makes this lens pass regardless of upside
  horizon: string;            // e.g. "5–10 years", "weeks–months"
  sizingPhilosophy: string;   // how this lens sizes on conviction
}

export const STARTER_LENS_PACK: InvestorLens[] = [
  /* quality-value (Buffett/Munger), mechanical-deep-value (Greenblatt magic
     formula), garp (Lynch/PEG), macro-reflexive-momentum (Druckenmiller/Soros),
     cycle-second-level (Howard Marks) — full prose in the file. */
];
```

The pack is **configurable**: add/remove/reorder = edit `STARTER_LENS_PACK` (or, later, a config
slot). v1 keeps it a static export. Document at the top of the file: value/GARP lenses *want*
valuation metrics (EV multiples, earnings yield, ROIC, PEG) that are a separate data dependency
(FIX-705) — the v1 prompt instructs those lenses to reason from the valuation spine + analyst
metrics already present and to explicitly flag where a metric they'd normally use is unavailable
(BP-020 honesty), NOT to invent it.

### 2.4 Lens verdict — GENERATOR OUTPUT, STRICT per BP-016

This is emitted by a generator, so it must survive `makeSchemaStrict` + the walker. No `z.record`,
no `z.optional`, no `z.default`, no heterogeneous `z.union`. Enums of literals and primitives only;
use empty-string sentinels for "N/A" the way `asymmetricEdge` does.

```ts
// phase-2b/lens-verdict-schema.ts  (multi-consumer: generator + writer → its own file)
export const lensVerdictOutputSchema = z.object({
  // Echoed so the commit can validate the generator answered for the right lens.
  lensId: z.string(),
  stance: z.enum(["bullish", "neutral", "bearish"]),
  conviction: z.number().min(0).max(1),
  // One-sentence verdict in this lens's voice. Required, non-empty.
  verdict: z.string(),
  // The single most load-bearing driver THIS lens keys on. Required.
  keyDriver: z.string(),
  // What would flip this lens. Empty string when the lens is genuinely neutral.
  disqualifierHit: z.string(),
  // Honest gap flag: non-empty when this lens needed a metric it did not have
  // (e.g. GARP with no PEG). BP-020 — surface the gap, never fabricate.
  dataGap: z.string(),
});
export type LensVerdictOutput = z.infer<typeof lensVerdictOutputSchema>;
```

> Why NOT one generator emitting an array of all lens verdicts: a single generator emitting "all
> lenses" would (a) let one lens contaminate another (it sees the others' answers as it writes —
> exactly the staged-debate dishonesty FIX-655 warns against), and (b) make the output a big object
> the strict walker still accepts but that couples lenses. Independent parallel generators keep each
> lens blind to the others. See §4.3.

### 2.5 Convergence summary — DETERMINISTIC, computed in a handler (no LLM)

Persisted to a session-scoped resource, NOT to a generator output. Computed from the N lens
verdicts. This is the honesty guarantee: convergence is arithmetic over independent verdicts, not a
narrative an LLM could massage.

```ts
// lens-convergence-resource.ts
const lensVerdictRecordSchema = z.object({
  lensId: z.string(),
  label: z.string(),
  attribution: z.string(),
  stance: z.enum(["bullish", "neutral", "bearish"]),
  conviction: z.number(),
  verdict: z.string(),
  keyDriver: z.string(),
  dataGap: z.string(),
});

export const lensConvergenceStateSchema = z.object({
  verdicts: z.array(lensVerdictRecordSchema),
  // Net directional lean across lenses, conviction-weighted, in [-1, 1].
  netLean: z.number(),
  // Fraction of lenses agreeing with the majority stance, in [0, 1]. This is
  // the CONVICTION SIGNAL fed to PM sizing.
  agreementScore: z.number(),
  // Bucketed read for the UI + the PM context.
  classification: z.enum(["convergent", "mixed", "divergent"]),
  majorityStance: z.enum(["bullish", "neutral", "bearish"]),
  // Lenses that dissent from the majority — the "this is philosophy-dependent" tell.
  dissenters: z.array(z.string()),  // lens ids
});
export type LensConvergenceState = z.infer<typeof lensConvergenceStateSchema>;

export const lensConvergenceResource = defineResource({
  scope: "session",
  ref: "lensConvergence",
  stateSchema: lensConvergenceStateSchema.nullable(),
  default: null,
  writable: true,
});
```

**Classification rule (deterministic, document it in the handler):**
- `agreementScore >= 0.8` → `convergent`
- `agreementScore >= 0.5` → `mixed`
- else → `divergent`
- `netLean = Σ(stanceSign × conviction) / N`, where `stanceSign` is `+1/0/−1` for
  `bullish/neutral/bearish`. `majorityStance` is the modal stance (ties → `neutral`).

### 2.6 Portfolio-fit verdict — GENERATOR OUTPUT on the PM, STRICT per BP-016

Add to `portfolioDecisionOutputSchema` (`phase-5/portfolio-manager.ts`). This is the load-bearing
new output. Every field required; enums of literals; empty-string sentinel for the no-account case
(the `asymmetricEdge` pattern). `suggestedAccount` is emitted by the LLM as a string (the account
LABEL it reasons toward); the **echo/validation against the real account list happens in the commit
handler**, mirroring how `agreesWithTrader`/`upstreamReferences` are derived deterministically.

```ts
// phase-5/portfolio-manager.ts — add to portfolioDecisionOutputSchema:
portfolioFit: z.object({
  action: z.enum(["initiate", "add", "trim", "exit", "hold"]),
  // Target weight as % of total NAV, post-trade. 0 for exit; current weight for hold.
  targetWeightPct: z.number(),
  // Why this size, referencing the existing position / cash / concentration.
  // Required non-empty when a portfolio was supplied; the prompt instructs a
  // "no portfolio supplied" sentence when not (still non-empty — describe the
  // hypothetical sizing basis).
  sizingRationale: z.string(),
  // One-line concentration read (sector/factor/overlap). Empty string only when
  // no portfolio context was available.
  concentrationRisk: z.string(),
  // The account LABEL the PM reasons toward (tax-suitability aware). Empty
  // string when no account is selected/available — the commit handler resolves
  // and validates this against the real account list.
  suggestedAccount: z.string(),
  // How lens convergence shaped the size. Required — forces the PM to state the
  // conviction→size link explicitly. References <lensConvergence>.
  convictionBasis: z.string(),
}),
```

> **STRICT checklist for `portfolioFit`:** object of primitives + one enum-of-literals (`action`).
> No record, no optional/default, no union. It nests cleanly under the already-strict
> `portfolioDecisionOutputSchema`. The walker test already imports that schema (case
> `"Phase 5 portfolioDecisionOutputSchema"`), so the new sub-object is auto-covered. Add an explicit
> assertion anyway (see §6).

### 2.7 Memo state (`resources.ts`) — persisted/rendered shape, RESOURCE STATE (nullable+default)

`memoStateSchema` is resource state, not a generator output — so the **opposite** convention applies
(BP-023): use `.nullable().default(null)`, following every later-phase extension already in the
file. Add a `portfolioFit` mirror plus deterministic echo fields the commit computes:

```ts
// resources.ts — add to memoStateSchema (all .nullable().default(null)):
portfolioFit: z
  .object({
    action: z.enum(["initiate", "add", "trim", "exit", "hold"]),
    targetWeightPct: z.number(),
    sizingRationale: z.string(),
    concentrationRisk: z.string(),
    convictionBasis: z.string(),
    // Resolved/validated in the commit handler, NOT from the LLM:
    suggestedAccount: z.string(),       // resolved account label (or "" )
    currentWeightPct: z.number(),       // existing weight in this name (0 if none)
    weightDeltaPct: z.number(),         // targetWeightPct − currentWeightPct
    hasPortfolioContext: z.boolean(),   // true only when a portfolio was supplied
  })
  .nullable()
  .default(null),
// Lens convergence mirror, projected onto the PM memo at commit so the renderer
// reads it without a second resource fetch (same idea as scenarioStrip reading
// the forecaster memo — but here we mirror because the PM hero owns the verdict).
lensConvergence: lensConvergenceStateSchema.nullable().default(null),
```

`lensConvergenceStateSchema` is `z.record`-free, so it's safe to import into `resources.ts`. Import
it from `lens-convergence-resource.ts` — but watch the cycle rule (BP-019): put the *schema* in a
leaf if `lens-convergence-resource.ts` ever imports back from `resources.ts`. It does not today, so
a direct import is fine; if the executor finds a cycle, lift `lensConvergenceStateSchema` into
`resources.ts` and have the resource file import it from there.

---

## 3. Server / persistence changes

**None required for this feature.** Specifically:

- No new store, no `lib/server.ts` change. The lens-convergence and (existing) memo data persist via
  the already-wired `createFilesystemStores` resource-state store, keyed by session scope. The
  `StoreRegistry` is a fixed set of 11 stores; you cannot and need not add a table.
- Portfolio **durability** (the holdings themselves) is feature 3's concern — a user-scoped resource
  collection it owns. This feature only *reads a snapshot* of that data into the run at dispatch
  time and freezes it onto session state. It does not write portfolio data.
- Re-opening a stored report rehydrates the PM memo (with `portfolioFit` + `lensConvergence`) from
  resource state with zero model spend — the existing `getSessionState({ includeItems: true })` +
  `loadSnapshot` path already covers new memo fields automatically.

Real-money caveat carried forward: the filesystem store is `developmentOnly: true`. Nothing here
makes that worse, but a real deployment must swap the store at the `lib/server.ts` seam (out of
scope, noted in §8).

---

## 4. Flow changes

All new blocks conform to BP-011 (handlers never call blocks; compose as sequencers), BP-012
(`.tap()` for state-mutation-only, no `return input`), BP-014 (never echo input), BP-016 (strict
generator outputs), BP-017 (typed `context:` slot), BP-019 (resources in a leaf), and the
capability-over-plumbing model (single `tradingDesk` entry in every `uses`).

### 4.1 `seedSession` — freeze the portfolio onto state

In `flow.ts`, extend `seedSession.execute` to patch `portfolio` and `selectedAccountIds` from input
(both already validated by `analyzeInputSchema`). Same freeze-at-seed discipline as `userThesis`:

```ts
await ctx.session.patchState({
  /* …existing… */
  portfolio: input.portfolio,
  selectedAccountIds: input.selectedAccountIds,
});
```

No new block — this is one more line in the existing handler.

### 4.2 New capability preset: `portfolioContext` (`capability.ts`)

Add a preset modeled exactly on `valuationSpine` (reads session state, returns `null` to suppress
the tag when absent). It needs no resource — it reads `ctx.session.state.portfolio` directly.
A second tag carries the selected-account hint.

```ts
// capability.ts — new preset inside presets: { ... }
/** Live-portfolio context for the trader (P3) and PM (P5). Returns null to
 *  suppress the tag entirely when no portfolio was supplied — the run stays
 *  portfolio-blind exactly as today. Reads frozen session state, no resource. */
portfolioContext: {
  context: {
    portfolioContext: (_input, ctx) =>
      ctx.session.state.portfolio
        ? formatPortfolioContext(
            ctx.session.state.portfolio,
            ctx.session.state.selectedAccountIds,
            ctx.session.state.ticker,
          )
        : null,
  },
},
```

`formatPortfolioContext(...)` is a new formatter in `lib/format.ts` (BP-018 — it has 2 consumers,
trader + PM). It renders: existing position + current weight in `<ticker>`, total NAV, each selected
account's type + cash, top sector weights, supplied concentration notes, and a derived overlap line
(names already held in the same sector as `<ticker>`). It must be defensive (best-effort from
whatever feature 3 supplied) and never throw.

Add a **lens-convergence preset** too (read by the PM and the lens-pack-summary nowhere else; PM
consumes it as the conviction input):

```ts
lensConvergence: {
  resources: { lensConvergence: lensConvergenceResource },
  context: {
    lensConvergence: (_input, ctx) => {
      const c = ctx.resources.lensConvergence?.state;
      return c ? formatLensConvergence(c) : null;
    },
  },
},
```

### 4.3 New phase: lens pack (parallel, after Phase 2) — `phase-2b/`

Create a new sub-pipeline that runs **after** `phase2Pipeline` and **before** `phase3Pipeline` in
`flow.ts`'s `analyzePipeline`. It is its own phase container so the transcript renders a divider.

Structure (mirrors how Phase 1 fans out analysts, and how Phase 5 sequences a setup tap + a step):

```
phase2bPipeline (container component "phase-2b-lenses", label "Lens pack — parallel verdicts.")
  .tap(setupLensMemos)                 // pre-create N lens verdict memos in `pending`
  .step(lensFanOut)                    // .parallel({ [lensId]: lensStep, ... })
  .tap(computeAndStoreConvergence)     // DETERMINISTIC handler → lensConvergenceResource
```

- **`lensFanOut`** is a sequencer using `.parallel({...})` over one `lensStep` per lens. Each
  `lensStep` is: `.tap(markWriting) → .step(lensGenerator(lens)) → .tap(commitLensVerdict)` with a
  per-step `.rescue([{ block: markError }])`, exactly like `defineAnalyst`'s recipe. Build it with a
  factory `defineLensStep({ lens })` in `phase-2b/lens-step.ts` (BP-024 — identity-only variation →
  factory).
- **`lensGenerator(lens)`** is built by a factory `defineLensGenerator(lens)` in
  `phase-2b/lens-generator.ts`. Each instance:
  - `uses: [tradingDesk.presets({ investmentThesis: true, phase1MemosFull: true, valuationSpine: true })]`
    — the **post-Phase-2 evidence bundle** (the synthesized thesis + analyst memos + spine). All
    lenses read the SAME bundle. They do NOT read each other (independence = honesty, FIX-655).
  - `itemVisibility: { client: true, history: true }` so each lens emits a `TxStruct` card.
  - `outputSchema: lensVerdictOutputSchema`.
  - prompt = a shared `phase-2b/prompts/lens.prompt.md` rendered with the lens's documented fields
    injected via a per-generator `context` tag (`<lens>` carrying principles/questions/weights/
    disqualifiers/horizon/sizing) PLUS a fixed framing clause: *"You are applying
    {attribution}'s documented methodology to the evidence below. This is documented methodology,
    not a claim about what {attribution} thinks today, and not financial advice."*
  - Because these are structured Phase-3-style agents, give each a `createApproachGenerator()`
    preamble? **No** — keep lenses lean: a preamble per lens would 5x the transcript noise. Lenses
    emit their `TxStruct` card directly. (Document this deviation from the Phase 3–5 preamble
    convention in the file header.)
  - **AgentName:** add 5 lens agents to `AGENTS` + a `PHASE_2B_MEMO_KEYS` registry in `agents.ts`
    (team: reuse `"research"` so the sidebar groups them with Phase 2; glyphs e.g. `Qv`, `Mf`, `Gp`,
    `Mr`, `Cy`). Add a `PHASE_GROUPS` entry `{ id: "p2b", label: "Lens Pack — Parallel Verdicts" }`.
    (The sidebar's `id` union and `MemoStatus` mirror must include `p2b`.)
- **`computeAndStoreConvergence`** is a plain `handler` (BP-012 `.tap`, no output, no `return
  input`). It reads the N committed lens memos, builds the `lensConvergenceState` per §2.5's
  deterministic rule, and writes `lensConvergenceResource.patchState(...)`. No LLM. This block is
  the single source of the convergence number.

> **Why parallel and not a debate:** the FIX-709 inspiration is explicit — v1 is independent
> PARALLEL verdicts over the post-Phase-2 bundle plus a convergence summary, NOT a staged debate.
> Each lens is blind to the others. The convergence is computed, not narrated. This is the FIX-655
> honesty lesson made structural.

### 4.4 Trader (Phase 3) — opt into `portfolioContext`

`phase-3/trader.ts`: add `portfolioContext: true` to the `tradingDesk.presets({...})` in
`traderGenerator.uses`. The trader uses it for pre-trade sizing awareness (it already treats
`sizePct` as % of NAV). **No trader output-schema change** — keep the portfolio-fit verdict solely
on the PM (the final arbiter), to avoid two sources of truth. The trader simply sizes more
realistically when it can see existing exposure.

Rewrite `phase-3/prompts/trader.prompt.md:11`: replace the "you do not have portfolio context"
disclaimer with: *"If a `<portfolioContext>` block is present, size relative to the existing
position and available cash it describes; if it is absent, treat `sizePct` as % of a notional NAV
as before and say so."*

### 4.5 PM (Phase 5) — opt into `portfolioContext` + `lensConvergence`, emit `portfolioFit`

`phase-5/portfolio-manager.ts`:
- Add `portfolioContext: true` and `lensConvergence: true` to `portfolioManagerGenerator.uses`
  presets.
- Add the `portfolioFit` object to `portfolioDecisionOutputSchema` (§2.6).

Rewrite `phase-5/prompts/portfolio-manager.prompt.md:11` to drop the no-context disclaimer and add a
decision-rules block that consumes `<portfolioContext>` and `<lensConvergence>`:
- Reason current weight vs target, available cash, tax-account suitability, overlap, risk budget.
- **Convergence → conviction → size:** explicitly instruct that a high `agreementScore` (convergent)
  justifies a larger `targetWeightPct`, and `divergent` pulls toward a smaller size or `hold`,
  stated in `convictionBasis`. This is the FIX-709 sizing link.
- Pick `action ∈ {initiate, add, trim, exit, hold}` from current position + the rating.
- Emit `suggestedAccount` as the account LABEL it reasons toward (tax-suitability aware), or empty
  string when no account is available.
- Keep "documented methodology / not financial advice" framing.

### 4.6 PM commit handler — derive the deterministic echo fields

`phase-5/writer.ts` `commitPortfolioManagerMemo`: add `lensConvergence: lensConvergenceResource`
and (no new resource needed for portfolio — read it from session state via `ctx.session.state`) to
the handler's `resources`/state access. Compute the deterministic pieces (NOT from the LLM,
following the `agreesWithTrader`/`upstreamReferences` precedent):

- `currentWeightPct` — look up the ticker in `ctx.session.state.portfolio?.holdings` (sum across
  selected accounts), else `0`.
- `weightDeltaPct = decision.portfolioFit.targetWeightPct − currentWeightPct`.
- `hasPortfolioContext = ctx.session.state.portfolio !== null`.
- `suggestedAccount` — validate the LLM's label against
  `ctx.session.state.portfolio?.accounts[].label`; if it matches one, keep it; if it doesn't match
  (hallucinated) or no portfolio, set `""`. (Echo/validate, don't trust blindly.)
- Mirror `ctx.resources.lensConvergence?.state` onto the memo's `lensConvergence` field.

Project all of these into the `publishMemo(...)` patch alongside the existing fields. The LLM-emitted
`action`, `targetWeightPct`, `sizingRationale`, `concentrationRisk`, `convictionBasis` pass through;
the four derived fields are computed here.

### 4.7 Flow wiring (`flow.ts`)

- Register the new resource in `defineFlow.resources`: `lensConvergence: lensConvergenceResource`.
- Insert the lens phase into `analyzePipeline` between Phase 2 and Phase 3:
  ```ts
  .step(phase2Pipeline)
  .step(phase2bPipeline)   // ← NEW: lens pack
  .step(phase3Pipeline)
  ```
- The lens pack reads the spine (`computeAndStoreSpine` already taps before Phase 2) and the Phase 2
  thesis — both exist by the time it runs. Good.
- `seedSession` must also reset `lensConvergence` is NOT needed (it's a session-scoped resource that
  re-initializes per run via setup; but if a session key is re-run, clear it in setup or rely on the
  fresh `patchState`). Confirm the resource is re-defaulted on re-run; if not, add a reset tap.

---

## 5. UI changes

All UI is client-side, inside the existing `FlowProvider`. No new routes for THIS feature — the
verdict and convergence render inside the existing report view (`ThesesPane` → `MemoDoc` →
`PmHero`). Inline SVG / flex bars only (no chart lib), matching the existing PmHero idiom.

### 5.1 `MemoClientData` (theses-pane.tsx) — add the new PM fields

Extend the local `MemoClientData` type (it mirrors `memoStateSchema` and must not drift) with
`portfolioFit` and `lensConvergence` (same shapes as §2.6/§2.5, all nullable). Derive the
`portfolioFit` sub-type from `MemoState["portfolioFit"]` the same way `AcceptedAdjustment` is
derived, so it can't drift.

### 5.2 `PmHero` — portfolio-fit panel

Add to `pm-hero.tsx` a new section below the metrics row (only when `portfolioFit !== null`):

```
┌────────────────────────────────────────────────────────────┐
│ PORTFOLIO FIT                                   [ ADD ]      │  ← action chip, color by verb
│ current 1.8%  →  target 3.2%   (Δ +1.4%)        Roth IRA    │  ← weights + suggestedAccount
│ Concentration: 3 megacap semis already 22% of book          │  ← concentrationRisk
│ Sizing: adding here lifts semis to 25%; cash in Roth covers │  ← sizingRationale
│         the buy without trimming.                           │
│ Conviction: 4/5 lenses bullish (convergent) → upsized.      │  ← convictionBasis
└────────────────────────────────────────────────────────────┘
```

- Action chip color: `initiate`/`add` → `--c-live`/`--c-accent`; `trim`/`exit` → `--c-warn`;
  `hold` → `--c-fg-muted`.
- When `hasPortfolioContext === false`, render a muted "No portfolio supplied — sizing is relative
  to a notional NAV" line instead of weights, and still show the rating-only verdict. Do NOT show a
  fake account.

### 5.3 `PmHero` — lens-convergence strip

Add a strip modeled on the existing scenario strip (`pm-hero.tsx:122-168`), reading
`lensConvergence` (only when non-null):

```
┌────────────────────────────────────────────────────────────┐
│ LENS PACK            convergent · 4/5 bullish · netLean +0.6│
│ �['Qv' green]['Mf' green]['Gp' green]['Mr' grey]['Cy' green] │  ← per-lens stance dots, dissenters greyed
│ Quality-Value · Magic-Formula · GARP · Macro · Cycle        │
└────────────────────────────────────────────────────────────┘
```

- Each lens cell: a small colored bar (bullish → `--c-live`, neutral → `--c-surface-2`,
  bearish → `--c-warn`) + the lens label + its conviction. Dissenters (in
  `lensConvergence.dissenters`) get a subtle outline so "this is philosophy-dependent" is visible.
- `classification` drives a header pill (`convergent`/`mixed`/`divergent`).
- Hover/title shows each lens's one-line `verdict` (the documented-methodology framing lives here).

### 5.4 Lens memos in the sidebar

Because lens agents are added to `AGENTS` + `PHASE_GROUPS` (id `p2b`), the existing
`MemoSidebar`/`MemoDoc` machinery renders each lens memo automatically. Each lens memo, when
clicked, renders through the default `ThesisHeader + ThesisBody` path (no special component needed —
the lens verdict's `verdict`/`keyDriver`/`dataGap` can be projected into a small `body` at commit so
the generic renderer shows them). Confirm `ALL_MEMO_KEYS` includes the lens keys so
`shortNameForAgent` resolves them.

> **Note:** the lens verdict output schema (§2.4) has no `body` field. To render in the generic memo
> doc, `commitLensVerdict` should synthesize a 2–3 section `body: ThesisSection[]` from `verdict` /
> `keyDriver` / `disqualifierHit` / `dataGap` (deterministic projection in the writer), plus
> `headline`, `rating` (the stance), and `label`. This keeps the LLM output minimal and strict while
> still giving the renderer something to show.

---

## 6. Exact file create / modify list

### Create

| Path | Purpose |
|------|---------|
| `src/flows/trading-desk/lib/lenses.ts` | `InvestorLens` type + `STARTER_LENS_PACK` (5 lenses, full documented prose). |
| `src/flows/trading-desk/lens-convergence-resource.ts` | `lensConvergenceStateSchema` + `lensConvergenceResource` (session-scoped, nullable). |
| `src/flows/trading-desk/phase-2b/index.ts` | `phase2bPipeline` container (setup tap → `lensFanOut` → `computeAndStoreConvergence` tap). |
| `src/flows/trading-desk/phase-2b/lens-verdict-schema.ts` | `lensVerdictOutputSchema` (STRICT). |
| `src/flows/trading-desk/phase-2b/lens-generator.ts` | `defineLensGenerator(lens)` factory. |
| `src/flows/trading-desk/phase-2b/lens-step.ts` | `defineLensStep({ lens })` factory (markWriting → gen → commit, rescue markError). |
| `src/flows/trading-desk/phase-2b/setup.ts` | `setupLensMemos` (defineMemoSetup over the lens keys). |
| `src/flows/trading-desk/phase-2b/writer.ts` | `markWriting`/`markError` (defineMemoStateBlocks) + `commitLensVerdict` + `computeAndStoreConvergence`. |
| `src/flows/trading-desk/phase-2b/prompts/lens.prompt.md` | Shared lens prompt with `<lens>` + framing clause + `<investmentThesis>`/`<valuationSpine>` references. |

### Modify

| Path | Change |
|------|--------|
| `src/flows/trading-desk/flow-schema.ts` | Add `portfolio`, `selectedAccountIds` + sub-schemas to `analyzeInputSchema`. |
| `src/flows/trading-desk/state.ts` | Add `portfolio`, `selectedAccountIds` to `sessionStateSchema` (import sub-schemas from flow-schema). |
| `src/flows/trading-desk/flow.ts` | Freeze portfolio in `seedSession`; register `lensConvergenceResource`; insert `phase2bPipeline` between P2 and P3. |
| `src/flows/trading-desk/capability.ts` | Add `portfolioContext` + `lensConvergence` presets; import `formatPortfolioContext`/`formatLensConvergence`/`lensConvergenceResource`. |
| `src/flows/trading-desk/lib/format.ts` | Add `formatPortfolioContext(...)` and `formatLensConvergence(...)`. |
| `src/flows/trading-desk/agents.ts` | Add 5 lens agents to `AGENTS`; `PHASE_2B_MEMO_KEYS`; `PHASE_GROUPS` `p2b` entry; include in `ALL_MEMO_KEYS`. |
| `src/flows/trading-desk/resources.ts` | Add `portfolioFit` + `lensConvergence` to `memoStateSchema` (nullable+default). |
| `src/flows/trading-desk/phase-3/trader.ts` | Add `portfolioContext: true` preset to `traderGenerator.uses`. |
| `src/flows/trading-desk/phase-3/prompts/trader.prompt.md` | Rewrite line 11 disclaimer → portfolio-aware sizing rule. |
| `src/flows/trading-desk/phase-5/portfolio-manager.ts` | Add `portfolioContext`/`lensConvergence` presets; add `portfolioFit` to output schema. |
| `src/flows/trading-desk/phase-5/prompts/portfolio-manager.prompt.md` | Rewrite line 11; add portfolio-fit + convergence→conviction→size decision rules + output-shape docs. |
| `src/flows/trading-desk/phase-5/writer.ts` | Derive `currentWeightPct`/`weightDelta`/`suggestedAccount`/`hasPortfolioContext`; mirror `lensConvergence`; project `portfolioFit`. |
| `components/theses/theses-pane.tsx` | Extend `MemoClientData` with `portfolioFit` + `lensConvergence`; pass to `PmHero`. |
| `components/theses/pm-hero.tsx` | Add portfolio-fit panel + lens-convergence strip; extend `PmHeroProps`. |
| `app/page.tsx` | Thread `portfolio`/`selectedAccountIds` into the `analyze` `sendAction` payload (read from feature 3's source; default `null`/`[]` until 3 lands). |
| `test/output-schemas-strict.spec.ts` | Add `lensVerdictOutputSchema` as a new case; the PM case auto-covers `portfolioFit`. Add explicit nested-`portfolioFit` assertion. |
| `examples/trading-desk/CLAUDE.md` | Document the new `phase-2b/` lens pack, the `portfolioContext`/`lensConvergence` presets, and the portfolio-fit verdict. |
| `.changeset/*.md` | User-facing change → add a changeset (BP-022). |

### Tests to add

- `test/lens-convergence.spec.ts` — unit-test `computeAndStoreConvergence`'s deterministic math
  (convergent/mixed/divergent boundaries, netLean sign, majorityStance ties, dissenter list) with
  hand-built lens-verdict inputs. This is the FIX-655 honesty guarantee under test.
- `test/portfolio-fit-commit.spec.ts` — unit-test `commitPortfolioManagerMemo`'s derived fields:
  `currentWeightPct` lookup, `weightDeltaPct`, `suggestedAccount` validation (rejects a hallucinated
  account label → `""`), `hasPortfolioContext` toggling with/without a supplied portfolio. Use
  `runForTest` + a mock memos/lensConvergence resource (mirror existing writer tests).
- Extend `test/output-schemas-strict.spec.ts` as above.

---

## 7. Dependencies (what must exist first)

1. **Feature 3 (Portfolio section + CSV import)** — owns the portfolio data (a user-scoped resource
   collection) and the account model. THIS feature reads a snapshot of that data at dispatch and
   freezes it onto session state.
   - **Fallback if 3 is not yet landed:** ship the *flow + schema + prompt + UI* changes with the
     caller-input wiring in place, and have `app/page.tsx` pass `portfolio: null` /
     `selectedAccountIds: []`. The whole feature degrades to "portfolio-blind exactly as today" (the
     `<portfolioContext>` tag suppresses, `hasPortfolioContext = false`, prompts say so). The lens
     pack + convergence + `portfolioFit`-relative-to-notional-NAV all still run and are testable.
     This makes feature 5 (no hard dependency) and feature 4-without-real-portfolio shippable before
     3. Wire the real `portfolio` payload in a one-line follow-up once 3 lands.
2. **Capability model + presets** (`capability.ts`) — exists today; this feature adds two presets.
3. **Valuation spine** (`computeAndStoreSpine`, `valuationSpineResource`) — exists; the lens pack and
   PM read it. No change needed.
4. **No FIX-702 / Layer-2 reorg dependency.** Build on today's phase-segmented structure (per the v2
   sequencing finding). New generators stay PLAIN generators, not registry Agents.

---

## 8. Real-portfolio considerations

This is the line between demo and "trustworthy enough to manage a REAL portfolio." Honor these:

- **No regulated-advice voice.** Every lens and the PM frame output as *"applying X's documented
  methodology"* and *"documented methodology / not financial advice."* Never *"what Buffett thinks
  today"*, never *"you should buy."* Keep the existing `GROUNDING_CLAUSE` + add the lens framing
  clause. A real user must not mistake this for personalized investment advice.
- **Tax-account suitability is non-trivial.** `suggestedAccount` reasons about taxable vs IRA vs Roth
  (e.g. high-turnover/short-horizon → tax-advantaged; long-hold qualified-dividend → taxable can be
  fine). The PM should state its tax reasoning in `sizingRationale`, and the writer must VALIDATE the
  suggested account against the real account list (never invent an account the user doesn't have).
- **Sizing must reference real constraints.** `targetWeightPct` must be grounded against available
  cash (can the user actually fund this without forced selling?) and current weight (an "add" that
  doubles an already-concentrated position is a risk, not a recommendation). `concentrationRisk` and
  `weightDeltaPct` exist to make this auditable.
- **Convergence is conviction, not truth.** A convergent verdict means many philosophies agree —
  it does NOT mean the call is correct. The UI pill and the PM `convictionBasis` must phrase it as
  "robust across philosophies," not "high probability of being right." Divergence is information
  (philosophy-dependent), not a failure.
- **Honesty over completeness (BP-020).** When a lens needs a metric the data surface lacks (GARP
  with no PEG; deep-value with no EV multiples — the FIX-705 dependency), it must populate `dataGap`
  and reason from what it has, NOT fabricate. The convergence math should arguably down-weight a lens
  that flagged a material `dataGap` — at minimum surface it in the UI so the reader discounts it.
- **No staged debate (FIX-655).** Lenses are independent and parallel; convergence is arithmetic.
  Do not let the transcript imply the lenses argued and reached consensus — they didn't, they each
  read the same evidence once.
- **Stale portfolio = stale advice.** The portfolio is a frozen snapshot at dispatch. If a user's
  real positions moved since import, the fit verdict is stale. Out of scope to solve here, but the UI
  should ideally show the snapshot's as-of date (feature 3 owns that timestamp) near the fit panel.
- **Persistence is dev-only.** `createFilesystemStores({ developmentOnly: true })` is not a
  production store. A real deployment must swap it at the `lib/server.ts` seam, and session reads are
  currently unauthenticated by ownership (any sessionId is fetchable). Both are pre-existing and
  out of scope, but block "manage a REAL portfolio for real users."

---

## 9. What NOT to build (scope boundaries)

- **Do NOT build the Portfolio section / CSV import** (feature 3). This feature consumes that data;
  it does not produce or store it.
- **Do NOT add a trader portfolio-fit output.** The portfolio-fit verdict lives only on the PM (the
  final arbiter). The trader merely *sees* `<portfolioContext>` for sizing realism.
- **Do NOT build the Burry forensic-skeptic lens or any Phase-4 bear lens.** v1 is the 5 documented
  starter lenses. Burry-as-Phase-4-bear is a later follow-up.
- **Do NOT add FIX-705 valuation metrics (EV multiples, earnings yield, ROIC, PEG) as new data.**
  Scope around the existing valuation spine + analyst metrics; lenses flag gaps via `dataGap`.
- **Do NOT stage a lens debate, referee, or multi-round convergence.** Single parallel pass +
  deterministic summary only.
- **Do NOT make convergence an LLM output.** It is computed arithmetic.
- **Do NOT touch `prep/architecture/*`, the store layer, or `lib/server.ts`.** No new store adapter.
- **Do NOT do the Layer-2 reorg.** Build on today's phase-segmented tree.
- **Do NOT use `agentType: "sub"`** (dead vocabulary). Use `itemVisibility: { client, history }`.

---

## 10. Open questions

1. **Where does `app/page.tsx` read the live portfolio from before feature 3 lands?** The spec
   assumes feature 3 exposes a user-scoped portfolio resource read via a hook. Until then, the
   payload is hardcoded `null`. Confirm the contract (resource ref name + shape) with feature 3's
   spec so the two agree on the `portfolioContextInput` shape. If feature 3 lands first, align to its
   exact field names.
2. **Should `selectedAccountIds` live in the metadata tuple (session keying)?** Today a session is
   keyed by `{ticker,date,costPreset,dataSource}`. If two runs differ only by selected account, they
   currently collide on the same session. Likely fine for v1 (account selection is a refinement, not
   a new report), but confirm — if account selection should fork a new report, it must join the
   tuple + `findSessionForTuple` in `app/page.tsx`.
3. **Does the convergence math down-weight a lens that flagged a `dataGap`?** §8 argues it should.
   Proposed v1: keep the math simple (equal-weight by conviction) and surface `dataGap` in the UI
   only; revisit weighting after seeing real divergence. Confirm the owner is OK with equal-weight
   v1.
4. **Lens count vs cost.** 5 parallel generators after Phase 2 add real token spend on every run.
   Should the lens pack be cost-gated (e.g. only on `costPreset === "full"`, like the `*Full`
   presets), or always-on? Recommendation: gate the *number* of lenses or the pack entirely on
   `full` via a `.stepIf` or a `*Full`-style preset, with a 2-lens minimal pack on `fast`. Confirm.
5. **Re-run reset of `lensConvergenceResource`.** Confirm a session re-run re-defaults the resource
   (setup creates fresh memos but the convergence resource may retain prior state). If it persists,
   add a reset in `setupLensMemos` or `seedSession`.
6. **Burry / Phase-4 bear timing.** Confirmed out of scope here — but flag whether the lens-pack
   factory should be designed now to accept a "bear lens that runs in Phase 4" later (the factory
   shape suggests yes; the wiring is deferred).
