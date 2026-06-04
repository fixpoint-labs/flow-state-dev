---
name: fsd:diagnose
description: Disciplined diagnosis loop for hard bugs and performance regressions in the @flow-state-dev repo. Reproduce → minimise → hypothesise → instrument → fix → regression-test. Use when user says "diagnose this" / "debug this", reports a bug, says something is broken/throwing/failing, or describes a performance regression. For flow execution failures specifically, prefer `fsd:debug-flow`.
---

# Diagnose

A discipline for hard bugs. Skip phases only when explicitly justified.

## Repo context

Before diagnosing, orient yourself:

- `docs/architecture/overview.md` — system architecture and package roles
- `docs/architecture/<area>.md` — deep dives (e.g. `items.md` before touching items/rendering/stream, `streaming.md`, `execution-and-errors.md`, `state-and-scopes.md`)
- `docs/contributing/architecture-reference.md` — locked contracts quick reference
- `docs/contributing/best-practices.md` — implementation standards (BP-001–BP-016)
- `AGENTS.md` — process protocol and code style rules

**Related skills — pick the right one:**

| Symptom | Use |
|---------|-----|
| Flow execution misbehaves (wrong items, failed block, schema mismatch in a `.step()` chain, generator/tool errors during a run) | **`fsd:debug-flow`** — it has the NDJSON trace reader, `fsdev block` isolation workflow, and the FSD failure-pattern lookup table. |
| Anything else (typecheck regression, build break, store adapter bug, devtool UI bug, CLI bug, perf regression, flaky test, package boundary violation) | **This skill.** |
| Mixed — flow is broken *and* the root cause is upstream (e.g. a core builder regression breaking many flows) | Start here for the discipline; use `fsd:debug-flow` inside Phase 1 to build the loop. |

## Phase 1 — Build a feedback loop

**This is the skill.** Everything else is mechanical. If you have a fast, deterministic, agent-runnable pass/fail signal for the bug, you will find the cause — bisection, hypothesis-testing, and instrumentation all just consume that signal. If you don't have one, no amount of staring at code will save you.

Spend disproportionate effort here. **Be aggressive. Be creative. Refuse to give up.**

### Ways to construct one — try them in roughly this order

Loops that work well in this repo, fastest-to-slowest signal:

1. **Vitest filter at the package level.** A single test file is the sharpest, fastest loop available:
   ```bash
   pnpm --filter @flow-state-dev/<pkg> test path/to/file.spec.ts
   pnpm --filter @flow-state-dev/<pkg> test -t "name fragment"   # run by test name
   ```
   Watch mode for tight iteration: `pnpm --filter @flow-state-dev/<pkg> test:watch`. Skips unrelated init across the monorepo.
2. **Typecheck loop** for type-level bugs (declaration drift, generic regressions, package boundary breaks):
   ```bash
   pnpm --filter @flow-state-dev/<pkg> typecheck
   pnpm typecheck   # whole monorepo + boundary validator (scripts/validate-package-boundaries.mjs)
   ```
3. **`fsdev block` for single-block isolation.** One-shot JSON-in/JSON-out. Returns structured `schemaValidation`, `execution.durationMs`, and `error.stack`. Ideal for handlers, utility generators, and routers when you can name the input shape:
   ```bash
   pnpm --filter @flow-state-dev/cli fsdev block <path-to-block.ts> -i '<json>'
   ```
4. **`fsdev run` with NDJSON capture** when the bug only appears in a real flow (sequencer composition, state-scope interactions, generator + tool loop). Pipe stdout to a file so you can diff between runs:
   ```bash
   pnpm --filter @flow-state-dev/cli fsdev run <flowKind> <action> \
     -i '<json>' --flow-dir <path> > /tmp/run.ndjson 2> /tmp/run.log
   ```
   For deep flow analysis, hand off to **`fsd:debug-flow`** — it has the NDJSON event-type reader and failure-pattern table.
5. **Persistent session replay.** `fsdev run -s <session-id>` reuses session state across invocations; `--seed-session / --seed-user / --seed-project` pre-populate state. Use this to reproduce bugs that only appear after specific state.
6. **DevTool / kitchen-sink browser run** for UI-layer bugs (React hooks, renderers, devtool itself). `fsdev dev` for the live devtool; the kitchen-sink app under `apps/` for SSR/streaming assertions. Watch the browser console *and* the server stderr.
7. **Replay a captured trace.** Save a real NDJSON stream or HTTP request to disk; replay it through the code path in isolation (e.g. by feeding it to a unit test fixture).
8. **Property / fuzz loop.** For "sometimes wrong output" bugs — drive the block/builder with 100–1000 random inputs and assert invariants. Especially useful for sequencer composition and schema strictness (BP-016).
9. **Bisection harness.** If the bug appeared between two known good/bad states, automate "boot at state X, check, repeat" so you can `git bisect run` it against a vitest filter.
10. **Differential loop.** Run the same input through old-version vs new-version (or two configs) and diff stdout. Particularly effective for generator output regressions and serialization changes.
11. **HITL last resort.** If a human must click — UI bug, real provider call, OAuth flow — drive _them_ with a structured prompt and capture their report back into the loop. Don't proceed to Phase 2 without *some* loop.

Build the right feedback loop, and the bug is 90% fixed.

### Iterate on the loop itself

Treat the loop as a product. Once you have _a_ loop, ask:

- Can I make it faster? (Cache setup, skip unrelated init, narrow the test scope.)
- Can I make the signal sharper? (Assert on the specific symptom, not "didn't crash".)
- Can I make it more deterministic? (Pin time, seed RNG, isolate filesystem, freeze network.)

A 30-second flaky loop is barely better than no loop. A 2-second deterministic loop is a debugging superpower.

### Non-deterministic bugs

The goal is not a clean repro but a **higher reproduction rate**. Loop the trigger 100×, parallelise, add stress, narrow timing windows, inject sleeps. A 50%-flake bug is debuggable; 1% is not — keep raising the rate until it's debuggable.

### When you genuinely cannot build a loop

Stop and say so explicitly. List what you tried. Ask the user for: (a) access to whatever environment reproduces it, (b) a captured artifact (HAR file, log dump, core dump, screen recording with timestamps), or (c) permission to add temporary production instrumentation. Do **not** proceed to hypothesise without a loop.

Do not proceed to Phase 2 until you have a loop you believe in.

## Phase 2 — Reproduce

Run the loop. Watch the bug appear.

Confirm:

- [ ] The loop produces the failure mode the **user** described — not a different failure that happens to be nearby. Wrong bug = wrong fix.
- [ ] The failure is reproducible across multiple runs (or, for non-deterministic bugs, reproducible at a high enough rate to debug against).
- [ ] You have captured the exact symptom (error message, wrong output, slow timing) so later phases can verify the fix actually addresses it.

Do not proceed until you reproduce the bug.

## Phase 3 — Hypothesise

Generate **3–5 ranked hypotheses** before testing any of them. Single-hypothesis generation anchors on the first plausible idea.

Each hypothesis must be **falsifiable**: state the prediction it makes.

> Format: "If <X> is the cause, then <changing Y> will make the bug disappear / <changing Z> will make it worse."

If you cannot state the prediction, the hypothesis is a vibe — discard or sharpen it.

**Show the ranked list to the user before testing.** They often have domain knowledge that re-ranks instantly ("we just deployed a change to #3"), or know hypotheses they've already ruled out. Cheap checkpoint, big time saver. Don't block on it — proceed with your ranking if the user is AFK.

## Phase 4 — Instrument

Each probe must map to a specific prediction from Phase 3. **Change one variable at a time.**

Tool preference:

1. **Debugger / REPL inspection** if the env supports it. One breakpoint beats ten logs.
2. **Targeted logs** at the boundaries that distinguish hypotheses.
3. Never "log everything and grep".

**Tag every debug log** with a unique prefix, e.g. `[DEBUG-a4f2]`. Cleanup at the end becomes a single grep. Untagged logs survive; tagged logs die.

**Perf branch.** For performance regressions, logs are usually wrong. Instead: establish a baseline measurement (timing harness, `performance.now()`, profiler, query plan), then bisect. Measure first, fix second. For flow-level perf, the NDJSON stream already carries per-block `durationMs` in `block_output` items — diff between a known-good and known-bad run before reaching for a profiler.

## Phase 5 — Fix + regression test

Write the regression test **before the fix** — but only if there is a **correct seam** for it.

A correct seam is one where the test exercises the **real bug pattern** as it occurs at the call site. If the only available seam is too shallow (single-caller test when the bug needs multiple callers, unit test that can't replicate the chain that triggered the bug), a regression test there gives false confidence.

**If no correct seam exists, that itself is the finding.** Note it. The codebase architecture is preventing the bug from being locked down. Flag this for the next phase.

If a correct seam exists:

1. Turn the minimised repro into a failing test at that seam.
2. Watch it fail.
3. Apply the fix.
4. Watch it pass.
5. Re-run the Phase 1 feedback loop against the original (un-minimised) scenario.

**FSD test placement** — match the existing convention:

- Block / pattern unit tests live next to the source: `packages/<pkg>/src/.../foo.ts` → `packages/<pkg>/src/.../foo.spec.ts`. See the `fsd:write-block-tests` skill for the mock-context idiom.
- Cross-package or flow-level regressions belong in `packages/integration-tests/` (Tier 1 suite). Add a flow there when the bug needs more than one package to reproduce.
- Generator output-schema bugs: add a `makeSchemaStrict` walker assertion (see `labs/trading-desk/test/output-schemas-strict.spec.ts`). BP-016 requires this guard for any schema that's reachable from a generator output.
- **Verification per CLAUDE.md:** if the change is flow-logic, the default verification is `fsdev run`, not `pnpm test`. Reach for `pnpm test` for unit-level changes; reach for the browser for UI-layer changes.

## Phase 6 — Cleanup + post-mortem

Required before declaring done:

- [ ] Original repro no longer reproduces (re-run the Phase 1 loop)
- [ ] Regression test passes (or absence of seam is documented)
- [ ] All `[DEBUG-...]` instrumentation removed (`grep` the prefix)
- [ ] Throwaway prototypes deleted (or moved to a clearly-marked debug location)
- [ ] The hypothesis that turned out correct is stated in the commit / PR message — so the next debugger learns
- [ ] **Per-package check passes:** `pnpm --filter <pkg> typecheck && pnpm --filter <pkg> test` for any package you touched. Run `pnpm typecheck` at the root if your fix crossed package boundaries — it also runs the boundary validator.
- [ ] **User-facing doc updates** (CLAUDE.md rule): any new or changed end-user functionality requires updates to the relevant `packages/*/README.md` and any affected `apps/docs` pages in the same change set.
- [ ] **BP-007:** if you added a new file, give it a header comment and doc-comment every export.

**Then ask: what would have prevented this bug?** If the answer involves architectural change (no good test seam, tangled callers, hidden coupling between packages, missing capability), capture the specifics — the right place depends on scope:

- **Implementation-level concern** (BP violation, missing test seam, recurring pattern bug): consider whether it warrants a new BP entry in `docs/contributing/best-practices.md`, or a follow-up Linear issue.
- **Architecture-level concern** (documented contract is ambiguous or wrong, cross-package drift, missing seam): update the relevant `docs/architecture/<area>.md` in the same change set, and consider whether `fsd:improve-codebase-architecture` should run on the area afterwards.

Make the recommendation **after** the fix is in, not before — you have more information now than when you started.
