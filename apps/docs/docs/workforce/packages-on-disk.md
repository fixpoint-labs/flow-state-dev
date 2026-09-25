---
title: Packages on disk
sidebar_position: 7
sidebar_label: Packages on disk
description: "Hand a worker a folder of instructions plus the blocks it needs to follow them, and let where the folder sits decide who holds it."
---

# Packages on disk

A **package** is a folder you hand to a worker: a `PACKAGE.md` that tells it how to do something, and a `blocks/` folder with the tools it needs to do it. Adding one takes no change to your app's source. Put the folder where the worker can see it, run `fsdev gen` if it has blocks, and restart.

## Writing one

```
refunds/
  PACKAGE.md
  blocks/
    issue-refund.ts
```

```md
---
description: How we issue refunds, and the tool that does it
---

Refund only against an invoice you looked up in this conversation.
Over $500, page on-call with the invoice id before calling issue-refund.
```

The body is instructions. On the built-in worker, they're in the prompt on every turn, after its team's instructions and its own; a kind of your own decides for itself. `description` is a label for people and never reaches the model. It is the only key the frontmatter takes.

Each file in `blocks/` is one of the package's tools, written like a block in any other [`blocks/` folder](./code-on-disk.md#blocks-a-worker-can-call): it default-exports a block, and the file's basename, the block's own `name` and the name a worker lists must all be the same. A package block may read a store the kind installed but may not declare one.

A package with no `blocks/` folder is fine. It is instructions and nothing else. If that's all you need, a [skill](../skills/overview.md) the worker lists under `skills: active:` does the same job, and can also stay out of the prompt until it's relevant. Reach for a package when a tool goes with the words.

Run `fsdev gen` after adding or removing a block, as you would for any other `blocks/` folder. An edit to `PACKAGE.md` needs a restart and nothing more.

## Giving one to a worker

Where the folder sits decides who holds it.

- **A worker's own.** `workforce/teams/<team>/workers/<worker>/packages/<name>/PACKAGE.md`, with its tools in `workforce/teams/<team>/workers/<worker>/packages/<name>/blocks/<block>.ts`. That worker holds it, always.
- **A team's library.** `workforce/teams/<team>/packages/<name>/PACKAGE.md`, with its tools in `workforce/teams/<team>/packages/<name>/blocks/<block>.ts`. A worker on that team holds it once it names it.
- **The org's library.** `workforce/org/packages/<name>/PACKAGE.md`, with its tools in `workforce/org/packages/<name>/blocks/<block>.ts`. Any worker holds it once it names it.

A worker names library packages in its own file:

```md
---
description: Handles refund requests
packages: [escalation]
---
```

The team's library is looked in first, then the org's. A library package no worker names reaches nobody, so adding one to a shared folder changes no worker until one asks for it. A worker can't name a package from another team's library or from another worker's folder.

A worker holds every package in its own `packages/` folder without naming it. Naming one there as well changes nothing.

## Its tools

What a worker can call from the packages it holds depends on its `tools:` line, the same way a preset's tools do:

- **No `tools:` line.** The worker can call every block of every package it holds.
- **A `tools:` line.** The line is the whole list. Name a package's block there to keep it: `tools: [search, issue-refund]`.
- **`tools: []`.** No tools. The worker still gets the package's instructions.

If a worker's `tools:` line names something that is both a block in a package it holds and a tool in the kind's [catalog](./built-in-worker.md#tools), the worker is refused at startup, and the message names both.

A package's tools reach only the workers that hold it. They are not in your app's tool catalog, a worker that doesn't hold the package can't name them, and a worker it [delegates to](./built-in-worker.md#tools) doesn't get them.

## In your app

`fsdev gen` writes a `packageBlocks` export onto `workforce.gen.ts`, keyed by each package's folder and then by block name. Pass it to `hireWorkforce` beside `seatBlocks`:

```ts
import { hireWorkforce } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";
import { kinds, packageBlocks, seatBlocks } from "./workforce/workforce.gen";

const { workers, errors, packageErrors } = await readWorkforce("./workforce");
if (errors.length || packageErrors.length) {
  const reported = [...errors, ...packageErrors].map(({ path, error }) => `  ${path}: ${error.message}`);
  throw new Error(`workforce failed to load:\n${reported.join("\n")}`);
}

const seats = hireWorkforce(workers, { kinds, seatBlocks, packageBlocks });
```

Leave `packageBlocks` out and a held package brings its instructions and no tools.

`readWorkforce` puts the packages in each worker's reach on that worker's record as `packages`: the org's library, its team's library, and its own folder. Which of them the worker holds is decided when it is hired, from its `packages:` line.

## When a file is wrong

Reading the tree reports a broken package in `packageErrors`, keyed by its path, and leaves it out. `readDeclaredRoster` reports the same entries under the `package` layer. Treat a non-empty `packageErrors` as fatal, as above. A worker whose own package failed to load is refused at the hire if that package has blocks; if it has none, the package is missing from that worker and `packageErrors` is the only place it shows up. A package is reported when:

| What | Fix |
|------|-----|
| its folder has no `PACKAGE.md`, or the file has no frontmatter or no `description` | A folder under `packages/` is a package, and every package has a `PACKAGE.md` with a `description`. |
| the frontmatter has any other key | Every extra key is named. Move the text into the body. |
| it holds a `resources/`, `references/`, `skills/` or `packages/` folder | A package holds a `PACKAGE.md` and a `blocks/` folder. Documents go in the organization's or a team's folders; see [Documents on disk](./documents-on-disk.md). |
| anything in it is a symlink | Nothing in the tree is followed through a link. Put the real folder there. |
| a file sits directly inside `packages/` | A package is a folder. |

`fsdev gen` refuses a package's `blocks/` folder for what it refuses in [any `blocks/` folder](./code-on-disk.md#what-it-checks-and-when), such as a symlink or a basename that breaks the naming rule.

`hireWorkforce` refuses a worker when:

- its `packages:` is not a list of names;
- it names a package no library in its reach offers. The message names both folders it looked in;
- it names a package that both its own `packages/` folder and a library offer. Rename one of them;
- a block in a package it holds has the same name as a block in its own or its team's `blocks/` folder, a block in another package it holds, a catalog tool its `tools:` line names, or a tool of a preset it picks while it has no `tools:` line;
- a block in a package it holds has a `name` that differs from its file's name, or declares a store;
- its own `packages/` folder has a package with blocks that failed to load. The message points at `packageErrors`.

Like every hire refusal, these are collected and thrown together, one message naming every bad worker:

```
hireWorkforce refused 1 of 3 workers; nothing was hired:
  - worker "support.billing" — names package "escalation" in `packages:`, and no library in its reach offers it. Looked in "teams/support/packages/escalation" and "org/packages/escalation".
```

A preset that builds its tools per turn isn't checked at startup. If one of those tools shares a name with a package block, that turn fails with an error saying there are two tools with that name.

## In a kind of your own

A seat that holds at least one package receives it on the `seatPackages` setting, one entry per package in the order it holds them:

```ts
seatPackages?: Array<{
  name: string;           // the folder's name
  path: string;           // e.g. "teams/support/packages/escalation"
  instructions?: string;  // the PACKAGE.md body, absent when empty
  tools: BlockDefinition[];
}>;
```

A seat that holds none doesn't get the key. Compose [`workerConfigSchema()`](./workers-on-disk.md#the-flow-decides-what-a-worker-may-declare) into your kind's `configSchema` and it accepts the setting. What your kind does with it is up to you. A worker file that writes `seatPackages:` itself is refused by name.

## What this does not do

- It does not load a package partway through a conversation. A package a worker holds is there on every turn. For guidance that should arrive only when it's relevant, write a [skill](../skills/overview.md).
- It does not carry documents.
- It does not read packages while your app runs. The text is read at startup and the blocks are found by `fsdev gen`, so a new or removed block needs `fsdev gen` and a restart.

## Related pages

- [Code on disk](./code-on-disk.md) — `fsdev gen`, and the rules every `blocks/` folder follows.
- [The built-in worker](./built-in-worker.md#tools) — how a worker's `tools:` line is resolved.
- [Workers on disk](./workers-on-disk.md) — the folder tree, `WORKER.md`, `readWorkforce` and `hireWorkforce`.
- [Skills](../skills/overview.md) — Markdown guidance that loads when it's relevant.
