---
title: From the community
type: catalog
description: Kits that other people publish, how an app uses one, and what the shelf holds today.
---

# From the community

A kit is a feature packaged so an app installs it with one config object. The three that ship with Flow State sit on the [Catalog](./index.md) page. This page is the shelf for kits written and published by other people, so you can find a feature someone has already built instead of writing it yourself.

The shelf has no entries yet.

:::caution Experimental
Kits are experimental. `defineKit`, slots and the kit options can change between releases.
:::

## What goes here

A community kit is an ordinary kit that a package outside the Flow State repository exports. `defineKit` from `@flow-state-dev/core` returns a function called a kit factory, and that factory is what the package exports. The app calls the factory with the kit's config, and the call returns the kit to list in `kits`.

A community kit follows the same rules as the three that ship. It has a unique name. It lists in `requires` every kit it depends on, including any kit whose slot it fills. A slot is an opening one kit leaves for another kit to supply a piece. If a kit breaks one of these rules, the app does not start. The [Kits reference](../reference/kits.md#what-stops-an-app-from-starting) lists each of those errors and its message, and shows the shape of a kit definition.

## Use one

In this section, `@acme/flow-state-board` and its `board` factory are placeholders. Put the real package's name and factory in their place. Install the package:

```bash
npm install @acme/flow-state-board
```

Then call its factory and list the result in `kits`, in any order:

```ts title="app.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";
import { board } from "@acme/flow-state-board";

export const app = createFlowState({
  kits: [
    workforce({ agent: { model: "openai/gpt-6-luna" } }),
    board({}), // the config object is whatever the kit's package documents
  ],
});
```

An app uses only the kits in that list. Installing a package adds nothing by itself.

## Is there a registry?

Apart from this page, Flow State has no list of kits. `fsdev` has no command to search for, list or install one, and an installed package is never picked up on its own.

## Add yours

Write the kit and publish it as a package. [Write a kit](../build/write-a-kit.md) walks through it, from the flow to the published package.
