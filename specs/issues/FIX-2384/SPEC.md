# FIX-2384 · What a coding run changed: its files, lines and per-file patch

**Spec** · [Decisions](DECISIONS.md)

Someone reviewing a coding run in the workforce apps accepts its changes without seeing them. The
Claude Code-style lab shows a commit count and subjects, Teammates shows the result text, and Shift
Manager's Diff tab is a placeholder. No package reads a diff, so each app would need its own git
code to show one. This slice gives them one package read for the files and lines a run's commits
changed, and for one file's patch.

The package slice of a wave-1 child of [FIX-2369](../../epics/FIX-2369/SPEC.md). The epic spec
(#4358) fixed its direction ("`readRunDiff`, read action — extend `commits.ts`"); this records the
shape that was built. The apps adopt it in their own stacks (build order:
[FIX-2369 DECISIONS → Coordination seams](../../epics/FIX-2369/DECISIONS.md#coordination-seams)).

## Who feels it, before and after

| Someone who… | Today | After this slice | After the app stacks |
|---|---|---|---|
| **reviews a run in the Claude Code-style lab** | Sees a commit count, the branch and subjects | The review stop's data carries each changed file and its lines | The ReviewCard shows "N files changed (+a −d)" and opens a file's patch |
| **opens a finished task in Teammates** | Sees the result text and steps | The task's session answers a `changes` read | TaskPopup shows the same view |
| **opens a task's Diff tab in Shift Manager** | A placeholder (`gaps.ts`) | As Teammates | The Diff tab is that view |
| **works a Kitchen Sink coding session** | Sees the plan and PRs | Each turn records where its changes start and end, and the flow answers a per-turn `changes` read | A Changes section per turn |

## The goal, and how we'll know it's met

**Every app on harness-manager can show what a run's commits changed, file by file, from one
package read, without its own git code.**

- **Not done if:** a review's files include changes the base made after the branch was cut, or
  uncommitted work; a turn's read includes a later turn's commits; a session can read another
  session's run; an opened patch lands in a request record or a session log.

**How we verify** (no model, in process, real git and a real engine):

- `test/run-diff.spec.ts`: numstat per file and totals, binary files, the base rule against a base
  that moved on and against uncommitted work, an end commit, the file cap, the patch cap, a glob
  path read literally, an unreadable base.
- `test/review-changes.spec.ts`: the review stop's data carries `files` and the totals, the prompt
  names them, and the `changes` read answers the files and one file's patch through the engine's
  read route; refusals for a session with no task and a task from another session.
- `test/session-flow.spec.ts`: two turns, each read sees only its own file; a turn's base is the
  previous turn's head; a session with no git checkout reads unverified.
- `packages/ui/test/render/run-changes.test.tsx`: the summary, the list, a patch read once on
  first open, truncation and failure lines, nothing drawn when unread.
- **Controls produced red** (each reverted after): no literal pathspec (the glob test fails);
  diff from the base itself rather than the merge base (the moved-base test fails); no turn
  `head` (turn 1 reads turn 2's file); the read takes any task id (another session's task reads
  200); no `files` on the review data.
- No goal check here: the user-facing proof is each app adopting it, and those children carry
  their lab checks (ER-6).

## What changes

- **`packages/harness-manager/src/commits.ts`** gains `readRunDiff` and `readRunFilePatch` beside
  `readRunCommits`, on one base rule (`resolveBases`, lifted from `readRunCommits`), and
  `readRunChanges`, which picks one of the two. Schemas `runDiffSchema`, `runFilePatchSchema`,
  `runChangesSchema`; caps `MAX_DIFF_FILES` (200 listed; totals count all) and
  `MAX_PATCH_CHARS` (64,000).
- **`manager.ts`**: with `reviewChanges`, `decide` reads the diff once, beside the commits, onto
  `decided.diff` (`.nullable().default(null)`, BP-030). The review prompt adds "N files changed
  (+a −d)."; the stop's `data` adds `files`, `fileCount`, `added`, `removed`.
- **`run-changes.ts`** (new): `harnessRunChangesRead({ board, uses })`, a flow **read** for a
  board run, found from the run's session as the session door finds it (`sessionRow`, now
  exported from `session-door.ts` inside the package).
- **`session-flow.ts`**: each turn record gains `base` (recorded by the `cwd` feed when the turn
  first reaches its checkout) and `head` (recorded at turn end, before the PR check, now one
  `turn-end` sequencer). The flow declares `reads: { changes }` keyed by turn.
- **`packages/ui`**: registry item `run-changes` ("N files changed (+a −d)", per-file rows, a
  patch on open through the app's `loadPatch`). Appended to `registry.json`; README row.
- **Docs**: harness-manager README and `apps/docs/docs/orchestration/harness-manager.md`.
- **One app file**: `apps/kitchen-sink/test/harness-turn.test.ts` adds `base: null, head: null`
  to a typed turn-record literal, which the new fields require. No app behaviour changes.

Not here: the `./browser` entry exports (FIX-2385 owns the entry; this slice adds to it after
that merges, per ER-4), and every app's adoption.
