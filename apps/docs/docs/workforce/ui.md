---
title: Workforce components
sidebar_label: Components
sidebar_position: 9
description: Render a roster, its mailboxes and its boards with components from @flow-state-dev/react.
---

# Workforce components

`@flow-state-dev/react` ships the screens a workforce needs. Most of it is one component: a navigator that browses your flows. Beside it sit the roster and a board, drawn as columns or as a list. You import them; there is nothing to copy into your app.

```tsx
import { FlowNavigator, Roster, BoardColumns, BoardList } from "@flow-state-dev/react";

<FlowNavigator
  sections={[
    { label: "Mailboxes", kinds: ["mailbox"] },
    { label: "Seats", kinds: ["agent"] },
  ]}
  onSelectSession={setSessionId}
/>
```

`mailbox` is the kind the framework ships for mailboxes. For seats, list the kinds your seats run: `agent` is the built-in one, and a worker whose `WORKER.md` names a `flow:` runs on that kind instead. If your app declares a mailbox kind of its own, add its name to the Mailboxes list.

A section is a label and a set of kind names. The navigator reads the rest of the shape from your flows. Conversation and item rendering come from the [component registry](../ui/overview), as they do in any other app.

## How deep the navigator goes

The navigator starts at the kind. How many levels sit under it depends on how that flow was declared.

A flow with `cardinality: "collection"` has many addressable copies, so it gets **three levels**: kind, then instances, then sessions. The built-in `agent` kind works this way. Open it and you see the seats hired on it; open a seat and you see that seat's sessions.

A flow with `cardinality: "singleton"` is one instance whose address is its kind, so it gets **two levels**: kind, then sessions. A mailbox kind works this way, because a mailbox is a session on that kind. A hundred mailboxes are a hundred sessions on one instance, so opening the kind lists the mailboxes directly.

There is no prop for choosing the depth. What the navigator shows always matches the flow, so a flow that changes its cardinality changes the navigator with it.

## Showing the roster and the boards

`Roster`, `BoardColumns` and `BoardList` read collections through a session you pass in. That session's flow has to declare the collections, under the keys the components read:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { mailboxBoard, defineHiredRosterCollection } from "@flow-state-dev/workforce";

const followups = mailboxBoard("support.desk", "followups");

export const shell = defineFlow({
  kind: "shell",
  resources: {
    roster: defineHiredRosterCollection(),
    [followups.id]: followups,
  },
  actions: { /* ... */ },
});
```

```tsx
import { useMemo } from "react";
import { createResourceClient } from "@flow-state-dev/client";
import { BoardColumns, Roster } from "@flow-state-dev/react";

type ShellPanelsProps = {
  sessionId: string;
  bootProblems: readonly string[];
  // Your app's way of getting the signed-in user's token. Keep its identity
  // stable across renders, or the client is rebuilt and the panels re-read.
  getToken: () => Promise<string>;
};

export function ShellPanels({ sessionId, bootProblems, getToken }: ShellPanelsProps) {
  const fetcher = useMemo<typeof fetch>(
    () => async (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("Authorization", `Bearer ${await getToken()}`);
      return fetch(input, { ...init, headers });
    },
    [getToken],
  );
  const resourceClient = useMemo(() => createResourceClient({ fetcher }), [fetcher]);

  return (
    <>
      <Roster sessionId={sessionId} problems={bootProblems} resourceClient={resourceClient} />
      <BoardColumns sessionId={sessionId} boardRef="support.desk.followups" resourceClient={resourceClient} />
    </>
  );
}
```

Pass the same `resourceClient` to both, built once. Leave it out and each panel builds its own client with the plain browser `fetch`. That sends a same-origin cookie but no `Authorization` header, so once your [resolver](../server/authentication.md) expects a bearer token, the panels' reads get a 401.

`problems` is the list of seats your last boot could not bring back. It comes from `reloadHiredSeats` on the server, so your app has to hand it to the browser itself, for example by writing it to an organization-scoped collection the same flow declares. See [Hiring while the app runs](./durable-hire).

A board column is grouped by task status. An empty board says so, and names the usual reason: no seat drains it.

### A board as a list

`BoardList` draws the same board as one list, newest first, with each task's status beside it. Reach for it when people scan a board rather than work it, such as a queue of cases waiting for a person. It takes the same `sessionId`, `boardRef` and `resourceClient` as `BoardColumns`, plus `live` and the `fetcher` that goes with it. This example assumes a `fetcher` and a `resourceClient` built the way `ShellPanels` builds them above, once and shared:

```tsx
import { BoardList } from "@flow-state-dev/react";

<BoardList
  sessionId="support.help"
  boardRef="support.help.escalations"
  resourceClient={resourceClient}
  fetcher={fetcher}
  live
/>
```

With `live`, the list follows the session you pass and reads the board again whenever that session records a change to it. A task filed through a mailbox's `fileTask` is recorded in the mailbox's own session, so pass the mailbox's id, as above. Each new task then shows up in every tab that has the list open. Reading through the mailbox needs nothing extra in your shell's flow.

`fetcher` is the `fetch` the live stream is sent with. When you pass your own `resourceClient` and `live`, also pass the `fetcher` that client was built with, so the stream carries the same credential as the reads. TypeScript rejects `resourceClient` with `live` and no `fetcher`. Pass neither and both go through the nearest `FlowProvider`'s `baseUrl` with the plain `fetch`. If your `resourceClient` reads a different origin, pass that origin as the `baseUrl` prop on `BoardList` as well, so the stream goes to the same server as the reads.

Rows already on screen stay there while the list reads again.

A change recorded in a different session does not reach a live list until something makes it read again: a remount, a reload, or the next change in the session it follows. A seat that claims and finishes tasks from its own conversation is the usual example. So `live` suits a board that is filed through its mailbox and read by people. For a board your seats work, read it on mount, as `BoardColumns` does.

Each live list holds its own connection to its session's stream while it is mounted, the same kind [`useSession`'s `live`](../client/react.md#hearing-requests-you-didnt-send) opens. A page that also follows that session with `useSession(..., { live: true })` holds two connections to it. If the server doesn't offer the stream, or refuses it, the list reads once, as if you hadn't asked, with no error.

Each row shows the task's `title` (its `goal` if there is no title, its `id` if there is neither), its status word, and the assignee when there is one. The words are the ones the columns are headed with (`pending`, `in_progress`, and so on, with `awaiting_review` shown as `parked`). A task in a status the list doesn't recognise shows with its own word. No row is hidden. A row without a `createdAt` follows the dated ones.

Loading, an empty board and a failed read look different from each other. A failed read says what failed and offers a Retry button. The `empty` slot replaces the empty note. The `row` slot returns the body that goes inside the list's own `<li>`, which carries `data-task-id`.

## Where each component reads from

![Three columns. One session's items, read by messages, task plans and approval cards: they arrive live and are still there after a reload. An organization's collection, read by the roster, board columns and board list: everyone sees the same rows, read once on mount. Your server's flow list, read by the navigator: read once, with a leaf's sessions read only when that leaf opens. A footer says how each reads again: items keep arriving, a panel reads again when its React key changes, and the navigator's leafToolbar slot is handed a refresh function](./ui-read-sources.svg)

What a component reads decides when it updates. Messages, task plans and approval cards from the [component registry](../ui/flow-aware-components) follow one session's items as they arrive. The roster and board panels read a standing collection once, when they mount; a `BoardList` with `live` is the exception ([A board as a list](#a-board-as-a-list)). The navigator reads the flow list once, and a leaf's sessions only when that leaf opens. A leaf is a singleton kind, or one instance of a collection kind, so opening a collection kind's own row reads nothing and a roster of two hundred seats costs one request to draw.

To read again on demand, change a panel's React `key`, or use the `refresh` function the navigator's `leafToolbar` slot is handed. What that slot returns sits on the open leaf's own row, after any `rowTrailing` content.

## Styling it

The components ship with no CSS framework and no icon set. Style them with:

- **CSS custom properties** for colour, spacing and type: `--fsd-nav-*` for the navigator,
  `--fsd-panel-*` for the roster, the board columns and the board list. Set them on any ancestor.
- **Slots** for the parts that are yours. The navigator's are `rowTrailing` at the end of a row, `leafToolbar` on an open leaf's row, `leafDetail` under an open leaf's row for content that doesn't fit on it, `sectionHeader` beside a section label, and `emptySection` for a section whose kinds your server doesn't have.

The navigator draws a dashed line down from each open row, past the rows under it, and indents each level by the width of the expand arrow. `--fsd-nav-guide` sets the line colour. Set it to `transparent` to hide the lines.

```css
.sidebar {
  --fsd-nav-guide: rgba(148, 163, 184, 0.5);
}
```

A navigator row's actions, whatever its `rowTrailing` and `leafToolbar` slots return, are hidden until the row is hovered or has keyboard focus, and stay shown on the selected row. On a touch screen with no hover they're always shown. Hidden actions keep their space and stay reachable with Tab.

You can't pin an action visible. Only a session row's label is yours to set: it shows the session's title, which you set when you [create or update the session](../client/overview.md#session-management). Put a status your users need at a glance there. A session with no title shows its id, shortened when the server generated it; hover the row for the full id. Kind and instance rows always show the kind name and the instance id. For a section-wide control, use `sectionHeader`, which is always shown.

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

These components render; they don't administer. There is no create-mailbox or invite control.

The roster and the board columns are scoped to an organization, because the collections behind them are. **The navigator is not.** It shows the flow kinds your server has registered, the instances under them, and the sessions the caller can see, with no organization filter. The flow list is answered without authentication, so every caller sees every flow your app defines and every seat declared in a `WORKER.md` file.

A hired seat is listed only to callers who could open it, as [Who can reach a hired seat](./durable-hire.md#who-can-reach-a-hired-seat) describes. For a person's own hired seats to appear, the navigator's `client` has to carry their credential. In a multi-organization deployment, don't show end users a seats section that includes file-declared seats, because those are listed to everyone.

**Which organization the panels show depends on how your deployment signs people in.** A session is bound to the organization of the identity your server resolves for the request. With no sign-in configured there is one organization, and you see it. If you hire into real organizations but have not given the app a way to identify the person viewing it, the panels read the default organization and come up empty. [Authentication](../server/authentication.md#every-request-runs-in-an-organization) covers how a request gets its organization.
