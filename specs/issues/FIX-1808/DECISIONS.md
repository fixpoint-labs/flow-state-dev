# FIX-1808 · Decisions

[Spec](SPEC.md) · **Decisions**

Two decisions are the sign-off surface. Everything else here is context for them.

## The tree

```mermaid
flowchart TD
  I["FIX-1808 · the board shows the nest"] --> D1["D1 · a child is a piece of its task"]
  D1 -.->|"rejected · a second relation that waits on nothing"| X1["a parent any filing can name"]
  I --> D2["D2 · drawn once, under its task"]
  D2 -.->|"rejected · the nest splits across groups"| X2["each row in its own group, naming its task"]
  I -.->|"rejected · moves rows the split settles from"| X3["file pieces on the parent's own board"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · A child is a piece: work its task handed out and waits on

| | |
|---|---|
| **Instead of** | A "part of" link any filing can set, from any session, onto any row, with no wait behind it |
| **Because** | The split already makes durable child rows, parks the task until they end, cancels them with it and replays them after a crash (FIX-1802 S4). A second relation would draw the same nest with none of that behind it: a task could finish while its "children" still run, and the board would show a nest the system doesn't keep. One relation is also one answer for FIX-1807 (tenet 2) |
| **Locks in** | Every child row is filed from its task's own session. FIX-1807 and FIX-1809 file review and fix steps as pieces of the coding task, through that task's session, and the task waits on them. The public field `parent` means "a piece of", and an app that reads it can rely on that |

![D1: what makes a task a child. A piece of its task, chosen, beside a parent any filing can name. Decides it: whether the task waits on its children. Price: a child must be filed through its task's session. Locks in parent meaning a piece of; flips if FIX-1809's setup step can't file through the coding task's session](figures/d1-what-is-a-child.svg)

It comes down to whether the task waits: a nest the system doesn't keep is one the board shouldn't draw.

**What would change my mind:** FIX-1809's setup step needing to lay out review rows from outside the coding task's session, with no way to file through it. Then a filer-named parent is needed, and it shares the `parent` field, so the board drawing stays.

<a name="d2"></a>
## D2 · A child is drawn once, under its task, in its task's group

| | |
|---|---|
| **Instead of** | Each row in the group its own state or worker puts it in, with a line naming its task |
| **Because** | The nest is what the person asked to see. Placed by its own state, a running piece of a waiting task lands in another group, and the nest is never on screen at once. The row still shows its own state and worker, so nothing about it is hidden |
| **Locks in** | On Tasks grouped by state or worker, a piece's group is its top task's. A person scanning RUNNING sees running tasks, not running pieces of waiting ones; the rail and the project Board have no groups and nest the same way |

![D2: where a child row is drawn. Once, under its task, chosen, beside in its own group naming its task. Decides it: whether the nest is ever on screen at once. Price: a running piece of a waiting task is not under RUNNING. Locks in one place per row; flips if people use Tasks mainly to see what is running now](figures/d2-where-a-child-shows.svg)

It comes down to seeing the nest at once: split by group, a task and its pieces are never together.

**What would change my mind:** people using Tasks mostly to see what is running right now. Then RUNNING also lists running pieces, each naming its task. It is a drawing rule; no data changes.

## Decided, not asked

- **The link is written at filing, from server state only.** The piece's task and that task's board come from the task session's own state, never from a filing's input or a patch (BP-031). The one writer is the board's filing path, which every piece goes through, the turn's tools and the app's `addTask` alike: that is the convergence point.
- **Workforce publishes it; orchestration's task row gains no field.** Only the split makes children. A framework-wide parent field is a promise nobody else needs yet. Metadata stays server-only (BP-015): one field is published, not the metadata.
- **Pieces filed before this change still nest** (BP-030). Each already carries its task's id, and its board is the task session's, which the task's run names. The implementer reads those when `parent` is absent, and the goal's `legacy` signal proves it on a piece stored in today's shape.
- **The tree is built in the browser from the ledger read the Lab already makes.** No server reads another session's board; the rail's live read gains the rows under its tasks, with no second poll.
- **Depth follows the chain.** A piece of a piece nests again, as deep as the split's depth limit allows.
- **Finished pieces stay under a task that is still shown.** The issue asks for the nest "after rounds complete". A finished task drops off Tasks with its pieces, as finished rows do today; the rail's finished group keeps both.
- **A retried piece sits beside the one it retried**, in filing order. Both are history.
- **A piece whose task isn't in the read** (a failed page, a conversation not listed) draws on its own, naming its task, so no row disappears.

<a name="considered-and-dropped"></a>
## Considered and dropped

| Alternative | Why not |
|---|---|
| File pieces on the parent's own board, so "same board" is literal | The split settles from the task session's own board, and FIX-1997 is changing that code now. Moving the rows breaks the rule that a session reads only its own board, for a picture the drawing already gives |
| A parent any filing can name, with no wait behind it | D1. A second relation beside the split |
| Infer the nest in the browser from the task's run session, with no new field | Works for a task session running one task. A session runs a task and its follow-ups, so pieces of one would nest under both. An app reading the boards couldn't nest either |
| Have a worker's `listTasks` return the pieces under its tasks | The model would see a second level of work it doesn't own, and every caller of the tool would change for a drawing |
| Flat rows labelled "part of <task>" | The smaller goal, rejected in [SPEC.md](SPEC.md#the-goal-and-how-well-know-its-met) |

## How it got here

- **Draft** — framed as making the split's pieces visible where the person already looks; no new child concept; one published link and a tree in the board views; designed on FIX-2006's shared rail read and FIX-1997's roster-wide pieces.

**Open: none.**
