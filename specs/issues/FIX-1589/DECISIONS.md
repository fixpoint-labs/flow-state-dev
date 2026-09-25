# FIX-1589 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

What was considered, what was chosen, why, and what each choice locks in. Three decisions are
the sign-off surface. Everything else here is context for them.

## The tree

```mermaid
flowchart TD
  I["FIX-1589"] --> D1["D1 · a model with one tool<br/>file through support.desk's fileTask"]
  D1 -.->|"rejected"| X1a["decide first, then route<br/>two model shapes for one choice"]
  D1 -.->|"rejected"| X1b["write the ledger directly<br/>bypasses fileTask, hides the boot warning"]
  D1 -.->|"rejected"| X1c["make ada an agent seat<br/>breaks the desk-clerk to answer map"]
  I --> D2["D2 · answer by default<br/>file what the desk can't close, always reply"]
  D2 -.->|"rejected"| X2["file every note<br/>a row per question on an undrained board"]
  I --> D3["D3 · seatId, imposed on every hired seat<br/>the one supported way a block knows its seat"]
  D3 -.->|"rejected"| X3a["read the flow id through a cast<br/>core keeps it off the block context"]
  D3 -.->|"rejected"| X3b["let the model name the author<br/>a signature anyone on the roster can forge"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · The clerk's `answer` is one model call with one tool; the tool files through `support.desk`'s own `fileTask`, authored as the seat

| | |
|---|---|
| **Instead of** | (a) A model that returns `{ answer or file, board, reply }`, then a conditional step that files. (b) Giving the clerk the board's task tools, which write the ledger directly. (c) Moving `support.ada` onto the agent kind |
| **Because** | Answer-or-file is a judgement, and a tool is how a model already makes one: the reply and the filing come from one call, and the script can drive either path ([poc Q1, Q2](poc/clerk-premises/README.md)). The channel already has the door, and the channels guide already shows the dispatcher that reaches it; a dispatcher is a block, so it is a tool as it stands. (a) is two shapes for one choice. (b) writes around `fileTask` and, because the kind would declare the board, silences the boot warning FIX-1591 owns ([poc Q4](poc/clerk-premises/README.md)). (c) breaks FIX-1585 D3's `desk-clerk` → `answer { note }` and the Architect's fence |
| **Locks in** | Filing works only where dispatch runs in-process: under an external dispatcher (BullMQ, `FSD_BULLMQ_DISPATCH=1`) a delivery into an existing session is refused, so the tool reports that filing is unavailable and nothing is filed (BR-20). Filing is fire-and-forget: the tool returns the dispatch, not the row, so the reply can say "filed" before the row exists, and a refused filing leaves only a failed request on the channel. The clerk names `support.desk` in code, the way `followup-runner` names its board, so a clerk seat that isn't a member of `support.desk` is refused (`author-not-a-member`) and files nothing |

**What would change my mind:** a clerk that must know the row landed before it replies. Then
filing needs a call that waits for its answer, which the framework does not offer today, and
that is a Kill line question ([epic ER-15](../../epics/FIX-1592/BUSINESS-RULES.md#how-the-set-is-run)), not a local fix.

<a name="d2"></a>
## D2 · Answer by default; file only what the desk can't close from a note, and always reply

| | |
|---|---|
| **Instead of** | File every note · never file · file without a reply |
| **Because** | The issue's own open wall: "prefer the smallest thing that stops the parrot". A clerk that files everything puts a row on `escalations` per question, and nobody drains it until FIX-1591. A clerk that files silently looks like the parrot's opposite: nothing came back. So the prompt says: answer when you can; when the note needs a person, file it on `escalations`; when it needs work a seat can run later, file it on `followups`; either way, say where it went |
| **Locks in** | Rows the clerk files on `escalations` wait, visibly, and the boot warning keeps saying so. A `followups` row is filed for the `followup-runner` worker, so `support.wren`'s existing drain can run it when someone calls it. How often it files is prompt tone: one file to change, and no check asserts on it |

<a name="d3"></a>
## D3 · Every hired seat carries its own id as `seatId`, imposed by the hire; the clerk signs its filings with it

| | |
|---|---|
| **Instead of** | (a) Reading the seat's id off `ctx.flow.id` through a cast, as the POC did. (b) An `author` argument the model fills in. (c) Imposing it only on seats whose kind asks for it |
| **Because** | A block cannot see which seat it runs in. Core keeps the flow's id off the block context on purpose (`docs/architecture/flows-and-actions.md`, pinned by `block-context-boundary.type-test.ts`), so (a) rests on an accidental runtime property. The seat's settings are the one per-seat fact a block can read, and only the hire writes them, the same way it writes `seatSkills`. (b) lets a model sign as anyone on the roster (BP-031, epic ER-4). (c) is wrong for the set: FIX-1594 posts to channels with the same key, and a seat post without an author is unattributed, which wakes every member (epic D2). A key some seats lack is a post that wakes everyone |
| **Locks in** | The worker contract gains a sixth key, on every seat from every mint path (files, the runtime `hire` tool, the boot reload). A worker file that writes `seatId:` is refused by name. A kind whose settings schema is hand-written, not built from `workerConfigSchema()`, refuses at boot naming the key until its author adds it. A published change: one `minor` changeset for `@flow-state-dev/workforce`. The id is the record's, the name a `CHANNEL.md` `members:` lists. FIX-1594 consumes the key and does not build it |

**What would change my mind:** core giving blocks a supported view of their flow instance's id.
Then `seatId` duplicates it, and the contract should drop the key.

## Decided, not asked

- **The reply keeps its desk tag, set by the kind from the seat's file; the words after it are
  the model's.** Two goals prove a seat's settings come from its own file by reading that tag:
  `code-comes-from-files-alone` and `durable-hire-survives-redeploy`. A tag the kind writes
  keeps that a fact, not a model's phrasing. The reply now needs a model, so both goals run on
  the scripted model and log a new verdict ([EVOLUTION](EVOLUTION.md)). The reply shows whole,
  not word by word.

- **The person's note is kept** as their turn in the seat's conversation, one `userMessage` on
  `answer`. A seat is a conversation (epic ER-1 says so for the agent kind; the clerk is a seat too).
- **The generator is named `desk-clerk-answer`** and gets its own entry in kitchen-sink's test
  resolver, with its scenarios in `lib/e2e-mock-script.ts` (epic ER-7).
- **The model is an intent, `intent/chat`**, the agent kind's default. The app's resolver picks
  the model.
- **The prompt is the seat's team and own instructions, then the desk's rule** (D2). `WORKER.md`
  bodies for ada and grace stay as they are.
- **The author on a filed row is `seatId` (D3).** The model chooses only the board and the goal.
- **One tool name, `desk-clerk-file`**, in the code, the script and the docs example. The
  existing sequencer called `desk-clerk-answer` is renamed `desk-clerk-reply`, so the generator
  can take that name.
- **The scripted model matches a marker in the latest user turn only, with a cursor per
  request.** Today it matches the whole history against one global cursor, so a second run of
  the same scenario starts mid-script. FIX-1590 and FIX-1594 reuse the fix.
- **The clerk kind declares no board.** Declaring one would silence the boot warning (epic ER-13).
- **`desk-note` stays** as `support.otto`'s tool. Its header stops saying the clerk runs it.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A real-model check of answer-or-file judgement (epic D3 allows one, not a wrap condition) | It grades the prompt's tone, which D2 leaves adjustable. Worth adding if the tone becomes a promise |
| A deterministic rule that picks the board from keywords | The parrot problem again: a rule that looks like it thinks. The issue asks for a model |
| Waking the clerk from a channel post | FIX-1590's, and the epic keeps clerks off the wake (epic D1) |
| Replying in `support.desk` when filing | Posting is FIX-1594's, for agent seats only |
| A filing route that survives an external dispatcher | A queue-safe way into an existing session is framework work. Filing is scoped to in-process dispatch; a follow-up |

## Settled

- **The shape works on kitchen-sink's real wiring, keyless** — **CONFIRMED**. A scripted tool
  call from ada's `answer` put a row on `support.desk.escalations` through `fileTask`, authored
  `support.ada`; the reply carried its marker under `[front desk]`, not the note; the note was
  kept; the boot warning still fired. Today's `main` failed every leg but the warning. The POC
  read the author through the cast D3 rejects; the dispatch, the row and the roster check are
  what it proves, not the author's source.
  [`poc/clerk-premises/`](poc/clerk-premises/README.md), [`evidence.txt`](poc/clerk-premises/evidence.txt).

## How it got here

- **Draft** — framed as "the clerk parrots the moment FIX-1585 makes it reachable"; one model
  call with a filing tool into the channel's own `fileTask`; the POC confirmed it keyless, and
  found two existing goals that grade the echo's desk tag, which the kind keeps.
- **Cross-spec review and round 1** — `seatId` moved here from FIX-1594 as D3, because the POC's
  author came from a cast core forbids (Codex P1) and the set needs one carrier. The old D3,
  the desk tag, became a decided-not-asked line. Filing is scoped to in-process dispatch (Codex
  P2). S4 owns the scripted model's shared fix; S7 narrows the files-alone goal's scan, which
  has been red on `main` since FIX-1500.

**Open: none.**
