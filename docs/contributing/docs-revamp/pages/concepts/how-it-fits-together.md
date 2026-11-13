---
title: How it fits together
type: concept
description: The layers of a Flow State app, what happens to one message as it goes down through them, where each thing is kept, and which page teaches each layer.
---

import Figure from "@site/src/components/Figure";
import OneMessage from "./figures/one-message.svg";
import WhereThingsAreKept from "./figures/where-things-are-kept.svg";

# How it fits together

Flow State is a backend for AI apps, built in layers. Your React page talks to a server, the server runs flows, and a flow does its work in blocks, small typed units of work. Each layer has one job and its own file.

This page shows the layers, what one request passes through on its way down and back, where each thing is kept, and which page teaches each layer.

<Figure svg={OneMessage} caption="One message, top to bottom" description={"Four boxes stacked top to bottom with arrows between them. Your page, in the browser, calls session.sendAction with the action chat. The engine, on your server, checks the input and whose session it is; inside it sits the session, hatched because it outlives the request. The flow, help-desk, names its actions. The blocks, chatGenerator and incrementMessageCount, sit inside a dashed box because one run of the action lasts only as long as that run. A downward arrow between each pair of boxes is the call, and an upward arrow is the reply streaming back as items."} />

## An app, from the top

An app is a folder in your repo. Its pages are React. Behind them is one file that says what the app is made of:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { workforce } from "@flow-state-dev/workforce";
import helpDeskFlow from "./src/flows/help-desk/flow";

export default createFlowState({
  kits: [workforce({ directory: "./workforce" })],
  flows: [helpDeskFlow],
  stores: sqliteStores({ filename: "./app.db" }),
});
```

`createFlowState` builds the engine, the part that serves your flows, streams their results and stores what they keep. It takes your flows, your kits and your stores.

`flows` are the backends you write. A flow names its actions, the entry points a page can run, and declares the state it keeps and what the browser may see of it. `helpDeskFlow` is what `src/flows/help-desk/flow.ts` default-exports, and it has one action, `chat`. Its work is done by blocks, typed units of work: a model call, a function, or a chain of them.

`kits` are features you install. A kit is a feature packaged so an app adds it with one entry. It brings its own flows and the folder it reads from your repo, and it can leave openings, called slots, for other kits to fill. `workforce` reads the team of workers in `workforce/`.

`stores` is where data is kept. With none set, it is kept in memory and a restart empties it.

## What happens when you send a message

Say a user sends a message to the help-desk flow. One call from the page does it:

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

`useFlow` picks or creates the user's session, one conversation. It needs the flow's kind to create one, which is why `flowKind` is set. The session id arrives a moment after the page loads, so the button stays disabled until `flow.activeSessionId` is set: `sendAction` throws without one. `useSession` is the page's handle on the session, and it needs the flow kind too, and `sendAction` runs an action on it. `session.items` is the live list of items, the pieces a flow streams out, so rendering it shows the reply as it arrives.

From there the message makes these stops:

1. The page posts to the action's route on the engine.
2. The engine checks the message against the action's input schema and checks the session belongs to the caller. The [HTTP reference](../reference/http-api.md) lists the order and the errors.
3. The flow runs the action's block. In `help-desk` it is a sequencer, a block that runs blocks in order: `chatGenerator` calls the model, then `incrementMessageCount` updates the session's state.
4. Each block emits items as it works. They arrive on the page as the model writes.
5. State changes are saved as the blocks make them. When the run completes, the page gets the session's new state, called the snapshot.

A dropped connection can pick the stream back up; [Items and the stream](../reference/items.md) says how.

A second user who sends to someone else's session id is answered as if that session did not exist, before any block runs. Even the owner's page sees only the session-state fields the flow lists as exposed, not the whole state.

## Where things are kept

<Figure svg={WhereThingsAreKept} caption="Where things are kept" description={"Four columns. In your repo: fsdev.config.ts, flow.ts, the blocks folder and WORKER.md. In the process: the FlowState handle. In your store, hatched because it outlives the request: the session, highlighted as the idea to keep, then session state, items, and request state drawn with a dashed outline because it belongs to one request only. In the browser: the live item list, the snapshot, unsent text kept in localStorage, and the last view answer, which the page holds only while the screen is open. A note says that with no stores set, the store column is held in the process and a restart empties it."} />

Code is in your repo, and so are `WORKER.md` files. The app reads a kit's folder, such as `workforce/`, when it starts. What `createFlowState` returns lives in the process.

The session is in the store. So are its state and its items, including the output each block recorded. Request state, the scratch space of one action run, is kept there too, with its request. No other request sees it. All of that outlives the request, and on a store that persists it outlives a restart. With no `stores` set, the store is memory: a restart empties it, the session included, and startup says so.

The browser holds what it last received: the live item list and the snapshot. Unsent text in a message box is kept in `localStorage`, so a reload keeps it. A view is a read-only question a screen asks the server, such as the list of a user's open orders. Its answer is computed on each read and saved nowhere; the page keeps the last one in memory while the screen is open. [Views](../reference/views.md) says when it is read again.

When a user edits a standard worker, their first edit makes their own copy under the same id. The `WORKER.md` in your repo does not change, and other users keep the standard one. [Workers](./workers.md) covers the rest.

## Which page to read for what

When a worker answers wrong, open its `WORKER.md` first. The body is its instructions and the frontmatter is its configuration. A worker whose file names no `flow:` runs on the built-in `agent` flow with that body as instructions. If the file looks right, or names a flow, open that flow next, then the blocks inside it.

To see which block produced the text, run the action from the terminal:

```bash
fsdev run help-desk chat -i '{"message":"Where is my order?"}'
```

It prints a line for each item a block adds, each stretch of streamed text and each state change. `--log-level debug` adds the events from blocks nested inside sequencers and routers.

| Layer | What it is | Read |
| --- | --- | --- |
| Kit | A feature an app installs with one entry | [Kits and slots](./kits-and-slots.md) |
| Flow | A backend with actions, state and what the browser sees | [Flows and actions](./flows-and-actions.md) |
| Block | A typed unit of work, one of five types | [Blocks](./blocks.md) |
| Session | One conversation, and the items it collects | [Sessions, items and streaming](./sessions-items-and-streaming.md) |
| State | What a session, a user or an organization keeps | [State and scopes](./state-and-scopes.md) |
| View | A read-only question a screen asks the server, answered fresh each time | [Views](./views.md) |

## Next

- [Flows and actions](./flows-and-actions.md): how a flow names its actions and what runs when one is called.
- [Blocks](./blocks.md): the five kinds of block and how they nest.
- [Kits and slots](./kits-and-slots.md): installing a feature, and how kits build on each other.
- [Glossary](../reference/glossary.md): every word on this page, in one line each.
