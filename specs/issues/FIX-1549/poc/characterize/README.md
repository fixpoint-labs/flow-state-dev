# POC · what the roster fence costs an app without Workforce

Characterization of today's `main` for FIX-1549. Retained spec evidence, not production code:
nothing imports it, it has no package manifest, and it is outside default build, test, lint
and knip discovery. `run.sh` copies the test into `packages/engine/test` for one run and
removes it.

## How to run it

```bash
pnpm install                                   # once per checkout
pnpm --filter @flow-state-dev/core build       # engine resolves core's build
bash specs/issues/FIX-1549/poc/characterize/run.sh
```

## What it checks

Twelve patterns go through `defineResourceCollection` and through `FlowRegistry.register` on a
flow whose resources bypass definition. Nothing imports `@flow-state-dev/workforce` and no flow
carries the branded private writer, so the app has no Workforce at all. A refusal counts only
when its message names the roster; any other refusal would show as `other`, and none does.

**Totality:** the table is the whole corpus the spec argues from, and every row asserts both
verdicts, so a change on either path turns it red. **Negative control:** flipping one row
(`files/**` register `ok` → `refused`) was run and failed 1 of 14, then reverted.

## What was observed

On `55c9581`: **14 passed.**

| Pattern | define | register |
|---|---|---|
| `workforce/roster/[owner]/notes` | refused | refused |
| `workforce/roster/**` | refused | refused |
| `workforce/**` | refused | refused |
| `workforce/roster/[owner]/[seat]` | ok | refused |
| `**` | refused | refused |
| `[tenant]/**` | ok | refused |
| `[a]/[b]/[c]/[d]` | ok | refused |
| `*/**` | ok | refused |
| `workforce/roster/*` | ok | ok |
| `files/**` | ok | ok |
| `[tenant]/notes/[id]` | ok | ok |
| `[a]/[b]/[c]` | ok | ok |

Eight of twelve are refused in an app that never installed Workforce. Four of them name nothing
Workforce. Every pattern refused at definition is also refused at registration, which is why
removing the define-time check loses nothing (PLAN V4 replays this corpus in an armed registry).
