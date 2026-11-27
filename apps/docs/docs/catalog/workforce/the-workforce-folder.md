---
title: The workforce folder
type: catalog
description: A team of workers is files in one folder, and where a file sits decides which workers get it.
---

import Figure from "@site/src/components/Figure";
import FolderTree from "./figures/the-folder-tree.svg";

# The workforce folder

A team of workers is files in one folder, `workforce/`: the workers, the instructions and documents they read, the capabilities and tools they can use, the packages they hold. A worker is a named agent a user talks to. The app reads the folder when it starts, except the text of documents in `references/`, which each request reads from the file.

Where a file sits decides who gets it. A reference or skill in a team's folder reaches that team's workers, and one in the `org/` folder reaches every worker on every team. You hand a worker something by putting the file where that worker can see it, with no registration and no config line. A team is then a folder you review in a pull request and deploy with the app.

<Figure svg={FolderTree} caption="Each folder under workforce/ and what it becomes" description={"Two columns of eight rows each. On the left, inside one box labelled workforce, in your repo, eight paths: teams/support/workers/lead/WORKER.md, which is highlighted as where you start, then teams/support/TEAM.md, teams/support/references/, teams/support/resources/, teams/support/packages/, teams/support/skills/, flows/workers/ and blocks/, and org/. An arrow labelled becomes runs from each path to a box on the right, in the app. The boxes read: a worker, support.lead; instructions every support worker is told; read-only documents, read from the file; documents workers write, and capabilities; instructions and tools a worker holds; skills every support worker holds; worker flows, and tools any worker may name; workers, documents, skills and packages for every team."} />

## What you get

- **A worker is a folder.** Add `teams/support/workers/lead/` with a `WORKER.md`, restart, and `support.lead` exists.
- **Placement is the access rule for references and skills.** A reference or skill reaches every worker at the level it sits on, and nobody else. A writable document in `resources/` is different: every worker has it unless its file's `resources:` line narrows the list, wherever the document sits, and what a worker saves is one copy for the whole organization. A package sits at the same levels, and where it sits decides who may hold it. To reach more workers, move the file up the tree.
- **A misplaced file stops the app.** The error names its path.
- **No wiring.** Workers, documents and packages need no line in your app's code. A code file needs `fsdev gen`, whose module the config passes to the kit once.

## Install it

The folder is read by the workforce kit. List the kit in your app's config:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";

export default createFlowState({
  kits: [workforce({ agent: { model: "openai/gpt-6-luna" } })],
});
```

The kit reads `workforce/` beside the app and serves each worker flow in the tree, the built-in `agent` flow (the chat a user has with a worker, run on the model you pass as `agent.model`), and a `workforce-roster` flow (where each user's own hired and edited workers are kept). The smallest valid tree is one `WORKER.md` with a `description`.

## Use it

```text title="The workforce folder"
workforce/
  teams/
    support/
      TEAM.md                     instructions every support worker is told
      references/handbook.md      a document every support worker reads
      resources/research.ts       a capability
      packages/escalation/        PACKAGE.md, and blocks/ for its tools
      skills/<name>/SKILL.md      a skill every support worker holds
      blocks/<name>.ts            a tool every support worker may name
      workers/
        lead/
          WORKER.md               the worker support.lead
          blocks/                 tools for this worker alone
          references/  resources/  skills/  packages/   this worker's own
  org/
    workers/<name>/WORKER.md      a worker with no team
    references/                   documents for every worker
    resources/  skills/  packages/
  flows/workers/<name>.ts         worker flows
  blocks/<name>.ts                tools any worker may name
  workforce.gen.ts                written by fsdev gen
```

A worker, a team and the org each take their own `references/`, `resources/`, `skills/` and `packages/`. Capabilities, the `.ts` files in `resources/`, go at the team or org level only. Names are lowercase letters, digits and hyphens. The [Workforce folder reference](../../reference/workforce-folder.md) has the naming rules and says what each level takes and what is refused.

### Workers

A worker is a folder with a `WORKER.md`. Its id is the team folder and its own folder joined with a dot, so `teams/support/workers/lead/` is `support.lead`.

```md title="workforce/teams/support/workers/lead/WORKER.md"
---
description: Answers customers and files refunds.
---

You are the support lead. Answer in a sentence or two, and say plainly when you don't know.
```

The keys, and which are required, are on the [`WORKER.md` reference](../../reference/worker-md.md). What a worker is once a user talks to it is in [Workers](../../concepts/workers.md).

### Documents

A document every worker on a team should read goes in `teams/support/references/`:

```md title="workforce/teams/support/references/handbook.md"
---
description: How the support team works. On-call, review, escalation.
---

# Support handbook

Escalate anything customer-visible within 15 minutes.
```

A reference is read-only: a worker reads the file as it is and can't change it. In `org/references/` every worker reads it, and in a worker's own `references/` only that worker does.

A `resources/` folder holds two kinds of file. A `.md` file is a document a worker can write to: the file is the starting text, and what the worker saves outlives the turn. A `.ts` file is a capability, covered under Capabilities below. A name used in `references/` can't also be used in `resources/` at the same level. The [Workforce folder reference](../../reference/workforce-folder.md) says what happens on a clash.

Instructions for every turn go in the body of `TEAM.md`. Material a worker looks up goes in `references/`.

### Code

Worker flows, blocks and capabilities are TypeScript files, `.ts` or `.tsx`. To add one, put the file in its folder and run:

```bash
pnpm fsdev gen
```

It writes `workforce/workforce.gen.ts`, a file of static imports. Commit it. The [CLI reference](../../reference/cli.md) covers what the command needs, its flags and `fsdev gen --check` for CI.

Hand the generated module to the kit whole:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";
import * as generated from "./workforce/workforce.gen";

export default createFlowState({
  kits: [workforce({ generated, agent: { model: "openai/gpt-6-luna" } })],
});
```

`fsdev gen` registers every `.ts` and `.tsx` file in `flows/workers/`, a `blocks/` folder or a `resources/` folder, so keep tests elsewhere. The [Workforce folder reference](../../reference/workforce-folder.md) has the file-name rule.

A block in `blocks/` is a name a worker may use, not a grant. A worker calls it only when its `tools:` line lists it.

### Capabilities

A capability bundles context, tools and resources a worker can carry, in presets that are on or off. A capability is a `.ts` file in the `resources/` folder of the org or of a team:

```ts title="workforce/teams/support/resources/research.ts"
import { defineCapability } from "@flow-state-dev/core";

export default defineCapability({
  name: "research",
  presets: {
    briefing: { context: ["This week: the desk is quiet, two shipments are late."] },
    ledger: { context: ["Signing limit: any refund up to 50 without a second pair of eyes."] },
    default: [],
  },
});
```

A worker picks presets in its `WORKER.md`:

```md title="workforce/teams/support/workers/lead/WORKER.md"
---
description: Answers customers and files refunds.
capabilities:
  research: [briefing]
---

You are the support lead. Answer in a sentence or two, and say plainly when you don't know.
```

The [`WORKER.md` reference](../../reference/worker-md.md) covers `capabilities:` and what a worker that names none gets. The [Workforce folder reference](../../reference/workforce-folder.md) covers how `fsdev gen` names a capability.

### Packages

A package is a folder you hand to a worker: a `PACKAGE.md` that tells it how to do something, and an optional `blocks/` folder with the tools it needs. Where the folder sits decides who holds it.

- **A worker's own**, `workers/lead/packages/escalation/`: that worker holds it, with no line in its file.
- **A team's library**, `teams/support/packages/escalation/`: a worker on `support` holds it once its `packages:` line names it.
- **The org's library**, `org/packages/escalation/`: any worker holds it once its `packages:` line names it, as `packages: [escalation]`.

The lookup order and the other holding rules are in the [Workforce folder reference](../../reference/workforce-folder.md). Run `fsdev gen` after you add or remove a package's block.

### What reads the folder, and when

At startup the kit reads the whole folder. It refuses to start the app when something in the folder fails to load, and names every problem at once. The [Kits reference](../../reference/kits.md) lists the refusals and their messages.

## Change it

Edit the text of a reference and the next request reads it. Any other edit to a `WORKER.md`, `TEAM.md`, `resources/` document or package, or a new file, needs a restart. Add, rename or remove a code file, run `pnpm fsdev gen`, then restart.

Every `.ts` file in `flows/workers/`, a `blocks/` folder or a `resources/` folder counts as a declaration, so keep tests and fixtures out of them. A test such as `blocks/search-docs.test.ts` gets past startup, because `blocks/` is a place the kit reads, but `fsdev gen` refuses its name: block names are lowercase letters, digits and single hyphens.

To keep the folder somewhere other than `workforce/`, give the kit `directory` and run `fsdev gen` with `--root`. The [Workforce reference](../../reference/workforce.md) covers `directory` and the [CLI reference](../../reference/cli.md) covers `--root`.

## Next

- [The workforce kit](./index.md), what it serves from this folder and how to configure it.
- [Workers](../../concepts/workers.md), what a `WORKER.md` becomes when a user talks to it.
- [Workforce folder reference](../../reference/workforce-folder.md), every path rule and file format.
- [`WORKER.md` reference](../../reference/worker-md.md), every key a worker file takes.
