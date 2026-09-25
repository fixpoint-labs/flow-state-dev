---
title: Capabilities on disk
sidebar_position: 7
sidebar_label: Capabilities on disk
description: "Put a TypeScript capability in a team's resources/ folder, run one command, and let each worker's own file say which of its presets that worker wants."
---

# Capabilities on disk

A `resources/` folder takes TypeScript beside its Markdown. A `.md` file there is a [document](./documents-on-disk.md) — reference material a worker reads. A `.ts` file there is code: a **capability** (a bundle of context, tools and resources a worker can carry) or a plain resource.

1. [`fsdev gen`](./code-on-disk.md) walks the tree and writes the modules onto a generated file of plain imports. Your app imports that file.
2. Each worker's own `WORKER.md` names which capabilities it wants, and which of their presets.

Nothing in your app's source names the capability. Nothing watches the folder.

## Writing one

A **capability** groups the things a worker needs to do one job — a piece of context, a tool, a resource — under a name, so attaching it is one line instead of three. A **preset** is a named slice of a capability that can be on or off, so one capability can carry more than one thing and a worker can take only what it needs.

```
workforce/teams/support/resources/
  handbook.md      ← a document, read as reference material
  research.ts      ← a capability
```

```ts
// research.ts
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

`default: []` means neither preset is on unless someone asks for it. Leave `default` out and every preset is on.

The file default-exports one value, and it has to be a capability or a resource. Anything else fails your own `tsc` against the generated file, naming the file.

A capability lives at the organization level or in a team. One inside a single **worker's** own `resources/` folder is refused by name, because every worker of a kind shares that kind's capabilities, so installing from one worker's folder would change all of them. A plain resource there is fine, and works like a document at that path.

## Running the command

`fsdev gen` walks every `resources/` folder the convention reads, along with the rest of the tree's code folders, and writes what it found onto `workforce.gen.ts`. The capabilities and resources land in one export:

```ts
import type { ResourceModules } from "@flow-state-dev/workforce";
import resource_teams__support__research from "./teams/support/resources/research";

export const resourceModules = {
  "teams/support/research": resource_teams__support__research,
} satisfies ResourceModules;
```

The key is the same [ref](./documents-on-disk.md#a-documents-ref) a document of that name in that folder would get, so a `.md` and a `.ts` of one name in one folder are refused at generation rather than one quietly winning.

Run it again after adding or removing a file, and give `fsdev gen --check` its own CI step: a stale generated file means a worker silently misses a capability. [Code on disk](./code-on-disk.md) covers the command, the rest of what it generates, and when it runs.

## Installing what it found

A capability and a resource have two destinations, so `splitResourceModules` separates them and your app writes the two lines:

```ts
import {
  defineAgentWorkerFlow,
  hireWorkforce,
  resourcesFromDocs,
  splitResourceModules,
} from "@flow-state-dev/workforce";
import { readWorkforce, readResourcesDirectory } from "@flow-state-dev/workforce/loader";
import { resourceModules } from "./workforce/workforce.gen";

const { capabilities, resources } = splitResourceModules(resourceModules);

const agent = defineAgentWorkerFlow({ uses: capabilities });

const { workers } = await readWorkforce("./workforce");
const seats = hireWorkforce(workers, { kinds: { agent } });
```

`capabilities` goes to the worker kind's `uses`, which is the same option you would pass a hand-written capability to. `resources` merges into the flow's resource map beside the Markdown documents:

```ts
const { documents } = await readResourcesDirectory("./workforce");
const flowResources = { ...resourcesFromDocs(documents), ...resources };
```

Nothing is installed on your behalf. You spread both, in your own source, the same way `resourcesFromDocs` works.

## What one worker picks up

A capability on a kind reaches every worker of that kind. A worker's own file says which of its presets that worker wants:

```md
---
description: Fields questions about how the desk is running this week.
capabilities:
  research: [briefing]
---

You answer questions about the support desk.
```

That worker gets the `briefing` context. A worker whose file says nothing gets the capability's own defaults, which for `research` above is nothing at all.

Two workers on one kind, differing only in those lines, answer differently.

Naming a preset **adds**. There is no spelling that turns one off. Which capabilities a workforce may reach is your app's call, made where you build the kind; a worker file picks among them. If you want a capability quieter for some workers, turn it down where you install it:

```ts
defineAgentWorkerFlow({ uses: [research.presets({ ledger: false })] });
```

An empty list (`research: []`) is the same as not naming the capability: the worker carries its defaults.

Only the built-in [`agent` kind](./built-in-worker.md) reads this key. A kind you write yourself reads whatever its own settings schema declares.

### Tools and controls in a preset {#a-preset-carrying-a-tool}

Presets carry tools as well as context. A worker with no `tools:` line that selects a preset gets both: the preset's context, and its tools to call. A worker that writes a `tools:` line can call [exactly the tools it lists](./built-in-worker.md#tools), whatever it selected, and `tools: []` gives it the context and no tool. That is how you give a worker a preset's guidance without its tools.

A preset can declare a **control** as well: framework machinery the capability builds itself, which a `tools:` list has no way to name. Controls go in the preset's [`controlTools`](/docs/advanced/capabilities-authoring#tools-and-controltools), and a worker that selects the preset gets them whatever its `tools:` says, `tools: []` included. One preset can hold both slots:

```ts
const dispatch = defineCapability({
  name: "dispatch",
  presets: {
    radio: {
      context: [radioGuidance],
      controlTools: [ping],  // reaches a worker that selects `radio`
      tools: [lookup],       // reaches a worker that selects `radio` and has no `tools:` line
    },
    default: [],
  },
});
```

A worker whose file selects `radio` gets the `radio` context and can call `ping` and `lookup`. With `tools: []` it gets the context and can call `ping` only.

A preset can also build its tools per turn, as a function instead of a list. A worker with no `tools:` line gets those as well.

### When a file is wrong

The whole selection is checked when the roster is hired, so a mistake is a refusal at startup rather than a failed answer in front of someone. A worker is refused, by name, when its file names:

| What | Why |
|------|-----|
| a capability the kind does not carry | The refusal lists what the kind does carry. |
| a preset the capability does not declare | The refusal lists the presets it declares. |
| a preset the app turned off where it installed the capability | A worker adds to what its kind carries and never widens past it. |
| a preset on a capability that takes config | A capability declared with a `config` block is resolved once, where you install it, so its presets are yours to set. |
| a preset that declares `resources`, a state schema, `model`, `providerOptions` or `caching` | Those have to exist before a request runs, so the preset is yours to turn on for the whole kind. |
| two presets that list different tools under the same name | One name is one tool. The refusal names the worker, the tool, and both presets; select one of them. |

Every bad selection on a worker is reported, not just the first.

## What this does not do

- It does not find anything at run time. `fsdev gen` reads the tree; the framework never opens a file your app wrote.
- It does not let a worker install a capability. A worker file picks among what the kind carries.
- It does not let a worker take something away. Selecting only adds.
- It does not pass on tools a worker didn't select. A capability your app installs on the kind can switch presets on by default, the way memory switches on `recall`. Those presets give their tools only to the workers whose own file selects them.
- It does not pass selected tools down to a delegate. When a worker hands work to another agent through a skill, that agent can call only tools the worker named in `tools:`.
- It does not affect `.md` files. A `.md` file in a `resources/` folder is still read as a document.

## Upgrading from @flow-state-dev/workforce 0.3 or earlier

A worker that selected a tool-bearing preset and had no `tools:` line used to get the preset's context only. It now gets the tools too. To keep the old reach, add `tools: []` to its file. A worker that already had a `tools:` line is unchanged.
