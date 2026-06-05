# Design: `defineMemoStep` — one memo-lifecycle convention for trading-desk participants

**Date:** 2026-06-05
**Status:** Design, approved — ready for an implementation plan.
**Type:** Structural refactor of `labs/trading-desk` (behavior-preserving). Establishes a convention; **not** Layer-2 / Agent-primitive adoption.
**Context:** Step 1 of the "trading-desk as convention lab" work. The reorg (FIX-731) already moved the memo lifecycle into orchestration; this collapses the three ways it's currently expressed into one apparatus.

---

## 1. Goal

Today a participant's memo lifecycle (`markWriting → body → commit → rescue(markError)`) is expressed **three** ways:

- **inline** in `stages.ts` for the 5 singletons + 3 risk personas + 3 research consolidations (`.tap(markWritingP3("trader")).step(...).tap(commitTrader).rescue([markErrorP3("trader")])`);
- via **`defineAnalyst`** for the 9 analysts (adds a tools fan-out);
- via **`defineLensStep`** for the 4 lenses.

And `markWriting`/`markError` are built **per phase** by 8 separate `defineMemoStateBlocks({ phaseId, agentTeam, keys })` calls.

Collapse all of it to **one** apparatus — `defineMemoStep(body, { key, commit })` — with the two recipes becoming thin wrappers over it, and `markWriting`/`markError` unified into one **key-driven** pair. `stages.ts` then reads as a flat staffing plan, and there is exactly one place the memo lifecycle lives. The file structure tells you "participants are portable bodies; the situation owns one lifecycle."

**Behavior-preserving** — the resulting block graph is identical; this is a factoring change. The 578-test suite + an `fsdev run` parity check are the gates.

---

## 2. The apparatus

### 2.1 `defineMemoStep` (new, in `agents/_recipe/`)

```ts
export function defineMemoStep(
  body: BlockDefinition,
  opts: { key: AnyMemoShortName; commit: BlockDefinition; errorPlaceholder?: (agentName: AgentName) => string },
): BlockDefinition;
// builds:  sequencer().tap(markWriting(key)).step(body).tap(commit).rescue([{ block: markError(key, errorPlaceholder) }])
```

- **`body`** — the participant's pre-commit work: a bare generator, or a composed sub-sequencer (approach→gen, or fan-out→gen). No memo writes.
- **`key`** — a **typed** memo short-name (`AnyMemoShortName = keyof typeof ALL_MEMO_KEYS`), NOT `string`. Drives `markWriting`/`markError` and the memo identity.
- **`commit`** — the per-participant commit handler (unchanged; stays in `agents/<group>/writer.ts`).
- **`errorPlaceholder`** — optional; Phase 4 personas use it (the only per-participant `markError` variation today).

### 2.2 Unified key-driven `markWriting` / `markError` (replaces the 8 per-phase factories)

Today `defineMemoStateBlocks({ phaseId, agentTeam, keys })` is called 8× to produce per-phase `markWriting(shortName)` / `markError(shortName)`. Replace with a **single** pair that reads everything from the registry by key:

```ts
export function markWriting(key: AnyMemoShortName): BlockDefinition;   // reads ALL_MEMO_KEYS[key]
export function markError(key: AnyMemoShortName, placeholder?): BlockDefinition;
```

The bodies are identical to today's (upsert `status: "writing"` + `memoStatus` mirror; flip to `error`) — they just resolve `collectionKey` / `agentName` / `agentTeam` / `phaseId` from `ALL_MEMO_KEYS[key]` instead of from per-phase closure config. `defineMemoStateBlocks` is **removed** (its `MemoStateBlocksConfig` + the 8 call sites go away).

### 2.3 Registry enrichment (the quiet win — `registry.ts`)

Each memo-key entry today is `{ agentName, memoKey, collectionKey }` and `agentTeam`/`phaseId` are smeared across the 8 `defineMemoStateBlocks` calls. Move them **onto the entries**:

```ts
type MemoKeyEntry = {
  agentName: AgentName;
  memoKey: string;
  collectionKey: string;
  agentTeam: AgentTeam;            // was a defineMemoStateBlocks arg
  phaseId: string;                 // was a defineMemoStateBlocks arg
  errorPlaceholder?: (agentName: AgentName) => string;  // Phase 4 personas only
};
```

The entry **type requires** `agentTeam` + `phaseId`, so a new entry can't be half-specified (it won't type-check). `ALL_MEMO_KEYS` (the merged map) becomes the single source of memo identity, and `AnyMemoShortName = keyof typeof ALL_MEMO_KEYS` is the typed key threaded everywhere.

### 2.4 The recipes become thin wrappers (not separate apparatuses)

```ts
// defineAnalyst — its only real content is the analyst-specific tools fan-out; then it delegates.
export function defineAnalyst({ shortName, tools, generator }: AnalystConfig): BlockDefinition {
  const body = sequencer({ name: `analyst-body-${shortName}` })
    .map(tickerDate)
    .parallel(attributedTools(tools))
    .step(generator);
  return defineMemoStep(body, { key: shortName, commit: commitAnalystMemo });
}

// lens — thin enough to collapse to a direct call at the fan-out site
const lensStep = (lens: InvestorLens) =>
  defineMemoStep(lensGenerator(lens), { key: lens.id, commit: commitLensVerdict });
```

`defineLensStep` is removed (folded into the one-liner above). `defineAnalyst` shrinks to body-composition + delegation.

### 2.5 Participant bodies

Each non-analyst/non-lens participant module exports its **body** (the approach + generator composed):

```ts
// agents/trader/index.ts (or trader.ts)
export const traderBody = sequencer({ name: "trader-body" })
  .step(traderApproachGenerator)
  .step(traderGenerator);
```

…and `stages.ts` becomes flat:

```ts
const traderStep = defineMemoStep(traderBody, { key: "trader", commit: commitTraderMemo });
// risk personas: defineMemoStep(personaBody, { key, commit: commitPersonaMemo, errorPlaceholder })
// research consolidations: defineMemoStep(consolidateBullMemo, { key: "bull", commit: commitBullMemo })
```

The stage containers (`.tap(setupXMemos).step(...)` + the `component: "phase-*"` labels) are unchanged.

---

## 3. Non-brittleness (the explicit requirement)

| Failure mode | Guard |
|---|---|
| Key typo / unknown key | `key: AnyMemoShortName` (typed union over `ALL_MEMO_KEYS`) — a typo is a **compile error**, never a runtime skip. |
| Registry entry missing `agentTeam`/`phaseId` | The `MemoKeyEntry` type **requires** them — a half-specified entry won't type-check, and `markWriting(key)` always finds a complete record. |
| Participant registered but never placed (or placed under a stale key) | A **coverage guard test**: assert `{keys placed via defineMemoStep across stages} === {keys in ALL_MEMO_KEYS}`. Fails loudly when someone adds a participant and forgets to place it. |
| Wrong body for a key (`defineMemoStep(scenarioBody, { key: "trader" })`) | Not type-catchable (body is a generic block) — the **same** wiring risk as today's inline pairing, surfaced by the `fsdev run` parity check. If a body's generator exposes its `agentName`, add a dev-time assertion it matches the key (confirm feasibility during implementation; do not block on it). |

Net: typed key + typed registry + coverage guard makes this **less** brittle than today's hand-wired-per-phase assembly.

---

## 4. Files

| File | Change |
|------|--------|
| `agents/_recipe/memo-writer.ts` | Add `defineMemoStep`; replace `defineMemoStateBlocks` with the single key-driven `markWriting`/`markError`. |
| `agents/_recipe/define-analyst.ts` | Rewrite `defineAnalyst` as a thin wrapper over `defineMemoStep`. |
| `registry.ts` | Enrich memo-key entries with `agentTeam`/`phaseId`/`errorPlaceholder?`; export `AnyMemoShortName` + `ALL_MEMO_KEYS` as the typed source. |
| `agents/<group>/writer.ts` (×8) | Drop the `defineMemoStateBlocks({...})` calls + the `markWritingP*`/`markErrorP*` re-exports; keep the commit handlers. |
| `agents/<group>/` (per participant) | Export the participant `body` (compose approach+gen where applicable); fold `defineLensStep` into the lens fan-out. |
| `orchestration/stages.ts` | Replace every inline step assembly with `defineMemoStep(body, { key, commit })`; the analyst fan-out + lens fan-out call the wrappers. |
| `test/*` | Add the coverage guard test; update any test importing `markWritingP*`/`defineMemoStateBlocks`/`defineLensStep`. |
| `labs/trading-desk/CLAUDE.md` | Document the `defineMemoStep` convention (replaces the "three idioms" description). |
| `.changeset/*.md` | Private example → empty-frontmatter changelog note (BP-022). |

---

## 5. Verification

1. `pnpm --filter @flow-state-dev/trading-desk typecheck` — clean (the typed `key` + enriched entries flow through).
2. `pnpm --filter @flow-state-dev/trading-desk test` — the 578 existing tests stay green + the new coverage guard.
3. root `pnpm typecheck` — boundary check.
4. **`fsdev run`** one ticker `fast` + one `full` — transcript streams identically (same memos, same order, same final decision). The behavior-preserving gate, since this re-routes the memo lifecycle.

A diff that changes a prompt, a schema, a commit projection, or a runtime output is a bug — this is a factoring change.

---

## 6. Non-goals

- No behavior change; no new participant; no commit-projection change.
- No Agent-primitive adoption (`defineAgent`/`materializeAgent`) — that was deliberately ruled out for this deterministic flow.
- No flow separation (portfolio → own flow) — the next step; it will reshape modules/resources.
- No resource reorg or capability/formatter rework — separate later threads.
