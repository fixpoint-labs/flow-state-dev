---
title: Kits and slots
type: reference
description: "The fields of defineKit, keyed and list slots, install order, a kit's folder, fill and without, and every refusal that stops an app from starting, with what each message names."
---

# Kits and slots

A kit is a feature an app installs: it brings flows, and often a folder of files the app owns. A slot is an opening a kit leaves so other kits can add to it, such as the harness kit's list of coding agents. [Kits and slots](../concepts/kits-and-slots.md) explains the idea. This page is the exact surface.

:::caution Experimental
Kits are experimental. `defineKit`, slots and the kit options can change between releases.
:::

The tables use the `support` app, which installs the three kits that ship with the framework:

```ts title="fsdev.config.ts"
import { claudeCode } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import { cursorHarness } from "@flow-state-dev/cursor";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";

const workspace = localWorkspaceHost({
  root: ".fsdev/runs",
  remotes: { allow: [] },
  localRepositories: ["."],
  source: () => ({ kind: "repo", repo: "." }),
});

export const app = createFlowState({
  kits: [
    claudeCode(),
    harnesses({ workspace, defaultHarness: "cursor" }),
    workforce({ agent: { model: "openai/gpt-6-luna" } }),
  ],
  fill: {
    [harnesses.slots.harnesses]: [codexHarness(), cursorHarness()],
  },
});
```

`claudeCode` is listed first and installs last. `fill` is the app's own contribution to a slot.

| Kit | Import | Requires | Declares | Folder |
| --- | --- | --- | --- | --- |
| `workforce` | `@flow-state-dev/workforce/kit` | none | `workerFlows` (keyed), `uses` (list), `flows` (keyed) | `workforce/` |
| `harnesses` | `@flow-state-dev/harness-manager/kit` | `workforce` | `harnesses` (keyed by each entry's `id`) | none |
| `claudeCode` | `@flow-state-dev/claude-code` | `harnesses` | none | none |

What each kit puts in which slot, and the `workspace` that `harnesses` requires, is on [Harness runs](./harness-runs.md).

## `defineKit` fields

`defineKit(definition)` from `@flow-state-dev/core` returns the kit's factory. An app calls the factory with the kit's config.

| Field | Required | What it is |
| --- | --- | --- |
| `name` | yes | Lowercase letters, digits and single hyphens, at most 64 characters, not `_meta`, not a Windows device name such as `con`. Unique in an app. It is half of every slot key. |
| `config` | no | A Zod schema the factory checks its argument against. Omitted: the kit takes no config. |
| `requires` | no | Factories of the kits this one depends on. It installs after them and may fill their slots, and the slots of any kit they require in turn. |
| `slots` | no | The slots this kit declares, by name. Only a kit that requires this one can fill them. |

| Field | Required | What it is |
| --- | --- | --- |
| `contributes` | no | `({ config, slots }) => record`. Returns what this kit puts in the slots of the kits it requires, keyed by slot key. |
| `directory` | no | `{ path, read }`. The folder the kit owns in the app. |
| `install` | yes | `({ config, folder, slots }) => { flows }`, sync or async. Builds the flows the kit serves. |

- `config` is the parsed config. `slots` is the kit's own slots, each merged and checked.
- `contributes` runs after every kit that requires this one has contributed, and after the app's `fill`. Its `slots` are complete.
- `install` receives `folder`, whatever `directory.read` returned, or `undefined` when the kit owns no folder.
- `install` returns `{ flows }`, the flows the kit serves. They are served beside the app's `flows` and registered at `ready()`.
- The factory takes the config plus an optional `directory: string`. When the schema accepts `{}`, the argument is optional.
- The factory carries `kitName` and `slots`, an object from slot name to slot key. For a kit named `board` with slots `columns` and `cards`, `board.slots` is `{ columns: "board.columns", cards: "board.cards" }`.
- Calling the factory returns a `KitInstance` with `kitName`, `definition`, `config` (as parsed), `directory`, `withheld` (the contributions `without` has dropped) and `without`.
- A kit's definition must not import Node modules. Read files only in `directory.read`.

A kit that fills `harnesses` writes the key through the factory, so it never spells the string:

```ts title="src/kits/review-harness.ts"
import { codexHarness } from "@flow-state-dev/codex";
import { defineKit } from "@flow-state-dev/core";
import { harnesses } from "@flow-state-dev/harness-manager/kit";

export const reviewKit = defineKit({
  name: "review-harness",
  requires: [harnesses],
  contributes: () => ({
    [harnesses.slots.harnesses]: [{ ...codexHarness(), id: "codex-review", label: "Codex review" }],
  }),
  install: () => ({ flows: [] }),
});
```

The entry is a plain harness value with its own `id`, which becomes its key.

### The harness value

A harness value has `id` (what a worker's `harness:` names and readiness rows are keyed by), `label`, `agent(feeds)` (the block one run runs), `readiness(check?)`, `pass` (environment variable names the run is given beside the base ones), and optional `usage` and `models`. The slot refuses an entry missing `id`, `agent`, `readiness` or `pass`. The `feeds` the manager hands `agent` are on [Harness runs](./harness-runs.md#the-result-handle).

## Keyed and list slots

Declare a slot with `slot.keyed(schema)` or `slot.list(schema)`, both from `@flow-state-dev/core`. Every entry is checked against the schema, and `install` receives the parsed value, with defaults applied.

| Slot | An entry is | `install` receives | Two entries with one key |
| --- | --- | --- | --- |
| `keyed` | A record, or an array of entries that each carry a string `id`, which becomes the key | A read-only record with no prototype | Refused, naming both. The app's `fill` counts as a contributor. |
| `list` | One entry or an array, appended | A read-only array | Not applicable |

A list holds entries in install order, whatever order `contributes` ran in, then the app's `fill`. Two kits that do not require each other contribute in the order the app listed them. A slot nobody contributes to is an empty record or an empty array, so `install` always receives every slot its kit declares.

## Who may fill a slot

A kit fills a slot by naming the owner's factory: `{ [owner.slots.name]: entries }`. The key is `<kit>.<slot>`.

- A kit may fill the slots of a kit it requires, directly or through another. If `d` requires `c` and `c` requires `b`, `d` may fill `b`'s slots.
- The app's `fill` may fill any declared slot, with no requirement check.
- A fill of a slot no installed kit declares is refused, from a kit or from the app.

## Install order

| Rule | Detail |
| --- | --- |
| Dependency order | Each kit installs after every kit it requires, whatever order the app listed them in. `[d(), b(), c()]` installs `b`, `c`, `d`. |
| Listed order | Two kits where neither requires the other keep the order the app listed them. |
| A required kit must be listed | Requiring a kit that is not in `kits` is refused. |
| Contributions | `contributes` runs dependents first, so a kit's slots are finished before it reads them. Every contribution is merged before any `install` runs. |
| Two moments | `createFlowState(...)` is synchronous and plans the kits: order, slots, folders. `ready()` reads the folders, then runs every `install` in order. |

`requires` takes a factory, so a kit can only require a kit defined before it.

## A kit's folder

`directory: { path, read }` gives a kit a folder in the app. An app can pass another folder as `directory` in the kit's config. The kit reads the folder's files at start and never writes to them.

| Rule | Detail |
| --- | --- |
| Where the folder is read from | The kit's `path` is read against the app's `root`. `root` is a path, or a URL whose directory is used (such as `import.meta.url`), and defaults to the working directory. A `directory` the app passes in the kit's config is read against the working directory, whatever `root` is. |
| When it is read | At `ready()`, after every kit is planned and before any `install`. A refusal installs nothing. |
| What `read` receives | A `KitFolder`: `path` (absolute) and `claim(relativePath)`. Claiming a directory claims everything under it; `"."` claims the whole folder. A claim that is absolute or leaves the folder throws. |
| Unclaimed entries | Every entry no `read` call claimed stops the app, except `.DS_Store` and `Thumbs.db`. The error names the topmost unclaimed entry, so a stray directory is one line. |
| Symlinks | Refused anywhere in the folder, claimed or not. A symlinked folder root is refused too. |
| Bad paths | A path spelled with a `..` that steps back through an earlier segment is refused. A missing folder is reported as missing, in the table below. |
| Shared folders | Two kits reading one folder are refused by `createFlowState`. Each owns its own. |

What `workforce` claims from `workforce/` is on [Workforce folder](./workforce-folder.md).

## `fill` and `without`

`fill` is an option of `createFlowState`: a record from slot key to entries. A keyed slot takes a record, or a list of entries that each carry a string `id`. A list slot appends the app's entries after every kit's.

Harnesses show both ways to fill a slot, from the app's `fill` or from a kit. `codexHarness()` and `cursorHarness()` return a plain harness value and install nothing, so the app puts them in `fill`. `claudeCode()` installs a flow of its own, so it is a kit that requires `harnesses` and fills the slot itself.

`without(slotKey, key?)` is a method on a kit instance. It returns a copy of the kit with its contribution to `slotKey` dropped. List the copy in `kits`.

```ts title="fsdev.config.ts"
import { claudeCode } from "@flow-state-dev/claude-code";
import { codexHarness } from "@flow-state-dev/codex";
import { createFlowState } from "@flow-state-dev/engine";
import { harnesses } from "@flow-state-dev/harness-manager/kit";
import { localWorkspaceHost } from "@flow-state-dev/workspace";
import { workforce } from "@flow-state-dev/workforce/kit";

const workspace = localWorkspaceHost({
  root: ".fsdev/runs",
  remotes: { allow: [] },
  localRepositories: ["."],
  source: () => ({ kind: "repo", repo: "." }),
});

export const app = createFlowState({
  kits: [
    workforce({ agent: { model: "openai/gpt-6-luna" } }),
    harnesses({ workspace }).without(workforce.slots.workerFlows, "coder"),
    claudeCode().without(harnesses.slots.harnesses, "claude-code"),
  ],
  fill: { [harnesses.slots.harnesses]: [codexHarness()] },
});
```

`fill` supplies a harness because dropping `claude-code` leaves the `harnesses` slot empty, which the harness kit refuses.

| Call | What it drops |
| --- | --- |
| `kit().without(slotKey)` | The whole of that kit's contribution to the slot. Other kits' entries stay. |
| `kit().without(slotKey, key)` | One key of a keyed slot. The kit's other entries stay. |
| Chained `without` calls | They add up. Each returns a new instance and leaves the original as it was. |

A dropped entry is not checked against the slot's schema and cannot collide with another. A `key` on a list slot has no effect, and a `without` naming a slot the kit does not contribute to does nothing and raises no error.

A drop can break a worker that depended on it. A worker file that says `flow: coder` in the app above is refused at `ready()`; the message is on [Workforce](./workforce.md).

## What stops an app from starting

Each message names what is at fault: the kit, slot and key, or the folder entry, worker or flow. A refusal comes from:

1. **Calling a factory**, which throws from that call.
2. **`createFlowState(...)`**, which throws a `FlowStateConfigError` synchronously. One problem reads `createFlowState: <problem>`. Several read `createFlowState: the kits can't be installed:` with a `  - <problem>` line each, so every problem shows at once.
3. **`ready()`**, which rejects when a folder, a worker or a worker flow is refused. Calling `ready()` again, or `getRuntime()`, rejects with the same error.

In the messages below, `<who>` is `kit "<name>"` or `the app`.

### Calling a factory

| Problem | The message starts |
| --- | --- |
| Config fails the schema | `kit "<name>": its config is invalid: <path>: <message>`, with `(config)` when the path is empty |
| Config given to a kit that takes none | `kit "<name>" takes no config, but was given "<key>"` |
| `directory` given to a kit that owns no folder | `kit "<name>": ` and a note that `directory` is set but the kit owns no folder |
| `directory` is not a string | `kit "<name>": ` and a note that `directory` must be a path |
| Kit name breaks the naming rule | `defineKit: kit name "<name>" must be lowercase letters, digits and single hyphens ...`, thrown by `defineKit`, not by the factory |

### At `createFlowState`: the kit list

| Problem | The message |
| --- | --- |
| A kit listed twice | `kit "<name>" is listed twice; a kit installs once per app.` |
| A required kit not listed | `kit "<name>" requires kit "<needed>", which is not installed.` |
| Kits that require each other | `kits require each other: "<a>", "<b>".` It names every kit that can't be ordered: the kits in the cycle and every kit that requires one of them. |
| A fill of a slot nobody declares | `<who> fills slot "<key>", which no installed kit declares.` |
| A fill from a kit that does not require the owner | `kit "<filler>" fills slot "<key>", but does not require kit "<owner>", which declares it.` |
| Two kits on one folder | `kits "<a>" and "<b>" both read the folder "<path>"; each kit owns its own.` |

### At `createFlowState`: the entries

| Problem | The message |
| --- | --- |
| A key given twice | `slot "<key>": the key "<k>" is filled by <first> and by <second>.` The earlier in install order is first. |
| An entry with no `id` for a keyed slot | ``slot "<key>" is keyed, but <who> gave it an entry with no string `id` to key it by.`` |
| A keyed slot given neither a record nor a list | `slot "<key>" is keyed, but <who> gave it something other than a record or a list of entries.` |
| An entry the schema refuses | `slot "<key>": <who> gave an entry its schema refuses: <issues>.` On a keyed slot it reads `gave the entry "<k>" its schema refuses`. |

A kit's `contributes` can refuse too, and that throws from `createFlowState` as well. The harness kit throws for these:

| Problem | The message |
| --- | --- |
| A bad `harnesses(config)` option: an unknown key, a missing `workspace`, an empty `defaultHarness`, `idleTimeoutMs: 0`, a negative `runTimeoutMs`, `checks.timeoutMs: 0` or a bad `branchPrefix` | Thrown when `harnesses(config)` is called, and names the key. |
| An empty `harnesses` slot | ``coder: no harness is filled; fill the harness kit's `harnesses` slot.`` |
| A `defaultHarness` nobody filled | `coder: the default harness "<id>" is not one of <ids>.` |

A worker whose `harness:` names a harness nobody filled is refused at `ready()`, below. That includes `claude-code-plan` when `claudeCode()` was not given `plan: true`.

### At `ready()`: folders

`ready()` rejects with `createFlowState: the app can't start; a kit's folder was refused:` and one `  - kit "<name>": <message>` line per refusal, across every kit, all at once and before any `install`. A line about an entry in the folder ends with `(<folder>)`. A line about a folder that cannot be opened, or a `read` that throws, does not.

| What is wrong | The message |
| --- | --- |
| An entry no `read` call claimed, file or directory (the topmost one is named) | `"<path>" is not used by anything that reads the folder of kit "<name>". Remove it.` |
| A symlink in the folder | `Symlinked entry "<path>"` |
| An entry that cannot be read | `Entry "<path>" could not be read: <cause>`, or `Folder "<path>"` for a directory |
| The folder is missing or unreadable | `Failed to read folder of kit "<name>" "<path>": <cause>` |
| The folder is a symlink, or is spelled with a `..` that steps back | `Symlinked folder of kit "<name>" "<path>"`, or `Folder of kit "<name>" "<path>" is spelled with a ".." that steps back through an earlier segment` |
| A `read` call that throws | The message it threw |
| A workforce file that did not load | `kit "workforce": the workforce folder did not load:`, described on [Workforce folder](./workforce-folder.md) |

### At `ready()`: workers and worker flows

`ready()` also refuses a worker whose `harness:` names a harness nobody filled, a worker file that names a flow no kit serves, and a worker flow whose `respond` action is missing or doesn't take a user's message. Each message names the worker or flow and starts with `hireWorkforce`. The rows are on [Workforce](./workforce.md). A worker with no `harness:` and no `defaultHarness` fails when its task starts, described on [Harness runs](./harness-runs.md). Switching the `coder` flow off with `.without(workforce.slots.workerFlows, "coder")` makes a worker that names it fail the same refusal: ``names flow "coder", which is not in the worker flows passed to hireWorkforce``.
