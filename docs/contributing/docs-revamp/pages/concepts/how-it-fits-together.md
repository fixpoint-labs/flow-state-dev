---
title: How it fits together
type: concept
description: The layers of a Flow State app, what one message passes through on its way down and back, where each thing is kept, and which page teaches each layer.
---

import Figure from "@site/src/components/Figure";
import OneMessage from "./figures/one-message.svg";
import WhereThingsAreKept from "./figures/where-things-are-kept.svg";

# How it fits together

A Flow State app is a React page on top of a backend, and the backend is built in layers. Each layer has one job, and each is taught on its own page.

This page uses one app, a help desk. A user types "Where is my order?" and a model answers. The page follows that message down through the layers, shows where each thing is kept, and says which page to open for what.

<Figure svg={OneMessage} caption="One message, top to bottom" description={"Four boxes stacked top to bottom with arrows between them. Your page, in the browser, calls session.sendAction with the action chat. The engine, on your server, checks the input and whose session it is; inside it sits the session, hatched because it outlives the request. The flow, help-desk, names its actions. The blocks, chatGenerator and incrementMessageCount, sit inside a dashed box because they last one action run. A downward arrow between each pair of boxes is the call, and an upward arrow is the reply streaming back as items."} />

## An app, from the top

One file says what the app is made of:

{/* Reconcile at cutover: the workforce kit factory is specified and not yet exported. */}

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { workforce } from "@flow-state-dev/workforce";
import helpDeskFlow from "./src/flows/help-desk/flow";

export default createFlowState({
  kits: [workforce({ model: "openai/gpt-6-luna" })],
  flows: [helpDeskFlow],
  stores: sqliteStores({ filename: "./app.db" }),
});
```

`createFlowState` builds the engine: the part on your server that serves your flows, streams their results and stores what they keep.

A **flow** is a backend you write. It names its actions, the entry points a page can run, and says which of its state the browser may see. `help-desk` has one action, `chat`. See [Flows and actions](./flows-and-actions.md).

A **block** is a typed unit of work: a model call, a plain function, or several of them chained. An action runs one block. See [Blocks](./blocks.md).

A **kit** is a feature packaged so an app installs it with one entry in `kits`. It brings its own flows and can leave openings for other kits to fill. `workforce` brings your team of workers, each one a `WORKER.md` file in your repo whose body is its instructions. See [Kits and slots](./kits-and-slots.md).

`stores` is where data is kept.

## What happens when you send a message

The page makes one call:

```tsx title="src/app/send-button.tsx"
import type { ReactElement } from "react";
import { useFlow, useSession } from "@flow-state-dev/react";

export function SendButton({ message }: { message: string }): ReactElement {
  const flow = useFlow({ flowKind: "help-desk", autoCreateSession: true });
  const session = useSession(flow.activeSessionId, { flowKind: "help-desk" });

  return (
    <button
      disabled={!flow.activeSessionId}
      onClick={() => void session.sendAction("chat", { message })}
    >
      Send
    </button>
  );
}
```

`useFlow` finds or creates the user's session, one conversation. The button stays disabled until the id exists; the [React API reference](../reference/api/react.md) covers what `sendAction` does without one.

From there:

1. The page sends the action to the engine.
2. The engine checks the input against the action's schema and checks that the session is the caller's. A session answers only the user who owns it; the [sessions reference](../reference/sessions.md) covers what happens otherwise.
3. The flow runs the action's block. In `help-desk` that is a sequencer, a block that runs blocks in order: `chatGenerator` calls the model, then `incrementMessageCount` updates the session's state.
4. Blocks emit **items**, the pieces a flow streams out, and they reach the page as the model writes. `session.items` is the live list of them.
5. When the run completes, the page receives the session's new state.

If the stream drops, the page picks it up where it left off. [Sessions, items and streaming](./sessions-items-and-streaming.md) has the detail.

## Where things are kept

<Figure svg={WhereThingsAreKept} caption="Where things are kept" description={"Four columns. In your repo: fsdev.config.ts, flow.ts, the blocks folder and WORKER.md. In the process: the FlowState handle. In your store, hatched because it outlives the request: the session, highlighted as the idea to keep, then session state, items, and request state drawn with a dashed outline because it belongs to one request only. In the browser: the live item list, the snapshot, unsent text kept in localStorage, and the last view answer, which the page holds only while the screen is open. A note says that with no stores set, the store column is held in the process and a restart empties it."} />

Code and `WORKER.md` files are in your repo. What `createFlowState` returns lives in the process.

The session is in your store, with its state and its items. All of that outlives the request, and on a store that persists it outlives a restart. Request state is scratch space for one action run. It is written to the store with its request, and only that run can see it. With no `stores`, the store is memory: a restart empties it, sessions included.

The browser holds what it last received: the live items and the snapshot, the state the flow chose to expose. A view is a read-only question a screen asks the server, such as a user's open orders. Its answer is computed on each read. The server doesn't keep it, and the browser holds only the last answer while the screen is open. See [State and scopes](./state-and-scopes.md), [Views](./views.md) and the [client reference](../reference/client.md) for what the browser keeps locally.

## Which page to read for what

Say a worker, `triage`, whose `WORKER.md` names `flow: help-desk`, gives a wrong answer. Open that file first. If it looks right, open the `help-desk` flow, then the blocks inside it. To see which block produced the text, run the action from a terminal:

```bash
fsdev run help-desk chat -i '{"message":"Where is my order?"}'
```

The [CLI reference](../reference/cli.md) lists what it prints and the flags that set the input and the session.

| Layer | Read |
| --- | --- |
| Kit | [Kits and slots](./kits-and-slots.md) |
| Flow | [Flows and actions](./flows-and-actions.md) |
| Block | [Blocks](./blocks.md) |
| Session | [Sessions, items and streaming](./sessions-items-and-streaming.md) |
| State | [State and scopes](./state-and-scopes.md) |
| View | [Views](./views.md) |

## What it gets you

- **The conversation survives.** The session lives in your store, so with `sqliteStores` a user comes back after a restart and finds it. With no `stores`, a restart empties it.
- **A dropped connection loses nothing.** The stream picks up where it stopped, so a half-written reply finishes.
- **The browser sees only what the flow exposes.** Everything else in session state stays on the server.
- **You can test without the page.** `fsdev run` runs the same action on the same engine and stores, from a terminal.

## How it fits with the others

Each layer uses only the ones beneath it, so the page never reaches into a block and a block never knows about React. Code outside the server, in Node or at the edge, talks to your flows through the client, and `@flow-state-dev/react` wraps that client in hooks. Kits, patterns, tools and memory are built on the runtime and are not part of it: you can ship a flow with none of them.

## Next

- [Flows and actions](./flows-and-actions.md): how a flow names its actions and what runs when one is called.
- [Blocks](./blocks.md): the five kinds of block and how they nest.
- [Kits and slots](./kits-and-slots.md): installing a feature, and how kits build on each other.
- [Glossary](../reference/glossary.md): every word on this page, in one line each.
