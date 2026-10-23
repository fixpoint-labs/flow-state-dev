# FIX-2152 · Decisions

[Spec](SPEC.md) · **Decisions**

The calls above any one lab. The product brief on FIX-2152 sets the bar, the scope and the order.
D1, D2 and D3 come to the owner for sign-off; D2 and D3 each amend the coordination concept.
D4 is an engineering call, recorded because every lab obeys it. fsd-architect checked D2, D3 and
the worker-talk view against `main` ([agent-mailbox#46](https://github.com/fixpoint-labs/agent-mailbox/pull/46#issuecomment-6374763392)).

## The tree

```mermaid
flowchart TD
  E["FIX-2152"] --> D1["D1 · a gap that blocks a lab's script is a child, built here"]
  D1 -.->|"rejected"| X1["another epic builds it later · a workaround in the lab"]
  E --> D2["D2 · a background result reaches the running turn, before its next model call"]
  D2 -.->|"rejected"| X2["the main session hears it after the turn, as today"]
  E --> D3["D3 · a person can open more conversations with one worker"]
  D3 -.->|"rejected"| X3["one hired copy per session · a workstream per session"]
  E --> D4["D4 · front ends now, on fixtures behind one adapter"]
  D4 -.->|"rejected"| X4["wait for the refactors · wire to today's names"]
```

<a name="d1"></a>
## D1 · A gap that stops a lab passing its script is a child of this epic, and is built here

*An engineering call that changes the epic's size, so it comes to the owner.*

| | |
|---|---|
| **Instead of** | Filing every gap for another epic to build later, or working around it in the lab |
| **Because** | The epic is done when the scripts pass on `main`. If another epic builds the gaps, *done* waits on a queue this epic doesn't own. A workaround puts glue in the lab, which is the thing the inventory exists to show is absent |
| **Locks in** | A gap that blocks a script is filed as a child of FIX-2152 in the Workforce: Shift Manager project. It blocks its lab's wiring and the closure. A gap that blocks no script is filed in the project, linked from the lab's spec, and is not a child. Two are known now ([the set](SPEC.md#the-set--as-of-2026-10-23)); each lab's spec lists the rest |

**What would change my mind:** a gap big enough to be an epic of its own. Then it is filed as one,
and the lab's wiring waits on it.

![D1: the gaps that block a script are children of this epic, chosen, beside another epic building them later and a workaround in the lab; decided by whether the epic can be done on its own work](figures/d1-gaps-built-here.svg)

It comes down to whether the epic can finish on its own work.

<a name="d2"></a>
## D2 · A background result reaches the main session inside its running turn

*A product call the brief makes (step 4 of FIX-2153's script); the cost is engineering, so it is
recorded here.*

| | |
|---|---|
| **Instead of** | The main session hearing the result only after its turn ends, which is what happens on `main` today: a settled notice waits for the reply (`AFTER_REPLY_CONCURRENCY`, `workforce/src/conversation-board/task-settled.ts`) |
| **Because** | Claude Code shows a background result inside the running turn, and the brief's script asks for it. The package already delivers a steer to a running assignee before its next model call (`orchestration/src/skills/steer-context.ts`, over the generator's `prepareStep`), so a filer's notice can take the same path |
| **Locks in** | [ER-6](#who-owns-what), built by [FIX-2159](https://linear.app/fixpoint-labs/issue/FIX-2159): a delivery mode on FIX-2078's one ending path, not a second path, with one durable "taken in request R" mark like `steersTakenIn`; the deferred notice skips once R has completed. Only a conversation request with no claim, or one already holding the filer task's claim, takes it, never a `receive`. A claimless take never skips a filer task's `onTaskSettled`, and a request waiting on the task with `getTask` resumes with the result instead. Rules 5 and 6 (FIX-2077) are untouched: a take records no ending. No change in core or engine |
| **Amends** | Rule 7 of [`workforce-coordination-concept.md`](../../../docs/internal/design/workforce-coordination-concept.md) gains a third destination for an ending's notice: the filer's running request. It stays consistent with FIX-2103's call that an ending is not a message and changes no open work |

**What would change my mind:** a take that can't be made crash-safe the way `steersTakenIn` is.
Then the lab shows the result after the turn and step 4 changes, which is a product call.

![D2: a background result is taken before the main session's next model call, chosen, beside after the turn ends as today; decided by working the way Claude Code does](figures/d2-result-in-turn.svg)

It comes down to working the way Claude Code does: the turn uses the result while it runs.

<a name="d3"></a>
## D3 · A person can open more conversations with one worker

*An amendment to the coordination concept, so it comes to the owner. Shape from fsd-architect.*

| | |
|---|---|
| **Instead of** | Hiring one copy of the main worker per session, which shows a roster of identical workers that neither original app has; or a workstream per session, which needs a project, goals and a lead (BR-42) and is capped at 25 delegates (`workforce/src/delegates/delegate-keys.ts`) |
| **Because** | A session belongs to a worker through its `workerId`, and `WorkerSessionCriteria` (`workforce/src/workers/derive-session-id.ts`) is built to take more keys. One optional key naming a conversation gives it a derived id, so nothing new is named: it is still a conversation. Random-id sessions stay refused (`workers/client.ts`) |
| **Locks in** | [ER-7](#who-owns-what), built by [FIX-2158](https://linear.app/fixpoint-labs/issue/FIX-2158): `ensureWorkerSession`, `findWorkerSession` and a new list call on the workforce client take the key; no key means the default conversation |
| **Amends** | The concept's "one conversation per worker per user" and FIX-1989 D1's "one computed address" become: a default conversation, where messages and routed tasks land, plus any the user opens. A reply goes back to the session that sent the message, as today |

**What would change my mind:** an app that needs to address a message to one of the extra
conversations. Then messages need the key too, which is FIX-2070's call.

![D3: one optional key naming a conversation, chosen, beside a hired copy per session and a workstream per session; decided by a person opening one the way the app does](figures/d3-more-conversations.svg)

It comes down to opening a session the way Claude Code does: one step, with nothing around it.

<a name="d4"></a>
## D4 · Front ends are built now, on fixtures behind one adapter

*An engineering call on sequencing, from Jake's go-ahead of 2026-10-23.*

| | |
|---|---|
| **Instead of** | Waiting for the refactors (FIX-2056's closure, FIX-2058, FIX-2070, FIX-2071) before any UI, or wiring the UI to today's names now |
| **Because** | Jake asked for the UI to be designed and the front end built while the refactors land. Today's names (`messageWorker`, `onWorkerMessage`, `chief-of-staff`) are about to change, so wiring to them now is rework at every call site |
| **Locks in** | [ER-5](#who-owns-what): each lab reads and writes through one adapter module. Each function names the package call it stands for, by its post-refactor name. A fixture function that stands in for a gap carries the gap's issue id. At wiring the fixtures are deleted and the functions call the package. The closure checks that no fixture code ships |

**What would change my mind:** the refactors landing before the front ends start. Then the adapter
calls the package from the first commit.

![D4: fixtures behind one adapter, chosen, beside waiting for the refactors and wiring to today's names; decided by finishing the UI before the wiring](figures/d4-front-end-now.svg)

It comes down to finishing the UI first: the adapter is the only file that changes at wiring.

## Who owns what

![Who owns what: seven rules by FIX-2153, FIX-2157, FIX-2154, two gaps and the closure FIX-2156, each rule with one owner](figures/ownership.svg)

A *uses* cell is a place a child must not decide again. FIX-2153 owns the lab rules because it
goes first; the gap issues own their mechanisms.

| # | Rule every child obeys | Owner | Checked at |
|---|---|---|---|
| ER-1 | A lab has three kinds of code: configuration (`fsdev.config.mts`, the host file, `WORKER.md`, `SKILL.md`, `TEAM.md`, resources), React UI, and small flows (at most a few, each under 200 lines, composed only from package exports). The lab's README carries the inventory: files by kind, with line counts. A check in the lab fails on any file that fits none of the three, and the closure runs it. This inventory is the "what this app adds" table the brief asks for | FIX-2153 | Every lab's spec review; the closure |
| ER-2 | A lab imports only a package's public entry points (its `exports` map), never a `src/` path or a private helper | FIX-2153 | The closure sweep |
| ER-3 | One way to set up a lab: under `labs/`, private, launched with `fsdev dev --app` as Shift Manager is; the theme from `@flow-state-dev/design-system` and components from the `packages/ui` registry (`fsdev ui add`). A lab defines no color tokens of its own. The two labs share no code: a piece both need that isn't UI is a package gap ([ER-4](#who-owns-what)), and a piece of UI both need is copied, so each inventory shows what that app adds. FIX-2157 is a mode of FIX-2153's app, not a third lab, so it shares that app's code | FIX-2153 | Every lab's spec review |
| ER-4 | Any need beyond ER-1's three kinds goes to the package: filed against workforce or orchestration (or react, for a hook), named in the lab's spec, and never worked around in the lab, not even for a while. A gap that blocks a script is a child of this epic ([D1](#d1)) | FIX-2153 | Every lab's spec review; the closure |
| ER-5 | Until wiring, a lab reads and writes through one adapter whose functions each name the package call they stand for, by post-refactor names ([D4](#d4)); a fixture standing in for a gap carries its issue id; at wiring the fixtures are deleted | FIX-2153 | Each lab's wiring PR; the closure |
| ER-6 | A settled notice reaches a filer's running request once: taken before its next model call, or by the deferred notice when no model call took it, never both, on FIX-2078's one ending path with a durable taken mark. Only a claimless conversation request or the filer task's claim holder takes it, never a `receive`; a `getTask` wait resumes instead ([D2](#d2)) | FIX-2159 | FIX-2153's wiring; the closure's leg a |
| ER-7 | A person opens and lists only their own conversations with one worker, through one optional criteria key on the workforce client; the default conversation is still where messages and routed tasks land ([D3](#d3)) | FIX-2158 | FIX-2153's wiring; the closure's legs a and c |

## Coordination seams

| Seam | Owner, then who else touches it |
|---|---|
| The workforce client (`workforce/src/workers/client.ts`, `derive-session-id.ts`) | FIX-2158 adds the conversation key and the list call; FIX-2153 and FIX-2157 call them through their adapters |
| The settled notice (`workforce/src/conversation-board/task-settled.ts`, its deferred entry) and the context the generator re-reads before each model call (`orchestration/src/skills/steer-context.ts`) | FIX-2159 adds the take and its mark; FIX-2153 shows the result in the main thread |
| Messages (`workforce/src/messages/`, the user-scoped `workerMessagesCollection`) | FIX-2070 owns the rename to `sendMessage` and `receive`, where a message lands, and the row it ships (call ids, `{ task }` addresses). FIX-2154 is blocked by FIX-2070 and keys its worker-talk view to that row; a pair filter is UI, and a gap is filed only if paging by pair needs a server index |
| Routed tasks, task statuses and the hold on questions (`workforce/src/coordinator/`, FIX-2058's hold and `waitForUser`) | FIX-2083 and FIX-2058 own them. FIX-2157's status board reads them and adds no status of its own; a column the statuses can't fill is a gap |
| The app's mode switch (FIX-2153's host and UI) | FIX-2153 plans for it in its spec; FIX-2157 adds threads mode behind it |

## Decided before review, recorded so no child reopens them

- **Scope** (the brief): core messaging and session management only. No file diffs or changes
  view, no permission UI, no harness picker; Kitchen Sink covers them. Landing copy is GTM's.
- **Design** (the brief): no designs are provided. Each lab copies its original's core layout and
  interaction closely, in the Flow State theme ([ER-3](#who-owns-what)).
- **Skills don't start workers.** `agents:` and `workers:` frontmatter stay refused
  (`orchestration/src/skills/skill-md.ts`). In the Claude Code-style lab, a skill that "starts a
  worker" tells the model to `createTask` for a named delegate. That is configuration, not a gap.
- **Stopping a task through the main session** is the main worker calling
  `updateTask({ status: "cancelled" })`, which exists (FIX-2081). Steering is `updateTask({ message })`
  (FIX-2086).
- **A long conversation** (FIX-2154) composes `@flow-state-dev/memory` into the worker's flow
  through `defineAgentWorkerFlow({ uses })`, which is configuration. If the history window drops
  what the script needs, that is a gap, not lab code.
- **Names.** Every spec and adapter uses the post-refactor vocabulary: `respond`, `receive`,
  `sendMessage`, `createTask`, `getTask`, `updateTask`, `waitForUser`, request, conversation,
  Shift Coordinator. Docs say "worker", never "seat".
- **FIX-2157's two questions go to its spec**, with the epic's recommendation: you can talk inside
  a thread directly, as a steer to its task through the board's public `updateTask` action
  (FIX-2081), as Shift Manager's task session already lets a person write into a task (FIX-2009);
  *Pinned* is a person's choice, kept in user state, and needs no task status.

## Answered by fsd-architect

Checked against `main` at d5ecdb72, on [agent-mailbox#46](https://github.com/fixpoint-labs/agent-mailbox/pull/46#issuecomment-6374763392), 2026-10-23.

1. **A main session that works and delegates is not a new concept.** One worker on the agent flow,
   roles `manager` and `contributor`; background work is delegation-board tasks with
   `resultTo: "filer"`, the default, heard through `onTaskSettled`. The side pane is the
   conversation's `listTasks`, one board per conversation. A filing naming the worker itself is a
   plan row the drain waits on (FIX-2076 D1, FIX-2082 D2), so a background copy of the main worker
   is a second hired worker on the same flow: configuration, not a gap.
2. **More conversations with one worker are not workstreams.** They are one optional criteria key,
   and an amendment to the concept ([D3](#d3)).
3. **A result in a running turn** keeps rules 5 and 6 and adds a destination to rule 7, under the
   conditions in [D2](#d2).
4. **Worker talk is a view, not a session.** FIX-1989 D1 already rejected a session per pair. The
   read exists: `workerMessagesCollection` is user-scoped with a client read, and its rows carry
   from, to, exchange and sessions. FIX-2154 is blocked by FIX-2070 and keys its view to the row
   FIX-2070 ships.
