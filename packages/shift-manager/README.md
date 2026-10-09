# Shift Manager

Shift Manager is the browser app you run a Workforce team through. A team is served as a Lab: a set of Workforce workers and mailboxes from one `fsdev.config.mts`. You point Shift Manager at a Lab's config, and it shows what that Lab holds. It opens on Shift Coordinator: a summary of what's waiting on you and what's running, and a conversation with the Lab's chief-of-staff worker. From there it shows the teams and their workers, the workstreams, each mailbox's board, the asks waiting on you, and each mailbox's transcript, which you can post to.

A task shows one worker's run as it happens, and lets you stop it. The panel on the right follows along, with the team and its tasks at a workstream and the task's details at a task.

It knows nothing about any particular Lab. Every name on screen is read from the Lab while it runs, so the same Shift Manager opens any Lab whose config provides what's listed under [What a Lab's config provides](#what-a-labs-config-provides).

It is research software. Several screens are drawn as placeholders that name what will fill them. They're listed under [What isn't here yet](#what-isnt-here-yet).

## Run it

Install it in the project that holds your Lab's config, then point it at that config:

```bash
npm install @flow-state-dev/shift-manager
npx shift-manager --config ./fsdev.config.mts
```

Without `--config`, it looks for `fsdev.config.ts` (or `.mts`, `.js`, `.mjs`) in the current directory, the way `fsdev dev` does. It prints its address, `http://127.0.0.1:4300` by default, and opens it. One process serves the Lab's API under `/api/flows`, Shift Manager's pages, and the DevTool (`@flow-state-dev/devtool`) over the same Lab on a port of its own.

| Option | Default | What it does |
|--------|---------|--------------|
| `--config <path>` | `fsdev.config.*` in the current directory | The Lab's config. A relative path resolves from where you ran the command. |
| `--port <n>` | `4300` | `0` picks a free port. |
| `--host <host>` | `127.0.0.1` | A non-loopback host is refused unless the Lab authenticates requests, and always refused for a Lab that hands its page a bearer token. |
| `--shift <day\|evening\|night>` | `SHIFT_MANAGER_SHIFT`, else unset | Start on that theme. Unset, the page starts on the theme your clock calls for (see [Themes](#themes)). |
| `--dev` | off | Restart the Lab when you save one of its files. See below. Loopback only. |
| `--assets <dir>` | the built pages in the package | Serve a different build of the pages, as it is. |
| `--no-open` | opens | Don't open the browser. |

The process runs from the directory you started it in, so a Lab's relative paths, such as a SQLite file, land where they would under `fsdev dev`. A config that doesn't load, or doesn't default-export a `FlowState`, stops the command with the loader's message.

If the DevTool's pages aren't installed, Shift Manager still starts, says so, and turns *Open trace* off. Install `@flow-state-dev/devtool` to get them.

### While you edit your Lab

Add `--dev` and leave it running. When you save a file your Lab loaded, a flow module or a file under the config's folder such as a `WORKER.md`, the Lab restarts by itself and the page reloads. Saving something the Lab didn't load, or its data file, does nothing.

If the Lab fails to start after a save, the error prints and Shift Manager waits for the next save. A restart is a new process: a Lab with in-memory stores starts empty each time, so use SQLite if you want your data to survive edits.

### Working on Shift Manager itself

In this repository, `pnpm --filter @flow-state-dev/shift-manager dev` runs the `devteam` profile with `--dev`. From a checkout, `--dev` also serves Shift Manager's pages from source, so a change to a screen shows as you save it. `start` runs the same profile on the built pages, and builds them first when they're older than their source.

To open another Lab from a checkout, pass its config:
`pnpm --filter @flow-state-dev/shift-manager dev --config ../my-lab/fsdev.config.mts`.

### The `devteam` profile

`devteam` is the team profile in this repository, at `teams/devteam/fsdev.config.mts`. It isn't in the published package, because it builds on the repository's own test Labs.

It's a software team. An EM worker files features as rows on the team's board, a coder worker runs each row as a supervised coding run, and a reviewer worker is declared but never woken. On start the EM asks you to approve one feature, so Inbox has something in it. It also opens with two projects you own: Storefront, which holds a workstream from each of the two teams, and Platform, which holds none yet. The EM answers every line posted in a project's room. Rows run on a scripted harness with no model unless `DEVFORCE_LAB_HARNESS=claude-code` is set. Its tree sits beside the config, in [`teams/devteam/`](teams/devteam/README.md), and the checks behind it are in [`goals/devforce-lab/`](../../goals/devforce-lab/). It keeps what it holds in SQLite at `packages/shift-manager/.fsdev/devteam.sqlite` (or at `DEVTEAM_STORE`), so projects, their rooms and your talk sessions survive a restart. Delete the file to start fresh.

Its chief of staff has memory from `@flow-state-dev/memory` (working memory, a rolling digest across conversations, and the `memory/recall` tool). By default it reads memory but records nothing, so its memory stays empty. Set `DEVTEAM_MEMORY_CAPTURE=1` to record each conversation into it after each answer, which adds model calls every turn.

## Themes

Shift Manager has three themes, named for the shift: Day, Evening and Night. Day and Evening are light, Evening a little warmer and darker; Night is dark.

The mark at the top of the sidebar is the control. Click it to step through Day, Evening and Night. The page fades to the new theme in under half a second, and your pick is kept in that browser.

The dot on the dashed arc above the mark shows the time of day: the left end is midnight, the top is noon. It follows your clock but never changes the theme.

Until you pick, the page opens on the theme your clock calls for: Day from 06:00, Evening from 16:00, Night from 19:00. `--shift` (or `SHIFT_MANAGER_SHIFT`) sets the starting theme instead, and a pick you've made wins over both.

## What a Lab's config provides

Shift Manager reads a Lab only through the routes its `FlowState` serves. It doesn't build anything for the Lab, so the config has to export a server that is already set up. Documents and the chief of staff are files in the Lab's tree.

To open a Lab you write its config. You only touch other files in its tree to add readable documents or a chief of staff. Both are optional, and so is naming the Lab's own organization.

**A `FlowState`, as the default export.** Build it and finish the setup below first. An `.mts` config can use top-level `await`. If the Lab keeps its assembly in a host module, have that module return the `FlowState` so the config can export it:

```ts title="fsdev.config.mts"
import { openLab } from "./host.mts"; // the Lab's own assembly

const lab = await openLab({ /* the Lab's own options */ });

export default lab.state;
```

Some host modules do part of this setup for you, and the host's docs say which parts. If the host has an option that opens the inventory, turn it on and skip the `openInventory` call. If it has one that hands the page the Lab's user, turn it on and skip the `devtool` setting. A host that sets its own `resolvePrincipal` and calls `openMailboxes` takes care of the organization and the mailboxes. The config is then left to pick the store, turn those options on, pass any option the host's docs mark as required, and default-export the `FlowState` the host returns. Leave out every other option. The [`devteam`](#the-devteam-profile) profile's config works this way:

```ts title="teams/devteam/fsdev.config.mts (excerpt)"
const lab = await openLab({
  stores: sqliteStores({ filename: STORE }),
  inventory: true, // its host opens the mailboxes, then the inventory
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

Pick by whether what the Lab holds has to survive a restart, including the ones `--dev` does on each save. If it does, use SQLite or Postgres. If you don't need it kept and the Lab's docs don't say it must be, use `inMemoryStores()`. That is the rule to follow whenever a Lab's docs say nothing about restarts. [`test/fixtures/multi-seat-collab/fsdev.config.mts`](test/fixtures/multi-seat-collab/fsdev.config.mts) runs on SQLite.

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

**Open mailboxes.** Call `openMailboxes` at boot with the same `userId` you give Shift Manager in `devtool: { userId }` (below). Each mailbox is a workstream. Shift Manager reads the organization off the person's sessions. Someone the Lab holds no session for yet, such as a project's second member on their first visit, gets one opened on the mailbox kind, and the Lab records in it the organization its resolver puts them in. So anyone your resolver verifies can open Shift Manager, see the organization's projects, and join the ones they're a member of. Only a Lab that holds no session for the person and serves no mailbox kind to open one on shows a screen saying it names no organization, in place of the Lab.

**An open inventory.** The [inventory](../../apps/docs/docs/workforce/inventory.md) is the organization's record of its seats and mailboxes. TEAMS and PROJECTS list it, and Inbox and the boards find seats and workstreams through it. It takes two steps:

1. Build the mailbox flow with the actions that write the inventory: `defineMailboxFlow({ notify, inventory: true })` for a mailbox kind of your own, or `mailboxInstances(mailboxes, { inventory: true })` for the built-in one.
2. Call `openInventory` once `openMailboxes` has returned, under the organization your resolver names.

```ts
// `roster` is the tree read with `readDeclaredRoster`, `installation` the one built on its
// workers, and `client` the session client `openMailboxes` takes.
await openMailboxes(roster.mailboxes, { client, userId: "u_lab" });
const opened = await openInventory(
  { seats: inventorySeats(installation), mailboxes: roster.mailboxes },
  { run, seatWriter: { flowKind: "mailbox" }, userId: "u_lab", orgId: "org_lab" },
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
    flow: flowsByKind[request.flowKind], // the mailbox flow and each seat, by kind or id
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

**A chief of staff, if you want one.** On the Shift Coordinator screen, Shift Manager talks to the seat named `chief-of-staff`. Declare it as an org seat, under `org/workers/` beside `teams/`, on the built-in `agent` kind, with instructions that say what it should do for the person running the Lab:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
description: The person's one point of contact.
flow: agent
model: openai/gpt-5.4-mini
---
You are the chief of staff for this Lab. Answer questions about who is working on what.
```

A `chief-of-staff` seat declared as a team's worker, at `teams/<team>/workers/chief-of-staff/`, works too: Shift Manager talks to that seat.

What it can do is up to its instructions and the tools you give it. Shift Manager only carries your lines to it and shows what it answers. A Lab with two seats of that name gets a line naming both, and Shift Manager talks to neither.

To have it hand work to other workers, run it on Workforce's `coordinator` flow instead, with the workers it starts from as `delegates:`. The Lab registers that flow beside `agent` (`defineCoordinatorFlow`, see the Workforce README's Coordinators section). The DevTeam's chief of staff does this:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
description: The person's one point of contact.
flow: coordinator
routing: judgment
delegates: [eng.em, eng.coder]
model: anthropic/claude-haiku-5-5
---
```

A coordinator chief of staff gets a DELEGATES list in Shift Coordinator's right panel: the delegates of your conversation with it, a picker that adds one from your roster, and a remove beside each. A refused add shows the coordinator's reason. A delegate's answer appears in the conversation under the delegate's name, and each routing decision as a small note between the lines saying who the post went to and who was skipped. The chief of staff comes first in its Roster group.

Below DELEGATES, TASKS lists the tasks your conversation filed for its delegates, each with its goal, status and delegate. It is the conversation's own `listTasks`, so it shows that conversation's tasks and no other's. It is read again after each line you send; a task that ends in between shows at the next read. When a task ends, the conversation says so under the delegate's name.

A Lab with no chief of staff needs nothing in its config. Every screen works, and Shift Coordinator shows the summary of asks and runs. Where the conversation would be, it says "This Lab declares no shift coordinator" and how to declare a `chief-of-staff` seat. That message needs an open inventory (above). With no inventory, the conversation area shows an error about the inventory instead.

`test/fixtures/ask-lab/lab.mts` is a small Lab that does all of the above in one file.

## What you see

- **Shift Coordinator.** Where Shift Manager opens: a summary of the shift, and your conversation with the Lab's chief of staff. See [Shift Coordinator](#shift-coordinator).
- **Sidebar.** The organization, Jump to (⌘K), Shift Coordinator, Inbox and Tasks with their counts (Inbox's count is highlighted while anything waits on you), Roster with how many workers are on shift and on call, PROJECTS (each project with its workstreams, then No project), and TEAMS: one row per team, holding the Lab's standard workers and your own, with how many of its workers are on shift and a square for each worker. A workstream under PROJECTS shows a yellow square while one of its workers' asks waits on you, otherwise a blue one while one of its tasks runs. Organization-level workers, such as a chief of staff, sit in one Staff row at the top. Hover a square for the worker and its status. Click a team to open Roster for that team. The footer repeats the on-shift and on-call counts, followed by your initials. The panel icon at the right end of the sidebar's header collapses it to a column of icons (see [Collapsing the sidebar and the right panel](#collapsing-the-sidebar-and-the-right-panel)).
- **Jump to (⌘K).** Finds Shift Coordinator, workstreams, seats, tasks and the Lab's [readable documents](#what-a-labs-config-provides). A seat opens Roster. A document opens read-only.
- **Inbox.** Every approval or question a seat is waiting on you for, oldest first. You answer it on its card, and can reply to the worker under it. An ask from a run the Lab started by itself, such as a seat woken by a mailbox post, is shown without buttons, and its card says why: the Lab never reopens those runs from outside. Under the ask, *From the session* lists the last three tool calls the worker made before it asked. Replies you send appear below that list once the worker's session has stored them.
- **Tasks.** Every row on every attached board that isn't done, grouped by state, worker or workstream. Each row shows its id and, while it runs, how long it has been running. Queued tasks, blocked ones included, stay hidden until you turn on the Queued toggle, which shows how many there are.
- **Roster.** Every worker in the Lab, grouped by whether it's on shift, on call or off shift. Pick a team at the top to see only its workers. See [Roster](#roster).
- **PROJECTS.** Each of the Lab's projects by title, with the workstreams its record lists beneath it. A project with no workstreams is still listed. Workstreams no project lists sit under **No project**, which shows only when there is one. Clicking the PROJECTS heading opens No project.
- **A project.** Its room, a board lane per workstream, its workstreams and its brief. See [A project](#a-project).
- **A workstream.** One mailbox and the boards attached to it. It has four tabs: Stream (the transcript and the composer), Board (five columns: QUEUED, RUNNING, IN REVIEW, NEEDS YOU, DONE; a done task is one line, its id and title), Brief (the mailbox's charter) and Results. A member's ask shows up in the transcript at the time it was raised, marked NEEDS YOU. Answering it there clears it from Inbox. The right panel lists the mailbox's members with their status, and its rows by column.
- **A task.** One task's run, live, with Interrupt. See [A task](#a-task).

A post appears in the transcript only once the mailbox has kept it. Until then the composer keeps your draft and says it's posting. If the post is refused, the draft stays and the reason is shown.

**Talking to a worker.** Start a line with `@` and a worker's name to send it to that worker's task in this workstream instead of the mailbox. If it has several, the composer asks which. If it has none, Send is off and says so. In a task, the composer sends to that task's run. From Inbox, the reply box sends to the worker that asked, if its kind takes messages. A worker whose kind takes no message gets a reply box that says so.

A running coding run stops where it is and carries on in the same session with your message. Each message box names the worker it sends to. In Shift Coordinator and Inbox, as soon as the worker's session holds your line, the line leaves the box and shows in the conversation, and the composer says it's waiting on the reply. It says *delivered* once the worker's turn on it ends. If the send fails after the line left the box, the line is put back. A conversation that's scrolled to its end keeps the latest turn in view as lines arrive. If the worker stops on an ask of its own, as a chief of staff does before it fires a worker, the line is still delivered: the composer says so and points you at Inbox, where the ask now waits, and offers no Retry. If it stops to wait on something other than you, the composer says it's waiting, again with no Retry. If the worker refuses it, your draft stays and its reason is shown. If the line never reached the Lab, Retry sends it again. If it may have arrived but Shift Manager can't confirm it, the draft stays and there's no Retry, so it isn't sent twice. A finished task takes no message.

To make your own worker kind take messages, give it one public action that declares `userMessage` and takes `{ message }`. Shift Manager sends lines there, using the `door` on the seat's inventory row.

Each section loads on its own. If one read fails, that section says what the Lab answered and offers Retry, and the rest of the screen still draws.

### Collapsing the sidebar and the right panel

Shift Coordinator, a workstream and a task have a panel on the right. The panel and the sidebar collapse independently, and the center takes the width they give up.

- **The sidebar.** The panel icon at the right end of its header collapses it to a 48px column of icons: the toggle that expands it again, then Shift Coordinator, Inbox, Tasks, Roster and Jump to. Hover an icon for its name; clicking it opens the same screen as its sidebar entry. Inbox's icon carries the count of asks while one waits on you. PROJECTS, TEAMS, the organization and the footer counts are only in the expanded sidebar.
- **The right panel.** The › handle on its left edge collapses it to a thin strip on the right edge, labelled with what the panel holds (STREAMS at Shift Coordinator, WORKSTREAM at a workstream, TASK DETAIL at a task), with a ‹ handle that opens it again. While it's collapsed, what it lists isn't shown anywhere else.
- **Keys.** `[` toggles the sidebar and `]` the right panel. Neither does anything while you're typing in a field, such as a message box or Jump to.

Each panel's state is kept in the browser for the signed-in user, so it holds across reloads and from screen to screen. Another user in the same browser has their own. In a browser that blocks site data for the page, it lasts until you reload, as a theme pick does.

On a window narrower than 1180px, the right panel starts collapsed, and opening it lays it over the center instead of narrowing the center. On a narrow window, opening or closing it isn't saved. Widen the window and the panel goes back to the state you last chose.

## Shift Coordinator

Shift Manager opens here, at `/` or `/cos`.

The top of the screen is Shift Manager's own summary of the shift: how many asks wait on you, each one with the same Approve and Reject you'd get in Inbox, and how many runs are going across how many workstreams. The numbers are the ones Inbox and Tasks show.

Below it is your conversation with the Lab's chief-of-staff worker: your newest session on its flow that names it. A first line opens that session, naming the worker, before the line goes through the flow's door, like any other line you send to a worker. The message box names who you're sending to, Shift Coordinator. The reply is what the seat wrote in that session, with the time it was written. While the seat works on a line you sent from this tab, a blue square says so under the conversation and on the sidebar's Shift Coordinator entry. Once you send a line, the conversation follows: each new turn scrolls into view, until you scroll up to read earlier ones. Come back later and the same conversation is there.

Above the message box sit suggested lines you can click to fill the box: `Who's on call?`, and `What's blocking #<workstream>?`. The workstream named is one with an ask waiting on you, or, if none has one, one with a task running. Nothing goes out until you send it.

The panel on the right lists each workstream with its running tasks and the asks its members have raised, and the workers on call, as Roster counts them.

A Lab with no chief-of-staff seat still opens here. You get the summary, and in place of the conversation a line saying how to add one. Declaring the seat is covered under [What a Lab's config provides](#what-a-labs-config-provides).

## A project

A project has four tabs:

- **Stream** is the project's room: one conversation its members share with the project's seats. You read and post through your own talk session on the project. A member who has none gets Join, and someone who isn't a member is told the room is for its members and sees none of it. The room opens at its newest lines, and **Load earlier** reads the page before them.
- **Board** draws a lane for each of its workstreams that holds a board.
- **Workstreams** lists the workstreams the project holds.
- **Brief** is the project's brief, under the repository its coding work runs in, or *No repository · runs on project files*.

**No project** has no room and no brief, and says so.

The room reads only at set times: when you open it, when the window gets focus, when you come back to the tab, and after you post. Each of those starts a short run of reads, about a second apart while lines are arriving and further apart as it goes quiet. After about 45 quiet seconds the room stops reading. That is how the seats' answers to your post show up. A room left open and idle doesn't fetch anything new. Other members' lines appear the next time you open the room, focus the window, come back to the tab, or post.

## A task

Open a task from Tasks or from a card on a board. The Session tab is that task's own run: every step the worker takes, the tool calls and edits as they happen, and earlier attempts above them when they ran in the same place. It isn't the worker's chat, so what you read is what the task did. If the worker keeps one session for several tasks, the tab shows only this task's steps and says the session is shared. A task handed off a moment ago shows its run once the run starts. The screen checks for it every 2 seconds for up to a minute, then offers Retry.

**Interrupt** stops the run (Esc does the same while the Session has focus). The line above the composer names the worker and the run's state: *running*, then *interrupted* once the run has actually stopped. What happens to the task afterwards, whether it's retried or left, is up to the board, not Shift Manager.

When the run stops to ask you something, the ask appears in the Session where the run stopped, on the same card Inbox uses, and you can answer it there. The panel on the right shows it too, with how long it has waited and a link to it in Inbox.

The panel on the right shows who is on it and when it started. If the harness records its plan and the files it touched, as Claude Code does, they're listed. Otherwise the panel says so. *Open trace* opens the run's session in the devtool, for the full detail, with the session id beside the link.

The devtool it opens is the one Shift Manager serves: the same pages `fsdev dev` serves, over the same Lab, in the same process. That matters because the devtool can only show a run from the store the run is in. A Lab whose stores are in memory lives only in Shift Manager's process, so a devtool started separately has its own empty store. The link adds `?session=<id>`, and the devtool opens the session under the flow that owns it.

The devtool's pages ship prebuilt in the published `@flow-state-dev/devtool` package. In this repository, build them once with `pnpm build:assets`. Without them Shift Manager still starts, says so, and the link is off.


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

A board that hands work off keeps a running task on the worker it was given to, and moving a waiting one isn't wired into the view yet, which is why reassigning is off rather than refused.

## Roster

Roster shows the signed-in person's workers: the standard workers the Lab's seat inventory lists, and their own, hired or forked, which no one else sees (marked YOURS). Their own are read through Workforce's client (`createWorkforceClient(...).roster()`), so the Lab has to register the roster flow `hireWorkforce` returns. Each worker is in one of three groups:

- **On shift**: it holds a task that is running.
- **On call**: nothing of its is running, but it is waiting on you, either on a task it parked for you or on an ask in Inbox.
- **Off shift**: neither. A worker with only queued tasks is off shift until it claims one.

Each worker shows its team and the flow it runs on, how many slots it has in use (one square per task it holds), the tasks it holds, and what it is waiting on. Click a task to open it. The counts at the top are for the workers shown.

The same status appears in the sidebar and in a workstream's panel, so a worker reads the same everywhere. If the Lab's asks didn't load, each of those places marks its status *partial*: a worker waiting on you only through an ask would read off shift.

Roster is read with the rest of the screen, when Shift Manager starts, on Retry, after you answer an ask, and after each message the chief of staff takes (so a hire, a fire, or a project it starts for you, shows up at once). It says when it was read. It doesn't refresh on its own.

Slots count what a worker holds now. Nothing in a Lab limits how many tasks a worker takes, so Roster shows no capacity and no free slots.

## What isn't here yet

Each of these is drawn as a named empty state or a disabled control:

- **Parts of the task screen.** Listed under [A task](#not-there-yet).
- **Posting a task's message to its workstream too.** Sending to the worker and posting to the mailbox are two separate things for now.
- **Worker detail.** A seat's harness, and the NOW and COST columns on Tasks.
- **IN REVIEW.** The column is drawn empty, because no row status means "in review" yet.
- **What a worker is on call for, beyond you.** Webhooks, schedules and other standing watches arrive with the standing routines work. Until then on call means waiting on you, and a worker that only waits for a webhook reads off shift.
- **A declared map from a task's assignee to its worker.** Shift Manager matches the assignee to a worker by id, then by a unique name, then by who is in the mailbox. A task whose assignee matches no single worker counts for no one, so that worker can read off shift while it works.

## How it looks

Shift Manager's look comes from the [design-system](../design-system) package, through one import in `src/styles.css`. Remove that import and every screen falls back to the registry's neutral defaults.

The page is on one of three themes, Day, Evening or Night, and fades between them. [Themes](#themes) covers how one is chosen. In a browser that blocks site data for the page, a pick lasts until you reload.

The cards in a task's Session, and the ask cards in Inbox and in a workstream's Stream, are Shift Manager's copies of `@flow-state-dev/ui` registry components, kept unedited. The `ui:add` script in `package.json` names what was installed (`chat-assistant`, which brings the message, reasoning, tool, code block, task plan and ask cards with it). `chat-assistant` brings its whole dependency closure, so Shift Manager also holds copies it doesn't draw today (the debate, evented-actors, routed-specialists and audit-annotation containers) and the libraries they need, such as `shiki`, `streamdown` and `motion`. A test checks that the copies are exactly what that list ships, byte for byte.

## Tests

```bash
pnpm --filter @flow-state-dev/shift-manager test
pnpm --filter @flow-state-dev/shift-manager typecheck
```

The tests serve a real Lab in-process (`test/fixtures/ask-lab`) and compare what the reads and screens show with what the Lab's routes hold.

The end-to-end checks are goal checks under `goals/shift-manager/`, each driving Shift Manager in Chromium. Run one by its folder name:

```bash
PLAYWRIGHT_BROWSERS_PATH=<your Chromium pool> pnpm tsx goals/shift-manager/<check>/run.mts
```

| Check | What it does |
|-------|--------------|
| `it-opens-a-lab` | Builds Shift Manager, serves it over both goal Labs, and walks every screen. |
| `it-shows-and-stops-a-task-run` | Opens tasks on a Lab whose runs hold until stopped, watches each run live, interrupts it, and compares the screen with the run's stored session and request. |
| `it-takes-its-look-from-the-design-system` | Builds Shift Manager twice, as written and with its theme import removed, and reads the colours and fonts painted on the shell and on each registry card in a task's Session. With the import, every one is a Shift Manager value. Without it, none is. |
| `it-shows-who-is-on-shift` | Serves a Lab of two teams whose workers are put into each status on purpose, opens Roster for all teams and for each one, and compares every worker's status, slots, tasks and waits with the Lab's store. |
| `it-briefs-and-talks-with-the-chief-of-staff` | Sends a line to a Lab's chief-of-staff seat, which runs a real model, and answers an ask from the summary. Compares the summary, the conversation and the reply with what the store holds. Needs a model key, such as `AI_GATEWAY_API_KEY`, in the environment. |
| `it-draws-v2s-look` | Compares what is painted with v2, the reference design the [design-system](../design-system) package is drawn from. Its Labs run on scripted models, so it needs no model key. See below. |

`it-draws-v2s-look` walks every screen in both shifts, at a wide and a narrow window. On every screen it checks that v2's two fonts actually loaded, that no corner is rounded, and that the highlight marks only what waits on you. On the sidebar, Shift Coordinator and the parts every screen shares, it also checks each element's typeface and size, surface and border, and the column widths. On the sidebar and Shift Coordinator, the counts, the workstream squares and the suggested lines must match what the Lab holds. A failure names the element, the screen, the shift and width, and in most cases the line of v2 it departs from.
