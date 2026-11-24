---
title: Workers
type: concept
description: A worker is a named agent you brief in a Markdown file, then talk to or hand tasks.
---

import Figure from "@site/src/components/Figure";
import Worker from "./figures/worker.svg";

# Workers

A worker is an agent with a name and a job. You brief it in a Markdown file, the way you would brief a new colleague: what it's for, what it can use, who it can ask for help.

You can talk to a worker, or hand it a task and come back later. Everyone who uses the app has each worker, and what it learns about one user stays with that user.

## If you know agents

In most frameworks an agent is one thing: a model, a prompt, some tools, and a loop the framework runs for you. A worker can be exactly that, and the ones that come with Workforce, the kit that provides workers, are.

The difference is underneath. A worker runs on a flow, a self-contained piece of your app's backend with the actions it exposes, and you decide what the flow is. It can be one model call. It can be several, with a plan, a draft and a review. It can be mostly plain code that asks a model one question at the end. From the outside it is the same worker either way: it has a name, and you talk to it the same way. It takes tasks when its flow declares the `contributor` role, as the built-in agent flow does.

So "worker" names the job, and the flow decides how the job gets done. [What runs a worker](#what-runs-a-worker) shows how to change it.

## The file

```md title="workforce/teams/engineering/workers/lead/WORKER.md"
---
name: Engineering Lead
description: Breaks a request into tasks and reports what came back.
model: openai/gpt-6-luna
delegates: [engineering.coder, engineering.reviewer]
---

You are the engineering lead. You do not write code yourself. You break the
request into tasks, hand them to the coder and the reviewer, and report what
came back.
```

That file gives you a worker with the id `engineering.lead`, made from its team and worker folders. `name` is what people see, `delegates` names other workers by id, and each one needs a file of its own: a standard worker's delegates must be standard workers, or the app refuses to start. Everything below the second `---` is its instructions. The [WORKER.md reference](../reference/worker-md.md) has every setting, which one a file must have, and how the id is formed.

<Figure svg={Worker} caption="One file, a worker on each user's list of workers" description={"On the left, a WORKER.md file in your repo, at workforce/teams/engineering/workers/lead. In the middle, two lists of workers, Alice's and Bob's, each listing engineering.lead from that one file; Alice's is highlighted as one user's own worker. On the right, Alice's sessions, where her worker works: a conversation, where she talks and it answers, and a task, which it runs and reports back on. Each is a session of its own. The lists and the sessions are hatched: they outlive the request."} />

## Install the workers

Workforce is a kit, a feature your app installs. Point it at the folder:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";

export default createFlowState({
  kits: [workforce({ directory: "./workforce" })],
});
```

The folder is read when the app starts. A file in it that Workforce doesn't read, or a `WORKER.md` that doesn't load, stops the app from starting, and the error names the file. The [WORKER.md reference](../reference/worker-md.md) lists what makes a file unusable.

## Talk to one

A session is where a flow keeps many requests together as one record. A conversation with a worker is one session, and each task it runs is another. To start a conversation, ask for the session with that worker:

```ts title="src/lib/ask-lead.ts"
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";

export async function askLead(userId: string, message: string) {
  const fsd = createClient({ userId, baseUrl: "" }); // "" is this page's own origin
  const workforce = createWorkforceClient(fsd);

  const session = await workforce.ensureWorkerSession({ worker: "engineering.lead" });

  return fsd.flow(session.flowKind).send("respond", { message }, { sessionId: session.id });
}
```

`ensureWorkerSession` returns this user's conversation with that worker and creates it the first time. Calling it again returns the same conversation, history included, and the worker reads its recent turns on each message. `session.flowKind` is the flow the worker runs on. Every worker's flow takes a message on a `respond` action, so the same call works for any worker.

## Hand one a task

A worker with `delegates` can hand work to the workers it names. The lead above doesn't write code. It files a task for `engineering.coder`. The coder works on it in a session of its own, with the task's title, goal and context as its message, and its answer is recorded as the task's result. When the task ends, the lead's conversation hears about it once, in a line under the coder's name.

A worker can only hand work to its own delegates. The [refusals table](../reference/workforce.md) shows what a task for anyone else gets back.

When you want one front door for a whole team, make it a [coordinator](../catalog/workforce/coordinators.md): a worker whose job is to pick the right delegate for each message.

## Where the tasks show up

Every session of a worker that files keeps its own [board](./tasks-and-boards.md), and a worker files onto the board of the session it is in. So the tasks the lead hands out sit on the board of the conversation Alice had with it.

A page reads them through the `tasks` collection of that session. `BoardColumns` from `@flow-state-dev/workforce/react` draws the board by status, waiting, running and done:

```tsx title="src/app/lead-tasks.tsx"
import { useMemo } from "react";
import { createClient } from "@flow-state-dev/client";
import { BoardColumns } from "@flow-state-dev/workforce/react";

export function LeadTasks({ userId, sessionId }: { userId: string; sessionId: string }) {
  const client = useMemo(() => createClient({ userId, baseUrl: "" }), [userId]);

  // sessionId is Alice's conversation with engineering.lead, from ensureWorkerSession.
  return <BoardColumns sessionId={sessionId} boardRef="tasks" client={client} />;
}
```

The session has to be on a flow that keeps a board, and the built-in worker flow is one. The read returns the tasks of every session Alice has filed from, never another user's. The read leaves out each task's input, output and metadata, but the session's stream carries them each time the task changes, so keep secrets out of them. `BoardList` draws the same board as one list, and `Roster` draws a user's workers. [Workforce screens](../catalog/workforce/screens.md) covers their options.

## Whose worker it is

The files in your repo define the **standard** workers. Every user gets each of them, and each user's set of workers is their **roster**. Take two users, Alice and Bob. Alice's lead answers to Alice. Bob can't open her conversations, name her lead as a delegate, or read what it remembers about her. To Bob, her lead looks like a worker that doesn't exist.

A user can edit a standard worker from inside the app. The edit makes that user's own copy under the same id, and the file in your repo never changes; a reset deletes the copy and brings the standard back. A user who wants a second worker beside it **forks** it, and gets a new worker of their own that starts from the same settings. A user can also hire a worker from scratch while the app runs. Those workers belong to that user alone. No file changes and nothing restarts.

## What runs a worker

Every worker runs on a flow. Leave `flow:` out of the file and it runs on the built-in agent: a model, the worker's instructions, its tools, and the conversation so far.

When a worker needs to be more than a model with a brief, write a flow and name it:

```md title="workforce/teams/support/workers/triage/WORKER.md"
---
description: Sends an incoming request to an answer or to someone on the team.
flow: request-triage
---

Answer directly when the request is about a feature that already shipped.
```

The flow lives in its own file, `workforce/flows/workers/request-triage.ts`, and `fsdev gen`, the command that generates your app's registration files, writes it into `workforce/workforce.gen.ts`. Pass that module to the kit, or the worker that names the flow stops the app from starting: `import * as generated from "./workforce/workforce.gen"`, then `workforce({ directory: "./workforce", generated })`. The flow can give the worker fixed steps, branching, or a review before anything is sent:

```ts title="workforce/flows/workers/request-triage.ts"
import { defineFlow, handler } from "@flow-state-dev/core";
import { workerConfigSchema, workerFlow } from "@flow-state-dev/workforce";
import { z } from "zod";

const message = z.object({ message: z.string() });

const triage = handler({
  name: "triage",
  inputSchema: message,
  outputSchema: message,
  execute: (input) => ({
    message: input.message.includes("refund")
      ? "Passing this to the support team."
      : "That feature has shipped. See the guide.",
  }),
});

export default workerFlow((installation) =>
  defineFlow({
    kind: "request-triage",
    configSchema: workerConfigSchema(),
    session: installation.session(),
    resources: { ...installation.resources },
    actions: {
      respond: { inputSchema: message, block: triage, userMessage: (input) => input.message },
    },
  }),
);
```

`workerFlow` hands your function the `installation`, the object that runs this app's workers. The flow takes its session and resources from it so each session records which worker it belongs to. `respond` is the action every worker flow must have, and it is how the app talks to the worker.

## What it gets you

- Someone who doesn't write TypeScript can add `engineering.lead`, or change what it has been told, by editing a document.
- Each user gets their own lead, so Alice's conversations and what her lead learns about her never reach Bob.
- The lead can hand work to the coder and the reviewer, and each task is a session of its own on a board your page can read.
- You can move the lead to a flow of your own without changing how an app talks to it.

## How it fits with the others

A worker is something you open a session with and hand tasks by name. A block that a [board](./tasks-and-boards.md) runs is not one. What a worker won't do, and what it refuses, is in the [Workforce reference](../reference/workforce.md).

## Next

- [Run a starter](../start/run-a-starter.md) gives you a team of workers to talk to in about ten minutes.
- [Workforce](../catalog/workforce/index.md) covers what the kit installs and every way to extend it.
- [Tasks and boards](./tasks-and-boards.md) is the list a worker's tasks live on.
- [WORKER.md reference](../reference/worker-md.md) lists every setting.
