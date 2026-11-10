# FIX-2396 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · Files come from the package's recorded-work reader, not the run's steps

| | `readRecordedWork` (chosen) | Re-parse tool args from the steps |
|---|---|---|
| Owner of "which files a run touched" | `harness-manager`, one reader for every app (FIX-2385) | a second parser in the lab, beside `toolSubject` |
| Harnesses covered today | Claude Code only; Codex and Cursor record none yet | all three, by tool name |
| Drift when a harness changes its tool shapes | none here: the recorder changes | this lab's allowlist goes stale |

- **Because:** FIX-2385 moved the reader into the package so the labs' "Edited N files"
  summaries (this issue and FIX-2384) would not re-parse steps; the epic's ER-3 keeps a need in
  the package. A first draft of this spec chose the step parse; review pointed at FIX-2385, and
  it was reversed.
- **Cost:** a Codex or Cursor task's line has no file part until those packages record file
  touches. The line omits it rather than say 0. Follow-up: FIX-2555.
- **If wrong:** if the gap matters before the follow-up lands, the fix is in those packages'
  recorders, not a parse here.

<a name="d2"></a>
## D2 · Duration shows once the task ended, timed from this attempt

| | End minus start, ended only (chosen) | A live clock while it runs |
|---|---|---|
| Source | the run link's `startedAt` (the row's `run`, which FIX-2394's adapters keep on `BoardTask`) to the task's `completedAt` (FIX-2395) | the same plus a ticking timer |
| Re-renders | none | one a second per open popup |
| Wrong value risk | none from retries: an attempt's own start | clock skew between browser and server |

- **Because:** the issue asks for how long the work took, which is a finished task's question.
  The popup already shows a running task's steps live. The start is the attempt's, not the
  task's first `startedAt` (which the board keeps across a retry), so the popup agrees with
  the row's `working · 10s` after a retry, as FIX-2394's clock does.
- **If wrong:** a running task's line adds `running 1m 12s` from `startedAt`; nothing here is
  thrown away.

<a name="d3"></a>
## D3 · Follow up prefills the conversation that filed the task, and doesn't send

| | Prefill, you send (chosen) | Send a follow-up message at once |
|---|---|---|
| What you control | the words, before anything runs | nothing until it has run |
| Cost of a stray click | a line in a box | a turn, and its spend |

- **Because:** the issue says "pre-fills the composer". A draft already in the box is kept, with
  the follow-up line added after a blank line, so a click never loses typing.
- **The button names the filer** (`Ask Lead to follow up`), read from the popup's
  conversation; a popup whose conversation isn't on the roster shows no button.

## Decided, not asked

- **E1 · Files are the recorded rows whose edit landed**, one per path as the recorder keys
  them; a truncated read says `200+ files`. A path whose every attempt failed was tried, not
  edited, so it is left out: `readRecordedWork`'s file rows gain `applied` (the recorder's
  `appliedCount`; `null` on an older row, which counts), a patch to harness-manager.
- **E2 · Commands counted** from steps whose tool the registry calls running a command, done or failed, not ones
  still running.
- **E3 · Chips show the file's name**, the full path as their title; past eight, a `+N more` chip.
- **E4 · Copy copies the result, else the error.** A task with neither shows no Copy.
- **E5 · Status tone applies to every task popup**, coding or not, read from FIX-2395's
  `lib/task-presentation.ts` (`taskPresentation`): the popup doesn't become another place that colours status. The summary
  line is for coding tasks.
- **E6 · Follow up and Copy show once the task ended** (done, failed or cancelled).
- **E7 · No changeset:** the Teammates lab is private.
