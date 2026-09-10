---
title: Workers on disk
sidebar_position: 8
sidebar_label: Workers on disk
description: Describe each of your app's AI workers in a folder — one Markdown file per worker — and read the whole set at startup.
---

# Workers on disk

An app with several collaborating AI workers has to say somewhere who each of them is: which model it runs on, which tools it may call, and what it has been told to do. You can write that in TypeScript, one worker at a time. You can also put each worker in a folder and read the folder.

A worker's folder holds one Markdown file, `WORKER.md`, and folders are grouped by team:

```
workforce/
  teams/
    engineering/
      workers/
        lead/WORKER.md
        api-designer/WORKER.md
        intake/WORKER.md
    marketing/
      workers/
        lead/WORKER.md
```

Someone who does not write TypeScript can add a worker to that tree, or change what one has been told to do, by editing a document.

## What a WORKER.md says

Settings between `---` fences, instructions below them:

```md
---
description: Holds the engineering board and breaks work into tasks.
flow: worker-agent
model: openai/gpt-5.4-mini
tools: [board, search]
---

You are the engineering lead. You do not write code yourself — you break
the request into tasks, assign them, and report what came back.
```

`description` is the only required setting. Everything else is whatever the worker needs to declare about itself, and it arrives exactly as you wrote it — the reader does not check the keys against a list, so a setting meaningful only to your own app travels through untouched.

The frontmatter is the same dialect a [`SKILL.md`](../skills/overview.md) uses. If you have written one of those, you already know what goes here.

## Reading the tree

Point `readWorkforceDirectory` at the root of the tree. It comes back with one record per worker:

```ts
import { readWorkforceDirectory } from "@flow-state-dev/workforce/loader";

const { workers, errors } = await readWorkforceDirectory("./workforce");

workers[0].id;       // "engineering.lead"
workers[0].declared; // { description: "…", flow: "worker-agent",
                     //   model: "openai/gpt-5.4-mini", tools: ["board", "search"] }
workers[0].body;     // "You are the engineering lead. …"
```

Each record carries what the folder said and nothing else. Reading the tree does not start anything: no flow is built, nothing is registered, and no model is contacted. Turning these records into workers you can talk to is a separate step.

## A worker's identity

`readWorkforceDirectory` gives every worker one identity, its team and its own name joined by a dot. The folder `teams/engineering/workers/lead/` produces `engineering.lead`.

The team qualifier means every team can have a `lead` and a `reviewer` without checking what other teams called theirs. The dot is what keeps the identity addressable once a worker is running — the identity becomes part of a URL, and a `/` inside one does not survive the trip.

Both parts of the name come from folder names, and both must be lowercase letters, digits and single hyphens, at most 64 characters. So `api-designer` is fine; `API_Designer` and `api.designer` are refused when the tree is read, with the rule in the message. `_meta` is reserved.

## A worker whose shape is code

Some seats need more than a document can say. A folder holding a `worker.ts` instead of (or alongside) a `WORKER.md` is a valid worker, and its record carries the path to that file:

```ts
workers[1].codePath; // "workforce/teams/engineering/workers/router/worker.ts"
workers[1].declared; // {}
workers[1].body;     // ""
```

The file is recorded and never imported. Your app decides what to do with the path.

## What comes back when a folder is wrong

A worker that could not be read does not throw. It lands in `errors`, keyed by the path of the folder, and every other worker still loads:

```ts
errors;
// [{ path: "teams/engineering/workers/intake",
//    error: Error("Worker folder \"intake\" has neither a WORKER.md nor a worker.ts") }]
```

Reading throws in one case only: the root you passed cannot be read at all. A root with no `teams/` folder is an empty result rather than an error.

Only worker folders are reported. A team's `resources/`, `skills/` or `tools/` folders, an organisation-level `workers/` folder, and anything else on the tree are passed over in silence. Inside `teams/<team>/workers/`, a folder that produces no worker is always named.

### Treat a non-empty `errors` as fatal

```ts
const { workers, errors } = await readWorkforceDirectory("./workforce");
if (errors.length) {
  throw new Error(
    `workforce: ${errors.length} worker(s) failed to load\n` +
      errors.map(({ path, error }) => `  ${path}: ${error.message}`).join("\n"),
  );
}
```

Logging a warning and carrying on is the tempting alternative and it fails badly. A reported folder is a worker your app was supposed to have, so the app boots one worker short and says nothing — while a mistyped *setting*, caught later when workers are hired, takes the whole boot down. The missing worker is the worse outcome and the quiet one. Fail on `errors` at startup unless you have a specific reason to run a short roster.

## What this does not do

- It does not resolve tool or capability names. `tools: [board, search]` is carried as two strings; whether those tools exist is checked when the worker is put to work.
- It does not read anything outside `teams/<team>/workers/<worker>/`. Team-level and organisation-level folders are part of the layout but nothing reads them.
- It does not register workers at runtime. The tree is read once, at startup.
