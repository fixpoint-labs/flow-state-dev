# FIX-2396 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · The summary is read in the lab's adapter, not the UI registry

| | Lab adapter (chosen) | Registry `tool-naming.ts` |
|---|---|---|
| Who uses it now | Teammates' popup only | Teammates; Claude Code-style later |
| Change size | one lab | a registry file and every copy of it across the labs and Shift Manager |
| Risk | a second copy if another app wants it | none beyond size |

- **Because:** the issue places the popup in the lab, and only one app reads it today. Moving a
  helper later is cheap; changing a registry file now touches four copies for one reader.
- **If wrong:** when a second app asks, `runSummary` and the paths read move to
  `tool-naming.ts` and the lab imports them; the tests move with them.

<a name="d2"></a>
## D2 · Duration shows once the task ended, from the row's own times

| | End minus start, ended only (chosen) | A live clock while it runs |
|---|---|---|
| Source | `startedAt`/`completedAt` the board wrote | the same plus a ticking timer |
| Re-renders | none | one a second per open popup |
| Wrong value risk | spans retries (noted in the spec) | the same, plus clock skew between browser and server |

- **Because:** the issue asks for how long the work took, which is a finished task's question.
  The popup already shows a running task's steps live.
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
- **The button names the filer** (`Ask Chief of Staff to follow up`), read from the popup's
  conversation; a popup whose conversation isn't on the roster shows no button.

## Decided, not asked

- **E1 · Files counted, not edits.** Distinct paths from completed file-changing steps
  (`Edit`, `Write`, `MultiEdit`, `NotebookEdit`, `edit`, `write`, `create_file`, `delete`,
  `file_change` and their `_file` forms, case-folded). A failed or still-running edit isn't one.
- **E2 · Commands counted** from shell steps that ran (done or failed), not ones still running.
- **E3 · Chips show the file's name**, the full path as their title; past eight, a `+N more` chip.
- **E4 · Copy copies the result, else the error.** A task with neither shows no Copy.
- **E5 · Status tone applies to every task popup**, coding or not: a green failed result is wrong
  everywhere. The summary line is for coding tasks, whose runs report tool steps.
- **E6 · Follow up and Copy show once the task ended** (done, failed or cancelled).
- **E7 · No changeset:** the Teammates lab is private.
