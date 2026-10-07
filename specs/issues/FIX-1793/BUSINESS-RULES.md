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
| BR-27 | Alice owns no workstream in the project | It answers from the entries and says it has nobody to hand work to. Nothing is opened for her | CI |
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
owner-rule error. A lost compare-and-swap is retried, as the row writes are
today. Nothing is ignored silently, and nothing stored is deleted.

## Acceptance criteria this issue owns

[The goal](SPEC.md#the-goal-and-how-well-know-its-met): legs a to c pass on a real model with
two users, and leg b fails under `no-owner-rule` and leg c under `all-entries-delegate`.
