---
title: Coordinators
sidebar_position: 3.5
sidebar_label: Coordinators
description: "A worker that hands each message to other workers on your roster, its delegates, by judgment, best fit, round robin or to everyone."
---

# Coordinators

Sometimes you want people to send work to one place and let it find the right worker. A **coordinator** is that place. It's a worker like any other on your roster, run by the `coordinator` flow, and the workers it hands work to are its **delegates**.

Each message you send a coordinator is a **post**. The coordinator hands it to one or more delegates, or, when it routes by judgment, may answer it itself. Each delegate works the post in a session of its own, and its answer comes back into your conversation under its own name. An organization's [Shift Coordinator](./shift-coordinator.md) can be one.

## Setting one up

A coordinator is a `WORKER.md` that names `flow: coordinator` and lists its delegates:

```md title="workforce/teams/support/workers/help/WORKER.md"
---
description: The support desk itself. Answers questions about how support works, such as opening hours and how to reach a person.
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

Because `help` has a description, best fit can also pick `help` itself, for a question that is the desk's own rather than a specialist's. That is why its description names its own job: one as broad as "Ask the support team anything." competes with every delegate. [Picking the coordinator, and a confidence floor](#picking-the-coordinator-and-a-confidence-floor) explains how.

| Key | What it sets |
| --- | --- |
| `delegates` | The workers each new conversation starts with, by id. At most 25. |
| `routing` | `judgment` (the default), `best-fit`, `round-robin` or `everyone`. See [Choosing how it routes](#choosing-how-it-routes). |
| `fallback` | The delegate that takes a post `best-fit` can't place. It must be one of `delegates`. |
| `minConfidence` | Under `best-fit`, the lowest confidence at which a delegate pick is used, from `0` to `1`. Left out, any pick is used. See [Picking the coordinator, and a confidence floor](#picking-the-coordinator-and-a-confidence-floor). |
| `rounds` | How many times a delegate's answer goes back out to the others: `0` (the default) to `3`. See [Letting delegates answer each other](#letting-delegates-answer-each-other). |

The coordinator's own turn, the one that runs when it routes by judgment, is the [built-in worker's](./built-in-worker.md) turn. Its `model`, `tools`, `skills` and `capabilities` read the way an `agent` worker's do. `listDelegates`, `addDelegate`, `removeDelegate`, `setFallback` and `dispatchTask` come with the flow, whatever the coordinator's `tools:` line says. So do the [standing rules](./standing-rules.md) tools, `rules/read`, `rules/add`, `rules/change` and `rules/remove`, on a turn a user's own message started. In the turn's model input, each delegate's answer starts with `<worker id>, a delegate in this conversation, answered:`, and a post the routing already handed to delegates is followed by a note saying where it went: `Handed this post to <delegates> by its routing, with no turn of mine.`

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
  routeModel: "openai/gpt-6-luna",
});

flowRegistry.registerMany(hireWorkforce(installation));
```

`defineCoordinatorFlow` takes:

| Option | What it does |
| --- | --- |
| `installation` | The installation the coordinator and its delegates belong to. Required. |
| `delegateFlows` | The flows a post can be delivered to. Each must declare the delegated-post entry: the built-in `agent` does, and a flow of your own does once you [add it](#making-your-own-flow-a-delegate). A flow without it throws here. Required. |
| `routeModel` | The model behind `best-fit`'s call: a model id your resolver knows (its provider package must be installed; see [Setting up models](../getting-started/setting-up-models.md#choose-a-provider)), or an evaluation model. Best fit asks it as an evaluation model first, and, when that call fails on a model id, once more as a language model, which is how `openai/gpt-6-luna` still routes through a gateway that serves it only as a language model. One value for the flow, shared by every coordinator on it. Required, even when none of them routes by best fit; then it is never called. Use `typesafe-ai/jev` if any coordinator sets `minConfidence:`. Jev reports how sure it is; a language model and the other evaluation models don't, so under a floor their delegate picks are never used. A pick of the coordinator itself is used at any confidence. |
| `agent` | What the coordinator's own turn is built with: the options you'd give `defineAgentWorkerFlow`, such as `catalog` and `uses`. A coordinator's `tools:` line is read against this catalog. Left out, the built-in's defaults. |
| `roundDeadlineMs` | How long a round waits for its answers. Five minutes by default. A value that isn't a positive whole number of milliseconds throws. |

`hireWorkforce` refuses a coordinator file it can't run, naming the problem: a `rounds:` above 3 (`rounds can be at most 3`), a `routing:` it doesn't know, a `fallback:` that isn't one of its `delegates:`, a `minConfidence:` outside 0 to 1 or on a coordinator that doesn't route by `best-fit`, or a delegate named twice. A coordinator declared in your files can name only workers declared in your files; `createWorkerInstallation` refuses one whose `delegates:` names anything else.

## Talking to it

Open a session with the coordinator and send it a message, as you would [any worker](./workers-on-disk.md#talking-to-a-worker). If your server checks a credential, pass every client on this page the `fetcher` from [Serving it to your users](./overview.md#serving-it-to-your-users). Leave it out if it doesn't.

```ts
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

const workforce = createWorkforceClient({ userId, baseUrl, fetcher });
const session = await workforce.ensureWorkerSession({ worker: "support.help" });

const help = createClient({ flowKind: session.flowKind, userId, baseUrl, fetcher });
await help.sendAction("run", { message: "My laptop won't charge." }, { sessionId: session.id });
```

`ensureWorkerSession` returns your conversation with the coordinator, or starts it if you have none. Other workers' [messages](./messaging-workers.md) to the coordinator land in that same conversation.

Say best fit picks `support.devices`. Its answer lands in the conversation as a message whose `agentName` is `support.devices`, the delegate's worker id. Replies from the coordinator's own turn carry an `agentName` that starts with `coordinator-judgment`, exported as `COORDINATOR_JUDGMENT`. The `Nobody took this post` message the coordinator writes when no one takes a post carries no `agentName`.

A delegate's answer arrives in a request of its own once the delegate's turn ends, so the `run` request's stream never carries it. To wait for it, follow the whole session with [`createSessionSSEClient`](../api/client.md#createsessionsseclientoptions), which delivers each finished item from any request in the session. Read the session's state for a start time, open the stream from it, then send the post, so nothing is missed. In place of the `sendAction` call above:

```ts
import { createSessionClient, createSessionSSEClient } from "@flow-state-dev/client";
import { COORDINATOR_JUDGMENT } from "@flow-state-dev/workforce/browser";

const sessions = createSessionClient({ baseUrl, fetcher });
const { at, sessionCreatedAt } = await sessions.getSessionState(session.id);

const answer = new Promise<{ from: string; text: string }>((resolve, reject) => {
  const stream = createSessionSSEClient({
    sessionId: session.id,
    baseUrl,
    fetcher,
    since: at,
    sessionCreatedAt,
    onItem: ({ item }) => {
      if (item.type !== "message" || item.ts < (at ?? 0)) return;
      const from = item.agentName;
      if (from === undefined || from.startsWith(COORDINATOR_JUDGMENT)) return;
      clearTimeout(timer);
      stream.close();
      const text = item.content.map((part) => (part.type === "output_text" ? part.text : "")).join("");
      resolve({ from, text });
    },
    onStop: ({ status }) => {
      clearTimeout(timer);
      reject(new Error(`Session stream stopped: ${status}`));
    },
  });
  const timer = setTimeout(() => {
    stream.close();
    reject(new Error("No delegate answered in time"));
  }, 5 * 60_000);
});

await help.sendAction("run", { message: "My laptop won't charge." }, { sessionId: session.id });
const { from, text } = await answer; // from: "support.devices"
```

`at` is the server time the state read began. The stream starts a few seconds before `since`, so it can deliver messages saved just before `at`, including an answer to an earlier post. Dropping anything older than `at` keeps that answer from passing as this one's.

The example waits only for a delegate, and it takes the first delegate message after `at`, whichever post it answers. So use it when this post is the only one in flight: if an earlier post is still with a delegate, or under `everyone` more answers to it are still coming, one of those can land first and be taken for this post's answer. If the coordinator's own turn answers the post, or nobody takes it, no delegate message comes, and the timeout rejects instead. Five minutes matches a round's default deadline. Resolve on those messages too if your app should show them. [`createSessionSSEClient`](../api/client.md#createsessionsseclientoptions) lists the stream's other options, such as `itemTypes` and `retry`. This is for scripts and server code. In a React view, use `useSession` with `live: true`, which already follows the session, rather than opening a second stream.

## Choosing how it routes

| `routing:` | Who gets a post |
| --- | --- |
| `judgment` (the default) | The coordinator's own turn reads the post and decides. It hands the post on by calling `dispatchTask` with `post: true` and a delegate as `assignee`, as many times as it likes, or answers itself. The delegate gets the post as you wrote it; the coordinator chooses who, not what they read. |
| `best-fit` | One evaluator call, reading the post with the conversation's [recent lines](#follow-ups-and-recent-lines), picks who takes it: one of the delegates, by its note or else its description, or the coordinator itself, by its own description. A delegate with neither isn't offered. While a delegate is still working your last post, your next one goes to it too, with no call. |
| `round-robin` | The next delegate in the list after the one your last post went to. |
| `everyone` | Every delegate. |

Each policy checks a delegate when the post arrives. One that can't take it, because it was fired or because its flow takes tasks but not posts, is skipped, and the [record](#what-it-records) says why.

### Picking the coordinator, and a confidence floor

Best fit asks its evaluation model one question: who should take this post? The choices are the delegates and, when the coordinator has a `description:`, the coordinator itself. Picking the coordinator means the post is the coordinator's own job, so its own turn takes it, as under `judgment`. That is how a coordinator that routes plain requests straight to a delegate still answers "who works here?" or hires someone itself. Write its description to say what it does itself:

```md title="workforce/org/workers/chief-of-staff/WORKER.md"
---
description: The user's one point of contact. Hires and fires workers, starts projects, and answers questions about the team.
flow: coordinator
routing: best-fit
minConfidence: 0.7
delegates: [eng.em, eng.coder]
---
```

Some evaluation models also report a confidence with each answer, a number from 0 to 1 for how sure they are. Jev, `typesafe-ai/jev` through Vercel's AI Gateway, does ([Evaluation models](../fundamentals/models.md#evaluation-models)). Set `minConfidence:` and a delegate pick below it isn't used. Picking the coordinator is used at any confidence.

Best fit can't place a post when the call fails, answers with something that isn't a choice, has nobody to pick from, picks a delegate below `minConfidence:`, or reports no usable confidence (none, or one outside 0 to 1) while `minConfidence:` is set. Such a post goes to the `fallback:` delegate. With no fallback, or one that can't be reached, the coordinator's own turn takes it. If that turn fails too, nobody takes the post, and the conversation says so:

```text
Nobody took this post: best fit couldn't place it, and the coordinator's own turn failed: <error>.
```

`round-robin` and `everyone` say the same when they find no delegate to reach: `Nobody took this post: no delegate in this conversation can be reached.`

- **Only models that report confidence can pass the floor.** On a model that reports none, every delegate pick falls below the floor, and every post goes to the fallback or the coordinator's own turn. Leave `minConfidence:` out on those models.
- **There's no default.** Without `minConfidence:`, best fit uses any delegate pick, however unsure. For a Shift Coordinator, 0.7 sits between Jev's wrong picks, at 0.2 or lower, and its right ones, at 0.76 or higher. Check your own coordinator's requests before you copy the number.
- **A request that is still with a delegate skips all of this.** Your next post goes to the delegate working your last one, with no call, until it answers. A request meant for the coordinator, sent in that window, goes to that delegate too.

### Follow-ups and recent lines

A follow-up often makes sense only after what came before it. Say you ask about your laptop's wifi, `support.devices` answers, and you write back "It sees it. It fails right after the password." Read alone, that looks like a password question for `support.accounts`. Read with the lines before it, best fit can tell it's about the wifi and send it back to `support.devices`.

So every post travels with the conversation's **recent lines**: your posts, the coordinator's own replies, and the delegates' answers that have landed, oldest first, each under who wrote it. Under `best-fit`, the evaluator call reads the post with them, so a follow-up to a delegate's answer can go back to that delegate. The other policies don't route by the lines. Whatever the `routing:`, the delegate that takes a post is shown the same lines just before it, as one message with the `user` role, never as part of its instructions:

```text
Recent lines in the conversation with support.help before this post, oldest first:
- user_42: Hi, my laptop won't join the office wifi since this morning.
- support.devices: Does the laptop see the office network when you pick it?
```

Each line starts with who wrote it:

| Line by | Named as | Example |
| --- | --- | --- |
| You | Your user id | `user_42` |
| A delegate, in an answer that landed | The delegate's worker id | `support.devices` |
| The coordinator | The coordinator's worker id | `support.help` |

A coordinator line appears only when the coordinator wrote something in the conversation itself: a reply from its own turn, which runs under `judgment`, when best fit hands it a post nobody else took, and when a task it filed ends under either policy, or a `Nobody took this post` message. The [routing record](#what-it-records) is never a line.

What a delegate gets:

- **The last 10 lines, at most 4,000 characters in all.** They're counted back from the newest. The line that crosses 4,000 characters is cut short and ends with `…`, and anything older is left out.
- **This conversation's lines only.** They're read from this conversation's own messages, as far back as the session's history window reaches: its last 50 completed turns, where each post, each answer that lands and each other action on the conversation counts as one. A delegate never sees another conversation's lines.
- **Shown for one turn, as conversation.** The lines reach the delegate's model as a message beside the post, for the turn that answers it. They carry no more weight than the post itself: a line written like an instruction is read as something said in the conversation, not as part of the delegate's instructions. The delegate's own session keeps the post and its answer, never the lines.
- **Including an answer that just landed.** A post sent the moment an answer shows up in the conversation is routed and delivered with that answer among its lines.

The first post in a conversation has no lines, so it's routed and delivered alone. A delegate on the built-in `agent` flow shows its model the lines with no changes; a flow of your own shows them [once its generator reads them](#making-your-own-flow-a-delegate).

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

`listDelegates` also gives each delegate two things read from the roster when it is called. `description` is what the worker does: the description in its `WORKER.md`, or the one it was hired with. `takes` is what it can be handed now, from the flow it runs on: `posts`, `tasks`, `both`, or `nothing` when the worker has been fired or its flow takes neither. A flow of your own takes tasks when it's built as [Taking a conversation's tasks](#taking-a-conversations-tasks) shows. A delegate that takes nothing has a `description` of `null`, and so does a worker with no description. The other three actions leave both out. With an EM that takes posts and a coder whose `work` entry is built with `workerTaskEntry`, its `delegates` read:

```json
[
  { "worker": "eng.em", "description": "Files each feature on the team's board.", "takes": "posts" },
  { "worker": "eng.coder", "description": "Does the work a filed row names.", "takes": "tasks" }
]
```

`filingSessionId` identifies this conversation to its delegates. Each delegate works this conversation's posts in a session of its own, and `workforce.findWorkerSession({ worker, filingSessionId })` returns it. A lookup that names only the worker never does. Only the conversation opens a delegate's session: `ensureWorkerSession` with a `filingSessionId` finds it but never creates it, and a session create whose `state` carries `filingSessionId` is refused with a 400.

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

A worker whose flow takes tasks but not posts can be added. A post handed to it is skipped, and the record's reason is `Worker "<id>" runs on flow "<flow>", which can't take a delegated post.` When the coordinator's own turn hands it a post with `dispatchTask`, the refusal goes on to name the delegates in the conversation that do take posts, so the turn can pick one of them:

```text
Worker "eng.coder" runs on flow "coder", which can't take a delegated post. Delegates here that take posts: eng.em.
```

When none does, it ends `No delegate here takes posts.` instead. Only the flows in `delegateFlows` take posts: a worker on any other flow counts as one that can't, even when its flow declares the entry.

Removing checks only the list, so you can remove a delegate that has since been fired. A delegate you remove still answers a post it was already handed. Removing the fallback clears it; best fit then hands what it can't place to the coordinator's own turn until you set another with `setFallback`.

## Letting delegates answer each other

With `rounds: 0`, the default, a delegate's answer lands in the conversation and goes no further. Set `rounds:` to 1, 2 or 3 and each answer goes back out to the other delegates, by the same policy, for that many rounds. The user's post is round 0.

- `best-fit` and `round-robin` route each answer again as it lands, never to its own author.
- `everyone` waits for the round to close, then hands each delegate the other delegates' answers from it in one delivery. A delegate with no other answer to get is skipped.
- `judgment` waits for the round to close, then runs the coordinator's turn once with the round's answers. Its dispatches in that turn go out in the next round.

A round closes when every delegate in it has answered or failed, or at its deadline: five minutes, unless you set `roundDeadlineMs`. A delegate whose turn fails ends its [task](#how-a-post-is-tracked) at once, so the round doesn't wait on it. One whose run is cancelled ends its task as cancelled, at once, when its flow sets [`delegatedPostOnFinished`](#making-your-own-flow-a-delegate), as the built-in `agent` flow does. One still working at the deadline keeps working; the round closes without it, and its answer lands once when it comes, going no further. A delegate that never reports at all, because its process stopped, holds its round until the conversation's next activity after the deadline: a post, an answer, or another delegate's report.

A conversation keeps at most 50 rounds open. A post past that is still delivered, but its round isn't opened: its answers land and go no further, and its routing record carries a `note` saying so.

**What it costs.** Each delegate gets at most one delivery per post per round, so a post costs at most delegates × (rounds + 1) delegate turns: 100 at 25 delegates and 3 rounds. `judgment` adds up to rounds + 1 turns of the coordinator's own. `best-fit` adds at most one model call per round, or two when the evaluator call fails and it asks again as a language model, plus a coordinator turn for each post it picks the coordinator for, and for each it can't place when no fallback takes it.

## How a post is tracked

Each delegate a post goes to gets a task for it on the conversation's [task board](./delegating-work.md), one per delegate per round. It sits on the board next to the tasks you filed yourself, and it ends like any task: completed with the delegate's answer, which lands as the delegate's line, or failed.

Each delegate's answer to a post lands once, even across a restart or a dropped connection. A delegate handed the same post twice in one round gets one task, and the record says the second was skipped.

The task runs in the delegate's own session for this conversation, the same session every post from this conversation to that delegate runs in, so the delegate keeps what it was told before. A post to a [workstream](./projects.md#talking-to-a-project) runs in the workstream's own session.

You can cancel a post's task from the board with `cancelTask_tasks`. That delegate's part ends with no line, and if its turn is still running, what it says afterwards doesn't land. Reassigning, completing, failing or blocking a post's task from the board is refused. The board answers task actions only while the conversation files tasks, which it does while at least one of its delegates takes tasks. So in a conversation whose delegates take only posts, a post's task can't be cancelled from the board: `cancelTask_tasks` and `listTasks_tasks` answer `{ "ok": false, "error": "no_delegation_board" }`.

With 25 delegates, `everyone` and `rounds: 3`, one post adds up to 100 tasks to the board. They stay there like any finished task.

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
| `postId` | The post: the id of the request that carried the user's message. Answers going back out keep it. |
| `round` | `0` for the user's post, one more each time answers go back out. |
| `policy` | The conversation's `routing:`. |
| `by` | How the delegates were found: `judgment` (the coordinator's own turn, chosen by `routing: judgment` or handed the post by best fit), `held` (best fit, still on your last post), `evaluated` (best fit's call), `fallback`, `round-robin`, `everyone`, or `unplaced` (nobody took it). |
| `delegates` | Each delegate the decision touched: `worker`, `outcome` (`delivered`, `skipped` or `failed`), and `reason` when it wasn't delivered. |
| `none` | Why nobody was delivered to, when nobody was. |
| `fit` | Why best fit sent the post to the fallback or the coordinator's own turn: `reason` is `coordinator` (the call picked the coordinator), `below-floor`, `no-confidence`, `failed`, `not-a-choice` or `no-delegates`, with the `choice`, its `confidence` and the `minConfidence` in force where there are some. |
| `evaluationFailed` | Best fit's evaluator error, when that call failed and best fit asked again as a language model. `by` and `fit` say what the second ask came to. |
| `note` | Why this round's answers go no further: the conversation already had 50 rounds open. |

A post best fit gave to the coordinator's own turn because its pick was below the floor reads like this:

```json
{
  "postId": "req_…",
  "round": 0,
  "policy": "best-fit",
  "by": "judgment",
  "delegates": [],
  "none": "the coordinator handed it to no delegate",
  "fit": { "reason": "below-floor", "choice": "eng.em", "confidence": 0.36, "minConfidence": 0.7 }
}
```

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

### Reading it from your app

Outside a renderer, read the records from the conversation's requests. Continuing the [example above](#talking-to-it):

```ts
import { createSessionClient } from "@flow-state-dev/client";
import { COORDINATOR_ROUTE } from "@flow-state-dev/workforce/browser";
import type { CoordinatorRouteRecord } from "@flow-state-dev/workforce";

const sessions = createSessionClient({ baseUrl, fetcher });
const requests = await sessions.listSessionRequests(session.id, { includeItems: true });

const records = requests
  .flatMap((request) => request.items ?? [])
  .flatMap((item) =>
    item.type === "component" && item.component === COORDINATOR_ROUTE
      ? [item.data as CoordinatorRouteRecord]
      : [],
  );
```

Without `includeItems: true` a request carries no `items`, so you get no records. Each request a conversation runs carries the records made during it, so reading all of them gives you every decision. They come back most recently updated first, so sort them by `startedAtMs` before flattening if you want the decisions in the order they were made. `postId` and `round` say which post and round each record belongs to. In server code, `coordinatorRouteRecordSchema.parse(item.data)` from the package root checks the shape and returns a typed record, in place of the cast. See [`sessions.listSessionRequests`](../api/client.md#sessionslistsessionrequestssessionid-options) for its other options.

## Handing out tasks

A post gets an answer. When work has to be done instead, a coordinator can hand a **task** to one of its delegates that takes tasks, on its conversation's board. Handing out tasks works the same for every worker, so it has [a page of its own](./delegating-work.md); what follows is how it looks from a coordinator.

```ts
await help.sendAction(
  "dispatchTask_tasks",
  { goal: "Audit our dependencies' licenses", assignee: "licenses" },
  { sessionId: session.id },
);
```

These are the [task board](../orchestration/task-board.md)'s task tools, sent as actions on the conversation's session and named for its board, `tasks`: `dispatchTask_tasks`, `addTask_tasks`, `assignTask_tasks`, `listTasks_tasks` and the rest. The coordinator has the same verbs as tools, so it hands out a task itself when you ask it for one.

From your app or from the coordinator's own tools, the assignee has to be one of this conversation's delegates that takes tasks: its `takes` in `listDelegates` is `tasks` or `both`. Anyone else is refused with one answer, the same for another user's worker as for a worker nobody holds, and nothing is stored:

```json
{ "ok": false, "error": "unknown_assignee: \"helper\" is not on this board's team. Available: support.devices, licenses. …" }
```

A delegate whose `takes` is `nothing` is refused the same way, and the error says why:

```json
{ "ok": false, "error": "unknown_assignee: \"eng.coder\" is not on this board's team. Available: support.devices, licenses. Not taking tasks now: eng.coder: Worker \"eng.coder\" runs on flow \"coder\", which takes no task. …" }
```

A task with no assignee goes to the conversation's only delegate that takes tasks. With several, `dispatchTask_tasks` answers `assignee_required` and stores nothing, so name one.

`dispatchTask_tasks` answers `{ ok: true, taskId }` once the task is stored, without waiting for it to run. The task starts at once: the delegate works it in a new session of its own, its **task session**, which belongs to you like every other session your workers run, on whichever flow the delegate runs on. The delegate is checked again when the task is handed over. If the delegate was removed or fired in the meantime, or its flow takes no task, it doesn't run the task. The task fails, and the conversation hears that it failed.

`addTask_tasks` files a task **held** and answers `{ ok: true, taskId, status: "held" }`. A held task doesn't start, even with an assignee, until it is released. A held task with no assignee, in a conversation with several delegates, waits on the board unassigned. To have a delegate start a held task, send `dispatchTask_tasks` with its `taskId`, and an `assignee` if it has none:

```ts
await help.sendAction("dispatchTask_tasks", { taskId }, { sessionId: session.id });
```

`updateTask_tasks` with `patch: { status: "pending" }` releases it the same way, and `patch: { status: "held" }` holds a task that hasn't started yet. A task that has started can't be held; cancel it instead.

A task's `deps` must name tasks on this conversation's board that haven't failed or been cancelled, and must not loop back to the task. Anything else is refused when you file it, and nothing is stored. When a task fails for good or is cancelled, every open task that depends on it is cancelled too, labelled `skipped`.

### Hearing how it went

The conversation that filed a task hears once when it ends, in a line under the delegate's name:

```text
Task "Audit our dependencies' licenses" (task_…) completed by licenses: All 214 dependencies are MIT or Apache-2.0.
```

It hears when a task completes, with what came back; when it fails for good, with the error; when it stops on a question, with the question; and when it's cancelled, unless the coordinator cancelled it itself. A failure or a cancel that took dependent tasks with it names them in the same line, and they send no line of their own. When the line arrives, a coordinator that routes by `judgment` or `best-fit` takes a turn to read it and decide what to do next, such as filing a failed task again. One that routes by `round-robin` or `everyone` has no turn of its own, so it shows the line and nothing more. If the coordinator is in the middle of a reply to you, the line starts a second turn at once, and both replies appear in the conversation, each as its own message. Every task gets two attempts, a number you can't change, and a first failure just runs it again without a word.

### Managing tasks

| Action | What it does |
| --- | --- |
| `listTasks_tasks` | This conversation's tasks only, even when another conversation has the same coordinator and the same delegates |
| `dispatchTask_tasks` | Starts a new task, or a held one, on a delegate now |
| `assignTask_tasks` | Gives a task nobody is working on to another delegate. It keeps its id. A held task stays held until it is released |
| `updateTask_tasks` | Changes a task's details. Before the task starts, `patch.status` holds it (`"held"`) or releases it (`"pending"`) |
| `cancelTask_tasks` | Cancels a task that hasn't finished. Nothing is said in the conversation |

A running task can't be moved to another delegate. Cancelling one does land: when its delegate finishes, the result is turned away. A finished task, a failed one included, can't be reassigned or cancelled, and the tools answer `terminal_task_write_declined`. To have someone take on a failed task, dispatch it again (`dispatchTask_tasks`).

To open the session working a task, look it up by the task's id and the conversation's `filingSessionId`, which `listDelegates` returns:

```ts
const run = await workforce.findWorkerSession({ worker: "licenses", taskId, filingSessionId });
```

Two conversations can file a task with the same id for the same worker, and each finds only its own task's session. A lookup without `taskId` never returns a task session, so a post to the same worker in this conversation still lands in the session where that delegate works your posts. `ensureWorkerSession` with a `taskId` never creates a session: until the board hands the task over, it throws.

### When a task stops on a question

A delegate working a task sometimes can't go on without you: which region, which account, whether it may delete something. It parks the task on its question instead of guessing. The conversation hears it, with the question, and nothing runs while it waits.

Answer it from the conversation:

```ts
await help.sendAction(
  "answerTask_tasks",
  { taskId, answer: "Use eu-west." },
  { sessionId: session.id },
)
```

You can also just answer in chat: the coordinator passes your answer on with its [`answerTask`](../orchestration/task-board.md#when-a-task-stops-on-a-question) tool. The task picks up in its own task session, the one that asked, with everything it did before it stopped. Your answer is its next message. When it finishes, the conversation hears that too.

An answer doesn't use up the task's retries, and the task can ask again. Until it picks up again, it can't be reassigned: `assignTask_tasks` answers `task_awaiting_answer`. A task waits on a question for as long as it takes; cancel it if nobody will answer. A second answer to the same question is turned away, and so is an answer to a task that isn't waiting on one: the action answers `{ ok: false, error }` and nothing is written.

A task a coordinator dispatched and is [waiting for](../orchestration/task-board.md#giving-another-worker-work) (`dispatchTask` with `wait`) can't stop on a question. Its delegate answers with what it has, or fails.

### After a task finishes

A finished task's session stays open. For a worker on the built-in `agent` flow, a message to its worker in that session picks the task up again:

```ts
const run = await workforce.findWorkerSession({ worker: "licenses", taskId, filingSessionId })
const licenses = createClient({ flowKind: run.flowKind, userId, baseUrl, fetcher })
await licenses.sendAction("run", { message: "Also flag anything under AGPL." }, { sessionId: run.id })
// output: { reopened: <id of the task it reopened> }
```

The message reopens the task. It goes back on the conversation's board and reads in progress, under the same id, and its next attempt runs in the same session, where the worker answers from everything the session holds. The attempt doesn't use up the task's retries. When it ends, the conversation that filed the task hears the new ending, as it heard the first. If the task has follow-ups, the latest of them is the one reopened, and the output names it. A worker flow you build yourself handles the message however its `run` action does.

While the task or one of its follow-ups is still unfinished, a message in that session is an ordinary turn and the worker answers it directly.

To build on the work, dispatch a follow-up task that names it:

```ts
await help.sendAction(
  "dispatchTask_tasks",
  { goal: "Now write it up for the team", followUpOf: taskId },
  { sessionId: session.id },
)
```

The follow-up is a new task with its own id, and the conversation hears how it ends. It runs in the same session as the task it follows, with the same worker, so it starts from everything that session already knows. It keeps that worker: it can't be reassigned. You can file it while the task it follows is still running. A session works one task at a time, so the follow-up waits, unstarted, until that task ends, and then runs. `dispatchTask` refuses the follow-up, as `addTask` does, filing nothing, if the task it names never ran with a worker, or if you pass an `assignee`:

```json
{ "ok": false, "error": "follow_up_of_unrun: task \"task_…\" never ran with a worker, so there is no session to follow up in. Nothing was filed." }
```

## Making your own flow a delegate

A worker on the built-in `agent` flow can take posts as it is. A [worker flow of your own](./workers-on-disk.md#which-flows-can-run-workers) takes them once it declares the delegated-post entry around its door, the block its `run` action runs. Here the door is `researchAnswer`, a generator that answers with the worker's own instructions, the way the `agent` flow does:

```ts
import { defineFlow, generator, handler } from "@flow-state-dev/core";
import {
  DELEGATED_POST_ENTRY,
  delegatedPostEntry,
  delegatedPostHistory,
  delegatedPostOnFinished,
  workerConfigOf,
  workerConfigSchema,
} from "@flow-state-dev/workforce";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const loadWorker = handler({
  name: "research-load-worker",
  inputSchema: z.unknown(),
  resources: { ...installation.resources },
  execute: async (_input, ctx) => ({ worker: (await installation.resolveWorker(ctx, "research")).id }),
});

const researchAnswer = generator({
  name: "research-answer",
  inputSchema,
  model: "openai/gpt-6-luna",
  history: delegatedPostHistory,
  prompt: (_input, ctx) => {
    const { instructions } = workerConfigOf(ctx);
    return typeof instructions === "string" ? instructions : "You answer research questions in two or three sentences.";
  },
  user: (input) => input.message,
});
```

`workerConfigOf(ctx)` returns the configuration of the worker the turn loaded, synchronously, so a prompt, a tool list or a step condition can read it. The turn loads its worker when `installation.resolveWorker(ctx, flowKind)` runs. `loadWorker` calls it from the flow's `request.onStarted`, so every turn has its worker loaded, a resumed one included. If the turn loaded no worker, `workerConfigOf` throws.

The prompt is the worker's `WORKER.md` body, which arrives as its [`instructions` setting](./workers-on-disk.md#the-body-arrives-as-instructions). `workerConfigOf` types every setting as `unknown`, and a worker with an empty body has no `instructions` key at all, so the `typeof` check gives the prompt a string either way.

The flow wires the two blocks in:

```ts
const researchFlow = defineFlow({
  kind: "research",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources },
  request: { onStarted: loadWorker, onFinished: delegatedPostOnFinished },
  actions: { run: { inputSchema, block: researchAnswer, userMessage: (input) => input.message } },
  task: { actions: { [DELEGATED_POST_ENTRY]: delegatedPostEntry(researchAnswer) } },
});
```

Then add it to `delegateFlows`. The door is handed `{ message }`, where the message reads `<from>, through <coordinator>: <post>`: who wrote it (the user's id, or the delegates whose answers it passes on), and the coordinator's worker id. Whatever the door returns, a string or `{ text }`, is the answer. An empty reply fails the turn, and nothing is answered.

If your flow declares the entry under `internal.actions`, as earlier versions did, `defineCoordinatorFlow` throws, with a message naming the `task` form. Earlier versions also named the coordinator's dispatch tool `handOff`; a worker file whose `tools:` still names it is refused when the app loads, with a message pointing at `dispatchTask` and `post: true`.

`delegatedPostOnFinished` ends a delegated run's task when the run is cancelled, so its round doesn't wait for the deadline. Without it, a failed turn is reported at once, but a cancelled one holds its round until the deadline.

To show the model the conversation's [recent lines](#follow-ups-and-recent-lines), set the generator's `history` to `delegatedPostHistory`. It reads the session's history the same way `history: true` does. On a delegated post that came with lines, it also puts the message shown in [Follow-ups and recent lines](#follow-ups-and-recent-lines) just before the post, with the `user` role: a heading naming the coordinator's worker id, then one `- <from>: <text>` per line, where `<from>` is your user id, the coordinator's worker id or the answering delegate's worker id. On any other turn, and on a post with no lines, it adds nothing.

### Taking a conversation's tasks

A worker on the built-in `agent` flow takes a coordinator's tasks with no extra setup. A worker flow of your own takes them once its `work` task entry is built with `workerTaskEntry`:

```ts
import { defineFlow, handler } from "@flow-state-dev/core";
import { workerConfigSchema, workerTaskEntry } from "@flow-state-dev/workforce";
import { z } from "zod";

const inputSchema = z.object({ message: z.string() });

const turn = handler({
  name: "reviewer-turn",
  inputSchema,
  execute: async ({ message }) => `Reviewed: ${message}`,
});

const reviewerFlow = defineFlow({
  kind: "reviewer",
  configSchema: workerConfigSchema(),
  session: installation.session(),
  resources: { ...installation.resources },
  actions: { run: { inputSchema, block: turn, userMessage: (input) => input.message } },
  task: { actions: { work: workerTaskEntry({ name: "reviewer-task", turn }) } },
});
```

| Option | What it is |
| --- | --- |
| `name` | Names the entry's blocks. |
| `turn` | The flow's turn for one message: `{ message }` in, the answer out. |
| `block` | Instead of `turn`. A block that takes the task itself (`taskId`, `goal`, `context`, `input`, `attempts`), plus `claim`, the board and partition the task was claimed from. For a flow whose work isn't one message in and one answer out, such as a coding run. Give `turn` or `block`, not both. |

With `turn`, each task runs as one turn, in a task session of its own. The task as filed is the turn's message, and what the turn returns is the task's result. When the task completes or fails, the conversation that filed it hears so, in a line under the worker's name, as in [Hearing how it went](#hearing-how-it-went).

A coding worker built on the [harness manager](../orchestration/harness-manager.md) uses `block`: the manager takes the task, works it in its own checkout, and returns the answer. The conversation hears it the same way. The `claim` comes from the board, never from the task, so a task can't point its run at another board.

A `work` entry whose tasks come only from a board in your own flow counts as taking none: `listDelegates` reports its workers as taking `nothing`, and `dispatchTask` and `addTask` refuse them.

## What it won't do

- **Hand a post to another user's worker.** Their workers aren't on your roster, and naming one gets the same answer as a worker that doesn't exist.
- **Write a change back to the file.** A conversation's delegates are its own.
- **Stop a delegate at the deadline.** The round closes without it; the delegate's turn runs on.
- **Stop a delegate's turn.** Cancelling a post's task ends that delegate's part and drops anything it says afterwards, but the turn itself runs on.
- **Pick by a delegate's instructions.** Best fit knows each delegate by its note, or else its description, and nothing else.
- **Show a delegate another conversation.** A post's recent lines are its own conversation's, and the delegate's model sees them for that one turn.
- **Let a delegate file tasks for workers it doesn't delegate to.** A task session files only when its own worker has a delegate that takes tasks, and what it files are [pieces of its task](./delegating-work.md#splitting-a-task). Otherwise its `addTask` is refused, from the delegate's tools and from your app alike, with `{ "ok": false, "error": "no_delegation_board" }`.

## Related pages

- [The Shift Coordinator](./shift-coordinator.md): an org-level worker that hires workers of your own and, as a coordinator, hands them work.
- [The built-in worker](./built-in-worker.md): the `agent` flow, whose turn a coordinator runs when it routes by judgment.
- [Delegating work](./delegating-work.md): how any worker files tasks for its delegates, splits a task, and how far a chain goes.
- [Workers on disk](./workers-on-disk.md): `WORKER.md`, `readWorkforce`, `hireWorkforce`, and talking to a worker.
- [Hiring, forking and firing workers](./durable-hire.md): how a user's own workers get onto their roster.
