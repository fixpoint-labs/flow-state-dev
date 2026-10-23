# Teammates

A private lab that copies the core layout and interaction of Grok Bot, in the Flow State theme, on
the workforce package. It is one half of the evidence that the same package pieces make familiar
apps: an app adds only configuration, React UI and a few small flows, and anything else it needs is
a gap filed against the package.

- **Left:** the workers, lead, researcher and writer. Each row is a worker with an ongoing role,
  never a list of sessions. A row shows what the worker is doing and how many new entries its
  conversation has since you last looked.
- **Center:** the chosen worker's one conversation. It goes on for weeks. A divider marks where the
  turns the worker reads word for word begin; it reads *summarized* only when the earlier turns were
  summarized for the worker.
- **Right:** Talk, the worker's exchanges with the other workers, grouped by worker, from the
  message log. It closes.

Workers message each other where you can see it. When lead messages researcher, a one-line card
shows in lead's conversation and the message lands in researcher's. The reply lands in lead's
conversation under researcher's name. A message never interrupts the turn you are in: while lead is
answering you, researcher's reply shows as a pending line, and lead reads it right after.

Scope is core messaging and session management. There are no group chats, no new-chat button and
no session list. The design and the decisions behind it are in the
[spec](../../specs/issues/FIX-2154/SPEC.md).

## Run it

Until wiring, the screen runs on fixtures that play the script on a timer:

```bash
pnpm --filter @flow-state-dev/teammates dev
```

Ask lead for something, say *"Ask researcher for our launch date, and help me outline the post."*
lead answers and messages researcher. Before researcher replies, send lead a second line: the reply
shows as pending, then lands after lead's answer. lead's conversation already runs past the 50-turn
history window, so the divider is in view.

After wiring, the lab runs against a real model and a durable store:

```bash
fsdev dev --app @flow-state-dev/teammates
```

Wiring adds the host file, which composes `@flow-state-dev/memory` into each worker's flow: the
capability in `uses` to read it, and `afterAnswer: mem.captureFromItems` to record each turn.

## Fixtures

Everything the screen reads and writes goes through one adapter, `src/adapter.ts`. Each function
names the package call it stands for, and until wiring they run on `src/fixtures.ts`, marked
`fixture:`. At wiring the fixtures are deleted and each function calls the package.

| Fixture stands in for | Package piece |
|---|---|
| The divider and its *summarized* label | G1: the history window's opt-in summary and the mark it leaves, tracked under FIX-1613 |
| The pending line, joined to the conversation by message id | G2: a received message as its own item, carrying its id (an ask of FIX-2070) |
| Workers messaging each other, the Talk panel | `sendMessage`, `receive` and the message log, as FIX-2070 ships them |
| The worker list, sending, the conversation, busy status | `roster()`, `ensureWorkerSession`, `respond`, session items, `listSessionRequests` |

## What this app adds

Every file in the lab, by kind. `node scripts/inventory.mjs` fails on a file that is none of these,
and on a flow over 200 lines; `--wired` also fails while a fixture is left.

<!-- inventory:start -->
| Kind | Files | Lines |
|---|---:|---:|
| Configuration | 13 | 253 |
| React UI | 14 | 822 |
| Small flows | 0 | 0 |
| Fixtures (deleted at wiring) | 1 | 267 |
| Checks (not app code) | 3 | 275 |
<!-- inventory:end -->
