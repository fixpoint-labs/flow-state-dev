# FIX-1662 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

The cases, written as rules. The epic's rules (ER-n, [FIX-1649](../../epics/FIX-1649/BUSINESS-RULES.md))
apply as written; these are the ones this issue adds. *Proved by* names the kind of check the plan runs.

## Opening a Lab

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | App Lab is started with a Lab's config | It serves that config's `FlowState` and its own pages from one process; the Lab's config is not edited or wrapped | CI · goal check |
| BR-2 | The config does not load, or its default export is not a `FlowState` | App Lab refuses to start and prints the loader's own message | CI |
| BR-3 | The Lab's server refuses a request for want of a verified organization | App Lab shows a screen that says so. No sidebar read is made | CI · goal check |
| BR-4 | The Lab booted without opening its inventory | TEAMS and PROJECTS show their failed-read state, naming the missing inventory, with Retry. Other sections still render | CI |
| BR-5 | A second tree is opened | Nothing in App Lab changes. No seat, channel, board, team or kind name appears in App Lab's source | Static check · goal check under `static-names` |

## The sidebar

| # | When | Then | Proved by |
|---|---|---|---|
| BR-6 | The sidebar renders | In order: org switcher, Jump to, Inbox with its count, Tasks with its count, PROJECTS, TEAMS, footer with sessions live and the user | Goal check |
| BR-7 | TEAMS renders | One entry per team in the seat inventory, each listing exactly its seats with their kind; the seat's harness shows only from a shipped read, otherwise a dash with the owner named (FIX-1652) | Goal check, against the store |
| BR-8 | A worker's status is drawn | *working* if it holds a running row on an attached board, *waiting on you* if it holds a parked row, *idle* otherwise | CI |
| BR-9 | No projects ship (FIX-1650) | PROJECTS lists the workstreams directly; the project level is reachable and each of its tabs shows its named empty state | Goal check |
| BR-10 | Jump to is opened | It finds workstreams, workers, tasks and the tree's declared resources by name; choosing a resource opens it read-only in the centre | CI · goal check |
| BR-11 | One sidebar read fails | That section shows Retry; the others render | CI |

## Boards and tasks

| # | When | Then | Proved by |
|---|---|---|---|
| BR-12 | A board row is placed in the design's columns | pending → QUEUED · in_progress → RUNNING · parked or errored → NEEDS YOU · completed or cancelled → DONE · blocked → QUEUED, tagged *blocked*. The status word is on the card. IN REVIEW is drawn empty with its owner named | CI, every status |
| BR-13 | A workstream's Board tab opens | Exactly the rows of the boards its channel attaches, by id | Goal check, against the store |
| BR-14 | A workstream's channel attaches no board | The Board tab says so, and the workstream's tasks in the right panel say the same | CI · goal check on DevForce |
| BR-15 | Tasks opens | Every row on every attached board, excluding done ones; the summary counts equal the rows; group by State draws; Worker and Stream use the same rows under the other key; the Queued toggle hides pending rows | Goal check |
| BR-16 | A Tasks column has no shipped read | NOW and IN REVIEW say what arrives with FIX-1651; TIME and COST come from the row's session and runs where shipped, otherwise a dash | CI |
| BR-17 | A row or board card is chosen | The task route opens with the right panel's task slot. Until FIX-1664 fills it, the frame shows its named empty state | Goal check |

## Workstreams and posting

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | A workstream's Stream opens | The channel's transcript, one live stream for that session, older lines paged in; lines render with the shipped item and registry components | Goal check |
| BR-19 | A person posts without `@` | The line goes through the channel's own post action; the stream shows it only once the transcript holds it | Goal check under `optimistic-post` |
| BR-20 | A post fails | The draft stays in the composer with the error; nothing is drawn as sent | CI |
| BR-21 | A person addresses `@worker` | Sent through FIX-1664's named session write; until it merges, the send is disabled and says so | CI |
| BR-22 | Brief and Results open | Brief is the channel's charter (`CHANNEL.md` body); Results is a named empty state (FIX-1651) | Goal check |
| BR-23 | The workstream's right panel renders | Progress is a named empty state until FIX-1651; Team is the channel's members from the inventory with BR-8's status; Tasks are its rows grouped by BR-12's columns | Goal check |

## Inbox

| # | When | Then | Proved by |
|---|---|---|---|
| BR-24 | Inbox opens | Every pending approval and question in the org's seat sessions, oldest first, with kind, task where known, workstream and wait; All, Approvals and Questions each count exactly theirs | Goal check |
| BR-25 | An ask is selected | The detail pane uses the same renderer as the stream's card for that ask. Approve and Deny resolve it through the session's shipped resume | CI |
| BR-26 | An ask is answered anywhere | It leaves Inbox and its stream card together, because both read the one session | Goal check |
| BR-27 | A parked row carries a reason but no suspension | It is listed as a question; reply is disabled and names FIX-1652, since no shared answer operation ships | CI |
| BR-28 | Inbox or Tasks has nothing | A named empty state in a sentence | CI |

## Failure taxonomy

Nothing a Lab serves is fatal to the whole screen except a config that won't load (BR-2) and a
missing organization (BR-3). Every other failed read degrades its own section to Retry. Nothing
retries on its own, and nothing is drawn from a guess.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met), on both trees, and its two controls
failing where named. ER-1 for every surface but the task level's content; ER-4's load path; ER-5
for every empty state here; ER-6 and ER-15 as consumers.
