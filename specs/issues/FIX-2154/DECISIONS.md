# FIX-2154 · Decisions

[Spec](SPEC.md) · **Decisions**

The epic's rules (ER-1 to ER-5) already say what the lab may hold, how it is set up and that its
front end runs on fixtures until wiring. The brief names three hard spots. Two are product calls
and come to sign-off here; the third, one conversation forever, is a package gap by the epic's
own call, recorded under *Decided, not asked*.

## The tree

```mermaid
flowchart TD
  I["FIX-2154"] --> D1["D1 · talk shows in both conversations and a Talk panel"]
  D1 -.->|"rejected"| X1["a session per pair · FIX-1989 rejected it"]
  D1 -.->|"rejected"| X2["a separate Messages screen only · away from the conversation"]
  I --> D2["D2 · a message never interrupts your turn · pending, then after"]
  D2 -.->|"rejected"| X3["taken inside the running turn · a model amendment"]
```

Solid edges are what you're signing. Dashed edges lost, and the label says why.

<a name="d1"></a>
## D1 · Worker talk shows in both conversations as one-line cards, and in a Talk panel

*A product call the brief leaves open ("visible enough to trust, but not noise").*

| | |
|---|---|
| **Instead of** | A session for each pair of workers, which the brief's wording suggests ("their own sessions"), or Shift Manager's way: one Messages screen listing every exchange |
| **Because** | A reply matters where it changes an answer, so it is drawn there: lead's message to researcher is a one-line card in lead's conversation, researcher sees it as a line from lead in its own, and the reply lands in lead's conversation under researcher's name. A card opens to the full text. The Talk panel lists one worker's exchanges grouped by the other worker, for the person who wants the whole thread. Both read the message log, so no new session or concept is added: a per-pair session was rejected by FIX-1989's D1, and fsd-architect agreed ([#46](https://github.com/fixpoint-labs/agent-mailbox/pull/46#issuecomment-6374763392), answer 4) |
| **Locks in** | What a person sees of worker talk is a view over the user's message log, keyed to the row FIX-2070 ships. A worker-to-worker exchange has no conversation of its own the person can type into; to steer it, they talk to either worker |

![D1: where a person sees what two workers said. In both conversations and a Talk panel, chosen, beside a session for each pair. Decides it: talk sits next to the answer it changed. Locks in: talk is a view over the message log](figures/d1-talk-where.svg)

It comes down to keeping a reply next to the answer it changed.

**What would change my mind:** Grok Bot's own app showing bot-to-bot talk as its own thread in
the sidebar. Then the Talk panel becomes a sidebar entry per pair, still a view over the log, with
no new session.

<a name="d2"></a>
## D2 · A message from another worker never interrupts your turn: it shows as pending, and lands after

*A product call the brief asks outright ("Where does it land? Does it interrupt?").*

| | |
|---|---|
| **Instead of** | Taking the message inside the recipient's running turn, before its next model call, the way the epic's D2 takes a background task's result |
| **Because** | The concept already answers it: a message to a busy session queues until the current request ends (rule 10), and it lands in the session that sent the original (FIX-2070). So the reply runs as its own `receive` turn right after lead answers you, and that turn's line uses it. The lab adds the part a person needs: a pending line the moment the reply is logged, so it is never silent. Taking it mid-turn would amend the model a second time, beside the epic's D2 |
| **Locks in** | A turn you started is never changed by another worker's message. The reply is a separate line after your answer, and the answer you are waiting for does not use it. A person who wants it used asks again, or waits one turn |

![D2: a message arrives mid-turn. It waits for the turn and shows as pending, chosen, beside taking it inside the running turn. Decides it: the concept's queue rule. Locks in: your turn is never changed by another worker's message](figures/d2-message-mid-turn.svg)

It comes down to the concept's queue rule: a message to a busy session waits.

**What would change my mind:** Grok Bot reading a teammate's message inside the turn it is running.
Then a gap carries messages on the epic's ER-6 path (taken before the next model call, once), and
the pending line becomes a line inside the turn.

## Decided, not asked

- **No session list, no new chat.** Choosing a worker opens its one conversation,
  `ensureWorkerSession({ worker })` with no criteria. The epic's sessions gap (ER-7) is not used.
- **One conversation forever is a package gap, not lab code** (the epic's *Decided before review*).
  The lab composes `@flow-state-dev/memory` through `defineAgentWorkerFlow({ uses })`, which is
  configuration. A summary of turns past the 50-turn window, and the mark the divider reads, is
  gap G1. The lab never summarizes on its own, not even in a small flow.
- **G1 is settled by a probe, first thing at wiring.** Step 4 is run with memory alone. If it
  passes, G1 shrinks to the mark and blocks nothing; if it fails, G1 is a child of the epic and
  blocks this lab's wiring ([epic D1](../../epics/FIX-2152/DECISIONS.md#d1)).
- **The pending line is UI over two public reads.** A log row addressed to the open worker that
  has no line in its conversation yet is pending. That join needs the received line to carry its
  message id (gap G2, an ask of FIX-2070).
- **Worker status is UI over a public read.** The list reads each worker's conversation through
  `listSessionRequests`; a running request is *working*. Unread counts are per viewer, in browser
  storage.
- **Three workers in the lab:** lead (plans with you, messages the others), researcher and writer.
  Any worker may message any other on the roster (FIX-1989); the lab restricts nothing.
- **Names.** The lab and its adapter use FIX-2070's and FIX-2071's names (`sendMessage`, `receive`,
  `inReplyTo`, `respond`). Its docs say "worker", never the retired word.
- **The layout source.** No designs were provided and no screenshot of Grok Bot was available.
  The copy follows the brief (a list of workers, one long conversation each) and Grok Bot's public
  descriptions: a sidebar where each row is a named teammate with an ongoing role, and talk between
  bots the user can see. A screenshot that shows otherwise reopens D1 only.
- **Blocked by FIX-2070** for wiring, as fsd-architect asked (#46, answer 4): FIX-2070 isn't
  specced yet, and the view keys to its row (call ids, `{ task }` addresses), not today's `replyTo`.

## Considered and dropped

| Option | Why it lost |
|---|---|
| A session per pair of workers | A new concept for a view; FIX-1989's D1 rejected it |
| Only a Messages screen, as Shift Manager has | Talk is away from the answer it changed; the brief asks it to be trusted, not hunted for |
| A lab flow that summarizes old turns | Glue the package should own (ER-4); the next app would rewrite it |
| Group chats of several workers | Out of the brief's scope, and the concept has no group conversation |

## How it got here

- **Draft** — written against the epic spec (#3783) and fsd-architect's answers on #46. One gap
  first drafted (a busy read for the worker list) was dropped on reading the client:
  `listSessionRequests` already gives it.
