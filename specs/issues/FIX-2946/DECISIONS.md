# FIX-2946 · Decisions

[Spec](SPEC.md) · **Decisions**

The board's door is the owner's ([Q2](../../epics/FIX-2941/DECISIONS.md#q2)): `ctx.cap.<name>.at({ session })`
and `.acrossSessions()`, no `boards()` helper. The owner asked this spec to say which boards offer
them. That is D1. D2 is how the rows already stored get to their new home.

## The tree

```mermaid
flowchart TD
  I["FIX-2946"] --> D1["D1 · only a durable session-scoped board offers at and acrossSessions"]
  D1 -.->|"rejected"| X1["a factory board offers them through its factory"]
  I --> D2["D2 · old rows move once, before the first request"]
  D2 -.->|"rejected"| X2["read old partitions on every board read"]
  D2 -.->|"rejected"| X3["move each conversation on its first open"]
```

Solid edges are what you sign. Dashed edges lost.

<a name="d1"></a>
## D1 · Only a board on a durable, session-scoped collection offers `.at` and `.acrossSessions`; a factory-, request- or sequencer-backed board doesn't, by its type

| | |
|---|---|
| **Instead of** | A factory-backed board offering them by calling its factory with the named session |
| **Because** | A factory is caller-opaque (`TaskBoardBacking`'s `"factory"`): the board doesn't know where it keeps rows, so it can't promise that another session's copy is where the factory would look, or that the owner check guarded it. Request and sequencer boards live in one run and have no other copy. A board on a declared session-scoped collection has its copies where FIX-2942 and FIX-2945 read them |
| **Locks in** | Reach is a property of the board's backing, checked when the app is built. An app with a factory board that wants reach moves its storage into a declared collection |

![D1: reach only on a durable session-scoped board, chosen, beside a factory board offering it through its factory. Decides it: whether the owner check guards the rows reached. Price: a factory board has no reach. Locks in reach by backing, at build time; flips if a factory board in real use needs reach](figures/d1-which-boards.svg)

It comes down to the owner check: through a factory, nothing proves the rows reached are the owner's.

**What would change my mind:** a factory board in real use that needs reach. Then the factory
grows a session argument, and the owner check runs before it is called.

<a name="d2"></a>
## D2 · Rows stored by today's partitioned ledgers move once, into their conversation's copy, before the first request is served; the mover is workforce's and goes after one release

| | |
|---|---|
| **Instead of** | Read the old partitions on every board read until nothing is left in them · or move each conversation's rows the first time it is opened |
| **Because** | Reading old partitions keeps `partition.ts`, its index and the forced `flowIsolation: false` alive, which is what the epic deletes ([epic D2](../../epics/FIX-2941/DECISIONS.md#d2)). Moving on first open leaves rows of conversations nobody opens in the old place forever, and a screen across sessions would miss them. One pass before serving moves everything, and a key parser lives only in the mover |
| **Locks in** | The first start after the upgrade walks every user's board and plan rows once, so a large store starts slowly that one time. The mover is idempotent: a row already in its copy is skipped. A row whose partition names no session is kept where it is and reported, never dropped (BP-030) |

![D2: move old rows once before serving, chosen, beside reading old partitions on every read. Decides it: whether partition code can be deleted. Price: a slow first start on a large store. Locks in an idempotent mover that loses nothing; flips if a deployment can't afford the first-start pass](figures/d2-move-once.svg)

It comes down to deleting partitions: reading them forever keeps their code forever.

**What would change my mind:** a deployment whose store is too large to walk at start. Then the
mover runs as a command the operator starts, and serving waits for it.

## Decided, not asked

- **`ctx.task` is set by the task entry from the claimed row**, server-side, with the task's id
  and the session whose board it sits on. Never from the envelope's input (BP-031). It is the one
  convergence point for "which board is my task on": every settle, progress write and message
  target reads it.
- **The task tools take no `board` argument.** Searched the workers and kits for a turn that files
  on two boards: none. Filing writes the session's own copy; working and settling reach the task's
  board. A second board in one turn gets its argument when a real case appears (the epic's default).
- **The task-id lookup filters at the store by the row's key**, through FIX-2945's read. Without
  partitions a row's key is its task id, so the primary key and the owner join answer it, and the
  `byTaskId` index has no reader left. It never loads every copy and discards.
- **The plan ledger moves with the conversation board** and keeps its shape (epic D2).
- **Shift Manager's board read moves after FIX-2777** deletes `reads.ts`; nothing in it is rebuilt.
- **The filer's turn** starts once per ending through FIX-2942's wake, which coalesces.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A `boards(ctx, name, { session })` helper | The owner held it back (Q2): a second door to a board that has one |
| Keep the `byTaskId` index to find a task's session | A second record of where a row is; the read across sessions answers it |

## Analysis

2026-11-26 · watermark 2026-11-25 · **Right approach.** Run over the whole set in the epic agent's
own context.

1. **Reuse:** the capability, FIX-2942's reach and FIX-2945's read; the Adds table has three rows,
   each extending a piece. See [Builds on / Adds](SPEC.md#whats-already-here-and-the-debt).
2. **Prior art:** the concept doc's walkthrough composes this end state on paper.
3. **Other shapes:** a tracer that moves the conversation board first and the plan ledger later;
   rejected by epic D2, since `partition.ts` stays until both move.
4. **New factors:** FIX-2777 is in review, and this issue waits for it.
5. **Necessity:** the epic's long pole.
6. **Ergonomics:** one door per board, typed; `ctx.task.session` replaces two state keys.
7. **Concerns:** moving stored rows. D2's mover loses nothing and reports what it can't place.

## How it got here

- **Draft (Nov 26)** in the epic's spec set, after the owner decided Q2 and asked which boards
  offer the reach (D1).

**Open: none.**
