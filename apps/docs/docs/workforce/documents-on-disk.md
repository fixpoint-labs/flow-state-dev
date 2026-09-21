---
title: Documents on disk
sidebar_position: 6
sidebar_label: Documents on disk
description: "Write a team's shared documents as Markdown files, read the tree at startup, and install them as resources on a flow."
---

# Documents on disk

A handbook, a glossary, an escalation procedure: the reference material a team shares and an agent reads. You can declare each one in TypeScript with `defineResource`. You can also write it as a Markdown file and read the folder at startup, which lets someone who does not write TypeScript edit it.

Two folders hold documents, and the one you pick decides where the text lives from then on.

| Folder | The body an agent reads | Who can change it | Which seats reach it |
|---|---|---|---|
| `references/` | the file on disk, re-read on each request | whoever edits the file in your repository | every seat at or below the folder it sits in |
| `resources/` | the file's body at first boot, then whatever the product last wrote | the file, until something writes it; the product after that | every seat the flow installed it on |

Choose by who does the editing. A company handbook goes in `references/`: you change it by editing the file and deploying, and nothing running in the product can overwrite it. An agent's working notes go in `resources/`, where a block or the agent itself can write and the text survives the turn.

`readReferencesDirectory` and `readResourcesDirectory` turn the folder tree into plain records. `referencesFromDocs` and `resourcesFromDocs` turn those records into the resource maps you pass to `defineFlow`.

Documents live in the same tree as [workers](./workers-on-disk.md) and [skills](../skills/overview.md), so one folder can describe a whole workforce.

## The tree

Either folder is read wherever the tree puts one: at the organization level, in a team, and inside a single worker's own folder.

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
        ada/
          WORKER.md
          references/
            runbook.md
    support/
      references/
        escalation.md
```

Five documents: a code of conduct everyone reads, a handbook for engineering, a runbook for one seat, an escalation procedure for support, and a scratchpad the engineering agents can write. Every example below reads this tree.

Both folders name documents the same way, and they share one namespace. `references/handbook.md` and `resources/handbook.md` in one team are two spellings of the name `handbook`. Neither single-folder reader sees the other folder, so neither reports the pair on its own. `readDeclaredRoster`, which walks the whole tree in one call, puts it in its `problems` and names both files; `hireWorkforce` throws on a ref handed to it as both a document and a reference.

A worker's own folder is what lets two seats each have a `runbook` without their authors agreeing on a name. Organization-level workers, under `org/workers/`, are read the same way.

A document is a **file**, not a folder. A worker and a skill are each a folder with a fixed file inside it; a document is `<name>.md` sitting directly in `references/` or `resources/`. A directory in one of those folders is reported rather than passed over, so `resources/handbook/RESOURCE.md` is an error and not a document that quietly went missing.

A `.ts` file can sit in a `resources/` folder. Those are code rather than reference material, read by a build step instead of at startup, and covered in [Capabilities on disk](./capabilities-on-disk.md). They share the folder and the [ref rule](#a-documents-ref) and nothing else, so a `.md` and a `.ts` of one name in one folder are refused rather than one of them winning. The rest of this page is about `.md` files.

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

Frontmatter never reaches an agent. A reference is served with its `---` block stripped, and a `resources/` document is installed with its parsed body, so what a model reads starts at the Markdown.

The frontmatter is the same dialect a [`WORKER.md`](./workers-on-disk.md#what-a-workermd-says) uses.

### Settings the convention derives

Where a file sits decides its identity, where it is stored, and what its content is. So a document file may not declare `scope`, `ref`, `stateSchema`, `default`, `content`, `contentFile`, `contentTemplate` or `contentTemplateRef`. Each is refused by name, with the file it was found in.

`prefetchMode: "lazy"` is refused too: a file-declared document is installed at flow level and always loaded eagerly. Writing `prefetchMode: eager` is accepted and carried through.

Everything outside that set arrives at the resource exactly as written, so `llmReadable`, `llmWritable`, `writable`, `allowedExtensions` and `metadata` all take effect from the file.

A file in `references/` derives four more: `writable`, `llmWritable`, `render` and `flowIsolation`. The folder decides all four, and a file that declares any of them is refused by name — `writable: false` included, even though it agrees with the folder. A document that needs to be written belongs in `resources/`.

## A document's ref

A document's ref is its identity. It is built from the folders above the file, joined with slashes, and the rule is the same in both folders. At the organization level it is the bare file name:

| Path | Ref |
|------|-----|
| `<root>/org/references/code-of-conduct.md` | `code-of-conduct` |
| `<root>/teams/engineering/resources/scratch.md` | `teams/engineering/scratch` |
| `<root>/teams/engineering/workers/ada/references/runbook.md` | `teams/engineering/workers/ada/runbook` |
| `<root>/org/workers/build/resources/runbook.md` | `workers/build/runbook` |

Each qualifier means a name only has to be unique where it sits. Every team can have a `handbook`, and every seat a `runbook`, without checking what anyone else called theirs.

The ref is also the key the document is installed under, and a resource's [accessor key](/docs/resources/overview#block-level-resource-declarations) is what a block reads on `ctx.resources`:

```ts
const handbook = await ctx.resources["teams/engineering/handbook"].readContent();
```

Document, team and worker names follow [the tree's name rule](./workers-on-disk.md#names-in-the-tree): lowercase letters, digits and single hyphens, at most 64 characters. So `on-call.md` is fine. `On Call.md` and `on.call.md` are reported when the tree is read, with the rule in the message.

A worker folder's documents load whether or not the folder holds a `WORKER.md`. A folder missing its `WORKER.md` is reported separately, by [the roster loader](./workers-on-disk.md).

## Reading the tree

Point a reader at the root. The two take the same argument and return the same shape:

```ts
import { readReferencesDirectory, readResourcesDirectory } from "@flow-state-dev/workforce/loader";

const references = await readReferencesDirectory("./workforce");
const resources = await readResourcesDirectory("./workforce");
```

You get one record per document:

```ts
interface ResourceDoc {
  ref: string;                       // "teams/engineering/handbook"
  declared: Record<string, unknown>; // the frontmatter, exactly as written
  body: string;                      // the Markdown below it, verbatim
  filePath?: string;                 // the absolute path it was read from
}
```

For the handbook above:

```ts
const handbook = references.documents.find((doc) => doc.ref === "teams/engineering/handbook")!;

handbook.declared;
// { description: "How the engineering team works. On-call, review, escalation.",
//   llmReadable: true }
handbook.body;
// "# Engineering handbook\n\nEscalate anything customer-visible within 15 minutes.\n"
```

A reference is served from `filePath`, so a record you build by hand has to set it to the document's absolute path; `referencesFromDocs` throws on a record without one. A `resources/` record carries the path too, and nothing reads it there — `body` is that document's source.

Reading the tree builds nothing. No resource is defined, nothing is stored, and no flow is touched. Turning records into resources is a separate call.

The subpath matters. `@flow-state-dev/workforce/loader` imports `node:fs`, so it only runs on Node. The package root, where `resourcesFromDocs` and `referencesFromDocs` live, stays isomorphic.

### When a file is wrong

Anything that should have produced a document and did not lands in `errors`, and the rest of the documents load anyway. Say someone wrote the marketing handbook as a folder:

```ts
resources.errors;
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
| `unreadable-slot` | A structural folder is a symlink or exists and cannot be listed: `org`, `teams`, a team folder, a `workers/` level, or either document folder inside any of them. The documents beneath it cannot be enumerated, so the folder is reported under its own path. |

Either reader throws only about the root you passed: when it cannot be read at all, and when it is a symlink. Links are never followed at any level of the walk, and the root is no exception, so a linked root is refused rather than read from wherever it points. A root with neither `org/` nor `teams/` comes back as `{ documents: [], errors: [] }`, and a team with no document folder is not an error either.

A file that is not a `.md` is passed over in silence, as are OS and editor droppings such as `.DS_Store`. A `.ts` file in `resources/` is passed over here too, and picked up by the other door: [`fsdev gen`](./code-on-disk.md) writes it onto the generated file, and [Capabilities on disk](./capabilities-on-disk.md) covers what it then gives a worker.

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

`resourcesFromDocs` and `referencesFromDocs` each turn records into a resource map keyed by ref. Spread both into the flow's own map:

```ts
import { defineFlow } from "@flow-state-dev/core";
import { hireWorkforce, referencesFromDocs, resourcesFromDocs } from "@flow-state-dev/workforce";
import {
  readReferencesDirectory,
  readResourcesDirectory,
  readWorkforceDirectory,
} from "@flow-state-dev/workforce/loader";
import { answerQuestion } from "./blocks";
import { ticketResource } from "./resources";

const roster = await readWorkforceDirectory("./workforce");
const references = await readReferencesDirectory("./workforce");
const resources = await readResourcesDirectory("./workforce");
for (const { errors } of [roster, references, resources]) {
  if (errors.length) throw new Error(`workforce: ${errors.length} entries failed to load`);
}

const documentMap = resourcesFromDocs(resources.documents);
const referenceMap = referencesFromDocs(references.documents);

export const supportFlow = defineFlow({
  kind: "support",
  actions: { answer: { block: answerQuestion } },
  resources: { ticket: ticketResource, ...documentMap, ...referenceMap },
});

export const seats = hireWorkforce(roster.workers, {
  kinds: { support: supportFlow },
  documents: documentMap,
  references: referenceMap,
});
```

Every file-declared document is installed at `org` scope. A `resources/` entry carries the file's body as its starting content; a `references/` entry points at the file itself, which is read whenever an execution context is built. Editing a reference in your repository reaches agents on the next request, and a read already in flight keeps the body it started with.

Every request runs in an organization, so a block reads a document straight off `ctx.resources`. [Authentication](/docs/server/authentication#every-request-runs-in-an-organization) covers where that organization comes from. Each organization gets its own copy of a `resources/` document, so what one organization's agents write is not what another's read.

`documents` and `references` tell the hire which entries on a kind's map are which. [The tree wall](#who-reaches-what) is derived against the `references` map, so a kind holding references has to be hired with it. Omit it, or pass one that is missing a reference the kind installed, and `hireWorkforce` throws, naming every reference it was not given. The whole roster is refused, so no seat is hired:

```
hireWorkforce refused 1 of 1 worker; nothing was hired:
  - worker "engineering.ada" — is hired onto a kind holding 4 reference(s) that hireWorkforce
    was not given: "code-of-conduct", "teams/engineering/handbook",
    "teams/engineering/workers/ada/runbook", "teams/support/escalation". … Pass the same map you
    installed on the kind: hireWorkforce(workers, { references: referencesFromDocs(refs) })
```

A kind holding no references needs no map, and a roster hires the same whether you pass one or not. A ref passed in both maps is refused too, naming it.

Spread the maps rather than passing one on its own. A flow copy created with `supportFlow({ resources })` *replaces* the definition's map instead of merging with it, so a copy handed only `documentMap` loses whatever the flow kind declared.

Both functions throw rather than collecting. A record that cannot become a resource stops startup, naming the ref.

## Who reaches what

**For a `references/` document, the folder is the boundary.** A seat reaches the references at or above its own place in the tree: the organization's, its own team's, and its own folder's. Not another team's, and not a teammate's folder. You write no filter, and there is no setting to get wrong.

```
teams/engineering/workers/ada/     a seat here reads…
  org/references/code-of-conduct                     yes — the organization is above everyone
  teams/engineering/references/handbook              yes — its own team
  teams/engineering/workers/ada/references/runbook   yes — its own folder
  teams/engineering/workers/ivan/references/runbook  no  — a teammate's folder
  teams/support/references/escalation                no  — another team
```

An unreachable reference is not an empty read. The accessor is not on the seat's map at all, so `ctx.resources.get("teams/support/escalation")` throws `is not registered`.

To let a reference reach more people, move the file up the tree. Nothing on the install side widens it.

A seat can ask for less than its place gives it, by listing what it wants in its own file. The list narrows and never widens, so naming a document the seat could not already reach refuses the whole roster at the hire, naming the seat and the ref:

```md
---
flow: desk
description: Engineering desk
references:
  - teams/engineering/handbook
---
```

Leaving the key out means every reference at or above the seat. Writing `references: []` means none.

Seats are read from `teams/<team>/workers/<name>/`, so a reference under `org/workers/<name>/references/` sits beside the organization level rather than above any seat, and no seat reaches it.

**For a `resources/` document, the folder is a namespace and nothing more.** Every one is org-scoped, and a generator's resource tools reach every installed document marked `llmReadable`. Install a whole tree on one flow and every team's writable documents are reachable from it, one team from another included.

So if you want a team's writable documents kept to that team, filter the records before installing them:

```ts
const engineering = resourcesFromDocs(
  resources.documents.filter((doc) => doc.ref.startsWith("teams/engineering/")),
);
```

The same holds one level down. Putting a `resources/` document under `workers/ada/` addresses it to that seat. It does not keep it from the others. Seats hired into one kind share that kind's flow definition, so by default every one of them reads the same row.

Filtering decides what a whole kind installs. To narrow one seat within a kind, the seat's own file names the documents it may touch under `resources:`, and can take one read-only: see [what a `WORKER.md` says](./workers-on-disk.md#what-a-workermd-says). A seat naming a document its kind was not installed with is refused at the hire, so the filter holds.

### Giving one seat a document of its own

A `resources/` document whose frontmatter carries `flowIsolation: true` gets one row per seat:

```md
---
description: This seat's own working notes.
flowIsolation: true
---
```

The seat that writes it reads it back. A sibling seat asking for the same document gets its own empty copy, not an error and not the first seat's copy.

That line is the boundary, not the folder it sits in. A `resources/` document in a worker's folder without it is shared across every seat of the kind, the same as a team's scratchpad. A `references/` file cannot declare it; its boundary is where the file sits.

### Letting a model read a document

`llmReadable: true` in the frontmatter is the document's half of the opt-in. The generator needs the tool:

```ts
import { generator, readResourceContentTool } from "@flow-state-dev/core";

export const answerQuestion = generator({
  name: "answer-question",
  model: "openai/gpt-5.4-mini",
  prompt: "Answer support questions. Check the team handbook before you answer.",
  tools: [readResourceContentTool()],
});
```

The documents are already declared on the flow, so the generator does not declare them again. The tool addresses a document by its scope-qualified uri, the same handle the [search tools](/docs/resources/searching) return. See [LLM access patterns](/docs/resources/overview#llm-access-patterns).

A reference is read-only to code and to the model. `writeContent()` on one throws a `FlowError` with code `resource_read_only`, whose message names the ref: `Resource "teams/engineering/handbook" content is read-only`. The write tool is never offered for a reference either, whatever tools the generator carries.

## Moving a document into `references/`

Moving the file is usually the whole job. One case needs a second step: if anything ever wrote that document while it was in `resources/`, the written body is still stored, and a stored body wins over the file. Move the file and agents keep reading the old write, while the file in your repository looks authoritative and reaches nobody.

`clearShadowedReferences` finds those rows and clears them, so the file is the source again:

```ts
import { clearShadowedReferences, describeShadowedReferences } from "@flow-state-dev/workforce";

const result = await clearShadowedReferences({
  references: referenceMap,
  orgId,
  content: stores.content,
  installedOn: { id: flow.id, isolatesOrgState: false },
});
console.log(describeShadowedReferences(result));
// references: 1 of 4 were shadowed by a stored write and have been cleared — teams/engineering/handbook.
// Each now serves its file again.
```

The result carries what it found:

```ts
interface ClearShadowedReferencesResult {
  cleared: { ref: string; shadowedContent: string }[]; // each row, and the body it had been serving
  checked: string[];                                   // every ref looked at
  dryRun: boolean;
  scopeId: string;                                     // the bucket the rows were addressed in
}
```

Once the row is gone, `shadowedContent` is the only copy of that written body, so log it or keep it before deciding the clear was right. Pass `dryRun: true` to get the same finding with nothing deleted; the result says `dryRun: true`, and `describeShadowedReferences` reports what `WOULD be cleared`.

`installedOn` describes the flow the references are installed on. Read `isolatesOrgState` off the flow rather than guessing: a flow that isolates its organization scope stores content under a different address, and a run told the wrong thing looks in the wrong place and reports nothing to clear.

Run it once per organization after the move. It is safe to run again — a tree whose files are already the source reports nothing cleared — and it never touches a `resources/` document.

It throws for an organization or flow id containing `:` or a backslash. Those ids need the escaping the engine applies when it builds a storage address; clear those rows with the engine's own store helpers instead.

## What stays in TypeScript

`defineResource` is the other route into the same map, and the two sit side by side, as `ticket` and the file-declared documents do above.

A document that needs a state schema of its own, a `render` function, [reactive bindings](/docs/resources/reactive-blocks) or an [edge graph](/docs/resources/edges) stays in code. Those are functions, and a Markdown file cannot hold one. Session- and user-scoped resources stay in code too: every document read from the tree is org-scoped.

## What this does not do

- It does not watch the tree. Read it once, at startup.
- It does not follow symlinks, at any level of the walk.
- It does not install anything. The readers hand back records, `resourcesFromDocs` and `referencesFromDocs` hand back maps, and you put the maps on your flow.
- It does not read `WORKER.md` or any `skills/` folder. Those are [Workers on disk](./workers-on-disk.md) and [Skills](../skills/overview.md). It reads a worker folder only to find a document folder inside it.
- It does not put a document on an agent's bash mount. A mount carries collections; a document is a single resource, so a shell on the sandbox will not find the handbook as a file. That holds for a reference too, even though its content is a file on your disk.
- It does not re-read a reference within a request. The file is read when an execution context is built, so an edit reaches the next request rather than a read already running.
- For a `resources/` document, it does not decide which seat may read which one. `flowIsolation` gives each seat its own copy; nothing there refuses a read. A `references/` document is the exception, and [Who reaches what](#who-reaches-what) is the rule.
