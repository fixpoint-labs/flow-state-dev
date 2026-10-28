---
title: Coordinators
sidebar_position: 3.5
sidebar_label: Coordinators
description: "A worker that hands each message to other workers on your roster, its delegates, by judgment, best fit, round robin or to everyone."
---

# Coordinators

Sometimes you want people to send work to one place and let it find the right worker. A **coordinator** is that place. It's a worker like any other on your roster, run by the `coordinator` flow, and the workers it hands work to are its **delegates**.

The coordinator hands each message you send it to one or more delegates, or, when it routes by judgment, may answer it itself. It hands a message on by filing a **routed task** for each delegate: an ordinary [task](./delegating-work.md) on your conversation's board, which you can list and cancel like any other. Each delegate works it in a session of its own, and its answer comes back into your conversation under its own name. An organization's [Shift Coordinator](./shift-coordinator.md) can be one.

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
| `fallback` | The delegate that takes a message `best-fit` can't place. It must be one of `delegates`. |
| `minConfidence` | Under `best-fit`, the lowest confidence at which a delegate pick is used, from `0` to `1`. Left out, any pick is used. See [Picking the coordinator, and a confidence floor](#picking-the-coordinator-and-a-confidence-floor). |
| `rounds` | How many times a delegate's answer goes back out to the others: `0` (the default) to `3`. See [Letting delegates answer each other](#letting-delegates-answer-each-other). |
| `editsOwnDelegates` | `true` gives the coordinator's own turn `addDelegate`, `removeDelegate` and `setFallback`, so it can change its delegates when you ask it to. `false` by default: only you change them, from your app. See [Changing the delegates](#changing-the-delegates). |

The coordinator's own turn, the one that runs when it routes by judgment, is the [built-in worker's](./built-in-worker.md) turn. Its `model`, `tools`, `skills` and `capabilities` read the way an `agent` worker's do. `listDelegates` and the [task tools](../orchestration/task-board.md#one-task-five-tools) come with the flow, whatever the coordinator's `tools:` line says, and so do `addDelegate`, `removeDelegate` and `setFallback` on a coordinator set to `editsOwnDelegates: true`. So do the [standing rules](./standing-rules.md) tools, `rules/read`, `rules/add`, `rules/change` and `rules/remove`, on a turn a user's own message started. In the turn's model input, each delegate's answer starts with `<worker id>, a delegate in this conversation, answered:`, and a message the routing already handed to delegates is followed by a note saying where it went: `Handed this message to <delegates> by its routing, with no turn of mine.`

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
  routeModel: "openai/gpt-6-luna",
});

flowRegistry.registerMany(hireWorkforce(installation));
```

`defineCoordinatorFlow` takes:

| Option | What it does |
| --- | --- |
| `installation` | The installation the coordinator and its delegates belong to. Required. |
| `routeModel` | The model behind `best-fit`'s call: a model id your resolver knows (its provider package must be installed; see [Setting up models](../getting-started/setting-up-models.md#choose-a-provider)), or an evaluation model. Best fit asks it as an evaluation model first, and, when that call fails on a model id, once more as a language model, which is how `openai/gpt-6-luna` still routes through a gateway that serves it only as a language model. One value for the flow, shared by every coordinator on it. Required, even when none of them routes by best fit; then it is never called. Use `typesafe-ai/jev` if any coordinator sets `minConfidence:`. Jev reports how sure it is; a language model and the other evaluation models don't, so under a floor their delegate picks are never used. A pick of the coordinator itself is used at any confidence. |
| `agent` | What the coordinator's own turn is built with: the options you'd give `defineAgentWorkerFlow`, such as `catalog` and `uses`. A coordinator's `tools:` line is read against this catalog. Left out, the built-in's defaults. |
| `roundDeadlineMs` | How long a round waits for its answers. Five minutes by default. A value that isn't a positive whole number of milliseconds throws. See [Letting delegates answer each other](#letting-delegates-answer-each-other) for what keeps the deadline. |

`hireWorkforce` refuses a coordinator file it can't run, naming the problem: a `rounds:` above 3 (`rounds can be at most 3`), a `routing:` it doesn't know, a `fallback:` that isn't one of its `delegates:`, a `minConfidence:` outside 0 to 1 or on a coordinator that doesn't route by `best-fit`, or a delegate named twice. A coordinator declared in your files can name only workers declared in your files; `createWorkerInstallation` refuses one whose `delegates:` names anything else.

## Talking to it

Open a session with the coordinator and send it a message, as you would [any worker](./workers-on-disk.md#talking-to-a-worker). If your server checks a credential, give the client the `fetcher` from [Serving it to your users](./overview.md#serving-it-to-your-users). Leave it out if it doesn't.

```ts
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

const fsd = createClient({ userId, baseUrl, fetcher });
const workforce = createWorkforceClient(fsd);
const session = await workforce.ensureWorkerSession({ worker: "support.help" });

const help = fsd.flow(session.flowKind);
await help.send("respond", { message: "My laptop won't charge." }, { sessionId: session.id });
```

`ensureWorkerSession` returns your conversation with the coordinator, or starts it if you have none. Other workers' [messages](./messaging-workers.md) to the coordinator land in that same conversation.

Say best fit picks `support.devices`. Its answer lands in the conversation as a message whose `agentName` is `support.devices`, the delegate's worker id. Replies from the coordinator's own turn carry an `agentName` that starts with `coordinator-judgment`, exported as `COORDINATOR_JUDGMENT`. The `Nobody took this message` line the coordinator writes when no one takes a message carries no `agentName`.

A delegate's answer arrives in a request of its own once the delegate's turn ends, so the `respond` request's stream never carries it. To wait for it, follow the whole session with [`fsd.sessions.stream`](../api/client.md#following-a-session), which delivers each finished item from any request in the session. Read the session's state for a start time, open the stream from it, then send the post, so nothing is missed. In place of the `send` call above:

```ts
import { COORDINATOR_JUDGMENT } from "@flow-state-dev/workforce/browser";

const { at, sessionCreatedAt } = await fsd.sessions.state(session.id);

const answer = new Promise<{ from: string; text: string }>((resolve, reject) => {
  const stream = fsd.sessions.stream(session.id, {
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

await help.send("respond", { message: "My laptop won't charge." }, { sessionId: session.id });
const { from, text } = await answer; // from: "support.devices"
```

`at` is the server time the state read began. The stream starts a few seconds before `since`, so it can deliver messages saved just before `at`, including an answer to an earlier message. Dropping anything older than `at` keeps that answer from passing as this one's.

The example waits only for a delegate, and it takes the first delegate message after `at`, whichever of your messages it answers. So use it when this message is the only one in flight: if an earlier one is still with a delegate, or under `everyone` more answers to it are still coming, one of those can land first and be taken for this message's answer. If the coordinator's own turn answers the message, or nobody takes it, no delegate message comes, and the timeout rejects instead. Five minutes matches a round's default deadline. Resolve on those messages too if your app should show them. [Following a session](../api/client.md#following-a-session) lists the stream's other options, such as `itemTypes` and `retry`. This is for scripts and server code. In a React view, use `useSession` with `live: true`, which already follows the session, rather than opening a second stream.

## Choosing how it routes

| `routing:` | Who gets a message |
| --- | --- |
| `judgment` (the default) | The coordinator's own turn reads the message and decides. It hands the message on by calling `createTask` with a delegate as `assignee`, a short `goal`, `session: "ongoing"` and `resultTo: "conversation"`, as many times as it likes, or answers itself. The delegate gets your message as you wrote it, with the coordinator's goal beside it; the coordinator chooses who, not what they read. |
| `best-fit` | One evaluator call, reading the message with the conversation's [recent lines](#follow-ups-and-recent-lines), picks who takes it: one of the delegates, by its note or else its description, or the coordinator itself, by its own description. A delegate with neither isn't offered. While a delegate is still working your last message, your next one goes to it too, with no call. |
| `round-robin` | The next delegate in the list after the one your last message went to. |
| `everyone` | Every delegate. |

Each policy checks a delegate when the message arrives. One that can't take it, because it was fired or because its flow takes no task, is skipped, and the [record](#what-it-records) says why. Routing never hands a message to the coordinator itself, even when its own id is on its list.

### Picking the coordinator, and a confidence floor

Best fit asks its evaluation model one question: who should take this message? The choices are the delegates and, when the coordinator has a `description:`, the coordinator itself. Picking the coordinator means the message is the coordinator's own job, so its own turn takes it, as under `judgment`. That is how a coordinator that routes plain requests straight to a delegate still answers "who works here?" or hires someone itself. Write its description to say what it does itself:

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

Best fit can't place a message when the call fails, answers with something that isn't a choice, has nobody to pick from, picks a delegate below `minConfidence:`, or reports no usable confidence (none, or one outside 0 to 1) while `minConfidence:` is set. Such a message goes to the `fallback:` delegate. With no fallback, or one that can't be reached, the coordinator's own turn takes it. If that turn fails too, nobody takes the message, and the conversation says so:

```text
Nobody took this message: best fit couldn't place it, and the coordinator's own turn failed: <error>.
```

`round-robin` and `everyone` say the same when they find no delegate to reach: `Nobody took this message: no delegate in this conversation can be reached.`

- **Only models that report confidence can pass the floor.** On a model that reports none, every delegate pick falls below the floor, and every message goes to the fallback or the coordinator's own turn. Leave `minConfidence:` out on those models.
- **There's no default.** Without `minConfidence:`, best fit uses any delegate pick, however unsure. For a Shift Coordinator, 0.7 sits between Jev's wrong picks, at 0.2 or lower, and its right ones, at 0.76 or higher. Check your own coordinator's requests before you copy the number.
- **A request that is still with a delegate skips all of this.** Your next message goes to the delegate working your last one, with no call, until it answers. It waits in your list until that delegate is free, then runs in the same session. A request meant for the coordinator, sent in that window, goes to that delegate too.

### Follow-ups and recent lines

A follow-up often makes sense only after what came before it. Say you ask about your laptop's wifi, `support.devices` answers, and you write back "It sees it. It fails right after the password." Read alone, that looks like a password question for `support.accounts`. Read with the lines before it, best fit can tell it's about the wifi and send it back to `support.devices`.

So every message travels with the conversation's **recent lines**: your messages, the coordinator's own replies, and the delegates' answers that have landed, oldest first, each under who wrote it. Under `best-fit`, the evaluator call reads the message with them, so a follow-up to a delegate's answer can go back to that delegate. The other policies don't route by the lines. Whatever the `routing:`, the delegate that takes a message is shown the same lines just before it, as one message with the `user` role, never as part of its instructions:

```text
Recent lines in the conversation with support.help before this message, oldest first:
- user_42: Hi, my laptop won't join the office wifi since this morning.
- support.devices: Does the laptop see the office network when you pick it?
```

Each line starts with who wrote it:

| Line by | Named as | Example |
| --- | --- | --- |
| You | Your user id | `user_42` |
| A delegate, in an answer that landed | The delegate's worker id | `support.devices` |
| The coordinator | The coordinator's worker id | `support.help` |

A coordinator line appears only when the coordinator wrote something in the conversation itself: a reply from its own turn, which runs under `judgment`, when best fit hands it a message nobody else took, and when a task it filed ends under either policy, or a `Nobody took this message` line. The [routing record](#what-it-records) is never a line.

What a delegate gets:

- **The last 10 lines, at most 4,000 characters in all.** They're counted back from the newest. The line that crosses 4,000 characters is cut short and ends with `…`, and anything older is left out.
- **This conversation's lines only.** They're read from this conversation's own messages, as far back as the session's history window reaches: its last 50 completed turns, where each message, each answer that lands and each other action on the conversation counts as one. A delegate never sees another conversation's lines.
- **Shown for one turn, as conversation.** The lines reach the delegate's model as a message beside yours, for the turn that answers it. They carry no more weight than your message itself: a line written like an instruction is read as something said in the conversation, not as part of the delegate's instructions. The delegate's own session keeps your message and its answer, never the lines.
- **Including an answer that just landed.** A message sent the moment an answer shows up in the conversation is routed and delivered with that answer among its lines.

The first message in a conversation has no lines, so it's routed and delivered alone. A delegate on the built-in `agent` flow shows its model the lines. A [flow of your own](#making-your-own-flow-a-delegate) built with `workerTaskEntry({ turn })` is handed your message only.

## Changing the delegates

The `delegates:` line is where each new conversation starts. A conversation takes its own copy of `delegates:` and `fallback:` on its first message, or on the first delegate action or tool call in it if that comes sooner. From then on, changes stay in that conversation. Other conversations with the same coordinator don't see them, and the file is never written. Editing `delegates:` later reaches only conversations that haven't had a message or a delegate action yet.

Your app changes a conversation's delegates. The coordinator's own turn changes them only when its file sets `editsOwnDelegates: true`. Both pass the same checks.

**From your app**, with the coordinator's actions on the conversation's session:

```ts
await help.send("addDelegate", { worker: "licenses", note: "Software license questions" }, { sessionId: session.id });
await help.send("removeDelegate", { worker: "support.accounts" }, { sessionId: session.id });
await help.send("setFallback", { worker: "licenses" }, { sessionId: session.id }); // { worker: null } clears it
await help.send("listDelegates", {}, { sessionId: session.id });
```

`note` is optional. Best fit picks by it before the worker's description.

Each action's output is the conversation's list as it stands after the call. `send` doesn't hand back the output: find it in the request's `result` with [`fsd.sessions.requests`](../api/client.md#sessionsrequestssessionid-options), passing `includeResultOutput: true`.

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

`listDelegates` also gives each delegate two things read from the roster when it is called. `description` is what the worker does: the description in its `WORKER.md`, or the one it was hired with. `takes` is what it can be handed now, from the flow it runs on: `tasks`, or `nothing` when the worker has been fired or its flow takes no task. A flow of your own takes tasks when it's built as [Taking a conversation's tasks](#taking-a-conversations-tasks) shows. A delegate that takes nothing has a `description` of `null`, and so does a worker with no description. The other three actions leave both out. With an EM and a coder whose `work` entries are built with `workerTaskEntry`, its `delegates` read:

```json
[
  { "worker": "eng.em", "description": "Files each feature on the team's board.", "takes": "tasks" },
  { "worker": "eng.coder", "description": "Does the work a filed row names.", "takes": "tasks" }
]
```

`filingSessionId` identifies this conversation to its delegates. Each delegate works this conversation's messages in a session of its own, and `workforce.findWorkerSession({ worker, filingSessionId })` returns it. A lookup that names only the worker never does. Only the conversation opens a delegate's session: `ensureWorkerSession` with a `filingSessionId` finds it but never creates it, and a session create whose `state` carries `filingSessionId` is refused with a 400.

A refused change writes nothing. Its request fails, and the refusal is in `result.error.message`.

**By the coordinator**, with tools of the same names, when you ask it to bring someone in or take someone off. Only a coordinator whose file sets `editsOwnDelegates: true` has `addDelegate`, `removeDelegate` and `setFallback`; every coordinator has `listDelegates`. A tool hands a refusal back to the model as `{ refused: "<message>" }`, so it can tell you why. The list isn't in the coordinator's prompt: to say who its delegates are, it calls `listDelegates`.

```yaml
---
flow: coordinator
delegates: [eng.em, eng.coder]
editsOwnDelegates: true
---
```

A conversation can't be created with delegates already set. A session create whose `state` carries `delegates` is refused with a 400:

```text
Session state field "delegates" is written only by flow "coordinator"; a caller cannot set it.
```

### Who can be a delegate

A delegate is a worker on your own roster, one of yours or a standard one, whose flow takes tasks. A conversation holds at most 25.

| Refused | Message |
| --- | --- |
| Another user's worker, or one nobody holds | `No worker "<id>" on your roster.` |
| A worker whose flow takes no task | `Worker "<id>" runs on flow "<flow>", which takes no task, so it can't be a delegate.` |
| A worker already on the list | `"<id>" is already a delegate in this conversation.` |
| A 26th delegate | `This conversation already has 25 delegates, the most it can hold. Remove one first.` |
| Removing a worker that isn't on the list | `"<id>" isn't a delegate in this conversation.` |
| A fallback that isn't on the list | `"<id>" isn't a delegate in this conversation, so it can't be the fallback.` |

When the coordinator's own turn files a message for a delegate that can't take it, its `createTask` is refused, nothing is filed, and the refusal names the delegates in the conversation that can, so the turn can pick one of them:

```text
not_routed: not handed to eng.coder: Worker "eng.coder" was fired. Delegates here that take one: eng.em. Nothing was filed.
```

A `createTask` on that turn that names no `assignee` is refused with `routed_assignee_required`, and one naming the coordinator itself is refused too: it answers the message itself instead.

Removing checks only the list, so you can remove a delegate that has since been fired. A delegate you remove still answers a message it was already handed. Removing the fallback clears it; best fit then hands what it can't place to the coordinator's own turn until you set another with `setFallback`.

## Letting delegates answer each other

With `rounds: 0`, the default, a delegate's answer lands in the conversation and goes no further. Set `rounds:` to 1, 2 or 3 and each answer goes back out to the other delegates, by the same policy, for that many rounds. The user's message is round 0.

- `best-fit` and `round-robin` route each answer again as it lands, never to its own author.
- `everyone` waits for the round to close, then hands each delegate the other delegates' answers from it in one delivery. A delegate with no other answer to get is skipped.
- `judgment` waits for the round to close, then runs the coordinator's turn once with the round's answers. What it files in that turn goes out in the next round.

A round closes when every delegate in it has answered, failed or been cancelled, or at its deadline: five minutes, unless you set `roundDeadlineMs`. A delegate whose turn fails, or whose [routed task](#how-a-routed-task-is-tracked) you cancel, ends its part at once, so the round doesn't wait on it. One still working at the deadline keeps working; the round closes without it, and its answer lands once when it comes, going no further.

On a host that [keeps wakes](../advanced/durable-execution.md#wakes), the engine keeps the deadline, so a round closes on time even when the server restarts before it. On one that doesn't, an in-process timer keeps it. A restart loses that timer, and the round then closes at the conversation's next activity after the deadline: a message, an answer, or another delegate's report.

A conversation keeps at most 50 rounds open. A message past that is still delivered, but its round isn't opened: its answers land and go no further, and its routing record carries a `note` saying so.

**What it costs.** Each delegate gets at most one delivery per message per round, so a message costs at most delegates × (rounds + 1) delegate turns: 100 at 25 delegates and 3 rounds. `judgment` adds up to rounds + 1 turns of the coordinator's own. `best-fit` adds at most one model call per round, or two when the evaluator call fails and it asks again as a language model, plus a coordinator turn for each message it picks the coordinator for, and for each it can't place when no fallback takes it.

## How a routed task is tracked

Each delegate a message goes to gets a routed task for it on the conversation's [task board](./delegating-work.md), one per delegate per round. It is an ordinary task, in your list next to the tasks you filed yourself, with three settings: `session: "ongoing"`, so it runs in the delegate's one session for this conversation; `resultTo: "conversation"`, so its answer lands here under the delegate's name; and one attempt. `getTask_tasks` shows them. It ends like any task: completed with the delegate's answer, which lands as the delegate's line, failed, or cancelled.

When a task the coordinator's own turn filed fails, the failure lands once as the delegate's line, naming the task and its error, and wakes that turn, so it can tell you or file the work again. The coordinator's own turn is the one that files under `judgment`, and under `best-fit` for a message best fit picks the coordinator for. When the routing filed the task with no coordinator turn behind it, a failure still lands once as the delegate's line, saying it couldn't answer and why, for example `support.general couldn't answer: No API key found`. No turn wakes for it, and the rest of the round goes on without that delegate.

Each delegate's answer to a message lands once, even across a restart or a dropped connection. A delegate handed the same message twice in one round gets one task, and the record says the second was skipped.

The delegate's session for this conversation is the same one every message from this conversation to that delegate runs in, so the delegate keeps what it was told before. It works one routed task at a time: a message to a delegate still busy with your last one waits in your list, pending, and starts in the same session once that one ends. A message to a [workstream](./projects.md#talking-to-a-project) runs in the workstream's own session.

A delegate can file work of its own for a message, such as tasks for its own delegates. Its routed task then stays open until that work has ended, and its answer, the one that lands here, comes from the turn that hears the work end. Until then, later messages to that delegate wait.

You can cancel a routed task with `updateTask_tasks` and `status: "cancelled"`, while it waits or while it runs. That delegate's part ends with no line: a waiting task never starts, and if its turn is still running, what it says afterwards doesn't land. Its settings are fixed when it is filed, so `updateTask_tasks` refuses `session`, `resultTo` and `target` with `filing_setting_fixed`.

With 25 delegates, `everyone` and `rounds: 3`, one message adds up to 100 tasks to the board. They stay there like any finished task.

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
    { "worker": "eng.em", "outcome": "skipped", "reason": "it was already handed this message in this round" }
  ]
}
```

| Field | What it holds |
| --- | --- |
| `postId` | The message: the id of the request that carried it. Answers going back out keep it. |
| `round` | `0` for the user's message, one more each time answers go back out. |
| `policy` | The conversation's `routing:`. |
| `by` | How the delegates were found: `judgment` (the coordinator's own turn, chosen by `routing: judgment` or handed the message by best fit), `held` (best fit, still on your last message), `evaluated` (best fit's call), `fallback`, `round-robin`, `everyone`, or `unplaced` (nobody took it). |
| `delegates` | Each delegate the decision touched: `worker`, `outcome` (`delivered`, `skipped` or `failed`), and `reason` when it wasn't delivered. |
| `none` | Why nobody was delivered to, when nobody was. |
| `fit` | Why best fit sent the message to the fallback or the coordinator's own turn: `reason` is `coordinator` (the call picked the coordinator), `below-floor`, `no-confidence`, `failed`, `not-a-choice` or `no-delegates`, with the `choice`, its `confidence` and the `minConfidence` in force where there are some. |
| `evaluationFailed` | Best fit's evaluator error, when that call failed and best fit asked again as a language model. `by` and `fit` say what the second ask came to. |
| `note` | Why this round's answers go no further: the conversation already had 50 rounds open. |

A message best fit gave to the coordinator's own turn because its pick was below the floor reads like this:

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

A delegate answers each message once per round. A message handed to the same delegate twice in a round is skipped the second time, with the reason `it was already handed this message in this round`.

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
import { COORDINATOR_ROUTE } from "@flow-state-dev/workforce/browser";
import type { CoordinatorRouteRecord } from "@flow-state-dev/workforce";

const requests = await fsd.sessions.requests(session.id, { includeItems: true });

const records = requests
  .flatMap((request) => request.items ?? [])
  .flatMap((item) =>
    item.type === "component" && item.component === COORDINATOR_ROUTE
      ? [item.data as CoordinatorRouteRecord]
      : [],
  );
```

Without `includeItems: true` a request carries no `items`, so you get no records. Each request a conversation runs carries the records made during it, so reading all of them gives you every decision. They come back most recently updated first, so sort them by `startedAtMs` before flattening if you want the decisions in the order they were made. `postId` and `round` say which message and round each record belongs to. In server code, `coordinatorRouteRecordSchema.parse(item.data)` from the package root checks the shape and returns a typed record, in place of the cast. See [`fsd.sessions.requests`](../api/client.md#sessionsrequestssessionid-options) for its other options.

## Handing out tasks

A routed task gets your message an answer. When work has to be done instead, a coordinator can hand a **task** of its own making to one of its delegates, on its conversation's board. Handing out tasks works the same for every worker, so it has [a page of its own](./delegating-work.md); what follows is how it looks from a coordinator.

```ts
await help.send(
  "createTask_tasks",
  { goal: "Audit our dependencies' licenses", assignee: "licenses" },
  { sessionId: session.id },
);
```

These are the [task board](../orchestration/task-board.md)'s task tools, sent as actions on the conversation's session and named for its board, `tasks`: `createTask_tasks`, `getTask_tasks`, `listTasks_tasks` and `updateTask_tasks`. The coordinator has the same verbs as tools, so it hands out a task itself when you ask it for one.

From your app or from the coordinator's own tools, the assignee has to be one of this conversation's delegates that takes tasks: its `takes` in `listDelegates` is `tasks`. Anyone else is refused with one answer, the same for another user's worker as for a worker nobody holds, and nothing is stored:

```json
{ "ok": false, "error": "unknown_assignee: \"helper\" is not on this board's team. Available: support.devices, licenses. …" }
```

A delegate whose `takes` is `nothing` is refused the same way, and the error says why:

```json
{ "ok": false, "error": "unknown_assignee: \"eng.coder\" is not on this board's team. Available: support.devices, licenses. Not taking tasks now: eng.coder: Worker \"eng.coder\" runs on flow \"coder\", which takes no task. …" }
```

A task with no assignee goes to the conversation's only delegate that takes tasks. With several, it waits on the board unassigned until you give it one with `updateTask_tasks`, so name one when you file it.

`createTask_tasks` answers `{ ok: true, taskId }` once the task is stored, without waiting for it to run. The task starts at once: the delegate works it in a new session of its own, its **task session**, which belongs to you like every other session your workers run, on whichever flow the delegate runs on. The delegate is checked again when the task is handed over. If the delegate was removed or fired in the meantime, or its flow takes no task, it doesn't run the task. The task fails, and the conversation hears that it failed.

Filed with `held: true`, it answers `{ ok: true, taskId, status: "held" }`, and the task doesn't start, even with an assignee, until it is released. A held task with no assignee, in a conversation with several delegates, waits on the board unassigned. To release a held task, send `updateTask_tasks` with `status: "pending"`, and an `assignee` first if it has none:

```ts
await help.send("updateTask_tasks", { id: taskId, status: "pending" }, { sessionId: session.id });
```

`updateTask_tasks` with `status: "held"` holds a task that hasn't started yet. A task that has started can't be held; cancel it instead.

A task's `deps` must name tasks on this conversation's board that haven't failed or been cancelled, and must not loop back to the task. Anything else is refused when you file it, and nothing is stored. When a task fails for good or is cancelled, every open task that depends on it is cancelled too, labelled `skipped`.

### Hearing how it went

The conversation that filed a task hears once when it ends, in a line under the delegate's name:

```text
Task "Audit our dependencies' licenses" (task_…) completed by licenses: All 214 dependencies are MIT or Apache-2.0.
```

It hears when a task completes, with what came back; when it fails for good, with the error; when it stops on a question, with the question; and when it's cancelled, unless the coordinator cancelled it itself. A failure or a cancel that took dependent tasks with it names them in the same line, and they send no line of their own. When the line arrives, a coordinator that routes by `judgment` or `best-fit` takes a turn to read it and decide what to do next, such as filing a failed task again. One that routes by `round-robin` or `everyone` has no turn of its own, so it shows the line and nothing more. If the coordinator is in the middle of a reply to you, the line starts a second turn at once, and both replies appear in the conversation, each as its own message. Every task gets two attempts, a number you can't change, and a first failure just runs it again without a word. A task whose result goes to the conversation, such as a routed task or its follow-up, gets one.

### Managing tasks

| Action | What it does |
| --- | --- |
| `listTasks_tasks` | This conversation's tasks only, even when another conversation has the same coordinator and the same delegates |
| `getTask_tasks` | One task whole: its brief, its fields, how it stands, its delegate's status note, and its output |
| `createTask_tasks` | Files a task: it starts at once, after its `deps`, or, with `held: true`, when you release it |
| `updateTask_tasks` | Before the task starts: changes any of its fields, its delegate included, holds it (`status: "held"`) or releases it (`status: "pending"`). Until it finishes: sends it a `message`, or cancels it (`status: "cancelled"`), with nothing said in the conversation |

A task that has started can't be changed, only steered with a message or cancelled: `updateTask_tasks` answers `field_locked_after_start`, naming the fields. A running task keeps its delegate; to move it, cancel it and file it again. Cancelling one does land: when its delegate finishes, the result is turned away. A finished task, a failed one included, changes no more, and `updateTask_tasks` answers `task_finished`. To have someone take on a failed task, file it again (`createTask_tasks`).

To open the session working a task, look it up by the task's id and the conversation's `filingSessionId`, which `listDelegates` returns:

```ts
const run = await workforce.findWorkerSession({ worker: "licenses", taskId, filingSessionId });
```

Two conversations can file a task with the same id for the same worker, and each finds only its own task's session. A lookup without `taskId` never returns a task session, so a message routed to the same worker in this conversation still lands in the session where that delegate works your messages. `ensureWorkerSession` with a `taskId` never creates a session: until the board hands the task over, it throws.

### When a task stops on a question

A delegate working a task sometimes can't go on without you: which region, which account, whether it may delete something. It asks you instead of guessing, with its `askQuestion` tool. The task waits on the question, nothing runs while it waits, and the question shows in your Inbox.

Answer it from the Inbox, or by typing the answer in the task's session: a line there answers the task's oldest open question. An app answers with the board's `updateTask` action, naming the question (`getTask_tasks` lists it under `questions`):

```ts
await help.send(
  "updateTask_tasks",
  { id: taskId, answers: questionId, message: "Use eu-west." },
  { sessionId: session.id },
)
```

The coordinator can answer a question its delegate asked midway, with its `updateTask` tool. The coordinator answers a question only when the task runs in a session of its own. When the task runs in the delegate's ongoing session, you answer it. The first answer wins; a later one is kept as an ordinary message to the task. The task takes one more turn in its own task session, the one that asked, on the same attempt, with everything it did before and your answer. When it finishes, the conversation hears that.

An answer doesn't use up the task's retries, and the task can ask again. It has started, so it can't be reassigned. A question waits for as long as it takes, unless your host sets a deadline for the user's answer; cancel the task if nobody will answer. A delegate can also stop for your approval or your review of its work, with its `waitForUser` tool; that shows in your Inbox as well, and only you answer it there. See [A task waiting on a user](../orchestration/task-board.md#a-task-waiting-on-a-user).

### Steering a task while it runs

Changed your mind, or forgot a detail? Send the task a message. It's kept on the task and reaches its delegate's work without starting over or using a retry:

```ts
await help.send(
  "updateTask_tasks",
  { id: taskId, message: "Also flag anything under AGPL." },
  { sessionId: session.id },
)
```

A task that hasn't started gets every message in its brief. A running one takes it before its delegate's next model call. A task waiting on work it handed on gets a turn with the message right away. And a message that lands just after the delegate's last model call gets one more turn before the task finishes. The conversation hears one ending, after that turn. See [Sending a message to an open task](../orchestration/task-board.md#sending-a-message-to-an-open-task) for the rules.

Typing in the task's own session does the same. For a worker on the built-in `agent` flow, or a coding worker built on a [harness manager](../orchestration/harness-manager.md#talking-to-a-run), a line there while the task is unfinished is a message to the task, and no separate reply runs:

```ts
const run = await workforce.findWorkerSession({ worker: "licenses", taskId, filingSessionId })
await fsd.flow(run.flowKind).send("respond", { message: "Also flag anything under AGPL." }, { sessionId: run.id })
// output: { steered: <the task's id> }
```

### After a task finishes

A finished task's session stays open, and the task stays as it ended. A line in that session is an ordinary turn: the worker answers from everything the session holds, and the task, its output and its retries don't change. A worker flow you build yourself handles the line however its `respond` action does.

A finished task takes no message: `updateTask_tasks` answers `task_finished`. To correct or build on the work, file a follow-up task that names it:

```ts
await help.send(
  "createTask_tasks",
  { goal: "Now write it up for the team", followUpOf: taskId },
  { sessionId: session.id },
)
```

The follow-up is a new task with its own id, and the conversation hears how it ends. It runs in the same session as the task it follows, with the same worker, so it starts from everything that session already knows. A routed task's follow-up runs where the routed task ran: the delegate's session for this conversation, or the workstream's session. Its answer lands the way the routed task's did, as the delegate's line. If that session is gone, the follow-up fails and the conversation hears it. Once it completes, `getTask_tasks` on the original shows the follow-up's output as `current`, beside the original's own output, which never changes. It keeps that worker: it can't be reassigned. You can file it while the task it follows is still running. A session works one task at a time, so the follow-up waits, unstarted, until that task ends, and then runs. `createTask` refuses the follow-up, filing nothing, if the task it names never ran with a worker, or if you pass an `assignee`, a `session`, a `target` or a `resultTo`:

```json
{ "ok": false, "error": "follow_up_of_unrun: task \"task_…\" never ran with a worker, so there is no session to follow up in. Nothing was filed." }
```

## Making your own flow a delegate

A worker on the built-in `agent` flow takes a coordinator's routed tasks as it is. A routed task is a task like any other, so a [worker flow of your own](./workers-on-disk.md#which-flows-can-run-workers) takes them once its `work` task entry is built with `workerTaskEntry`, as [Taking a conversation's tasks](#taking-a-conversations-tasks) shows. Here the turn is `researchAnswer`, a generator that answers with the worker's own instructions, the way the `agent` flow does:

```ts
import { defineFlow, generator, handler } from "@flow-state-dev/core";
import { workerConfigOf, workerConfigSchema, workerTaskEntry } from "@flow-state-dev/workforce";
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
  request: { onStarted: loadWorker },
  actions: { respond: { inputSchema, block: researchAnswer, userMessage: (input) => input.message } },
  task: { actions: { work: workerTaskEntry({ name: "research-task", turn: researchAnswer }) } },
});
```

Register it as a `contributor`, the role that takes tasks: `workerFlows: { research: { flow: researchFlow, roles: ["contributor"] } }`.

A routed task's turn is handed `{ message }`, where the message reads `<from>, through <coordinator>: <message>`: who wrote it (the user's id, or the delegates whose answers it passes on), the coordinator's worker id, and the message as written. When the coordinator's own turn filed it with a goal of its own, `Your task: <goal>` follows on a line of its own. Whatever the turn returns, a string or `{ text }`, is the answer. An answer that is empty lands nothing. The built-in `agent` flow also shows its model the conversation's [recent lines](#follow-ups-and-recent-lines) on that turn. A flow built this way is handed the message only; to show its model the lines too, give its generator `history: routedTaskHistory` (from `@flow-state-dev/workforce`).

**Upgrading:** a worker file whose `tools:` names `handOff` is refused when the app loads, with a message pointing at `createTask` and the routing settings.

### Taking a conversation's tasks

A worker on the built-in `agent` flow takes a coordinator's tasks with no extra setup. A worker flow of your own takes them once it declares the `contributor` role and its `work` task entry is built with `workerTaskEntry`:

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
  actions: { respond: { inputSchema, block: turn, userMessage: (input) => input.message } },
  task: { actions: { work: workerTaskEntry({ name: "reviewer-task", turn }) } },
});

const installation = createWorkerInstallation({
  standardWorkers: workers,
  workerFlows: () => ({ reviewer: { flow: reviewerFlow, roles: ["contributor"] } }),
});
```

The hire checks the two together: a `contributor` without a `work` built by `workerTaskEntry` is refused, and so is a `workerTaskEntry` on a flow that doesn't declare `contributor`. Each refusal names the flow, the role and the entry.

| Option | What it is |
| --- | --- |
| `name` | Names the entry's blocks. |
| `turn` | The flow's turn for one message: `{ message }` in, the answer out. |
| `block` | Instead of `turn`. A block that takes the task itself (`taskId`, `goal`, `context`, `input`, `attempts`), plus `claim`, the board and partition the task was claimed from. For a flow whose work isn't one message in and one answer out, such as a coding run. Give `turn` or `block`, not both. |

With `turn`, each task runs as one turn, in a task session of its own. The task as filed is the turn's message, and what the turn returns is the task's result. When the task completes or fails, the conversation that filed it hears so, in a line under the worker's name, as in [Hearing how it went](#hearing-how-it-went).

A coding worker built on the [harness manager](../orchestration/harness-manager.md) uses `block`: the manager takes the task, works it in its own checkout, and returns the answer. The conversation hears it the same way. The `claim` comes from the board, never from the task, so a task can't point its run at another board.

A `work` entry whose tasks come only from a board in your own flow isn't `workerTaskEntry`'s, so register that flow without `contributor`: `listDelegates` reports its workers as taking `nothing`, routing skips them, and `createTask` refuses them.

## What it won't do

- **Hand a message to another user's worker.** Their workers aren't on your roster, and naming one gets the same answer as a worker that doesn't exist.
- **Write a change back to the file.** A conversation's delegates are its own.
- **Stop a delegate at the deadline.** The round closes without it; the delegate's turn runs on.
- **Stop a delegate's turn.** Cancelling a routed task ends that delegate's part and drops anything it says afterwards, but the turn itself runs on.
- **Pick by a delegate's instructions.** Best fit knows each delegate by its note, or else its description, and nothing else.
- **Show a delegate another conversation.** A message's recent lines are its own conversation's, and the delegate's model sees them for that one turn.
- **Let a delegate file tasks for workers it doesn't delegate to.** A task session files only for its own worker's delegates, and what it files are [pieces of its task](./delegating-work.md#splitting-a-task). A task for anyone else is refused, from the delegate's tools and from your app alike.
- **Let a coordinator change its own delegates unless you said so.** Without `editsOwnDelegates: true` in its file, its turn has `listDelegates` only.

## Related pages

- [The Shift Coordinator](./shift-coordinator.md): an org-level worker that hires workers of your own and, as a coordinator, hands them work.
- [The built-in worker](./built-in-worker.md): the `agent` flow, whose turn a coordinator runs when it routes by judgment.
- [Delegating work](./delegating-work.md): how any worker files tasks for its delegates, splits a task, and how far a chain goes.
- [Workers on disk](./workers-on-disk.md): `WORKER.md`, `readWorkforce`, `hireWorkforce`, and talking to a worker.
- [Hiring, forking and firing workers](./durable-hire.md): how a user's own workers get onto their roster.
