---
title: "`WORKER.md`"
type: reference
description: "Every setting a WORKER.md accepts, how a worker's id is formed from its folder, and what makes a worker file unusable."
---

# `WORKER.md`

A `WORKER.md` is the file that defines one standard worker: a named agent your app ships with. Its frontmatter holds settings, such as what the worker is for and which flow it runs on. Its body is the worker's instructions. The app reads these files once, when it starts, so a standard worker is a file you review and commit like code. A user can edit it in the running app, which saves the user's own copy (see [When an edit takes effect](#when-an-edit-takes-effect)).

This page lists the settings, the rules for the id, and what makes a file unusable. For what a worker is and who can change it, see [Workers](../concepts/workers.md).

## Where a file sits and what id it gets

A worker is a folder holding `WORKER.md`, under the `workforce/` folder beside the app.

```text title="workforce/"
org/workers/shift-coordinator/WORKER.md
teams/support/workers/triage/WORKER.md
teams/engineering/workers/lead/WORKER.md
```

| Folder | Worker id |
| --- | --- |
| `teams/<team>/workers/<name>/` | `<team>.<name>` |
| `org/workers/<name>/` | `<name>` |

So the folders above give `shift-coordinator`, `support.triage` and `engineering.lead`. A team worker's id always has a dot and an org worker's never does, so `shift-coordinator` and `engineering.shift-coordinator` are two workers.

The id is the worker's address. A session of a worker's flow names it once, as `state: { workerId }`, when the session is created. Another worker's `delegates` list names it. A worker flow reads its own as `ctx.flow.config.workerId`. A `WORKER.md` cannot declare an id.

A session create without `workerId` is refused. A `workerId` that is not the user's own worker or a standard one gives `No worker "<id>".` with status 404. One that names a worker on another flow gives `Worker "<id>" runs on flow "<a>", not "<b>". Create its session on "<a>".`

### Names in the tree

These rules apply to team folders, worker folders, documents, skills and packages.

| Rule | Detail |
| --- | --- |
| Characters | Lowercase letters and digits in runs joined by single hyphens. No leading or trailing hyphen, no `.`, `_` or uppercase. |
| Length | At most 64 characters. |
| Reserved | `_meta`. |
| Device names | `con`, `prn`, `aux`, `nul`, `com1` to `com9`, `lpt1` to `lpt9`, with or without an extension. |

A worker a user hires while the app runs takes an id the user picks: one path segment of at least one character that does not start with `/` or `~`. The rules above do not apply to it.

## Settings

The file's frontmatter uses the same dialect as `SKILL.md`. Any other key is passed to the worker's flow, which checks it. *Hiring* is the step after the files load, when the app builds each worker on its flow. A flow that does not declare the key refuses the hire.

**Which setting is required?** Only `description` is required by the file itself. A flow can require more: a `coder` worker with no `harness` and no kit-wide `defaultHarness` has every task refused.

### Every worker

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| `description` | non-empty string | required | One line saying what the worker is for. A coordinator routing by `best-fit` describes each delegate to its model by it. |
| `name` | non-empty string | none; apps show the id | The display name. The id stays the address. |
| `flow` | non-empty string | `agent` | The worker flow the worker runs on. To change how a worker behaves, give it a different flow. The built-in flows are `agent`, `coordinator` and `coder`. An app that registers its own flow under `agent` replaces the built-in one for every worker on `agent`. |
| `instructions` | string | the file body | The worker's own instructions. Write them as the body, not here: a file with both is refused. A whitespace-only body counts as none. |
| `delegates` | list of worker ids (at most 25), or `all` | `[]` | Who the worker hands work to. A delegate must be on the same user's roster. A standard worker may name only standard workers. |
| `defaults` | `false`, or an object of `date`, `skillsIndex`, `historySummary` booleans | every section on | Turns off parts of the standard text added after the worker's instructions: today's date, the list of its skills, a summary of earlier turns. `false` turns all off. An unknown section is refused. |

`all` is the whole roster, the worker itself included. A worker hired mid-conversation is reachable at once. The cap of 25 bounds a written list, not `all`. A coordinator never routes to itself. A delegate named twice is refused for a coordinator.

### Settings of the `agent` flow

A file with no `flow:` line runs on this flow.

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| `model` | string | the flow's `model` option, else `intent/chat` | The model a turn runs on. `intent/chat` is a placeholder your app's resolver maps to a model. |
| `tools` | list of strings | absent | Absent: the worker gets the tools of the presets it names under `capabilities` and the blocks of packages it holds. A written list is the whole grant, and `[]` is no tools. Each name is looked up in the worker's own `blocks/` folder, then its team's, then the app's catalog; the first match wins. A name nothing registers is refused at hire. |
| `skills` | object: `active` (names), `activateTool` (boolean), `enableLlmClassifier` (boolean) | `{ active: [], enableLlmClassifier: false }` | `active` skills are always in context. A name the worker does not hold is refused on its first turn. `activateTool` lets the model load a held skill mid-turn; unset, it is on for a worker that holds a skill. `enableLlmClassifier` runs a model call per turn to match the message to skills. |
| `capabilities` | map from capability name to list of preset names | `{}` | Presets the worker adds. A worker that names none gets each installed capability's own default presets and none of their tools. An unknown capability or preset is refused at hire. |
| `discover` | list of `workers`, `skills`, `resources` | absent: every domain the scope carries | Narrows what the worker can look up. `[]` shows nothing. It cannot widen: a domain the app did not install shows nothing. A misspelt domain is refused at hire. |

If a `tools:` name is a block in a worker's `blocks/` folder, run `fsdev gen` to register it.

### Settings the hire reads

These apply on every flow and narrow what the worker can reach.

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| `resources` | list of document refs, each bare, `<ref>: ro` or `<ref>: rw` | absent: every document the app passed | Narrows the documents the worker may touch. A bare ref and `ro` are read-only. `[]` is none. `rw` on a document that is not writable, a ref the app did not declare and a ref twice are refused. |
| `references` | list of refs | absent: every reference its place reaches | Narrows the read-only references the worker's org, team and own folder give it. A ref from outside that reach refuses the hire. `[]` is none. |
| `packages` | list of package names | none | Takes packages from the worker's team library, else the org's. Packages in the worker's own `packages/` folder need no line. A name no library offers, or one a library and the worker's folder both offer, is refused. |

### Settings of the `coder` flow

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| `harness` | one of the harness ids the kit was given, such as `codex` | the kit's `defaultHarness` | Which coding harness the worker's runs use. A harness this machine is not set up for fails the task at once, saying why. It never moves to another. |
| `review` | boolean | the kit's `review` option, `false` | `true`: a run that committed waits for the user's review before its task completes. |

### Settings of the `coordinator` flow

The `agent` settings apply as well.

| Setting | Type | Default | What it does |
| --- | --- | --- | --- |
| `routing` | `judgment`, `best-fit`, `round-robin`, `everyone` | `judgment` | How a message finds its delegates. |
| `fallback` | a delegate id | none | Where a message `best-fit` cannot place goes. Must be in `delegates`. |
| `minConfidence` | number, 0 to 1 | none | The lowest confidence at which a `best-fit` pick is used. Refused under any other routing. |
| `rounds` | integer, 0 to 3 | `0` | How many times a delegate's answer goes back out to the others. |
| `editsOwnDelegates` | boolean | `false` | `true` gives the coordinator's turn `addDelegate`, `removeDelegate` and `setFallback`. |
| `inferredWork` | `off`, `observe`, `auto` | `observe` | What it does with an event that no other subscription in the app heard. `off` shows the event in the conversation as a line and runs no model. `observe` runs its turn and every task it files waits on the user's yes. `auto` runs the turn as any other. |

Under `best-fit` and `round-robin`, each answer goes out as it lands, never back to its author. Under `everyone` and `judgment`, the round closes first and then the answers go out together. A round closes when everyone has answered, failed or been cancelled, or at its deadline. A `WORKER.md` cannot set the deadline. It is five minutes unless the app's coordinator flow sets `roundDeadlineMs`. More rounds cost more delegate turns per message: at most delegates times (rounds + 1).

## What makes a file unusable

What the loader refuses is listed under `errors` as `{ path, error, kind }`, and the other workers load. `path` is slash-separated, starts at `org/` or `teams/` and names the folder. These errors come from `readWorkforceDirectory`, the loader function that reads the worker folders. It is internal to the package: an app does not import it.

| `kind` | Means |
| --- | --- |
| `unreadable-slot` | One of `org`, `org/workers`, `teams`, a team folder or a team's `workers/` is a symlink or cannot be listed. Every worker beneath it is missing. |
| `worker-load-failed` | One worker folder did not load: a symlinked or unreadable folder, an unusable name, or a missing or malformed `WORKER.md`. |
| `refused-declaration` | The file declares a key the framework sets. The worker is left out. |

| Cause | What the loader says |
| --- | --- |
| A worker folder with no `WORKER.md` | `Worker folder "<name>" has no WORKER.md.` |
| No frontmatter | ``WORKER.md in "<name>/" has no frontmatter — a worker file needs at least a `description` ``. |
| Frontmatter with no `description` | `WORKER.md in "<name>/" must declare a non-empty description`. A missing, non-string or blank `description` all give it. |
| A `name` that is not a non-empty string | `WORKER.md in "<name>/" declares a name that is not a non-empty string`. |
| A symlinked `WORKER.md` or folder, or a `WORKER.md` that cannot be read | Refused, never followed. |
| A folder name that breaks the rules above | Reported under the folder's path. |
| One of `persona`, `workerSkills`, `teamInstructions`, `workerTools`, `workerPackages`, `workerId` | `refused-declaration`, naming the first one found. The loader sets these: skills, tools and packages come from where the folders sit, and a team's instructions come from its `TEAM.md`. |

The loader skips everything outside worker folders, without an error. The workforce kit loads `resources/`, `skills/` and `packages/` itself, and stops the app on any other stray file (see below), except `.DS_Store` and `Thumbs.db`.

A root that is a symlink or cannot be read makes the loader throw. A root with no `org/workers/` and no `teams/` returns no workers and no errors.

### At startup

The workforce kit reads the whole folder when the app starts. If anything failed to load (a worker, a team file, a skill, a package, a document or a reference), the app does not start. It names every problem at once:

```text
the workforce folder did not load:
  - worker teams/support/workers/triage: WORKER.md in "triage/" must declare a non-empty description
```

A file in the tree that is not part of the folder layout, such as a `README.md` or a `notes.txt`, stops the app too. The kit loads the folder with `readWorkforceFolder`, exported from `@flow-state-dev/workforce/loader`. It throws the message above, with one line per problem.

### At hire

A problem at hire is prefixed `worker "<id>" — `, and all of them are listed together under the message `hireWorkforce refused N of M worker(s)`, where `hireWorkforce` is the kit's hire step. Nothing is hired partially.

| Cause | What it says |
| --- | --- |
| `flow:` names a flow the app did not register as a worker flow | `names flow "<f>", which is not in the worker flows passed to hireWorkforce`, with the flows passed. |
| `flow:` empty, null or not a string | `declares an empty flow:` or `declares flow: as <value>, which names no worker flow`. Only a file with no `flow` key gets `agent`. |
| `instructions:` in the frontmatter and a body | `declares "instructions" in its frontmatter and carries a body`. Remove one. |
| Two workers with one id | `declared twice in this roster; a worker's id is its address and must be unique` |
| A `tools:` name nothing registers | Refused, naming both places it looked. |
| A setting the flow does not declare, or of the wrong type | The flow's own refusal, prefixed with the worker's id. |

A coordinator file it cannot run is refused the same way: `rounds` above 3, an unknown `routing`, a `fallback` not in `delegates`, or a `minConfidence` outside 0 to 1.

## When an edit takes effect

| Edit | Takes effect |
| --- | --- |
| A `WORKER.md` | At the next app start. `fsdev dev --watch` (only when the server listens on localhost) restarts the app when a file the config loaded changes; plain `fsdev dev` does not. |
| A user editing a standard worker | The next turn. The edit saves the user's own copy under the same id; the standard file is not touched. |

## Next

- [Workers](../concepts/workers.md): what a worker is and who owns each part of it.
- [Coding harnesses](../concepts/coding-harnesses.md): what the `harness` setting chooses between.
