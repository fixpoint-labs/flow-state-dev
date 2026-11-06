---
title: Workforce
sidebar_position: 1
sidebar_label: Overview
description: Describe a roster of workers, run each on one shared copy of the flow it names, and talk to a worker in a session that names it.
---

import Figure from "@site/src/components/Figure";
import PrivateAndSharedDrawing from "./private-and-shared.svg";
import WorkforceOverviewDrawing from "./workforce-overview.svg";

# Workforce

`@flow-state-dev/workforce` gives each user a roster of workers: agents, or deterministic workflows, that work for that user and act as them.

One rule covers who sees what: a worker's own state and your user data are private to you, while shared resources and org-scope data are shared with your org, and a flow writes to org scope only when its author built it to. Your workers, your private projects and every session are yours alone. A shared project and its workstream entries are shared, and each entry names the user who wrote it, and the worker when a worker did.

A **worker** is a configuration with an owner: its instructions, skills, tools, and the flow that runs it. Each worker names its own flow: the built-in agent, a coordinator, or a flow your app registers. A flow is registered once, and every worker that names it shares that copy. Each piece of work gets its own session: one per conversation, one per task, and one lasting session for a workstream it leads.

Some workers are **standard**. Your installation's files define them, every user has them, and nobody can edit them. To change one for yourself, fork it: you get a worker of your own that starts from its configuration.

A worker can hand work to other workers on your roster, its **delegates**. That is **delegation**, and every hand-over is checked against your roster. A **coordinator** is the worker built for it: it picks a delegate for each message by its own judgment, by best fit, in turn, or sends to everyone.

<Figure svg={PrivateAndSharedDrawing} caption="Workers are private; sharing happens in shared resources" description={"One org, two users. The installation's files define the standard workers every user starts with. A shared area in the org holds a shared project, whose workstreams have one owner each, and org-scope data. Alice's private area holds her standard researcher, a private project, a coordinator and an analyst; Bob's holds his own standard researcher, a writer he forked, a coordinator and a private project. Alice owns a workstream of the shared project."} />

For example, Alice and Bob each have the standard researcher. They are two workers, not one: Alice's answers for Alice, and Bob can't open her sessions, name her researcher as a delegate, or read what it remembers about her.

**What this doesn't do.** Users don't message each other through Workforce, and there are no shared conversations between users yet. A worker never acts for anyone but its owner.

## Workforce or orchestration

Reach for Workforce when you want a named roster you address by opening a session.

Reach for [Orchestration](../orchestration/overview) when you want to coordinate units of work on a task board. A board worker is a block that claims tasks. A task's `assignee` can also name one of your standard workers. See [Giving a task to a worker](#giving-a-task-to-a-worker).

## What a Workforce app looks like

<Figure svg={WorkforceOverviewDrawing} caption="Worker file, worker, session: where each lives" description={"A WORKER.md file in your repository is the description. readWorkforce turns files into plain records, and hireWorkforce gives back one copy of each flow a worker runs on, which your app registers. Every worker on a flow shares that copy. Sessions name their worker when they are created, and live in your store with the state and resources a worker writes. A worker a user hires or forks while the app runs is a row in their own data. A task's assignee can name a standard worker that takes tasks: the board runs the list, and Workforce finds the worker."} />

Workforce reads your files and runs them. Each `WORKER.md` is a standard worker every user has, run by one shared copy of the flow it names. A user can add workers of their own, which nobody else can reach.

- **A user's own workers are data.** A worker a user hires or forks while the app runs is a row in their own data: every process sees it on the next turn, nothing restarts, and no other user can reach it. See [Hiring and forking](./durable-hire).
- **The screens are importable.** One navigator browses the whole workforce, and the roster and a board, as columns or as a live list, ship beside it as components from `@flow-state-dev/react`. See [Workforce components](./ui).

For a working example, the [kitchen-sink reference app](https://github.com/fixpoint-labs/flow-state-dev/tree/main/apps/kitchen-sink) is a support desk built this way: four specialists and a coordinator in front of them, declared under its `workforce/` folder. A coordinator is a worker that hands each message to other workers, its delegates; this one sends each question to the specialist whose job fits it.

## Hire a roster

A worker on a team lives at `teams/<team>/workers/<name>/WORKER.md`, so `teams/engineering/workers/lead/` is `engineering.lead`. An org worker belongs to no team: it lives at `org/workers/<name>/WORKER.md` and goes by its folder name alone, so `org/workers/shift-coordinator/` is `shift-coordinator`.

```md
---
description: Holds the board.
model: openai/gpt-6-luna
---
You are the engineering lead. You break work into tasks and report what came back.
```

```ts
import { createWorkerInstallation, hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

// `errors` is a worker that failed to load; `skillErrors` is one that loaded
// without a skill it should have had; `teamErrors` is a team file that failed.
// Each is collected rather than thrown, so an array you forget to check is
// one that reports nowhere.
const { workers, errors, skillErrors, teamErrors } = await readWorkforce("./workforce");
if (errors.length || skillErrors.length || teamErrors.length) {
  throw new Error(
    `workforce: ${errors.length} worker(s) failed to load, ` +
      `${skillErrors.length} loaded short, ` +
      `${teamErrors.length} team file(s) failed`,
  );
}

const installation = createWorkerInstallation({ standardWorkers: workers });
const flows = hireWorkforce(installation);

flowRegistry.registerMany(flows);
```

That worker file names no `flow:`, so it runs on the built-in worker flow, `agent`. `hireWorkforce` gives back one copy of `agent`, however many workers run on it, and the roster flow an app [hires and forks](./durable-hire) through. Its body becomes its instructions, and it talks. It sees the recent turns of the conversation it's in, and nothing it's told there reaches any other conversation.

A **skill** is a folder of instructions a worker can pull into a turn. `readWorkforce` collects the skills sitting beside each worker in the tree, and the built-in reads them. Each user keeps their own copy of a worker's skills. To talk to a worker, open a session that names it, as [Talking to a worker](./workers-on-disk.md#talking-to-a-worker) shows, and send `userId` beside `input`. The call never names the organization: every request runs in one, and [Authentication](../server/authentication.md#every-request-runs-in-an-organization) covers where it comes from. [The built-in worker](./built-in-worker.md) covers its settings, what your app can configure, and the rest of what it does not do.

A `model:` such as `openai/gpt-6-luna` needs its provider's AI SDK package installed in your app: `@ai-sdk/openai` for an `OPENAI_API_KEY`, or `@ai-sdk/gateway` for the Vercel AI Gateway (`AI_GATEWAY_API_KEY`). Without it, the turn fails with an error naming the package to install. Use zod 3 (`zod@^3.25.76`): with zod 4 installed beside a provider package, flow definitions fail at startup. [Setting up models](../getting-started/setting-up-models.md#choose-a-provider) lists every provider.

To run a worker on a flow you wrote yourself, name that flow's kind in the worker's `flow:`. Here is `teams/engineering/workers/triage/WORKER.md`:

```md
---
description: Sends an incoming request to an answer or to a person.
flow: request-triage
---
Answer directly when the request is a question about a feature that already shipped.
```

Then pass the flow under that same kind:

```ts
import { requestTriageFlow } from "./flows";

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: { "request-triage": requestTriageFlow },
});
const flows = hireWorkforce(installation);
```

`requestTriageFlow` is your own flow, built on the installation, and `"request-triage"` is its `kind`. A record that names no `flow:` runs on the built-in, so one roster can run both. You get back one copy per flow, ordered by flow kind, and the roster flow.

Pass a flow under a key that is not its own `kind` and it is refused. [Workers on disk](./workers-on-disk.md#when-a-worker-needs-more-than-settings) walks through writing a worker flow of your own.

`hireWorkforce` reads no files and registers nothing itself. A refusal throws and returns nothing.

`readWorkforce` is Node-only (`@flow-state-dev/workforce/loader`). Import `createWorkerInstallation` and `hireWorkforce` from `@flow-state-dev/workforce`.

## Projects and the Shift Coordinator

A **project** is a body of work, private to you or shared with your organization. It's a row your app creates while it runs, not a file.

A **workstream** is one area of a project with one owner: an entry on the project that everyone who reads the project can see, and a lasting session of one of the owner's workers that does the work. Each user talks to a project through their own project coordinator, which hands work only to their own workstreams. See [Projects](./projects).

The **Shift Coordinator** is an org-level worker a user asks about the organization, such as who works here. Ask it for another worker and it hires one of your own. Ask it for one fewer and it puts the fire in front of you, and nothing is removed until you approve. Given the project tools, it also starts projects for the user who asks. A Lab that doesn't declare one doesn't have one. See [The Shift Coordinator](./shift-coordinator).

## Giving a task to a worker

A [coordinator](./coordinators.md) files tasks for its delegates on its conversation's board, and any worker can file tasks for delegates of its own, as [Delegating work](./delegating-work.md) shows. A task names its worker by id, the name `discover` lists: `engineering.lead`. When the board hands the task over, the task runs in a session of that worker's flow that names it, one run per task.

A worker on the built-in `agent` flow runs a task as one turn: its own instructions and tools, the task's title, goal and context as the message, and its answer as the task's result. A worker flow you write takes tasks when it declares the `contributor` role and a `work` task entry, built with [`workerTaskEntry`](./coordinators.md#taking-a-conversations-tasks).

Filing a task for a worker that isn't one of the filer's delegates, or that takes no tasks, is refused, and the refusal names the worker. A task whose worker was removed or fired before it ran fails, and the conversation that filed it hears so. No other worker picks it up.

[Handing out tasks](./coordinators.md#handing-out-tasks) shows filing, and [Following a filed task](./delegating-work.md#following-a-filed-task) has the rest: retries, questions and follow-ups.

## Serving it to your users

To put the app in front of real users, serve it over HTTP, tell the server who each caller is, and have the client send the caller's credential.

On the server, pass a `resolvePrincipal` to `createFlowState` and hand the result to a host adapter. When the call came over HTTP, the resolver gets it as `request`, a Fetch `Request`, so headers are `request.headers.get(...)`. It answers for every flow that declares no `authentication` of its own, including the built-in `agent` flow and the roster flow `hireWorkforce` returns.

`createFlowState` takes flows as a record keyed by id. `mergeWorkerFlows` adds the flows `hireWorkforce` returned, the same `flows` registered above, to your own, and throws if an id is already taken.

```ts title="server.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { serve } from "@flow-state-dev/node";
import { mergeWorkerFlows } from "@flow-state-dev/workforce";

const flowState = createFlowState({
  // flows = hireWorkforce(installation), from "Hire a roster" above
  flows: mergeWorkerFlows({ /* your own flows, by id */ }, flows),
  stores, // your stores
  resolvePrincipal: async ({ request }) => {
    const token = request?.headers.get("authorization")?.replace(/^Bearer /, "");
    const session = token ? await verifyToken(token) : null; // your auth library
    if (session === null) return null; // refused with 401
    return { userId: session.userId, orgId: session.orgId };
  },
});

await serve(flowState, { port: 3000 });
```

The resolver returns `{ userId, orgId }` from the verified credential, or `null` when it can't identify the caller. Every request runs in an organization, so a resolver that yields no `orgId` is refused with 401 too. To answer with a different status, throw `PrincipalResolutionError` from `@flow-state-dev/engine`, for example `new PrincipalResolutionError("Forbidden", { status: 403 })`.

`serve()` runs a long-lived Node server. Next.js and Vercel have their own adapters; [Host adapters](../server/host-adapters.md) lists them.

In the browser or in Node, give `createClient` a `fetcher` that adds the credential. Every call and stream the client makes goes through it, and so does every call of a workforce client built on it (see [Client options](../configuration/client.md#adding-credentials)). A call without the credential is refused with 401.

```ts
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

// token: the signed-in user's credential, from your auth library
// userId: that user's id; baseUrl: where the server above is reachable
const fetcher = (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = new Headers(init?.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(input, { ...init, headers });
};

const fsd = createClient({ userId, baseUrl, fetcher });
const workforce = createWorkforceClient(fsd);
const session = await workforce.ensureWorkerSession({ worker: "engineering.lead" });
await fsd.flow(session.flowKind).send("respond", { message: "Where are we on the launch?" }, { sessionId: session.id });
```

Actions run as the user and organization your resolver returns; the client's `userId` doesn't override it.

[Authentication](../server/authentication.md) covers per-flow resolvers, machine callers and what a resolver protects. [Client options](../configuration/client.md) covers `baseUrl` and the other transport options.

## What it will not do

- It does not run your task boards. A board drains its rows. Workforce tells the board which worker a name means, and gives workers a way to take a task.
- It does not replace flows, sessions, or resources. A worker's sessions are sessions of the flow it runs on.
- Hiring at runtime writes no files. It stores the new worker as a row in the user's data, and the tree stays as you wrote it. See [Hiring and forking](./durable-hire.md).

## Related pages

- [Workers on disk](./workers-on-disk) — the folder tree, `WORKER.md`, `readWorkforce`, `hireWorkforce`, and talking to a worker.
- [The built-in worker](./built-in-worker) — the `agent` worker flow a record with no `flow:` runs on: its settings, tools, skills, and memory.
- [Standing rules](./standing-rules) — notes a user asks a worker to keep, followed on every turn with that user.
- [Documents on disk](./documents-on-disk) — a team's shared reference material as Markdown, installed as resources.
- [Code on disk](./code-on-disk) — your own flows, blocks and capabilities in the same tree, registered by `fsdev gen`.
- [Capabilities on disk](./capabilities-on-disk) — what a capability in a `resources/` folder gives a worker, and how a worker's file picks its presets.
- [Packages on disk](./packages-on-disk) — a folder of instructions and the blocks a worker needs to follow them.
- [Coordinators](./coordinators) — a worker that hands each message to its delegates, and files tasks for them on its conversation's board.
- [Delegating work](./delegating-work) — how any worker files tasks for its delegates, and how a filed task reports back.
- [Messaging other workers](./messaging-workers) — asking another worker something without handing it work.
- [Projects](./projects) — private or shared, with workstreams that each have one owner.
- [Inventory](./inventory) — a record of every worker registered in an organization, readable by a block.
- [Worker usage](./worker-usage) — the tokens each worker used for a user, by model and coding agent, per UTC day.
- [Hiring and forking](./durable-hire) — a user's own workers, hired, forked and fired while the app runs.
- [The Shift Coordinator](./shift-coordinator) — the one worker a user asks to hire or fire workers of their own, with a fire waiting for their approval.
- [The Error Reporter](./error-reporter) — a worker that turns each failure that stayed failed, or a problem a user describes, into one bug report the operator previews before it is filed.
- [Workforce components](./ui) — browse your flow kinds, instances and sessions, and render a roster and boards, with React components.
- [Orchestration](../orchestration/overview) — the task board and the workers that drain it.
- [Agents](../orchestration/agents) — board workers, `definePersona`, and `createWorkforceCapability`.
- [Flows](../fundamentals/flows.md) — how a flow copy is configured and addressed.
