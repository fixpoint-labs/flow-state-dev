---
title: Workspace
type: catalog
description: Move files between stored collections and the place an agent works.
---

# Workspace

`@flow-state-dev/workspace` moves files between resource collections and the place an agent works.

## Why this exists

An agent that edits files needs somewhere to edit them. That somewhere is usually temporary: a sandbox that ends with the run, a checkout on some machine, a scratch directory. The files themselves need to outlive it.

Resource collections are the durable side. A **place** is the temporary side. This package lays the collections down as files in the place, and afterwards works out what to carry back. Carrying back never overwrites a change someone else made to the collection. It reports it.

The bash tool uses this package underneath. Reach for the package directly when the agent is not a model calling a shell, such as a coding harness handed a directory.

```bash
pnpm add @flow-state-dev/workspace
```

## Hydrate, work, flush

The example is a research run that edits notes. `artifacts` holds the notes and `docs` holds reference material.

```ts title="src/lib/research-workspace.ts"
import {
  collectionIdFor,
  createHostPlace,
  createProjection,
  principalFromContext,
  type Mount,
} from "@flow-state-dev/workspace";

type Collection = Mount["collection"];
type Ctx = Parameters<typeof principalFromContext>[0];

export function openWorkspace(
  ctx: Ctx,
  artifacts: Collection,
  docs: Collection,
  runId: string,
) {
  const principal = principalFromContext(ctx);

  return createProjection({
    place: createHostPlace(`/tmp/run-${runId}`),
    mounts: [
      {
        prefix: "artifacts",
        collection: artifacts,
        collectionId: collectionIdFor(artifacts, principal),
        writable: true,
      },
      {
        prefix: "reference",
        collection: docs,
        collectionId: collectionIdFor(docs, principal),
        writable: false,
      },
    ],
  });
}
```

```ts title="src/lib/run-research.ts"
import type { Projection } from "@flow-state-dev/workspace";

export async function runResearch(projection: Projection, work: () => Promise<void>) {
  await projection.hydrate();
  await work(); // the agent edits files in the place
  return projection.flush();
}
```

A **mount** binds one collection to one prefix inside the place. After `hydrate`, with a `runId` of `"42"`, the `artifacts` entry `notes.md` is a file at `/tmp/run-42/artifacts/notes.md`. After `flush`, the collection holds whatever the agent left there. The `reference` mount has `writable: false`, so the run can read it and `flush` never saves edits to it. `collectionId` is the string that says which stored rows a mount addresses; `collectionIdFor` builds it from the block's context.

A projection deletes a collection entry only for a file it laid down or committed itself. `ownedPaths()` lists them. Mount nesting, `entryState` and the rest of the mount options are in the [Tools reference](../../reference/tools.md).

## Reading the flush report

`flush` doesn't throw when two writers disagree. It resolves with a report whose `outcomes` has one entry per path it reached: `unchanged`, `created`, `written`, `converged`, `deleted`, `orphan`, `conflict` or `contested`. `conflicts` and `contested` hold those two kinds on their own.

A `conflict` means someone else changed the path in the collection after your last commit. Nothing was written for it, and every other path landed. `contested` means another run is writing that file at this moment. Nothing was written for that path either, and your file stays in the place to retry.

```ts title="src/lib/report-flush.ts"
import type { FlushReport } from "@flow-state-dev/workspace";

export function reportFlush(report: FlushReport) {
  for (const c of report.conflicts) {
    console.log(c.path, {
      base: c.base,     // what the projection last committed here, or null
      theirs: c.theirs, // what the collection holds now, or null
      ours: c.ours,     // what the place holds now, or null if deleted
    });
  }
  for (const c of report.contested) {
    console.log(`${c.path} is being written by another run`);
  }
}
```

The three values are SHA-256 hashes of content, not the content. Read them for what happened to the path: `ours: null` means the run deleted a file that someone else edited, and `base: null` means the projection never laid the path down.

Two runs touching different files both land. When two runs write the same entry in the same collection at once, the second gets `contested`. Runs are checked against each other only when their mounts pass the same `collectionId` over the same rows; different ids are never compared. The check covers runs in one server process only. Each outcome kind, how a refusal is scoped and how to pass your own `claims` registry are in the [Tools reference](../../reference/tools.md).

`flush` rejects in one case on purpose: `PlaceUnreadableError` ("the workspace could not be listed: ..."). The place could not be listed, so nothing was read, written or deleted, and you can catch it and carry on. Any other rejection, such as a failed collection read, write or delete, means work did not reach the store. Don't swallow those.

## Writing one file at a time

When a tool call writes one named file, use `put` instead of `flush`. It decides that one path.

```ts title="src/lib/save-note.ts"
import type { Projection } from "@flow-state-dev/workspace";

export async function saveNote(projection: Projection, content: string) {
  const outcome = await projection.put("artifacts/notes.md", content);
  if (outcome?.kind === "conflict") {
    // somebody else changed this since we last committed it
  }
  return outcome;
}
```

`put` returns an outcome for that path, such as `created`, `written`, `conflict` or `contested`. A path under a read-only mount comes back as `readonly`. Treat `readonly` as permanent: retrying the same `put` gets the same answer.

## Places

`createHostPlace(root)` projects into a real directory. `createMemoryPlace()` keeps files in memory for tests, and adds `snapshot()`, `remove(path)` and `breakListing()`, which makes `list` throw so you can test a place that can't be read.

A place only holds files; it doesn't run commands. You can write your own with `read`, `write` and `list`. A `list` that can't read the place must throw rather than return an empty array. An empty array says the place is readable and empty, and the flush then deletes every entry the projection owns. The [Tools reference](../../reference/tools.md) has the interface and what each shipped place refuses.

## Pull requests on a branch

A coding session records the pull requests its tool calls open (see
[Pull requests a session opened](../../reference/harness-runs.md)).
A pull request opened some other way, by a raw API call or a tool the recorder
doesn't recognise, is on the checkout's branch all the same. `recordBranchPullRequests`
asks GitHub which pull requests that branch has and adds them to the session's
`observed-pull-requests` collection with `source: "branch"`. Call it on the server,
from a block that runs after the coding step, and pass that block's context.

```ts title="src/lib/record-pull-requests.ts"
import { recordBranchPullRequests } from "@flow-state-dev/workspace";

type Ctx = Parameters<typeof recordBranchPullRequests>[0];

export async function recordPullRequests(
  ctx: Ctx,
  worktree: string,
  sessionBranch: string,
  turnStartedAt: number,
) {
  const result = await recordBranchPullRequests(ctx, {
    cwd: worktree,              // the checkout the run worked in
    branches: [sessionBranch],  // optional: more branches to check
    openedSince: turnStartedAt, // optional: leave out pull requests from before the turn
  });
  if (result.status === "unavailable") {
    console.warn(`Pull requests on the branch were not checked: ${result.reason}`);
  }
  return result;
}
```

It asks GitHub through the signed-in `gh` on the machine, so it works for GitHub repositories only. It never throws: the result is `recorded` with the pull requests found, or `unavailable` with a reason. The flow needs `observedPullRequestsCollection` from `@flow-state-dev/core/harness`, which the coding agent blocks declare by default. Which branches it checks, what `openedSince` filters, how existing rows are kept and the time limit are in the [Tools reference](../../reference/tools.md).

## Next

- [Tools reference](../../reference/tools.md): mount options, every flush outcome, refusal scope, places and the pull request lookup.
- [Coding harnesses](../../concepts/coding-harnesses.md): how a coding session records the pull requests it opens.
