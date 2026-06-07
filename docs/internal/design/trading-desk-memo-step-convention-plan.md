# `defineMemoStep` Convention — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse the three memo-lifecycle idioms (inline `stages.ts` assembly, `defineAnalyst`, `defineLensStep`) into one key-driven `defineMemoStep` factory, with the recipes as thin wrappers and memo identity consolidated onto the registry. Behavior-preserving.

**Architecture:** Additive-first refactor. Add the new apparatus (`defineMemoStep` + unified key-driven `markWriting`/`markError`) alongside the old `defineMemoStateBlocks`, enrich the registry, migrate group-by-group (green at every commit), then delete the old. Spec: [`trading-desk-memo-step-convention.md`](./trading-desk-memo-step-convention.md).

**Tech Stack:** TypeScript, `@flow-state-dev/core` block API, pnpm workspace, vitest, `fsdev run`.

---

## How to execute (it is a behavior-preserving refactor)

For most steps, the verification loop is **not** a new test:

1. Make the change.
2. `typecheck` goes RED on the affected imports/types — fix until green.
3. The **existing 578-test suite** stays green (it exercises memo transitions + sequencer composition, so it catches a broken lifecycle).
4. Commit.

The **one genuinely-new test** is the coverage guard (Task 7) — write it TDD-style. A diff that changes a prompt, a schema, a commit projection, or a runtime output is a **bug**, not a refactor.

- `TC` = `pnpm --filter @flow-state-dev/trading-desk typecheck`
- `TEST` = `pnpm --filter @flow-state-dev/trading-desk test` (expect `Tests 578 passed`, +1 after Task 7)
- All paths under `labs/trading-desk/src/flows/trading-desk/` (abbrev `…/`) unless noted.

**Migration is repetitive across 19 participants — the plan gives the exact recipe + representative examples per shape, not all 19 verbatim. Apply the recipe; `typecheck` + the suite catch misses.** Do NOT parallelize: tasks share `stages.ts`, `registry.ts`, and `memo-writer.ts`; run in order, one commit each.

---

## File structure (what changes)

```
…/registry.ts                     enrich each memo-key entry; ALL_MEMO_KEYS already merges them
…/agents/_recipe/memo-writer.ts   ADD defineMemoStep + key-driven markWriting/markError; REMOVE defineMemoStateBlocks (Task 6)
…/agents/_recipe/define-analyst.ts rewrite defineAnalyst as a wrapper over defineMemoStep
…/agents/<group>/writer.ts (×8)   drop the defineMemoStateBlocks call + markWritingP*/markErrorP* re-exports; keep commits
…/agents/<group>/ (per participant) export the participant `body` (compose approach+gen); fold defineLensStep
…/orchestration/stages.ts         every participant becomes defineMemoStep(body, { key, commit })
…/test/memo-step-coverage.spec.ts NEW — the coverage guard
…/CLAUDE.md                       document the one convention
```

---

## Task 0: Baseline

- [ ] **Step 1:** Run `TC && TEST` → typecheck clean, `Tests 578 passed (578)`. Record the per-phase `defineMemoStateBlocks` args (`agentTeam`, `phaseId`, `errorMessageFallback`, `errorTextPlaceholder?`) from each `agents/<group>/writer.ts` — you'll stamp these onto the registry entries in Task 1.

Run: `git grep -n -A6 'defineMemoStateBlocks({' …/agents`
No commit.

---

## Task 1: Enrich the registry memo-key entries

Move `agentTeam` + `phaseId` (+ the optional `errorMessageFallback` / `errorPlaceholder`) from the 8 per-phase `defineMemoStateBlocks` calls onto each entry, so `ALL_MEMO_KEYS[key]` is the single source of memo identity.

**Files:** Modify `…/registry.ts`.

- [ ] **Step 1: Widen the entry type**

Find the entry type (today `{ agentName: AgentName; memoKey: string; collectionKey: string }`, registry.ts:165) and widen it:

```ts
type MemoKeyEntry = {
  agentName: AgentName;
  memoKey: string;
  collectionKey: string;
  agentTeam: AgentTeam;             // was a defineMemoStateBlocks arg
  phaseId: string;                  // was a defineMemoStateBlocks arg
  errorMessageFallback: string;     // was a defineMemoStateBlocks arg
  errorPlaceholder?: (agentName: AgentName) => string;  // Phase-4 personas only
};
```

- [ ] **Step 2: Stamp every entry**

Add `agentTeam`, `phaseId`, `errorMessageFallback` (and `errorPlaceholder` for the 3 Phase-4 personas) to **every** entry in `PHASE_1_MEMO_KEYS … PHASE_6_MEMO_KEYS` + `PHASE_2B_MEMO_KEYS`, using the values you recorded in Task 0 (each phase's `defineMemoStateBlocks` args apply to that phase's entries). Example (Phase 3):

```ts
export const PHASE_3_MEMO_KEYS = {
  trader: { agentName: "trader", memoKey: "trader", collectionKey: "p3/trader",
            agentTeam: "pm", phaseId: "p3", errorMessageFallback: "Trade proposal failed." },
} as const;
```

The widened type forces every entry to carry `agentTeam`/`phaseId`/`errorMessageFallback` — a missing field is a compile error. `ALL_MEMO_KEYS` (the spread-merge) picks them up automatically.

- [ ] **Step 3: Verify + commit**

`TC` → clean (the per-phase `defineMemoStateBlocks` calls still pass their own args; harmless). `TEST` → 578 passed.
```bash
git add -A && git commit -m "refactor(trading-desk): consolidate memo identity (agentTeam/phaseId) onto registry entries"
```

---

## Task 2: Add `defineMemoStep` + key-driven `markWriting`/`markError` (additive)

**Files:** Modify `…/agents/_recipe/memo-writer.ts` (add new exports; leave `defineMemoStateBlocks` in place for now).

- [ ] **Step 1: Add the key-driven state blocks + the factory**

Add these exports (they read identity from `ALL_MEMO_KEYS[key]`; bodies are identical to the current per-phase versions). Add imports: `sequencer`, `type BlockDefinition` from core; `ALL_MEMO_KEYS`, `AnyMemoShortName` from `../../registry`.

```ts
/** Pre-mark a memo `writing` (keyed). Reads identity from ALL_MEMO_KEYS. */
export function markWriting(key: AnyMemoShortName) {
  const { collectionKey, agentName, agentTeam, phaseId } = ALL_MEMO_KEYS[key];
  return memoHandler({
    name: `mark-writing-${key}`,
    inputSchema: z.unknown(),
    execute: async (_input, ctx) => {
      const startedAt = new Date().toISOString();
      await ctx.resources.memos.upsert(
        collectionKey,
        { status: "writing", startedAt, agentName },
        { agentTeam, phaseId, ticker: ctx.session.state.ticker, date: ctx.session.state.date },
      );
      if (ctx.session.state.memoStatus[key] !== "writing") {
        await ctx.session.setStateRecord("memoStatus", key, "writing");
      }
    },
  });
}

/** Flip a memo to `error` (keyed). */
export function markError(key: AnyMemoShortName) {
  const { collectionKey, agentName, errorMessageFallback, errorPlaceholder } = ALL_MEMO_KEYS[key];
  return memoHandler({
    name: `mark-error-${key}`,
    inputSchema: z.object({ error: z.unknown() }).passthrough(),
    outputSchema: z.object({ status: z.literal("error"), text: z.string() }),
    execute: async (input, ctx) => {
      const error = (input as { error?: unknown }).error;
      const message =
        error instanceof Error ? error.message
        : typeof error === "string" ? error
        : errorMessageFallback;
      const ref = await ctx.resources.memos.getOptional(collectionKey);
      if (ref !== undefined) {
        await ref.patchState({ status: "error", errorMessage: message, completedAt: new Date().toISOString() });
      }
      if (ctx.session.state.memoStatus[key] !== "error") {
        await ctx.session.setStateRecord("memoStatus", key, "error");
      }
      return { status: "error" as const, text: errorPlaceholder ? errorPlaceholder(agentName) : "" };
    },
  });
}

/** Keys placed via defineMemoStep — the coverage-guard backstop (Task 7). */
const placedKeys = new Set<AnyMemoShortName>();
export function placedMemoKeys(): ReadonlySet<AnyMemoShortName> { return placedKeys; }

/** Wrap a portable body with the situational memo lifecycle. The ONE apparatus. */
export function defineMemoStep(
  body: BlockDefinition,
  opts: { key: AnyMemoShortName; commit: BlockDefinition },
): BlockDefinition {
  placedKeys.add(opts.key);
  return sequencer({ name: `memo-step-${opts.key}` })
    .tap(markWriting(opts.key))
    .step(body)
    .tap(opts.commit)
    .rescue([{ block: markError(opts.key) }]);
}
```

- [ ] **Step 2: Verify + commit**

`TC` → clean; `TEST` → 578 passed (additive — nothing uses the new exports yet).
```bash
git add -A && git commit -m "refactor(trading-desk): add defineMemoStep + key-driven markWriting/markError (additive)"
```

---

## Task 3: Rewrite `defineAnalyst` as a wrapper

**Files:** Modify `…/agents/_recipe/define-analyst.ts`, `…/agents/analysts/writer.ts`.

- [ ] **Step 1:** Read the current `define-analyst.ts`. Rewrite its body to compose the analyst body and delegate to `defineMemoStep` — its only analyst-specific content is the tools fan-out:

```ts
export function defineAnalyst({ shortName, tools, generator }: AnalystConfig): BlockDefinition {
  const body = sequencer({ name: `analyst-body-${shortName}` })
    .map(tickerDate)
    .parallel(attributedTools(tools))
    .step(generator);
  return defineMemoStep(body, { key: shortName, commit: commitAnalystMemo });
}
```

(`commitAnalystMemo` is the analysts' shared commit — keep it in `agents/analysts/writer.ts`. Import `defineMemoStep` from `../_recipe/memo-writer`.)

- [ ] **Step 2:** In `agents/analysts/writer.ts`, delete the `defineMemoStateBlocks({...})` call and the `markWriting`/`markError` re-exports (they're now unused — `defineAnalyst` uses the keyed pair via `defineMemoStep`). Keep `commitAnalystMemo` + the publishMemo-based commit.

- [ ] **Step 3:** `TC` → fix any importer of the dropped `markWriting`/`markError`; `TEST` → 578 passed (the analyst fan-out behaves identically). Commit:
```bash
git add -A && git commit -m "refactor(trading-desk): defineAnalyst → thin wrapper over defineMemoStep"
```

---

## Task 4: Fold the lens recipe into `defineMemoStep`

**Files:** Modify `…/agents/lenses/lens-step.ts` (or wherever `defineLensStep` lives), `…/agents/lenses/writer.ts`, `…/orchestration/stages.ts` (the lens fan-out).

- [ ] **Step 1:** Replace `defineLensStep` usage with a direct call at the lens fan-out site:

```ts
// in stages.ts (or a lens helper) — the lens fan-out
const lensSteps = LENS_PACK.map((lens) =>
  defineMemoStep(lensGenerator(lens), { key: lens.id, commit: commitLensVerdict }),
);
```

Delete `defineLensStep`. In `agents/lenses/writer.ts`, drop the `defineMemoStateBlocks` call + `markWritingP2b`/`markErrorP2b` re-exports; keep `commitLensVerdict` + `computeAndStoreConvergence`.

- [ ] **Step 2:** `TC` → green; `TEST` → 578 passed. Commit:
```bash
git add -A && git commit -m "refactor(trading-desk): fold defineLensStep into defineMemoStep"
```

---

## Task 5: Migrate the inline-stages participants

The 5 singletons (trader, scenario-forecaster, portfolio-manager, thesis-validator) + 3 risk personas (aggressive/conservative/neutral) + risk-assessment + 3 research consolidations (bull/bear/researchManager) are assembled inline in `stages.ts`. Convert each to `defineMemoStep`.

**Files:** Modify `…/orchestration/stages.ts`, each participant module (export a `body`), and the 6 groups' `agents/<group>/writer.ts` (drop their `defineMemoStateBlocks`).

**The recipe** (apply per participant):
1. If the participant has an approach preamble, export its **body** from the participant module:
   ```ts
   // agents/trader/trader.ts (or a new index.ts)
   export const traderBody = sequencer({ name: "trader-body" })
     .step(traderApproachGenerator)
     .step(traderGenerator);
   ```
   (A participant with no approach — the research consolidations — uses its generator directly as the body.)
2. In `stages.ts`, replace the inline `sequencer().tap(markWritingP*(...)).step(...).tap(commit*).rescue([markErrorP*(...)])` with:
   ```ts
   const traderStep = defineMemoStep(traderBody, { key: "trader", commit: commitTraderMemo });
   ```
   Risk personas pass their persona body + key + commit (the `errorPlaceholder` now comes from the registry entry, so no extra arg).
3. In that group's `agents/<group>/writer.ts`, delete the `defineMemoStateBlocks({...})` call + `markWritingP*`/`markErrorP*` re-exports; keep the commit handlers.

- [ ] **Step 1: Research consolidations** (bull/bear/researchManager — no approach; body = the generator). Convert the 3 `*Step`s in stages.ts; drop research/writer.ts's defineMemoStateBlocks. `TC` + `TEST` green. Commit `refactor(trading-desk): research consolidations → defineMemoStep`.
- [ ] **Step 2: Trader.** Export `traderBody`; convert; drop trader/writer.ts's defineMemoStateBlocks. `TC` + `TEST` green. Commit.
- [ ] **Step 3: Risk** (3 personas + assessment). Export bodies (`personaBody` per persona); convert (personas carry `errorPlaceholder` via the registry now); drop risk/writer.ts's defineMemoStateBlocks. `TC` + `TEST` green. Commit.
- [ ] **Step 4: Scenario-forecaster + portfolio-manager.** Export bodies; convert; drop both writers' defineMemoStateBlocks. `TC` + `TEST` green. Commit.
- [ ] **Step 5: Thesis-validator.** Export body; convert; drop thesis-validator/writer.ts's defineMemoStateBlocks. `TC` + `TEST` green. Commit.

After this task, every participant in `stages.ts` is a `defineMemoStep(...)` line, and no `agents/<group>/writer.ts` calls `defineMemoStateBlocks`.

---

## Task 6: Remove the dead `defineMemoStateBlocks`

**Files:** Modify `…/agents/_recipe/memo-writer.ts`.

- [ ] **Step 1:** Confirm no remaining references: `git grep -n 'defineMemoStateBlocks\|markWritingP\|markErrorP' labs/trading-desk/src` → should be empty (or only the def itself). Delete the `defineMemoStateBlocks` function + its `MemoStateBlocksConfig` interface + the `KeyEntry` type. Update the file header comment to describe the new three pieces (`defineMemoStep`, keyed `markWriting`/`markError`, `publishMemo`).

- [ ] **Step 2:** `TC` → clean; `TEST` → 578 passed. Commit:
```bash
git add -A && git commit -m "refactor(trading-desk): remove the now-unused defineMemoStateBlocks"
```

---

## Task 7: Coverage guard test (the one new TDD test)

**Files:** Create `…/test/memo-step-coverage.spec.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from "vitest";
import "../src/flows/trading-desk/orchestration/stages"; // import for side effect: builds every step → records placements
import { placedMemoKeys } from "../src/flows/trading-desk/agents/_recipe/memo-writer";
import { ALL_MEMO_KEYS } from "../src/flows/trading-desk/registry";

describe("defineMemoStep coverage", () => {
  it("places exactly the registry's memo keys — no orphan registered, none placed under a stale key", () => {
    const placed = [...placedMemoKeys()].sort();
    const registered = Object.keys(ALL_MEMO_KEYS).sort();
    expect(placed).toEqual(registered);
  });
});
```

- [ ] **Step 2: Run it** — `pnpm --filter @flow-state-dev/trading-desk test memo-step-coverage`. It should PASS now (every participant is placed via defineMemoStep after Task 5). If it lists a missing key, a participant wasn't migrated — fix the migration, not the test.

- [ ] **Step 3:** `TEST` → `Tests 579 passed`. Commit:
```bash
git add -A && git commit -m "test(trading-desk): coverage guard — every registered memo key is placed"
```

---

## Task 8: Docs + whole-graph + parity

**Files:** Modify `…/CLAUDE.md`; add `.changeset/*.md`.

- [ ] **Step 1:** Rewrite the `CLAUDE.md` section that described the three memo idioms → the one `defineMemoStep` convention (body + `{ key, commit }`; `defineAnalyst`/lens as thin wrappers; memo identity lives in the registry). Add a private-example changeset (empty frontmatter) noting the refactor.

- [ ] **Step 2: Whole-graph + parity gate**
  - `pnpm typecheck` (root) → 45/45 + package-boundary validation.
  - `TEST` → 579 passed.
  - **`fsdev run`** one ticker `fast` + one `full` → transcript streams identically to a pre-refactor run (same memos, same order, same final decision). This is the behavior-preserving acceptance gate, since the memo lifecycle was re-routed.

- [ ] **Step 3:** Commit `docs(trading-desk): document the defineMemoStep convention + changeset`.

---

## Self-Review (before the PR)

- [ ] **Spec coverage:** defineMemoStep (T2), key-driven markWriting/markError + registry enrichment (T1–T2), defineAnalyst wrapper (T3), lens fold (T4), inline migration (T5), remove old (T6), coverage guard (T7), docs+parity (T8). All spec §2–§5 items have a task.
- [ ] **Pure factoring:** `git log -p main..HEAD` — every change is a relocation, an import, a registry field, or the new apparatus. No prompt/schema/commit-projection/runtime-literal change. The error-message fallback strings were carried verbatim onto the registry entries (Task 1).
- [ ] **Non-brittle:** `key` is `AnyMemoShortName` everywhere (no raw strings); the entry type requires `agentTeam`/`phaseId`/`errorMessageFallback`; the coverage guard passes.
- [ ] **Gates:** root typecheck 45/45; `TEST` 579; `fsdev run` parity confirmed.

## After: PR + Linear

One PR (`refactor/trading-desk-memo-step` → `main`). On completion: create a Trading Desk Lab issue (`Improvement`), attach the spec + plan, open the PR referencing it.
