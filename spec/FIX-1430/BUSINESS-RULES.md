# FIX-1430 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

The cases as rules: what someone does, what happens, and which check proves it. A human reviews this page; the plan turns it into work. *Contract gate* is the model-free check; *goal check* is the model-backed run of the same host.

## Declaring the team

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | The lab's tree is read and hired | Exactly four seats — one coordinator, three workers — on the kinds their own files name, one channel, and one ledger minted from the channel at `org` scope. No id is written in any file | Contract gate |
| BR-2 | The coordinator's kind composes the channel-board capability | The coordinator holds all eight task tools and can file and assign — and **still holds them when its own file declares `tools: []`**, because they arrive as capability controls the fence never touches ([FIX-1385 BR-17](https://github.com/fixpoint-labs/flow-state-dev/pull/1917)). A twin kind that composes nothing hires just as cleanly and holds none of them: there is no tool to call and the ledger is never written. This is the lab pinning **which door it files through** — if the eight ever reached the coordinator as catalog tools instead, the `tools: []` arm goes red, and that is the point of grading it | Contract gate · the two kinds' resolved tool sets, plus the twin's ledger unchanged |
| BR-3 | A seat's own folder holds a block that declares a board, or anything org-scoped | The whole roster is refused at hire, naming the block. The lab does not widen the seat-tool fence to get a board tool into a folder | Contract gate · refusal tree |

## Filing and assigning

| # | When | Then | Proved by |
|---|---|---|---|
| BR-4 | The coordinator files four rows across three named assignees | Each row runs on the seat that assignee addresses, and on no other. The expected assignee-to-seat association is held out **in the tree** — each worker seat's own file names the assignee it answers for — and never read from the host's map, which is the routing implementation under test. **Negative control:** re-point one assignee in the host's map at a different declared seat. The tree still says where the row should have gone, the run says where it went, and the two now disagree: the row is observed on a seat whose own file claims a different assignee, and BR-4 goes red | Goal check |
| BR-5 | A row runs | It runs in its own session, whose parent is the session that **dispatched** it. **Corrected 2026-09-19, mechanism only:** that is the **draining seat's** session, not the coordinator's — the coordinator's is where the row was *filed*, and the dispatch that mints the child happens later, at the seat. The substance is unchanged and is what is graded: its own session, a parent bound at mint, and nothing carrying the coordinator's transcript with it | Goal check · read off the session record |
| BR-6 | Two rows name the same assignee, and there is no free seat for the second | Neither row is re-routed and neither is dropped: both are observed reaching the seat their assignee names, and the second runs once that seat frees. **What the waiting row's status reads is recorded, not required** — a hand-off claims a row before its child starts and leaves it `in_progress` (`docs/architecture/dispatched-work.md` -> "The claim gate and the fence ticket"), so `pending` is not the only honest reading of a row that is waiting. Which reading each drain width produces is [D3](DECISIONS.md#d3)'s comparison, not this issue's assertion | Goal check · the status recorded per run |
| BR-7 | A row is filed naming no assignee | Refused by name where it would have run. The lab declares no default worker, so a row for nobody is loud rather than quiet | Goal check · asserted on the refusal |
| BR-8 | A row is filed **through the channel's own file action** carrying an `author` the channel's roster does not list | Refused with the channel's own `author-not-a-member` reason, in the same words a refused post gets. **It proves a label check, not authentication:** `author` is optional, caller-supplied and stored `authorVerified: false`, so the same call with **no** `author` goes straight through ([FIX-1385 BR-10](https://github.com/fixpoint-labs/flow-state-dev/pull/1917)). Filing is not members-only, and the coordinator's own door is the unchecked one — `addTask` carries no `author` at all, so nothing on it is checked ([FIX-1385 BR-20](https://github.com/fixpoint-labs/flow-state-dev/pull/1917)). Both arms are graded, or the rule reads as a gate the code does not have | Contract gate · the refusal **and** the no-author call landing, on the same action |
| BR-9 | The coordinator settles a row it never claimed | Allowed, exactly as the task tools allow it today. Recorded as observed behaviour rather than defended as a design | Contract gate |

## The queue the coordinator sees

| # | When | Then | Proved by |
|---|---|---|---|
| BR-10 | The queue is read | Four columns — queued, running, waiting on you, done — each a grouping of rows that already exist. No field is written to produce one. **Queued is the substrate's own admission predicate, not `pending` alone:** a row whose worker died — `in_progress` with a lapsed lease — is claimable, so it reads queued, because the next drain is what takes it back (`isClaimable`, `packages/orchestration/src/tasks/collection/internal.ts`). Every row lands in exactly one column; a row in none of them is a bug in the view | Contract gate · the ledger compared before and after a read, and a lapsed-lease row asserted into queued |
| BR-11 | A seat holds a live claim | It reads busy; a seat holding none reads idle. Idle is the absence of a claim, never a stamp somebody writes. **A seat whose claimed row has a lapsed lease reads idle, and that row reads queued** — nobody is on it, and the next drain really does take it back. **Corrected 2026-09-19, mechanism only:** `adoptLapsedLease` (`packages/orchestration/src/task-board/task-entry.ts`) **renews** a lapsed lease so a successor *can* adopt the row; it does not refuse the adoption, and `StaleTaskClaimError` fires only when a reclaim genuinely won or the committed span cannot be read. So *back in the queue* is graded on the stronger true claim rather than on a refusal: the next drain takes the row and runs it on the seat whose own file answers for the desk it was **filed** for | Contract gate |
| BR-12 | A row is parked or blocked | It appears under *waiting on you*, carrying the reason already on the row | Contract gate |
| BR-13 | The queue is read at any moment | The task status set has exactly the members it had before this issue | CI · asserted on the enum, not on a reading of it |

![A matrix of four queue columns against the row facts each is computed from. Queued reads the rows the claim path would admit — status pending, or in progress with a lapsed lease, which is a row whose worker died — grouped by assignee. Running reads status in progress and a live claim. Waiting on you reads status parked or blocked and the reason already on the row. Done reads the terminal statuses. A fifth strip beneath shows seat idle derived from the absence of a live claim against the seats the lab hired. A heavy fence runs under the whole matrix, labelled nothing below this line is written, with the task status enum and the row fields drawn underneath it untouched.](figures/the-view.svg)

Read down a column to see every fact it is allowed to touch. Everything below the fence is read and never written, which is the whole content of BR-10 and [ER-11](https://github.com/fixpoint-labs/flow-state-dev/pull/1905). This figure is the one picture of the columns; the rules above are their text.

## What does not move

| # | When | Then | Proved by |
|---|---|---|---|
| BR-14 | This issue's diff is inspected | It touches `goals/` and nothing else, **and nothing under `goals/devforce-lab/`** — the one subtree inside the fence this issue must also leave alone. No published package gains a file, an export or a changeset ([D1](DECISIONS.md#d1)) | CI · a check over the diff, run rather than read |
| BR-15 | `goals/devforce-lab/` is run after this lands | Byte for byte as before. Its interim board shape and its two ledger declarations are untouched | BR-14's diff gate, which rejects that subtree — a behavioural suite cannot prove a tree unchanged · its existing suite still green |
| BR-16 | Someone looks here for the nested cascade | It is not here. One hop: the channel's board, then the seat | Documented, not checked |
| BR-17 | The epic asks what a busy seat does | The lab runs at either drain width from one documented switch, with no edit to the tree and none to the checks. Running both and writing out the comparison is [ER-15](https://github.com/fixpoint-labs/flow-state-dev/pull/1905) evidence the epic calls for, and neither width is presented as the recommended setting ([D3](DECISIONS.md#d3)) | Contract gate · the switch exercised at both values · the comparison when the epic asks |

## Failure taxonomy

A malformed or forbidden **declaration** is fatal at hire and collected: a bad seat folder, a `seatTools:` key in a worker file, a block declaring a board or anything org-scoped — each refuses the whole roster and names every problem, because a lab that boots short proves something other than what it claims. **A missing board grant is in no class at all, because it is not a refusal.** The task tools are capability controls, so a kind that does not compose the capability hires cleanly and simply holds none of them — nothing to refuse at hire, and nothing to refuse at filing either, because there is no tool to call. That is why BR-2's twin is graded on a tool set and an unwritten ledger rather than on a refusal. Everything about a **row** is a per-row outcome that leaves the ledger readable — an unroutable row refuses at the drain, a filing that *names* an `author` the roster does not list refuses at the channel (one that names none is not checked, BR-8), a failed row settles `errored` and stays visible in the queue. Nothing retries, because a retry would hide the thing the queue exists to show.

## Acceptance criteria this issue owns

A team declared entirely in files — one channel holding one board, one coordinator seat and three worker seats — takes in more work than it has seats. The coordinator files every row through the board capability its kind composes — the door FIX-1385 ships for models — names who each is for, and the rows run on those seats and no others, each in its own session bound at mint to the session that dispatched it (BR-5). The row that could not start immediately runs when a seat frees, without being re-routed. Throughout, the coordinator can say what is queued, what is running, what is waiting on a person, and what is done — every one of those read off rows that already existed.

That is [ER-20](https://github.com/fixpoint-labs/flow-state-dev/pull/1905) and [ER-21](https://github.com/fixpoint-labs/flow-state-dev/pull/1905) together, and it is the epic's exit gate. Nothing else in the set makes this sentence true or false.
