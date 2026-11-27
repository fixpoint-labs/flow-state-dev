---
title: Search a collection
type: recipe
description: "Find notes in a collection by path, exact text or ranked keywords, from a flow action or from a model."
---

# Search a collection

A collection can list its notes under a prefix, which answers "everything under `ticketNotes/`". It can't answer "which note mentions a refund". Three search blocks can: one matches paths, one matches lines of text, and one ranks notes by keyword. This recipe searches the support desk's ticket notes with them, from a flow action and then from a model.

Search is lexical. It counts where your words literally appear and knows nothing about meaning or synonyms, and it reads every note on every call, so it suits a small, curated set. See [Limits](#limits). For fuzzy recall, use [memory](../catalog/memory/index.md) or a retrieval layer. For fixed questions about each record, such as its topic or status, use [facets](./find-by-facets.md).

## 1. Mark the collection readable

The tools search the body of every note in a collection that sets `llmReadable: true`. A collection that doesn't opt in is invisible to all three, glob included. State fields aren't searched: a note's `author` is found only if the body says it.

```ts title="src/flows/support/resources/ticket-notes.ts"
import { defineResourceCollection } from "@flow-state-dev/core";
import { z } from "zod";

export const ticketNotes = defineResourceCollection({
  pattern: "ticketNotes/**",
  scope: "session",
  llmReadable: true,
  stateSchema: z.object({ author: z.string(), pinned: z.boolean().default(false) }),
});
```

## 2. Query from a flow

`resourceSearchTools()` returns the three blocks. Call it once, in a file of its own.

```ts title="src/flows/support/tools/search.ts"
import { resourceSearchTools } from "@flow-state-dev/core";

export const search = resourceSearchTools();
```

Mount them as actions. Declare the collection on the flow, because the tools search only the collections the flow declares. A block that declares a collection adds it to the flow, so declaring it on a block works too.

```ts title="src/flows/support/flow.ts"
import { defineFlow } from "@flow-state-dev/core";
import { ticketNotes } from "./resources/ticket-notes";
import { search } from "./tools/search";

export default defineFlow({
  kind: "support",
  requireUser: true,
  resources: { notes: ticketNotes },
  actions: {
    findNotes: search.searchResources,
    grepNotes: search.grepResourceContent,
    globNotes: search.globResources,
  },
})();
```

Each action takes its block's input and returns a list:

```text
findNotes  { "query": "refund card", "prefix": "ticketNotes" }
           → { "results": [{ "uri": "session/ticketNotes/T-1042", "score": 3, "snippet": "Card refunded twice" }] }
grepNotes  { "pattern": "refund|chargeback" }
           → { "matches": [{ "uri": "session/ticketNotes/T-1042", "line": 2, "snippet": "Card refunded twice" }] }
globNotes  { "pattern": "ticketNotes/T-10*" }
           → { "uris": ["session/ticketNotes/T-1042"] }
```

Glob matches paths and reads no content. Grep finds the lines matching a regular expression, or a literal string when the pattern isn't valid regex. Search splits the query into words, counts how often they appear in each note, and lists the notes with the most occurrences first. A word matches inside longer words, so `use` finds "user". Notes with no match are dropped.

Every result's `uri` includes the scope. `readResourceContentTool()` accepts that uri, so a result feeds straight into a read. The [resources reference](../reference/resources.md) lists each tool's options, defaults and result shapes.

Search returns only notes from the scope the run resolves to. `ticketNotes` is session-scoped, so a search sees the current session's notes. A user-scoped collection returns that user's notes inside the current organization, and an org-scoped one returns the organization's. The caller comes from the request. The model can't pass a user id to see someone else's notes. On a [projected collection](./serve-your-own-data.md), your own `search` hook decides which rows come back.

## 3. Give search to a model

Put the blocks in a generator's `tools`. The flow in step 2 already declares `ticketNotes`, so the generator's tools search it. Declaring it on the generator as well, as below, makes the block work in any flow you add it to. A hit carries a short snippet, so add `readResourceContentTool()` for the model to read a whole note.

```ts title="src/flows/support/blocks/draft-reply.ts"
import { generator, readResourceContentTool } from "@flow-state-dev/core";
import { ticketNotes } from "../resources/ticket-notes";
import { search } from "../tools/search";
import { z } from "zod";

export const draftReply = generator({
  name: "draft-reply",
  model: "openai/gpt-6-luna",
  prompt: "Answer the customer. Search the ticket notes for earlier context before you reply.",
  inputSchema: z.object({ message: z.string() }),
  user: (input) => input.message,
  tools: [
    search.globResources,
    search.grepResourceContent,
    search.searchResources,
    readResourceContentTool(),
  ],
  resources: { notes: ticketNotes },
  // Show the reply in the chat and keep it in history.
  itemVisibility: { client: true, history: true },
});
```

If neither the flow nor any of its blocks declares the collection, the tools find nothing, and nothing errors.

## Choosing a tool

- **Glob** when you can describe the path, such as `ticketNotes/T-10*`.
- **Grep** when you need an exact string or pattern and the matching lines.
- **Search** when you have keywords and want the most relevant notes first.
- **Facets** when the question is about meaning and you can fix the questions ahead of time.

## Limits

- **Not for a large corpus.** Every call reads every readable note body, so search suits a bounded, curated set. Tens of thousands of notes is the wrong size.
- **Not for meaning.** A search for "charged twice" won't find a note that says "duplicate payment". Words must literally appear. For that, use [memory](../catalog/memory/index.md) or a retrieval layer.
- **Always current.** Each call reads the bodies at call time, so an edited note is searched by its new text on the next call. There is no index to rebuild.
- **Projected collections.** Only search reaches one, through your own `search` hook, and results come in the hook's order. Glob and grep skip it. The hook receives `userId` and `orgId` and has to scope its own query with them, or a user will see in one organization what they saved in another. See [serve your own data](./serve-your-own-data.md).

## Next

- [Resources](../concepts/resources.md): what a collection is and what `llmReadable` means.
- [Find records by facets](./find-by-facets.md): answer meaning questions at write time.
- [Resources reference](../reference/resources.md): options and result shapes for each tool, and which tools reach a projected collection.
