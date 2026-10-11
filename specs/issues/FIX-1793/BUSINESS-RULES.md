# FIX-1793 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, written as rules. *Proved by* names the kind of check; [PLAN.md](PLAN.md#checks) maps
each to its run. A refusal writes nothing and names its reason.

## Private and shared projects

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | Alice creates a project with `visibility: "private"` | It is hers in this org: Bob can't list, open or read it, by the app, a worker's tool or the resource route; Alice in her second org doesn't see it | CI · VG leg a |
| BR-2 | A create names no visibility | A shared project, as today | CI |
| BR-3 | A private create lists other members | Refused, `private-has-members` | CI |
| BR-4 | Alice has a private `apollo` and the org a shared one | Both exist; each is addressed by its visibility and id | CI |
| ~~BR-5~~ | A project row written before this is read | Removed by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9): no rule, test or code keeps old rows readable. Shared projects keep the `projects/*` collection, so an old row that still fits the schema would list as shared; the kitchen-sink app's and the DevTeam lab's stores are reset once when this ships ([FIX-1796 D2](../FIX-1796/DECISIONS.md#d2)), and that reset is what leaves none | — |
| BR-6 | Anyone in the org reads a shared project | They see its row, its repository included, and every workstream's entry (BR-12): shared means the whole org reads it, and members decide who opens workstreams (BR-8). A private project's row, repository and files are its owner's alone | CI |

## Workstreams and the owner rule

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | A member opens a workstream on a shared project, naming a lead on their own roster | An entry keyed to them, and the lead's workstream session, theirs, linked to the workstream when it is created. The entry names the session, and its project coordinator gains the workstream as a delegate (BR-21a) | CI · VG leg b |
| BR-8 | Someone not a member opens one on a shared project | Refused, `not-a-member` ([Q2](DECISIONS.md#q2)'s answer sets who) | CI |
| BR-9 | The owner opens one on their private project | As BR-7, in their user scope | CI |
| BR-10 | The lead named is another user's worker, or no worker | Refused like a missing worker (FIX-1788's check) | CI |
| BR-11 | Bob writes Alice's entry by any path: the app's action, a worker's tool, flow code writing the collection, a create under her key, a delete | Refused loudly, naming the owner rule. Nothing changes | CI at the engine · VG leg b |
| BR-12 | Bob reads Alice's entry in a shared project | Allowed: title, owner, lead, status, due date, objectives, report. Never her workstream session, its board or its tasks | CI · VG leg b |
| BR-13 | A flow declares a collection whose pattern reaches the entries | The app refuses to start, naming both | CI |
| BR-14 | One owner opens the same workstream id twice at once | One entry, one session | CI |
| BR-15 | A workstream id is empty or holds `/` | Refused. A project's listing takes its direct entries only | CI |
| BR-16 | The lead updates the entry from its workstream session | It lands, as the owner; the server sets when | CI |
| BR-16a | Anyone writes an entry: the owner from the app, or the lead from its session | The entry carries `writtenBy`, stamped from the session through FIX-1789's helper: the user, and the lead when it wrote. For display and audit only; who may write is BR-11 ([FIX-1789 D1](../FIX-1789/DECISIONS.md#d1)) | CI |
| BR-17 | The owner marks a workstream done | It stays listed, as done. Nothing deletes an entry | CI |

## Who opens a workstream

*Amended after merge ([D3](DECISIONS.md#d3), the product owner, 2026-10-11).* BR-35 to BR-37
were [D2](DECISIONS.md#d2)'s, struck with it. `openWorkstream` itself is unchanged: it takes a
lead, and an app may call it directly.

| # | When | Then | Proved by |
|---|---|---|---|
| ~~BR-35~~ | ~~Alice opens a workstream from a project in Shift Manager~~ | Struck by [D3](DECISIONS.md#d3): Shift Manager forks no coordinator. See BR-38 | — |
| ~~BR-36~~ | ~~The same open is sent twice, or the open is refused~~ | Struck by D3: nothing is forked, so nothing is reused or fired. A repeated open is BR-14's | — |
| ~~BR-37~~ | ~~Alice marks the workstream done, or moves it back out of done~~ | Struck by D3: the lead was already on her roster and stays there. BR-21a still restores the record | — |
| BR-38 | Alice asks her project coordinator for work that no workstream of hers in the project holds | It opens one with `openWorkstream`: a title and objectives from her ask, and as lead the worker on her roster whose description fits the work, among those that can lead (BR-42), such as the EM for a feature. Her roster is read when the ask arrives, so a worker the chief of staff hired for her counts as one a file declares does. Then, in the same turn and on the same entry read (V5's budget), it hands the ask to that workstream (BR-25). The open's delegate record is already in its session state when it does, so the hand-off is accepted, so the ask lands in the workstream session and is its brief. One entry, the lead's workstream session, one delegate record (BR-7, BR-9, BR-21a as written). Nothing is added to her roster. Shift Manager has no form that opens a workstream | CI · V8b |
| BR-39 | The work belongs to a workstream she already owns there, or nobody on her roster fits it | The first: it hands the ask to that workstream and opens nothing. The second: it says nobody on her roster does that work and opens nothing; hiring is the chief of staff's | CI · V8b |
| BR-40 | One worker leads two of her workstreams | Two workstream sessions of that worker and two delegate records; a post to one lands only in its session. Shift Manager's Tasks view, grouped by stream, shows two groups, each named for its workstream, and each row's STREAM names its workstream. A worker's conversation outside any workstream still reads as that worker (FIX-1877) | CI · V8b |
| BR-42 | A workstream is opened naming a lead that declares no delegates, such as the coder | Refused, naming the rule: a lead runs its workstream through its delegates. With S3's lead-flow check, the DevTeam's only possible lead is the EM; the coder, the reviewer and coordinator-flow workers are refused. The project coordinator offers only workers that pass both checks (BR-38) | CI · V8b |

## Progress

| # | When | Then | Proved by |
|---|---|---|---|
| BR-18 | A project view opens | It reads the project's row and its entries by one prefix, not the whole Lab. Progress is computed from the entries: workstreams by status, objectives met of total, the next due date, stale entries. Nothing is stored on the row | CI · VG leg b |
| BR-19 | An entry hasn't changed for seven days | It shows as stale | CI |
| BR-20 | Two owners update their entries at once | Both land; neither waits on the other | CI |

## The project coordinator

| # | When | Then | Proved by |
|---|---|---|---|
| BR-21 | Alice opens a project's coordinator | Her own session, created the first time and found after: one per user per project | CI · VG leg c |
| BR-21a | Alice opens a workstream, marks one done, or moves one back out of done | Her project coordinator's delegates change through FIX-1791's delegate path ([#2821](https://github.com/fixpoint-labs/flow-state-dev/pull/2821) BR-2, BR-5): one record per open workstream, the lead plus the entry's address. The coordinator starts with no defaults, and when it is first created takes a record for each workstream she has open there. Two workstreams led by one worker are two delegates. A post reads delegates from session state only. Opening the same workstream again restores a missing record | CI |
| BR-21b | Alice has 25 open workstreams in one project and opens another | Refused, naming FIX-1791's cap of 25 delegates. Nothing is written | CI |
| BR-22 | Bob opens the same project's coordinator | His own session. He never reaches Alice's | CI |
| BR-23 | A session create names a project its user can't read, or carries the link in its state | Refused | CI |
| BR-24 | Alice asks about the project | The coordinator reads every entry, Bob's included, and answers from them | VG leg c |
| BR-25 | Alice asks for work | It goes only to a lead of a workstream she owns here, delivered into that workstream session, once: FIX-1791's ledger resolves the session from the delegate record ([#2821](https://github.com/fixpoint-labs/flow-state-dev/pull/2821) BR-20a) | VG leg c |
| BR-26 | The coordinator picks Bob's workstream | Refused like a missing delegate, and recorded | CI · VG under its control |
| BR-27 | Alice owns no workstream in the project and asks how it is going | It answers from the entries. *Amended by [D3](DECISIONS.md#d3):* an ask for work opens a workstream (BR-38), unless nobody on her roster can lead it, when it says so and opens nothing (BR-39) | CI |
| BR-28 | A coordinator turn finishes in Shift Manager | The Lab is read again, so a project or workstream it made shows. No tool name is special-cased | CI |

## Rooms removed, and what stays

| # | When | Then | Proved by |
|---|---|---|---|
| ~~BR-29~~ | A client calls `join`, or posts, reads or answers on a session that was a project's talk session | Removed by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9): no entry is kept to refuse a removed room call by name | — |
| ~~BR-30~~ | A store holds room lines, answers, deliveries and counters | Removed by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9): nothing reads them, and the in-repo stores are reset once | — |
| ~~BR-31~~ | A `MAILBOX.md` carries `mintFor:`, or an app passes `talk` to the projects collection | Removed by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9): neither is refused by name; both go with the room code (PLAN S7) | — |
| BR-32 | A row lists mailboxes, and claims hold them | They still group under the project and place their boards' coding runs, until FIX-1792. No new feature writes them | CI |

## Coding runs

| # | When | Then | Proved by |
|---|---|---|---|
| BR-33 | A coding run works for a workstream | Its project's repository or files, by visibility: a private project's files are in its owner's user scope. FIX-1762's locks unchanged | CI |
| BR-34 | The run's owner is not the workstream's owner | Refused, `not-the-owner` | CI |

## Failure taxonomy

Every refusal is fatal to its write and names its reason: `private-has-members`,
`not-a-member`, `no-such-project`, a missing worker, FIX-1791's delegate cap, `not-the-owner`, and the engine's
owner-rule error. A lost compare-and-swap is retried, as the row writes are today.
Nothing is ignored silently, and nothing stored is deleted.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): legs a to c pass on a real model with
two users, and leg b fails under `no-owner-rule` and leg c under `all-entries-delegate`.
