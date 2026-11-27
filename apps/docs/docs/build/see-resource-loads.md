---
title: See which resources a run loaded
type: recipe
description: Open a run in the DevTool, read what a block loaded from storage and how, and find out why a resource you expected is missing.
---

# See which resources a run loaded

A resource is named, stored data that a block reads. Before a block can read one, the request has to load it from storage into memory. Whether that happens up front or on first read decides how many store round trips a request makes.

The DevTool records every load on the block that caused it, so you can see what was loaded, how, and how long it took, instead of adding logging to find out. This recipe reads those records for a support desk's `draftReply` block. The DevTool is the page in your browser that shows what your flows did; [Debug a run with the DevTool](./debug-a-run.md) covers starting it.

The example reads one note from `ticketNotes`, a collection of notes on a ticket. Make the collection lazy, so a note loads only when a block asks for it:

```ts title="src/flows/support/resources/ticket-notes.ts"
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

export const ticketNotes = defineResourceCollection({
  pattern: "ticketNotes/**",
  scope: "session",
  stateSchema: z.object({ author: z.string(), pinned: z.boolean().default(false) }),
  prefetchMode: "lazy",
});
```

`draftReply` reads the note for the ticket it is replying to:

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator } from "@flow-state-dev/core";
import { z } from "zod";
import { ticketNotes } from "../resources/ticket-notes";

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: "You answer customer support messages. Use the ticket notes you are given.",
  inputSchema: z.object({ ticketId: z.string(), message: z.string() }),
  resources: { ticketNotes },
  user: async (input, ctx) => {
    const note = await ctx.resources.ticketNotes.getOptional(input.ticketId);
    const notes = (await note?.readContent()) ?? "";
    return `Notes:\n${notes}\n\nCustomer message:\n${input.message}`;
  },
});
```

## 1. Open the run

Run `pnpm fsdev dev`, open the URL it prints, and run the action for ticket `T-1042`. Open the session that ran it. Choose the **Trace** tab, which lists the session's requests as trees of blocks.

Click the row of the block that declares or reads the resource, here `draft-reply`. Click the row, not the chevron. Loads that happen before any block runs are on the request's top block, the one the action runs.

## 2. Open Resource Loads

The block's detail opens in the right-hand panel. Expand **Resource Loads**. It is collapsed by default. It is not the **Resources** panel, which shows stored data, not loads.

**Declared** has one chip per resource the block declares: `ticketNotes`. **Loaded** has one row per load.

## 3. Read a load

The Loaded part shows one row:

```text
LAZY   ticketNotes/T-1042   .getOptional()   fetch   4.2ms
```

From left to right: how the resource was loaded, the key it was stored under, the call that read it, whether the read went to the store, and how long it took.

The label says how the resource loaded. An eager resource loads when the request reaches the place that declares it: the flow (**Flow eager**), the action (**Action eager**) or the block (**Block eager**). A lazy collection loads on its first read (**Lazy**). [Load modes](../reference/resources.md#load-modes) says what triggers each.

A row ending in **fetch** went to the store. A row ending in **cache hit** was served from memory the request had already loaded, and shows no duration. Repeated identical cache hits collapse into one row with a count, such as `×5`. A lazy collection fetches a key on its first read, and later reads of that key are cache hits. `list()` and `count()` fetch the whole collection in one read, so their row's key is the prefix, `ticketNotes/`.

Select the request's top block and expand **Resource Load Summary**. It totals that block and every block under it. The fields are on [Items](../reference/items.md#resource-load-records).

Load records are part of the run's trace. A client receives the trace only when it asks for it with `includeTrace`, so the items your app shows its users carry no loads. A record holds a read's key and timing, never what it returned, and reading it doesn't change the run. To see what is stored, open the **Resources** panel.

## When a resource did not load

Check these in order.

- **No Resource Loads section.** The block declares no resources and read none, or you selected a different block than the one that declares it. Otherwise trace capture is off. `FSDEV_TRACE_OBSERVABILITY` turns it on or off; when the variable isn't set, capture is on outside production. See the [environment reference](../reference/environment.md).
- **A declared chip has no row.** If the collection is lazy, no read has reached it yet. Check that the read is not behind a branch that did not run. [Load modes](../reference/resources.md#load-modes) lists the reads that load. If the read did run, the collection may be projected: it gets its data from a `read` function you wrote, not the store, so it has no load rows.
- **The block that declares the resource isn't in the trace.** It belongs to a different action, so it never ran in this request. A request loads the flow's resources and those of the action it ran. Open the request for the action you meant.
- **You see cache hits and no fetch.** A collection declared on the flow, or on a block in the action, is fetched once before any block runs. The fetch is on the top block, under **Flow eager** or **Action eager**, and every block beneath that reads it shows a cache hit. [Where a load is recorded](../reference/items.md#resource-load-records) has the rest.

## Next

- [Resources](../concepts/resources.md) covers what a resource is and who owns it.
- [Debug a run with the DevTool](./debug-a-run.md) walks a failing run from the session list to the block.
- [Resources reference](../reference/resources.md) lists `prefetchMode` and what loads when.
