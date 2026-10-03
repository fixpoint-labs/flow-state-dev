# Shift Manager

Shift Manager is the browser app you run a Workforce team through. A team is served as a Lab: a set of Workforce seats and channels from one `fsdev.config.mts`. You point Shift Manager at a Lab's config, or open one of the [team profiles](#team-profiles) this package ships, and it shows what that Lab holds. It opens on Shift Coordinator: a summary of what's waiting on you and what's running, and a conversation with the Lab's chief-of-staff seat. From there it shows the teams and their seats, the workstreams, each channel's board, the asks waiting on you, and each channel's transcript, which you can post to.

A task shows one worker's run as it happens, and lets you stop it. The panel on the right follows along, with the team and its tasks at a workstream and the task's details at a task.

It knows nothing about any particular Lab. Every name on screen is read from the Lab while it runs, so the same Shift Manager opens any Lab whose config provides what's listed under [What a Lab's config provides](#what-a-labs-config-provides).

It is research software. Several screens are drawn as placeholders that name what will fill them. They're listed under [What isn't here yet](#what-isnt-here-yet).

## Run it

Build the pages once, then start Shift Manager over a team profile or a Lab's config:

```bash
pnpm --filter @flow-state-dev/shift-manager build
pnpm --filter @flow-state-dev/shift-manager start --team devteam
pnpm --filter @flow-state-dev/shift-manager start --config <path to a Lab's fsdev.config.mts>
```

It prints the address, `http://127.0.0.1:4300` by default. One process serves the Lab's API under `/api/flows` and Shift Manager's pages beside it. It also serves the devtool over the same Lab, on a port of its own, and prints that address too. The Lab's config is loaded as-is. Nothing in it is edited or wrapped.

| Option | Default | What it does |
|--------|---------|--------------|
| `--config <path>` | | The Lab's `fsdev.config.mts`. Relative paths resolve from the directory you ran the command in. |
| `--team <name>` | | A team profile from `teams/`, by folder name. Give `--team` or `--config`, not both. |
| `--port <n>` | `4300` | `0` picks a free port. |
| `--host <host>` | `127.0.0.1` | A non-loopback host is refused unless the Lab authenticates requests. |
| `--assets <dir>` | `dist/` | Serve a different build of the pages. |
| `--devtool <url>` | the devtool Shift Manager serves | Point a task's *Open trace* link at a devtool you run yourself instead. Must be an `http(s)` address. Shift Manager then serves no devtool of its own. |
| `--devtool-assets <dir>` | the `@flow-state-dev/devtool` build | Serve a different build of the devtool's pages. |
| `--shift <day\|night>` | `SHIFT_MANAGER_SHIFT`, else unset | Start on the light (`day`) or dark (`night`) look, whatever the OS setting. Unset, the page follows the OS. A shift picked in the sidebar's switch wins over the flag and the variable. See [How it looks](#how-it-looks). |

The process runs from the directory you started it in, so a Lab's relative paths, such as a SQLite file, land where they would under `fsdev dev`.

A config that doesn't load, or doesn't default-export a `FlowState`, stops the command with the loader's own message.

### Team profiles

A team profile is a Lab's config kept in this package, under `teams/<name>/fsdev.config.mts`, so you can open it by name. This package ships one:

- **`devteam`** is a software team. An EM seat files features as rows on the team's board, a coder seat runs each row as a supervised coding run, and a reviewer seat is declared but never woken. On start the EM asks you to approve one feature, so Inbox has something in it. It also opens with two projects you own: Storefront, which holds a workstream from each of the two teams, and Platform, which holds none yet. The EM answers every line posted in a project's room. Rows run on a scripted harness with no model unless `DEVFORCE_LAB_HARNESS=claude-code` is set. Its tree and the checks behind it are in [`goals/devforce-lab/lab/`](../../goals/devforce-lab/lab/README.md). It keeps what it holds in SQLite at `labs/shift-manager/.fsdev/devteam.sqlite` (or at `DEVTEAM_STORE`), so projects, their rooms and your talk sessions survive a restart. Delete the file to start fresh.

One process opens one team. Passing `--team` or `--config` twice stops the command.

### Working on the pages

```bash
pnpm --filter @flow-state-dev/shift-manager start --config <lab config>   # the Lab, on :4300
pnpm --filter @flow-state-dev/shift-manager dev                            # Vite, proxying /api to it
```

Set `VITE_LAB_URL` to proxy to a Lab on another address.

## What a Lab's config provides

Shift Manager reads a Lab only through the routes its `FlowState` serves. It doesn't build anything for the Lab, so the config has to export a server that is already set up. Documents and the chief of staff are files in the Lab's tree.

**A `FlowState`, as the default export.** Build it and finish the setup below first. An `.mts` config can use top-level `await`. If the Lab keeps its assembly in a host module, have that module return the `FlowState` so the config can export it:

```ts title="fsdev.config.mts"
import { openLab } from "./host.mts"; // the Lab's own assembly

const lab = await openLab({ /* the Lab's own options */ });

export default lab.state;
```

A host module can do some of this setup for you. When its options say they open the inventory or hand the page the Lab's user, turn them on and leave the matching `openInventory` call and `devtool` setting out of the config. The same goes for the organization and the channels when the host names its own `resolvePrincipal` and calls `openChannels` itself. The config then only picks the store and the options, and default-exports the `FlowState` the host returns. The [`devteam`](#team-profiles) profile's config works this way:

```ts title="teams/devteam/fsdev.config.mts (excerpt)"
const lab = await openLab({
  stores: inMemoryStores(),
  inventory: true, // its host opens the channels, then the inventory
  devtool: true, // its host hands the page the Lab's user
  // ...options of its own
});

export default lab.state;
```

**A store.** Set it with `stores: { default: { primary: <adapter> } }` on `createFlowState`. Any adapter works. They differ in what survives a restart:

| Adapter | Import | The Lab after a restart |
|---------|--------|-------------------------|
| `inMemoryStores()` | `@flow-state-dev/engine` | Empty. Sessions, asks, board rows and the inventory are gone, and each start is a fresh Lab. |
| `sqliteStores({ filename })` | `@flow-state-dev/store-sqlite` | Kept in the file. A relative `filename` lands under the directory you ran the command in. |
| `postgresStores(options)` | `@flow-state-dev/store-postgres` | Kept in the database. |

To open a Lab and work it, use `inMemoryStores()`. Pick SQLite or Postgres when the Lab should keep what it holds across a restart. [`goals/multi-seat-collab/lab/fsdev.config.mts`](../../goals/multi-seat-collab/lab/fsdev.config.mts) runs on SQLite.

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

**A chief of staff, if you want one.** On the Shift Coordinator screen, Shift Manager talks to the seat named `chief-of-staff`, whether it's an org seat or a team's worker. Declare it like any other worker, on the built-in `agent` kind, with instructions that say what it should do for the person running the Lab:

```md title="workforce/teams/<team>/workers/chief-of-staff/WORKER.md"
---
description: The person's one point of contact.
flow: agent
model: openai/gpt-5.4-mini
---
You are the chief of staff for this team. Answer questions about who is working on what.
```

What it can do is up to its instructions and the tools you give it. Shift Manager only carries your lines to it and shows what it answers. A Lab with two seats of that name gets a line naming both, and Shift Manager talks to neither.

A Lab with no chief of staff needs nothing in its config. Every screen works, and Shift Coordinator shows the summary of asks and runs. Where the conversation would be, it says "This Lab declares no shift coordinator" and how to declare a `chief-of-staff` seat. That message needs an open inventory (above). With no inventory, the conversation area shows an error about the inventory instead.

`test/fixtures/ask-lab/lab.mts` is a small Lab that does all of the above in one file.

## What you see

- **Shift Coordinator.** Where Shift Manager opens, at `/` or `/cos`. The top of the screen is Shift Manager's own summary of the shift: how many asks wait on you, each one with the same Approve and Reject you'd get in Inbox, and how many runs are going across how many workstreams. The numbers are the ones Inbox and Tasks show. Below it is your conversation with the Lab's chief-of-staff seat. A line goes through the seat's door, like any other line you send to a worker, and shows *delivered* once the seat's session holds it. The reply is what the seat wrote in that session. Come back later and the same conversation is there. The panel on the right lists each workstream with its running tasks and the asks its members have raised, and the workers on call, as Roster counts them.

  A Lab with no chief-of-staff seat still opens here. You get the summary, and in place of the conversation a line saying how to add one.
- **Sidebar.** The organization, Jump to (⌘K), Shift Coordinator, Inbox and Tasks with their counts, Roster with how many workers are on shift and on call, PROJECTS (each project with its workstreams, then No project), and TEAMS: one row per team in the Lab's seat inventory, with how many of its workers are on shift and a square for each worker. Organization-level workers, such as a chief of staff, sit in one Staff row at the top. A worker hired while the Lab runs is listed only while the organization's roster has its row, so a fired worker leaves the list, including one fired before Workforce removed inventory rows on a fire. When no flow the person uses lets Shift Manager read the roster, hired workers aren't listed and TEAMS says how many were left out. Hover a square for the worker and its status. Click a team to open Roster for that team. The footer repeats the on-shift and on-call counts.
- **Jump to (⌘K).** Finds Shift Coordinator, workstreams, seats, tasks and the Lab's [readable documents](#what-a-labs-config-provides). A seat opens Roster. A document opens read-only.
- **Inbox.** Every approval or question a seat is waiting on you for, oldest first. You answer it on its card, and can reply to the worker under it. An ask from a run the Lab started by itself, such as a seat woken by a channel post, is shown without buttons, and its card says why: the Lab never reopens those runs from outside.
- **Tasks.** Every row on every attached board that isn't done, grouped by state, worker or workstream.
- **Roster.** Every worker in the Lab, grouped by whether it's on shift, on call or off shift. Pick a team at the top to see only its workers. See [Roster](#roster).
- **PROJECTS.** Each of the Lab's projects by title, with the workstreams its record lists beneath it. A project with no workstreams is still listed. Workstreams no project lists sit under **No project**, which shows only when there is one. Clicking the PROJECTS heading opens No project.
- **A project.** Four tabs. **Stream** is the project's room: one conversation its members share with the project's seats. You read and post through your own talk session on the project. A member who has none gets Join, and someone who isn't a member is told the room is for its members and sees none of it. The room opens at its newest lines, and **Load earlier** reads the page before them. Every read is a small recorded request on your talk session, so the room reads only at set times: when you open it, when the window gets focus, when you come back to the tab, and after you post. Each of those starts a short run of reads, about a second apart while lines are arriving and further apart as it goes quiet. After about 45 quiet seconds the room stops reading. That is how the seats' answers to your post show up. A room left open and idle doesn't fetch anything new. Other members' lines appear the next time you open the room, focus the window, come back to the tab, or post. **Board** draws a lane for each of its workstreams that holds a board. **Workstreams** lists the workstreams the project holds, and **Brief** is the project's brief. No project has no room and no brief, and says so.
- **A workstream.** One channel and the boards attached to it. It has four tabs: Stream (the transcript and the composer), Board (five columns: QUEUED, RUNNING, IN REVIEW, NEEDS YOU, DONE; a done task is one line, its id and title), Brief (the channel's charter) and Results. A member's ask shows up in the transcript at the time it was raised, marked NEEDS YOU. Answering it there clears it from Inbox. The right panel lists the channel's members with their status, and its rows by column.
- **A task.** One task's run, live, with Interrupt. See [A task](#a-task).

A post appears in the transcript only once the channel has kept it. Until then the composer keeps your draft and says it's posting. If the post is refused, the draft stays and the reason is shown.

**Talking to a worker.** Start a line with `@` and a worker's name to send it to that worker's task in this workstream instead of the channel. If it has several, the composer asks which. If it has none, Send is off and says so. In a task, the composer sends to that task's run. From Inbox, the reply box sends to the worker that asked, if its kind takes messages. A worker whose kind takes no message gets a reply box that says so.

A running coding run stops where it is and carries on in the same session with your message. The composer says *delivered* once the run's session holds your line, not before. If the worker refuses it, your draft stays and its reason is shown. If the line never reached the Lab, Retry sends it again. If it may have arrived but Shift Manager can't confirm it, the draft stays and there's no Retry, so it isn't sent twice. A finished task takes no message.

To make your own worker kind take messages, give it one public action that declares `userMessage` and takes `{ message }`. Shift Manager sends lines there, using the `door` on the seat's inventory row.

Each section loads on its own. If one read fails, that section says what the Lab answered and offers Retry, and the rest of the screen still draws.

## A task

Open a task from Tasks or from a card on a board. The Session tab is that task's own run: every step the worker takes, the tool calls and edits as they happen, and earlier attempts above them when they ran in the same place. It isn't the worker's chat, so what you read is what the task did. If the worker keeps one session for several tasks, the tab shows only this task's steps and says the session is shared. A task handed off a moment ago shows its run once the run starts. The screen checks for it every 2 seconds for up to a minute, then offers Retry.

**Interrupt** stops the run (Esc does the same while the Session has focus). The line above the composer names the worker and the run's state: *running*, then *interrupted* once the run has actually stopped. What happens to the task afterwards, whether it's retried or left, is up to the board, not Shift Manager.

When the run stops to ask you something, the ask appears in the Session where the run stopped, on the same card Inbox uses, and you can answer it there. The panel on the right shows it too, with how long it has waited and a link to it in Inbox.

The panel on the right shows who is on it and when it started. If the harness records its plan and the files it touched, as Claude Code does, they're listed. Otherwise the panel says so. *Open trace* opens the run's session in the devtool, for the full detail, with the session id beside the link.

The devtool it opens is the one Shift Manager serves: the same pages `fsdev dev` serves, over the same Lab, in the same process. That matters because the devtool can only show a run from the store the run is in. A Lab whose stores are in memory lives only in Shift Manager's process, so a devtool started separately has its own empty store. The link adds `?session=<id>`, and the devtool opens the session under the flow that owns it.

The devtool's pages ship prebuilt in the published `@flow-state-dev/devtool` package. In this repository, build them once with `pnpm build:assets`. Without them Shift Manager still starts, says so, and the link is off.

To use a devtool you run yourself, pass its address. It has to read the same store as Shift Manager, as the same user, so this suits a Lab with a persistent store, such as SQLite:

```bash
pnpm --filter @flow-state-dev/shift-manager start --config <your config> --devtool http://localhost:4000
```

### What a coding run is handed

When you approve a feature in Inbox, or post `slug: what to build` on a workstream, the team's own coordinator seat, not the `chief-of-staff` seat behind Shift Coordinator, files it as a task and a coder seat picks it up as a coding run. In the `devteam` profile, the run's prompt holds, in this order:

- **The task.** The feature you approved, or what you posted after `slug:`, word for word.
- **The seat's own files.** Its instructions, the document it names (the team's standing brief), and its skills.
- **The workstream's charter**, the description on its Brief tab, when the coder seat is a member of that workstream.
- **Where and how to work.** Its own checkout and branch, and what counts as done.

It never gets the coordinator seat's session or the workstream's transcript. Anything a run needs from a conversation has to be written on the task. A message you send to a running task reaches it separately, as described under *Talking to a worker* in [What you see](#what-you-see).

Other Labs build their own prompts from the same task fields. See [`run.task`](../../apps/docs/docs/orchestration/harness-manager.md) in the harness manager docs.

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

## Roster

Roster shows every worker the Lab's seat inventory lists, in three groups:

- **On shift**: it holds a task that is running.
- **On call**: nothing of its is running, but it is waiting on you, either on a task it parked for you or on an ask in Inbox.
- **Off shift**: neither. A worker with only queued tasks is off shift until it claims one.

Each worker shows its team and kind, how many slots it has in use (one square per task it holds), the tasks it holds, and what it is waiting on. Click a task to open it. The counts at the top are for the workers shown.

The same status appears in the sidebar and in a workstream's panel, so a worker reads the same everywhere. If the Lab's asks didn't load, each of those places marks its status *partial*: a worker waiting on you only through an ask would read off shift.

Roster is read with the rest of the screen, when Shift Manager starts, on Retry and after you answer an ask. It says when it was read. It doesn't refresh on its own.

Slots count what a worker holds now. Nothing in a Lab limits how many tasks a worker takes, so Roster shows no capacity and no free slots.

## What isn't here yet

Each of these is drawn as a named empty state or a disabled control:

- **Parts of the task screen.** Listed under [A task](#not-there-yet).
- **Posting a task's message to its workstream too.** Sending to the worker and posting to the channel are two separate things for now.
- **Worker detail.** A seat's harness, and the NOW, TIME and COST columns on Tasks.
- **IN REVIEW.** The column is drawn empty, because no row status means "in review" yet.
- **What a worker is on call for, beyond you.** Webhooks, schedules and other standing watches arrive with the standing routines work. Until then on call means waiting on you, and a worker that only waits for a webhook reads off shift.
- **A declared map from a task's assignee to its worker.** Shift Manager matches the assignee to a worker by id, then by a unique name, then by who is in the channel. A task whose assignee matches no single worker counts for no one, so that worker can read off shift while it works.

## How it looks

Shift Manager's look comes from the [design-system](../design-system) package, through one import in `src/styles.css`. Remove that import and every screen falls back to the registry's neutral defaults.

The page is on one of two shifts: the day shift is light, the night shift is dark. The switch at the bottom of the sidebar shows which one you're on. Click the other half and the whole page changes on the spot. Your pick is kept in that browser, so it holds through reloads and restarts until you click again. In a browser that blocks site data for the page, the pick lasts until you reload.

Until you pick, the page takes the shift it was started on: `--shift day` or `--shift night`, or `SHIFT_MANAGER_SHIFT` set to either. The flag wins when both are set. Started on neither, it follows your operating system's light or dark setting, and changes with it.

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

A fourth serves a Lab of two teams whose workers are put into each status on purpose, opens Roster for all teams and for each one, and compares every worker's status, slots, tasks and waits with the Lab's store:

```bash
PLAYWRIGHT_BROWSERS_PATH=<your Chromium pool> pnpm tsx goals/shift-manager/it-shows-who-is-on-shift/run.mts
```

A fifth sends a line to a Lab's chief-of-staff seat, which runs a real model, and answers an ask from the summary. It compares the summary, the conversation and the reply with what the store holds. It needs a model key, such as `AI_GATEWAY_API_KEY`, in the environment:

```bash
PLAYWRIGHT_BROWSERS_PATH=<your Chromium pool> pnpm tsx goals/shift-manager/it-briefs-and-talks-with-the-chief-of-staff/run.mts
```

A sixth compares what Chromium paints with v2, the reference design the [design-system](../design-system) package is drawn from. It walks every screen in both shifts, at a wide and a narrow window. On every screen it checks that v2's two fonts actually loaded, that no corner is rounded, and that the highlight marks only what waits on you. On the sidebar and the parts every screen shares, it also checks each element's typeface and size, surface and border, and the column widths. A failure names the element, the screen, the shift and width, and the line of v2 it departs from. Its Labs run on scripted models, so it needs no model key:

```bash
PLAYWRIGHT_BROWSERS_PATH=<your Chromium pool> pnpm tsx goals/shift-manager/it-draws-v2s-look/run.mts
```
