---
title: The workforce folder
type: reference
description: "Every path the workforce kit reads from workforce/ and what it becomes, the naming rules and the names refused, who holds a document, skill or package by where it sits, what fsdev gen generates, and when an edit takes effect."
---

# The workforce folder

The workforce kit builds a team of workers from one folder, `workforce/`, in your repo. A worker is a named agent a user talks to. A standard worker is one a `WORKER.md` file in the tree declares: the same for every user, changed only by a deploy. The folder holds the workers, the documents and skills they read, the packages they hold and the code they run, and where a file sits decides which workers get it.

This page lists what the kit reads and what each thing becomes. The Workforce catalog's [folder page](../catalog/workforce/the-workforce-folder.md) introduces the idea and the settings of a worker are in [`WORKER.md`](./worker-md.md). The tables use the `support` team of one app.

```text title="workforce/"
teams/support/TEAM.md
teams/support/references/handbook.md
teams/support/resources/research.ts
teams/support/packages/escalation/PACKAGE.md
teams/support/skills/review/SKILL.md
teams/support/blocks/search-docs.ts
teams/support/workers/lead/WORKER.md
teams/support/workers/lead/blocks/fetch.ts
org/workers/shift-coordinator/WORKER.md
org/references/style-guide.md
flows/workers/triage-agent.ts
blocks/send-email.ts
workforce.gen.ts
```

## Starting the folder

The kit reads the folder once, when the app starts.

| Question | Answer |
| --- | --- |
| Where is the folder? | `workforce`, against the app's `root` (`createFlowState({ root })`, a path or a URL such as `import.meta.url`; default the working directory). `workforce({ directory: "./path" })` replaces it, read against the working directory as typed. `directory` must be a string. |
| What is the smallest tree? | One `WORKER.md` with a `description`: `teams/core/workers/lead/WORKER.md` gives the worker `core.lead`. An existing empty folder also starts, serving the `agent` and `workforce-roster` flows. |
| What if the folder is missing? | The app stops: `Failed to read folder of kit "workforce" "<path>": ENOENT ...`. An unreadable folder stops it the same way. |
| What if the folder is a symlink? | The app stops: `Symlinked folder of kit "workforce" "<path>" — refused for safety`. A symlink anywhere inside it stops the app too. |
| What if a file is in the wrong place? | The app stops and names the path. Only `.DS_Store` and `Thumbs.db` are ignored. |
| What if a file fails to load? | The app stops and names the file. While any load problem exists only load problems are reported; the wrong-place list appears once they are fixed. |

An unused folder is reported once, by its own path (`teams/core/tools`), not once per file inside it. Every problem across every kit is listed at once:

```text title="Startup error"
createFlowState: the app can't start; a kit's folder was refused:
  - kit "workforce": "notes.txt" is not used by anything that reads the folder of kit "workforce". Remove it. (<folder>)
  - kit "workforce": "teams/core/tools" is not used by anything that reads the folder of kit "workforce". Remove it. (<folder>)
```

A load problem is a different message: `the workforce folder did not load:`, then one `  - <layer> <path>: <message>` line each. The layers are `worker`, `skill`, `team`, `package`, `document` and `reference`. A refusal inside a package stops the app, with its own `package` line.

The kit serves one copy of each worker flow in the tree, the built-in `agent` flow, the `workforce-roster` flow, and `coordinator` when you configure it. They are in [Workforce](./workforce.md). The kit installs the folder's documents and references on its own; there is nothing to wire. The general rules for any kit's folder are in [Kits and slots](./kits.md#a-kits-folder).

## Paths the kit reads

A level is one of four places: `org`, `teams/<team>`, `org/workers/<worker>` or `teams/<team>/workers/<worker>`.

### Workers and instructions

| Path under `workforce/` | What it becomes |
| --- | --- |
| `teams/<team>/workers/<worker>/WORKER.md` | The standard worker `<team>.<worker>`. |
| `org/workers/<worker>/WORKER.md` | The standard worker `<worker>`, with no team. |
| `teams/<team>/TEAM.md` | The team's description, and the instructions every worker on the team is told. |

A team worker's id always has a dot, so `shift-coordinator` and `eng.shift-coordinator` are two workers.

### Documents, skills and packages

| Path | What it becomes |
| --- | --- |
| `<level>/references/<name>.md` | A reference: a read-only document, read from the file. |
| `<level>/resources/<name>.md` | A document a worker can write. The file is its starting text. |
| `<level>/resources/<name>.ts` or `.tsx` | A capability, or a resource declared in code. |
| `<level>/skills/<name>/SKILL.md`, and any file beside it in that folder | A skill the workers at that level hold. |
| `<level>/packages/<name>/PACKAGE.md` and `<level>/packages/<name>/blocks/<block>.ts` | A package: instructions, and the blocks that are its tools. |

### Code

| Path | What it becomes |
| --- | --- |
| `flows/workers/<name>.ts` or `.tsx` | A worker flow, named by a `WORKER.md`'s `flow:` setting. |
| `blocks/<name>.ts` or `.tsx` | A block every worker may name in `tools:`. |
| `teams/<team>/blocks/<name>.ts` | A block every worker on the team may name. |
| `teams/<team>/workers/<worker>/blocks/<name>.ts` | A block one worker may name. |
| `workforce.gen.ts` | The file `fsdev gen` writes: an import of every code file above. |

The kit accepts `.mts` and `.cts` in the same places. `fsdev gen` registers only `.ts` and `.tsx`, so a `.mts` or `.cts` code file starts the app but is not in `workforce.gen.ts`, and no worker can name it.

### What each folder takes

| Folder | Takes |
| --- | --- |
| `workforce/` | `teams/`, `org/`, `flows/workers/`, `blocks/`, `workforce.gen.ts` |
| `org/` | `workers/`, `references/`, `resources/`, `skills/`, `packages/` |
| `teams/<team>/` | `TEAM.md`, `workers/`, `references/`, `resources/`, `skills/`, `packages/`, `blocks/` |
| `teams/<team>/workers/<worker>/` | `WORKER.md`, `references/`, `resources/`, `skills/`, `packages/`, `blocks/` |
| `org/workers/<worker>/` | `WORKER.md`, `references/`, `resources/`, `skills/`, `packages/` |

### What is refused

| Placement | What happens |
| --- | --- |
| A `TEAM.md` at `org/` or the root; a `blocks/` folder under `org/` or in an org worker's folder | Refused at startup. `fsdev gen` also refuses the `blocks/` folder, naming the three places one may sit. |
| A `tools/` folder anywhere | Refused at startup as an unused folder. `fsdev gen` says: a tool is an ordinary block, so put the file in a `blocks/` folder and name it in a worker's `tools:`. |
| Anything in `flows/` but `flows/workers/` | Refused at startup, by name. Keep helper modules in the app's own folder. |
| A file directly in `skills/` or `workers/` | Refused at startup. A file in `workers/` is not a worker. |
| Anything in a worker folder but `WORKER.md` and the folders above | Refused at startup. A `README.md` there is refused. |
| A package folder with anything but `PACKAGE.md` and `blocks/<name>.<ext>`, or a worker folder with no `WORKER.md` | Refused at startup, naming the path. |

## Names

One rule applies to every name the tree reads: a team folder, a worker folder, a document file without `.md`, a skill folder, a package folder, and a worker flow or block file without its extension.

| Rule | Detail |
| --- | --- |
| Characters | Lowercase letters and digits in runs joined by single hyphens. No leading or trailing hyphen, no `.`, `_`, space or uppercase. |
| Length | At most 64 characters. |
| Reserved | `_meta`. |
| Device names | `con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9`. They match the pattern and are refused on a file whatever its extension. `com0` and `lpt0` are allowed. |

A name that fails more than one check shows the first of: too long, reserved, pattern, device name.

### Which folder names are refused?

| Name | Message starts |
| --- | --- |
| `Core`, `a_b`, `a--b`, `-a`, `x.y` | `<what> name "<name>" must be lowercase letters, digits, and single hyphens (not at the start or end)` |
| 65 or more characters | `<what> name "<name>" exceeds 64 characters` |
| `_meta` | `<what> name "_meta" is reserved` |
| `con`, `com1` | `<what> name "con" is a reserved device name on Windows` |

`<what>` is `Team folder`, `Worker folder`, `Document file`, `Worker flow file`, `Block file` or `Package folder`. The pattern message ends with what the name becomes: a worker's id, joined with `.`; a document's ref, joined with `/`; a worker flow's name, which a `flow:` setting names; a block's name; a package's name, which a `packages:` line takes it by.

A skill folder has its own wording: `Skill name "Bad_Name" must be lowercase letters, digits, and single hyphens (not at the start or end)`, `exceeds 64 chars`, `is reserved`, `is a reserved device name on Windows`. A skill's `name:` must equal its folder.

A bad name stops the app on a team, worker, document, reference, skill or package. A bad flow or block file name does not stop the app; `fsdev gen` refuses it instead. `types.d.ts` is refused because its name would be `types.d`, `Foo.ts` because of the capital, `search-docs.test.ts` because of the dot. A `.ts` and a `.tsx` with one name are refused as one name declared twice. A team folder's name is checked only when the folder holds a worker, document, skill or package, so a team folder that holds only a `TEAM.md` starts the app whatever it is called.

## Documents

A document is a file `<name>.md` directly in a `references/` or `resources/` folder. A directory there is refused. A file that does not end in `.md` is refused at startup, except a `.ts` or `.tsx` in `resources/`, which is a capability.

| Rule | Detail |
| --- | --- |
| Frontmatter | A non-empty `description` is required. Every other key is passed to the resource as written. Frontmatter never reaches a model; the body does. |
| Refused in `resources/` | `scope`, `ref`, `stateSchema`, `default`, `content`, `contentFile`, `contentTemplate`, `contentTemplateRef` and `prefetchMode: lazy`. `prefetchMode: eager` is accepted. Declare such a document in code with `defineResource()`. |
| Refused in `references/` | The same keys, and `writable`, `llmWritable`, `render` and `flowIsolation` with any value. The message sends you to `resources/`. |
| Keys with an effect in `resources/` | `llmReadable`, `llmWritable`, `writable`, `allowedExtensions`, `metadata` and `flowIsolation`. |
| One name, one ref | A `references/` file and a `resources/` file at one level mint one ref, and the app stops with both paths named. A team's reference and a worker's reference of one name do not clash. |
| A `.ts` and a `.md` of one name | `fsdev gen` refuses them as one ref declared twice. Startup does not. |

A document's ref comes from where its file sits. It is the accessor a block reads on `ctx.resources`, as in `ctx.resources["teams/support/handbook"]`. A `.ts` module in `resources/` gets the ref a document of that name would.

| File | Ref |
| --- | --- |
| `org/resources/<name>.md` or `org/references/<name>.md` | `<name>` |
| `teams/<team>/resources/<name>.md` | `teams/<team>/<name>` |
| `org/workers/<worker>/resources/<name>.md` | `workers/<worker>/<name>` |
| `teams/<team>/workers/<worker>/resources/<name>.md` | `teams/<team>/workers/<worker>/<name>` |

### Who reaches a reference

A worker reaches the references of its organization, its team and its own folder, and no others.

| A reference in | Reached by |
| --- | --- |
| `org/references/` | Every worker |
| `teams/<team>/references/` | Every worker on that team |
| `teams/<team>/workers/<worker>/references/` | That worker |
| `org/workers/<worker>/references/` | That org worker |

An unreachable reference has no accessor, and `ctx.resources.get("teams/support/escalation")` throws `is not registered`. Nothing widens the reach: move the file up the tree. A worker's `references:` line narrows within it and never widens.

A `resources/` document is different. Where it sits is part of its ref and nothing more: every worker on the built-in `agent` flow reaches all of them, unless its `resources:` line narrows the list ([`WORKER.md`](./worker-md.md)). A worker flow of your own chooses which documents it installs.

## `TEAM.md`

| Part | Rule |
| --- | --- |
| Where | `teams/<team>/TEAM.md`. At most one per team, none at the org level. |
| `description` | Required, non-empty. |
| `name` | Optional, a non-empty string. It is the team's display name. |
| Refused keys | `id` (the folder's name is the id), `flow`, `instructions` and `teamInstructions`. Each is named in the message. |
| The body | The team's instructions. They are told to every worker on the team and to no worker on another team. An empty or whitespace body counts as none. |

On the built-in `agent` flow the prompt reads, in order: the worker's identity, the team's instructions, the worker's own instructions, then the instructions of the packages it holds. A worker flow of your own decides for itself. A brief the whole team shares goes in `TEAM.md`. Material a worker looks up goes in `references/`.

## Code

`fsdev gen` does not import or run the files it finds, so a mistake inside a file shows up in the app's typecheck, not in `fsdev gen`. It writes `workforce/workforce.gen.ts`. Flags, output and exit codes are in [the CLI reference](./cli.md).

| Rule | Detail |
| --- | --- |
| It looks in | `flows/workers`, `blocks`, and the `resources`, `blocks` and `packages/*/blocks` folders at each level above. A code folder that is absent is silent. |
| One file per declaration | A file's name without its extension is its registered name. A directory inside a code folder is refused, by the kit as well as `fsdev gen`. |
| What a file exports | `flows/workers/`, a worker flow (`workerFlow(...)`). `blocks/`, at any level and in a package, a block. `resources/`, a capability or a resource. |
| Wrong shape | The app's typecheck against `workforce.gen.ts` fails, naming the file. A worker flow whose declared `kind` differs from its file name is refused at startup, when the kit registers the workers. |
| Refusals | Collected and thrown together, and nothing is written. `Refused <n> entries under the workforce code folders; nothing was generated:` then one line each. |
| Symlinks | A symlinked folder, file, worker folder or package folder is refused. |

The command looks in the `dependencies` and `devDependencies` of the nearest `package.json` for a package that exports `./fsdev-gen`. None gives `No dependency in <package.json> exports a generator on "./fsdev-gen".` More than one gives `More than one dependency exports a generator: a, b.` The contract a package implements to supply a generator is in [the CLI reference](./cli.md#fsdev-gen).

### What `workforce.gen.ts` holds

Commit the file. It begins `Generated by `fsdev gen`. Do not edit.`, and an unchanged tree writes the same bytes. It exports five maps, each `{}` when empty.

| Export | Holds | The kit uses it for |
| --- | --- | --- |
| `workerFlows` | One entry per file in `flows/workers/`. | The worker flows it serves. A key also in the kit's `workerFlows` slot is refused. |
| `blocks` | One per file in `blocks/`. | The `agent` flow's tool catalog, when `agent` gives none. |
| `resourceModules` | One per `.ts` or `.tsx` in a `resources/` folder, keyed by ref. | Capabilities and resources, as in [Capabilities](#capabilities). |
| `workerBlocks` | Per team worker id, the blocks from its own `blocks/` and its team's. | The blocks a worker's `tools:` may name. An org worker has no entry. |
| `packageBlocks` | Per package address, such as `teams/support/packages/escalation`, its `blocks/` files. | The tools of the packages a worker holds. Without it, a held package brings instructions and no tools. |

Pass the module to the kit whole. For a folder with no code files the generated file is five empty maps:

```ts title="workforce/workforce.gen.ts"
export const workerFlows = {};
export const blocks = {};
export const resourceModules = {};
export const workerBlocks = {};
export const packageBlocks = {};
```

The config file imports it:

```ts title="fsdev.config.ts"
import { createFlowState } from "@flow-state-dev/engine";
import { workforce } from "@flow-state-dev/workforce/kit";
import * as generated from "./workforce/workforce.gen";

export default createFlowState({
  kits: [workforce({ agent: { model: "openai/gpt-6-luna" }, generated })],
});
```

The kit takes only those five keys, and a misspelled one is refused when the kit is built. Registering a block does not grant it: a worker calls a block only when its `tools:` line names it, or, with no `tools:` line, through a preset its `capabilities:` line picks ([`WORKER.md`](./worker-md.md)) or a package it holds.

### Which block a `tools:` name finds

| Looked in, in order | Holds |
| --- | --- |
| The worker's own `blocks/` | `teams/<team>/workers/<worker>/blocks/` |
| The team's `blocks/` | `teams/<team>/blocks/` |
| The catalog | `workforce/blocks/`, given to the built-in `agent` flow |

The first match wins and the nearer shadows the farther. An org worker has no `blocks/` folder, so its tools come from the catalog and from packages it holds. A block's file name, its key and its own `name` must agree, or the app stops at startup. A name nothing registers stops the app the same way. The `hireWorkforce:` prefix in these errors names that startup step:

```text title="Startup error"
hireWorkforce: 1 standard worker problem(s); nothing was registered:
- worker "core.lead" - Flow "agent" instance "core.lead" has an invalid config bag: "tools": names tool "nope", which nothing registers for this worker ...
```

## Capabilities

A `.ts` or `.tsx` file in a `resources/` folder is code: a capability (`defineCapability`) or a resource (`defineResource`), default-exported.

| Rule | Detail |
| --- | --- |
| Its ref | The ref a document of that name would get: `<name>` at org level, `teams/<team>/<name>` in a team, `workers/<worker>/<name>` and `teams/<team>/workers/<worker>/<name>` in a worker's own folder. |
| Where a capability sits | At org level or in a team. In one worker's own `resources/` folder the file is typed as a resource only, so the app's typecheck rejects a capability there, naming the file. `fsdev gen` and startup do not. A resource there is fine. |
| Neither one | A default export that is neither fails the same typecheck. If it reaches the kit, the app stops: `Resource module "<ref>" exports <value>, not a capability or a resource`. |
| Where it goes | Capabilities go to the `uses` of the built-in `agent` and `coordinator` flows. Resources join the documents. |

## Packages

A package is a folder under a `packages/` folder: a required `PACKAGE.md` and an optional `blocks/` folder.

| Rule | Detail |
| --- | --- |
| `PACKAGE.md` | One frontmatter key, `description`, required and non-empty. It is for people and never reaches the model. Any other key is refused and named. The body is the instructions. |
| Refused inside | `resources/`, `references/`, `skills/` and `packages/` folders, and any symlink. |
| No `PACKAGE.md` | `Package folder "<path>" has no PACKAGE.md.` A file directly in `packages/` is refused. |
| Its address | Its folder path under `workforce/`, such as `teams/support/packages/escalation`. It is the key in `packageBlocks`. |
| Its instructions | They reach the worker every turn, after its team's and its own on the `agent` flow. |
| Its tools | They reach only workers that hold the package. A worker's `tools:` line picks among them: no line gives every block of every package it holds, a list gives exactly that list, `tools: []` gives none. |

### Who holds a package

| Folder | Held by |
| --- | --- |
| `teams/<team>/workers/<worker>/packages/<name>/` or `org/workers/<worker>/packages/<name>/` | That worker, with no line in its file. |
| `teams/<team>/packages/<name>/` | A worker on that team, once its `packages:` line names it. |
| `org/packages/<name>/` | Any worker, once its `packages:` line names it. |

A `packages:` line names library packages only. It looks in the worker's team library first, then the org's, and an org worker has no team library. A package no worker names reaches nobody, and a worker cannot name another team's library or another worker's folder.

Startup refuses a `packages:` line that is not a list of strings, a name no library in reach offers (`Looked in "teams/core/packages/nope" and "org/packages/nope".`), a name both the worker's own folder and a library offer (`One name is one package — rename one of them.`), and a package block that shares a name with another block the worker holds. Each refusal names the worker.

## Skills

`skills/<name>/SKILL.md` sits at three levels.

| Skills folder | Held by |
| --- | --- |
| `org/skills/` | Every worker |
| `teams/<team>/skills/` | Every worker on that team |
| `teams/<team>/workers/<worker>/skills/` or `org/workers/<worker>/skills/` | That worker |

The same skill name reaching one worker from two levels stops the app: `Skill "review" reaches worker "lead" from 2 levels ... Remove one: there is no precedence rule.` Two teams may each have a `review`. A `SKILL.md` that declares `scope:` is refused, because where the folder sits decides who sees it. A skill folder with no `SKILL.md` is refused. The other keys are in [`SKILL.md` and skills options](./skill-md.md).

## When a change takes effect

| Edit | Takes effect |
| --- | --- |
| The body of an existing `references/` document | The next request. A read already in flight keeps the body it started with. |
| Any other edit to a `WORKER.md`, `TEAM.md`, `resources/` document, `PACKAGE.md`, skill, or a reference's frontmatter, and any new or removed file of those | After a restart. |
| A `resources/` document something has written | Never. The stored body is the source, and moving the file to `references/` does not clear it. |
| A code file added, renamed or removed | Run `fsdev gen`, then restart. Nothing regenerates while the app runs. |
| Anything, under `fsdev dev --watch` | A save under the config file's folder restarts the dev server. Plain `fsdev dev` does not. |

A user's edit of a standard worker applies from the next turn and leaves the file alone. See [`WORKER.md`](./worker-md.md).

## Who owns what is stored

| Part | Owner | Seen by | Stored | How many |
| --- | --- | --- | --- | --- |
| A `references/` file | The app. | Workers whose place reaches it, narrowed by `references:`. | Not stored. Read when each request starts. | One per file. |
| A `resources/` document | The organization, once written. The file is the starting text. | Every worker on the built-in `agent` flow, unless its `resources:` line narrows the list. | The app's org-scope store. | One per organization, or one per organization per worker flow with `flowIsolation: true`. Workers on the same flow share the document. |
| A `WORKER.md` | The app. A user's edit saves that user's own copy under the same id. | Every user of every organization. | Not stored. A deploy that changes the file changes the worker. | One per file. |
| A `TEAM.md` | The app. | That team's workers only. | Not stored. It rides each team worker's configuration. | At most one per team. |

| Part | Owner | Seen by | Stored | How many |
| --- | --- | --- | --- | --- |
| A `SKILL.md` folder | The app seeds it. The worker holds a copy per user. | The worker and the user it runs for. | The user's scope, once the worker first reads it. | One per worker per user. |
| A package folder | The app. | The worker whose folder it is, or workers that name it from a team or org library. | Not stored. Text is read at startup; blocks come from `fsdev gen`. | One per folder. |
| A worker flow file | The app. | Every worker whose `flow:` names it. | Not stored. A static import in `workforce.gen.ts`. | One copy shared by every worker on it. |
| A block file | The app. | Workers at its level, if their `tools:` names it. | Not stored. | One per file. |
| A capability or resource module | The app. | Every worker on the `agent` and `coordinator` flows the kit builds. | Not stored. A static import. | One per file. |
| `workforce.gen.ts` | The app: written by the command and committed. | The kit, as `generated`. | In the repository. | One. |
