# Teammates

A private lab that copies the core layout and interaction of Grok Bot, in the Flow State theme, on
the workforce package. It is one half of the evidence that the same package pieces make familiar
apps: an app adds only configuration, React UI and a few small flows, and anything else it needs is
a gap filed against the package.

- **Left:** the workers, lead, researcher, writer and coder. Each row is a worker with an ongoing
  role, never a list of sessions. A row shows what the worker is doing and how many new entries its
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

coder is different: it takes tasks only, so it has no conversation and you can't message it. Ask
lead for a code change and lead files a task for coder, which runs it through Claude Code in lead's
project. A card in lead's conversation shows the task and opens to its run, and the result lands
as a line from coder. Talking to a worker never needs a project. The first time a job needs files,
the card asks you to pick one for lead; nothing runs until you do, and the pick sticks to lead.
Picking one from the header works too.

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

Then ask lead *"Have coder fix the typo in the README's first line."* The task card asks for a
project. Pick `relay`: lead files the task again, coder's run shows its steps, and the result lands
in lead's conversation.

After wiring, the lab runs against a real model and a durable store:

```bash
fsdev dev --app @flow-state-dev/teammates
```

Wiring adds the host file, which composes `@flow-state-dev/memory` into each worker's flow: the
capability in `uses` to read it, and `afterAnswer: mem.captureFromItems` to record each turn. It
also adds the lab's one small flow: coder's worker flow, one `harnessManager` per harness over
`projectWorkspace()`, routing each task by the worker's `harness` setting.

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
| A worker's project, and picking it | FIX-2161's `setWorkProject` and the `workProjectId` it writes on the worker's default conversation |
| Task cards, the refusal for want of a project | the conversation board's rows (`listTasks_tasks`), and `projectWorkspace()`'s `no-project` refusal |
| coder's runs | the task row's `run` link, followed with `followRequest` and `useSession`, on a harness picked by coder's `harness` setting |

## What this app adds

Every file in the lab, by kind. `node scripts/inventory.mjs` fails on a file that is none of these,
and on a flow over 200 lines; `--wired` also fails while a fixture is left.

<!-- inventory:start -->
| Kind | Files | Lines |
|---|---:|---:|
| Configuration | 14 | 279 |
| React UI | 16 | 1113 |
| Small flows | 0 | 0 |
| Fixtures (deleted at wiring) | 1 | 353 |
| Checks (not app code) | 3 | 362 |
<!-- inventory:end -->
