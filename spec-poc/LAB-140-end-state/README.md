# LAB-140 end-state POC — does the division across LAB-152 / 153 / 154 hold once assembled?

**Throwaway. Never merges; lives on `epic/harness-manager` and closes with #1362. Not for
code review.** Rough by design and deliberately not per-issue-clean.

The three specs are each sound on their own. This sketches what exists once all three have
landed — the neutral contract, two harness blocks over it, the manager with its `harness` slot
feeding three, and the composition that puts both harnesses under one manager package on one
board — and drives it, so the seams between issues are visible before anyone builds against
them.

```
pnpm tsx spec-poc/LAB-140-end-state/run.ts                 # the transcript below
pnpm tsc -p spec-poc/LAB-140-end-state/tsconfig.json       # the conformance-alias question
```

| file | which issue's surface | what it sketches |
|---|---|---|
| `contract.ts` | LAB-152 | neutral input + handle schemas; two spellings of the `HarnessBlock` alias; the feed signatures **no spec puts anywhere shared** |
| `claude-harness.ts` | LAB-152 + LAB-154 PR a | `claudeCodeAgent` thinned to the seams: extended handle with the `costUsd` dual, `resume`/`onSession` on the background path only |
| `codex-harness.ts` | LAB-153 | `codexAgent` in the shape its own POC proved: thread id on the first event → hook, abort races the signal, cost estimated from core's table |
| `manager.ts` | LAB-154 | the loop with the slot feeding `{ cwd, resume, onSession }`, the lease as a value on state, `decide` on the neutral fields, `source` on the row |
| `compose.ts` | LAB-141 (unspecced) | two managers — same package, different slot — under two assignees on one task board; the board's registry is the router |
| `run.ts` | — | drives A (Claude resumes), B (Codex killed by the deadline, then resumed), C (the board) |

The vendors are fakes speaking the shapes the real adapters already read (`SdkMessageLike`;
the Codex JSONL kinds LAB-153's POC exercised). The run record and lock files are in-memory.

## What it showed

1. **The lease is released while the vendor's orphaned command is still writing** (LAB-153 ×
   LAB-154). The manager releases the checkout lease on the harness step's `onSettled`;
   LAB-153's block throws the moment its signal fires; the command Codex spawned outlives the
   kill (LAB-153's own finding). Run B: 8 writes land in the checkout *after* the lease is
   released. FIX-1301 gives Claude Code the same semantics, so this is the end state for both.
   Neither spec says what the lease promises after a deadline kill. **LAB-154 owns it.**
2. **The three feeds are typed in no shared place** (LAB-152 × 153 × 154). The contract is
   input + handle. The `cwd`/`resume` resolver and the session hook are declared in LAB-153's
   package and in LAB-154's slot separately — and the hook is `onThread` in one spec and
   `onSession` in the other (`compose.ts` maps it). Structural typing lets the sketch compile;
   nothing enforces "one shape across harnesses", and the two issues land in parallel.
   **Unowned — needs a theme:** the resolver + hook types export from core beside the contract.
3. **`source` on the run row guards a case the chosen composition cannot produce** (LAB-154 ×
   LAB-141). With the board's assignee registry as the router, a detached board fixes
   `assignee` at admission, so a row never changes harness between attempts. LAB-154 records
   `source` for a check only the other composition (routing inside one manager by a mutable
   task field) needs. **LAB-141's pick decides; LAB-154 keeps one nullable column either way.**
4. **The conformance alias has to be `TaskWorker`-shaped.** `BlockDefinition<any, any,
   HarnessRunInput, HarnessRunHandle>` accepts both extended handles; the schema-typed
   spelling rejects every real harness (`run.ts`, the `@ts-expect-error`). LAB-152's
   implementer, below the bar.

Held with no change: the neutral handle carries both harnesses' results through one `decide`;
`costUsd` is read by nothing once the manager reads `cost`; an estimated cost reaches the row
with its basis; the hook writes the id before a throw can lose it, so a deadline-killed Codex
run is resumed by attempt 2; two managers from one package on one board is the whole
composition, no router of ours.

## Not covered

The ask/park path and the inbox; git worktree provisioning (the lock is a map); the real SDKs;
`PhaseSpec.readable` → `uses`; multi-tenant identity; the Claude adapter's forward-and-wait
abort (FIX-1301).
