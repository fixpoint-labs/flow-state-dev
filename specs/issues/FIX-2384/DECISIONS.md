# FIX-2384 · Decisions

[Spec](SPEC.md) · **Decisions**

Engineering calls inside the direction FIX-2369 fixed. None is asked.

<a name="d1"></a>
## D1 · A read, not an action

| | |
|---|---|
| **Instead of** | An action that returns the patch (the issue's wording, "a read action") |
| **Because** | An action's return is recorded on its trace and streamed (BP-042); a patch is data for a person. A flow read (FIX-2286) is answered in the response and stored nowhere, refuses writes, and takes no concurrency slot, so it runs beside a turn in flight |
| **Locks in** | Apps call `POST /api/flows/:flow/:sessionId/reads/changes`. The session flow's read and the board read share one output shape, one of two cases: `{ diff, patch: null }` without a `path`, or `{ diff: null, patch }` with one ([D3](#d3)). The board read adds `taskId` |

<a name="d2"></a>
## D2 · The branch's commits, from where it last met the base

| | |
|---|---|
| **Instead of** | Diffing the working tree, or diffing from the base commit itself |
| **Because** | A review accepts the branch, so uncommitted work is not what it accepts. The start is the merge base of `HEAD` and the base copies `readRunCommits` uses (the recorded cut commit when there is one), so a base that moved on adds nothing, matching the commit count |
| **Locks in** | Renames read as a removal and an addition (`--no-renames`), so a path is always one path |

<a name="d3"></a>
## D3 · One read answers the files or one file's patch, not both

| | |
|---|---|
| **Instead of** | Two reads, or a patch with every diff |
| **Because** | A screen that opens a file already has the files (the review data, or the first read). One read keeps one input shape for both hosts; returning both would re-run the numstat on every open |

<a name="d4"></a>
## D4 · A turn's base is recorded where it reaches its checkout

| | |
|---|---|
| **Instead of** | A step before the harness that provisions the checkout itself |
| **Because** | The harness provisions through the `cwd` feed; recording there needs no second provisioning call and no change to when provisioning happens (FIX-2420 owns the first-turn setup wait in this region). The end is recorded by `recordTurnHead`, the first step of the `turnEnd` sequencer that is the flow's `request.onFinished` hook, so a stopped or failed turn still has one |
| **Locks in** | A turn that never reaches a git checkout keeps `base: null`, records no `head`, and reads unverified. The turn-end step only locates the checkout when a base exists, so a host whose sessions have no checkout is never asked for one |

## Notes for the stacked children

- **FIX-2387, FIX-2398** stack on this branch in the turn-end region: `turnEnd` is now a sequencer
  (`recordTurnHead` then `branchPullRequests`). Append steps to `turnEnd`; never register a
  second `onFinished` or replace it, since a flow has one and the head must be recorded on every
  turn end.
- **App adoption** (Kitchen Sink, Claude Code-style, Teammates, Shift Manager): install
  `run-changes` with `fsdev ui add run-changes`, pass the review data's `files`, and wire
  `loadPatch` to the `changes` read on the run's session (board runs) or with `{ turn }` (session
  turns). Declare `harnessRunChangesRead({ board, uses })` on the coding flow with the same board
  resolver as its door.
