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

## If you know plugins

You list a kit in your config and it adds a feature, as a plugin does. The difference is who knows whom. A kit declares typed openings, and another kit fills one by naming it. The kit that owns the opening has never heard of the kit that fills it.

<Figure svg={TheChain} caption="Three kits, each filling the slot below it" description={"Three boxes side by side. On the left, the workforce kit, which opens a slot named workerFlows. In the middle, the harnesses kit, which holds a coder entry and a slot of its own named harnesses; that slot is highlighted because the kit both fills a slot and opens one. On the right, the claudeCode kit, which holds one entry, Claude Code. An arrow runs from the coder entry to workerFlows, and another from the Claude Code entry to the harnesses slot; each means fills a slot. Notes say workforce has never heard of harnesses or claudeCode, harnesses adds a coder flow to workforce and opens a slot of its own, and claudeCode fills the slot harnesses opened."} />

## Three kits in a config file

The example is a help desk that adds a team of workers and a coding agent.

{/* Reconcile at cutover: workforce, harnesses and claudeCode are specified and not yet exported; their import paths and config are placeholders. */}

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { claudeCode } from "@flow-state-dev/claude-code";
import { harnesses } from "@flow-state-dev/harnesses";
import { workforce } from "@flow-state-dev/workforce";
import helpDeskFlow from "./src/flows/help-desk/flow";

export default createFlowState({
  kits: [claudeCode({}), workforce({ directory: "./workforce" }), harnesses({})],
  flows: [helpDeskFlow],
});
```

`workforce` brings a team of workers. `harnesses` adds a `coder` flow to it, and `claudeCode` supplies Claude Code to `harnesses`. A flow is a self-contained system inside your app that clients can call, and the kits' flows are served beside `help-desk`.

Order in `kits` doesn't matter. Kits install in the order they require each other: `workforce`, then `harnesses`, then `claudeCode`. [Kits reference](../reference/kits.md) has the rule.

## What a kit brings

<Figure svg={WhatAKitBrings} caption="One entry in kits, and what comes with it" description={"A large box for your app, fsdev.config.ts. Inside it, a small box for your own flow, help-desk, and a larger box for the workforce kit, highlighted as the one entry in kits. The kit box holds three parts side by side: its flows, served beside your own; a folder it reads, workforce/, with one WORKER.md per worker; and its views, which includes roster. An arrow labelled reads runs from the views box down to a hatched box, hired workers, which is stored data that outlives the request."} />

Beside flows, a kit can bring:

- **Config.** The options your app passes when it calls the kit, checked at that call. [Kits reference](../reference/kits.md) has the checks.
- **A folder.** `workforce` reads `workforce/`, one `WORKER.md` file per worker, when the app starts. The per-path rules are in the [Kits reference](../reference/kits.md).
- **Views.** The views, resources and capabilities of a kit's flows come with them. [Views](./views.md) shows what a screen reads.

## A slot

The kit that owns a slot declares it and says what an entry looks like. `workforce` declares `workerFlows`. Every entry is checked against that declaration, and the owner receives what was filled in.

The `harnesses` slot below is a list: every entry is appended. [Kits reference](../reference/kits.md) has the keyed alternative.

A contribution goes in by the slot's key, which you read off the kit instead of typing it: `workforce.slots.workerFlows`. A kit can fill a slot only if it requires the owner. [Kits reference](../reference/kits.md) has the rule.

## A kit that fills one can open another

Here is `harnesses`, cut down to its shape.

{/* Reconcile at cutover: harnesses is specified and not yet built; this is the plan's illustration. */}

```ts title="harnesses/kit.ts"
import { defineKit, slot } from "@flow-state-dev/core";
import { workforce } from "@flow-state-dev/workforce";
import { z } from "zod";
import { coderFlow } from "./coder-flow";

export const harnesses = defineKit({
  name: "harnesses",
  requires: [workforce],
  slots: { harnesses: slot.list(z.object({ name: z.string() })) },
  contributes: ({ slots }) => ({
    [workforce.slots.workerFlows]: { coder: coderFlow(slots.harnesses) },
  }),
  install: () => ({ flows: [] }),
});
```

`coderFlow` builds the `coder` flow from the harnesses it is given. `requires` makes `harnesses` install after `workforce` and lets it fill its slots. `contributes` puts `coder` in `workerFlows`, and `workforce` serves it as one of its own.

`slots` opens `harnesses`' own slot. `contributes` runs once the slot is full, so `coderFlow` receives every harness in it: `claudeCode`'s, and any your app adds (below). `install` returns the flows the kit serves itself. `harnesses` serves none, because its `coder` flow goes into `workforce`.

## Filling a slot from your app

Say you want Codex beside Claude Code. The slot is the one `harnesses` opened, and your app fills it from `fsdev.config.ts`.

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { claudeCode } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import { harnesses } from "@flow-state-dev/harnesses";
import { workforce } from "@flow-state-dev/workforce";
import helpDeskFlow from "./src/flows/help-desk/flow";

export default createFlowState({
  kits: [claudeCode({}), workforce({ directory: "./workforce" }), harnesses({})],
  flows: [helpDeskFlow],
  fill: { [harnesses.slots.harnesses]: [codexHarness()] },
});
```

<Figure svg={YourAppFillsASlot} caption="The app fills a slot the way a kit does" description={"On the left, two boxes. The top one is the claudeCode kit, holding a Claude Code entry. The bottom one is your app, fsdev.config.ts, holding a codexHarness() entry, highlighted as the app's own entry. On the right, one box for the slot harnesses.slots.harnesses, opened by harnesses, holding a Claude Code row and a Codex row, with a note that every entry is checked against the slot's type. Two arrows, each meaning fills a slot, run from the two entries into the two rows. A line below says the app names the slot by its key, the way a kit does."} />

To drop what a kit contributes, call `without` on it: `claudeCode({}).without(harnesses.slots.harnesses)`. [Kits reference](../reference/kits.md) has the rest of `fill` and `without`.

## What it gets you

- **One entry adds a feature.** Listing `workforce` serves its flows beside `help-desk`, with no wiring.
- **Features stack without edits.** `harnesses` adds a flow to `workforce`, and `claudeCode` adds to `harnesses`. Neither kit underneath changes.
- **Mistakes stop at start-up.** A bad fill throws when `createFlowState` runs, naming the kit and the slot. [Kits reference](../reference/kits.md) lists each error.

## How it fits with the others

A [capability](./capabilities.md) is a bundle of resources, state and helpers that a block pulls in with `uses`. If you're packaging something for other apps, ask what it is. Is it a piece several blocks share? Make it a capability. Does it serve its own flows, take config, read a folder or leave openings? Make it a kit. One flow on its own is a flow, listed in `flows`.

## Next

- [Views](./views.md): what a kit's screens read, and how they refresh.
- [Write a kit](../build/write-a-kit.md): package your own feature, open a slot and publish it.
- [Kits reference](../reference/kits.md): every `defineKit` option, the slot types and each start-up error.
