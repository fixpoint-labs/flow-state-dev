# Design: Trading-desk analysis-pipeline reorg (identity-grouped, structural)

**Date:** 2026-06-04
**Status:** Design, approved — ready to turn into an implementation plan.
**Type:** Structural refactor of `labs/trading-desk` (no behavior change, no framework change).
**Relates to:** the oversight position `docs/oversight/TRADING_DESK_LAYER2_REORG_2026-06-01.md`
(parent repo) — this spec executes the *structural* half of that doc's §4, under the constraints
agreed in brainstorming.

> **Follow-up boundary:** Provider clients were later extracted from the analysis
> tool catalog to app-level `labs/trading-desk/lib/providers/`, so portfolio and
> other domains can consume them without importing through a flow. References to
> `tools/providers/` below describe this reorg's historical move target. Generic
> cache and concurrency helpers were likewise extracted later to
> `labs/trading-desk/lib/`; their paths below are historical.

---

## 1. Goal & why now

Reorganize the trading-desk **analysis pipeline** from a phase-segmented tree (`phase-1/` …
`phase-6/`) into an **identity-grouped** tree (`agents/` + `tools/` + `orchestration/`), so that:

- a participant (an analyst, the trader, the PM) is found and read in **one place** instead of
  scattered across `agents.ts` + `phase-N/{generator,writer,setup}` + `prompts/`;
- the **tool catalog** is self-contained and liftable (the half of the original instinct that
  actually buys reuse);
- **orchestration** (who runs, in what order) is its own layer — the only code that knows
  execution sequence.

**Why now:** FIX-702 / `@flow-state-dev/workforce` landed, which was the gate the oversight doc
put on this work. But see §2 — the *primitive adoption* the doc envisioned is still blocked, so
this is the **structural** move only.

### Why NOT adopt the FIX-702 Agent primitives (the load-bearing constraint)

Verified against the shipped code on `main`:

- `Agent` (`@flow-state-dev/core/types/agent.ts`) has **no `outputSchema`** field, and
  `materializeAgent` hardcodes `outputSchema: z.string()`. Registry Agents are string-output only.
- `Agent.usesCapabilities` is a flat `string[]` — no preset/config surface.

Trading-desk's participants are almost all **structured-output** (analysts → `thesisOutputSchema`,
trader → `TradeProposal`, risk personas, PM → `portfolioDecision` + `portfolioFit`, the lens
verdicts) and every one consumes `tradingDesk.presets({...})` (cost-gated context). So as shipped,
**they cannot become `defineAgent` registry Agents without losing their typed output and their
presets.** Both gaps are exactly the doc's §6.1 / §6.2 pressure-test findings — still open. The
registry stays hand-rolled; participants stay plain generators. (If/when those gaps close, this
structure makes adoption mostly imports — see §11.)

---

## 2. The four decisions (agreed in brainstorming)

1. **Move files, keep the memo lifecycle BUNDLED.** Each participant keeps its own
   `markWriting → generator → commit, rescue(markError)` step. We do **not** build the doc's
   `placeAgent` participant/situation boundary (pulling the memo lifecycle out into orchestration).
   That boundary is deferred — it's the churniest, highest-indirection part, and its payoff
   (portability) only matters once participants are reused cross-flow, which isn't happening yet.
   Net: this is a relocation + identity grouping + tools extraction, **not** a memo-architecture
   rewrite.

2. **Defer the persona-file rename.** Keep `*.prompt.md` files; just relocate each into its
   agent's directory. The `*.persona.md` + `personas/` rename is a pure FIX-699 signal with churn
   and no function while we aren't adopting Persona resources. (Oversight doc §9 #3.)

3. **"Phase" survives as render-time labels.** The container `component: "phase-*"` strings stay —
   the DevTool TranscriptPane keys its phase-divider beats on that prefix. Phase dies as **code
   structure**; it lives on as the **user-visible sequence**. (Oversight doc Appendix A wrinkle.)

4. **Resources co-locate with their owner — no `resources/` directory.** A central `resources/`
   bucket groups by technical *kind*, which is the exact axis this reorg moves away from. Instead a
   resource lives where its owner lives: a **participant-owned** resource moves into that agent
   group; a **flow-contract** resource (the memo board) stays at the flow root; a **surface-owned**
   resource (decision-record, reports, price-history) stays at root for now and moves with its
   surface in the later surfaces reorg. The "what state does this flow persist" bird's-eye view is
   already given by `flow.ts`'s `resources: { … }` registration, which needs no directory. In
   practice the only participant-owned resource today is `lens-convergence-resource.ts` → it moves
   into `agents/lenses/`; every other resource is flow- or surface-owned and stays put.
   *One coupling the plan must handle:* `resources.ts` imports `lensConvergenceStateSchema` from this
   file for the PM memo mirror, so after the move `resources.ts` imports a leaf from `agents/lenses/`.
   That stays acyclic (the resource file is a leaf — it imports only core + zod, never back into
   `resources.ts`), but if a contract→participant import reads as a smell, lift just the *schema* into
   a shared leaf. Decide at plan time.

---

## 3. Scope

**In scope** — the analysis pipeline only:

- The 7 `phase-*/` folders, `agents.ts`, `capability.ts`, `providers/`, and the analysis-side
  `lib/` + `*.prompt.md` files.

**Out of scope — stays exactly where it is:**

- The flow contract: `flow.ts` (defineFlow), `state.ts`, `flow-schema.ts`, `analyze-input.ts`,
  `resources.ts`.
- Flow- + surface-owned resources (per decision §2.4): `decision-snapshot-resource.ts`,
  `report-index.ts`, `price-history-resource.ts`, `valuation-spine-resource.ts`,
  `compute-spine.ts`, `store-price-history.ts`, `special-instructions*.ts`. (The surface-owned
  three — decision-snapshot / report-index / price-history — move with their surface in the later
  surfaces reorg, not here.) **Exception:** `lens-convergence-resource.ts` is participant-owned and
  moves into `agents/lenses/` (§2.4).
- The **portfolio domain** (`portfolio/`), all UI (`components/`, `app/`), tests, fixtures.

> The portfolio + reports/decision-record data layer is the most reuse-worthy eventual
> extraction (oversight Revisit §3), but it is a **separate** follow-up and explicitly not in this
> reorg. This PR touches the participant pipeline only.

---

## 4. Target tree

```
labs/trading-desk/src/flows/trading-desk/
  flow.ts state.ts flow-schema.ts analyze-input.ts resources.ts   ← contract (UNCHANGED, at root)
  registry.ts          ← was agents.ts (AGENTS table + memo-key registries; still hand-rolled)
  capability.ts        ← the shared tradingDesk "Skill" (unchanged)

  agents/              ← participants grouped by identity; each module exports its BUNDLED step
    _recipe/           ← defineAnalyst, createApproachGenerator, memo writer/setup factories
                          (was phase-1/analyst.ts, lib/approach-generator.ts, lib/memo-writer.ts,
                           lib/memo-setup.ts)
    analysts/          ← the 9 analysts (compact: analysts.ts table + thesis-schema.ts + writer.ts
                          + prompts/), via the defineAnalyst recipe
    research/          ← bull / bear / manager (generators.ts, round-robin.ts, validate-citations.ts,
                          writer.ts, prompts/) + tools/find_counter_evidence.ts (FLOW-COUPLED — §6)
    lenses/            ← phase-2b: lens-generator.ts, lens-step.ts, lens-verdict-schema.ts,
                          lens-body-sections.ts, writer.ts, prompts/  (+ lib/lenses.ts pack config,
                          lib/convergence-math.ts, lens-convergence-resource.ts — all lens-owned)
    trader/            ← trader.ts, approach.ts, writer.ts, prompts/
    risk/              ← personas.ts (3), consolidator.ts, schemas.ts, approach.ts, writer.ts, prompts/
    scenario-forecaster/ ← scenario-forecaster.ts, approach.ts, writer.ts, prompts/
    portfolio-manager/   ← portfolio-manager.ts, approach.ts, writer.ts, prompts/
    thesis-validator/    ← thesis-validator.ts, approach.ts, writer.ts, prompts/

  tools/               ← THE catalog (self-contained, liftable)
    data/              ← the 24 get_*.ts + discover_*_context.ts (was phase-1/tools/, phase-2/tools/*
                          minus the flow-coupled find_counter_evidence)
    schemas.ts empty-payloads.ts indicators-math.ts   (was phase-1/tools/*)
    runtime/           ← cache.ts, fixtures.ts, discover.ts (was lib/)

  orchestration/       ← composition only (the ONLY code that knows execution order)
    analyze.ts         ← the analyze sequence + guard wiring (was flow.ts's analyzePipeline body)
    stages.ts          ← per-phase setup taps + fan-out / round-robin / chain assembly
                          (was every phase-*/index.ts)
    guards.ts          ← seedSession, checkTickerResolvable, checkHasData/PrimaryAnalysts,
                          setInstructions (was inline in flow.ts)

  lib/                 ← pure IO-free utilities that AREN'T tool-runtime or recipe:
                          format.ts helpers.ts prompt.ts ticker-resolver.ts concurrency.ts
                          + analysis/scoring math: valuation.ts valuation-spine.ts fair-value.ts
                          expected-return.ts rating-engine.ts setup-score.ts sector-resolution.ts
```

---

## 5. Move mapping (folder/module level)

The implementation plan enumerates the per-file moves; this is the module-level intent.

| Source | Destination | Notes |
|--------|-------------|-------|
| `agents.ts` | `registry.ts` | rename only; same hand-rolled table |
| `phase-1/analyst.ts` | `agents/_recipe/define-analyst.ts` | the defineAnalyst factory |
| `lib/{approach-generator,memo-writer,memo-setup}.ts` | `agents/_recipe/` | the per-phase factories |
| `phase-1/{analysts,thesis-schema,writer,setup}.ts` + `prompts/` | `agents/analysts/` | bundled steps stay |
| `phase-2/{generators,round-robin,validate-citations,writer,setup,prompts}.ts` + `prompts/` | `agents/research/` | |
| `phase-2/tools/find_counter_evidence.ts` | `agents/research/tools/` | FLOW-COUPLED — not catalog (§6) |
| `phase-2b/*` + `lib/{lenses,convergence-math}.ts` + `lens-convergence-resource.ts` | `agents/lenses/` | lens generators + pack + convergence math + the lens-owned resource (§2.4) |
| `phase-3/{trader,approach,writer,setup}.ts` + `prompts/` | `agents/trader/` | |
| `phase-4/{personas,consolidator,schemas,approach,writer,setup}.ts` + `prompts/` | `agents/risk/` | |
| `phase-5/{scenario-forecaster,portfolio-manager,approach,writer,setup}.ts` + `prompts/` | `agents/scenario-forecaster/` + `agents/portfolio-manager/` | split the two participants |
| `phase-6/{thesis-validator,approach,writer,setup}.ts` + `prompts/` | `agents/thesis-validator/` | |
| `phase-1/tools/*` (the 24 get_* + schemas + empty-payloads + indicators-math + index) | `tools/data/` + `tools/{schemas,empty-payloads,indicators-math}.ts` | the catalog |
| `lib/{cache,fixtures,discover}.ts` | `tools/runtime/` | tool runtime under the catalog |
| `providers/*` | `lib/providers/` | Final shared home; initially moved through `tools/providers/` during this reorg. |
| every `phase-*/index.ts` | `orchestration/stages.ts` | stage assembly + setup taps |
| `flow.ts` `analyzePipeline` + inline guards (`seedSession`, `checkTickerResolvable`, `checkHasData`, `checkHasPrimaryAnalysts`, `setInstructions`) | `orchestration/analyze.ts` + `orchestration/guards.ts` | `flow.ts` keeps only `defineFlow` |
| `compute-spine.ts`, `store-price-history.ts` | **stay at root** | resource-writer taps; orchestration imports them |
| `lib/{format,helpers,prompt,ticker-resolver,concurrency}.ts` + scoring math | **stay in `lib/`** | pure utilities |

---

## 6. Catalog tools vs flow-coupled tools

A **catalog** tool is portable: stateless, no flow imports (`get_*`, `discover_*`, indicators).
These go to `tools/`. A **flow-coupled** tool imports flow internals and belongs with its consumer:
`find_counter_evidence` imports `PHASE_1_MEMO_KEYS` + the debate transcript resource, so it stays
in `agents/research/tools/`. Keeping the contrast visible is itself the lesson about what makes a
tool liftable.

---

## 7. The hard part: the `orchestration/` split

Even as a "move files" reorg, this is the only non-mechanical wiring. Today the sequencing lives in
`flow.ts`'s `analyzePipeline` plus each `phase-*/index.ts`. After:

- `orchestration/stages.ts` imports the **bundled participant steps** from `agents/*` and assembles
  each stage (the fan-out `.parallel({...})`, the research round-robin + writers, the fixed risk
  chain, the cost-gated lens `.stepIf`). The per-group `setup*Memos` tap and `writer.ts`
  (markWriting/commit/markError) **live with their agent group** in `agents/<group>/` — they are
  keyed to that group's memos — and `stages.ts` imports the setup tap to place it before the
  group's step. (So the agent group is self-describing: its participants, its memo keys, how those
  memos are precreated and written; orchestration only decides *order*.)
- `orchestration/analyze.ts` is the top-level sequence (`seedSession → guards → stages → gated audit`)
  — the whole flow narrative in ~15 lines.
- `flow.ts` shrinks to the `defineFlow` contract (actions, resources, session state) and imports
  `analyze` from orchestration.

**Import direction inverts and must stay one-way:** orchestration imports agents; agents never
import orchestration. (BP-019: keep it acyclic — the participant modules import their recipe + tools
+ capability + the resource/schema leaves, never `orchestration/` or `flow.ts`.)

---

## 8. Verification (it is a pure move — behavior is invariant)

1. `pnpm --filter @flow-state-dev/trading-desk typecheck` — clean.
2. `pnpm --filter @flow-state-dev/trading-desk test` — all 578 tests green (test imports update to
   the new paths; no test logic changes).
3. `pnpm typecheck` at root — 43/43 + package-boundary validation (the project-reference graph).
4. `fsdev run` for one ticker on `fast` and one on `full` — the transcript streams **identically**
   (same phase-divider beats, same memos, same final decision). This is the real "behavior
   unchanged" check, since the reorg moves the orchestration.

A diff that changes any test assertion or any runtime output is a bug, not a move.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|------|------------|
| **Import cycles** (BP-019) — the agents↔tools↔orchestration regraph can introduce cycles | One-way arrow (§7); participant modules import only recipe/tools/capability/leaves. Root typecheck + boundary check catches it. |
| **Orchestration rewiring is the one place logic moves** | Keep `stages.ts` a literal relocation of the `phase-*/index.ts` bodies; `fsdev run` parity check (§8.4) before merge. |
| **`prompts/` path resolution** — prompts are loaded by relative path via `loadPrompt` | Update every `loadPrompt("phase-N/...")` to the new `agents/<group>/...` path; grep for stragglers; the test suite + fsdev run exercise the prompt loads. |
| **Doc churn** — `labs/trading-desk/CLAUDE.md` Layout + "Adding a…" guides reference the phase tree | Rewrite the CLAUDE.md Layout + guides as part of the PR (also overdue: it documents a `services/` folder that's actually `providers/` + `lib/`). |
| **"Doing it twice"** (the doc's central fear) | Largely neutralized here: we are explicitly NOT adopting primitives, so there's no throwaway registry to redo. The structure is forward-compatible (§11); only the later primitive swap remains. |

---

## 10. Non-goals

- No `placeAgent` / memo-lifecycle extraction (deferred — §2.1).
- No `defineAgent` / `createAgentRegistry` / `definePersona` adoption (blocked — §1).
- No persona-file rename (deferred — §2.2).
- No portfolio / reports / summary / data-layer reorg (separate follow-up — §3).
- No behavior change, no new features, no test-logic change.

---

## 11. Migration-readiness (what this sets up for later)

Done this way, the eventual FIX-702 adoption is mostly imports + a constructor swap **if** the two
gaps close: `registry.ts` → `createAgentRegistry([...])`; each `agents/<x>/` generator →
`defineAgent({...})` (pending an optional structured `outputSchema` on `Agent`, §1); `*.prompt.md`
`<system>` → a `definePersona` resource; `capability.ts` → `createWorkforceCapability` (pending a
preset surface, §1). The structure is the down-payment; the primitives are the later step. The two
gaps remain the blockers worth feeding back to the workforce maintainers.
