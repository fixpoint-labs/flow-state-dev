# Shift Manager

Shift Manager is the browser app you run a Workforce team through. A team is served as a Lab: a set of Workforce workers from one `fsdev.config.mts`. You point Shift Manager at a Lab's config, and it shows what that Lab holds. It opens on Shift Coordinator: a summary of what's waiting on you and what's running, and a conversation with the Lab's Shift Coordinator, the worker named `chief-of-staff`. From there it shows the teams and their workers, the projects and their workstreams, the boards, and the asks waiting on you.

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

In this repository, `pnpm shift-manager:dev` opens the `fsd` profile, at `teams/devteam/fsd.fsdev.config.mts`: a Lab for working on this repository with Shift Manager itself. It has two projects from the start. **FSD** is the framework packages, and **Shift Manager** is this app. Both are shared with everyone in the Lab, and both point at this repository. It raises no ask and opens no workstream, so Inbox is empty until a worker asks you something.

Ask the Shift Coordinator for work on either project, and say which one, for example "on Shift Manager, make the empty Inbox say who to ask". A coding agent picks it up in a fresh worktree of your checkout, on a branch of its own. Before cutting that branch, the Lab fetches the upstream your `main` tracks, usually `origin/main`, and starts from whichever is newer, that upstream or your local `main`. So you don't need to pull first, and commits you haven't pushed are kept. Your own `main`, its files and your index aren't touched.

If your `main` and its upstream each have commits the other lacks, the run is refused before anything is made, and the refusal names both commits. Pull or rebase, or push, then ask again. If the fetch fails, because you're offline for instance, the run compares your `main` with the copy of its upstream you last fetched instead, and a warning prints where you started Shift Manager.

Review the work in that worktree, or from your checkout with `git log -p <branch> --not main main@{upstream}`. That shows only the run's commits, whichever of the two it started from. The branch stays checked out in its worktree, so git won't check it out a second time in yours.

Only those two projects get a worktree of your checkout. Apart from that fetch, the Lab reaches no git remote, so a coding run on a project you add yourself, even one on this repository, is refused, naming the repository, and nothing is cloned.

Open **Settings** and paste a Linear API key, and every coding run you ask for on either project can read and update Linear, as you. Each user sets their own. A run for someone who hasn't set one works without Linear and says so. For runs with nobody at the keyboard, such as a goal check or CI, `LINEAR_MCP_API_KEY` stands in for the Lab's own user until that user sets a key. An `MCP servers:` line at start says whether the Lab's own user has a key. The profile's projects and its MCP servers are in `teams/devteam/fsd-projects.mts`.

The coding agent is Claude Code. Sign in to Claude Code, or set `ANTHROPIC_API_KEY`, before you start. Without either, the Lab refuses to start and says so. To run the scripted coder (`stub`) instead, which writes one file and costs nothing, set `DEVFORCE_LAB_HARNESS=stub`. A `Coder:` line at start names the coder it started with. The Shift Coordinator answers on a model of its own, so its turns need `ANTHROPIC_API_KEY` or `AI_GATEWAY_API_KEY`.

The Lab keeps its data in SQLite at `packages/shift-manager/.fsdev/fsd.sqlite`, or wherever `FSD_STORE` points. Delete the file to start fresh.

`pnpm shift-manager:dev` runs with `--dev`, which serves Shift Manager's pages from source, so a change to a screen shows as you save it. `pnpm --filter @flow-state-dev/shift-manager start` runs the same profile on the built pages, and builds them first when they're older than their source. To open the `devteam` profile instead, pass its config, a path from the repository root:
`pnpm shift-manager:dev --config packages/shift-manager/teams/devteam/fsdev.config.mts`.

To open another Lab from a checkout, pass its config:
`pnpm --filter @flow-state-dev/shift-manager dev --config ../my-lab/fsdev.config.mts`.

### The `devteam` profile

`devteam` is the profile this repository's checks run against. Open it with `--config`, as above.

It's at `teams/devteam/fsdev.config.mts`. It isn't in the published package, because it builds on the repository's own test Labs.

It's a software team. An EM worker leads workstreams and files the coder's tasks on each one's board, a coder worker runs each task as a supervised coding run, and a reviewer worker is declared but never woken. On start the EM asks you to approve one feature, so Inbox has something in it. It also opens with three shared projects you own: Storefront, where the Lab's second user has opened two workstreams, `feature` and `release`, both led by the EM, and Platform and Sandbox, which hold none yet. Its standard workers include the project coordinator each user talks to a project through, which opens a workstream when you ask it for new work. Rows run on the scripted coder (`stub`), with no model, unless `DEVFORCE_LAB_HARNESS=claude-code` is set, and then the Lab checks for a Claude Code sign-in or `ANTHROPIC_API_KEY` at start, as `fsd` does. Its tree sits beside the config, in [`teams/devteam/`](teams/devteam/README.md), and the checks behind it are in [`goals/devforce-lab/`](../../goals/devforce-lab/). It keeps what it holds in SQLite at `packages/shift-manager/.fsdev/devteam.sqlite` (or at `DEVTEAM_STORE`), so projects, their workstreams and your conversations survive a restart. Delete the file to start fresh.

Its Shift Coordinator has memory from `@flow-state-dev/memory` (working memory, a rolling digest across conversations, and the `memory/recall` tool). By default it reads memory but records nothing, so its memory stays empty. Set `DEVTEAM_MEMORY_CAPTURE=1` to record each conversation into it after each answer, which adds model calls every turn. A request best fit sends straight to a delegate runs no Shift Coordinator turn, so it isn't recorded on its own; it can still show up as earlier context when a later answer of the Shift Coordinator's is recorded.

## Themes

Shift Manager has three themes, named for the shift: Day, Evening and Night. Day and Evening are light, Evening a little warmer and darker; Night is dark.

The mark at the top of the sidebar is the control. Click it to step through Day, Evening and Night. The page fades to the new theme in under half a second, and your pick is kept in that browser.

The dot on the dashed arc above the mark shows the time of day: the left end is midnight, the top is noon. It follows your clock but never changes the theme.

Until you pick, the page opens on the theme your clock calls for: Day from 06:00, Evening from 16:00, Night from 19:00. `--shift` (or `SHIFT_MANAGER_SHIFT`) sets the starting theme instead, and a pick you've made wins over both.

## What a Lab's config provides

Shift Manager reads a Lab only through the routes its `FlowState` serves. It doesn't build anything for the Lab, so the config has to export a server that is already set up. Documents and the Shift Coordinator are files in the Lab's tree.

To open a Lab you write its config. You only touch other files in its tree to add readable documents or a Shift Coordinator. Both are optional, and so is naming the Lab's own organization.

**A `FlowState`, as the default export.** Build it and finish the setup below first. An `.mts` config can use top-level `await`. If the Lab keeps its assembly in a host module, have that module return the `FlowState` so the config can export it:

```ts title="fsdev.config.mts"
import { openLab } from "./host.mts"; // the Lab's own assembly

const lab = await openLab({ /* the Lab's own options */ });

export default lab.state;
```

Some host modules do part of this setup for you, and the host's docs say which parts. If the host has an option that opens the inventory, turn it on and skip the `openInventory` call. If it has one that hands the page the Lab's user, turn it on and skip the `devtool` setting. A host that sets its own `resolvePrincipal` takes care of the organization. The config is then left to pick the store, turn those options on, pass any option the host's docs mark as required, and default-export the `FlowState` the host returns. Leave out every other option. The [`devteam`](#the-devteam-profile) profile's config works this way:

```ts title="teams/devteam/fsdev.config.mts (excerpt)"
const lab = await openLab({
  stores: sqliteStores({ filename: STORE }),
  inventory: true, // its host opens the inventory
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

Pick by whether what the Lab holds has to survive a restart, including the ones `--dev` does on each save. If it does, use SQLite or Postgres. If you don't need it kept and the Lab's docs don't say it must be, use `inMemoryStores()`. That is the rule to follow whenever a Lab's docs say nothing about restarts. [`test/fixtures/multi-worker-collab/fsdev.config.mts`](test/fixtures/multi-worker-collab/fsdev.config.mts) runs on SQLite.

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

**Who can open it.** Shift Manager reads the organization off the user's sessions. Someone the Lab holds no session for yet, such as a second project member on their first visit, gets one opened on Workforce's roster flow, and the Lab records in it the organization its resolver puts them in. So anyone your resolver verifies can open Shift Manager, see the organization's shared projects, and open workstreams in the ones they're a member of. A Lab that holds no session for the user and serves no roster flow to open one on shows a screen saying it names no organization, in place of the Lab.

**An open inventory.** The [inventory](../../apps/docs/docs/workforce/inventory.md) is the organization's record of its workers. TEAMS, Roster and Inbox read it to find the Lab's workers. It takes two steps:

1. Register a flow that carries the action that writes the inventory: one of your own whose `internal.actions` spread `inventoryWriterActions()`.
2. Call `openInventory` at boot, under the organization your resolver names.

```ts
// `installation` is the one built on the workers `readDeclaredRoster` read, and
// "inventory-writer" the flow that carries `inventoryWriterActions()`.
const opened = await openInventory(
  { workers: inventoryWorkers(installation) },
  { run, workerWriter: { flowKind: "inventory-writer" }, userId: "u_lab", orgId: "org_lab" },
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
    flow: flowsByKind[request.flowKind], // the writer flow, by flow kind
    actionName: request.action,
    input: request.input,
    userId: request.userId,
    orgId: request.orgId,
    sessionId: request.sessionId,
    source: request.source, // the rows are written only when this reaches runAction
    stores: runtime.stores,
    runtimeConfig: runtime.runtimeConfig,
  });
  if (result?.error !== undefined) throw new Error(String(result.error));
  return result;
};
```

Without an inventory, TEAMS says there is none to read, and the other sections load. The [Inventory](../../apps/docs/docs/workforce/inventory.md) page covers the writer flow and both calls in full.

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

**A Shift Coordinator, if you want one.** On the Shift Coordinator screen, Shift Manager talks to the worker named `chief-of-staff`. Declare it as an org worker, under `org/workers/` beside `teams/`, on the built-in `agent` worker flow, with instructions that say what it should do for the user running the Lab:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
description: The user's one point of contact.
flow: agent
model: openai/gpt-5.4-mini
---
You are the Shift Coordinator for this Lab. Answer questions about who is working on what.
```

A `chief-of-staff` worker declared as a team's worker, at `teams/<team>/workers/chief-of-staff/`, works too: Shift Manager talks to that worker. Wherever Shift Manager names a worker, such as Roster, Inbox and Jump to, it shows this one as Shift Coordinator; its id stays `chief-of-staff`.

Shift Coordinator shows your newest conversation with that worker. If you have none, the first line you send starts one. Your host doesn't need to open one, whichever flow the Shift Coordinator runs on.

What it can do is up to its instructions and the tools you give it. Shift Manager only carries your lines to it and shows what it answers. A Lab with two workers of that name gets a line naming both, and Shift Manager talks to neither.

To have it hand work to other workers, run it on Workforce's `coordinator` flow instead, with the workers it starts from as `delegates:`. The Lab registers that flow beside `agent` (`defineCoordinatorFlow`, see the Workforce README's Coordinators section). The DevTeam's Shift Coordinator does this:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
description: The user's one point of contact. Hires and fires workers, starts projects, and answers questions about the team, its workers and its delegates.
flow: coordinator
routing: best-fit
minConfidence: 0.7
delegates: [eng.em, eng.coder]
model: anthropic/claude-haiku-5-5
---
```

It routes by best fit with Jev (`typesafe-ai/jev`, an evaluation model that reports how sure it is), so a plain request goes straight to the delegate that does it, and hiring, firing, projects and questions about the team reach its own turn.

A Shift Coordinator on the `coordinator` flow gets a DELEGATES list in the Shift Coordinator screen's right panel: the delegates of your conversation with it, a picker that adds one from your roster, and a remove beside each. A refused add shows the coordinator's reason. A delegate's answer appears in the conversation under the delegate's name, and each routing decision as a small note between the lines saying who the post went to and who was skipped. The Shift Coordinator comes first in its Roster group.

Below DELEGATES, TASKS lists the tasks your conversation filed for its delegates, each with its goal, status and delegate. It is the conversation's own `listTasks`, so it shows that conversation's tasks and no other's. It is read again after each line you send, and every few seconds while a task is open. When a task ends, the conversation says so under the delegate's name, and the whole Lab is read again.

A Lab with no Shift Coordinator needs nothing in its config. Every screen works, and Shift Coordinator shows the summary of asks and runs. Where the conversation would be, it says "This Lab declares no shift coordinator" and how to declare a `chief-of-staff` worker. That message needs an open inventory (above). With no inventory, the conversation area shows an error about the inventory instead.

`test/fixtures/ask-lab/lab.mts` is a small Lab that does the above in one file: it writes its inventory from a flow of its own that carries `inventoryWriterActions`, as its `workerWriter`.

## What you see

- **Shift Coordinator.** Where Shift Manager opens: a summary of the shift, and your conversation with the Lab's Shift Coordinator. See [Shift Coordinator](#shift-coordinator).
- **Sidebar.** The organization, Jump to (⌘K), Shift Coordinator, Inbox and Tasks with their counts (Inbox's count is highlighted while anything waits on you), Roster with how many workers are on shift and on call, Settings, PROJECTS (the shared projects and your own private ones, then No project), and TEAMS: one row per team, holding the Lab's standard workers and your own, with how many of its workers are on shift and a square for each worker. A workstream under PROJECTS shows a yellow square while one of its workers' asks waits on you, otherwise a blue one while one of its tasks runs. Organization-level workers, such as a Shift Coordinator, sit in one Staff row at the top. Hover a square for the worker and its status. Click a team to open Roster for that team. The footer repeats the on-shift and on-call counts, followed by your initials. The panel icon at the right end of the sidebar's header collapses it to a column of icons (see [Collapsing the sidebar and the right panel](#collapsing-the-sidebar-and-the-right-panel)).
- **Jump to (⌘K).** Finds Shift Coordinator, workstreams, workers, tasks and the Lab's [readable documents](#what-a-labs-config-provides). A worker opens Roster. A document opens read-only.
- **Inbox.** Every approval or question a worker is waiting on you for, the Lab's standard workers and your own, oldest first. You answer it on its card, and can reply to the worker under it. An ask from a run the Lab started by itself, such as a delegate working a task it was handed, is shown without buttons, and its card says why: the Lab never reopens those runs from outside. Under the ask, *From the session* lists the last three tool calls the worker made before it asked. Replies you send appear below that list once the worker's session has stored them.
- **Tasks.** Every row on every attached board that isn't done, grouped by state, worker or workstream. Grouped by workstream, a workstream's tasks sit under a group labelled `#shared/<project>/<workstream>`, so one worker leading two workstreams shows as two groups; a worker's conversation outside any workstream shows as that worker. Each row shows its id and, while it runs, how long it has been running. Queued tasks, blocked ones included, stay hidden until you turn on the Queued toggle, which shows how many there are.
- **Roster.** Every worker in the Lab, grouped by whether it's on shift, on call or off shift. Pick a team at the top to see only its workers. See [Roster](#roster).
- **PROJECTS.** The Lab's shared projects and your own private ones, marked private, by title. A project's workstreams are on its own screen.
- **A project.** Your project coordinator, the project's workstreams and their progress, your own workstreams' boards, and its brief. See [A project](#a-project).
- **A workstream.** On a project, your own workstream opens on its lead's conversation, and someone else's on its details and latest report. Its board has five columns: QUEUED, RUNNING, IN REVIEW, NEEDS YOU, DONE; a done task is one line, its id and title.
- **A task.** One task's run, live, with Interrupt. See [A task](#a-task).
- **Settings** (`/settings`). Your keys for the Lab's MCP servers: each server the Lab offers, *set* with when, or *not set*, a field to set or replace your key, and Clear. The page never shows a key back. A Lab opened with `openLab({ mcpServers })` serves the route the page writes through, `/api/flows/mcp-credentials`, which takes the caller from the Lab's own principal resolver; a Lab with none says it offers no servers.

**Talking to a worker.** Start a line with `@` and a worker's name to send it to that worker's task in this workstream. If it has several, the composer asks which. If it has none, Send is off and says so. In a task, the composer sends to that task's run. From Inbox, the reply box sends to the worker that asked, if its worker flow takes messages. A worker whose worker flow takes no message gets a reply box that says so.

A running coding run stops where it is and carries on in the same session with your message. Each message box names the worker it sends to. In Shift Coordinator and Inbox, as soon as the worker's session holds your line, the line leaves the box and shows in the conversation, and the composer says it's waiting on the reply. It says *delivered* once the worker's turn on it ends. If the send fails after the line left the box, the line is put back. A conversation that's scrolled to its end keeps the latest turn in view as lines arrive. If the worker stops on an ask of its own, as a Shift Coordinator does before it fires a worker, the line is still delivered: the composer says so and points you at Inbox, where the ask now waits, and offers no Retry. If it stops to wait on something other than you, the composer says it's waiting, again with no Retry. If the worker refuses it, your draft stays and its reason is shown. If the line never reached the Lab, Retry sends it again. If it may have arrived but Shift Manager can't confirm it, the draft stays and there's no Retry, so it isn't sent twice. A finished task takes no message.

To make your own worker flow take messages, give it one public action that declares `userMessage` and takes `{ message }`. Shift Manager sends lines there, using the `door` on the worker's inventory row.

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

Below it is your conversation with the Lab's Shift Coordinator (the `chief-of-staff` worker): your newest session on its flow that names it. A first line opens that session, naming the worker, before the line goes through the flow's door, like any other line you send to a worker. The message box names who you're sending to, Shift Coordinator. The reply is what the worker wrote in that session, with the time it was written. While the worker works on a line you sent from this tab, a blue square says so under the conversation and on the sidebar's Shift Coordinator entry. Once you send a line, the conversation follows: each new turn scrolls into view, until you scroll up to read earlier ones. Come back later and the same conversation is there.

Above the message box sit suggested lines you can click to fill the box: `Who's on call?`, and `What's blocking #<workstream>?`. The workstream named is one with an ask waiting on you, or, if none has one, one with a task running. Nothing goes out until you send it.

The panel on the right lists each workstream with its running tasks and the asks its project's members have raised, and the workers on call, as Roster counts them.

A Lab with no `chief-of-staff` worker still opens here. You get the summary, and in place of the conversation a line saying how to add one. Declaring the worker is covered under [What a Lab's config provides](#what-a-labs-config-provides).

## A project

A project is shared with the Lab's organization or private to you. It has four tabs:

- **Stream** is your conversation with your own project coordinator for this project, found or started when the tab opens. It answers how the project is going from every workstream's entry, and hands what you ask for to your own workstreams in the project. Nobody else reads it.
- **Workstreams** lists every workstream in the project as its entry says: title, owner, lead, status, due date and objectives, with the progress worked out from them. Each row counts its objectives met. A workstream nobody has updated for seven days is marked stale. The list reads the project again every few seconds while it's on screen, so a workstream your Shift Coordinator or project coordinator opens shows up without a reload. Your own workstream opens on its objectives, each marked met or not, above its lead's conversation in its workstream session. Someone else's opens on its details, objectives and latest report.
- **Board** shows the tasks of your own workstreams' sessions in the project, one panel per workstream. Other people's workstreams aren't read.
- **Brief** is the project's brief, under the repository its coding work runs in, or *No repository · runs on project files*.

**Opening a workstream.** Ask your project coordinator, in the project's Stream tab, for work none of your workstreams there covers. The coordinator opens a workstream for that work, led by the worker on your roster whose description fits, such as the EM (`eng.em`) for a feature, and hands your ask to the new workstream. The ask stays in the workstream's conversation as its brief. One worker can lead several of your workstreams, with a separate conversation and board for each. When nobody on your roster does the work, the coordinator says so; ask your Shift Coordinator to hire someone. The Workstreams tab points you to the coordinator.

In your own app, Workforce's `openWorkstream` takes whichever lead you name.

**No project** has no coordinator and no brief, and says so.

## A task

Open a task from Tasks or from a card on a board. The Session tab is that task's own run: every step the worker takes, the tool calls and edits as they happen, and earlier attempts above them when they ran in the same place. It isn't the worker's chat, so what you read is what the task did. If the worker keeps one session for several tasks, the tab shows only this task's steps and says the session is shared. A task handed off a moment ago shows its run once the run starts. The screen checks for it every 2 seconds for up to a minute, then offers Retry.

**Interrupt** stops the run (Esc does the same while the Session has focus). The line above the composer names the worker and the run's state: *running*, then *interrupted* once the run has actually stopped. What happens to the task afterwards, whether it's retried or left, is up to the board, not Shift Manager.

When the run stops to ask you something, the ask appears in the Session where the run stopped, on the same card Inbox uses, and you can answer it there. The panel on the right shows it too, with how long it has waited and a link to it in Inbox.

The panel on the right shows who is on it and when it started. If the harness records its plan and the files it touched, as Claude Code does, they're listed. Otherwise the panel says so. *Open trace* opens the run's session in the devtool, for the full detail, with the session id beside the link.

The devtool it opens is the one Shift Manager serves: the same pages `fsdev dev` serves, over the same Lab, in the same process. That matters because the devtool can only show a run from the store the run is in. A Lab whose stores are in memory lives only in Shift Manager's process, so a devtool started separately has its own empty store. The link adds `?session=<id>`, and the devtool opens the session under the flow that owns it.

The devtool's pages ship prebuilt in the published `@flow-state-dev/devtool` package. In this repository, build them once with `pnpm build:assets`. Without them Shift Manager still starts, says so, and the link is off.


### What a coding run is handed

When you approve a feature in Inbox, the team's own coordinator, not the `chief-of-staff` worker behind Shift Coordinator, files it as a task and a coder worker picks it up as a coding run. In the `devteam` profile, the run's prompt holds, in this order:

- **The task.** The feature you approved, word for word.
- **The worker's own files.** Its instructions, the document it names (the team's standing brief), and its skills.
- **Where and how to work.** Its own checkout and branch, and what counts as done.

It never gets the coordinator's session. Anything a run needs from a conversation has to be written on the task. A message you send to a running task reaches it separately, as described under *Talking to a worker* in [What you see](#what-you-see).

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

Roster shows the signed-in user's workers: the standard workers the Lab's worker inventory lists, and their own, hired or forked, which no one else sees (marked YOURS). Their own are read through Workforce's client (`createWorkforceClient(...).roster()`), so the Lab has to register the roster flow `hireWorkforce` returns. Each worker is in one of three groups:

- **On shift**: it holds a task that is running.
- **On call**: nothing of its is running, but it is waiting on you, either on a task it parked for you or on an ask in Inbox.
- **Off shift**: neither. A worker with only queued tasks is off shift until it claims one.

Each worker shows its team and the flow it runs on, how many slots it has in use (one square per task it holds), the tasks it holds, and what it is waiting on. Click a task to open it. The counts at the top are for the workers shown.

The same status appears in the sidebar and in a workstream's panel, so a worker reads the same everywhere. If the Lab's asks didn't load, each of those places marks its status *partial*: a worker waiting on you only through an ask would read off shift.

Roster is read with the rest of the screen, when Shift Manager starts, on Retry, after you answer an ask, and after each message the Shift Coordinator takes (so a hire, a fire, or a project it starts for you, shows up at once). It says when it was read. It doesn't refresh on its own.

Slots count what a worker holds now. Nothing in a Lab limits how many tasks a worker takes, so Roster shows no capacity and no free slots.

## What isn't here yet

Each of these is drawn as a named empty state or a disabled control:

- **Parts of the task screen.** Listed under [A task](#not-there-yet).
- **Worker detail.** A worker's harness, and the NOW and COST columns on Tasks.
- **IN REVIEW.** The column is drawn empty, because no row status means "in review" yet.
- **What a worker is on call for, beyond you.** Webhooks, schedules and other standing watches arrive with the standing routines work. Until then on call means waiting on you, and a worker that only waits for a webhook reads off shift.
- **A declared map from a task's assignee to its worker.** Shift Manager matches the assignee to a worker by id, then by a unique name. A task whose assignee matches no single worker counts for no one, so that worker can read off shift while it works.

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
| `it-briefs-and-talks-with-the-chief-of-staff` | Sends a line to a Lab's chief-of-staff worker, which runs a real model, and answers an ask from the summary. Compares the summary, the conversation and the reply with what the store holds. Needs a model key, such as `AI_GATEWAY_API_KEY`, in the environment. |
| `it-draws-v2s-look` | Compares what is painted with v2, the reference design the [design-system](../design-system) package is drawn from. Its Labs run on scripted models, so it needs no model key. See below. |

`it-draws-v2s-look` walks every screen in both shifts, at a wide and a narrow window. On every screen it checks that v2's two fonts actually loaded, that no corner is rounded, and that the highlight marks only what waits on you. On the sidebar, Shift Coordinator and the parts every screen shares, it also checks each element's typeface and size, surface and border, and the column widths. On the sidebar and Shift Coordinator, the counts, the workstream squares and the suggested lines must match what the Lab holds. A failure names the element, the screen, the shift and width, and in most cases the line of v2 it departs from.
