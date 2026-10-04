# FIX-1777 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

## The post door

| | When | Then | Proved by |
|---|---|---|---|
| BR-1 | A line shaped `<slug>: <what>` lands on `eng.feature` and files a new row | The board runs in the same delivery and hands the row to `eng.coder`; the row settles without anyone else running the board | Goal leg 6 |
| BR-2 | The slug already has a row | Nothing filed, the board is not run, and another row left *pending* stays *pending* | Goal leg 7 |
| BR-3 | The line doesn't name a feature | Nothing filed, nothing run | Goal leg 8 |
| BR-4 | A person posts the line, or the chief of staff posts it in a person's session | The same as BR-1. The run belongs to that person, as an Approve's does | Goal leg 6 (the lab's person posts) |
| BR-5 | The poster has other rows of their own waiting on the board when a new row is filed | The board run starts those too, as Approve's board run does today. Another member's waiting rows are refused before claim and keep their status ([FIX-1667 D3](../FIX-1667/DECISIONS.md#d3)) | Existing: `packages/harness-manager/test/run-owner-dispatcher.spec.ts` |
| BR-6 | The board is already running when the post's board run starts (another delivery, an Approve, a host's `drain`) | One run per row: a claimed row is not claimed twice | Existing: `packages/orchestration/test/task-board/task-board-concurrent-drains.test.ts`; the sibling `it-ships-an-artifact-a-person-can-open` still drains from outside and must stay green |

## Failures

| | When | Then | Proved by |
|---|---|---|---|
| BR-7 | The row's attempt fails | The row goes back to *pending* with its reason, or *errored* once its attempts are spent, and waits for the next board run, as on every door today | Unchanged; existing controls in `it-ships-an-artifact-a-person-can-open` |
| BR-8 | The board run itself throws (a refused hand-off, a missing harness) | The row stays *pending*, and the failure shows on the EM's post request, as any failed delivery's does. A repeat post does not retry it (BR-2); the next board run does | Lab test or goal note at implement time |
| BR-9 | The control `file-only` is set | The post door files exactly as today and runs nothing. Off by default, and nothing else changes | Goal control |

## Unchanged doors

| | When | Then | Proved by |
|---|---|---|---|
| BR-10 | The EM's Inbox ask is approved or denied | Approve files and runs; Deny files nothing | `goals/devforce-lab/it-waits-for-a-person-before-it-files` |
| BR-11 | A host calls `file` directly | Files only, runs nothing | `goals/devforce-lab/it-wakes-the-seat-a-file-declared` |
| BR-12 | A line is posted in a project's room | Answered into the room, files nothing | `goals/shift-manager/a-lab-is-worked-through-one-skinned-shell`, unchanged |

## What this issue owns

- The feature workstream's post door starting the run it files (BR-1 to BR-9).
- Not owned: the chief of staff posting coding work ([FIX-1774](https://linear.app/fixpoint-labs/issue/FIX-1774));
  failed attempts retrying on their own ([follow-ups](PLAN.md#follow-ups)). Workforce's `fileTask`
  starting a board's worker is open ([O1](DECISIONS.md#o1)).

## Acceptance

- A shaped post on `eng.feature` ends as a completed row with no outside board run (BR-1).
- A repeat or an unshaped line starts nothing (BR-2, BR-3).
- The four existing DevTeam checks still pass (BR-6, BR-10, BR-11).
