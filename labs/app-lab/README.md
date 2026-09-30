# App Lab

App Lab is a browser app for looking into a running Lab: a set of Workforce seats and channels served from one `fsdev.config.mts`. You point it at a Lab's config and it shows what that Lab holds. That covers the teams and their seats, the workstreams, each channel's board, the asks waiting on you, and each channel's transcript, which you can post to.

It knows nothing about any particular Lab. Every name on screen is read from the Lab while it runs, so the same App Lab opens any Lab whose config default-exports a `FlowState`.

It is research software. Several screens are drawn as placeholders that name what will fill them. They're listed under [What isn't here yet](#what-isnt-here-yet).

## Run it

Build the pages once, then start App Lab over a Lab's config:

```bash
pnpm --filter @flow-state-dev/app-lab build
pnpm --filter @flow-state-dev/app-lab start --config goals/devforce-lab/lab/fsdev.config.mts
```

It prints the address, `http://127.0.0.1:4300` by default. One process serves the Lab's API under `/api/flows` and App Lab's pages beside it. The Lab's config is loaded as-is. Nothing in it is edited or wrapped.

| Option | Default | What it does |
|--------|---------|--------------|
| `--config <path>` | required | The Lab's `fsdev.config.mts`. Relative paths resolve from the directory you ran the command in. |
| `--port <n>` | `4300` | `0` picks a free port. |
| `--host <host>` | `127.0.0.1` | A non-loopback host is refused unless the Lab authenticates requests. |
| `--assets <dir>` | `dist/` | Serve a different build of the pages. |

The process runs from the directory you started it in, so a Lab's relative paths, such as a SQLite file, land where they would under `fsdev dev`.

A config that doesn't load, or doesn't default-export a `FlowState`, stops the command with the loader's own message.

### Who you are

App Lab reads the same connection settings `fsdev dev` hands the DevTool. That is the Lab's `devtool.userId` and, if the Lab declares one, its `devtool.bearerToken`. They are injected into the page on a loopback bind only. If the Lab refuses your first read for want of a verified organization, App Lab shows that refusal and nothing else.

### Working on the pages

```bash
pnpm --filter @flow-state-dev/app-lab start --config <lab config>   # the Lab, on :4300
pnpm --filter @flow-state-dev/app-lab dev                            # Vite, proxying /api to it
```

Set `VITE_LAB_URL` to proxy to a Lab on another address.

## What you see

- **Sidebar.** The organization, Jump to (⌘K), Inbox and Tasks with their counts, PROJECTS (the workstreams, until projects exist), and TEAMS: each team in the Lab's seat inventory, with exactly its seats.
- **Jump to (⌘K).** Finds workstreams, seats, tasks and the Lab's declared documents. A document opens read-only. Only documents whose frontmatter lets a browser read them (`client: { content: { read: true } }`) are listed, and only once a session whose flow serves them exists.
- **Inbox.** Every approval or question a seat is waiting on you for, oldest first. You answer it on its card. An ask from a run the Lab started by itself, such as a seat woken by a channel post, is shown without buttons, and its card says why: the Lab never reopens those runs from outside.
- **Tasks.** Every row on every attached board that isn't done, grouped by state, worker or workstream.
- **A workstream.** One channel and the boards attached to it. It has four tabs: Stream (the transcript, the composer, and its members' asks), Board (five columns: QUEUED, RUNNING, NEEDS YOU, IN REVIEW, DONE), Brief (the channel's charter) and Results. The right panel lists the channel's members with their status, and its rows by column.
- **A task.** The row as its board holds it, with the task screen's tabs.

A post appears in the transcript only once the channel has kept it. Until then the composer keeps your draft and says it's posting. If the post is refused, the draft stays and the reason is shown.

Each section loads on its own. If one read fails, that section says what the Lab answered and offers Retry, and the rest of the screen still draws.

## What isn't here yet

Each of these is drawn as a named empty state or a disabled control:

- **Projects.** The project level's tabs, and a project's own workstreams.
- **The task screen.** Its Session, Diff, Checks and Brief tabs, and the right panel's task inspector.
- **Addressing one seat.** A line starting with `@` can't be sent yet.
- **Worker detail.** A seat's harness, and the NOW, TIME and COST columns on Tasks.
- **IN REVIEW.** The column is drawn empty, because no row status means "in review" yet.

## Tests

```bash
pnpm --filter @flow-state-dev/app-lab test
pnpm --filter @flow-state-dev/app-lab typecheck
```

The tests serve a real Lab in-process (`test/fixtures/ask-lab`) and compare what the reads and screens show with what the Lab's routes hold. The end-to-end check is a goal check. It builds App Lab, serves it over both goal Labs, and walks every screen in Chromium:

```bash
PLAYWRIGHT_BROWSERS_PATH=<your Chromium pool> pnpm tsx goals/app-lab/it-opens-a-lab/run.mts
```
