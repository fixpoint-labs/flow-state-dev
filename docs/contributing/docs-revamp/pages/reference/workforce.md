---
title: Workforce
type: reference
description: "The workforce kit's options and slots, the roster and its refusals, coordinator routing, discovery, projects and workstreams, inventory, usage, standing rules, the error reporter and the panels."
---

# Workforce

Workforce gives an app named workers: agents a user talks to, hands work to and manages like a team. A worker is a configuration, either a `WORKER.md` file in the app (a standard worker) or a row in one user's data (a hired worker). It runs on a worker flow, a flow the app registers once for every worker that names it. Adding, editing or firing a worker therefore registers nothing and restarts nothing: the next turn reads the new configuration.

This page is the lookup for the `workforce` kit and what it serves. [Workers](../concepts/workers.md) explains the idea, and the [Workforce catalog](../catalog/workforce/index.md) shows how to use it.

The examples belong to one support app. It has a standard worker `billing`, a coordinator, and users who hire workers of their own, such as `scribe`.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";

export default createFlowState({
  kits: [
    workforce({
      agent: { model: "openai/gpt-6-luna" },
      coordinator: { routeModel: "openai/gpt-6-luna" },
    }),
  ],
});
```

```ts title="src/lib/roster.ts"
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

export async function setUpRoster(userId: string, baseUrl: string) {
  const workforce = createWorkforceClient(createClient({ userId, baseUrl }));
  await workforce.hire({ id: "scribe", instructions: "Take short notes." });
  await workforce.fork("billing", "billing-eu");
  await workforce.edit({ id: "billing-eu", instructions: "Quote prices in euros, with VAT." });
  return workforce.roster();
}
```

## Who owns each stored part

A browser is a client reading through a session.

| Part | Owner | Who can see it | Where it is stored | How many |
| --- | --- | --- | --- | --- |
| A user's own worker: hired, forked, or the copy made by editing a standard worker | The user who made it, in one organization | Only that user. A browser reads `flow`, `name`, `description`, `forkedFrom` and the settings the flow shows. Instructions and other settings stay on the server | One row at `workforce/workers/<id>`, user scope, per organization, shared across flows | One per worker id per user per organization. A user in two organizations has a separate roster in each |
| A standard worker | The app's files | Every user in every organization of the installation. A browser reads `flow`, `description`, `name`, `teamName` and the shown settings | Read from the files each time and projected as `workforce/standard-workers/*` | One per `WORKER.md` |
| A conversation's delegate list and fallback | The conversation | The session's user | Server-written session state `delegates` and `fallback`, `null` until first read or changed | One list per conversation, at most 25 records |
| Standing rules | The user, for one worker | The user. A browser may read the state, never write it | `standing-rules/<worker>` resource, user scope, one bucket per worker flow copy | One record per worker per user, at most 20 rules |
| Worker usage | The user who made the requests | Only that user | `worker-usage/<YYYY-MM-DD>/<worker>`, user scope, not browser-readable | One record per worker per UTC day, one entry per source |
| Inventory | The organization | Every user in the organization | `inventory/workers/<id>`, organization scope, shared across flows | One row per standard worker |
| A project | Its creator | Shared: everyone in the organization reads it, and `members` decide who opens workstreams. Private: its owner only | `projects/<id>`, organization scope (shared) or the owner's user scope (private) | One per id per visibility. A private `apollo` and a shared `apollo` are two projects |
| A project's files | The project | Those in `members`, through `readProjectFiles`. No browser read | `project-files/<projectId>/<path>`, scope by visibility | One row per file |
| A workstream entry | The user who opened it | Shared project: everyone in the organization reads it. Private: its owner. Only the owner writes | `workstreams/<projectId>/<~owner>/<workstreamId>`, scope by visibility | One per owner per workstream id. Two users' `checkout` are two entries |
| A user's key for a project's MCP server | The user | The server only, never the model or a browser | `mcp-credentials/<server>`, user scope | One per server per user |
| Error reports | The organization | The operator. A user sees only their own failures, through the error history | `error-reports/*`, organization scope, no browser read | One per fingerprint, plus held requests and storm reports |

## Kit options

`workforce({ ... })` comes from `@flow-state-dev/workforce/kit`. Every key is optional. The schema is strict, so an unknown key is refused.

| Key | Type | What it does |
| --- | --- | --- |
| `directory` | string, read against the working directory | Where the kit's folder is, instead of `workforce/`. `fsdev gen --root` takes the same path |
| `agent` | the built-in `agent` flow's options, plus `showSettings` | Options for the flow that runs every worker naming no flow: model, tools catalog, `uses`, `afterAnswer`, `beforeAnswer`, `maxSteps`, `isolateUserState`, `skills`, `settings` and more. Omitted, the defaults, unless `workerFlows` holds an `agent` |
| `coordinator` | the coordinator flow's options | `routeModel` (required), `agent`, `roundDeadlineMs`, `routines`. Omitted, no coordinator flow, unless `workerFlows` holds one. See [Coordinators](#coordinators) |
| `consult` | `ConsultSessionsOptions` | The model and budget for consulting another of the user's conversations |
| `routines` | `RoutinesOptions` | The schedule index, event providers, polling and the app's declared routines |
| `github` | GitHub service flow options | Serves GitHub's service flow. Omitted, none |
| `internalEvents` | internal service flow options | The topics a session may publish and a routine may follow. Omitted, none |
| `generated` | `GeneratedWorkforce` | The module `fsdev gen` writes to `workforce/workforce.gen.ts`, passed whole. Its keys are `workerFlows`, `blocks`, `resourceModules`, `workerBlocks` and `packageBlocks`. Any other key is refused |
| `taskChainLimit` | whole number, 1 or more | The most tasks one top task may have under it, finished ones included. Default 100. A filing past it is refused `total_task_cap_exceeded`. A chain is never more than 5 boards deep, whatever this says |
| `messages` | `{ budget?, perTurn? }` | Limits on messages between workers. See below |
| `projectCoordinator` | non-empty string | The id of the standard worker each user's project coordinator runs as. It must be a standard worker on the `coordinator` flow, or the app does not start |
| `sessionFields` | record of zod schemas | App fields on every worker session. Only the server writes them, and the session's browser reads every one |

A `messages` value that is not a whole number of at least 1 throws at start: `hireWorkforce: messages.<key> must be a whole number of at least 1; got <value>.`

| Key | Default | Meaning |
| --- | --- | --- |
| `budget` | 6 | The most worker messages a chain passes with no user turn between them |
| `perTurn` | 3 | The most messages one turn sends |

`DEFAULT_MESSAGE_BUDGET` and `DEFAULT_MESSAGES_PER_TURN` are exported from `@flow-state-dev/workforce`. A `taskChainLimit` below 1 or not whole throws `hireWorkforce: taskChainLimit must be a whole number of at least 1; got <value>.`

### Slots the kit opens

| Slot | Shape | What an entry is |
| --- | --- | --- |
| `workerFlows` | keyed | A worker flow beside the built-in `agent`: a flow, `{ flow, standardOnly?, roles?, showSettings?, needsProject? }`, or a `workerFlow(...)` builder. An entry keyed `agent` or `coordinator` replaces the kit's own |
| `uses` | list | Capabilities added to the agent and coordinator flows the kit builds |
| `flows` | keyed | A builder handed the installation that returns flows built on it, such as an app's projects flow. The kit ships none |

The kit adds two capabilities of its own to the agent and coordinator flows: consulting another conversation and the routine tools. A worker gets each only when its file picks it. The kit does not add the discovery tool and does not write the inventory.

The kit registers one copy of each worker flow under the flow's name, then `workforce-roster`, then the GitHub and internal-event service flows when configured, then whatever the `flows` slot builds.

### Refusals at start

| When | What it says |
| --- | --- |
| `generated.workerFlows` and the `workerFlows` slot both hold a name | `` workforce: the generated module and `workerFlows` both hold "<name>". Keep one. `` |
| `agent` is configured and the worker flows also hold an `agent` | `` workforce: `agent` is configured, and the app's worker flows hold an "agent" flow too. Keep one. `` The same for `coordinator` |
| `agent.sessionFields` or `coordinator.sessionFields` | `` workforce: `<key>.sessionFields` is not read; declare session fields on the kit's `sessionFields`. `` |
| A worker file names `flow: coordinator` and the kit has no `coordinator` key | The app does not start. The error names the flow and lists the worker flows passed |
| Any file in the workforce folder failed to load, or no reader claimed it | The app does not start. One error lists every problem, as `<layer> <path>: <message>` lines |

`readWorkforceFolder` from `@flow-state-dev/workforce/loader` is the reader the kit uses. It throws when anything in the tree failed to load, naming every problem.

## Hiring and the roster actions

The roster flow `workforce-roster` carries the actions `hire`, `fork`, `edit`, `fire` and `reset`, plus the routine actions. All five write the caller's own roster. Nothing is registered and nothing restarts: the next turn on any process reads the row. A write that is refused changes nothing, and its request ends `failed` with the reason as the error.

`createWorkforceClient(fsd)` from `@flow-state-dev/workforce/browser` sends them as `hire(input)`, `fork(from, id)`, `edit(input)`, `fire(id)` and `reset(id)`. Each waits for the result and rejects with the failure's message. `HireWorkerInput` and `EditWorkerInput` are exported types.

| Action | Input (strict) | Returns |
| --- | --- | --- |
| `hire` | `id` (required, one path segment, not starting with `/` or `~`), `name?`, `flow?` (default `agent`), `description?`, `instructions?`, `skills?` (names), `settings?` (the keys a `WORKER.md` takes besides `flow` and `description`) | `{ id, flow }` |
| `fork` | `from` (a standard worker or one of the user's own), `id` (new) | `{ id, flow }` |
| `edit` | `id`, then any of `name` (`null` clears), `flow`, `description` (`null` clears), `instructions` (`null` clears), `skills`, `settings` (replaces the stored settings whole), `settingsPatch` (sets the keys it names, keeps the rest). `settings` with `settingsPatch` is refused | `{ id, flow }` |
| `fire` | `id` | `{ id }` |
| `reset` | `id` | `{ id }` |

A whitespace-only `name` or `instructions` is stored as none. The block form is `createWorkerHireBlocks(installation)`, which returns `{ hire, fork, edit, fire, reset }`.

Over the raw action API, `send` returns when the write starts, not when it ends. Before sending a write that depends on an earlier one, wait for the earlier request to settle and go on only if it `completed`.

`roster()` reads the roster once. `watchRoster(onRoster, { onError? })` calls `onRoster` once the roster is read, then again each time a hire, fork, edit, fire or reset changes it, from any tab or any worker's turn. Only a change is reported. The client also reads every 3 seconds while push does not cover the roster: the host has no push, the push connection is down, or the app's [change bus](./stores.md#the-change-bus) does not cross processes. A failed read goes to `onError` and retries on its own, starting at 1 second and doubling to 30 seconds. The next read that lands is reported even when the roster did not change. Several watchers on one client cost one read per interval. It returns the stop function.

### `hireWorkforce(installation, options)`

The kit calls it at start. It is not exported from `@flow-state-dev/workforce`, so an app does not call it. It reads no files and registers nothing itself. `options` takes `taskChainLimit`, `messages` and `routines`. It returns one flow copy per worker flow, sorted by flow name, then the roster flow last.

It throws, and registers nothing, when:

- a worker flow misses the worker contract. One error names every problem with every flow: `hireWorkforce refused <n> worker flow(s) ("a", "b"); nothing was hired:`, then one `- ` line per problem;
- a worker flow does not declare `session: installation.session()`;
- a worker flow cannot receive worker messages, or offers the send without the pass that sends it again;
- a standard worker would be refused on its first turn: `hireWorkforce: <n> standard worker problem(s); nothing was registered:`, then one `- worker "<id>" ...` line each;
- `routines.poll.index` equals `routines.index`.

## Worker flows and roles

A worker's flow is the `flow:` of its file or row. Absent, it is `agent`. A flow is the built-in `agent`, the `coordinator` when the kit has a `coordinator` key, or one the app registers through `workerFlows` or `generated`.

### What a worker flow must have

`hireWorkforce` checks each flow before it registers anything.

| Requirement | Detail |
| --- | --- |
| The standard configuration | `workerConfigSchema()` composed into `configSchema`. A key it declares must accept the value a worker brings and keep it as given |
| One door | Exactly one public action that declares `userMessage` and takes `{ message }`, named `respond` |
| A session that names its worker | `session: installation.session()`, which gives every session a readonly `workerId`, checked at create |
| A message entry | An `onMessageReceived` internal action built by `messageReceivedEntry`, or the board factory's |
| Shared resources | Any resource with `writtenBy` declared through `sharedResource()` |
| Role entries | The entries of each role the flow declares |

A flow passed under a key that is not its own `kind` is refused.

### Roles

A flow declares what else it does with `roles` on its registration: `workerFlow(build, { roles })`, or `{ flow, roles }` in `workerFlows`. The roles are `contributor`, `manager` and `coordinator`.

| Role | What the flow does | Entries it needs | Built by |
| --- | --- | --- | --- |
| `contributor` | Takes tasks other workers file for it | task entry `work` | `workerTaskEntry` |
| `manager` | Runs a delegation board: files tasks for delegates and hears how each ended | internal entries `dispatch` and `onTaskSettled` | `defineSessionBoard`'s `entries(turn)` |
| `coordinator` | Routes each message to delegates | a manager's, plus internal `routeOn`, `roundDeadline` and `changeWorkstreamDelegate` | `defineCoordinatorFlow` |

The built-in `agent` declares `contributor`, and `manager` when it has a board. The `coordinator` declares all three. A flow that declares no role takes no task and files none, so a worker on it cannot be a delegate.

Roles are checked both ways. A role is refused when an entry is missing, was not built by the role's factory, or refuses the input its caller sends. A role's piece on a flow that does not declare the role is refused too. Each message names the flow, the role, the entry and the fix. A role outside the three is refused: `` worker flow "<name>" declares "<x>" in `roles`, which isn't a role. `` `workerFlowProblems(name, flow, roles)` returns the problems without an app.

### Marks on a registration

| Field | Effect |
| --- | --- |
| `standardOnly: true` | Only standard workers may run on the flow. A user's own worker naming it is refused. A worker that names no flow runs on `agent`, and the mark is checked after that |
| `roles` | See above |
| `showSettings` | The flow's settings a user may see on the roster row. A name that is part of every worker's configuration (`instructions`, `skills`), a key the hire reads itself, or one the flow does not declare in its `configSchema` is refused |
| `needsProject: true` | A board refuses a task for a worker on this flow that is filed with no project, as `no_project`, before any row or run exists |

The built-in `agent` declares a fixed set of settings. `defineAgentWorkerFlow({ settings })` adds app settings a worker's file may set, such as an icon or a color, and a name the flow already uses is refused. Name an added setting in the flow's `showSettings` and its value appears in the worker's roster entry, under `settings`, for a screen to read. The agent flow never reads an added setting, so it cannot change how a worker runs.

## The roster

A roster entry, as `rosterView` and `roster()` answer, has nine fields: `id`, `flow`, `standard`, `description`, `name`, `teamName`, `forkedFrom`, `edited` and `settings`. It has no status field. The view lists the user's own workers first, then the standard workers, each part sorted by id.

| State | What it is | `standard` | `edited` | `forkedFrom` | `teamName` |
| --- | --- | --- | --- | --- | --- |
| Standard | A `WORKER.md`. Every user has it, set up as the file says | `true` | `false` | `null` | the file's team name |
| Edited | A standard worker the user changed: their own copy under the same id. Listed once, as the copy, on its file's team | `true` | `true` | `null` | the file's |
| Forked | A user's own worker made from another worker's configuration under a new id | `false` | `false` | the source id | `null` |
| Hired | A user's own worker made from scratch | `false` | `false` | `null` | `null` |

- A hired worker's id is one path segment, not starting with `/` or `~`. The naming rules for file workers do not apply. An id that belongs to a standard worker is refused.
- A fork copies the flow, description, instructions, the team instructions a standard worker carried, skill names and settings. A later change to the files does not reach the fork, and the standard worker is unchanged for everyone. A fork starts with no conversations.
- A fork of an edited standard worker starts from the user's copy, without its name. A fork's `name` is `null`.
- A copy made by editing a standard worker keeps the file's `name:`.
- A session names its worker as `state.workerId` when it is created, readonly afterward. `delegates:` names workers by id. A block inside a worker reads `ctx.flow.config.workerId`. A `WORKER.md` that declares `workerId:` is refused by name.

### What happens when a user edits a standard worker?

- The first `edit` of a standard worker's id writes the caller's own copy under the same id. It holds the file's configuration (flow, description, instructions, team instructions, skill names, settings, name), with the fields in the edit replacing it.
- The file is never written. Other users' copies and the file are unaffected.
- The copy is read before the file on the roster and on every turn, so the edit takes effect on the next turn, in every session of that worker, on any process.
- The worker stays on its file's flow. Naming another flow is refused: `"<id>" runs on "<flow>", as its file declares, so its flow can't be changed. Nothing was written.`
- The copy keeps the file's own skills and packages. A name-only edit changes nothing else about the turn.
- The roster entry shows `standard: true` and `edited: true`.
- `reset(id)` deletes the copy, so the file is read again. It is refused on a worker that is not standard (`"<id>" isn't a standard worker, so there is no default to reset it to. Nothing was written.`) and on one the user has not edited (`You haven't edited "<id>", so it already matches its file. Nothing was written.`).

### Fire

`fire` deletes the user's own row. It is refused on a standard worker, which nobody can fire, and on an id not on the user's roster. The user's past sessions with the worker stay readable. A new turn in one is refused: `Worker "<id>" was fired. This session stays readable; a new turn can't run as it.` Every process sees the fire on the next turn. A standard worker whose file is deleted leaves the roster the same way.

When an edit moves a worker to another flow, its earlier sessions stop taking messages, naming both flows: `Worker "<id>" now runs on flow "<new>", and this session runs on "<old>". A session stays on the flow it was created on: start a new session to talk to it on "<new>".`

A user's own worker that stops resolving after it was saved, such as one whose tool was removed or whose flow became `standardOnly`, is not dropped. Its next turn is refused, naming the problem, and an `edit` fixes it.

### Who can reach a worker

Only the owner. Another user cannot list a worker, open its sessions, message it or create a session with it, and asking for another user's worker gets the answer for one that does not exist. A worker acts only for its owner. A message cannot cross users, only workers on the same roster.

## Refusals

Every refused write changes nothing.

### Roster writes

| What happened | The error |
| --- | --- |
| `hire`, `fork` onto, or `fire` of a standard worker's id | `"<id>" is a standard worker, which nobody can <hire over\|replace\|fire>. Fork it to get a worker of your own.` |
| `hire` or `fork` under an id already on the roster | `"<id>" is already on your roster. Pick another id. Nothing was written.` |
| `fork` from, or `edit` or `fire` of, a worker the user has not got | `No worker "<id>" on your roster.` |
| A stored row that cannot be read | `Worker "<id>" can't be read: <reason>.` |
| The flow names no registered worker flow | `Worker "<id>" names flow "<flow>", which isn't a worker flow here. Worker flows: "agent", ... Nothing was written.` |
| The flow is `standardOnly` | `Worker "<id>" names flow "<flow>", which this app keeps for declared workers, the ones its WORKER.md files define. A hired worker can't run on it. Nothing was written.` A worker naming no flow reads `names no flow, so it runs on "agent"` |
| A skill nothing registers | `Worker "<id>" names skill "<name>", which this installation doesn't register. Remove it, or register it. Skills it registers: "a", "b". Nothing was written.` With none registered: `It registers no skills.` |
| A tool the built-in `agent` flow does not know | `names tool "<name>", which nothing registers for this worker`, then the known catalog tools |
| A setting the flow's schema refuses | `Worker "<id>" <the flow's own reason>. Nothing was written.` |
| `edit` of a standard worker onto another flow | See [the edit lookup](#what-happens-when-a-user-edits-a-standard-worker) |
| `edit` with `settings` and `settingsPatch` | `Give settings (replace them whole) or settingsPatch (change the ones named), not both.` |
| `reset` of a worker that is not standard, or not edited | See [the edit lookup](#what-happens-when-a-user-edits-a-standard-worker) |
| An id with `/`, or starting with `~` | `a worker id is one path segment and can't start with ~` |

A worker's configuration is checked when it is written and again on every turn.

### Why a standard worker is refused at start

For a standard worker, every one of these is a start-up failure. `hireWorkforce` collects every problem first, throws once, and registers nothing, so one run names all of them. Each line starts `worker "<id>" — `. A user's own worker is checked the same way when hired or edited.

| Cause | What the message says |
| --- | --- |
| Two workers share an id | `declared twice in this roster; a worker's id is its address and must be unique` |
| `persona:` declared | `` declares `persona:`, which is not a setting a worker declares. `` It says to spell it `instructions:` |
| `workerSkills:`, `teamInstructions:`, `workerTools:`, `workerPackages:` or `workerId:` declared | `` declares `<key>:`, which is not a setting a worker declares. ``, with a sentence on where the value comes from |
| `instructions:` in the frontmatter and a body | Two sources for one setting, with no precedence rule. Remove one |
| `flow:` present but empty or blank | It names no worker flow. Remove the key to hire on the built-in `agent` flow, or name a worker flow you passed |
| `flow:` not a string | The same, quoting the value |
| `flow:` names a flow not passed | `names flow "<flow>", which is not in the worker flows passed to hireWorkforce. Worker flows passed: "agent", ...` |
| A standard worker's `delegates:` names a worker that is not standard | `` createWorkerInstallation: standard worker "<id>" names "<x>" in `delegates:`, which isn't a standard worker. A standard worker's delegates must be standard workers too. `` `delegates: all` is exempt |
| A settings key its flow never declared, or a required one missing | The flow's own schema message |
| An unresolved `packages:`, `references:` or `resources:` entry, a name clash, or a grant collision | Named by case |

### Sessions and turns

| When | The refusal |
| --- | --- |
| A session create with no `workerId` | `A session of flow "<flow>" runs one worker: name it as "workerId" when the session is created.` |
| An unknown id, or another user's | `No worker "<id>".`, status 404 |
| A row that cannot be read | `Worker "<id>" can't be used: <problem>.` |
| A session on the wrong flow | `Worker "<id>" runs on flow "<flow>", not "<kind>". Create its session on "<flow>".` |
| A user's own worker on a flow kept for standard workers | `Worker "<id>" <standardOnly reason>.` |
| A create naming `taskId`, `filingFlow`, `filingWorkerId`, `taskChain`, `taskFlow`, `filingWorkstreamId` or `filingProjectId` outside a hand-over | `"<key>" is set only when a session's board hands a task over; a caller cannot set it.` (400) |
| A create naming an app session field | `"<key>" is written only by the server, when the session opens or a task is handed over; a caller cannot set it.` (400) |
| A create naming `filingSessionId` | `"filingSessionId" is set only when a conversation opens the session; a caller cannot set it.` (400) |
| A create naming `delegates` on a coordinator | `Session state field "delegates" is written only by flow "coordinator"; a caller cannot set it.` (400) |
| A turn on a session naming no worker | `This session of flow "<flow>" names no worker, so this turn has no worker to run as.` |
| A turn on a flow that is not a worker flow | `Flow "<flow>" isn't a worker flow here, so worker "<id>" can't run on it.` |
| A turn on a fired or moved worker | See [Fire](#fire) |
| A turn on a worker whose configuration fails its check | `Worker "<id>" can't run: <problems joined by "; ">.` |
| A `projectId` create on a flow other than the project coordinator | `Only a session of the project coordinator "<id>" links to a project, not one of "<worker>".` |
| A project coordinator session at an id of the user's own choosing | `A project's coordinator is one session per user per project, at the id derived for it: create it with ensureWorkerSession({ worker, projectId }), with no session id of your own.` |
| A project link naming a project the user cannot read | `You have no private project "<id>".` or `This organization has no project "<id>" you can read.`, status 404 |

A task filed for a worker on a `needsProject` flow with no project is refused `no_project`: `"<assignee>" works in a project's files, and this conversation has no project for it to work in. Nothing was filed.` It tells the filer to call `listProjects`, then `setWorkProject`.

## Coordinators

A coordinator is a worker on the `coordinator` flow. It hands each user message to delegates by filing one ordinary task per pick on the conversation's board, in the delegate's ongoing session for this conversation, with the result sent to this conversation and one attempt. Every pick is checked against the user's roster when the message arrives, so a fired delegate is skipped and recorded. The coordinator never routes to itself.

### Kit option `coordinator`

| Key | Meaning |
| --- | --- |
| `routeModel` | A model string or evaluation model. Required, with no default. Only `best-fit` calls it; if the call fails, `fallback` takes the message. Shared by every coordinator on the flow |
| `agent` | The options the built-in agent flow takes, for the coordinator's own turn. `uses` capabilities reach that turn |
| `roundDeadlineMs` | A positive whole number of milliseconds. Default 5 minutes. Otherwise the flow throws `defineCoordinatorFlow: roundDeadlineMs must be a positive whole number of milliseconds, not <n>.` |
| `routines` | `true` keeps the four routine verbs as actions |

A custom `coordinator` flow in `workerFlows` replaces the kit's only when the kit's `coordinator` key is dropped.

### A coordinator's file keys

| Key | Type, default | Meaning |
| --- | --- | --- |
| `delegates` | list of worker ids (at most 25), or `all`. Default `[]` | The defaults each conversation starts from. Any worker may list them. A standard worker may name only standard workers |
| `routing` | `judgment` (default), `best-fit`, `round-robin`, `everyone` | How a message finds its delegates |
| `fallback` | one of `delegates` | Where best fit sends a message it cannot place |
| `minConfidence` | number from 0 to 1, no default, only with `best-fit` | The lowest confidence at which a delegate pick is used |
| `editsOwnDelegates` | boolean, default `false` | Whether the model gets `addDelegate`, `removeDelegate` and `setFallback` as tools |
| `rounds` | integer from 0 to 3, default 0 | How many times answers go back out |
| `inferredWork` | `off`, `observe` (default), `auto` | What the coordinator does with an event nobody asked it about. `off` lands it as a line and runs no model. `observe` runs the turn, and every task it files waits on the user's yes in Inbox. `auto` runs it as any other |
| `defaults` | sections of the default layer | Authored like `delegates` |

Start refusals: `rounds can be at most 3`, `minConfidence must be a number from 0 to 1`, and across keys `` names "<x>" twice in `delegates:` ``, `` names "<x>" as `fallback:`, which isn't one of its `delegates:` `` and `` sets `minConfidence:`, which only `routing: best-fit` reads ``, joined as `This coordinator <problems>.` `delegates: all` skips the duplicate and fallback checks.

### Routing modes

| Mode | Who decides | Model calls per message | Delegates reached | When answers go back out |
| --- | --- | --- | --- | --- |
| `judgment` | The coordinator's own turn reads the message, then files tasks with `createTask` naming the delegate, or answers itself | The coordinator's own turn | Whoever the turn names | When the round closes |
| `best-fit` | One evaluation, the fit check, over the delegates' descriptions | One `routeModel` call, unless the message goes to the delegate holding the user's last message | The one picked | As each answer lands |
| `round-robin` | The next delegate in list order after the one the user's last message went to. Two messages that arrive at once go to two consecutive delegates | None | One | As each answer lands, never back to its author |
| `everyone` | Every delegate that can be reached | None | All of them | When the round closes |

When no delegate can be reached, `round-robin` and `everyone` say `Nobody took this message: no delegate in this conversation can be reached.` On an answer going back out, round-robin says `no other delegate in this conversation can be reached` and everyone says `no delegate that can be reached has another's answer to get`. The line is a message with no `agentName`. A delegate's answer carries the delegate's worker id. The coordinator's own turn's reply carries an `agentName` starting with `coordinator-judgment`, exported as `COORDINATOR_JUDGMENT` from `@flow-state-dev/workforce/browser`.

### How best fit places a message

In order:

1. **Held.** The delegate holding the user's last message, if it can be reached, gets this one too, with no model call. Only a user's message moves the hold.
2. **Evaluated.** One `routeModel` call. Its input is the message plus the conversation's last 10 lines, kept to 4,000 characters in all, newest first. The line that crosses the limit is cut short and ends in `…`, and older lines are left out. A delegate is matched on its note (from `addDelegate`), else its worker's description. A delegate with neither is never offered. On a user's message the coordinator itself is also offered, by its own id, when it has a description. The call is asked as an evaluation first. When that fails on a model string, it is asked once more as a language model.
3. **Fallback.** When the call failed, picked something that is not an option, picked below the floor, had no confidence under a floor, or there was nobody to pick from, `fallback` takes the message if one is set and can be reached.
4. **The coordinator's own turn.** When the pick was the coordinator, or nothing placed the message, it goes to the coordinator's own judgment turn.
5. **Nobody.** Only when that turn itself fails: `Nobody took this message: best fit couldn't place it, and the coordinator's own turn failed: <message>.` The crash is sent to the error reporter.

`minConfidence` applies to evaluation models that report a confidence from 0 to 1. A delegate pick below it is not used, and a pick with no confidence is not used when `minConfidence` is set. A pick of the coordinator is used at any confidence.

### Rounds

`rounds` is how many times answers go back out. Below the limit, best fit and round-robin route each answer again as it lands, never to its author. `everyone` and `judgment` send a round's answers on when the round closes.

A round closes when every delegate in it has answered, failed or been cancelled, or at its deadline (`roundDeadlineMs`). A delegate that is working at the deadline keeps working, and its answer lands once and goes no further. A conversation keeps at most 50 rounds open. A message past that is delivered, its answers go no further, and its route record carries a `note`. On a host with durable execution, a round's deadline survives a restart. On other hosts it is lost when the process stops. The most delegate turns one message can start is delegates times (rounds + 1): 100 with 25 delegates and 3 rounds.

### Delegates

The file's `delegates:` seeds each conversation. The conversation copies it the first time its delegates are read or changed. `addDelegate`, `removeDelegate` and `setFallback` change only that copy, and the file is never written.

These actions are on any worker whose flow carries the board.

| Action | Input |
| --- | --- |
| `addDelegate` | `worker`, optional `note` |
| `removeDelegate` | `worker` |
| `setFallback` | one of the delegates |
| `listDelegates` | none. Adds `description` (or `null`) and `takes` (`tasks` or `nothing`) to each delegate, read from the roster at call time |

Each returns the conversation's list after the call: `{ delegates, fallback, max: 25, filingSessionId }`. The view `delegates` answers the same, live. The same four are tools. The three that change a list refuse unless the worker's file set `editsOwnDelegates`: `This worker's delegates are changed by its user, not by this worker: it wasn't set at hire to change its own (editsOwnDelegates). Ask the user, or message whoever filed your task. Nothing was changed.`

| Refusal | Message |
| --- | --- |
| `addDelegate` for a worker not on the user's roster | `No worker "<id>" on your roster.` |
| A row that cannot be read | `Worker "<id>" can't be a delegate: <problem>.` |
| The worker's flow takes no task | `Worker "<id>" runs on flow "<flow>", which takes no task, so it can't be a delegate.` |
| `addDelegate` of one already listed | `"<label>" is already a delegate in this conversation.` |
| A 26th delegate | `This conversation already has 25 delegates, the most it can hold. Remove one first.` |
| `removeDelegate` of one not listed | `"<label>" isn't a delegate in this conversation.` It checks only the list, so a fired delegate can be removed |
| `setFallback` to one not listed | `"<label>" isn't a delegate in this conversation, so it can't be the fallback.` |

Another user's worker and a worker that does not exist get the same answer. A fired delegate that was already handed a message answers it. Removing the fallback clears it, and best fit then hands what it cannot place to the coordinator's own turn.

### Which worker may hand work to which?

A worker hands work to the workers in its conversation's delegate list, and to no one else. A worker can be a delegate when:

1. It is on the filing user's own roster at the time of the filing, either their own worker or a standard one. Another user's worker is not there.
2. Its stored row can be read.
3. Its flow declares the `contributor` role. The built-in `agent` and `coordinator` flows declare it, so workers on them, another coordinator included, are eligible with no setup.

More rules:

- `delegates: all` means the whole roster, the worker itself included, read on every call, so a worker hired mid-conversation is reachable at once. The cap of 25 bounds a written list, not `all`. Only a worker file sets `all`: no tool switches a list to it.
- The coordinator skips itself when routing and refuses a task filed for itself: `"<id>" is you: answer the message yourself rather than file it for yourself.`
- A standard worker may name only standard workers in `delegates:`, or the app does not start. `delegates: all` is exempt.
- A task for a worker not in the conversation's delegates is refused, and the refusal names the worker: `unknown_assignee: "<id>" is not on this board's team. Available: ...`. Nothing is stored. Another user's worker and a worker nobody holds get the same answer.
- A custom flow is a delegate with the `contributor` role plus a `work` task entry built with `workerTaskEntry`. Either without the other is refused at start, and the refusal names the flow, the role and the entry.
- A flow whose tasks come only from a board of its own registers without `contributor`. `listDelegates` then reports `takes: "nothing"`, routing skips it and `createTask` refuses it.
- A flow of the app's own that is a delegate is handed the message only, unless its generator sets `history: routedTaskHistory`, from `@flow-state-dev/workforce`.
- A task with no `assignee` goes to the conversation's only task-taking delegate. With several, it waits unassigned.
- A delegate may file tasks only for its own worker's delegates, and a task chain is at most 5 boards deep.

### What the coordinator's model gets

- The task tools (`createTask` and its siblings). The session also serves them as actions named `<tool>_tasks` (`createTask_tasks`), which answer `no_delegation_board` while none of the conversation's delegates takes tasks. The turn has the tools either way: with no delegate that takes tasks, it can file steps only for itself, on its `plan` board.
- `listDelegates`, and the three change tools when `editsOwnDelegates` is true.
- The routed filing rules. A task filed while routing a message must name an `assignee` (`routed_assignee_required`). A pick that cannot be handed on is refused `not_routed: not handed to <worker>: <reason>. Nothing was filed.` `held`, `deps` and `followUpOf` are refused `routed_task_starts_now`. A `session` other than `"ongoing"` is refused `routed_session_ongoing`. A routed task has one attempt, where an ordinary task has two. Its `session`, `resultTo` and `target` cannot be changed afterward (`filing_setting_fixed`).
- A routed task's turn is handed `{ message }`, which reads `<from>, through <coordinator>: <message>`, plus `Your task: <goal>` on its own line when the coordinator's turn filed it with a goal. Whatever the turn returns, a string or `{ text }`, is the answer. An empty answer lands nothing.
- Cancelling a routed task with `updateTask_tasks` and `status: "cancelled"` ends the delegate's part with no line, and its late output does not land. The delegate's turn itself runs on.

### Surface

| | |
| --- | --- |
| Slots it opens | None |
| Slots it fills | None |
| `uses` | `coordinator.agent.uses` capabilities reach the coordinator's own turn. The kit adds `consultSessions` and the routine tools |
| Views | `listTasks_tasks` (the conversation's board) and `delegates` |
| Items | `coordinator-route`, one per routing decision. A client tells it from a line by that type. A React app registers a renderer under `COORDINATOR_ROUTE` in `FlowProvider`'s `renderers.data`. The renderer gets `{ item: DataItem }` and reads `item.value` |
| Reading the records outside a renderer | `fsd.sessions.requests(session.id, { includeItems: true })`. Without `includeItems: true` a request carries no `items` |

The route record is visible to the client and not to the model.

| Field | Meaning |
| --- | --- |
| `messageRequestId` | The request of the message routed |
| `round` | 0 for a user's post |
| `policy` | The conversation's routing |
| `by` | `judgment`, `held`, `evaluated`, `fallback`, `round-robin`, `everyone` or `unplaced` |
| `delegates` | Each with `worker`, `outcome` (`delivered`, `skipped` or `failed`) and `reason` |
| `none` | Why nobody was delivered to |
| `answeredItself` | Judgment answered with no delegate tried |
| `fit` | `reason` (`coordinator`, `below-floor`, `no-confidence`, `failed`, `not-a-choice` or `no-delegates`), plus `choice`, `confidence` and `minConfidence` |
| `evaluationFailed` | The evaluator's error, when the second ask was needed |
| `note` | Set when a message went past the 50-round limit |

## Discovery

The discovery tool is `discover`. It is added by `createWorkforceCapability({ roster, inventory, sources? })`, composed into a worker flow's `uses`. The kit does not add it. It is a control tool, one a worker's `tools:` line cannot remove, and the preset `door` can be turned off.

| Part | What it is |
| --- | --- |
| Input | `{ domain?: string \| null, detail?: "thin" \| "full" }`. `domain` defaults to `null`, every domain in scope. `detail` defaults to `thin` |
| Domains | `workers`, `skills`, `resources` |
| Output | `{ domains: [{ domain, entries, problem? }], problem? }`, entries sorted by `id` |
| Entry fields | `id`, `kind`, `purpose`. `contract` appears only with `detail: "full"`, and only when the entry has one |
| A worker's entry | `kind` is `"worker"`, not its flow. `purpose` is the file's `description:`, trimmed. Without one, the worker's instructions. Without those, `The worker "<id>". Its file declares no description.` The full `contract` is `Hired into the "<flow>" worker flow. Hand it work by its id.` |
| Which workers | Workers present in both the declared files and the inventory rows. An inventory row whose file is gone is not listed. Hired and forked workers are not listed |
| Unknown domain | Not a throw: `` { domains: [], problem: 'Unknown domain "<x>". Known domains: workers, skills, resources. Call again with one of those, or omit `domain` for everything in scope.' } `` |
| A domain that throws | Reported as `problem` on that domain, with no entries. The others answer. A cancelled request throws |
| A domain with no source | `{ domain, entries: [] }` |
| Narrowing | A worker's `discover:` list in its file keeps only the domains it names. Omitted, every domain the scope carries. `[]`, none. It only subtracts: a domain the app did not install cannot be added. A misspelt domain is refused at start, by name |
| The `workers` domain needs the inventory | With no inventory key given, the domain has no source and the tool carries one domain fewer, not an error |

## Projects and workstreams

A project holds a brief, an optional repository, and the MCP servers and checks its runs use. A workstream is one user's line of work in a project, led by one of their workers.

### Addresses and who may do what

- A project's address is its visibility plus its id: `{ visibility: "shared" | "private", id }`. A private and a shared project with one id are two projects. Every read and write after the create takes an address.
- A private address reaches only the caller's own user scope. Another user's private project is refused as if it did not exist (`no-such-project`).
- Visibility and `members` are fixed at creation. No action changes either. Only `createProject` writes `members`, from its `members` input; the creator is always included.
- These keys and names are stable, so an app may read or match them: `projects/*`, `project-files/**`, `workstreams/...`, the flow `projects` (`PROJECTS_FLOW`), the views `checkRepository` and `projectSetup`, and the connector-keys path `/api/flows/mcp-credentials`.

The host registers the actions with `defineProjectBlocks(options)` on the flow `projects`: `createProject`, `setRepository`, `setMcpServers`, `setChecks`, `setBrief`, `readProject`, `listProjects` and `readProjectFiles`. It also registers the views `projectSetup` (always) and `checkRepository` (only when the host gives `checkRepository`), and the `connectorKeys` transport adapter. `setRepository`, `setMcpServers`, `setChecks` and `setBrief` are for `members` only.

| Option | Meaning |
| --- | --- |
| `mcpServers` | The names the host offers. Absent, none, and every name is refused `unknown-mcp-server` |
| `checkRepository` | Asks whether a run could check a repository out |
| `projectCoordinator` | The worker each user's project coordinator runs as |

### `createProject`

Input is strict.

| Field | Meaning |
| --- | --- |
| `id` | Required. One path segment. Never `unassigned`, no `/` or `\`, not `.` or `..` |
| `title` | Required |
| `brief` | What the project is for. Stored as `null` when omitted |
| `visibility` | `shared` (default) or `private` |
| `members` | Who besides the creator may open workstreams. The creator is always included. A private project may name nobody else (`private-has-members`) |
| `repository` | A git remote. Omitted or `null`: none. Not a bare path, not starting with `-`, with no credential in it |
| `mcpServers` | Names the host offers. Omitted: none |
| `checks` | Commands that check the code. Omitted: none |

It returns `{ project, visibility, created }`. `created` is `false` when the same owner re-sends an id it already holds. The row comes back unchanged, and the host's repository check is not asked again. The owner is the session's user, recorded as `ownerUserId`. The id of a shared project is first come, first held: another owner's row holds it (`project-id-held`). Row defaults are `status: "active"`, `brief: null`, `repository: null`, `mcpServers: []` and `checks: []`. A browser reads every field of the row.

`listProjects` returns the projects the caller is a member of, shared first, then private, each with `visibility`, `id`, `title`, `repository` and `brief`. `readProject({ project })` returns `{ project, visibility, workstreams, progress }`: every workstream's entry, oldest first, with reports left out, and the progress worked out from them.

| `progress` field | Meaning |
| --- | --- |
| `workstreams` | The count |
| `byStatus` | Counts by status |
| `objectives` | `{ met, total }` |
| `nextDue` | The nearest due date among workstreams not `done` |
| `stale` | Entries unchanged for 7 days |

`setBrief({ project?, brief })` is for `members` only. `brief: null` clears it. With no `project`, it is the project the conversation is linked to. It returns `{ project }`.

The tools a worker calls are `listProjects`, `createProject`, `setRepository` and `setBrief`, plus `setWorkProject`, and for workstreams `openWorkstream`, `updateWorkstream`, `editWorkstream` and `listLeads`. The `setRepository` tool stops for the user's approval before it writes.

### `openWorkstream`

Input: `project?` (an address; absent, the linked project), `id`, `title`, `lead`, `due?` and `objectives?` (strings). It returns the entry with `opened`. The preconditions, in order:

1. The id is one path segment (`invalid-workstream-id`).
2. On a shared project, the caller is one of its `members` (`not-a-member`). A private project is the owner's.
3. The lead is a worker on the caller's own roster (`no-such-worker`), whose flow can lead and that lists delegates (`cannot-lead`). `delegates: all` counts.
4. If the entry exists, its lead is the same (`lead-differs`).
5. With a project coordinator named, the owner has fewer than 25 open workstreams there, open meaning not `done` (`too-many-workstreams`).
6. On the tool a worker calls, a fit check about the chosen lead runs only when `leadFit` is set and the worker has a description. `lead-doesnt-fit` comes only when the check answers that none fits. A check that cannot answer lets the open through. Opening again is not checked. The user's own `openWorkstream` action is not checked.

The effects, in order: the entry is created with status `on-track`, then the lead's workstream session is created (the caller's, naming the lead as its worker and the workstream as its `workstreamId`), then the session id is written on the entry. Opening twice leaves one entry and one session. An open that made the entry but not its session is finished by opening again. With a project coordinator, each open workstream is one delegate record on the owner's coordinator for that project.

### Workstream entries

An entry lives at `workstreams/<project>/<~owner>/<id>`. The engine refuses a create, update or delete from anyone but the user the key names, whichever flow writes, with nothing changed. The lead is chosen at open and never changes. Nothing deletes an entry: `done` is a status.

| Field | Meaning |
| --- | --- |
| `title`, `lead` | Set at open |
| `sessionId` | `null` until the open names it |
| `status` | A label, trimmed, not empty, at most `WORKSTREAM_STATUS_MAX_LENGTH` characters. Default `on-track`. `done` is the one label with a meaning: a done workstream stays listed, is never stale and is never the next due date |
| `due` | `YYYY-MM-DD` |
| `objectives` | `{ text, met, metAt, metBy }` each |
| `openedAt`, `updatedAt`, `writtenBy` | Stamps. `writtenBy` is for display and never decides a write |

The latest report is the entry's content. `updateWorkstream` takes `project`, `owner?` (naming another owner is refused by the store), `id` and the changes `title?`, `status?`, `due?`, `objectives?` and `report?`. The lead's own tool writes only the workstream its session leads, read from the readonly `workstreamId`, and takes no title.

### The project coordinator

There is one coordinator session per user per project, private to that user, at an id derived from the user, organization, flow and project. Its delegates are the user's open workstreams in the project, one record per workstream, so two workstreams led by one worker are two delegates. The list is seeded the first time it is read, then changes only when a workstream opens, is marked `done`, or moves back out of `done`.

Its `readProject` tool returns the project, every workstream's entry, `progress`, and `yours: true` on the caller's own. On a shared project the organization's entries are read, and it hands work only to its user's. A task naming another user's workstream is refused as an unknown assignee. With no workstream of the user's own, it reads and answers without handing off.

The session is left out of the ordinary worker-session list. Asking for one on a project the caller cannot read is refused with a 404.

### Project refusals

`ProjectRefusedError` carries a `reason` a caller branches on. Its message is `<reason>: <detail>`.

| `reason` | When |
| --- | --- |
| `not-a-member` | The session's user is not in the project's `members` (changing a field, opening a workstream) |
| `no-such-project` | No row holds the id at that visibility. Another user's private project gets this too |
| `private-has-members` | A private create names someone besides its owner |
| `invalid-project-id` | The id is `unassigned`, empty, or not one path segment |
| `project-id-held` | Another owner's row holds the id |
| `invalid-repository` | The repository is a bare path, starts with `-`, or carries a credential. The message never repeats the value |
| `repository-unusable` | The host's `checkRepository` says no run could check it out |
| `invalid-mcp-server` | An MCP server is not a bare name (lowercase letters, digits, hyphens) |
| `unknown-mcp-server` | The host does not offer a server of that name |
| `invalid-check` | A check command is not one program and its arguments, run with no shell |
| `invalid-workstream-id` | A workstream id is empty or not one path segment |
| `no-such-worker` | The lead is not on the caller's roster. Another user's worker gets this too |
| `cannot-lead` | The lead's flow cannot lead, or the worker lists no delegates |
| `lead-doesnt-fit` | The fit check answered that none fits a worker's own pick of lead |
| `lead-differs` | The workstream is open already with another lead: `workstream "<id>" is already open, led by "<lead>". A workstream's lead doesn't change.` |
| `no-such-workstream` | The caller has no such workstream |
| `not-a-workstream-session` | The lead's tool ran on a session that leads no workstream |
| `too-many-workstreams` | The owner has 25 open workstreams in the project and the installation names a project coordinator |
| `other-project` | A write from a conversation linked to one project names another |

A run whose source is `projectWorkspace()` is refused before any file or clone exists. The reasons are listed in [Harness runs](./harness-runs.md#workspace-options).

### Project MCP servers

A project names MCP servers by bare name. The user supplies the key for each, once, at `mcp-credentials/<server>`. A project naming a server for which the user has set no key gives that run no access to it, and the run's session says so once, naming the server and the reason, never an address or a key. A key set for a server no project names is unused. The key is in the connection's headers only, and a failed call's message has the address and key removed.

The keys route is `/api/flows/mcp-credentials`. `GET` reads which keys the caller has set. `POST` and `DELETE` on `<path>/<server>` set and clear one.

## Inventory

The inventory is one organization-scoped collection, `inventory/workers/<id>`, with one row per standard worker. A row says the worker was registered, not that it is working. `workforce-roster` declares it, and so does any flow carrying `inventoryWriterActions()`. The kit does not write it. The app calls `openInventory(...)` at boot. Rows are never deleted for going missing.

| Field | Meaning |
| --- | --- |
| `id` | The worker's id, and the join key with the files |
| `kind` | The flow it runs on |
| `door` | The one public action that takes a user's message (`respond`), or `null` when the flow has none |
| `doorTakesTask` | Whether the door also takes a `taskId`. Send the key only when `true` |
| `name` | The display name from the file's `name:`, or `null` |
| `teamName` | Its team's display name, or `null` |
| `rules` | Whether the worker keeps standing rules: its flow declares the `standingRules` action |
| `hired` | `false` for a worker the files declare |
| `incarnation` | `null` for a declared worker |

A browser reads all nine fields, by scope or through a session by the pattern `inventory/workers/*`. The page size defaults to 50, and `limit` runs from 1 to 200. A bad ref is a 404 `ClientHttpError`. Another organization's rows are never returned.

`openInventory(workers, { run, workerWriter: { flowKind, sessionId? }, userId, orgId })` writes the rows and returns `{ workers, problems }`. `workers` is how many were written. Failures go in `problems` rather than throwing. It throws, naming what to pass, when `orgId` is absent (`DEFAULT_ORG_ID` from `@flow-state-dev/core` is the explicit value for no authentication), or when workers are given and `workerWriter` is not. Running it again writes the same rows, one per worker id. The writer action is `registerWorkersInInventory`, in `internal.actions` and never `actions`. The `run` callback must reject on a failed run and must forward `source`. The rows are the workers the files declare, from `inventoryWorkers(installation)`. A user's own workers are not listed.

### What Shift Manager reads

Shift Manager reads the organization's `inventory/workers/*` by organization scope, with no session. With no inventory read, or none holding a worker, four screens show a failure in place of their content: TEAMS, the Shift Coordinator view, Inbox's asks and Roster. The failure reads `No inventory to read: none of this Lab's flows declares the organization's worker inventory (inventory/workers/*) with a worker in it.` and goes on to name the likely causes: the Lab booted without opening its inventory, or the pages are an older build than the Lab. For asks it reads `Asks are read from worker sessions, and the worker inventory did not load. <reason>` Roster shows its failure only when there are also no workers, and it lists the user's own roster workers. The Projects screen does not need the inventory.

Screens re-read on another session's change, and poll every 30 seconds where the Lab cannot push. An "as of" summary is a read, not a live value.

Shift Manager finds the Shift Coordinator by name: a worker whose id, after the first `.`, is exactly `shift-coordinator`, either an organization worker (`shift-coordinator`) or a team's (`ops.shift-coordinator`). One match is it. No match shows `This Lab declares no shift coordinator`, with a line saying to declare one on the coordinator flow at `org/workers/shift-coordinator/`. Two or more matches name no worker, and the screen lists the ids. The conversation that opens is the user's one conversation with that worker, a session at an address derived from the user, organization, flow and worker. It appears once the session list holds it, and the user's first line opens it.

## Usage

Usage is a record per user, per worker, per UTC day. Every worker flow built on `installation.session()` with `installation.resources` records it. A flow of your own needs those two lines. When a request ends, however it ends, what it spent is added to the record for the session's worker and the day it ended on. It is not a quota: nothing limits what a worker may spend.

Read it through the view `workerUsage` on `workforce-roster`, with no session. In a browser, `workerUsageView` from `@flow-state-dev/workforce/browser` works with `client.view(workerUsageView, { days })` or `useView`. The input is `{ days?: number }`, an integer from 1 to 90, default 7 (`WORKER_USAGE_DEFAULT_DAYS` and `WORKER_USAGE_MAX_DAYS`). The period is today and the days before it, in UTC, so `days: 1` is today since midnight UTC. The view takes no user. It answers for whoever calls it.

It returns `{ workers: [...] }`: one row per worker that spent anything in the period, ordered by worker id.

| Field | What it holds |
| --- | --- |
| `worker` | The worker's id |
| `gone` | `true` when the worker has left the reader's roster. Its records are kept |
| `tokens` | `{ input, output }` summed over every source |
| `costUsd` | The sum of the sources that have one, `null` when none does |
| `bySource` | One entry per source, ordered by source, then billing |

| `bySource` field | What it holds |
| --- | --- |
| `source` | A model id, or a harness name such as `claude-code`, `codex` or `cursor` |
| `kind` | `model` or `harness` |
| `billing` | For a harness, `api-key`, `subscription`, or `null` when it could not tell. Always `null` for a model |
| `inputTokens`, `outputTokens` | Tokens spent |
| `costUsd` | A number only for a harness run on an `api-key` whose harness reported a cost. Every other source carries `null`, which a screen shows as "not reported", never `$0` |
| `runs` | For a harness, how many runs. For a model, how many request endings called it, so a request that pauses and resumes counts once for each ending |
| `unreported` | Harness runs that ended without reporting any tokens |

A harness run that ended before sending any usage counts once in `runs` and once in `unreported`, and adds no tokens.

Two requests that end at the same moment for one worker and day are both counted. A record that fails to write is logged, not failed. A flow that declares `installation.session()` but not `installation.resources` has nowhere to write: in development a request that spent tokens fails, naming the collection, and in production the request goes on and a warning is logged. A task's spend is counted from the same figures, per task. The record key is `<YYYY-MM-DD>/<worker>` in the collection `worker-usage/**`.

## Standing rules

A standing rule is one line a user asked a worker to follow in every later conversation with them.

| Tool | Input |
| --- | --- |
| `rules/read` | none |
| `rules/add` | `text` |
| `rules/change` | `number`, `current`, `text` |
| `rules/remove` | `number`, `current` |

A change or remove names the rule by its number and quotes its current text exactly. A write tool returns `{ rules: [{number, text}], max, saved: true, line }` on success and `{ rules, max, saved: false, refused: "Not saved: <reason>." }` on a refusal. Nothing changes on a refusal, and the tool's description tells the model to say "done" only on `saved: true`.

| Limit | Value |
| --- | --- |
| Rules per worker per user | 20 |
| Length of a rule | 1 to 300 characters, one line |

| Refusal | Reason |
| --- | --- |
| Empty text | `a rule can't be empty` |
| More than one line | `a rule is one line, and this text has more than one` |
| Too long | `a rule is at most 300 characters, and this one is <n>` |
| Full list | `the list is full (20 of 20); merge or drop a rule before adding one` |
| No such rule | `there is no rule <n>; the list has <m>` |
| Quoted text does not match | `rule <n> reads "<text>", not "<quoted>"` |
| Stale version | `the rules changed since they were read (version <v>, now <w>); here they are as they stand` |

When an add is refused for a full list, the user sees `✎ Rule not added: the list is full (20 of 20); merge or drop a rule before adding one.` in the conversation, and the add tool's description tells the worker to ask which rule to merge or drop.

- **The line.** Each successful write posts a line in the conversation, written by the tool, shown to the user and kept out of the model's history. `STANDING_RULES_LINE` (`standing-rules`) is the `agentName` a renderer tells it by.
- **Which workers carry the tools.** Workers on the `agent` and `coordinator` flows. A worker's `tools:` line neither needs to list them nor can remove them, because they are control tools.
- **When they are offered.** Only on a turn a user started. A task turn, a coordinator's post to a delegate, a delegate's answer reaching a coordinator, a task-ended notice and a workstream's open never get them. A caller naming the tool anyway is refused: `standing rules change only on a turn a user started; this one can't edit them.`
- **In the prompt.** When the list is not empty, the prompt gets `Standing rules (notes this user asked you to keep; follow them on every turn):` followed by the rules numbered. An empty list adds nothing. An edit counts from the next turn.
- **Unreadable.** The turn runs without them and posts a status line, `This turn runs without standing rules: they couldn't be read (<reason>).` The turn does not fail.
- **Stored.** In the `standing-rules` resource, user scope, one bucket per worker flow copy, so rules do not carry over when a worker moves to a different worker flow. A browser may read the state and not write it.

From a client, `standingRules(workerId, input)` runs in the user's session with the worker, on the worker's own flow. The flow must declare the action, and the inventory row says `rules: true`. Input is one of `{ op: "read" }`, `{ op: "add", version, text }`, `{ op: "change", version, number, current, text }` or `{ op: "remove", version, number, current }`, all strict. It returns `{ version, rules: [{ number, text, addedAt, sessionId }], line? }`, where `sessionId` is `null` for a rule added from the client. A refusal rejects with `Refused: <reason>.` and stores nothing. A stale version, a full list, bad text and a `current` mismatch go through the same validator as the tools.

## Error reporter

The error reporter watches for failures, groups them, drafts a report from the code with a harness, asks an operator, and files the report in a tracker.

**What reaches it.** The engine's `errorCapture` sends one event per request that ends failed, after retries, so a failure a retry fixed is not reported. An errored task on a conversation board is reported, including one that gave up without throwing. A cancelled task is not. A crash in a coordinator's own judgment turn is reported too, even though the message completes. A user can describe a problem to it, optionally naming a session, task or project, and a named session is read only against the user who named it. It never reports its own failures and is never routed through a coordinator.

**Grouping.** Failures with the same flow, action, block path, error code and message, with ids, numbers and paths taken out and lower-cased, share one report. Repeats raise its count, and redelivering one occurrence counts it once.

### Options

`createErrorReporter(options)`:

| Option | Meaning |
| --- | --- |
| `worker` | Required. The `WORKER.md` id |
| `operator` | Required. `{ userId, orgId }` |
| `tracker` | Optional. `{ project: "<visibility>/<id>", hint? }`. Without it, reports are kept and previewed but never filed |
| `preview` | `autoFile` and `autoFileAfterMs` |
| `limits` | See below |
| `filter` | Which failures to report. Default all |
| `secrets` | Extra secrets to redact, beside the environment's keys and the operator's MCP keys. Default none |
| `links` | Default none |
| `inboxLink` | A function from a report's session to the link that opens its Inbox item. Absent, the reporter says where a report waits, with no link |
| `log` | Default `console.warn` |

`defineErrorReporterFlow(options)` requires `reporter`, `installation` and `harness` (a function from feeds to a harness block). `cwd` (default `process.cwd()`), `mcpTools` (the project's MCP tools, through which a report files) and `agent` (the conversation turn's options) are optional. `defineErrorReporterIntakeFlow({ reporter })` takes only `reporter`. The host goes to `reporter.bind(host)`, not to any of the three, and `errorCapture: reporter.capture` goes in `createFlowState`.

| Option | Default | Meaning |
| --- | --- | --- |
| `preview.autoFile` | none | Error codes, or sources `request`, `task`, `manual`, `storm`, that file without a preview |
| `preview.autoFileAfterMs` | never | How long a preview waits before filing on its own |
| `limits.newPerWindow` | 5 | New reports per window. The rest go into one storm report |
| `limits.windowMs` | 1 hour | The storm window |
| `limits.commentEveryMs` | 1 hour | The most often a repeat adds a comment |
| `limits.dismissForMs` | 24 hours | How long a dismissed report keeps counting repeats |

The preview suspends the run, so the host needs durable execution. It is on by default over a persisting store, or with `durable: true`.

### Lifecycle

A report is gathered (the failure, its occurrences, and up to three of its newest requests and sessions, collected without a model), drafted (a harness reads the app's source with what was gathered, and the drafting run gets no tracker tools), shown to the operator, then filed. Secrets are redacted before anything is stored or shown. Statuses are `owed`, `drafting`, `previewing`, `filing`, `filed`, `dismissed` and `closed`.

The operator answers File, File with instructions, or Don't file (`decision: "file" | "dont-file"`, with optional `instructions`). A filing that fails stays approved and is retried, across a restart too.

A repeat of a filed report adds one counted comment at most once per comment interval, counted from filing or the last comment. If that comment run finds the issue `completed` or `canceled`, the report is marked `closed`, and the next failure with that fingerprint starts a new report linking the old issue. A reopened issue is not detected. More than `newPerWindow` new reports in a window go into one storm report. A dismissed report counts repeats only for `dismissForMs`. Status history is kept, and records are deleted past 90 days.

## Panels and views

### Views the kit serves

| Flow | Views | Browser handles |
| --- | --- | --- |
| `workforce-roster` | `roster`, `workerUsage`, `workerSessions`, `sessionTurns`, `workerMessages`, `inbox`, `workstreamReport` and `routines` | `rosterView`, `workerUsageView`, `workerSessionsViewRef`, `sessionTurnsViewRef`, `workerMessagesViewRef`, `inboxViewRef`, `workstreamReportView`, `routinesView` |
| `projects` (the host's) | `checkRepository` only when the host supplies `checkRepository`, and `projectSetup` always | `checkRepositoryView`, from `@flow-state-dev/workforce/browser` |
| `coordinator`, and any flow built with `defineSessionBoard` | `listTasks_tasks` and `delegates` | none |

The roster and usage views are read at user scope with no session, so the roster is available before any session is opened. `listTasks_tasks` returns the conversation board plus the `plan` board, the steps a worker files for itself. A session with no plan steps has an empty `plan` board.

A read of the tasks collection from a browser works only when the flow declares it, and answers 404 otherwise. `sessionIdOfFiling(filingSessionId)` takes a filing session id (a session id plus a `~` suffix) and returns the session id before the last `~`, or the input when it has none. It is exported from the package and its browser entry. `delegateAnswerOf(item)` recognises a delegate's answer item, which is recorded under the delegate's worker id.

A client component imports from `@flow-state-dev/workforce/browser`. The package root is server-only.

### React panels

`@flow-state-dev/workforce/react` exports `Roster`, `WorkerDetail`, `BoardColumns` and `BoardList`, with `groupIntoColumns` and `BOARD_STATUS_COLUMNS`. They are read-only and use no CSS framework. React is an optional peer.

| Behaviour | Detail |
| --- | --- |
| Columns | `BOARD_STATUS_COLUMNS` is `pending`, `in_progress`, `held`, `completed`, `errored`, `cancelled`, in that order. A status this version does not know becomes a column after them |
| Paging | `limit` is the page size requested each time, not a cap. The read follows `nextCursor` to the end, up to 1,000 pages. A server that repeats a cursor or keeps returning one gives an error line with Retry, never the rows read so far. The route's default page is 50 and its largest 200 |
| Live | `live` re-reads on another session's change. The panel's `client` is read-only |
| Empty `BoardColumns` | `This board has no rows. Boards are wired to a worker explicitly, so the likely reason is that nothing drains this one yet.` |
| Empty `BoardList` | `This board has no tasks.` |
| Empty `Roster` | `No workers have been hired in this organization yet.` |
| A failed read | The error with Retry |
| Slots | `slots.empty` replaces the empty text. `slots.card` replaces a card's body |

A card's row is the conversation board's client row. Its fields, and the ones never sent to a browser, are listed in [Task collections](./task-collections.md#reading-a-users-tasks-in-a-browser).

## Agent options

| Key | Meaning |
| --- | --- |
| `agent.model` | The default model for workers that name none. A worker's own `model:` setting wins, then `agent.model`, then `intent/chat`, a provider-neutral intent the app's resolver turns into a concrete model |
| `agent.maxSteps` | Model steps per turn. Default 50. The last step offers no tools |
| `agent.uses` | Capabilities every worker on the flow carries. A worker picks presets from them with `capabilities:` in its file. A `tools:` line fences tool-carrying presets, and control tools are not fenced |
| `agent.afterAnswer` | A block run after the worker answers, as a side chain. It cannot change the answer and receives the answer text as a string |
| `agent.isolateUserState` | When `true`, each flow copy gets its own user-scoped state. Default `false`: every worker on the installation's one `agent` copy shares a user's state |

Long-term memory belongs to the user and is shared across that user's workers on `agent`. A worker carrying memory records nothing of its own without `afterAnswer`, so it stays empty.

**Conversation window.** A worker on `agent`, and the coordinator's own turn, read the last 50 turns word for word. As the conversation nears 50 turns, the oldest turns, up to a quarter of the window (about 12) at a time, are replaced by a running summary. The summary stands in for the folded turns and is kept in the conversation from then on. A worker turns it off with `defaults: { historySummary: false }`.

### Skills

Each worker's skills are read on its own, so two teams can each have a `review` skill. The same name at two folder levels is refused, as [The workforce folder](./workforce-folder.md) lists. The same name in `defineAgentWorkerFlow({ skills })` and in a worker's folders is refused separately, when the worker's configuration is checked: `holds skill "<name>" from its own folders, and defineAgentWorkerFlow({ skills }) carries a skill of the same name.` followed by the same instruction to rename or drop one. A copy a user makes keeps its worker's skill names. A fork's names resolve against the installation's skills on each turn, so a skill the installation does not register is refused.

### GitHub token

`operatorGitHubToken()` returns `GITHUB_TOKEN`, trimmed, when it is set and non-empty. Otherwise it returns what `gh auth token` answers, read once at start and never from a request. Otherwise it returns `undefined`. It is Node-only, exported from the server entry. `operatorGitHub({ operator, token, apiUrl? })` serves that one user. With no token, every GitHub routine is refused.

## Next

- [Workers](../concepts/workers.md): the idea of a worker, and who owns each stored part.
- [Coordinators](../catalog/workforce/coordinators.md): putting a coordinator in front of delegates.
- [Worker messaging](./worker-messaging.md): how workers message each other, and its limits.
- [`WORKER.md`](./worker-md.md): every setting a worker file takes.
