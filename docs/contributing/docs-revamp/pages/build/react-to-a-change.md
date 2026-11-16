---
title: Run a block when a resource changes
type: recipe
description: "Bind a block to a resource so it runs whenever a note is pinned or its body is written, without every writer remembering to call it."
---

# Run a block when a resource changes

When a support note is pinned, the supervisor should hear about it. When a note's body is rewritten, its word count should follow. You can do both in the block that writes the note, but then every block that writes a note has to remember.

A reactive block moves that work to the resource. You bind an ordinary block (a handler, a generator or a sequencer) to a change on a [collection](../concepts/resources.md), and the framework runs it whenever a block in a turn makes that change. It runs as part of the same turn. Items it emits land in the turn's stream after the writer's own, and it appears in the trace as a child of the block that made the change.

The example is the `ticketNotes` collection from the [resources page](../concepts/resources.md), with a `wordCount` field added to its state.

## 1. Write the reaction

The reaction receives a change object: the note's `key`, its new `state` and its `prevState`. `resourceChangeSchema` types that input from your state schema. Keep the schema in its own file, because the collection file will import the reaction and the reaction must not import the collection.

```ts title="src/flows/support/resources/note-state.ts"
import { z } from "zod";

export const noteState = z.object({
  author: z.string(),
  pinned: z.boolean().default(false),
  wordCount: z.number().default(0),
});

export type NoteState = z.infer<typeof noteState>;
```

```ts title="src/flows/support/blocks/announce-pinned.ts"
import { handler, resourceChangeSchema } from "@flow-state-dev/core";
import { noteState } from "../resources/note-state";

export const announcePinned = handler({
  name: "announce-pinned",
  inputSchema: resourceChangeSchema(noteState),
  execute: async (change, ctx) => {
    ctx.emit.message(`Note ${change.key} by ${change.state?.author} was pinned.`);
  },
});
```

## 2. Bind it, and gate it

`reactTo` maps a kind of change to a block. `stateUpdated` fires when a note's state changes. Write the entry as `{ block, when }` to run the block only for some changes: `when` receives the same change and returns a boolean.

```ts title="src/flows/support/resources/ticket-notes.ts"
import { defineResourceCollection } from "@flow-state-dev/core";
import { announcePinned } from "../blocks/announce-pinned";
import { noteState } from "./note-state";

export const ticketNotes = defineResourceCollection({
  pattern: "ticketNotes/**",
  scope: "session",
  stateSchema: noteState,
  reactTo: {
    stateUpdated: {
      block: announcePinned,
      when: (change) => change.state?.pinned === true && change.prevState?.pinned !== true,
    },
  },
});
```

With that in place, `patchState({ pinned: true })` on a note, from any block, emits the message. A write that leaves the state equal to what is stored is a no-op and starts nothing.

The other kinds are `created`, `deleted` and `contentUpdated`. A single resource, not a collection, takes only `stateUpdated` and `contentUpdated`. The [resources reference](../reference/resources.md) lists each kind, the change fields and which kinds `when` applies to.

## 3. React to the body

State and content are separate: `patchState` fires `stateUpdated` only, and `writeContent` fires `contentUpdated` only. A content reaction receives only `key`, `ref` and `kind`. The change does not carry the body, so the block reads it back. That read returns the new text.

The block reaches the collection through `ctx.resources.notes`, the name the `addNote` block gives it in its `resources` map (see the [resources page](../concepts/resources.md)). Including `addNote` in the flow installs the collection under that name, and every block in the turn reads the same `ctx.resources`, so the name resolves in the reaction too. The reaction does not declare the collection itself, because then the collection and its own reaction would import each other. Without a declaration, `ctx.resources.notes` has no type, so the example casts it to `ResourceCollectionRef<NoteState>`.

```ts title="src/flows/support/blocks/count-note-words.ts"
import { handler, resourceContentChangeSchema } from "@flow-state-dev/core";
import type { ResourceCollectionRef } from "@flow-state-dev/core";
import type { NoteState } from "../resources/note-state";

export const countNoteWords = handler({
  name: "count-note-words",
  inputSchema: resourceContentChangeSchema(),
  execute: async (change, ctx) => {
    const notes = ctx.resources.notes as unknown as ResourceCollectionRef<NoteState>;
    const note = await notes.getOptional(change.key);
    if (!note) return;
    const body = (await note.readContent()) ?? "";
    await note.patchState({ wordCount: body.split(/\s+/).filter(Boolean).length });
  },
});
```

In `ticket-notes.ts`, import `countNoteWords` and add `contentUpdated: countNoteWords` beside `stateUpdated`. Saving `wordCount` with `patchState` fires `stateUpdated`, so it does not trigger this reaction again.

## 4. Decide whether the writer waits

A reaction blocks by default. `writeContent` does not return until `countNoteWords` has finished, and a slow reaction slows the writer. If the reaction throws, the call that made the change rejects with the reaction's error and the write stays stored. Uncaught, that fails the turn.

For a side effect the write does not depend on, bind a sequencer that ends in `.sideChain()`. The writer returns at once, the reaction runs in the background, and the turn finishes only after it is done. A throw there fails neither the write nor the turn.

```ts title="src/flows/support/blocks/count-in-background.ts"
import { sequencer, resourceContentChangeSchema } from "@flow-state-dev/core";
import { countNoteWords } from "./count-note-words";

export const countInBackground = sequencer({
  name: "count-in-background",
  inputSchema: resourceContentChangeSchema(),
}).sideChain(countNoteWords);
```

Bind `countInBackground` in place of `countNoteWords`. Use a blocking reaction when the write is wrong without it. [Background work](../concepts/background-work.md) covers work that has to outlive the turn.

## Limits

- **Client writes don't trigger it.** `client.content.update` and other writes a client makes run outside a flow turn and fire no reaction.
- **It skips a block whose input does not match.** If the block's `inputSchema` does not match the change, for example a schema built from a different state, the block is skipped and an `error` item with code `reactive_input_invalid` appears. The write is unaffected.
- **It does not end a loop cleanly.** A reaction that writes the kind it reacts to needs a `when` that ends it. Without one, the chain is cut off at a fixed depth with a `reactive_cascade_exceeded` error item. The turn completes normally.

## Next

- [Resources reference](../reference/resources.md): reactive kinds per resource form, the change payloads, `when` examples and the cascade limits.
- [Items reference](../reference/items.md): the trace path a reaction runs under.
- [Find records by facets](./find-by-facets.md): a content reaction that classifies each body.
- [Resources](../concepts/resources.md): collections, scopes and the methods used above.
