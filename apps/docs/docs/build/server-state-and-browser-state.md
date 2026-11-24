---
title: Compare server state with what the browser sees
type: recipe
description: Open a resource's stored state and the version the browser receives side by side in the DevTool, find the field that goes missing, and change the resource's client config to expose it.
---

# Compare server state with what the browser sees

Your server stores a record, and your page shows less of it. A field you can see in the database is `undefined` in the browser, and nothing errors. The browser receives only what a resource's `client` config opens, so a field missing on the page is either closed on purpose or closed by mistake.

The DevTool, the page `fsdev dev` serves for looking inside a running app, shows both versions of a resource next to each other. The Server tab is what is stored. The Client tab is that same state run through the resource's `client` config, which is the version a page can read. You compare the two and the gap names the cause. [What the browser sees](../concepts/what-the-browser-sees.md) covers the idea behind the config.

The example is the support desk's `ticketNotes` collection, a set of notes on a ticket, each with an `author` and a `pinned` flag. The ticket page shows who wrote each note, and the author is blank.

```ts title="src/flows/support/resources/ticket-notes.ts"
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

export const ticketNotes = defineResourceCollection({
  pattern: "ticketNotes/**",
  scope: "session",
  stateSchema: z.object({ author: z.string(), pinned: z.boolean().default(false) }),
  client: { state: { read: true }, expose: ["pinned"] },
});
```

## 1. Open both views

Start `fsdev dev`, open the DevTool on the session that wrote the note (see [Debug a run](./debug-a-run.md)), and find the **Resources** panel in the right-hand rail, under Session Context. If it reads `Debug endpoints disabled`, the [CLI reference](../reference/cli.md) says how the endpoints get turned on.

Resources are grouped by scope. Open `session scope`, then `ticketNotes`, then one note. Two tabs, `Server` and `Client`, appear when the two views differ.

The label on the right of each row summarises its `client` config, for example `client` when one is set and `no-client` when none is. The [CLI reference](../reference/cli.md) lists the labels.

## 2. Find the field

Look in the Server tab first. `author` is there, with its value, so the note stored it.

Switch to the Client tab. It shows `pinned` and no `author`. The Client tab shows what the browser would get from the note's current state, not a record of what a browser actually received.

When the field is in neither tab, no `client` setting is at fault. Either the action that writes it has not run, or the field is named in the resource's `secret` list, which the [resources reference](../reference/resources.md) covers.

Some gaps don't show in either tab. The Client tab covers every note, but a page's first load carries only the first `prefetchWindow` of them, so the panel can show 47 notes while the page's first load has only the first few. The resources reference covers `prefetchWindow`.

Neither view includes notes another user owns, and neither counts them.

State declared on the flow itself, rather than as a resource, has no Server tab. Session Context shows only the fields the flow's `client.expose` lists, so check that list in your flow definition for the missing field ([flows reference](../reference/flows.md), [State and scopes](../concepts/state-and-scopes.md)).

## 3. Check what is exposed

Match what the panel shows to a cause. The common ones:

- The Client tab lacks a field the Server tab has: `expose`, `exclude` or `data` leaves it out.
- Neither tab has the field: it is in `secret`, or never stored.
- The label reads `no-client`: the browser gets nothing from this resource.
- A collection shows `client` but has no `state.read`: the browser gets the collection but none of its items' state.
- The Client tab reads `client.data threw` over `— no client value —`: your `data` function failed on this note. The browser's whole read of the collection fails with it, not only this note. If the message says it `returned a Promise`, the function is `async`. The panel can't run it, but the browser does get its value.

The [resources reference](../reference/resources.md) lists every case, including a single resource with `client` and no projection.

Here `ticketNotes` has `state.read`, so `expose: ["pinned"]` is the cause: `expose` keeps only the fields it lists. Set one of `expose`, `exclude` or `data`, never two. The reference covers all three.

Add `author` to the list.

```ts title="src/flows/support/resources/ticket-notes.ts"
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

export const ticketNotes = defineResourceCollection({
  pattern: "ticketNotes/**",
  scope: "session",
  stateSchema: z.object({ author: z.string(), pinned: z.boolean().default(false) }),
  client: { state: { read: true }, expose: ["author", "pinned"] },
});
```

Restart `fsdev dev` (the [CLI reference](../reference/cli.md) covers `--watch`, which restarts it for you), then press the panel's refresh button. The note's Client tab shows `author` with no new run, and the tabs collapse to one tree because `expose` lists every field the note stores.

If a field must never reach the browser, leave it out of `expose` and name it in `secret`, which keeps it out of both views.

To see what a real browser receives, open its Network tab and read the response of `GET /api/flows/sessions/<id>/state`. For a collection it carries the item count and only the first `prefetchWindow` items. The [HTTP API reference](../reference/http-api.md) has the shape.

## Next

- [What the browser sees](../concepts/what-the-browser-sees.md) explains `client` config and how a page reads the result.
- [State and scopes](../concepts/state-and-scopes.md) covers the three scopes and what each one reaches.
- [Resources reference](../reference/resources.md) lists every `client` option, `secret` and `prefetchWindow`.
