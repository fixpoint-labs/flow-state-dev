---
title: Workforce components
sidebar_label: Components
sidebar_position: 9
description: Render a roster, its channels and its boards with components from the client packages.
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

`channel` is the channel kind the framework ships, and `agent` is the seat kind. A section is a label and a set of kind names and nothing else. If your app declares a channel kind of its own, add its name to the same list.

You name the kinds each section covers. You don't say anything else about the shape: the navigator reads that from your flows. Conversation and item rendering come from the component registry, as they do in any other app.

## How deep the navigator goes

The navigator starts at the kind. How many levels sit under it depends on how that flow was declared.

A flow with `cardinality: "collection"` has many addressable copies, so it gets **three levels**: kind, then instances, then sessions. The seat kind works this way. Open `agent` and you see the seats you hired; open a seat and you see that seat's sessions.

A flow with `cardinality: "singleton"` is one instance whose address is its kind, so it gets **two levels**: kind, then sessions. A channel kind works this way, because a channel is a session on that kind. A hundred channels are a hundred sessions on one instance, so opening the kind lists the channels directly.

There is no prop for choosing the depth. It always matches the flow, so a flow that changes its cardinality changes the rail with it.

## What it asks your server for

The navigator reads the flow list once, however many sections you give it.

Sessions are read only when a **leaf** opens: a singleton kind, or one instance of a collection kind. Opening a collection kind's row asks your server for nothing. A roster of two hundred seats costs one request to draw, and one more when somebody opens a seat. If the network tab shows a request per row, something is wrong.

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
<Roster sessionId={sessionId} problems={bootProblems} />
<BoardColumns sessionId={sessionId} boardRef="support.desk.followups" />
```

`problems` is the list of seats your last boot could not bring back. It comes from `reloadHiredSeats` on the server, so your app has to hand it to the browser itself, for example by writing it to an organization-scoped collection the same flow declares. See [Hiring while the app runs](./durable-hire).

A board column is grouped by task status. An empty board says so, and names the usual reason: no seat drains it.

## Styling it

The components ship with no CSS framework and no icon set. You style them two ways:

- **CSS custom properties** for colour, spacing and type: `--fsd-nav-*` for the navigator, `--fsd-panel-*` for the roster and the board columns. Set them on any ancestor.
- **Slots** for the parts that are yours, such as what a row shows beside its name, what sits in a section header, or what an empty section says.

## Two sources, and which one a component reads

A component reads one of two sources. The difference decides what it shows and when it updates.

**The session's item stream.** The turn stream, task updates and approval cards render the items a session persisted. They update as items arrive, and they are still there after a reload.

**A standing collection.** The roster and the board columns read a collection that lives outside any one session. Everyone in the organization sees the same rows. They read it when they mount and don't watch it afterwards, so a change somebody else makes appears the next time the panel mounts. To read again on demand, change the component's React `key`.

**The navigator is neither.** It reads your server's flow list, plus a session list for each leaf you open. It refreshes on the same terms as the panels: on mount, not on a watch.

## Limits

These components render; they don't administer. There is no create-channel or invite control.

The roster and the board columns are scoped to an organization, because the collections behind them are. **The navigator is not.** It shows the flow kinds your server has registered, and under them the sessions the caller can see. There is no organization filter, so a hired seat appears under its kind whichever organization it was hired for. The flow list is also answered without authentication. If organization scoping matters for your app, don't put a seats section in front of end users until your flow listing is scoped.

**Which organization the panels show depends on how your deployment signs people in.** A session is bound to the organization of the identity your server resolves for the request. With no sign-in configured there is one organization, and you see it. If you hire into real organizations but have not given the app a way to identify the person viewing it, the panels read the default organization and come up empty. Wiring that identity is the missing piece, not the panels.
