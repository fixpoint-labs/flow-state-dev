---
title: Documents on disk
sidebar_position: 6
sidebar_label: Documents on disk
description: "Write a team's shared documents as Markdown files, read the tree at startup, and install them as resources on a flow."
---

# Documents on disk

A handbook, a glossary, an escalation procedure: the reference material a team shares and an agent reads. You can declare each one in TypeScript with `defineResource`. You can also write it as a Markdown file and read the folder at startup, which lets someone who does not write TypeScript edit it.

There are two folders, and which one you use decides where the document lives afterwards.

| Folder | The body an agent reads | Who can change it | Who can read it |
|---|---|---|---|
| `references/` | the file on disk, re-read each request | whoever can edit the file in your repo | seats at or below it in the tree |
| `resources/` | the file's body at first boot, then whatever the product last wrote | the file, until something writes it; after that, the product | any seat the flow installed it on |

Put a company handbook in `references/`. Editing the file is the edit, and it keeps reaching agents on the next deploy no matter what else happens. Put an agent's working notes in `resources/`, where they can be written and survive the turn.

`readReferencesDirectory` and `readResourcesDirectory` turn the folder tree into plain records. `referencesFromDocs` and `resourcesFromDocs` turn those records into the resource maps you pass to `defineFlow`.

Documents live in the same tree as [workers](./workers-on-disk.md) and [skills](../skills/overview.md), so one folder can describe a whole workforce.

## The tree

A `references/` or `resources/` folder is read wherever the tree puts one: at the organization level, in a team, and inside a single worker's own folder.

```
workforce/
  org/
    references/
      code-of-conduct.md
  teams/
    engineering/
      references/
        handbook.md
      resources/
        scratch.md
      workers/
        on-call/
          references/
            runbook.md
          WORKER.md
    support/
      references/
        escalation.md
```

Five documents: one shared across the organization, two belonging to a team, one belonging to a single seat, and one scratchpad the team's agents can write. Every example below reads this tree.

Both folders name documents the same way, and they share one namespace. `references/handbook.md` and `resources/handbook.md` in one team are two spellings of the same name, so the pair is refused at startup rather than one of them quietly winning.

A worker's own folder is what lets two seats each have a `runbook` without their authors agreeing on a name. Organization-level workers, under `org/workers/`, are read the same way.

A document is a **file**, not a folder. A worker and a skill are each a folder with a fixed file inside it; a document is `<name>.md` sitting directly in `resources/`. A directory in a `resources/` folder is reported rather than passed over, so `resources/handbook/RESOURCE.md` is an error and not a document that quietly went missing.

A `.ts` file can sit in the same folder. Those are code rather than reference material, read by a build step instead of at startup, and covered in [Capabilities on disk](./capabilities-on-disk.md). They share the folder and the [ref rule](#a-documents-ref) and nothing else, so a `.md` and a `.ts` of one name in one folder are refused rather than one of them winning. The rest of this page is about `.md` files.

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

A file in `references/` derives three more: `writable`, `llmWritable` and `render`. The folder is what makes a reference read-only, so no file has to ask for that and no file can turn it off. Declaring any of the three is refused by name, `writable: false` included — agreeing with the folder is still a second place to keep the same fact, and the next person to open the file cannot tell which copy is the one doing the work. A document that needs to be written belongs in `resources/`.

## A document's ref

A document's ref is its identity. It is built from the folders above the file, joined with slashes. At the organization level it is the bare file name:

| Path | Ref |
|------|-----|
| `<root>/org/resources/code-of-conduct.md` | `code-of-conduct` |
| `<root>/teams/engineering/resources/handbook.md` | `teams/engineering/handbook` |
| `<root>/teams/engineering/workers/on-call/resources/runbook.md` | `teams/engineering/workers/on-call/runbook` |
| `<root>/org/workers/build/resources/runbook.md` | `workers/build/runbook` |

Each qualifier means a name only has to be unique where it sits. Every team can have a `handbook`, and every seat a `runbook`, without checking what anyone else called theirs.

The ref is also the key the document is installed under, and a resource's [accessor key](/docs/resources/overview#block-level-resource-declarations) is what a block reads on `ctx.resources`:

```ts
const handbook = await ctx.resources["teams/engineering/handbook"].readContent();
```

Document, team and worker names follow [the tree's name rule](./workers-on-disk.md#names-in-the-tree): lowercase letters, digits and single hyphens, at most 64 characters. So `on-call.md` is fine. `On Call.md` and `on.call.md` are reported when the tree is read, with the rule in the message.

A worker folder's documents load whether or not the folder holds a `WORKER.md`. A folder missing its `WORKER.md` is reported separately, by [the roster loader](./workers-on-disk.md).

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
  filePath?: string;                 // where it was read from — references only
}
```

`readReferencesDirectory` has the same signature and returns the same records, each carrying the `filePath` its content is served from.

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

A file in a `resources/` folder that is not a `.md` is passed over in silence by this reader, as are OS and editor droppings such as `.DS_Store`. A `.ts` file is passed over here too, and picked up by the other door: [`fsdev gen`](./code-on-disk.md) writes it onto the generated file, and [Capabilities on disk](./capabilities-on-disk.md) covers what it then gives a worker.

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

References install the same way, through `referencesFromDocs`, and both maps spread into the same flow:

```ts
const references = await readReferencesDirectory("./workforce");
const documents = await readResourcesDirectory("./workforce");

export const supportFlow = defineFlow({
  kind: "support",
  actions: { answer: { block: answerQuestion } },
  resources: {
    ticket: ticketResource,
    ...resourcesFromDocs(documents.documents),
    ...referencesFromDocs(references.documents),
  },
});
```

Pass both to `hireWorkforce` as well, so it knows which entries are references and can hold each seat to its place in the tree:

```ts
hireWorkforce(workers, {
  kinds,
  documents: resourcesFromDocs(documents.documents),
  references: referencesFromDocs(references.documents),
});
```

A reference's content is read from its file whenever an execution context is built, so editing the file in your repository reaches agents on the next request. A read already in flight keeps the body it started with.

Spread the map rather than passing it on its own. A flow copy created with `supportFlow({ resources })` *replaces* the definition's map instead of merging with it, so a copy handed only `resourcesFromDocs(documents)` loses whatever the flow kind declared.

`resourcesFromDocs` throws rather than collecting. A record it cannot turn into a resource stops startup, naming the ref.

### The request needs an org

A document is stored at org scope, so a request has to be bound to an org before a block can read one. The flow does not work that out from its resource map. It takes the requirement from its blocks, through [`requireOrg`](/docs/configuration/blocks).

Install documents and declare nothing, and the flow accepts a request carrying only a `userId`. No org resource registry gets built, so the documents are simply not there:

```ts
await ctx.resources.get("teams/engineering/handbook").readContent();
// Error: Resource "teams/engineering/handbook" is not registered
```

Put `requireOrg: true` on the blocks that read a document, as the example in the next section does. The flow then turns away a request with no org up front, instead of running it and coming up empty. How a request carries its org is covered in [the client reference](/docs/configuration/client).

### Who reaches what

**For a `references/` document, the folder is the boundary.** A seat reaches the references at or above its own place in the tree: the organization's, its own team's, and its own folder's. Not another team's, and not a teammate's folder. You write no filter, and there is no setting to get wrong.

```
teams/engineering/workers/ada/     a seat here reads…
  org/references/code-of-conduct     yes — the organization is above everyone
  teams/engineering/references/handbook   yes — its own team
  teams/engineering/workers/ada/references/runbook   yes — its own folder
  teams/engineering/workers/ivan/references/runbook  no  — a teammate's folder
  teams/support/references/escalation                no  — another team
```

To let a reference reach more people, move the file up the tree. That is the only way to widen it, which is what makes the boundary worth trusting: nothing on the install side can quietly open it back up.

A seat that wants less than its place gives it lists what it wants in its own file. The list narrows and never widens, so naming a document the seat could not already reach is refused at startup rather than granted:

```md
---
flow: desk
description: Engineering desk
references:
  - teams/engineering/handbook
---
```

Leaving the key out means every reference at or above the seat. Writing `references: []` means none — the two are different answers, not the same one.

**For a `resources/` document, the folder is a namespace and nothing more.** Every one is org-scoped, and a generator's resource tools reach every installed document marked `llmReadable`. Install a whole tree on one flow and every team's writable documents are reachable from it, one team from another included.

So if you want a team's writable documents kept to that team, filter the records before installing them:

```ts
const engineering = resourcesFromDocs(
  documents.filter((doc) => doc.ref.startsWith("teams/engineering/")),
);
```

The same holds one level down. Putting a `resources/` document under `workers/on-call/` addresses it to that seat. It does not keep it from the others. Seats hired into one kind share that kind's flow definition, so by default every one of them reads the same row.

Filtering decides what a whole kind installs. To narrow one seat within a kind, the seat's own file names the documents it may touch, and can take one read-only: see [what a `WORKER.md` says](./workers-on-disk.md#what-a-workermd-says). A seat naming a document its kind was not installed with is refused at the hire, so the filter holds.

### Giving one seat a document of its own

A document whose frontmatter carries `flowIsolation: true` gets one row per seat:

```md
---
description: This seat's own working notes.
flowIsolation: true
---
```

The seat that writes it reads it back. A sibling seat asking for the same document gets its own empty copy, not an error and not the first seat's copy.

That line is the boundary, not the folder it sits in. A document in a worker's folder without it is shared across every seat of the kind, the same as a team's handbook.

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

## Moving a document into `references/`

Moving the file is usually the whole job. One case needs a second step, and it is quiet enough to be worth knowing about: if anything ever wrote that document while it was in `resources/`, the written body is still stored, and a stored body is what an agent reads. Move the file and the agent keeps reading the old write — the file looks authoritative in your repository and reaches nobody.

`clearShadowedReferences` finds those and clears them, so the file is the source again:

```ts
import { clearShadowedReferences, describeShadowedReferences } from "@flow-state-dev/workforce";

const result = await clearShadowedReferences({
  references: referencesFromDocs(references.documents),
  orgId,
  content: stores.content,
});
console.log(describeShadowedReferences(result));
// references: 1 of 4 were shadowed by a stored write and have been cleared — handbook.
```

It reports before it is believed: `result.cleared` names each reference and carries the body that had been served in the file's place, which is the last moment that text exists anywhere. Pass `dryRun: true` to see the finding and change nothing.

Run it once per organization after the move. It is safe to run again — a tree whose files are already the source reports nothing cleared — and it never touches a `resources/` document.

## What stays in TypeScript

`defineResource` is the other route into the same map, and the two sit side by side, as `ticket` and the file-declared documents do above.

A document that needs a state schema of its own, a `render` function, [reactive bindings](/docs/resources/reactive-blocks) or an [edge graph](/docs/resources/edges) stays in code. Those are functions, and a Markdown file cannot hold one. Session- and user-scoped resources stay in code too: every document read from the tree is org-scoped.

## What this does not do

- It does not watch the tree. Read it once, at startup.
- It does not follow symlinks, at any level of the walk.
- It does not install anything. `readResourcesDirectory` hands back records, `resourcesFromDocs` hands back a map, and you put the map on your flow.
- It does not read `WORKER.md` or any `skills/` folder. Those are [Workers on disk](./workers-on-disk.md) and [Skills](../skills/overview.md). It reads a worker folder only to find a `resources/` folder inside it.
- It does not put a document on an agent's bash mount. A mount carries collections; a document is a single resource, so a shell on the sandbox will not find the handbook as a file.
- It does not watch a reference for changes within a request. The file is read when an execution context is built, so an edit reaches the next request rather than a read already running.
- For a `resources/` document, it does not decide which seat may read which one. `flowIsolation` gives each seat its own copy; nothing there refuses a read. A `references/` document is the exception, and [Who reaches what](#who-reaches-what) is the rule.
