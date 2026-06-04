# 07 — FIX-709 Investor-Lens Conviction Signal

> **Status of FIX-709:** INSPIRATION ONLY. This spec borrows the idea; it does
> NOT change FIX-709's Linear status. Do not move, close, or comment FIX-709.

**Feature owner doc.** Self-contained — a sub-agent in a fresh session can
execute this without reading the other v2 specs. Where this feature touches
features 4 (portfolio-aware sizing) and 5 (Summary page), the integration
points are spelled out so it works whether or not those land first.

---

## 1. Problem & outcome

### Problem

The trading desk today reasons from **one implicit investment philosophy**.
The Phase 1–5 pipeline produces a single chain of judgment ending in the
Portfolio Manager's `finalRating`. That number is only as robust as the one
worldview baked into the prompts. A "Buy" that holds only under a momentum
worldview and falls apart under a deep-value worldview is *philosophy-dependent*
and should be sized smaller (or flagged) — but the desk has no way to surface
that today. For a tool meant to help manage a **real** portfolio, "would this
call survive a different reasonable investor reading the same evidence?" is the
single most decision-relevant question we are not asking.

### Outcome

A small, documented **Lens Pack**: N investor-archetype lenses (default 4) that
each **independently re-read the already-assembled post-Phase-5 evidence
bundle** (the same memos the PM read) and emit their **own verdict** — a 5-tier
rating + conviction + the one-line reason their methodology produces it. The
desk then computes a deterministic **convergence signal**:

- **CONVERGENCE** — most lenses land on the same side → a *robust* call that
  holds under many philosophies.
- **DIVERGENCE** — lenses split → a *philosophy-dependent* call.

This convergence signal becomes a **conviction/robustness score** that:

1. **Feeds PM sizing (feature 4).** A divergent call caps target weight; a
   convergent call permits the PM's full sizing. (Surfaced as context the PM
   reads; the *sizing decision* stays the PM's — see §6.4 for why we do NOT
   re-run the PM.)
2. **Headlines the Summary (feature 5).** A "Lens Convergence" strip + a single
   robustness chip ("4/4 agree" vs "2 Buy / 2 Sell — philosophy-dependent").

### Non-negotiable honesty framing (FIX-655 lesson)

- These are **independent parallel verdicts**, not a staged debate. The lenses
  do **not** see each other's output. We never imply lens B "responded to" lens
  A. The UI label is literally **"Independent verdicts"** / **"Convergence"** —
  never "Debate" or "Consensus reached."
- Each lens is framed as **"applying X's documented methodology"**, never
  **"what X thinks today."** A lens is a *reusable reading of public
  methodology*, not a channeling of a living person's current opinion.
- **Not advice.** The existing grounding/not-advice framing is preserved; the
  lens pack adds a worldview reading, not a recommendation to act.

---

## 2. Scope decision: first-build vs fast-follow

**Recommendation: FAST-FOLLOW, not first-build.**

Reasoning, grounded in the v2 set:

- The lens pack is a **pure consumer** of the post-Phase-5 bundle. It depends on
  Phases 1–5 being complete and on the memo/resource surface already shipped.
  Nothing in the lens pack is a prerequisite for any other v2 feature.
- Its highest value is realized **through** features 4 and 5: the conviction
  score is only meaningful once (4) consumes it for sizing and (5) renders it.
  Building lenses before 4/5 exist means shipping a signal nothing reads.
- It is the **most cost-sensitive** feature in the set (N lenses multiply
  generator calls — see §8). Shipping it last lets us tune N and the cost gate
  against real run costs observed from 1–6.

So the build order is: **(1) Past Reports → (2) New-Analysis modal → (3)
Portfolio import → (4) portfolio-aware sizing → (5) Summary → (6) FIX-709
lenses.** The lens pack lands once there is a sizing decision to inform and a
Summary to headline.

**Build it on TODAY's phase-segmented structure.** Do NOT gate on the Layer-2
identity reorg (FIX-702 is unfrozen; its `materializeAgent` hardcodes
`outputSchema: z.string()`, which cannot express a structured lens verdict, and
its flat `usesCapabilities: string[]` cannot express `tradingDesk.presets({…})`).
The lens generators stay **plain generators** using the existing `tradingDesk`
capability, exactly like every Phase 3–6 agent. See §9 for how the *data model*
anticipates the eventual Persona model without depending on it.

---

## 3. Lens roster (v1) — scoped to today's data surface

Lenses are **maximally differentiated** so convergence/divergence is meaningful.
Each is a **resource-backed Persona document** carrying:
`{ id, label, attribution, corePrinciples, characteristicQuestions, weights,
disqualifiers, horizon, sizingPhilosophy }` (the Layer-2-anticipating shape — §9).

### Ships in v1 (works on today's data surface)

| id | label | attribution (methodology) | what it weights | reads cleanly today? |
|----|-------|---------------------------|-----------------|----------------------|
| `quality-value` | Quality-Value | Buffett / Munger documented methodology | durable moat, ROIC quality, management, margin of safety | **Partial** — qualitative moat/quality signals are in the fundamentals + company-profile memos; hard EV-multiple / ROIC numbers are NOT (FIX-705). Lens runs on the qualitative read and **must say so** when a valuation number it wants is unavailable. |
| `cycle-risk` | Cycle / Risk Second-Level | Howard Marks documented methodology | where we are in the cycle, downside-first, second-level vs consensus, margin of safety in price | **Yes** — reads risk-assessment, scenario distribution, macro/market memos. No new metric dependency. |
| `macro-reflexive` | Macro-Reflexive Momentum | Druckenmiller / Soros documented methodology | macro setup, liquidity, price/trend confirmation, asymmetry, position concentration | **Yes** — reads macro, market, technical, scenario memos. No new metric dependency. |
| `forensic-skeptic` | Forensic Skeptic (Bear) | Burry documented methodology | accounting red flags, disclosure quality, what the bull case ignores, downside trigger | **Yes** — reads disclosure memo, bear thesis, risk critiques, contradicting evidence. Pure skeptic; the structural bear of the pack. |

**Default pack = these 4** (`quality-value`, `cycle-risk`, `macro-reflexive`,
`forensic-skeptic`). Four is the minimum that gives a meaningful
convergence/divergence read (a quorum, not a coin-flip) while differentiating
value / cycle / momentum / skeptic worldviews.

### Deferred until FIX-705 valuation metrics land (do NOT build in v1)

| id | label | attribution | blocked on |
|----|-------|-------------|------------|
| `mechanical-deep-value` | Mechanical Deep-Value | Greenblatt magic-formula methodology | needs **earnings yield + ROIC** ranked numbers — FIX-705 |
| `garp` | GARP | Lynch / PEG methodology | needs **PEG (P/E ÷ growth)** — FIX-705 |

These two are mechanical: their verdict is a number-driven ranking, and
without the EV-multiple / earnings-yield / ROIC / PEG metrics (a separate data
dependency, FIX-705) they would either hallucinate the numbers (BP-016 / BP-020
violation territory) or degrade to a generic value read that duplicates
`quality-value`. **Ship them in a follow-up once FIX-705 populates a numeric
valuation surface.** The pack config (§4) is built to add them as two more
entries with zero structural change — that is the whole point of the pack shape.

> `quality-value` ships in v1 deliberately *despite* leaning value: its read is
> qualitative-moat-first (moat durability, management, margin-of-safety
> *reasoning*), which today's fundamentals/profile memos support. The *mechanical*
> value lenses are the ones that hard-block on FIX-705.

---

## 4. Data model / schemas

Three shapes: (a) the **lens persona** resource state, (b) the **lens verdict**
generator output (STRICT — BP-016), (c) the **convergence** summary written by a
deterministic handler. New phase id: **`p7`** (lenses run after Phase 6).

### 4a. Lens persona — resource state (NOT a generator output → record/optional legal)

New file `src/flows/trading-desk/phase-7/lenses.ts`. Personas are **static data**
declared in code (a `LENS_PACK` array) and also mirrored into a session-scoped
resource collection so the convergence handler and UI can read which lenses ran.

```ts
// phase-7/lens-schema.ts  (resource-state shape — defaults/records legal here)
import { z } from "zod";

export const lensWeightSchema = z.object({
  factor: z.string(),       // e.g. "moat durability"
  emphasis: z.enum(["primary", "secondary", "veto"]),
});

export const lensPersonaSchema = z.object({
  id: z.string(),                                  // "quality-value"
  label: z.string(),                               // "Quality-Value"
  attribution: z.string(),                         // "Buffett / Munger documented methodology"
  corePrinciples: z.array(z.string()),
  characteristicQuestions: z.array(z.string()),
  weights: z.array(lensWeightSchema),
  disqualifiers: z.array(z.string()),
  horizon: z.enum(["days", "weeks", "months", "quarters", "years"]),
  sizingPhilosophy: z.string(),                    // free text — how this lens sizes
  // Honesty: which data this lens needs that today's surface may not supply.
  // Rendered as a caveat when the bundle is missing it (FIX-705 awareness).
  dataDependencies: z.array(z.string()),           // e.g. ["EV/EBIT", "ROIC"] for deferred lenses
});

export type LensPersona = z.infer<typeof lensPersonaSchema>;
```

`LENS_PACK: LensPersona[]` is the default 4 (the deferred 2 added later). The
pack is **the config surface**: add/remove/reorder a lens = edit this array.
Each lens's full persona text becomes the `<lensPersona>` prompt context tag
(§6.2).

### 4b. Lens verdict — generator output schema (STRICT — BP-016)

New file `src/flows/trading-desk/phase-7/lens-verdict.ts`. **One generator
definition, parameterized per-lens by a factory** (§6.1). The output schema is
shared across all lenses (multi-consumer → lives in its own file per the layout
convention).

```ts
// phase-7/lens-verdict-schema.ts  (GENERATOR OUTPUT → STRICT: no record/optional/default/union)
import { z } from "zod";
import { thesisSection } from "../resources";

export const lensVerdictOutputSchema = z.object({
  label: z.string(),
  headline: z.string(),
  rating: z.string(),                  // free-form header chip, mirrors other memos
  metrics: z.object({                  // fixed shape (no z.record) — BP-016
    lens: z.string(),
    verdict: z.string(),
    conviction: z.string(),
    horizon: z.string(),
  }),
  body: z.array(thesisSection),

  // The independent verdict, on the SAME 5-tier scale as the PM finalRating so
  // convergence is comparable apples-to-apples.
  lensRating: z.enum(["Sell", "Underweight", "Hold", "Overweight", "Buy"]),
  // 0..1. Min/max literal bounds are strict-safe (precedent: decisionConfidence).
  lensConviction: z.number().min(0).max(1),
  // One sentence: WHY this methodology produces this rating. The load-bearing
  // honesty surface — it ties the verdict to the documented methodology.
  rationale: z.string(),
  // What in the bundle most drove the verdict (max ~3). Required array; the
  // prompt caps length (BP-016 keeps the field required, no .max() needed but
  // an array .max(3) is strict-safe if you want it).
  decisiveEvidence: z.array(z.object({ source: z.string(), point: z.string() })),
  // HONESTY: data this lens wanted but the bundle did not supply. Empty array
  // when the bundle was sufficient. This is how a value lens admits "I could
  // not get EV/EBIT" instead of inventing it (FIX-705 / BP-020 discipline).
  missingData: z.array(z.string()),
  // The lens's own would-be sizing stance, in its own philosophy's terms.
  // Enum of literals — strict-safe. NOT a target weight number (the PM owns the
  // actual number; a lens emitting a % would invite false precision).
  sizingStance: z.enum(["pass", "starter", "standard", "concentrated"]),
});

export type LensVerdictOutput = z.infer<typeof lensVerdictOutputSchema>;
```

> **BP-016 checklist for this schema:** no `z.record()` (metrics is fixed-shape);
> no `.optional()` / `.default()` (every field required; "absent" is an empty
> array or empty string, the asymmetricEdge precedent); no heterogeneous
> `z.union()` (only enums of literals). It MUST be added to
> `test/output-schemas-strict.spec.ts` (§7).

### 4c. Convergence summary — written by a deterministic handler (NOT an LLM output)

The convergence score is **computed**, not generated — mirroring how
`agreesWithTrader`, `probabilitySum`, and `modelImpliedRating` are derived at
commit time, never emitted by an LLM. It lives on a session-scoped singleton
resource so feature 4 (PM context) and feature 5 (Summary) read one place.

```ts
// phase-7/convergence-resource.ts  (resource state — record/default legal)
import { defineResource } from "@flow-state-dev/core";
import { z } from "zod";

const RATING_TIERS = ["Sell", "Underweight", "Hold", "Overweight", "Buy"] as const;

export const lensConvergenceStateSchema = z.object({
  // One row per lens that produced a published verdict.
  verdicts: z.array(z.object({
    lensId: z.string(),
    label: z.string(),
    attribution: z.string(),
    rating: z.enum(RATING_TIERS),
    conviction: z.number(),
    sizingStance: z.enum(["pass", "starter", "standard", "concentrated"]),
    rationale: z.string(),
    missingDataCount: z.number(),
  })),
  // Deterministic convergence read.
  signal: z.enum(["convergent", "mixed", "divergent"]),
  // 0..1 robustness score (defined in §5). Feeds PM sizing + Summary chip.
  robustnessScore: z.number(),
  // Side spread for the headline: how many lenses on each macro-side.
  buySide: z.number(),    // Buy + Overweight
  holdSide: z.number(),   // Hold
  sellSide: z.number(),   // Underweight + Sell
  // The PM's own finalRating, copied here so the Summary can show
  // "PM: Buy — Lenses: 3 Buy / 1 Sell" without a second resource read.
  pmRating: z.enum(RATING_TIERS).nullable(),
  // Did the lens panel agree with the PM's macro-side?
  agreesWithPm: z.boolean().nullable(),
  computedAt: z.string(),
});

export type LensConvergenceState = z.infer<typeof lensConvergenceStateSchema>;

export const lensConvergenceResource = defineResource({
  name: "lensConvergence",
  scope: "session",
  stateSchema: lensConvergenceStateSchema,
  client: { state: { read: true } },   // ship to client for the Summary
});
```

> The individual lens verdicts ALSO persist as normal memos
> (`memos/p7/<lensId>`) via `memoStateSchema` (§6.3), so the existing
> ThesesPane/transcript surfaces render each lens like any other agent. The
> convergence resource is the *aggregate* the Summary and PM read.

---

## 5. The convergence computation (deterministic — `computeLensConvergence`)

A plain handler, run after all lens verdicts publish. No LLM. Algorithm:

1. Collect each published lens verdict's `lensRating` and `lensConviction`.
2. Bucket by macro-side: `buySide = #{Buy, Overweight}`, `holdSide = #{Hold}`,
   `sellSide = #{Underweight, Sell}`.
3. **Signal:**
   - `convergent` — one side holds a strict majority AND no lens is on the
     *opposite* macro-side (Hold is not "opposite" to either). e.g. 3 Buy +
     1 Hold → convergent.
   - `divergent` — both `buySide ≥ 1` AND `sellSide ≥ 1` (genuine
     philosophy-dependent split).
   - `mixed` — everything else (e.g. 2 Buy / 2 Hold).
4. **`robustnessScore` (0..1)** — a conviction-weighted agreement measure:
   `robustnessScore = (Σ conviction of lenses on the modal side) / (Σ conviction
   of all lenses)`, then multiplied by a `divergencePenalty` of `0.5` when
   `signal === "divergent"`. Clamped to [0,1]. High = many high-conviction
   lenses on one side; low = split or low-conviction.
5. **`agreesWithPm`** — `true` when the modal lens side matches the PM
   finalRating's macro-side (reuse `directionFromRating`-style mapping;
   Buy/Overweight=long, Hold=flat, Underweight/Sell=short). `null` if the PM
   memo is missing.

This is intentionally simple and explainable — a real-portfolio tool must be
able to show *why* it called something divergent. No clustering, no embeddings.

---

## 6. Flow changes

All new code under `src/flows/trading-desk/phase-7/`, mirroring the Phase 6
directory shape (the closest analog: a conditionally-run, independent audit over
the assembled bundle).

### 6.1 The per-lens generator factory (BP-024 identity-only → factory)

The lenses differ **only by identity** (persona text + agentName + lens id);
the recipe (read the bundle, emit `lensVerdictOutputSchema`) is identical. Per
BP-024 this is the textbook factory case (like `defineAnalyst`).

```ts
// phase-7/lens-generator.ts
import { generator } from "@flow-state-dev/core";
import { tradingDesk } from "../capability";
import { sessionStateSchema } from "../state";
import { loadPrompt } from "../lib/prompt";
import { lensVerdictOutputSchema } from "./lens-verdict-schema";
import type { LensPersona } from "./lens-schema";

const lensPrompt = loadPrompt("phase-7/prompts/lens-verdict.prompt.md");

/** Build one lens-verdict generator for a persona. The persona's documented
 *  methodology is injected via the `lensPersona` capability preset (§6.2);
 *  the shared prompt frames the task as "apply this methodology to the
 *  bundle and emit an independent verdict". */
export function defineLensGenerator(lens: LensPersona) {
  return generator({
    name: `lens-${lens.id}-generator`,
    // history:false — lens verdicts are sub-agent rows; the convergence card is
    // the history-visible struct. (Match how analysts use history:false.)
    itemVisibility: { client: true, history: false },
    agentName: "lensVerdict",            // shared agent identity — see §6.5
    uses: [
      tradingDesk.presets({
        // The post-Phase-5 evidence bundle — SAME inputs the PM read.
        investmentThesis: true,
        tradeProposal: true,
        riskAssessment: true,
        scenarioForecast: true,
        portfolioDecision: true,
        valuationSpine: true,
        phase1MemosFull: true,
        phase2DebateFull: true,
        riskCritiquesFull: true,
        // NEW preset: the lens's own documented methodology (§6.2).
        lensPersona: true,
        highReasoning: true,
      }),
    ],
    ...lensPrompt,
    sessionStateSchema,
    outputSchema: lensVerdictOutputSchema,
  });
}
```

> **Why one `agentName: "lensVerdict"` for all lenses (not one per lens):**
> the lens identity is carried in the **memo/verdict state** (`lensId`,
> `attribution`), not the agent registry. Minting 4–6 `AGENTS` entries for
> single-use lenses contradicts the framework's reuse threshold (and the
> Layer-2 reorg's own "stay generators" guidance). One `lensVerdict` agent
> entry in `AGENTS` (team `pm`, its own hue/glyph) backs the badge; the memo
> sidebar/transcript distinguish lenses by `lensId`. See §6.5.

**The persona is passed via session state, not a generator argument.** Because
the capability `context` resolvers read `ctx.session.state`, the factory cannot
close over a per-lens value the resolver can see. Pattern: the phase-7 pipeline
sets `state.activeLensId` immediately before each lens generator runs (a `.tap`),
and the `lensPersona` preset resolves the active persona from `LENS_PACK` by
`state.activeLensId`. This means **lenses run sequentially, not in parallel**
(one `activeLensId` at a time) — which is acceptable and even desirable for the
cost gate (§8). (If true parallelism is wanted later, switch to per-lens
generator instances each closing over a literal persona string in a local
`context` slot — heavier, deferred.)

### 6.2 New capability preset: `lensPersona`

Add to `capability.ts` presets (model on the `userThesis` preset — reads session
state, returns `null` when absent). It needs a new session-state field
`activeLensId` (§6.6) and reads `LENS_PACK`:

```ts
// in capability.ts presets:
lensPersona: {
  context: {
    lensPersona: (_input, ctx) => {
      const id = ctx.session.state.activeLensId;
      if (!id) return null;                       // tag suppressed off-phase
      const lens = LENS_PACK.find((l) => l.id === id);
      if (!lens) return null;
      return formatLensPersona(lens);             // → <lensPersona>…</lensPersona>
    },
  },
},
```

`formatLensPersona(lens)` lives in `phase-7/lens-format.ts` (single consumer →
local, per BP-018) and renders the persona fields as a documented-methodology
brief, including an explicit "data this methodology relies on:
`{dataDependencies}`" line so the model knows what it may legitimately lack.

> **Import-cycle guard (BP-019):** `LENS_PACK` and `formatLensPersona` must live
> in leaf modules (`phase-7/lenses.ts` data, `phase-7/lens-format.ts` formatter)
> that import only core/zod — NEVER from the lens generator. The capability
> imports the leaves; the generator imports the capability. Same shape as how
> `valuationSpine`/`formatValuationSpine` are wired.

### 6.3 Memo wiring (setup / markWriting / commit / markError)

Reuse the per-phase factories verbatim:

- `phase-7/setup.ts` → `defineMemoSetup({ phaseId: "p7", agentTeam: "pm",
  keys: PHASE_7_MEMO_KEYS, activePhase: "phase-7" })`.
- `phase-7/writer.ts` → `defineMemoStateBlocks({ phaseId: "p7", agentTeam:
  "pm", keys: PHASE_7_MEMO_KEYS, errorMessageFallback: "Lens verdict failed." })`
  for `markWritingP7` / `markErrorP7`, plus a `commitLensVerdictMemo`
  (`memoHandler` + `publishMemo`) projecting `lensVerdictOutputSchema` →
  memo state (new nullable fields in §6.7).

`PHASE_7_MEMO_KEYS` (in `agents.ts`) is **derived from `LENS_PACK`** so adding a
lens is one edit:

```ts
// agents.ts
export const PHASE_7_MEMO_KEYS = Object.fromEntries(
  LENS_PACK.map((l) => [l.id, {
    agentName: "lensVerdict" as const,
    memoKey: `memos/p7/${l.id}`,
    collectionKey: `p7/${l.id}`,
  }]),
);
```

> NOTE the import direction: `agents.ts` would import `LENS_PACK` from
> `phase-7/lenses.ts`. To keep `agents.ts` a leaf, instead **declare the lens
> ids as a plain `const LENS_IDS = ["quality-value","cycle-risk",
> "macro-reflexive","forensic-skeptic"] as const` inside `agents.ts`** and have
> `phase-7/lenses.ts` import `LENS_IDS` to type its `LENS_PACK` (the persona
> bodies live in phase-7; only the id list lives in agents.ts). This preserves
> the existing leaf ordering (agents.ts imports nothing from phase code).

### 6.4 The phase-7 pipeline + convergence commit

```ts
// phase-7/index.ts
import { sequencer } from "@flow-state-dev/core";
import { LENS_PACK } from "./lenses";
import { defineLensGenerator } from "./lens-generator";
import { setActiveLens } from "./set-active-lens";          // .tap — patches state.activeLensId
import { setupPhase7Memos } from "./setup";
import { commitLensVerdictMemo, markErrorP7, markWritingP7 } from "./writer";
import { computeLensConvergence } from "./convergence";      // deterministic handler

// One step per lens, run sequentially (shared activeLensId — §6.1).
const lensSteps = LENS_PACK.map((lens) =>
  sequencer({ name: `phase-7-lens-${lens.id}-step` })
    .tap(setActiveLens(lens.id))            // freeze which persona the preset resolves
    .tap(markWritingP7(lens.id))
    .step(defineLensGenerator(lens))
    .tap(commitLensVerdictMemo(lens.id))
    .rescue([{ block: markErrorP7(lens.id) }]),
);

export const phase7Pipeline = sequencer({
  name: "phase-7-lens-pack",
  container: {
    component: "phase-7-lens-pack",
    label: "Phase 7 — Investor-Lens Panel (independent verdicts).",
  },
})
  .tap(setupPhase7Memos)
  // chain the per-lens steps sequentially
  .step(lensSteps.reduce((acc, step) => acc.step(step), sequencer({ name: "phase-7-lens-chain" })))
  // convergence is computed only after every lens has published/errored
  .tap(computeLensConvergence);
```

> **BP-011 compliance:** no handler calls a block. `defineLensGenerator(lens)`
> returns a block *definition* composed into the sequencer at build time — it is
> NOT called inside a handler's `execute`. `computeLensConvergence` is a `.tap`
> handler that only READS memos (`ctx.resources.memos.getOptional` per lens key)
> and writes the convergence resource — no block invocation. Matches
> `checkPhase1HasData`.

`commitLensVerdictMemo(lensId)` is a small factory returning a `memoHandler`
that projects the verdict onto `memos/p7/<lensId>` and stamps `lensId` /
`attribution` (derived from `LENS_PACK`, not LLM-emitted — the
`agreesWithTrader` precedent). The factory variant is justified: the commit
body is identical per lens, only the key/persona differs (BP-024 identity-only).

### 6.5 `analyzePipeline` wiring + cost gate (THE multiplier control)

Append phase 7 to `analyzePipeline` in `flow.ts`, gated on a NEW session field
`runLenses` (set in `seedSession`, §6.6) that defaults to **full preset only**:

```ts
// flow.ts analyzePipeline, after the phase-6 stepIf:
.stepIf(
  (_v, ctx) => ctx.session.state.runLenses,
  phase7Pipeline,
)
```

In `seedSession`:

```ts
// Cost gate: the lens panel multiplies generator calls by N (default 4).
// Default it ON only for the `full` preset; the `fast` preset skips it so a
// cheap run stays cheap. A future caller flag could force it, but default-off
// on fast is the floor.
runLenses: input.costPreset === "full",
```

> This is the single cost-gate seam the task calls for: **N lenses multiply
> calls → default to the `full` preset.** On `fast`, phase 7 is skipped entirely
> (no setup, no generators, no convergence). The `highReasoning` preset each
> lens uses is itself only meaningful on `full`, reinforcing the gate.

### 6.6 Session-state additions (`state.ts`)

```ts
// add to sessionStateSchema:
activeLensId: z.string().nullable().default(null),   // which persona the lensPersona preset resolves
runLenses: z.boolean().default(false),               // cost gate; set in seedSession
```

Add `"phase-7"` to the `activePhase` enum. Add both new fields to
`flow.ts` `client.expose` so the navigator/Summary can read run state. Reset
both in `seedSession` (`activeLensId: null`, `runLenses: …` per preset).

### 6.7 `memoStateSchema` additions (`resources.ts`)

Add nullable lens fields (the established later-phase-extension convention —
`.nullable().default(null)`, BP-023). Only `memos/p7/*` populate them:

```ts
// Phase 7 lens-verdict extension. Only memos/p7/<lensId> populate these.
lensId: z.string().nullable().default(null),
lensAttribution: z.string().nullable().default(null),
lensRating: z.enum(["Sell","Underweight","Hold","Overweight","Buy"]).nullable().default(null),
lensConviction: z.number().min(0).max(1).nullable().default(null),
lensRationale: z.string().nullable().default(null),
lensDecisiveEvidence: z.array(z.object({ source: z.string(), point: z.string() })).nullable().default(null),
lensMissingData: z.array(z.string()).nullable().default(null),
lensSizingStance: z.enum(["pass","starter","standard","concentrated"]).nullable().default(null),
```

> `memoStateSchema` is resource state, NOT a generator output → `z.record` /
> `.default` are legal (the schema already uses both). The lens VERDICT schema
> (§4b) is the strict one.

### 6.8 Feeding PM sizing (feature 4) — context only, no PM re-run

The convergence signal informs PM sizing **without re-running the PM**. Two
options; this spec picks (A):

- **(A) Summary/sizing-time context (CHOSEN).** Feature 4's sizing logic reads
  `lensConvergenceResource` and applies a **sizing cap**: `divergent` → cap
  target weight at "starter" tier; `mixed` → cap at "standard"; `convergent` →
  no cap (PM's sizing stands). This is deterministic, explainable, and keeps the
  lens panel a *post-hoc robustness check* layered on the PM's call — which is
  the honest framing (lenses re-read the SAME bundle the PM read; they are a
  second opinion, not a new input the PM reasoned with).
- **(B) Re-run the PM with a `<lensConvergence>` context tag.** REJECTED for
  v1: it makes the PM's decision depend on lenses that re-read the PM's own
  output → a circular, harder-to-explain loop, and doubles the PM's cost. If a
  future version wants the PM to *see* convergence, add a `lensConvergence`
  preset and a second PM pass — out of scope here.

So feature 4's integration is: **read `lensConvergenceResource.robustnessScore`
/ `signal`, clamp the displayed/recommended target weight accordingly, and label
it "robustness-adjusted."** The lens pack writes the resource; feature 4 reads
it. No change to `portfolioDecisionOutputSchema` for this feature.

---

## 7. Testing

- **`test/output-schemas-strict.spec.ts`** — add `lensVerdictOutputSchema` to the
  `cases` array. This is mandatory (BP-016) and the cheapest guard against the
  strict-mode failure class that bit this example 3×.
- **`test/phase-7-lenses.spec.ts`** (new) — offline wiring tests, mirroring the
  existing phase specs:
  - `LENS_PACK` ids match `PHASE_7_MEMO_KEYS` keys.
  - `computeLensConvergence`: given mocked memo states, asserts the convergence
    table (3 Buy + 1 Sell → `divergent`, robustness penalized; 4 Buy →
    `convergent`, robustness high; 2 Buy / 2 Hold → `mixed`). **This is the
    intent-encoding test (BP-005): it fails if the convergence rule changes.**
  - phase-7 pipeline composes (setup → lens steps → convergence tap).
  - `runLenses` is `false` on `fast`, `true` on `full` after `seedSession`.
  - markError rescue flips a lens memo to `error` without aborting the panel.

---

## 8. Cost considerations (real-money / real-cost)

- **N× multiplier.** Each lens is a full structured generator on
  `highReasoning`. Default pack = 4 → ~4 extra heavy generations per run, on top
  of P1–P6. The gate (`runLenses = costPreset === "full"`) is the control: lenses
  never run on `fast`.
- **Sequential, not parallel** (§6.1) — bounded peak concurrency, and a natural
  place to add an early-exit (e.g. stop after the first 2 lenses if they already
  diverge hard) in a later iteration. Not in v1.
- **The deferred lenses (deep-value, GARP) are also cost** — another reason to
  ship the pack at 4 and grow it deliberately once FIX-705 makes them accurate.
- **No new tool calls.** Lenses read the already-assembled bundle; they do NOT
  fetch or search (unlike Phase 6's `verify`). Pure synthesis over existing
  context = the cheapest possible "extra opinion." Do NOT give lenses web tools.

---

## 9. Anticipating the Layer-2 Persona model (without depending on it)

The task asks to express lenses "in a way that anticipates the Layer-2 Persona
model." The `lensPersonaSchema` (§4a) is **deliberately the Persona shape**:
`{ corePrinciples, characteristicQuestions, weights, disqualifiers, horizon,
sizingPhilosophy }`. When FIX-702 / the Layer-2 reorg lands real
`defineAgent` / `createAgentRegistry`, a lens becomes a registry Persona by:

1. Moving `LENS_PACK` entries into the agent registry as `defineAgent({…persona})`.
2. Replacing `defineLensGenerator` with `materializeAgent(lens, { outputSchema })`
   — **once FIX-702 §6.1 stops hardcoding `outputSchema: z.string()`** (the open
   blocker; until then the structured lens verdict cannot be a registry Agent).

We do NOT adopt the registry now (it is unfrozen — building on it creates the
"private dialect" trap the reorg doc warns against). We ship plain generators +
a static `LENS_PACK` array whose **shape is already the Persona shape**, so the
eventual migration is a *move*, not a *rewrite*. Feed this feature's
structured-output + per-persona-context experience back into FIX-702 review.

---

## 10. UI changes (feature 5 surfacing)

The desk is a single Next.js route (`app/page.tsx`); the report is `ThesesPane`;
struct cards render in `TranscriptPane`. Lens surfacing rides the existing
machinery — no new route required.

### 10a. Per-lens memo rendering (automatic, minimal work)

Each lens publishes `memos/p7/<lensId>`. The `MemoDoc` `(agent, status)`
dispatcher in `theses-pane.tsx` falls through to `ThesisHeader + ThesisBody` for
any non-special agent. Because all lenses share `agentName: "lensVerdict"`,
add ONE branch to `MemoDoc`: when `agent === "lensVerdict"`, render a small
**`LensCard`** (new `components/theses/lens-card.tsx`) that reads the memo's
`lensRating` / `lensConviction` / `lensRationale` / `lensAttribution` /
`lensMissingData` and renders:

```
┌─────────────────────────────────────────────┐
│ [LV] Quality-Value          applying          │
│      Buffett / Munger documented methodology  │
│  ─────────────────────────────────────────   │
│  Verdict:  ● Overweight     conviction 0.62   │
│  "Durable moat and margin-of-safety hold,     │
│   but I could not get EV/EBIT."  ← rationale  │
│  Decisive: moat (fundamentals), downside (risk)│
│  ⚠ missing: EV/EBIT, ROIC   ← FIX-705 honesty │
└─────────────────────────────────────────────┘
```

Add `lensVerdict` to `AGENTS` (team `pm`, glyph `LV`, its own hue) and to
`PUBLISH_ORDER` / `PRIMARY_STRUCT_AGENTS` so the sidebar + transcript include it.
Add `{ id: "p7", label: "Phase 7 — Investor-Lens Panel", agents: ["lensVerdict"] }`
to `PHASE_GROUPS`. (Because lenses share one agent name, the sidebar shows one
"Lens Panel" entry; the LensCard area lists all N lens memos under it — handle
by having the p7 doc area iterate `memos/p7/*` rather than a single memo.)

### 10b. Convergence strip (the headline — Summary + report)

New `components/theses/lens-convergence-strip.tsx`, fed by
`useResource(session, "lensConvergence")`. Inline SVG / flex bars (no chart lib —
matches the PmHero idiom). ASCII mockup:

```
INVESTOR-LENS PANEL — Independent verdicts (not a debate)
┌───────────────────────────────────────────────────────────┐
│  ROBUSTNESS  ◐ 0.41   DIVERGENT — philosophy-dependent      │
│                                                             │
│  Buy/OW  ██████             2   Quality-Value, Macro-Reflex │
│  Hold    ███                1   Cycle/Risk                  │
│  Sell/UW ███                1   Forensic Skeptic            │
│                                                             │
│  PM call: Overweight   ·   Lenses agree with PM: partial    │
│  Reads the same evidence the PM read. Applying each         │
│  investor's documented methodology. Not advice.             │
└───────────────────────────────────────────────────────────┘
```

When `convergent`:

```
│  ROBUSTNESS  ● 0.88   CONVERGENT — holds under all 4 lenses │
│  Buy/OW  █████████████  4   all lenses                      │
```

The strip slots into the Summary page (feature 5) as a top-level card, and
optionally into the PM hero area of `ThesesPane` (a "second opinion" panel
under the PM decision). Copy MUST carry the three honesty lines: "Independent
verdicts (not a debate)", "Applying each investor's documented methodology",
"Not advice."

---

## 11. Exact file create / modify list

### Create

- `src/flows/trading-desk/phase-7/lenses.ts` — `LENS_PACK` (default 4 personas).
- `src/flows/trading-desk/phase-7/lens-schema.ts` — `lensPersonaSchema`, `LensPersona`.
- `src/flows/trading-desk/phase-7/lens-verdict-schema.ts` — `lensVerdictOutputSchema` (STRICT).
- `src/flows/trading-desk/phase-7/lens-generator.ts` — `defineLensGenerator` factory.
- `src/flows/trading-desk/phase-7/lens-format.ts` — `formatLensPersona`.
- `src/flows/trading-desk/phase-7/set-active-lens.ts` — `setActiveLens(id)` `.tap` handler.
- `src/flows/trading-desk/phase-7/setup.ts` — `setupPhase7Memos`.
- `src/flows/trading-desk/phase-7/writer.ts` — `markWritingP7`/`markErrorP7`/`commitLensVerdictMemo`.
- `src/flows/trading-desk/phase-7/convergence-resource.ts` — `lensConvergenceResource`.
- `src/flows/trading-desk/phase-7/convergence.ts` — `computeLensConvergence` (deterministic §5).
- `src/flows/trading-desk/phase-7/index.ts` — `phase7Pipeline`.
- `src/flows/trading-desk/phase-7/prompts/lens-verdict.prompt.md` — shared lens prompt (frames "apply this documented methodology to the bundle; independent verdict; admit missing data; not advice").
- `components/theses/lens-card.tsx` — per-lens memo card.
- `components/theses/lens-convergence-strip.tsx` — convergence headline.
- `test/phase-7-lenses.spec.ts` — wiring + convergence-rule tests.

### Modify

- `src/flows/trading-desk/agents.ts` — add `lensVerdict` to `AGENTS`; add `LENS_IDS` const; add `PHASE_7_MEMO_KEYS` (derived); add to `PHASE_GROUPS` + `ALL_MEMO_KEYS`.
- `src/flows/trading-desk/state.ts` — add `activeLensId`, `runLenses`; add `"phase-7"` to `activePhase` enum.
- `src/flows/trading-desk/resources.ts` — add Phase 7 nullable lens fields to `memoStateSchema`.
- `src/flows/trading-desk/capability.ts` — add `lensPersona` preset.
- `src/flows/trading-desk/flow.ts` — register `lensConvergenceResource`; add `phase7Pipeline` `.stepIf(runLenses)`; seed `activeLensId`/`runLenses`; expose both fields.
- `test/output-schemas-strict.spec.ts` — add `lensVerdictOutputSchema` to `cases`.
- `components/theses/theses-pane.tsx` — `MemoDoc` branch for `lensVerdict` → iterate `memos/p7/*` → `LensCard`; `PUBLISH_ORDER` entry; optional convergence strip under PM hero.
- `components/transcript/transcript-pane.tsx` — add `lensVerdict` to `PRIMARY_STRUCT_AGENTS` (so its struct card renders) only if lens generators use `history:true`; with `history:false` (recommended) no change needed beyond the phase divider firing on `component: "phase-7-…"`.
- `.changeset/*.md` — user-facing PR (BP-022).
- `labs/trading-desk/CLAUDE.md` — document Phase 7 / lens pack / cost gate.
- `apps/docs` — if the lens feature is documented for end users, add a guide page (per "document user-facing functionality").

---

## 12. Dependencies (what must exist first)

1. **Phases 1–5 complete** (they are) — the lens pack reads their memos.
2. **Phase 6 pattern** (it is) — the directory/factory template this clones.
3. **Feature 5 (Summary page)** — the convergence strip's primary home. The
   lens pack can ship and write `lensConvergenceResource` before feature 5
   renders it, but the *value* is realized through feature 5. Build after 5.
4. **Feature 4 (portfolio-aware sizing)** — consumes `robustnessScore` for the
   sizing cap (§6.8). The lens pack writes the resource; feature 4 reads it.
   The cap logic lives in feature 4's spec; this spec only guarantees the
   resource shape.
5. **FIX-705 valuation metrics — for the DEFERRED lenses only** (mechanical
   deep-value, GARP). The default-4 pack does NOT depend on FIX-705.
6. **NOT dependent on:** the Layer-2 reorg / FIX-702 (§9). Build on today's
   phase-segmented tree.

---

## 13. Real-portfolio considerations

- **Honesty is the product (FIX-655).** A divergent panel that the UI dressed up
  as "consensus" would be actively dangerous for real money. The signal must
  read DIVERGENT loudly when lenses split — under-claiming robustness is the
  safe failure mode.
- **Independent, not theatrical.** Lenses must not see each other (§6.1
  sequential-with-shared-state still isolates each generation's context to its
  own persona + the bundle). Never render or imply a debate.
- **"Documented methodology," never "what X thinks."** Every label/attribution
  string says "applying X's documented methodology." A real user must not read
  "Buffett: Buy" as Warren Buffett endorsing the position.
- **Missing data must surface, not hide (FIX-705 / BP-020).** A value lens that
  lacks EV/EBIT must say so (`missingData` / the LensCard ⚠ line), never invent
  the number. This is the difference between a robustness signal and a
  confidence theater.
- **Robustness adjusts sizing DOWN, never up.** The cap (§6.8) can only shrink
  the PM's target weight on divergence; convergence merely removes the cap. A
  lens panel should never *inflate* position size.
- **Not advice.** Preserve the existing not-advice framing on every lens surface.

---

## 14. What NOT to build (scope boundaries)

- **No staged debate / cross-lens rebuttal.** v1 is independent parallel
  verdicts only (the explicit FIX-655 lesson). No lens reads another lens.
- **No new data / no tools for lenses.** Lenses read the assembled bundle. No
  web fetch, no search, no new providers. (Phase 6's `verify` tools are NOT
  copied here.)
- **No mechanical deep-value / GARP lenses in v1.** Deferred to a FIX-705
  follow-up. Ship the pack at 4.
- **No PM re-run on convergence (§6.8 option B).** No circular loop.
- **No per-lens `AGENTS` entries / no Layer-2 registry adoption (§9).** Plain
  generators + a static pack array.
- **No target-weight number emitted by a lens.** Lenses emit a `sizingStance`
  enum, not a %; the PM/feature-4 owns the number.
- **No new route / no portfolio holdings dependency.** The lens pack reasons
  about the single analyzed ticker's bundle; it does not need portfolio state.
- **No live-vs-fixture branching in lenses.** They consume already-resolved
  memos; the data-source decision was made upstream in Phase 1.

---

## 15. Open questions

1. **Pack size default — 4 or 5?** This spec defaults to 4 (value / cycle /
   momentum / skeptic). Adding `mechanical-deep-value` would make 5 but it is
   FIX-705-blocked. Confirm 4 is the right v1 quorum, or whether a 3-lens
   minimum (drop one) is preferred for cost.
2. **Sequential vs parallel lenses.** Spec chose sequential (shared
   `activeLensId`) for simplicity + cost shaping. If run latency matters more
   than peak concurrency, switch to per-lens generator instances with literal
   persona context (heavier code, true parallel). Which does the owner want?
3. **Robustness → sizing cap thresholds (§6.8).** The `divergent → starter`,
   `mixed → standard` mapping is a first guess. Should feature 4 own the exact
   thresholds, or should they live alongside the convergence computation?
4. **Should the PM eventually SEE convergence (option B)?** v1 says no (circular).
   Is a future "PM second pass that reads the panel" desired, or is the post-hoc
   robustness check the permanent design?
5. **Forensic Skeptic as structural bear** — it will frequently dissent by
   design, which could make `divergent` the common case. Is a permanent bear the
   right pack member, or should it be opt-in (Phase-4-style) so convergence isn't
   biased toward "divergent" on every run?
6. **Conviction calibration across lenses.** Each lens self-reports
   `lensConviction` 0..1; there is no cross-lens calibration. Is raw
   self-reported conviction acceptable for the weighted `robustnessScore`, or
   does it need normalization?
