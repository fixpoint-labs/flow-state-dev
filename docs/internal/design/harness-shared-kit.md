# Design — One floor under three harnesses, proved in Kitchen Sink

**Date:** 2026-10-26
**Status:** PROPOSED. Phase 0 is **built and green on this branch** (see §6); phases 1–3 are not.

> The question this answers: *should we refactor so we don't have three
> implementations?* The short answer is **no — not three into one.** Most of
> what looks duplicated is irreducible vendor difference, and collapsing it
> would invent a false equivalence. What is missing is a **floor**: a small
> shared kit and, more importantly, a check that holds the three to one
> contract. Kitchen Sink is where that check belongs, because it is the only
> place that runs all three over the same flow.

---

## 1. What is actually there

| Package | src lines | src *code* lines | test lines | docs page |
|---|---|---|---|---|
| `claude-code` (sdk + cli) | 6,221 | 3,142 | 8,563 | 865 |
| `codex` | 2,199 | 1,267 | 2,090 | 308 |
| `cursor` | 2,719 | 1,495 | 2,751 | 386 |

Half the file volume is doc prose. The two younger adapters are **~2,760 lines
of real code combined** — unification is not where meaningful volume lives.

Above them, the architecture is already right: `packages/core/src/types/harness.ts`
owns the neutral contract, and `harness-manager` drives all three through it
with **zero dependency on any harness package**. Kitchen Sink has converged too
— `HarnessModePage id="claude-code" | "codex" | "cursor"` is one component, and
`lib/harness-session-flow.ts` is one flow. The three mode files differ only in
vendor config and host checks.

**The app layer already proved the shape. The package layer below the contract
has no shared floor at all.**

---

## 2. Duplication, broken down

| Layer | codex ↔ cursor overlap | Shareable? |
|---|---|---|
| `translate.ts` | 415 of 547 lines differ | **No** — vendor wire formats |
| `cost.ts` | arithmetic differs materially | **No** — codex `inputTokens` *includes* cached, cursor's excludes |
| `agent.ts` bodies | different lifecycles (thread/stream vs agent/send/wait) | **Spine only** |
| `emit.ts` protocol (`buildBase`, provenance, added/done sequences, tool open+settle, error item, finalize) | near-identical | **Yes** |
| `errors.ts` (SdkNotInstalled / VersionMismatch / ConfigError / RunError / Aborted) | identical structure, vendor strings only | **Yes** |
| `capability.ts` | ~30 code lines, identical but for names | **Yes** |
| Spine guards: `assertNoOwnedKeys`, `abortRace`, `assertTestedSdkVersion`, prompt/abort preflight, handle assembly | same shape | **Yes** |

### The decision, and what it costs either way

```mermaid
flowchart TD
  Q["Three adapters, one contract,<br/>no shared implementation"]
  Q --> A["A · Leave it<br/>(status quo)"]
  Q --> B["B · Shared kit + conformance check<br/>(proposed)"]
  Q --> C["C · One implementation,<br/>vendor adapters underneath"]

  A --> A1["cost: drift keeps landing<br/>silently — §3 is one instance"]
  A --> A2["gain: zero churn"]

  B --> B1["cost: ~500-line kit; net LOC flat;<br/>claude-code migration is the risky part"]
  B --> B2["gain: one place to fix emit;<br/>a 4th harness starts from a floor;<br/>drift becomes a red test"]

  C --> C1["cost: forces a lowest common<br/>denominator over three wires<br/>that genuinely differ"]
  C --> C2["gain: one call site —<br/>but the vendor layers return<br/>as conditionals inside it"]

  style B fill:#2d5016,color:#fff
  style C fill:#5c1a1a,color:#fff
```

**C is the trap.** `cost.ts` is the proof: the two estimators differ because
Codex's `input_tokens` includes cached tokens and Cursor's does not. A unified
cost function would have to carry that as a flag, which is the vendor layer
back again — but now in shared code, where getting it wrong is wrong
everywhere.

---

## 3. The evidence that the status quo costs something

### 3.1 A fix landed in one copy only (measured, then fixed — §6)

`cursor/src/emit.ts` settles a tool item with the index its `item.added`
carried. `claude-code` and `codex` re-read `ctx.response.getItemCount()` on the
settle — which, because the count does not grow when an existing item is
closed, returns the index the *next* item is about to take. Two items end up
sharing one index.

Measured over `message → tool_call → tool_result → message`:

| Emitter | item indices | collides |
|---|---|---|
| claude-code | `message#0, tool_output#2, message#2` | **yes** |
| codex | `message#0, tool_output#2, message#2` | **yes** |
| cursor | `message#0, tool_output#1, message#2` | no |

`itemIndex` orders a request's items, and core's replay picks among same-id
traces by the highest one (`core/src/blocks/internal/replay-log.ts`). Two items
sharing an index make that order a guess.

Cursor's code carries a comment explaining exactly this. The fix never reached
its two siblings, because nothing connects them.

### 3.2 Feature coverage has diverged

| Capability | claude-code | codex | cursor |
|---|---|---|---|
| Usage reader (`readXUsage`) | ✅ | ✅ | ❌ |
| Env fencing | `harnessEnv` | `harnessEnv` | own `child-runtime.ts` |
| Cost | SDK-reported | estimated | estimated |
| Vendor-only extras | MCP relay, workspace, work recorder | — | plan recording |

Even the **scripted** harnesses in Kitchen Sink have drifted: `[new]` exists for
claude-code and codex but not cursor; `[slow-start]` for claude-code and codex
but not cursor; `[errored]` for claude-code and cursor but not codex.

### 3.3 Features get built three times

Since September, stripping release and repo-wide mechanical commits:

- `FIX-1952` — model-per-harness, landed across all 3
- `3841e8d2e` — *"characterize item task scope in all three emitters"*, a test commit that exists **only** because there are three emitters
- `FIX-1716` — `harnessEnv({ pass })` allowlist, 2 of 3
- `FIX-2142` — usage left, 2 of 3

---

## 4. The plan

Each phase has a **Kitchen Sink–visible proof**, because Kitchen Sink is the
only place all three harnesses run the same flow. That is the point of putting
the check there rather than in a package: a rule stated once, held against
every harness, and extended by adding a row when a fourth arrives.

### Phase 0 — the parity check (**done, §6**)

`apps/kitchen-sink/test/harness-parity.test.ts`: one table over the three
modes, each driven through its real session flow with its scripted SDK behind
it. Four rules, asserted identically for all three.

> **Proof in Kitchen Sink:** 12 tests across `/claude-code`, `/codex`,
> `/cursor`. Reverting the codex fix turns exactly one of them red.

This is the highest-value piece and it required no shared code. If the roadmap
adds no fourth harness, **phase 0 alone is a defensible stopping point.**

### Phase 1 — `@flow-state-dev/harness-kit`, built from codex + cursor

The two genuinely sibling-shaped adapters. The kit holds:

- emit protocol: `buildBase`, `deriveProvenance`, `EmitState` core, tool
  open/settle, error item, `finalizeOpenItems` — the index rule lands once
- error-class factory parameterised by vendor name / package / strings
- `createHarnessAgentCapability` + `promotedResources`
- spine helpers: `assertNoOwnedKeys`, `abortRace`, preflight, handle assembly
- cost: the `findModelEntry`-then-estimate **guard** only; each vendor keeps
  its own token mapping

> **Proof in Kitchen Sink:** the parity suite stays green while codex and
> cursor lose ~400–500 code lines each, and `/codex` and `/cursor` render
> identically to before.

### Phase 2 — the kit exports the conformance suite

Phase 0's rules move into the kit as a suite each package runs over its own
emitter, so a harness is held to them *before* it reaches Kitchen Sink. The
Kitchen Sink table stays as the end-to-end half — it is the one that runs the
real flow, the worktree and the session.

Today's `harness-conformance.test-d.ts` files (36/40/52 lines) are type-level
only; core's own comment calls that *"the cheap half."*

> **Proof in Kitchen Sink:** add a fourth row to the parity table for a
> scripted-only harness and it passes with no new assertions written.

### Phase 3 — claude-code adopts, emit + errors only

It is the oldest and most divergent (`itemFields` vs `buildBase`, 3,142 code
lines, plus workspace / work-recorder / MCP relay that have no sibling).
Forcing it fully onto the kit is where the risk and cost concentrate, for the
least return.

> **Proof in Kitchen Sink:** `/claude-code` renders identically, and the
> `[bash]`, `[plan]` and subagent paths stay green.

### Sizing, honestly

~400–600 lines removed per clone, ~500-line kit added. **Net LOC is roughly
flat — do not justify this on LOC.** Justify it on: one place to fix emit bugs,
a check that proves the family, and a fourth harness starting from a floor
rather than a copy-paste. (`FIX-1905` BR-24 already names "the scripted coder"
alongside Cursor and Codex, so a fourth is in view.)

---

## 5. What this plan deliberately does *not* do

- **Not** one implementation with vendor adapters (§2, option C).
- **Not** a shared `translate.ts`. There is nothing in common to share.
- **Not** a unified cost function. The vendor usage semantics genuinely differ.
- **Not** a forced claude-code migration. Opportunistic, emit + errors only.
- **Not** a dedup of the three doc pages (865/308/386). They describe different
  products to different readers; the duplication there is mostly prose about
  genuinely different behaviour.

---

## 6. What landed with phase 0

The parity check is `apps/kitchen-sink/test/harness-parity.test.ts`. The index fix is in `packages/codex/src/emit.ts` and `packages/claude-code/src/sdk/emit.ts` (§3.1).

Kitchen Sink no longer sandboxes a harness run (owner's call, 2026-10-26). `lib/harness-sandbox.ts` is gone. The per-session worktree, the env allowlists, and `settingSources: []` stay. Preflight no longer asks about sandboxes, so a later kit absorbs less per-mode code than §2 measured. The shape is the same. `@flow-state-dev/tools/bash`'s `Sandbox` runs commands the framework dispatches. A harness runs its own tools, so that sandbox was never this job.

Three macOS-only specs were wrong on a Mac and green on `ubuntu-latest`: `__CF_USER_TEXT_ENCODING` in the Cursor and Claude Code env fences, `realpath` of the workspace scratch dir, and a 60s budget on the hostile-ids worktree case. The comments on those lines say why.

`apps/kitchen-sink/test/codex-real-cli.test.ts` was not run here. It binds `127.0.0.1` and starts the real `codex` program.
