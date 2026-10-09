---
title: Coordinators
sidebar_position: 3.5
sidebar_label: Coordinators
description: "A worker that hands each message to other workers on your roster, its delegates, by judgment, best fit, round robin or to everyone."
---

# Coordinators

Sometimes you want people to send work to one place and let it find the right worker. A **coordinator** is that place. It's a worker like any other on your roster, run by the `coordinator` flow, and the workers it hands work to are its **delegates**.

Each message you send a coordinator is a **post**. The coordinator hands it to one or more delegates, or, when it routes by judgment, may answer it itself. Each delegate works the post in a session of its own, and its answer comes back into your conversation under its own name. An organization's [chief of staff](./chief-of-staff.md) can be one.

## Setting one up

A coordinator is a `WORKER.md` that names `flow: coordinator` and lists its delegates:

```md title="workforce/teams/support/workers/help/WORKER.md"
---
description: Ask the support team anything.
flow: coordinator
delegates: [support.devices, support.accounts, support.general]
routing: best-fit
fallback: support.general
---

You are the support desk. When a question fits none of the team, answer it
yourself in a sentence or two.
```

The delegates are workers too. Under `best-fit`, their descriptions are what the coordinator picks by:

```md title="workforce/teams/support/workers/devices/WORKER.md"
---
description: Phones, laptops, and anything else that won't turn on or charge.
---

You answer device questions for the support team.
```

| Key | What it sets |
| --- | --- |
| `delegates` | The workers each new conversation starts with, by id. At most 25. |
| `routing` | `judgment` (the default), `best-fit`, `round-robin` or `everyone`. See [Choosing how it routes](#choosing-how-it-routes). |
| `fallback` | The delegate that takes a post `best-fit` can't place. It must be one of `delegates`. |
| `rounds` | How many times a delegate's answer goes back out to the others: `0` (the default) to `3`. See [Letting delegates answer each other](#letting-delegates-answer-each-other). |

The coordinator's own turn, the one that runs when it routes by judgment, is the [built-in worker's](./built-in-worker.md) turn. Its `model`, `tools`, `skills` and `capabilities` read the way an `agent` worker's do. `listDelegates`, `addDelegate`, `removeDelegate`, `setFallback` and `handOff` come with the flow, whatever the coordinator's `tools:` line says.

Build the `coordinator` flow and register it beside the flows its delegates run on:

```ts title="src/workforce.ts"
import {
  createWorkerInstallation,
  defineAgentWorkerFlow,
  defineCoordinatorFlow,
  hireWorkforce,
} from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

const { workers } = await readWorkforce("./workforce");

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => ({ agent, coordinator }),
});

const agent = defineAgentWorkerFlow({ installation });

const coordinator = defineCoordinatorFlow({
  installation,
  delegateFlows: [agent],
  routeModel: "openai/gpt-5.4-mini",
});

flowRegistry.registerMany(hireWorkforce(installation));
```

`defineCoordinatorFlow` takes:

| Option | What it does |
| --- | --- |
| `installation` | The installation the coordinator and its delegates belong to. Required. |
| `delegateFlows` | The flows a post can be delivered to. Each must declare the delegated-post entry: the built-in `agent` does, and a flow of your own does once you [add it](#making-your-own-flow-a-delegate). A flow without it throws here. Required. |
| `routeModel` | The model behind `best-fit`'s evaluator call: a model id your resolver knows, or an evaluation model. Required, even when no coordinator routes by best fit. |
| `agent` | What the coordinator's own turn is built with: the options you'd give `defineAgentWorkerFlow`, such as `catalog` and `uses`. A coordinator's `tools:` line is read against this catalog. Left out, the built-in's defaults. |
| `roundDeadlineMs` | How long a round waits for its answers. Five minutes by default. A value that isn't a positive whole number of milliseconds throws. |

`hireWorkforce` refuses a coordinator file it can't run, naming the problem: a `rounds:` above 3 (`rounds can be at most 3`), a `routing:` it doesn't know, a `fallback:` that isn't one of its `delegates:`, or a delegate named twice. A coordinator declared in your files can name only workers declared in your files; `createWorkerInstallation` refuses one whose `delegates:` names anything else.

## Talking to it

Open a session with the coordinator and send it a message, as you would [any worker](./workers-on-disk.md#talking-to-a-worker):

```ts
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

const workforce = createWorkforceClient({ userId, baseUrl });
const session = await workforce.ensureWorkerSession({ worker: "support.help" });

const help = createClient({ flowKind: session.flowKind, userId, baseUrl });
await help.sendAction("run", { message: "My laptop won't charge." }, { sessionId: session.id });
```

Say best fit picks `support.devices`. Its answer lands in the conversation as a message whose `agentName` is `support.devices`, the delegate's worker id. Replies the coordinator writes itself carry an `agentName` that starts with `coordinator-judgment`, exported as `COORDINATOR_JUDGMENT`.

A delegate's answer arrives in a request of its own once the delegate's turn ends. To see it, follow the session with [`createSessionSSEClient`](../api/client.md#createsessionsseclientoptions), not the `run` request's stream.

## Choosing how it routes

| `routing:` | Who gets a post |
| --- | --- |
| `judgment` (the default) | The coordinator's own turn reads the post and decides. It hands the post on with its `handOff` tool, to as many delegates as it likes, or answers itself. |
| `best-fit` | One evaluator call picks the delegate whose note or, failing that, description fits the post best. A delegate with neither isn't offered. While a delegate is still working your last post, your next one goes to it too, with no call. |
| `round-robin` | The next delegate in the list after the one your last post went to. |
| `everyone` | Every delegate. |

Each policy checks a delegate when the post arrives. One that can't take it, because it was fired or because its flow takes tasks but not posts, is skipped, and the [record](#what-it-records) says why.

Under `best-fit`, a post the call can't place goes to the `fallback:` delegate. The call can't place a post when it fails, picks something that isn't a delegate, or has nobody to pick from. With no fallback, or one that can't be reached, the coordinator's own turn takes the post, as under `judgment`. If that turn fails too, nobody takes the post, and the conversation says so:

```text
Nobody took this post: best fit couldn't place it, and the coordinator's own turn failed: <error>.
```

`round-robin` and `everyone` say the same when they find no delegate to reach: `Nobody took this post: no delegate in this conversation can be reached.`

## Changing the delegates

The `delegates:` line is where each new conversation starts. A conversation takes its own copy of `delegates:` and `fallback:` on its first post, or on the first delegate action or tool call in it if that comes sooner. From then on, changes stay in that conversation. Other conversations with the same coordinator don't see them, and the file is never written. Editing `delegates:` later reaches only conversations that haven't had a post or a delegate action yet.

Your app and the coordinator's own turn can both change a conversation's delegates, and both pass the same checks.

**From your app**, with the coordinator's actions on the conversation's session:

```ts
await help.sendAction("addDelegate", { worker: "licenses", note: "Software license questions" }, { sessionId: session.id });
await help.sendAction("removeDelegate", { worker: "support.accounts" }, { sessionId: session.id });
await help.sendAction("setFallback", { worker: "licenses" }, { sessionId: session.id }); // { worker: null } clears it
await help.sendAction("listDelegates", {}, { sessionId: session.id });
```

`note` is optional. Best fit picks by it before the worker's description.

Each action's output is the conversation's list as it stands after the call. `sendAction` doesn't hand back the output: find it in the request's `result` with [`sessions.listSessionRequests`](../api/client.md#sessionslistsessionrequestssessionid-options), passing `includeResultOutput: true`.

```json
{
  "delegates": [
    { "worker": "support.devices" },
    { "worker": "support.general" },
    { "worker": "licenses", "note": "Software license questions" }
  ],
  "fallback": { "worker": "licenses" },
  "max": 25,
  "filingSessionId": "…"
}
```

`listDelegates` also gives each delegate two things read from the roster when it is called. `description` is what the worker does: the description in its `WORKER.md`, or the one it was hired with. `takes` is what it can be handed now, from the flow it runs on: `posts`, `tasks`, `both`, or `nothing` when the worker has been fired or its flow takes neither. A delegate that takes nothing has a `description` of `null`, and so does a worker with no description. The other three actions leave both out. With an EM that takes posts and a coder whose flow takes only tasks, its `delegates` read:

```json
[
  { "worker": "eng.em", "description": "Files each feature on the team's board.", "takes": "posts" },
  { "worker": "eng.coder", "description": "Does the work a filed row names.", "takes": "tasks" }
]
```

`filingSessionId` identifies this conversation to its delegates. Each delegate works this conversation's posts in a session of its own, and `workforce.findWorkerSession({ worker, filingSessionId })` returns it. A lookup that names only the worker never does.

A refused change writes nothing. Its request fails, and the refusal is in `result.error.message`.

**By the coordinator**, with tools of the same names, when you ask it to bring someone in or take someone off. A tool hands a refusal back to the model as `{ refused: "<message>" }`, so it can tell you why. The list isn't in the coordinator's prompt: to say who its delegates are, it calls `listDelegates`.

A conversation can't be created with delegates already set. A session create whose `state` carries `delegates` is refused with a 400:

```text
Session state field "delegates" is written only by flow "coordinator"; a caller cannot set it.
```

### Who can be a delegate

A delegate is a worker on your own roster, one of yours or a standard one, whose flow takes a delegated post or a task. A conversation holds at most 25.

| Refused | Message |
| --- | --- |
| Another user's worker, or one nobody holds | `No worker "<id>" on your roster.` |
| A worker whose flow takes neither a post nor a task | `Worker "<id>" runs on flow "<flow>", which takes neither a delegated post nor a task.` |
| A worker already on the list | `"<id>" is already a delegate in this conversation.` |
| A 26th delegate | `This conversation already has 25 delegates, the most it can hold. Remove one first.` |
| Removing a worker that isn't on the list | `"<id>" isn't a delegate in this conversation.` |
| A fallback that isn't on the list | `"<id>" isn't a delegate in this conversation, so it can't be the fallback.` |

A worker whose flow takes tasks but not posts can be added. A post handed to it is skipped, and the record's reason is `Worker "<id>" runs on flow "<flow>", which can't take a delegated post.` When the coordinator's own turn hands it a post with `handOff`, the refusal goes on to name the delegates in the conversation that do take posts, so the turn can pick one of them:

```text
Worker "eng.coder" runs on flow "coder", which can't take a delegated post. Delegates here that take posts: eng.em.
```

When none does, it ends `No delegate here takes posts.` instead. Only the flows in `delegateFlows` take posts: a worker on any other flow counts as one that can't, even when its flow declares the entry.

Removing checks only the list, so you can remove a delegate that has since been fired. A delegate you remove still answers a post it was already handed. Removing the fallback clears it; best fit then hands what it can't place to the coordinator's own turn until you set another with `setFallback`.

## Letting delegates answer each other

With `rounds: 0`, the default, a delegate's answer lands in the conversation and goes no further. Set `rounds:` to 1, 2 or 3 and each answer goes back out to the other delegates, by the same policy, for that many rounds. The person's post is round 0.

- `best-fit` and `round-robin` route each answer again as it lands, never to its own author.
- `everyone` waits for the round to close, then hands each delegate the other delegates' answers from it in one delivery. A delegate with no other answer to get is skipped.
- `judgment` waits for the round to close, then runs the coordinator's turn once with the round's answers. Its hand-offs in that turn go out in the next round.

A round closes when every delivery in it has been answered or has failed, or at its deadline: five minutes, unless you set `roundDeadlineMs`. A delegate whose turn fails says so at once, so the round doesn't wait on it. One whose run is cancelled does the same when its flow sets [`delegatedPostOnFinished`](#making-your-own-flow-a-delegate), as the built-in `agent` flow does. One still working at the deadline keeps working, and its answer lands once when it comes, going no further. A delegate that never reports at all, because its process stopped, holds its round until the conversation's next activity after the deadline: a post, an answer, or another delegate's report.

A conversation keeps at most 50 rounds open. A post past that is still delivered, but its round isn't opened: its answers land and go no further, and its routing record carries a `note` saying so.

**What it costs.** Each delegate gets at most one delivery per post per round, so a post costs at most delegates × (rounds + 1) delegate turns: 100 at 25 delegates and 3 rounds. `judgment` adds up to rounds + 1 turns of the coordinator's own. `best-fit` adds at most one evaluator call per round, plus a coordinator turn when it can't place a post and no fallback takes it.

## What it records

Every routing decision leaves one `coordinator-route` item in the conversation. It's a [component item](../streaming/emitting-items.md#components): it never enters the model's history, and you render it apart from the lines.

```json
{
  "postId": "req_…",
  "round": 0,
  "policy": "judgment",
  "by": "judgment",
  "delegates": [
    { "worker": "eng.em", "outcome": "delivered" },
    { "worker": "eng.coder", "outcome": "skipped", "reason": "Worker \"eng.coder\" runs on flow \"coder\", which can't take a delegated post. Delegates here that take posts: eng.em." }
  ]
}
```

| Field | What it holds |
| --- | --- |
| `postId` | The post: the id of the request that carried the person's message. Answers going back out keep it. |
| `round` | `0` for the person's post, one more each time answers go back out. |
| `policy` | The conversation's `routing:`. |
| `by` | How the delegates were found: `judgment` (the coordinator's own turn), `held` (best fit, still on your last post), `evaluated` (best fit's call), `fallback`, `round-robin`, `everyone`, or `unplaced` (nobody took it). |
| `delegates` | Each delegate the decision touched: `worker`, `outcome` (`delivered`, `skipped` or `failed`), and `reason` when it wasn't delivered. |
| `none` | Why nobody was delivered to, when nobody was. |
| `note` | Why this round's answers go no further: the conversation already had 50 rounds open. |

A delegate answers each post once per round. A post handed to the same delegate twice in a round is skipped the second time, with the reason `it was already handed this post in this round`.

In React, register a renderer under the record's component name:

```tsx
import type { ReactNode } from "react";
import { FlowProvider } from "@flow-state-dev/react";
import type { CoordinatorRouteRecord } from "@flow-state-dev/workforce";
import { COORDINATOR_ROUTE } from "@flow-state-dev/workforce/browser";

function RouteNote({ item }: { item: { data: CoordinatorRouteRecord } }) {
  const handedTo = item.data.delegates.filter((d) => d.outcome === "delivered").map((d) => d.worker);
  return <p className="route-note">{handedTo.length > 0 ? `Handed to ${handedTo.join(", ")}` : item.data.none}</p>;
}

export function SupportDesk({ children }: { children: ReactNode }) {
  return <FlowProvider renderers={{ component: { [COORDINATOR_ROUTE]: RouteNote } }}>{children}</FlowProvider>;
}
```

Import names from `@flow-state-dev/workforce/browser` in a client component; the package root is server code. A type-only import from the root, as above, is fine.

## Handing out tasks

A post gets an answer. Some work needs doing instead: a change made, a report written, a run that takes an hour. For that a coordinator files a **task** on its conversation's board, for one of its delegates.

```ts
await help.sendAction(
  "addTask_tasks",
  { goal: "Audit our dependencies' licenses", assignee: "licenses" },
  { sessionId: session.id },
);
```

These are the [task board](../orchestration/task-board.md)'s task tools, sent as actions on the conversation's session and named for its board, `tasks`: `addTask_tasks`, `assignTask_tasks`, `listTasks_tasks` and the rest. The coordinator has the same eight as tools (`addTask`, `assignTask`, `listTasks` and the others), so it files a task itself when you ask it for one.

Either way, the assignee has to be one of this conversation's delegates that takes tasks: its `takes` in `listDelegates` is `tasks` or `both`. Anyone else is refused with one answer, the same for another user's worker as for a worker nobody holds, and nothing is stored:

```json
{ "ok": false, "error": "unknown_assignee: \"helper\" is not on this board's team. Available: support.devices, licenses. …" }
```

A task with no assignee goes to the conversation's only delegate that takes tasks. With several, it waits on the board until you assign it.

`addTask` answers `{ ok: true, taskId }` once the task is stored, without waiting for it to run. The task starts by itself: the delegate works it in a new session of its own, its **task session**, which belongs to you like every other session your workers run, on whichever flow the delegate runs on. The delegate is checked again when the task is handed over, so one removed or fired in between doesn't run it, and the task fails instead.

### Hearing how it went

The conversation that filed a task hears once when it ends, in a line under the delegate's name:

```text
Task "Audit our dependencies' licenses" (task_…) completed by licenses: All 214 dependencies are MIT or Apache-2.0.
```

It hears when a task completes, with what came back; when it fails for good, with the error; and when it stops on a question, with the question. When the line arrives, a coordinator that routes by judgment takes a turn to read it and decide what to do next. One with a fixed routing policy shows the line and nothing more. If the coordinator is in the middle of a reply to you, the line starts a second turn at once, and both replies appear in the conversation, each as its own message. Every task gets two attempts, a number you can't change, and a first failure just runs it again without a word.

### Managing tasks

| Action | What it does |
| --- | --- |
| `listTasks_tasks` | This conversation's tasks only, even when another conversation has the same coordinator and the same delegates |
| `assignTask_tasks` | Gives a task nobody is working on to another delegate. It keeps its id and starts at once |
| `cancelTask_tasks` | Cancels a task that hasn't finished. Nothing is said in the conversation |

A running task can't be moved to another delegate. Cancelling one does land: when its delegate finishes, the result is turned away. A finished task, a failed one included, can't be reassigned or cancelled, and the tools answer `terminal_task_write_declined`. To have someone take on a failed task, file it again.

To open the session working a task, look it up by the task's id and the conversation's `filingSessionId`, which `listDelegates` returns:

```ts
const run = await workforce.findWorkerSession({ worker: "licenses", taskId, filingSessionId });
```

Two conversations can file a task with the same id for the same worker, and each finds only its own task's session. A lookup without `taskId` never returns a task session, so a post to the same worker in this conversation still lands in the session where that delegate works your posts. `ensureWorkerSession` with a `taskId` never creates a session: until the board hands the task over, it throws.

## Making your own flow a delegate

A worker on the built-in `agent` flow can take posts as it is. A [worker flow of your own](./workers-on-disk.md#which-flows-can-run-workers) takes them once it declares the delegated-post entry around its door, the block its `run` action runs. Here `door` and `inputSchema` are that flow's own:

```ts
import { defineFlow } from "@flow-state-dev/core";
import {
  DELEGATED_POST_ENTRY,
  delegatedPostEntry,
  delegatedPostOnFinished,
  workerConfigSchema,
} from "@flow-state-dev/workforce";

const researchFlow = defineFlow({
  kind: "research",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources },
  request: { onFinished: delegatedPostOnFinished },
  actions: { run: { inputSchema, block: door, userMessage: (input) => input.message } },
  internal: { actions: { [DELEGATED_POST_ENTRY]: delegatedPostEntry(door) } },
});
```

Then add it to `delegateFlows`. The door is handed `{ message }`, where the message reads `<from>, through <coordinator>: <post>`: who wrote it (the person's user id, or the delegates whose answers it passes on), and the coordinator's worker id. Whatever the door returns, a string or `{ text }`, is the answer. An empty reply fails the turn, and nothing is answered.

`delegatedPostOnFinished` tells the coordinator when a delegated run is cancelled, so its round doesn't wait for the deadline. Without it, a failed turn is reported at once, but a cancelled one holds its round until the deadline.

## What it won't do

- **Hand a post to another user's worker.** Their workers aren't on your roster, and naming one gets the same answer as a worker that doesn't exist.
- **Write a change back to the file.** A conversation's delegates are its own.
- **Stop a delegate at the deadline.** The round closes without it; the delegate's turn runs on.
- **Recall a post.** Removing a delegate doesn't take back what it was handed.
- **Pick by a delegate's instructions.** Best fit reads the delegate's note, or else its description, and nothing else.
- **Let a delegate file tasks of its own.** A task session's `addTask` is refused, from the delegate's tools and from your app alike, with `{ "ok": false, "error": "no_delegation_board" }`.

## Related pages

- [The chief of staff](./chief-of-staff.md): an org-level worker that hires workers of your own and, as a coordinator, hands them work.
- [The built-in worker](./built-in-worker.md): the `agent` flow, whose turn a coordinator runs when it routes by judgment.
- [Workers on disk](./workers-on-disk.md): `WORKER.md`, `readWorkforce`, `hireWorkforce`, and talking to a worker.
- [Hiring, forking and firing workers](./durable-hire.md): how a person's own workers get onto their roster.
