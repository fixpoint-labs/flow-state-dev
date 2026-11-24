---
title: Workforce screens
type: catalog
description: The views and React components that put a user's workers, a conversation's tasks and a board of every task on a page.
---

import Figure from "@site/src/components/Figure";
import WhichView from "./figures/which-view-feeds-which-part.svg";

# Workforce screens

A workforce app needs somewhere to be seen. A user wants the list of workers they have hired, the tasks one conversation has handed out, and a board of every task in flight.

Workforce supplies the reads that answer those, and a few React components that draw some of the answers. The roster and a conversation's task list are **views**, questions the server answers and keeps current, read with `useView` ([Views](../../concepts/views.md) covers how they work). The board components read the board's collection and redraw when it changes. A screen stores nothing, and you can swap any shipped component for your own markup.

## What you get

- **`rosterView`**, the user's hired workers and the app's standard workers, each listed once.
- **A task list for any conversation**, from `taskListViewRef`.
- **`BoardColumns` and `BoardList`**, which draw a board of every conversation, by status or as one list.
- **`FlowNavigator`**, from `@flow-state-dev/react`, which lists sessions and marks the ones waiting on the user.
- **`createWorkforceClient` and `useSessionFeed`**, for a chat screen of your own over one worker.

Every read returns the signed-in user's rows, never another user's. If Alice at your company hires a `refund-checker`, it is in her roster and not in Bob's.

<Figure svg={WhichView} caption="Which view feeds which part of the screen" description={"Four pairs, each a region of the screen on the left with an arrow labelled reads running to the stored data behind it on the right. The roster rail, useView(rosterView), reads hired workers plus the standard workers from WORKER.md files. The session list, FlowNavigator, reads the user's sessions with each latest request status. This conversation's tasks, useView(taskListViewRef(...)), reads one conversation's tasks from the tasks ledger. All tasks, a BoardColumns with boardRef tasks, reads every conversation's tasks from the same ledger. Each data box is hatched, which marks it as stored and outliving the request."} />

## Install it

```bash
pnpm add @flow-state-dev/workforce @flow-state-dev/orchestration
```

The views exist once the workforce kit is installed, and nothing is configured for the screens themselves. The components need React 18 or 19 and `@flow-state-dev/react`. Import components from `@flow-state-dev/workforce/react`, and `rosterView` from `@flow-state-dev/workforce/browser`, the entry that is safe in a browser bundle. A screen reads through the nearest `FlowProvider`'s client.

## Use it

### The roster

`rosterView` is the view that lists a user's workers. It takes no input and no session.

```tsx title="src/app/roster/roster-list.tsx"
"use client";
import { useView } from "@flow-state-dev/react";
import { rosterView } from "@flow-state-dev/workforce/browser";

export function RosterList() {
  const { value, stale } = useView(rosterView);
  if (value === undefined) return <p>Loading the roster…</p>;
  return (
    <ul aria-busy={stale}>
      {value.map((worker) => (
        <li key={worker.id}>
          {worker.name ?? worker.id} on {worker.flow}
        </li>
      ))}
    </ul>
  );
}
```

The app's standard workers, the ones defined by `WORKER.md` files in the repo, are listed for every user. A standard worker Bob has edited is listed once, as his copy, marked `standard: true` and `edited: true`. Alice sees the original.

The list redraws when a worker is hired, edited, forked or fired, from any tab or from a worker's own turn. What `value` and `stale` hold, and what a roster entry carries, is in the [Reference](../../reference/ui-components.md).

### A conversation

A conversation with a coordinator, a worker that hands tasks to other workers, keeps its own board of the tasks it filed. Its task list is a view too, addressed by the coordinator's flow and the board's id, and read on that conversation's session.

```tsx title="src/app/chat/conversation-tasks.tsx"
"use client";
import { useView } from "@flow-state-dev/react";
import { taskListViewRef } from "@flow-state-dev/orchestration/inbox";

const tasksView = taskListViewRef("coordinator", "tasks");

export function ConversationTasks({ sessionId }: { sessionId: string }) {
  const { value } = useView(tasksView, {}, { sessionId });
  return (
    <ul>
      {(value ?? []).map((task) => (
        <li key={task.id}>
          {task.title ?? task.goal}: {task.status}
          {task.holds?.some((hold) => hold.actor === "user") ? " (waiting on you)" : ""}
        </li>
      ))}
    </ul>
  );
}
```

A task waiting on a user keeps its status and gains a `holds` entry, which is where a screen finds a worker that is waiting. The list redraws whenever a task on that board changes. Task statuses, holds and `delegateAnswerOf`, which picks a delegate's answer out of the conversation's messages, are in the [Reference](../../reference/ui-components.md).

### A chat with a worker

A chat screen of your own needs two pieces. `createWorkforceClient`, from `@flow-state-dev/workforce/browser`, makes the calls: open a session, send, stop, retry. `useSessionFeed`, from `@flow-state-dev/react`, follows one session live. The workforce client finds the worker's flow from the roster and the session, so its calls name only the worker and the session.

Here a user chats with `support.help`, the coordinator from [Coordinators](./coordinators.md).

```ts title="src/lib/help-chat.ts"
import type { WorkforceClient } from "@flow-state-dev/workforce/browser";

export async function openHelpChat(workforce: WorkforceClient) {
  const session = await workforce.startSession("support.help");
  return session.id;
}

export async function sendWithFiles(workforce: WorkforceClient, sessionId: string, message: string, files: File[]) {
  const attachments = await Promise.all(
    files.map((file) => workforce.upload("support.help", { data: file, mediaType: file.type, filename: file.name })),
  );
  return workforce.send(sessionId, message, { attachments });
}
```

`startSession` opens a new conversation beside the user's others, each time it is called. Give it `{ fields }` to write the app's session fields as it opens; a field the server refuses rejects the call, naming it. `upload` sends one file through the worker's flow and returns the reference `attachments` takes, so a first line can carry files before any session exists. `send` resolves to `{ requestId }` as soon as the server takes the line, before the turn ends.

```tsx title="src/app/chat/help-chat.tsx"
"use client";
import { useMemo, useState } from "react";
import type { Client } from "@flow-state-dev/client";
import { useSessionFeed } from "@flow-state-dev/react";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import { sendWithFiles } from "../../lib/help-chat";

export function HelpChat({ fsd, sessionId }: { fsd: Client; sessionId: string }) {
  const workforce = useMemo(() => createWorkforceClient(fsd), [fsd]);
  const feed = useSessionFeed(sessionId, { client: fsd, itemTypes: ["message"] });
  const [draft, setDraft] = useState("");

  if (feed?.items === undefined) return <p>Loading the conversation…</p>;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void sendWithFiles(workforce, sessionId, draft, []);
        setDraft("");
      }}
    >
      <ul aria-busy={feed.state !== "live"}>
        {feed.items.map((item) => (
          <li key={item.id}>
            {item.type === "message"
              ? item.content.map((part) => (part.type === "output_text" ? part.text : "")).join("")
              : null}
          </li>
        ))}
      </ul>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit">Send</button>
      <button type="button" onClick={() => void workforce.stopTurns(sessionId)}>
        Stop
      </button>
    </form>
  );
}
```

`items` is `undefined` until the session's history has loaded, and `[]` for a session with nothing in it, so the screen can tell "loading" from "empty". `state` says how far the feed can be trusted: `connecting`, `live`, `reconnecting`, `lapsed` or `stopped`. Keep one workforce client per screen, as the `useMemo` does: Stop knows which lines this client sent. The form sends through `sendWithFiles`, the helper above, with no files; a screen with a file picker passes the chosen ones.

To show an answer as it is written, send with `{ stream: true }`. The call resolves to the streamed `Response`, and `feed.followResponse(response)` draws it. For a long conversation, `hasEarlier` and `loadEarlier()` page back through older items.

#### Stopping and retrying

| Call | What it does |
| --- | --- |
| `stopTurns(sessionId)` | Stops every turn running when it reads them, and resolves to the ids it stopped. A line this client sends after pressing Stop runs on. A turn another tab starts after that read may run; press Stop again. |
| `stopRun(sessionId, requestId)` | Stops one run, by the id `send` returned. A run that already ended is no failure. If an answer resumed the run before the stop reached it, the call rejects: stop it again. |
| `retryTurn(sessionId, requestId)` | Runs that turn again. |

#### Changing delegates

A coordinator's conversation keeps its own list of delegates. `addDelegate(sessionId, worker, note?)` and `removeDelegate(sessionId, worker)` change it. A worker that is not on the user's roster, takes no tasks or is already listed is refused with the coordinator's reason, and nothing changes. The list is a view, so a screen watches it:

```tsx title="src/app/chat/help-delegates.tsx"
"use client";
import { useView } from "@flow-state-dev/react";
import { delegatesViewRef, type WorkforceClient } from "@flow-state-dev/workforce/browser";

const delegatesView = delegatesViewRef("coordinator");

export function HelpDelegates({ workforce, sessionId }: { workforce: WorkforceClient; sessionId: string }) {
  const { value } = useView(delegatesView, {}, { sessionId });
  return (
    <div>
      <ul>
        {(value?.delegates ?? []).map((delegate) => (
          <li key={`${delegate.worker}:${delegate.target ?? ""}`}>
            {delegate.worker}: {delegate.description ?? "no description"}
            <button onClick={() => void workforce.removeDelegate(sessionId, delegate.worker)}>Remove</button>
          </li>
        ))}
      </ul>
      <button onClick={() => void workforce.addDelegate(sessionId, "support.billing", "Invoices and refunds")}>
        Add billing
      </button>
    </div>
  );
}
```

The list redraws on every change, including one the coordinator makes with its own tools. Reading it changes nothing in the conversation.

### A board

`BoardColumns` groups tasks into one column per status, in the order pending, in_progress, held, completed, errored, cancelled. A status it does not know gets a column of its own, and no task is dropped. `BoardList` draws the same tasks as one list, newest first.

```tsx title="src/app/tasks/all-tasks.tsx"
"use client";
import { BoardColumns } from "@flow-state-dev/workforce/react";

export function AllTasks({ sessionId }: { sessionId: string }) {
  return <BoardColumns sessionId={sessionId} boardRef="tasks" live />;
}
```

Both components show a loading note, and a failed read with a Retry button. A board with no tasks reads differently on each. `BoardColumns` says that boards are wired to a worker explicitly, so the likely reason is that nothing drains this one yet. `BoardList` only says "This board has no tasks."

Each component's props, what a card shows and where a waiting worker shows up on each screen are in the [Reference](../../reference/ui-components.md).

## Slots and views

The screens open no slot and fill none. They read views and collections that Workforce already serves, and the Reference says which flow serves each.

## Change it

The shipped components are optional: `useView` returns plain data, as the roster and conversation examples show. To keep a component and change what a card holds, give `BoardColumns` a `slots.card`. It returns the body of a card, and the component keeps the list item around it:

```tsx title="src/app/tasks/plain-tasks.tsx"
"use client";
import { BoardColumns } from "@flow-state-dev/workforce/react";

export function PlainTasks({ sessionId }: { sessionId: string }) {
  return (
    <BoardColumns
      sessionId={sessionId}
      boardRef="tasks"
      live
      slots={{ card: ({ card }) => <strong>{card.title ?? card.goal ?? card.id}</strong> }}
    />
  );
}
```

Colours and spacing, and `groupIntoColumns` for your own columns, are in the [Reference](../../reference/ui-components.md).

## Next

- [Coordinators](./coordinators.md), for the flow whose conversations the task list reads.
- [Delegating work](./delegating-work.md), for how a task is filed and what its holds mean.
- [Messaging between workers](./messaging.md), for the messages workers send each other, which no screen here draws.
- [Views](../../concepts/views.md), for how a screen stays current.
- [UI components reference](../../reference/ui-components.md), for every prop, slot and token.
