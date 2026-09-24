---
title: Workforce components
sidebar_label: Components
sidebar_position: 9
description: Render a roster, its channels and its boards with components from @flow-state-dev/react.
---

# Workforce components

`@flow-state-dev/react` ships the screens a workforce needs. Most of it is one component: a navigator that browses your flows. Beside it sit the roster and a board's columns. You import them; there is nothing to copy into your app.

```tsx
import { FlowNavigator, Roster, BoardColumns } from "@flow-state-dev/react";

<FlowNavigator
  sections={[
    { label: "Channels", kinds: ["channel"] },
    { label: "Seats", kinds: ["agent"] },
  ]}
  onSelectSession={setSessionId}
/>
```

`channel` is the kind the framework ships for channels. For seats, list the kinds your seats run: `agent` is the built-in one, and a worker whose `WORKER.md` names a `flow:` runs on that kind instead. If your app declares a channel kind of its own, add its name to the Channels list.

A section is a label and a set of kind names. The navigator reads the rest of the shape from your flows. Conversation and item rendering come from the [component registry](../ui/overview), as they do in any other app.

## How deep the navigator goes

The navigator starts at the kind. How many levels sit under it depends on how that flow was declared.

A flow with `cardinality: "collection"` has many addressable copies, so it gets **three levels**: kind, then instances, then sessions. The built-in `agent` kind works this way. Open it and you see the seats hired on it; open a seat and you see that seat's sessions.

A flow with `cardinality: "singleton"` is one instance whose address is its kind, so it gets **two levels**: kind, then sessions. A channel kind works this way, because a channel is a session on that kind. A hundred channels are a hundred sessions on one instance, so opening the kind lists the channels directly.

There is no prop for choosing the depth. What the navigator shows always matches the flow, so a flow that changes its cardinality changes the navigator with it.

## What it asks your server for

The navigator reads the flow list once, however many sections you give it.

Sessions are read only when a **leaf** opens: a singleton kind, or one instance of a collection kind. Opening a collection kind's row asks your server for nothing. A roster of two hundred seats costs one request to draw, and one more when somebody opens a seat.

## Showing the roster and the boards

`Roster` and `BoardColumns` read collections through a session you pass in. That session's flow has to declare the collections, under the keys the components read:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { channelBoard, defineHiredRosterCollection } from "@flow-state-dev/workforce";

const followups = channelBoard("support.desk", "followups");

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
  const resourceClient = useMemo(
    () =>
      createResourceClient({
        fetcher: async (input, init) => {
          const headers = new Headers(init?.headers);
          headers.set("Authorization", `Bearer ${await getToken()}`);
          return fetch(input, { ...init, headers });
        },
      }),
    [getToken],
  );

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

## Styling it

The components ship with no CSS framework and no icon set. Style them with:

- **CSS custom properties** for colour, spacing and type: `--fsd-nav-*` for the navigator,
  `--fsd-panel-*` for the roster and the board columns. Set them on any ancestor.
- **Slots** for the parts that are yours, such as what a row shows beside its name, what sits in a section header, or what an empty section says.

The navigator draws a dashed line down from each open row, past the rows under it, and indents each level by one column. `--fsd-nav-guide` sets the line colour. Set it to `transparent` to hide the lines.

```css
.sidebar {
  --fsd-nav-guide: rgba(148, 163, 184, 0.5);
}
```

A navigator row's actions, whatever its `rowTrailing` and `leafToolbar` slots return, are hidden until the row is hovered or has keyboard focus, and stay shown on the selected row. On a touch screen with no hover they're always shown. Hidden actions keep their space and stay reachable with Tab.

You can't pin an action visible, so anything that must always show goes in the row's label. On a session row the label is the session's title, which you set when you [create or update the session](../client/overview.md#session-management). A session with no title shows a shortened id; hover it for the full id. For a control that belongs to a whole section, use the `sectionHeader` slot, which is always shown.

## Where each component reads from

What a component reads decides what it shows and when it updates.

**The session's item stream.** Messages, task plans and approval cards from the [component registry](../ui/flow-aware-components) draw on the items a session persisted. They update as items arrive, and they are still there after a reload.

**A standing collection.** The roster and the board columns read a collection that lives outside any one session. Everyone in the organization sees the same rows. They read it when they mount and don't watch it afterwards, so a change somebody else makes appears the next time the panel mounts. To read again on demand, change the component's React `key`.

**The flow list.** The navigator reads your server's flow list, plus a session list for each leaf you open. Like the panels, it reads on mount and doesn't watch. To re-read a leaf's sessions on demand, use the `leafToolbar` slot. It's handed a `refresh` function, and what it returns sits on the open leaf's own row, after any `rowTrailing` content.

## Limits

These components render; they don't administer. There is no create-channel or invite control.

The roster and the board columns are scoped to an organization, because the collections behind them are. **The navigator is not.** It shows the flow kinds your server has registered, and under them the sessions the caller can see. There is no organization filter, so a hired seat appears under its kind whichever organization it was hired for. The flow list is also answered without authentication. Don't show a seats section to end users in a multi-organization deployment, because the flow list isn't organization-scoped.

**Which organization the panels show depends on how your deployment signs people in.** A session is bound to the organization of the identity your server resolves for the request. With no sign-in configured there is one organization, and you see it. If you hire into real organizations but have not given the app a way to identify the person viewing it, the panels read the default organization and come up empty. [Authentication](../server/authentication.md#every-request-runs-in-an-organization) covers how a request gets its organization.
