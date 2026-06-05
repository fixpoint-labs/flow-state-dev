# Trading-Desk Analysis-Pipeline Reorg — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Relocate the trading-desk analysis pipeline from a phase-segmented tree (`phase-1/` … `phase-6/`) into an identity-grouped tree (`agents/` + `tools/` + `orchestration/`) with **zero behavior change**.

**Architecture:** Pure move + import-rewire. Memo lifecycle stays bundled in each participant (no `placeAgent`). No FIX-702 primitive adoption. Spec: [`trading-desk-pipeline-reorg.md`](./trading-desk-pipeline-reorg.md).

**Tech Stack:** TypeScript, `@flow-state-dev/core` block API, pnpm workspace, vitest, `git mv`.

---

## How to execute this plan (READ FIRST — it is a refactor, not a feature)

There are **no new tests**. The verification loop for every task is:

1. `git mv` the task's files to their new home (history preserved).
2. **`typecheck` goes RED** — every broken import is a `tsc` error pointing at the old path. This red is your "failing test."
3. Fix each error: update the import specifier to the new path. Use `git grep -l '<old-path-or-specifier>'` to find every importer; the moved files' own internal imports also need updating.
4. **Make typecheck GREEN:** `pnpm --filter @flow-state-dev/trading-desk typecheck` → no errors.
5. **Existing suite stays GREEN:** `pnpm --filter @flow-state-dev/trading-desk test` → `Test Files 75 passed (75) · Tests 578 passed (578)`.
6. Commit.

A diff that changes a test assertion, a prompt body, a schema, or any runtime output is a **bug, not a move** — revert and redo. The only "logic" that legitimately moves is the orchestration assembly in Task 8.

**Sequence matters; do NOT parallelize.** Tasks share importers (orchestration imports everything; `resources.ts` imports schemas), so a shared working tree must stay green task-by-task. Run tasks in order, one commit each.

**Per-task commands (referenced as TYPECHECK / TEST below):**
- `TYPECHECK` = `pnpm --filter @flow-state-dev/trading-desk typecheck`
- `TEST` = `pnpm --filter @flow-state-dev/trading-desk test`
- Root graph check (Task 9 only): `pnpm typecheck` (43/43 + package-boundary validation)

All paths below are under `labs/trading-desk/src/flows/trading-desk/` (abbreviated `…/`) unless noted.

---

## File Structure (target — locked by the spec §4)

```
…/flow.ts state.ts flow-schema.ts analyze-input.ts resources.ts   (contract — stays, flow.ts shrinks in Task 8)
…/registry.ts            (was agents.ts)
…/capability.ts          (unchanged)
…/compute-spine.ts store-price-history.ts + the surface/flow resources   (stay at root)
…/agents/_recipe/        define-analyst.ts approach-generator.ts memo-writer.ts memo-setup.ts
…/agents/analysts/       analysts.ts thesis-schema.ts writer.ts setup.ts prompts/
…/agents/research/       generators.ts round-robin.ts validate-citations.ts writer.ts setup.ts prompts/ tools/find_counter_evidence.ts
…/agents/lenses/         lens-generator.ts lens-step.ts lens-verdict-schema.ts lens-body-sections.ts writer.ts setup.ts lenses.ts convergence-math.ts lens-convergence-resource.ts prompts/
…/agents/trader/         trader.ts approach.ts writer.ts setup.ts prompts/
…/agents/risk/           personas.ts consolidator.ts schemas.ts approach.ts writer.ts setup.ts prompts/
…/agents/scenario-forecaster/   scenario-forecaster.ts approach.ts writer.ts setup.ts prompts/
…/agents/portfolio-manager/     portfolio-manager.ts approach.ts writer.ts setup.ts prompts/
…/agents/thesis-validator/      thesis-validator.ts approach.ts writer.ts setup.ts prompts/
…/tools/data/            get_*.ts discover_*_context.ts
…/tools/                 schemas.ts empty-payloads.ts indicators-math.ts
…/tools/runtime/         cache.ts fixtures.ts discover.ts
…/tools/providers/       finnhub.ts yahoo.ts edgar*.ts fred.ts xai.ts web.ts fmp.ts …
…/orchestration/         analyze.ts stages.ts guards.ts
…/lib/                   format.ts helpers.ts prompt.ts ticker-resolver.ts concurrency.ts
                         valuation.ts valuation-spine.ts fair-value.ts expected-return.ts
                         rating-engine.ts setup-score.ts sector-resolution.ts
```

---

## Task 0: Baseline — confirm green before touching anything

**Files:** none (verification only).

- [ ] **Step 1: Confirm the starting tree is green**

Run: `TYPECHECK && TEST`
Expected: typecheck clean; `Test Files 75 passed (75) · Tests 578 passed (578)`.

- [ ] **Step 2: Record the `loadPrompt` base path convention**

Run: `git grep -n 'loadPrompt(' …/lib/prompt.ts …/agents 2>/dev/null; git grep -n "loadPrompt(\"" labs/trading-desk/src | head`
Read `…/lib/prompt.ts` to learn whether `loadPrompt` resolves paths relative to the flow root, `process.cwd()`, or `__dirname`. **This determines whether moving a `*.prompt.md` requires editing its `loadPrompt("…")` string.** Note the answer; every prompt-moving task depends on it.

No commit (read-only baseline).

---

## Task 1: Tools catalog — `tools/`

Move the tool catalog, its runtime, and the providers into a self-contained `tools/`. This is the most depended-on leaf set, so doing it first means later tasks reference the final tool paths.

**Files:**
- Move: `…/phase-1/tools/*` → `…/tools/` (the `get_*.ts` + `discover_*` into `…/tools/data/`; `schemas.ts`, `empty-payloads.ts`, `indicators-math.ts`, `index.ts` into `…/tools/`)
- Move: `…/providers/*` → `…/tools/providers/`
- Move: `…/lib/cache.ts …/lib/fixtures.ts …/lib/discover.ts` → `…/tools/runtime/`
- Modify (imports): every importer of the above — found via grep in Step 2.

- [ ] **Step 1: Create dirs and move files**

```bash
cd labs/trading-desk/src/flows/trading-desk
mkdir -p tools/data tools/runtime tools/providers
# data fetchers + discovery → tools/data/
git mv phase-1/tools/get_*.ts tools/data/
git mv phase-1/tools/discover_*.ts tools/data/ 2>/dev/null || true
# shared tool modules → tools/
git mv phase-1/tools/schemas.ts phase-1/tools/empty-payloads.ts phase-1/tools/indicators-math.ts phase-1/tools/index.ts tools/
# any remaining phase-1/tools files (inspect first):
ls phase-1/tools/ 2>/dev/null   # move stragglers individually, then: rmdir phase-1/tools
git mv providers/* tools/providers/
git mv lib/cache.ts lib/fixtures.ts lib/discover.ts tools/runtime/
```

(If a get_*/discover file imports a sibling like `./schemas` that is now one level up at `tools/schemas`, that becomes `../schemas` — Step 3 fixes these.)

- [ ] **Step 2: Find every importer**

Run:
```bash
git grep -l 'phase-1/tools\|/providers/\|lib/cache\|lib/fixtures\|lib/discover' labs/trading-desk/src
git grep -ln "from \"\.\./providers\|from \"\./providers\|tools/schemas\|empty-payloads\|indicators-math" labs/trading-desk/src
```
This lists the phase files, `capability.ts`, and any tool-runtime consumers. Each needs its import specifier repointed to `tools/…`, `tools/data/…`, `tools/runtime/…`, or `tools/providers/…`.

- [ ] **Step 3: Repoint imports until typecheck is clean**

Run `TYPECHECK`. For each error, update the import to the new path (the error message gives the file + the bad specifier). Repeat until clean. Watch the moved files' *own* relative imports (a `get_*.ts` now in `tools/data/` reaching a provider is `../providers/…`, reaching `schemas` is `../schemas`).

Run: `TYPECHECK`
Expected: clean.

- [ ] **Step 4: Run the suite**

Run: `TEST`
Expected: `Tests 578 passed (578)`. (Fixture-loading tests exercise `tools/runtime/fixtures.ts` + `tools/data/*` — if any fixture path is hardcoded, fix it here.)

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(trading-desk): extract tools/ catalog (data + runtime + providers)"
```

---

## Task 2: Recipe factories — `agents/_recipe/`

Move the shared per-phase factories so the agent groups can import them from one place.

**Files:**
- Move: `…/phase-1/analyst.ts` → `…/agents/_recipe/define-analyst.ts`
- Move: `…/lib/approach-generator.ts` → `…/agents/_recipe/approach-generator.ts`
- Move: `…/lib/memo-writer.ts` → `…/agents/_recipe/memo-writer.ts`
- Move: `…/lib/memo-setup.ts` → `…/agents/_recipe/memo-setup.ts`
- Modify (imports): all importers (every phase `writer.ts`/`setup.ts`, `analysts.ts`, the approach-using generators).

- [ ] **Step 1: Move**

```bash
cd labs/trading-desk/src/flows/trading-desk
mkdir -p agents/_recipe
git mv phase-1/analyst.ts agents/_recipe/define-analyst.ts
git mv lib/approach-generator.ts agents/_recipe/approach-generator.ts
git mv lib/memo-writer.ts agents/_recipe/memo-writer.ts
git mv lib/memo-setup.ts agents/_recipe/memo-setup.ts
```

- [ ] **Step 2: Find importers**

Run: `git grep -l 'lib/approach-generator\|lib/memo-writer\|lib/memo-setup\|phase-1/analyst\b' labs/trading-desk/src`

- [ ] **Step 3: Repoint imports → typecheck clean**

Run `TYPECHECK`; fix each error to point at `agents/_recipe/…`. The recipe files' own imports (e.g. `define-analyst.ts` → `tools/`, `../resources`, `../state`) shift by the new depth — fix as `tsc` flags them.

Run: `TYPECHECK`
Expected: clean.

- [ ] **Step 4: Suite**

Run: `TEST`
Expected: `Tests 578 passed (578)`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(trading-desk): extract agents/_recipe/ factories"
```

---

## Task 3: Analysts — `agents/analysts/`

**Files:**
- Move: `…/phase-1/{analysts,thesis-schema,writer,setup}.ts` → `…/agents/analysts/`
- Move: `…/phase-1/prompts/` → `…/agents/analysts/prompts/`
- Leave: `…/phase-1/index.ts` in place for now (it is orchestration — moves in Task 8).
- Modify: importers of the moved files (the index.ts, cross-phase schema imports, capability).

- [ ] **Step 1: Move**

```bash
cd labs/trading-desk/src/flows/trading-desk
mkdir -p agents/analysts
git mv phase-1/analysts.ts phase-1/thesis-schema.ts phase-1/writer.ts phase-1/setup.ts agents/analysts/
git mv phase-1/prompts agents/analysts/prompts
```

- [ ] **Step 2: Fix prompt loads (if Task 0 found path-relative loading)**

If `loadPrompt` resolves relative to the flow root, update each `loadPrompt("phase-1/prompts/…")` → `loadPrompt("agents/analysts/prompts/…")` inside `agents/analysts/analysts.ts` (and any prompt.ts). Run:
`git grep -n 'phase-1/prompts' labs/trading-desk/src`
Expected after fix: no hits.

- [ ] **Step 3: Repoint imports → typecheck clean**

Run: `git grep -l 'phase-1/analysts\|phase-1/thesis-schema\|phase-1/writer\|phase-1/setup' labs/trading-desk/src`
Update each (notably `phase-1/index.ts` and anything importing `thesisOutputSchema`). Run `TYPECHECK` until clean.

Run: `TYPECHECK`
Expected: clean.

- [ ] **Step 4: Suite**

Run: `TEST`
Expected: `Tests 578 passed (578)`.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "refactor(trading-desk): move analysts → agents/analysts/"
```

---

## Task 4: Research — `agents/research/`

**Files:**
- Move: `…/phase-2/{generators,round-robin,validate-citations,writer,setup,prompts}.ts` + `…/phase-2/prompts/` → `…/agents/research/`
- Move: `…/phase-2/tools/find_counter_evidence.ts` → `…/agents/research/tools/find_counter_evidence.ts` (flow-coupled — stays with its consumer; NOT in `tools/`)
- Leave: `…/phase-2/index.ts` (orchestration — Task 8).

- [ ] **Step 1: Move**

```bash
cd labs/trading-desk/src/flows/trading-desk
mkdir -p agents/research/tools
git mv phase-2/generators.ts phase-2/round-robin.ts phase-2/validate-citations.ts phase-2/writer.ts phase-2/setup.ts phase-2/prompts.ts agents/research/ 2>/dev/null || true
git mv phase-2/prompts agents/research/prompts
git mv phase-2/tools/find_counter_evidence.ts agents/research/tools/
ls phase-2/tools 2>/dev/null && rmdir phase-2/tools 2>/dev/null || true
```

- [ ] **Step 2: Fix prompt loads + imports → typecheck clean**

`git grep -n 'phase-2/prompts' labs/trading-desk/src` → repoint to `agents/research/prompts`.
`git grep -l 'phase-2/generators\|phase-2/round-robin\|phase-2/validate-citations\|phase-2/writer\|phase-2/setup\|phase-2/tools/find_counter_evidence' labs/trading-desk/src` → repoint each. Run `TYPECHECK` until clean.

Run: `TYPECHECK`
Expected: clean.

- [ ] **Step 3: Suite + Commit**

Run: `TEST` → `Tests 578 passed (578)`.
```bash
git add -A && git commit -m "refactor(trading-desk): move research → agents/research/ (find_counter_evidence stays flow-coupled)"
```

---

## Task 5: Lenses — `agents/lenses/` (includes the participant-owned resource)

**Files:**
- Move: `…/phase-2b/{lens-generator,lens-step,lens-verdict-schema,lens-body-sections,writer,setup}.ts` + `…/phase-2b/prompts/` → `…/agents/lenses/`
- Move: `…/lib/lenses.ts` `…/lib/convergence-math.ts` → `…/agents/lenses/`
- Move: `…/lens-convergence-resource.ts` → `…/agents/lenses/lens-convergence-resource.ts` (participant-owned, spec §2.4)
- Leave: `…/phase-2b/index.ts` (orchestration — Task 8).

- [ ] **Step 1: Move**

```bash
cd labs/trading-desk/src/flows/trading-desk
mkdir -p agents/lenses
git mv phase-2b/lens-generator.ts phase-2b/lens-step.ts phase-2b/lens-verdict-schema.ts phase-2b/lens-body-sections.ts phase-2b/writer.ts phase-2b/setup.ts agents/lenses/
git mv phase-2b/prompts agents/lenses/prompts
git mv lib/lenses.ts lib/convergence-math.ts agents/lenses/
git mv lens-convergence-resource.ts agents/lenses/
```

- [ ] **Step 2: Handle the `resources.ts` → resource-schema coupling (spec §2.4 note)**

`resources.ts` (root contract) imports `lensConvergenceStateSchema` from the moved file. Run:
`git grep -n 'lens-convergence-resource' labs/trading-desk/src`
Repoint `resources.ts`'s import to `./agents/lenses/lens-convergence-resource`. The resource file is a leaf (imports only `@flow-state-dev/core` + `zod`, never `resources.ts`), so this is acyclic — verify by reading the top of `agents/lenses/lens-convergence-resource.ts` (no `../resources` import). If it reads as an unwanted contract→participant import, the alternative (lift just `lensConvergenceStateSchema` into a `…/lib/` leaf both import) is acceptable; pick one and note it in the commit. Default: keep the direct import (acyclic, simplest).

- [ ] **Step 3: Fix prompt loads + remaining imports → typecheck clean**

`git grep -n 'phase-2b/prompts' labs/trading-desk/src` → repoint.
`git grep -l 'phase-2b/\|lib/lenses\|lib/convergence-math' labs/trading-desk/src` → repoint each (notably `phase-2b/index.ts`, `agents/lenses/writer.ts`'s imports of `lenses`/`convergence-math`, and `components/theses/lens-card.tsx` which imports `LENS_BODY_SECTION` + `LENS_PACK`).

Run: `TYPECHECK`
Expected: clean.

- [ ] **Step 4: Suite + Commit**

Run: `TEST` → `Tests 578 passed (578)`.
```bash
git add -A && git commit -m "refactor(trading-desk): move lenses → agents/lenses/ (incl. the lens-owned convergence resource)"
```

---

## Task 6: Singleton participants — trader / risk / scenario-forecaster / portfolio-manager / thesis-validator

Each is its own directory. Same move+fix+verify pattern. Do them **one sub-step + commit each** (five small commits) so a break is isolated.

**Files (per group):**
- trader: `…/phase-3/{trader,approach,writer,setup}.ts` + `…/phase-3/prompts/` → `…/agents/trader/`
- risk: `…/phase-4/{personas,consolidator,schemas,approach,writer,setup}.ts` + `…/phase-4/prompts/` → `…/agents/risk/`
- scenario-forecaster: `…/phase-5/scenario-forecaster.ts` + (its `approach`/`writer`/`setup` slices) → `…/agents/scenario-forecaster/`
- portfolio-manager: `…/phase-5/portfolio-manager.ts` + (its `approach`/`writer`/`setup` slices) → `…/agents/portfolio-manager/`
- thesis-validator: `…/phase-6/{thesis-validator,approach,writer,setup}.ts` + `…/phase-6/prompts/` → `…/agents/thesis-validator/`
- Leave every `…/phase-N/index.ts` in place (orchestration — Task 8).

> **Phase-5 caveat:** `phase-5/` holds TWO participants (scenario-forecaster + portfolio-manager) sharing `approach.ts`/`writer.ts`/`setup.ts`/`prompts/`. Read those four to see whether each is single-participant or shared. If shared, split them per participant when moving (a `setupForecastMemo` vs `setupPortfolioMemo` likely already separate inside `setup.ts`); if a file genuinely serves both, keep one copy in the participant that owns the larger share and import across, or leave the shared part in `…/lib/` — decide by reading. Do not duplicate logic.

- [ ] **Step 1: Trader** — move `phase-3/*` (minus index) → `agents/trader/`; `git grep` repoint (`phase-3/` importers + prompt loads); `TYPECHECK` clean; `TEST` 578; commit `refactor(trading-desk): move trader → agents/trader/`.

- [ ] **Step 2: Risk** — move `phase-4/*` (minus index) → `agents/risk/`; repoint; `TYPECHECK`; `TEST`; commit `refactor(trading-desk): move risk → agents/risk/`.

- [ ] **Step 3: Scenario-forecaster** — split + move from `phase-5/` → `agents/scenario-forecaster/`; repoint; `TYPECHECK`; `TEST`; commit.

- [ ] **Step 4: Portfolio-manager** — move remaining `phase-5/` participant → `agents/portfolio-manager/`; repoint; `TYPECHECK`; `TEST`; commit.

- [ ] **Step 5: Thesis-validator** — move `phase-6/*` (minus index) → `agents/thesis-validator/`; repoint; `TYPECHECK`; `TEST`; commit.

After this task, the only thing left in each `phase-N/` is `index.ts`.

---

## Task 7: Registry rename — `agents.ts` → `registry.ts`

**Files:**
- Move: `…/agents.ts` → `…/registry.ts`
- Modify: every importer of `./agents` / `…/agents` (the registry — `AGENTS`, `*_MEMO_KEYS`, `PHASE_GROUPS`, `shortNameForAgent`, etc.).

> **Naming collision watch:** the file becomes `registry.ts` but the new `agents/` *directory* now exists. Imports of the table are `…/registry`; imports of participants are `…/agents/<group>`. Confirm no import accidentally resolves `agents` (dir) where `registry` (table) was meant — `tsc` will flag a missing export if so.

- [ ] **Step 1: Move**

```bash
cd labs/trading-desk/src/flows/trading-desk && git mv agents.ts registry.ts
```

- [ ] **Step 2: Repoint → typecheck clean**

Run: `git grep -l "from \"[^\"]*agents\"\|/agents'" labs/trading-desk/src` (and `…/components`, `…/app`). Repoint each table import to `…/registry`. Run `TYPECHECK` until clean.

Run: `TYPECHECK`
Expected: clean.

- [ ] **Step 3: Suite + Commit**

Run: `TEST` → `578`.
```bash
git add -A && git commit -m "refactor(trading-desk): agents.ts → registry.ts"
```

---

## Task 8: Orchestration — `orchestration/{analyze,stages,guards}.ts` + shrink `flow.ts`

The one task that moves *logic*, not just files. Goal: the bundled participant steps now live in `agents/*`; relocate the *assembly* (what runs, in what order) into `orchestration/`, and reduce `flow.ts` to the `defineFlow` contract. **Behavior must be byte-identical** — verify with `fsdev run` (Step 6).

**Files:**
- Create: `…/orchestration/guards.ts` — `seedSession`, `checkTickerResolvable`, `checkHasData`, `checkHasPrimaryAnalysts`, `setInstructions` (extracted verbatim from `flow.ts`).
- Create: `…/orchestration/stages.ts` — one exported stage per old `phase-N/index.ts` body (the `.tap(setup…) → fan-out / round-robin / chain` assembly), importing participant steps from `agents/*` and setups from each `agents/<group>/setup.ts`.
- Create: `…/orchestration/analyze.ts` — the `analyzePipeline` sequence (from `flow.ts`), importing stages + guards. Keep `compute-spine` / `store-price-history` taps imported from root.
- Modify: `…/flow.ts` — delete the moved pipeline/guard bodies; keep only `defineFlow({ actions, resources, sessionState })`; import `analyze` from `./orchestration/analyze`.
- Delete: every `…/phase-N/index.ts` (now empty of anything but assembly that moved to `stages.ts`) and the now-empty `phase-N/` dirs.

- [ ] **Step 1: Read the current pipeline assembly**

Read `…/flow.ts` (the `analyzePipeline` + the inline guard handlers) and every `…/phase-N/index.ts`. List each stage export name and the exact step/tap order. This is the contract to preserve.

- [ ] **Step 2: Create `orchestration/guards.ts`**

Move the guard/handler definitions (`seedSession`, `checkTickerResolvable`, `checkHasData`, `checkHasPrimaryAnalysts`, `setInstructions`) out of `flow.ts` into `guards.ts` verbatim. Update their imports for the new depth (`../state`, `../flow-schema`, `../agents/_recipe/…` if any, the resources at `../`). Re-export anything `flow.ts` actions need.

- [ ] **Step 3: Create `orchestration/stages.ts`**

For each old `phase-N/index.ts`, paste its pipeline as an exported `const` in `stages.ts` (e.g. `analystFanOut`, `researchStage`, `lensStage`, `traderStage`, `riskStage`, `forecastStage`, `portfolioStage`, `thesisAuditStage`). Repoint imports: participant steps from `../agents/<group>`, setups from `../agents/<group>/setup`, container labels unchanged (keep the `component: "phase-*"` strings — spec §2.3).

- [ ] **Step 4: Create `orchestration/analyze.ts` + shrink `flow.ts`**

Move the `analyzePipeline` sequence into `analyze.ts` (importing stages + guards + the root `compute-spine`/`store-price-history` taps). In `flow.ts`, delete the moved bodies and `import { analyze } from "./orchestration/analyze"`; `flow.ts` now contains only `defineFlow(...)`. Then delete the emptied `phase-N/index.ts` files and `rmdir` the empty `phase-*` dirs.

- [ ] **Step 5: Typecheck + suite**

Run: `TYPECHECK` → clean (fix import direction: orchestration imports agents; agents must NOT import orchestration — `tsc`/the boundary check flags a cycle).
Run: `TEST` → `Tests 578 passed (578)`.

- [ ] **Step 6: Behavior-parity check (THE acceptance gate for this task)**

Run `fsdev run` for one ticker on `fast` and one on `full` (the repo's default flow verification — see `AGENTS.md`). Confirm the transcript streams **identically** to a pre-reorg run: same phase-divider beats, same memo set, same final decision shape. If anything differs, the assembly was not preserved — diff `stages.ts`/`analyze.ts` against the old `flow.ts` + `phase-*/index.ts`.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "refactor(trading-desk): extract orchestration/ (analyze + stages + guards); flow.ts → defineFlow only"
```

---

## Task 9: Docs + final whole-graph verification

**Files:**
- Modify: `labs/trading-desk/CLAUDE.md` — rewrite the `## Layout` block to the new tree; update every "Adding a…" guide path; fix the stale `services/` reference (it documents a folder that is actually `tools/runtime` + `providers/` now under `tools/providers`).
- Modify: any `docs/` references to the old phase paths (`git grep -l 'phase-1/tools\|phase-[0-9]/' docs/ labs/trading-desk/README.md`).

- [ ] **Step 1: Rewrite the CLAUDE.md Layout + guides**

Replace the `## Layout` tree with the §4 target tree. Update the "Adding a Phase 1 analyst", "Adding a new tool", "Adding a new generator", "Round-robin patterns" sections to reference `agents/…`, `tools/…`, `orchestration/…`. Remove the stale `services/` lines.

- [ ] **Step 2: Sweep doc path references**

Run: `git grep -ln 'phase-1/tools\|/phase-[1-6]/\|src/flows/trading-desk/providers\|/agents.ts' docs/ labs/trading-desk/README.md`
Update each to the new path. (Internal v2 specs are historical — update only if the path is presented as current guidance.)

- [ ] **Step 3: Whole-graph green**

Run: `pnpm typecheck` (root) → `43/43 tasks · package boundary validation passed`.
Run: `TEST` → `578`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs(trading-desk): rewrite CLAUDE.md layout + guides for the identity-grouped tree"
```

---

## Self-Review (run before opening the PR)

- [ ] **Spec coverage:** every spec §4/§5 destination has a task (recipe=T2, tools=T1, analysts=T3, research=T4, lenses+resource=T5, singletons=T6, registry=T7, orchestration=T8, docs=T9). The §2 decisions hold: lifecycle bundled (no `placeAgent` anywhere), `*.prompt.md` not renamed, `component:"phase-*"` strings untouched, resources co-located (only lens resource moved).
- [ ] **No behavior change:** `git log -p` the whole branch — every `+`/`-` is a path, an import specifier, or relocated assembly. Any change to a prompt body, schema, test assertion, or runtime literal is a bug.
- [ ] **Out-of-scope untouched:** `portfolio/`, `components/`, `app/`, the flow-contract + surface resources (decision-snapshot, report-index, price-history, valuation-spine, special-instructions, compute-spine, store-price-history) are unmoved.
- [ ] **Final gates:** root `pnpm typecheck` 43/43 + boundary check; `TEST` 578; `fsdev run` parity (Task 8 Step 6) confirmed.

---

## After the plan: PR + Linear

This is a single reviewable PR (large by file count, near-zero by content — like the labs/ move). On completion: create a Linear issue in the **Trading Desk Lab** project (labels `examples`, `Improvement`), attach this plan + the spec, open the PR against `main` referencing it. The diff reviews cleanly with rename + whitespace detection on.
