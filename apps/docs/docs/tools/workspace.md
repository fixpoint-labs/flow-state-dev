---
sidebar_position: 8
---

# Workspace projection

`@flow-state-dev/workspace` — move files between resource collections and wherever an agent actually works.

## Why this exists

An agent that edits files needs somewhere to edit them. That somewhere is usually temporary: a sandbox that ends with the run, a checkout on some machine, a scratch directory. The files themselves need to outlive it.

Resource collections are the durable side. A **place** is the temporary side. This package is the thing in between — it lays the collections down as files, and afterwards works out what to carry back.

The interesting part is that last step. A run can add files, change files, delete files, and write files nowhere in particular. Meanwhile something else — another run, an action block, a person — may have changed the same collection. A reconcile that just copies the place over the collection loses that other work without saying so.

## Getting started

```ts
import {
  collectionIdFor,
  createProjection,
  createHostPlace,
  principalFromContext,
} from "@flow-state-dev/workspace";

const principal = principalFromContext(ctx);

const projection = createProjection({
  place: createHostPlace("/tmp/run-42"),
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

await projection.hydrate();
// the agent runs, editing files under /tmp/run-42
const report = await projection.flush();
```

A **mount** binds one collection to one prefix inside the place. After `hydrate`, an entry the `artifacts` collection knows as `notes.md` is a file at `/tmp/run-42/artifacts/notes.md`. After `flush`, the collection holds whatever the agent left there.

Nested prefixes work: a collection mounted at `artifacts/drafts` inside one mounted at `artifacts` gets the drafts, because the longest matching prefix wins.

A mount with `writable: false` is hydrated and then left alone. It's reference material the run can read and can't change.

The projection sets `path`, `hash`, and `updatedAt` on every entry it commits. If your collection carries more than that — a title, an author, a timestamp in a different shape — give the mount an `entryState(key)` function. It's applied last, so it can override what the projection chose.

## Reading the flush report

`flush` doesn't throw when two writers disagree. It resolves, and hands back an outcome for every path it reached.

| Outcome | What happened |
| --- | --- |
| `unchanged` | The run never touched the file. |
| `created` | New file, nothing in the collection to disturb. |
| `written` | The collection still held what the projection last put there, so the write was safe. |
| `converged` | The collection already held exactly this content. Nothing written. |
| `deleted` | The run removed a file the projection owned, and nobody else had changed it. |
| `orphan` | A file written outside every writable mount. |
| `conflict` | Two writers, one path. Nothing was written. |

A conflict is the outcome of a flush that succeeded. Everything uncontested still landed. The contested path was left exactly as both writers left it, and you get three hashes to work out what to do:

```ts
for (const c of report.conflicts) {
  console.log(c.path, {
    base: c.base,     // what the projection last committed here, or null
    theirs: c.theirs, // what the collection holds now, or null
    ours: c.ours,     // what the place holds now, or null if deleted
  });
}
```

That third value is the whole trick. Comparing collection against place gives you two versions and no way to tell "I changed this" from "somebody else changed this" — both look like a difference. Knowing what the projection itself last committed makes the question answerable, so a concurrent write shows up as a line in the report instead of quietly winning.

An `orphan` is a file the run wrote somewhere no writable mount claims. It's reported rather than filed into some default collection, because guessing where a file belongs is how files end up somewhere nobody looks.

## What the projection owns

A projection writes to, and deletes, only the paths it has laid down itself. That set grows as it commits: a file the run creates and flushes belongs to the projection from then on, which is what lets a later deletion of that file propagate back to the collection.

The flip side is that a projection which hasn't laid a path down owns nothing there. It'll still create the file if the collection is empty, and still write if the collection holds exactly what it expects — but it won't delete, and it won't overwrite somebody else's change. That's the safe direction to fail in.

Ownership lives for as long as the projection object does. `ownedPaths()` tells you what it currently holds.

## Writing one file at a time

Not every consumer writes through the place. A tool call that writes one named file already knows which file changed, and running a whole flush to find that out is both wasteful and wrong — wasteful because it walks everything, wrong because a projection holding no baseline would report every pre-existing file as new.

`put` narrows the same decision to one path:

```ts
const outcome = await projection.put("artifacts/notes.md", content);
if (outcome?.kind === "conflict") {
  // somebody else changed this since we last committed it
}
```

The path becomes the projection's from then on, so a later flush can delete it if the run removes the file. `put` resolves `undefined` only when there's genuinely nothing to decide — a collection's own metadata.

A read-only mount is not that case. A flush passes over one, because it keeps no baseline there and can't tell an edit from the content it laid down itself. But `put` was handed one path and asked to persist it, so it answers `readonly` with the mount's prefix. Pass that on as a refusal: unlike `conflict` and `contested`, it never clears.

## Two runs, one file

Two runs can be working in the same collection at the same time. When they touch different files, both land. When they reach for the same one, the second is **refused** rather than allowed to overwrite the first.

A refusal shows up as a `contested` outcome naming the path:

```ts
const report = await projection.flush();
for (const c of report.contested) {
  console.log(`${c.path} is being written by another run`);
}
```

Nothing was written for that path, and nothing was lost: the other run's write stands, and yours is still in your place to retry.

`contested` is not `conflict`. A conflict is somebody who already wrote — the evidence is sitting in the collection, and you get three hashes to work out what to do. A contested path is somebody writing *right now*, so there is nothing to compare yet.

### What counts as the same file

The unit is a **durable entry** — one collection, one key — not a path. Two sessions each writing their own `artifacts/report.md` are writing two different entries, so neither refuses the other. That is what `Mount.collectionId` is for: it names the collection so two runs over the same rows recognise each other, and two runs that merely spell their paths alike do not.

Building it by hand is not the expected route. `principalFromContext(ctx)` reads the identity off a block's execution context, and `collectionIdFor(collection, principal)` turns it into the id. For a door with no execution context, `unscopedCollectionId(collection)` is the fallback, and it errs toward refusing: a reported refusal is retryable, a missed one is a silent overwrite.

### How far a refusal reaches

A refusal lasts for one operation — a single `flush` or `put` — and covers reading, comparing and writing as one. It belongs to that operation rather than to the projection, which matters when a workspace is shared: a session-scoped workspace is one projection serving every request in that session, and arbitration has to see those requests as separate writers.

It is also **in-process only**, the same reach the baseline has. Two servers writing one collection is a larger problem, and this does not claim to solve it.

Pass a `claims` registry to scope arbitration to a subset of projections. Omit it and they share a process-wide one, which is what lets two projections nobody wired together still arbitrate.

## Places

`createHostPlace(root)` projects into a real directory. It creates `root` if needed, refuses any path resolving outside it, and neither lists nor follows symlinks planted inside it.

`createMemoryPlace(initial?)` keeps files in memory. Handy for testing your own wiring without a directory — it adds `snapshot()`, `remove(path)`, and `breakListing()`.

You can write your own with three methods:

```ts
interface Place {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  list(prefixes: readonly string[]): Promise<readonly string[]>;
}
```

Note what isn't there: a place doesn't run commands. It's where files are, not where work happens, so something that can only hold files is a perfectly good place.

One rule is worth stating plainly. **`list` must throw if the place can't be read.** An empty array is a claim — "I'm readable, and there's nothing here" — and a flush acts on that claim by deleting the files it owns. If your `list` swallows an error and returns `[]`, a transient failure becomes data loss.
