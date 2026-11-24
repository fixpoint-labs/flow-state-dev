---
title: Catalog
type: catalog
description: The three shelves of what you can install or copy, and how to pick between a starter, a kit and a library.
---

# Catalog

Flow State ships as a runtime plus things you add to it. What you add comes in one of three shapes: a whole app to start from (a starter), a feature to add to your app (a kit), or a function to call (a library). The catalog sorts everything by which of those it is, so you can pick by what you want to do and not by package name.

Everything on the three shelves is optional. You can ship a flow without any of it.

## Starters

A starter is a whole app you open, run and reshape. You copy it and change it; you do not install it into another app.

| Starter | What it is |
| --- | --- |
| `labs/claude-code-style` | A Claude Code-style app on the workforce package: sessions on the left, the main thread in the center, background tasks on the right. |
| `labs/teammates` | An app on the workforce package: a list of workers on the left, each with one long conversation, and workers that message each other where you can see it. |

Both apps in `labs/` are research software, and parts of each are not wired up. No `fsdev` command scaffolds an app from one: a starter is a folder in the repository to read and copy.

`@flow-state-dev/shift-manager` is an app you run as it is, not one you copy. It is a browser app for running a team of workers: see what is waiting on you and what is running, watch a worker's task as it happens and stop it, and browse teams, projects and boards. Install it with `npm install @flow-state-dev/shift-manager`, then run `npx shift-manager --config ./fsdev.config.mts`. It is research software too, and some screens are placeholders.

If you want a smaller app to begin with, `examples/hello-chat` is a chat flow in about 50 lines with a Next.js UI. The [quick start](../start/run-a-starter.md) walks through it.

## Kits

A kit packages a feature so an app installs it with one config object. An app lists its kits in `createFlowState({ kits })`, each one called with its config, as in `kits: [workforce({ agent: { model: "openai/gpt-6-luna" } })]`.

A kit brings its own flows, and may leave typed openings, called slots, for other kits to fill. A kit can require another kit; list them in any order. [Kits and slots](../concepts/kits-and-slots.md) covers how they fit together.

| Kit | Package | What you get |
| --- | --- | --- |
| `workforce` | `@flow-state-dev/workforce` | Named workers read from your app's `workforce/` folder, with a roster flow and one flow per worker. |
| `harnesses` | `@flow-state-dev/harness-manager` | A `coder` worker, and a `harnesses` flow with a `readiness` view listing each coding harness you have added and whether it is ready. Requires `workforce`. |
| `claudeCode` | `@flow-state-dev/claude-code` | Claude Code as a harness, filled into the `harnesses` slot. Requires `harnesses`. |

Codex and Cursor are not kits: `codexHarness` and `cursorHarness` are plain values you put in the `harnesses` slot yourself. The [Kits reference](../reference/kits.md) shows how.

## From the community

A kit is the value `defineKit` returns, and any package can export one. An app installs it the same way as the three above: install the package, then list the kit in `kits`.

## Libraries

A library is a package you import from. It has no slots and no folder in your app, and nothing goes into `kits`. Import a function or a block and call it.

| Library | What it gives you |
| --- | --- |
| `@flow-state-dev/tools` | Tool blocks. Each is a handler block you pass straight to a generator's `tools` array. |
| `@flow-state-dev/memory` | Cross-turn memory in four optional tiers (working, episodic, semantic, digest), wired into a generator with one line. |
| `@flow-state-dev/patterns` | Reference implementations of established composition patterns, such as `planAndExecute` and `supervisor`. |
| `@flow-state-dev/orchestration` | Tasks and a task board that agents share, plus skills: `SKILL.md` folders injected as inline instructions. |
| `@flow-state-dev/workspace` | Writes files from resource collections into a directory an agent works in, then syncs its changes back. |

Install any of them with `npm install` and its package name.

## Which one do I want

| You want | Shelf |
| --- | --- |
| A whole app to open, run and reshape | Starter |
| A feature to add to an app you already have, with flows of its own and slots for other kits | Kit |
| A function or block to import and call | Library |

The shelves stack. Both `labs/` starters are built on the `workforce` kit.

## Next

- [Kits and slots](../concepts/kits-and-slots.md): what a kit declares, and how kits fill each other's slots.
- [Workers](../concepts/workers.md): the named agents both starters are built around.
