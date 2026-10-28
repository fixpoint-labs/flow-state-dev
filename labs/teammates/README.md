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

The lab runs on a real model and a durable SQLite store, served by `fsdev dev`:

```bash
TEAMMATES_PROJECTS='[{"id":"relay","title":"Relay","checkout":"/abs/path/to/a/git/checkout"}]' \
  pnpm --filter @flow-state-dev/teammates dev
```

This builds the pages and serves them with the lab's server (`fsdev.config.mts`). It reads:

| Variable | What it sets | Default |
|---|---|---|
| `TEAMMATES_MODEL` | the model lead, researcher and writer answer on | `openai/gpt-5.4-mini` |
| `TEAMMATES_PROJECTS` | a JSON list of projects to create at start, each `{ "id", "title", "checkout"? }` | none |
| `TEAMMATES_STORE` | the SQLite file | `.fsdev/teammates.sqlite` here |
| `TEAMMATES_USER` | who the page acts as | `you` |
| `TEAMMATES_TREE` | the workers' tree | `workforce/` here |

The model needs a credential the gateway takes (`AI_GATEWAY_API_KEY`), and coder's runs need Claude
Code signed in, or `ANTHROPIC_API_KEY`. A project's `checkout` is a git checkout on this machine;
each coding run works in a worktree of it, so its `.gitignore` must ignore `**/.fsdev/`, where a run
keeps its own notes. A run refuses a checkout that doesn't.

Ask lead *"Ask researcher for our launch date, and help me outline the post."* lead answers and
messages researcher. Before researcher replies, send lead a second line: the reply shows as pending,
then lands after lead's answer, and lead uses it in its next line.

Then ask lead *"Have coder fix the typo in the README's first line."* The task card asks for a
project. Pick `relay`: lead files the task again, coder's run shows its steps, and the result lands
in lead's conversation.

The goal check drives all of this in a browser:
[`goals/teammates-lab/a-worker-talks-to-another-while-you-talk`](../../goals/teammates-lab/a-worker-talks-to-another-while-you-talk/goal.md).

## What the screen reads

Everything the screen reads and writes goes through one adapter, `src/adapter.ts`, and each function
names the package call it makes.

| On screen | Package piece |
|---|---|
| The worker list, sending, the conversation, busy status | the workforce client's `roster()` and `ensureWorkerSession`, the flow's `respond`, session items, `listSessionRequests` |
| Workers messaging each other, the Talk panel | `sendMessage`, the received-message item (`workforce:received`), and the message log |
| A worker's project, and picking it | `setWorkProject`, read back as the conversation's `workProjectId` on the session read |
| Task cards, the refusal for want of a project | the conversation board's rows, and `projectWorkspace()`'s `no-project` refusal |
| coder's runs | the task row's `run` link, read as the run session's items |

Not wired yet:

- **The divider and its *summarized* label** wait on the history window's mark (G1, FIX-1613). Until
  then the screen draws no divider.
- **Which harness coder runs on.** The roster doesn't carry a worker's settings, so the screen names
  the harness from the run's own steps once it starts (FIX-2281).
- **A task whose input has an `issue` field** is refused by the coding run as half a feature payload
  (FIX-2282). lead's `WORKER.md` tells it to leave `input` empty, which only lowers the odds.

## What this app adds

Every file in the lab, by kind. `node scripts/inventory.mjs` fails on a file that is none of these,
and on a flow over 200 lines; `--wired` also fails on any fixture.

<!-- inventory:start -->
| Kind | Files | Lines |
|---|---:|---:|
| Configuration | 16 | 520 |
| React UI | 19 | 1617 |
| Small flows | 1 | 148 |
| Checks (not app code) | 7 | 836 |
<!-- inventory:end -->
