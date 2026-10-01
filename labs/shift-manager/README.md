# Shift Manager

Shift Manager is a browser app for looking into a running Lab: a set of Workforce seats and channels served from one `fsdev.config.mts`. You point it at a Lab's config and it shows what that Lab holds. That covers the teams and their seats, the workstreams, each channel's board, the asks waiting on you, and each channel's transcript, which you can post to.

A task shows one worker's run as it happens, and lets you stop it. The panel on the right follows along, with the team and its tasks at a workstream and the task's details at a task.

It knows nothing about any particular Lab. Every name on screen is read from the Lab while it runs, so the same Shift Manager opens any Lab whose config provides what's listed under [What a Lab's config provides](#what-a-labs-config-provides).

It is research software. Several screens are drawn as placeholders that name what will fill them. They're listed under [What isn't here yet](#what-isnt-here-yet).

## Run it

Build the pages once, then start Shift Manager over a Lab's config:

```bash
pnpm --filter @flow-state-dev/shift-manager build
pnpm --filter @flow-state-dev/shift-manager start --config goals/devforce-lab/lab/fsdev.config.mts
```

It prints the address, `http://127.0.0.1:4300` by default. One process serves the Lab's API under `/api/flows` and Shift Manager's pages beside it. It also serves the devtool over the same Lab, on a port of its own, and prints that address too. The Lab's config is loaded as-is. Nothing in it is edited or wrapped.

| Option | Default | What it does |
|--------|---------|--------------|
| `--config <path>` | required | The Lab's `fsdev.config.mts`. Relative paths resolve from the directory you ran the command in. |
| `--port <n>` | `4300` | `0` picks a free port. |
| `--host <host>` | `127.0.0.1` | A non-loopback host is refused unless the Lab authenticates requests. |
| `--assets <dir>` | `dist/` | Serve a different build of the pages. |
| `--devtool <url>` | the devtool Shift Manager serves | Point a task's *Open trace* link at a devtool you run yourself instead. Must be an `http(s)` address. Shift Manager then serves no devtool of its own. |
| `--devtool-assets <dir>` | the `@flow-state-dev/devtool` build | Serve a different build of the devtool's pages. |
| `--shift <day\|night>` | `SHIFT_MANAGER_SHIFT`, else unset | Start on the light (`day`) or dark (`night`) look and keep it, whatever the OS setting. Unset, the page follows the OS. |

The process runs from the directory you started it in, so a Lab's relative paths, such as a SQLite file, land where they would under `fsdev dev`.

A config that doesn't load, or doesn't default-export a `FlowState`, stops the command with the loader's own message.

### Working on the pages

```bash
pnpm --filter @flow-state-dev/shift-manager start --config <lab config>   # the Lab, on :4300
pnpm --filter @flow-state-dev/shift-manager dev                            # Vite, proxying /api to it
```

Set `VITE_LAB_URL` to proxy to a Lab on another address.

## What a Lab's config provides

Shift Manager reads a Lab only through the routes its `FlowState` serves. It doesn't build anything for the Lab, so the config has to export a server that is already set up. The first five items below happen in the config, or in a module it imports, before the default export. The last is frontmatter in the Lab's documents.

**A `FlowState`, as the default export.** Build it and finish the boot steps below first. An `.mts` config can use top-level `await`. If the Lab keeps its assembly in a host module, have that module return the `FlowState` so the config can export it:

```ts title="fsdev.config.mts"
import { openLab } from "./host.mts"; // the Lab's own assembly

const lab = await openLab({ /* the Lab's own options */ });

export default lab.state;
```

**An organization.** Every request a Lab serves runs in an organization, and Shift Manager shows it in the sidebar. A Lab names its own with `resolvePrincipal` on `createFlowState`, which returns who a request is:

```ts
import { createFlowState, inMemoryStores } from "@flow-state-dev/engine";

const state = createFlowState({
  flows,
  stores: { default: { primary: inMemoryStores() } },
  resolvePrincipal: () => ({ userId: "u_lab", orgId: "org_lab" }),
});
```

A Lab with no resolver runs in the framework's development organization, `DEFAULT_ORG_ID` from `@flow-state-dev/core`, and Shift Manager shows that id. Anything the boot writes under an organization, such as the inventory below, has to use the same one.

**Open channels.** Call `openChannels` at boot with the same `userId` you give Shift Manager in `devtool: { userId }` (below). Each channel is a workstream. Shift Manager reads the organization off that user's sessions, so a Lab that holds none for them opens to a screen saying it names no organization, in place of the Lab.

**An open inventory.** The [inventory](../../apps/docs/docs/workforce/inventory.md) is the organization's record of its seats and channels. TEAMS and PROJECTS list it, and Inbox and the boards find seats and workstreams through it. It takes two steps:

1. Build the channel flow with the actions that write the inventory: `defineChannelFlow({ notify, inventory: true })` for a channel kind of your own, or `channelInstances(channels, { inventory: true })` for the built-in one.
2. Call `openInventory` once `openChannels` has returned, under the organization your resolver names.

```ts
// `roster` is the tree read with `readDeclaredRoster`, `hired` the seats
// `hireWorkforce` returned, and `client` the session client `openChannels` takes.
await openChannels(roster.channels, { client, userId: "u_lab" });
const opened = await openInventory(
  { seats: hired.map((seat) => ({ id: seat.id, kind: seat.kind })), channels: roster.channels },
  { run, seatWriter: { flowKind: "channel" }, userId: "u_lab", orgId: "org_lab" },
);
if (opened.problems.length > 0) throw new Error(opened.problems.join("; "));
```

`run` executes one action for `openInventory` and throws when it fails:

```ts
import { runAction } from "@flow-state-dev/engine";
import type { InventoryActionRequest } from "@flow-state-dev/workforce";

const runtime = await state.getRuntime();
const run = async (request: InventoryActionRequest) => {
  const result = await runAction({
    flow: flowsByKind[request.flowKind], // the channel flow and each seat, by kind or id
    actionName: request.action,
    input: request.input,
    userId: request.userId,
    orgId: request.orgId,
    sessionId: request.sessionId,
    source: request.source, // the seat rows are written only when this reaches runAction
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  });
  if (result?.error !== undefined) throw new Error(String(result.error));
  return result;
};
```

Without an inventory, TEAMS and PROJECTS each say there is none to read, and the other sections load. The [Inventory](../../apps/docs/docs/workforce/inventory.md) page covers both calls in full.

**Who Shift Manager reads as.** Set `devtool: { userId }` on `createFlowState`, and add `bearerToken` when the resolver checks one. These are the settings `fsdev dev` hands the DevTool. Shift Manager passes them to the page only when `--host` is a loopback address. If the Lab turns down Shift Manager's first request because it carries no organization the resolver accepts, Shift Manager shows the Lab's answer in place of the Lab.

**Documents a browser may read.** Jump to lists a declared document (a `.md` under a `resources/` folder of the Lab's tree) only when its frontmatter lets a browser read it:

```md
---
description: How this team works.
client:
  content:
    read: true
---
```

It's listed once a session whose flow serves it exists. A document without that line stays out of Jump to.

`test/fixtures/ask-lab/lab.mts` is a small Lab that does all of the above in one file.

## What you see

- **Sidebar.** The organization, Jump to (⌘K), Inbox and Tasks with their counts, PROJECTS (the workstreams, until projects exist), and TEAMS: each team in the Lab's seat inventory, with exactly its seats.
- **Jump to (⌘K).** Finds workstreams, seats, tasks and the Lab's [readable documents](#what-a-labs-config-provides). A document opens read-only.
- **Inbox.** Every approval or question a seat is waiting on you for, oldest first. You answer it on its card, and can reply to the worker under it. An ask from a run the Lab started by itself, such as a seat woken by a channel post, is shown without buttons, and its card says why: the Lab never reopens those runs from outside.
- **Tasks.** Every row on every attached board that isn't done, grouped by state, worker or workstream.
- **A workstream.** One channel and the boards attached to it. It has four tabs: Stream (the transcript, the composer, and its members' asks), Board (five columns: QUEUED, RUNNING, NEEDS YOU, IN REVIEW, DONE), Brief (the channel's charter) and Results. The right panel lists the channel's members with their status, and its rows by column.
- **A task.** One task's run, live, with Interrupt. See [A task](#a-task).

A post appears in the transcript only once the channel has kept it. Until then the composer keeps your draft and says it's posting. If the post is refused, the draft stays and the reason is shown.

**Talking to a worker.** Start a line with `@` and a worker's name to send it to that worker's task in this workstream instead of the channel. If it has several, the composer asks which. If it has none, Send is off and says so. In a task, the composer sends to that task's run. From Inbox, the reply box sends to the worker that asked, if its kind takes messages. A worker whose kind takes no message gets a reply box that says so.

A running coding run stops where it is and carries on in the same session with your message. The composer says *delivered* once the run's session holds your line, not before. If the worker refuses it, your draft stays and its reason is shown. If the line never reached the Lab, Retry sends it again. If it may have arrived but Shift Manager can't confirm it, the draft stays and there's no Retry, so it isn't sent twice. A finished task takes no message.

To make your own worker kind take messages, give it one public action that declares `userMessage` and takes `{ message }`. Shift Manager sends lines there, using the `door` on the seat's inventory row.

Each section loads on its own. If one read fails, that section says what the Lab answered and offers Retry, and the rest of the screen still draws.

## A task

Open a task from Tasks or from a card on a board. The Session tab is that task's own run: every step the worker takes, the tool calls and edits as they happen, and earlier attempts above them when they ran in the same place. It isn't the worker's chat, so what you read is what the task did. If the worker keeps one session for several tasks, the tab shows only this task's steps and says the session is shared. A task handed off a moment ago shows its run once the run starts. The screen checks for it every 2 seconds for up to a minute, then offers Retry.

**Interrupt** stops the run (Esc does the same while the Session has focus). The screen says *interrupted* once the run has actually stopped. What happens to the task afterwards, whether it's retried or left, is up to the board, not Shift Manager.

The panel on the right shows who is on it and when it started. If the harness records its plan and the files it touched, as Claude Code does, they're listed. Otherwise the panel says so. *Open trace* opens the run's session in the devtool, for the full detail, with the session id beside the link.

The devtool it opens is the one Shift Manager serves: the same pages `fsdev dev` serves, over the same Lab, in the same process. That matters because the devtool can only show a run from the store the run is in. A Lab whose stores are in memory lives only in Shift Manager's process, so a devtool started separately has its own empty store. The link adds `?session=<id>`, and the devtool opens the session under the flow that owns it.

The devtool's pages ship prebuilt in the published `@flow-state-dev/devtool` package. In this repository, build them once with `pnpm build:assets`. Without them Shift Manager still starts, says so, and the link is off.

To use a devtool you run yourself, pass its address. It has to read the same store as Shift Manager, as the same user, so this suits a Lab with a persistent store, such as SQLite:

```bash
pnpm --filter @flow-state-dev/shift-manager start --config <your config> --devtool http://localhost:4000
```

### Not there yet

| On the task screen | Shows today | Filled in by |
|---|---|---|
| Hand off, reassign, Open PR | Disabled | The eng workstream kit |
| Diff and Checks | An empty tab saying so | The eng workstream kit |
| Acceptance criteria, who reviews | An empty section | The eng workstream kit |
| Which harness, tokens and cost | An empty field saying so | Attention and inspect |
| A harness that records no plan | A line saying so | Attention and inspect |
| A task's context and input, on Brief | A line saying so | Not planned yet. The board doesn't publish them to a browser |

A board that hands work off keeps each task on the worker it was given to, which is why reassigning is off rather than refused.

## What isn't here yet

Each of these is drawn as a named empty state or a disabled control:

- **Projects.** The project level's tabs, and a project's own workstreams.
- **Parts of the task screen.** Listed under [A task](#not-there-yet).
- **Posting a task's message to its workstream too.** Sending to the worker and posting to the channel are two separate things for now.
- **Worker detail.** A seat's harness, and the NOW, TIME and COST columns on Tasks.
- **IN REVIEW.** The column is drawn empty, because no row status means "in review" yet.

## How it looks

Shift Manager's look comes from the [design-system](../design-system) package, through one import in `src/styles.css`. It follows your operating system's light or dark setting, and switches when you change it. Remove that import and every screen falls back to the registry's neutral defaults.

To pin the look instead, start on a shift: `--shift day` for light, `--shift night` for dark, or set `SHIFT_MANAGER_SHIFT` to either. The flag wins when both are set. Each shift is a file under `profiles/` naming its colour scheme. The page then keeps that look for as long as it's open and ignores the OS setting. There's no switch on the page itself. Restart on the other shift to change it.

The cards in a task's Session, and the ask cards in Inbox and in a workstream's Stream, are Shift Manager's copies of `@flow-state-dev/ui` registry components, kept unedited. The `ui:add` script in `package.json` names what was installed (`chat-assistant`, which brings the message, reasoning, tool, code block, task plan and ask cards with it). `chat-assistant` brings its whole dependency closure, so Shift Manager also holds copies it doesn't draw today (the debate, evented-actors, routed-specialists and audit-annotation containers) and the libraries they need, such as `shiki`, `streamdown` and `motion`. A test checks that the copies are exactly what that list ships, byte for byte.

## Tests

```bash
pnpm --filter @flow-state-dev/shift-manager test
pnpm --filter @flow-state-dev/shift-manager typecheck
```

The tests serve a real Lab in-process (`test/fixtures/ask-lab`) and compare what the reads and screens show with what the Lab's routes hold. The end-to-end check is a goal check. It builds Shift Manager, serves it over both goal Labs, and walks every screen in Chromium:

```bash
PLAYWRIGHT_BROWSERS_PATH=<your Chromium pool> pnpm tsx goals/shift-manager/it-opens-a-lab/run.mts
```

A second goal check opens tasks on a Lab whose runs hold until stopped. It watches each run live in Chromium, interrupts it, and compares the screen with the run's stored session and request:

```bash
PLAYWRIGHT_BROWSERS_PATH=<your Chromium pool> pnpm tsx goals/shift-manager/it-shows-and-stops-a-task-run/run.mts
```

A third builds Shift Manager twice, as written and with its theme import removed, and reads the colours and fonts Chromium paints on the shell and on each registry card in a task's Session. With the import, every one is a Shift Manager value. Without it, none is:

```bash
PLAYWRIGHT_BROWSERS_PATH=<your Chromium pool> pnpm tsx goals/shift-manager/it-takes-its-look-from-the-design-system/run.mts
```
