---
title: Documents on disk
sidebar_position: 9
sidebar_label: Documents on disk
description: "Write a team's shared documents as Markdown files, read the tree at startup, and install them as resources on a flow."
---

# Documents on disk

A handbook, a glossary, an escalation procedure: the reference material a team shares and an agent reads. You can declare each one in TypeScript with `defineResource`. You can also write it as a Markdown file and read the folder at startup, which lets someone who does not write TypeScript edit it.

`readResourcesDirectory` turns the folder tree into plain records. `resourcesFromDocs` turns those records into the resource map you pass to `defineFlow`.

Documents live in the same tree as [workers](./workers-on-disk.md) and [skills](../skills/overview.md), so one folder can describe a whole workforce.

## The tree

Two `resources/` folders are read: one for the organization, one per team.

```
workforce/
  org/
    resources/
      code-of-conduct.md
  teams/
    engineering/
      resources/
        handbook.md
    support/
      resources/
        escalation.md
```

Three documents, one shared across the organization and two belonging to a team. Every example below reads this tree.

A document is a **file**, not a folder. A worker and a skill are each a folder with a fixed file inside it; a document is `<name>.md` sitting directly in `resources/`. A directory in a `resources/` folder is reported rather than passed over, so `resources/handbook/RESOURCE.md` is an error and not a document that quietly went missing.

## What a document file says

Settings between the `---` fences, the document below them:

```md
---
description: How the engineering team works. On-call, review, escalation.
llmReadable: true
---

# Engineering handbook

Escalate anything customer-visible within 15 minutes.
```

`description` is the only key the file itself requires, and a file without one is reported when the tree is read. It reaches the resource with the rest of the frontmatter, and nothing puts it in front of a model, so write it for whoever opens the tree.

The frontmatter is the same dialect a [`WORKER.md`](./workers-on-disk.md#what-a-workermd-says) uses.

### Settings the convention derives

Where a file sits decides its identity, where it is stored, and what its content is. So a document file may not declare `scope`, `ref`, `stateSchema`, `default`, `content`, `contentFile`, `contentTemplate` or `contentTemplateRef`. Each is refused by name, with the file it was found in.

`prefetchMode: "lazy"` is refused too: a file-declared document is installed at flow level and always loaded eagerly. Writing `prefetchMode: eager` is accepted and carried through.

Everything outside that set arrives at the resource exactly as written, so `llmReadable`, `llmWritable`, `writable`, `allowedExtensions` and `metadata` all take effect from the file.

## A document's ref

A document's ref is its identity. At the organization level it is the bare file name. Under a team it is the team folder and the file name, joined with a slash:

| Path | Ref |
|------|-----|
| `<root>/org/resources/code-of-conduct.md` | `code-of-conduct` |
| `<root>/teams/engineering/resources/handbook.md` | `teams/engineering/handbook` |

The team qualifier means every team can have a `handbook` without checking what the other teams called theirs.

The ref is also the key the document is installed under, and a resource's [accessor key](/docs/resources/overview#block-level-resource-declarations) is what a block reads on `ctx.resources`:

```ts
const handbook = await ctx.resources["teams/engineering/handbook"].readContent();
```

Document and team folder names must be lowercase letters, digits, and single hyphens, at most 64 characters each. So `on-call.md` is fine. `On Call.md` and `on.call.md` are reported when the tree is read, with the rule in the message.

## Reading the tree

Point `readResourcesDirectory` at the root:

```ts
import { readResourcesDirectory } from "@flow-state-dev/workforce/loader";

const { documents, errors } = await readResourcesDirectory("./workforce");
```

You get one record per document:

```ts
interface ResourceDoc {
  ref: string;                       // "teams/engineering/handbook"
  declared: Record<string, unknown>; // the frontmatter, exactly as written
  body: string;                      // the Markdown below it, verbatim
}
```

For the handbook above:

```ts
const handbook = documents.find((doc) => doc.ref === "teams/engineering/handbook")!;

handbook.declared;
// { description: "How the engineering team works. On-call, review, escalation.",
//   llmReadable: true }
handbook.body;
// "# Engineering handbook\n\nEscalate anything customer-visible within 15 minutes.\n"
```

Reading the tree builds nothing. No resource is defined, nothing is stored, and no flow is touched. Turning records into resources is a separate call.

The subpath matters. `@flow-state-dev/workforce/loader` imports `node:fs`, so it only runs on Node. The package root, where `resourcesFromDocs` lives, stays isomorphic.

### When a file is wrong

Anything that should have produced a document and did not lands in `errors`, and the rest of the documents load anyway. Say someone wrote the marketing handbook as a folder:

```ts
errors;
// [{ kind: "folder-where-file-belongs",
//    path: "teams/marketing/resources/handbook",
//    error: Error('"handbook" is a directory. A resource is a file, not a folder — write
//                  the document as "handbook.md" in this resources/ folder instead.') }]
```

`path` is slash-separated and relative to the root you passed, so it starts at `org/` or `teams/`. `kind` names the condition, so a caller can tolerate one class and still refuse another:

| `kind` | When |
|--------|------|
| `document-load-failed` | One file did not load: a name that breaks the rules, a symlink, an unreadable file, no frontmatter, or a missing `description`. |
| `folder-where-file-belongs` | A directory sits where a document file belongs. |
| `refused-declaration` | The file declares a setting the convention derives, or `prefetchMode: "lazy"`. |
| `unreadable-slot` | A structural folder is a symlink or exists and cannot be listed: `org`, `org/resources`, `teams`, a team folder, or a team's `resources`. The documents beneath it cannot be enumerated, so the folder is reported under its own path. |

`readResourcesDirectory` throws only about the root you passed: when it cannot be read at all, and when it is a symlink. Links are never followed at any level of the walk, and the root is no exception, so a linked root is refused rather than read from wherever it points. A root with neither `org/` nor `teams/` comes back as `{ documents: [], errors: [] }`, and a team with no `resources/` folder is not an error either.

A file in a `resources/` folder that is not a `.md` is passed over in silence, as are OS and editor droppings such as `.DS_Store`.

#### Treat a non-empty `errors` as fatal

```ts
const { documents, errors } = await readResourcesDirectory("./workforce");
if (errors.length) {
  throw new Error(
    `resources: ${errors.length} document(s) failed to load\n` +
      errors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
  );
}
```

A reported file is a document your app was supposed to have. Log a warning and carry on, and the app boots without it and says nothing else about it. Fail at startup unless you have a specific reason to run without a document.

## Installing the documents

`resourcesFromDocs` turns the records into a resource map keyed by ref. Spread it into the flow's own map:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { resourcesFromDocs } from "@flow-state-dev/workforce";
import { readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { answerQuestion } from "./blocks";
import { ticketResource } from "./resources";

const { documents, errors } = await readResourcesDirectory("./workforce");
if (errors.length) throw new Error(`resources: ${errors.length} document(s) failed to load`);

export const supportFlow = defineFlow({
  kind: "support",
  actions: { answer: { block: answerQuestion } },
  resources: { ticket: ticketResource, ...resourcesFromDocs(documents) },
});
```

Every file-declared document is installed at `org` scope, with the file's body as the resource content.

Spread the map rather than passing it on its own. A flow copy created with `supportFlow({ resources })` *replaces* the definition's map instead of merging with it, so a copy handed only `resourcesFromDocs(documents)` loses whatever the flow kind declared.

`resourcesFromDocs` throws rather than collecting. A record it cannot turn into a resource stops startup, naming the ref, the same way a refused hire does.

### The request needs an org

A document is stored at org scope, so a request has to be bound to an org before a block can read one. The flow does not work that out from its resource map. It takes the requirement from its blocks, through [`requireOrg`](/docs/configuration/blocks).

Install documents and declare nothing, and the flow accepts a request carrying only a `userId`. No org resource registry gets built, so the documents are simply not there:

```ts
await ctx.resources.get("teams/engineering/handbook").readContent();
// Error: Resource "teams/engineering/handbook" is not registered
```

Put `requireOrg: true` on the blocks that read a document, as the example in the next section does. The flow then turns away a request with no org up front, instead of running it and coming up empty. How a request carries its org is covered in [the client reference](/docs/configuration/client).

### The team folder is a namespace, not a visibility boundary

Every file-declared document is org-scoped, and a generator's resource tools reach every installed document marked `llmReadable`, with no per-team filter. Install a whole tree on one flow and every team's documents are reachable from it.

To give one team's seats only its own documents, filter the records before installing them:

```ts
const engineering = resourcesFromDocs(
  documents.filter((doc) => doc.ref.startsWith("teams/engineering/")),
);
```

### Letting a model read a document

`llmReadable: true` in the frontmatter is the document's half of the opt-in. The generator needs the tool:

```ts
import { generator, readResourceContentTool } from "@flow-state-dev/core";

export const answerQuestion = generator({
  name: "answer-question",
  model: "openai/gpt-5.4-mini",
  requireOrg: true,
  prompt: "Answer support questions. Check the team handbook before you answer.",
  tools: [readResourceContentTool()],
});
```

`requireOrg: true` is what binds the request to an org, which org-scoped documents need to load at all.

The documents are already declared on the flow, so the generator does not declare them again. The tool addresses a document by its scope-qualified uri, the same handle the [search tools](/docs/resources/searching) return. See [LLM access patterns](/docs/resources/overview#llm-access-patterns).

## What stays in TypeScript

`defineResource` is the other route into the same map, and the two sit side by side, as `ticket` and the file-declared documents do above.

A document that needs a state schema of its own, a `render` function, [reactive bindings](/docs/resources/reactive-blocks) or an [edge graph](/docs/resources/edges) stays in code. Those are functions, and a Markdown file cannot hold one. Session- and user-scoped resources stay in code too: every document read from the tree is org-scoped.

## What this does not do

- It does not watch the tree. Read it once, at startup.
- It does not follow symlinks, at any level of the walk.
- It does not install anything. `readResourcesDirectory` hands back records, `resourcesFromDocs` hands back a map, and you put the map on your flow.
- It does not read a team's `workers/` or `skills/` folders. Those are [Workers on disk](./workers-on-disk.md) and [Skills](../skills/overview.md).
