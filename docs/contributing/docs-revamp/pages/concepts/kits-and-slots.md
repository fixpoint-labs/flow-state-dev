---
title: Kits and slots
type: concept
description: A kit is a feature an app installs with one entry in its config. A slot is an opening a kit leaves for other kits, or your app, to fill.
---

import Figure from "@site/src/components/Figure";
import TheChain from "./figures/the-chain.svg";
import WhatAKitBrings from "./figures/what-a-kit-brings.svg";
import YourAppFillsASlot from "./figures/your-app-fills-a-slot.svg";

# Kits and slots

A kit is a feature packaged so your app installs it with one entry in its config. It brings the code that does the work, the config that code takes, and a folder of files in your repo that it reads. A slot is an opening a kit leaves so other kits, or your app, can add to it.

:::caution Experimental
Kits are experimental. `defineKit`, slots and the kit options can change between releases.
:::

## If you know plugins

You list a kit in your config and it adds a feature, as a plugin does. The difference is who knows whom. A kit declares typed openings, and another kit fills one by naming it. The kit that owns the opening has never heard of the kit that fills it.

<Figure svg={TheChain} caption="Three kits in a chain, each filling the last one's slot" description={"Three boxes side by side. On the left, the workforce kit, which opens a slot named workerFlows. In the middle, the harnesses kit, which holds a coder entry and a slot of its own named harnesses; that slot is highlighted because the kit both fills a slot and opens one. On the right, the claudeCode kit, which holds one entry, Claude Code. An arrow runs from the coder entry to workerFlows, and another from the Claude Code entry to the harnesses slot; each means fills a slot. Notes say workforce has never heard of harnesses or claudeCode, harnesses adds a coder flow to workforce and opens a slot of its own, and claudeCode fills the slot harnesses opened."} />

## Three kits in a config file

The example is a help desk that adds a team of workers and a coding agent.

```ts title="fsdev.config.ts"
import { claudeCode } from "@flow-state-dev/claude-code";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";
import helpDeskFlow from "./src/flows/help-desk/flow";

const repo = process.cwd();

const workspace = localWorkspaceHost({
  root: ".fsdev/runs",
  remotes: { allow: [] },
  localRepositories: [repo],
  source: () => ({ kind: "repo", repo }),
});

export default createFlowState({
  kits: [
    claudeCode(),
    workforce({ agent: { model: "openai/gpt-6-luna" } }),
    harnesses({ workspace }),
  ],
  flows: [helpDeskFlow],
});
```

`workforce` brings a team of workers. `harnesses` adds a `coder` flow to it, and `claudeCode` supplies Claude Code to `harnesses`. `workspace` is the one option `harnesses` requires: where each coding run gets its own checkout of this repo. A flow is a self-contained system inside your app that clients can call, and the kits' flows are served beside `help-desk`.

You don't have to list kits in the order they need each other. Each step installs the first listed kit whose required kits are already installed, so this app installs `workforce`, then `harnesses`, then `claudeCode`. Two kits that don't require each other can install out of listed order, when the one listed first is waiting on a requirement. A missing kit does matter: delete `workforce(...)` and keep `harnesses({ workspace })`, and the app refuses to start, naming the kit `harnesses` needs. [Kits reference](../reference/kits.md#install-order) has the rule.

## What a kit brings

<Figure svg={WhatAKitBrings} caption="One entry in kits, and what comes with it" description={"A large box for your app, fsdev.config.ts. Inside it, a small box for your own flow, help-desk, and a larger box for the workforce kit, highlighted as the one entry in kits. The kit box holds three parts side by side: its flows, served beside your own; a folder it reads, workforce/, with one WORKER.md per worker; and its views, which includes roster. An arrow labelled reads runs from the views box down to a hatched box, hired workers, which is stored data that outlives the request."} />

Beside flows, a kit can bring:

- **Config.** The options your app passes when it calls the kit, checked at that call. The [Kits reference](../reference/kits.md) lists the checks.
- **A folder.** `workforce` reads `workforce/`, one `WORKER.md` file per worker, when the app starts. Anything else left in that folder, such as a stray `notes.txt`, stops the app from starting and is named in the error; the [per-path rules](../reference/workforce-folder.md#paths-the-kit-reads) say which files count.
- **Views.** A kit's flows bring their views, resources and capabilities with them. [Views](./views.md) shows what a screen reads.

## A slot

The kit that owns a slot declares it and says what an entry looks like. `workforce` declares `workerFlows`. Every entry is checked against that declaration, and the owner receives what was filled in.

A contribution goes in by the slot's key, which you read off the kit instead of typing it: `workforce.slots.workerFlows`. A kit can fill a slot only if it requires the owner, directly or through another kit, and the [requires rule](../reference/kits.md#who-may-fill-a-slot) is in the reference.

## A kit that fills one can open another

Here is `harnesses`, cut down to its shape.

```ts title="harnesses/kit.ts"
import { defineKit, slot } from "@flow-state-dev/core";
import type { WorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";
import { z } from "zod";
import { coderFlow } from "./coder-flow";
import { harnessSchema } from "./harness";

export const harnesses = defineKit({
  name: "harnesses",
  requires: [workforce],
  config: z.object({
    workspace: z.custom<WorkspaceHost>((value) => typeof value === "object" && value !== null),
  }),
  slots: { harnesses: slot.keyed(harnessSchema) },
  contributes: ({ config, slots }) => ({
    [workforce.slots.workerFlows]: { coder: coderFlow(config, slots.harnesses) },
  }),
  install: () => ({ flows: [] }),
});
```

`config` is the schema the factory checks its argument against, so `harnesses()` with no `workspace` throws at the call. `requires` makes `harnesses` install after `workforce` and lets it fill `workforce`'s slots. `contributes` puts `coderFlow`'s result in `workerFlows` under the key `coder`, and `workforce` serves it as one of its own.

`slots` opens `harnesses`' own slot, and `slot.keyed` makes it keyed: each harness carries an `id`, and the `id` becomes its key. Claude Code's is `claude-code`, and a worker picks a harness by that key. Two entries with the same key stop the app, naming both. `coderFlow` receives every harness in the slot, by key: `claudeCode`'s, and any your app adds (below). ([List slots](../reference/kits.md#keyed-and-list-slots) append every entry instead.)

`install` returns the flows the kit serves itself. This one returns none: what it brings goes into `workforce`'s slots. The real kit fills two more of them, with a readiness check and a `harnesses` flow, and [Harness runs](../reference/harness-runs.md#what-the-kit-adds) lists both.

## Filling a slot from your app

Say you want Codex beside Claude Code. The slot is the one `harnesses` opened, and your app fills it from `fsdev.config.ts`.

```ts title="fsdev.config.ts"
import { claudeCode } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { workforce } from "@flow-state-dev/workforce/kit";
import helpDeskFlow from "./src/flows/help-desk/flow";
// workspace as in the first example

export default createFlowState({
  kits: [
    claudeCode(),
    workforce({ agent: { model: "openai/gpt-6-luna" } }),
    harnesses({ workspace }),
  ],
  flows: [helpDeskFlow],
  fill: { [harnesses.slots.harnesses]: [codexHarness()] },
});
```

`codexHarness()` carries the `id` `codex`, so the slot holds `claude-code` and `codex`.

<Figure svg={YourAppFillsASlot} caption="The app fills a slot the way a kit does" description={"On the left, two boxes. The top one is the claudeCode kit, holding a Claude Code entry. The bottom one is your app, fsdev.config.ts, holding a codexHarness() entry, highlighted as the app's own entry. On the right, one box for the slot harnesses.slots.harnesses, opened by harnesses, holding a Claude Code row and a Codex row, with a note that every entry is checked against the slot's type. Two arrows, each meaning fills a slot, run from the two entries into the two rows. A line below says the app names the slot by its key, the way a kit does."} />

To drop what a kit contributes, call `without` on it: `claudeCode().without(harnesses.slots.harnesses, "claude-code")` leaves only Codex in the slot. The reference covers [the rest of `fill` and `without`](../reference/kits.md#fill-and-without).

## What it gets you

- **One entry adds a feature.** Listing `workforce` serves its flows beside `help-desk`, with no wiring.
- **Features stack without edits.** `harnesses` adds a flow to `workforce`, and `claudeCode` adds to `harnesses`. Neither kit underneath changes.
- **Mistakes stop at start-up.** A bad fill throws when `createFlowState` runs, naming the kit and the slot, and the reference lists [each error](../reference/kits.md).

## How it fits with the others

A [capability](./capabilities.md) is a bundle of resources, state and helpers that a block pulls in with `uses`. If you're packaging something for other apps, ask what it is. Is it a piece several blocks share? Make it a capability. Does it serve its own flows, take config, read a folder or leave openings? Make it a kit. One flow on its own is a flow, listed in `flows`.

## Next

- [Views](./views.md): what a kit's screens read, and how they refresh.
- [Write a kit](../build/write-a-kit.md): package your own feature, open a slot and publish it.
- [Kits reference](../reference/kits.md): every `defineKit` option, the slot types and each start-up error.
