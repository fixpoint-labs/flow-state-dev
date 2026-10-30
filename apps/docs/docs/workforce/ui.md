---
title: Workforce components
sidebar_label: Components
sidebar_position: 13
description: Render a roster, its coordinators and its boards with components from @flow-state-dev/react.
---

import Figure from "@site/src/components/Figure";
import UiReadSourcesDrawing from "./ui-read-sources.svg";

# Workforce components

`@flow-state-dev/react` ships the screens a workforce needs. Most of it is one component: a navigator that browses your flows. Beside it sit the roster and a board, drawn as columns or as a list. You import them; there is nothing to copy into your app.

```tsx
import { FlowNavigator, Roster, BoardColumns, BoardList } from "@flow-state-dev/react";

<FlowNavigator
  sections={[
    { label: "Coordinators", kinds: ["coordinator"] },
    { label: "Workers", kinds: ["agent"] },
  ]}
  onSelectSession={setSessionId}
/>
```

`coordinator` is the flow a [coordinator](./coordinators.md) runs on: a worker that hands each message to other workers, called its delegates. For your other workers, list the worker flows they run: `agent` is the built-in one, and a worker whose `WORKER.md` names a `flow:` runs on that flow instead.

A section is a label and a set of kind names. The navigator reads the rest of the shape from your flows. Conversation and item rendering come from the [component registry](../ui/overview), as they do in any other app.

## How deep the navigator goes

The navigator starts at the flow kind. How many levels sit under it depends on how that flow was declared.

A flow with `cardinality: "collection"` has many addressable copies, so it gets **three levels**: flow kind, then instances, then sessions. The built-in `agent` worker flow works this way. Open it and you see the workers hired on it; open a worker and you see that worker's sessions.

A flow with `cardinality: "singleton"` is one instance whose address is its flow kind, so it gets **two levels**: flow kind, then sessions. The `coordinator` flow works this way: a hundred conversations with coordinators are a hundred sessions on one instance, so opening the flow kind lists the conversations directly.

There is no prop for choosing the depth. What the navigator shows always matches the flow, so a flow that changes its cardinality changes the navigator with it.

## Showing the roster and the boards

`Roster`, `BoardColumns` and `BoardList` read collections through a session you pass in. `Roster` reads the user's worker collection under the key `roster`, so its session's flow has to declare it there:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { defineWorkerCollection } from "@flow-state-dev/workforce";

export const shell = defineFlow({
  kind: "shell",
  resources: {
    roster: defineWorkerCollection(),
  },
  actions: { /* ... */ },
});
```

A board is read through a session whose flow keeps it, by the key that flow keeps it under. Each conversation with a coordinator keeps its tasks under `tasks`, and so does any session on the built-in worker flow or a flow built with `defineSessionBoard`; [Showing a user's boards in your app](./delegating-work.md#showing-a-users-boards-in-your-app) says which rows that read returns.

```tsx
import { useMemo } from "react";
import { createClient } from "@flow-state-dev/client";
import { BoardColumns, Roster } from "@flow-state-dev/react";

type ShellPanelsProps = {
  userId: string;
  sessionId: string;
  // A conversation with a coordinator: a session on the `coordinator` flow.
  conversationId: string;
  bootProblems: readonly string[];
  // Your app's way of getting the signed-in user's token. Keep its identity
  // stable across renders, or the client is rebuilt and the panels re-read.
  getToken: () => Promise<string>;
};

export function ShellPanels({ userId, sessionId, conversationId, bootProblems, getToken }: ShellPanelsProps) {
  const fetcher = useMemo<typeof fetch>(
    () => async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${await getToken()}`);
      return fetch(input, { ...init, headers });
    },
    [getToken],
  );
  const client = useMemo(() => createClient({ userId, baseUrl: "", fetcher }), [userId, fetcher]);

  return (
    <>
      <Roster sessionId={sessionId} problems={bootProblems} client={client} />
      <BoardColumns sessionId={conversationId} boardRef="tasks" client={client} />
    </>
  );
}
```

Pass the same `client` to both, built once. Leave it out and each panel reads through the nearest `FlowProvider`'s user, `baseUrl` and `fetcher`; with no `fetcher` there, that's the plain browser `fetch`. That sends a same-origin cookie but no `Authorization` header, so once your [resolver](../server/authentication.md) expects a bearer token, the panels' reads get a 401.

`problems` is an optional list of workers your app wants flagged, such as ones it couldn't start, which your app hands to the browser itself. Workforce writes none: a standard worker that can't run stops `hireWorkforce` at startup, and a user's own worker that stops resolving refuses its next turn, naming why.

A board column is grouped by task status. An empty board says so, and names the usual reason: no worker drains it.

### A board as a list

`BoardList` draws the same board as one list, newest first, with each task's status beside it. Reach for it when people scan a board rather than work it, such as a queue of cases waiting for a user. It takes the same `sessionId`, `boardRef` and `client` as `BoardColumns`, plus `live`. This example assumes a `client` built the way `ShellPanels` builds it above, once and shared:

```tsx
import { BoardList } from "@flow-state-dev/react";

<BoardList
  sessionId={conversationId}
  boardRef="tasks"
  client={client}
  live
/>
```

With `live`, the list follows the session you pass and reads the board again whenever that session records a change to it. A task filed in a conversation is recorded in that conversation's session, so pass the conversation's id, as above. Each new task then shows up in every tab that has the list open.

The reads and the live stream both go through `client`, so the stream carries the same credential to the same server as the reads. A client that can only read (it has `resources.listCollectionItems` but no `sessions.stream`) can't take `live`, and TypeScript rejects that pair.

Rows already on screen stay there while the list reads again.

A change recorded in a different session does not reach a live list until something makes it read again: a remount, a reload, or the next change in the session it follows. A delegate working a task in its own task session is the usual example. So `live` suits watching tasks arrive as they're filed. To see where the work has got to, read the board on mount, as `BoardColumns` does.

Each live list holds its own connection to its session's stream while it is mounted, the same kind [`useSession`'s `live`](../client/react.md#hearing-requests-you-didnt-send) opens. A page that also follows that session with `useSession(..., { live: true })` holds two connections to it. If the server doesn't offer the stream, or refuses it, the list reads once, as if you hadn't asked, with no error.

Each row shows the task's `title` (its `goal` if there is no title, its `id` if there is neither), its status word, and the assignee when there is one. The words are the ones the columns are headed with (`pending`, `in_progress`, and so on). A task in a status the list doesn't recognise shows with its own word. No row is hidden. A row without a `createdAt` follows the dated ones.

Loading, an empty board and a failed read look different from each other. A failed read says what failed and offers a Retry button. The `empty` slot replaces the empty note. The `row` slot returns the body that goes inside the list's own `<li>`, which carries `data-task-id`.

## Messages between workers

No component draws the [messages your workers send each other](./messaging-workers.md). Read the user's message log as a collection, `WORKER_MESSAGES_RESOURCE`, through any of their worker sessions, and render the rows yourself; [Showing messages in your app](./messaging-workers.md#showing-messages-in-your-app) has the read and the row shape. In a conversation, a sent message is a `tool_output` item for the tool named `SEND_MESSAGE_TOOL` (`"sendMessage"`). Match on it to draw a sent message as a line of its own rather than a tool call. A received message is a `component` item whose component is `RECEIVED_MESSAGE_COMPONENT` (`"workforce:received"`), with `data` of `{ id, from, text, inReplyTo?, budget, replyRequested?, noAnswer? }`, where `replyRequested` is `true` when the sender [asked for a reply](./messaging-workers.md#asking-for-a-reply). Both names come from `@flow-state-dev/workforce/browser`.

## Where each component reads from

<Figure svg={UiReadSourcesDrawing} caption="Three places a component reads" description={"Three columns. One session's items, read by messages, task plans and approval cards: they arrive live and are still there after a reload. An organization's collection, read by the roster, board columns and board list: everyone sees the same rows, read once on mount. Your server's flow list, read by the navigator: read once, with a leaf's sessions read only when that leaf opens. A footer says how each reads again: items keep arriving, a panel reads again when its React key changes, and the navigator's leafToolbar slot is handed a refresh function"} />

What a component reads decides when it updates. Messages, task plans and approval cards from the [component registry](../ui/flow-aware-components) follow one session's items as they arrive. The roster and board panels read a standing collection once, when they mount; a `BoardList` with `live` is the exception ([A board as a list](#a-board-as-a-list)). The navigator reads the flow list once, and a leaf's sessions only when that leaf opens. A leaf is a singleton flow kind, or one instance of a collection flow kind, so opening a collection flow kind's own row reads nothing and a roster of two hundred workers costs one request to draw.

To read again on demand, change a panel's React `key`, or use the `refresh` function the navigator's `leafToolbar` slot is handed. What that slot returns sits on the open leaf's own row, after any `rowTrailing` content.

## Styling it

The components ship with no CSS framework and no icon set. Style them with:

- **CSS custom properties** for colour, spacing and type: `--fsd-nav-*` for the navigator,
  `--fsd-panel-*` for the roster, the board columns and the board list. Set them on any ancestor.
- **Slots** for the parts that are yours. The navigator's are `rowTrailing` at the end of a row, `leafToolbar` on an open leaf's row, `leafDetail` under an open leaf's row for content that doesn't fit on it, `sectionHeader` beside a section label, and `emptySection` for a section whose flow kinds your server doesn't have.

The navigator draws a dashed line down from each open row, past the rows under it, and indents each level by the width of the expand arrow. `--fsd-nav-guide` sets the line colour. Set it to `transparent` to hide the lines.

```css
.sidebar {
  --fsd-nav-guide: rgba(148, 163, 184, 0.5);
}
```

A navigator row's actions, whatever its `rowTrailing` and `leafToolbar` slots return, are hidden until the row is hovered or has keyboard focus, and stay shown on the selected row. On a touch screen with no hover they're always shown. Hidden actions keep their space and stay reachable with Tab.

You can't pin an action visible. Only a session row's label is yours to set: it shows the session's title, which you set when you [create or update the session](../client/overview.md#session-management). Put a status your users need at a glance there. A session with no title shows its id, shortened when the server generated it; hover the row for the full id. Flow kind and instance rows always show the flow kind and the instance id. For a section-wide control, use `sectionHeader`, which is always shown.

### One set of tokens for everything on screen

If your app also renders the `@flow-state-dev/ui` components (messages, tool calls, approval cards), you don't need a second theme for the navigator and panels. Define your colours once as the semantic tokens those components read, then point the navigator's and panels' properties at the same tokens:

```css
.app-shell {
  --fsd-nav-fg: var(--foreground);
  --fsd-nav-muted-fg: var(--muted-foreground);
  --fsd-nav-selected-bg: var(--accent);
  --fsd-nav-selected-fg: var(--accent-foreground);
  --fsd-nav-guide: var(--border);
  --fsd-panel-fg: var(--foreground);
  --fsd-panel-muted-fg: var(--muted-foreground);
}
```

Change a token and every component follows. Nothing here needs a class override or an edit to a component you copied in; if a component ignores a token, that's a bug in the component. The `@flow-state-dev/ui` [colours and theming](../ui/overview.md#colours-and-theming) section lists the tokens, including the status ones.

## Limits

These components render; they don't administer. There is no create-worker or invite control.

The roster and the board columns are scoped to an organization, because the collections behind them are. **The navigator is not.** It shows the flow kinds your server has registered, the instances under them, and the sessions the caller can see, with no organization filter. The flow list is answered without authentication, so every caller sees every flow your app defines and every worker declared in a `WORKER.md` file.

A user's own workers aren't flows, so the navigator doesn't list them: read them with `createWorkforceClient(fsd).roster()`, as [Hiring and forking](./durable-hire.md#after-a-hire-refresh-the-roster) shows. In a multi-organization deployment, don't show end users a workers section that includes file-declared workers, because those are listed to everyone.

**Which organization the panels show depends on how your deployment signs people in.** A session is bound to the organization of the identity your server resolves for the request. With no sign-in configured there is one organization, and you see it. If you hire into real organizations but have not given the app a way to identify the user viewing it, the panels read the default organization and come up empty. [Authentication](../server/authentication.md#every-request-runs-in-an-organization) covers how a request gets its organization.
