# FIX-2385 · What a run recorded, read from one package entry

**Spec** · [Decisions](DECISIONS.md)

## Who feels it, before and after

| Someone who… | Today | After |
|---|---|---|
| **opens a coding task in Shift Manager** and looks at its plan, files and pull requests | Shown, read by Shift Manager's own `readRecordedWork` | Shown the same way, read by the package's reader. Nothing on screen changes |
| **builds the Claude Code-style lab's or Teammates' "Edited 3 files" summary** (FIX-2384, FIX-2396) | Has to copy Shift Manager's reader or re-parse the run's steps, which ER-3 forbids | Imports `readRecordedWork` from `@flow-state-dev/harness-manager/browser` |
| **adds a run's branch, base and checkout path** (FIX-2386) | No browser entry to add it to | Adds a nullable section to the same reader |
| **bundles the harness manager's root into a browser page** | Fails to compile: the root reaches Node built-ins through `@flow-state-dev/workspace` | Still does. The browser entry is the one to import, and a test keeps it free of Node built-ins |

## The goal, and how we'll know it's met

**One browser-safe reader, owned by `@flow-state-dev/harness-manager`, returns what a coding run
recorded, and Shift Manager uses it instead of its own copy.**

- **Smaller, and rejected:** export the reader from Shift Manager. Labs import no code from an
  app, and the epic's ER-4 names this entry as the artifact the other children consume.
- **Bigger, and not this issue's:** the labs' files-touched summaries (FIX-2384, FIX-2396), and a
  run's branch, commits and review outcome (FIX-2386). Those live in the user-scoped run record,
  which is not client-readable on purpose, so opening it is FIX-2386's decision.
- **Not done if:** Shift Manager still defines a reader of its own, or the entry reaches a Node
  built-in.

**How we verify.**

- **Browser safety:** `packages/harness-manager/test/browser-subpath-safe.spec.ts` walks the
  entry's import graph through workspace packages and fails on any Node built-in, the way
  Workforce's guard does. It also proves the walk sees the root's built-ins.
  **Control that must fail:** re-exporting `harnessManager` from the entry fails it (run).
- **Only this run's rows:** `packages/harness-manager/test/recorded-work.spec.ts` keeps an
  earlier request's plan, files and pull requests in the same session and asserts none come back;
  a missing collection reads `null`, a full page reads `truncated`, a failed read throws the
  client's own error. **Control that must fail:** reading the collection without the request
  prefix fails the first case (run).
- **The real route:** Shift Manager's `test/run.test.ts` "what the run recorded" case, against a
  running Lab, now imports from the package and passes unchanged.

## What changes

- **New entry** `@flow-state-dev/harness-manager/browser`, exporting `readRecordedWork` and its
  row types. The reader moves from `packages/shift-manager/src/lib/run.ts` as it is, with two
  edits ([D1](DECISIONS.md#d1), [D2](DECISIONS.md#d2)).
- **Shift Manager** deletes its copy in the same change (ER-3) and imports the package's.
- **Harness manager** gains `@flow-state-dev/client` as a dependency, for types only.
- **Docs:** the harness-manager README names the entry and what it reads.

## What stays as it is

What the reader returns, row for row. The recording side (`@flow-state-dev/claude-code`'s
recorder and core's plan and pull-request keys). Shift Manager's task screen and its error copy.
The package root's exports.

## What's already here, and the debt

| Piece | What this does with it |
|---|---|
| Shift Manager's `readRecordedWork` (`lib/run.ts`) | **Moved**, then deleted from the app |
| Core's `OBSERVED_PLAN`, `OBSERVED_PULL_REQUESTS`, `readPlanTarget`, `planRowsPrefix` | **Reused** as the app used them |
| `@flow-state-dev/workforce/browser` and its browser-safety guard | **Copied in shape**: same reason for an entry, same walk from `@flow-state-dev/testing` |
| `ResourcesApi` (client) | **Reused** as a `Pick`, as the client's own `read-every-page` does |
| The run record (`runs/**`), not client-readable | **Untouched.** FIX-2386 decides how a browser reads branch and commits |

**Adds:** one subpath, one dependency (`@flow-state-dev/client`, types only), one dev
dependency (`@flow-state-dev/testing`, for the guard). **Removes:** the app's copy. **Debt:** the file-ops key
`observed-file-ops` is still spelled in two packages, Claude Code's recorder and this reader, as
it was in Shift Manager ([D3](DECISIONS.md#d3)). **Net:** smaller; one reader where there was an
app-private one.

## Sign off

**Approve by merging.** The one call is **errors pass through** ([D2](DECISIONS.md#d2)): the
package throws the client's error and each app words it. *If wrong:* a wrapper type is added later
without changing any caller's success path.

Feature · `harness-manager`, `shift-manager` · small · 1 PR · heads the stack FIX-2385 → 2386 →
2419 → 2388 in epic FIX-2369
