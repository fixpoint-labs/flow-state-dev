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

<Figure svg={OneMessage} caption="One message, top to bottom" description={"Four boxes stacked top to bottom with arrows between them. Your page, in the browser, calls session.sendAction with the action chat. The engine, on your server, checks the input and whose session it is; inside it sits the session, hatched because it outlives the request. The flow, help-desk, names its actions. The blocks, chatGenerator and incrementMessageCount, sit inside a dashed box because one run of the action lasts only as long as that run. A downward arrow between each pair of boxes is the call, and an upward arrow is the reply streaming back as items."} />

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

A **kit** is a feature packaged so an app installs it with one entry in `kits`. It brings its own flows and can leave openings for other kits to fill. `workforce` brings the team of workers in your repo. See [Kits and slots](./kits-and-slots.md).

`stores` is where data is kept. With none, it is kept in memory.

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

`useFlow` finds or creates the user's session, one conversation. The button waits for its id, because `sendAction` throws without one. `session.items` is the live list of what the flow streams back.

From there the message makes five stops:

1. The page sends the action to the engine.
2. The engine checks the input against the action's schema and checks that the session is the caller's.
3. The flow runs the action's block. In `help-desk` that is a sequencer, a block that runs blocks in order: `chatGenerator` calls the model, then `incrementMessageCount` updates the session's state.
4. Blocks emit **items**, the pieces a flow streams out, and they reach the page as the model writes.
5. When the run completes, the page receives the session's new state.

If the stream drops, the page picks it up where it left off. [Sessions, items and streaming](./sessions-items-and-streaming.md) has the detail.

A second user who sends to someone else's session id is answered as if that session did not exist, before any block runs.

## Where things are kept

<Figure svg={WhereThingsAreKept} caption="Where things are kept" description={"Four columns. In your repo: fsdev.config.ts, flow.ts, the blocks folder and WORKER.md. In the process: the FlowState handle. In your store, hatched because it outlives the request: the session, highlighted as the idea to keep, then session state, items, and request state drawn with a dashed outline because it belongs to one request only. In the browser: the live item list, the snapshot, unsent text kept in localStorage, and the last view answer, which the page holds only while the screen is open. A note says that with no stores set, the store column is held in the process and a restart empties it."} />

Code and `WORKER.md` files are in your repo. What `createFlowState` returns lives in the process.

The session is in your store, with its state and its items, including each block's recorded output. All of that outlives the request, and on a store that persists it outlives a restart. Request state, the scratch space of one action run, is kept with its request and no other request sees it. With no `stores`, the store is memory: a restart empties it, sessions included.

The browser holds what it last received: the live items and the snapshot, the state the flow chose to expose. Unsent text in a message box is kept in `localStorage`. A view is a read-only question a screen asks the server, such as a user's open orders. Its answer is computed on each read and stored nowhere. See [State and scopes](./state-and-scopes.md) and [Views](./views.md).

## Which page to read for what

Say the help-desk's `triage` worker gives a wrong answer. Open its `WORKER.md` first: the body is its instructions. If the file looks right, open the flow it names, then the blocks inside that flow. To see which block produced the text, run the action from a terminal:

```bash
fsdev run help-desk chat -i '{"message":"Where is my order?"}'
```

It prints one line for each item, stretch of streamed text and state change.

| Layer | Read |
| --- | --- |
| Kit | [Kits and slots](./kits-and-slots.md) |
| Flow | [Flows and actions](./flows-and-actions.md) |
| Block | [Blocks](./blocks.md) |
| Session | [Sessions, items and streaming](./sessions-items-and-streaming.md) |
| State | [State and scopes](./state-and-scopes.md) |
| View | [Views](./views.md) |

## Next

- [Flows and actions](./flows-and-actions.md): how a flow names its actions and what runs when one is called.
- [Blocks](./blocks.md): the five kinds of block and how they nest.
- [Kits and slots](./kits-and-slots.md): installing a feature, and how kits build on each other.
- [Glossary](../reference/glossary.md): every word on this page, in one line each.
