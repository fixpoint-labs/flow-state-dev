# FIX-1793 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

What this issue retains, amends and supersedes in earlier designs. Lineage that spans the whole
epic is the [epic's](../../epics/FIX-1786/EVOLUTION.md); this is the issue-level part.

| Prior intent and precise source | Treatment | Why / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A project's row lists its workstreams, and a workstream belongs to at most one project, by a claim; [`../FIX-1718/DECISIONS.md#d1`](../FIX-1718/DECISIONS.md#d1) | **Superseded** for new work; **retained, deprecated** for mailboxes | One owner per workstream, each its own entry ([epic ER-7](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)). Claims still place mailbox boards' coding runs | S3 entries; FIX-1792 removes claims as it converts boards ([decided, not asked](DECISIONS.md#decided-not-asked)) | Rows and claims read and work as today; nothing new writes them |
| One room per project, shared by its members through their own talk sessions; [`../FIX-1718/DECISIONS.md#q1`](../FIX-1718/DECISIONS.md#q1), [D2](../FIX-1718/DECISIONS.md#d2) and its "The template and the talk session" rules | **Superseded** | Rooms are removed (the PRD; [epic EVOLUTION](../../epics/FIX-1786/EVOLUTION.md#predecessor-designs)) | The project coordinator, one per user per project ([epic ER-8](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt)), S5 | Room rows are dropped: nothing reads them, and nothing refuses `mintFor`, `talk` or a room call by name ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)) |
| Anyone in the org sees a project exists, only members read its conversation; [`../FIX-1718/DECISIONS.md#q3`](../FIX-1718/DECISIONS.md#q3) | **Retained** for shared projects; **amended** for private ones | A private project is its owner's alone ([D1](DECISIONS.md#d1)) | BR-1, BR-6 | A row written before this release is dropped, not read as shared ([epic D9](../../epics/FIX-1786/DECISIONS.md#d9)) |
| The project's Stream tab is its room; FIX-1718's "What Shift Manager shows" rules, in [`../FIX-1718/BUSINESS-RULES.md`](../FIX-1718/BUSINESS-RULES.md) | **Superseded** | The Stream tab becomes the viewer's project coordinator session (the PRD) | S8 | None: the tab keeps its place and name |
| A workstream's Stream is its mailbox's transcript, with its member workers' pending asks beside it; [`../FIX-1662/BUSINESS-RULES.md`](../FIX-1662/BUSINESS-RULES.md) BR-18 to BR-21, and the member-asks amendment in [#2439](https://github.com/fixpoint-labs/flow-state-dev/pull/2439), bounded by BR-24 | **Amended** for workstream entries; **retained** for mailboxes | An entry's workstream is the owner's lead session, which only the owner opens | S8: the owner sees the lead's session; others the entry | Mailbox Streams unchanged until FIX-1792 |
| A project's repository and files, readable by members, and the locks carried from Jake on 2026-10-04; [`../FIX-1762/DECISIONS.md#d1`](../FIX-1762/DECISIONS.md#d1) to [D3](../FIX-1762/DECISIONS.md#d3), [Decided by Jake](../FIX-1762/DECISIONS.md#decided-by-jake-2026-10-04) | **Retained**, extended to private projects | Q2's carried locks ([epic Q2](../../epics/FIX-1786/DECISIONS.md#q2)) | S2 user-scope files, S6 | The org-readable repository claim holds for shared projects only (BR-6) |
| A workstream is stored at `workstreams/<project>/<workstream>`; [epic, decided in review](../../epics/FIX-1786/DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them) | **Amended**: an owner segment between the two | The owner rule reads the owner off the key, as `ownerPrivate` does, so no stored field decides who writes | `workstreams/[project]/[owner]/[workstream]` (PLAN pins) | No rows exist yet |
| Every view reloads after each chief of staff turn; [#2720](https://github.com/fixpoint-labs/flow-state-dev/pull/2720) for FIX-1761 | **Retained** as the floor | A request's record of the collections it wrote would be a fourth Layer 1 change (epic ER-22) | BR-28 | None |

None is wholly superseded except the room. Before building, re-check each intent against
current code and the other children's shipped answers ([PLAN](PLAN.md#at-implement-time)).

<a name="amendment-d9"></a>
## Amended after merge: no backwards support (epic D9)

**The decision.** On 2026-10-07 the product owner wrote: "No consumers yet. No need for
backwards support of any kind." The epic records it as [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) and
[ER-31](../../epics/FIX-1786/BUSINESS-RULES.md#what-no-child-may-do). P1 had
already merged ([#2827](https://github.com/fixpoint-labs/flow-state-dev/pull/2827)); nothing in
it was an upgrade path this sweep removes.

| What | Treatment | Why | What is retained |
|---|---|---|---|
| BR-5, a project row written before this read as shared, and V2's leg on a row today's `main` wrote | **Removed**, ID kept and struck | Nothing reads a row stored in a shape this epic replaces | BR-2: a create with no visibility is shared |
| BR-30, room rows kept for an operator to read, and the guardrail that nothing stored is deleted or rewritten | **Removed** | The rows protect history no consumer has | — |
| BR-29 and BR-31, room calls, `mintFor:` and `talk` refused by name | **Removed**: they go with the room code (S7), with no refusing entry | ER-31 forbids a refusal of an old shape by name | S7's removals and V9's inventory |
| Leg d and V7 | **Removed** | They graded BR-29 to BR-31 | Legs a to c and both controls |
| S7's deprecation markers on claims, `setWorkstreams` and a row's mailbox list | **Removed** | No consumer to warn | Claims and the mailbox list themselves, until FIX-1792 converts the boards that read them: build order, not compatibility |
| `what-changes.svg`'s "kept, unread" room rows | **Amended** to dropped | Follows from BR-30 | — |

<a name="amendment-cross-spec"></a>
## Amended after merge (cross-spec alignment, 2026-10-07)

**The alignment.** Reading the epic's merged child specs against each other found places where
siblings read two ways. Each was an engineering call, made under decisions already taken, and
recorded in the epic's [How it got here](../../epics/FIX-1786/DECISIONS.md#how-it-got-here). This
spec changed:

| What | Treatment | Why | What is retained |
|---|---|---|---|
| The PR plan: P3 waits on FIX-1791 | **Amended**: P3 also waits on FIX-1794's P2 and FIX-1802's P1, and carries V6's walk-up leg | The Board view and the walk-up test need a lead's session board and a lead that files | P1 and P2 as written |

<a name="amendment-default-coordinator"></a>
## Amended after merge: each workstream's own coordinator (2026-10-07)

**The decision.** The product owner decided on 2026-10-07 that every workstream in Shift Manager
comes with its own coordinator by default ([D2](DECISIONS.md#d2)). The spec as merged in
[#2823](https://github.com/fixpoint-labs/flow-state-dev/pull/2823) had Shift Manager's open name a
lead from the owner's roster and said nothing of how the view picked one. P1 had already merged
([#2827](https://github.com/fixpoint-labs/flow-state-dev/pull/2827)); nothing in it changes.

| What | Treatment | Why | What is retained |
|---|---|---|---|
| S8, "open a workstream from the project" | **Amended**: the view forks the standard workstream coordinator onto the owner's roster through FIX-1788's fork action, under an id derived from the workstream's address, and opens the workstream naming it as the lead. No choice of an existing worker | D2 | S3's `openWorkstream`, which still takes a lead; its roster check, the workstream session through `ensureWorkerSession` with a `workstreamId` criterion, and the one delegate record on the owner's project coordinator, all as written |
| S9, the DevTeam install | **Amended**: adds the standard workstream coordinator, on the coordinator flow, as the worker S8 forks | Neither standard coordinator fits as the seed: the chief of staff hires, fires and opens projects, and the project coordinator hands posts to workstreams | The project coordinator and the chief of staff's tools |
| Who leads a workstream opened in Shift Manager | **Added**: BR-35 to BR-37, V8a. A workstream's coordinator is kept when it is done | D2; keeping is the smaller rule, and moving a workstream back out of done needs its lead (BR-21a) | BR-7 to BR-17, BR-21a, BR-21b unchanged |
| The docs | **Amended**: Shift Manager's project screen and its README say each workstream opens with a coordinator of its own | Reader-facing | The Workforce projects page: an app still names the lead |

<a name="amendment-lead-flow"></a>
## Amended after merge: the lead's flow (2026-10-07)

**The finding.** The amendment above put the standard workstream coordinator on the coordinator
flow and left one fact to check at implement time: whether that flow takes a delegated post. It
doesn't. FIX-1791 S9 gives the entry to `agent` and to app flows that declare it, and FIX-1792's
review refuted "a coordinator can lead a workstream" on the same grounds. The project
coordinator's delegate record for such a lead would be refused, or accepted with its posts
skipped (FIX-1802 BR-9), and leg c would fail.

| What | Treatment | Why | What is retained |
|---|---|---|---|
| S9, the standard workstream coordinator on the coordinator flow | **Amended**: on `agent`, with task-taking standard delegates | `agent` takes a delegated post (FIX-1791 S9) and files for its task-taking delegates (FIX-1802 D1); coordinating is the delegates, not the flow (epic D8) | D2 as decided: each workstream opened in Shift Manager gets its own new coordinator, forked from the standard workstream coordinator |
| PLAN's implement-time check that the coordinator flow takes a delegated post | **Removed**: settled, it doesn't | The specs on `main` answer it | The check that the DevTeam doesn't keep `agent` for standard workers |
| V8a | **Amended**: a post handed to the new coordinator lands in its workstream session | It is what failed | Its other legs |
| DOCS: a workstream session is "usually a coordinator" | **Amended**: usually a worker with delegates it files work for | The same finding | — |
