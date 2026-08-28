---
sidebar_position: 7
---

# Workspace projection

`@flow-state-dev/workspace` — move files between resource collections and wherever an agent actually works.

## Why this exists

An agent that edits files needs somewhere to edit them. That somewhere is usually temporary: a sandbox that ends with the run, a checkout on some machine, a scratch directory. The files themselves need to outlive it.

Resource collections are the durable side. A **place** is the temporary side. This package is the thing in between — it lays the collections down as files, and afterwards works out what to carry back.

The interesting part is that last step. A run can add files, change files, delete files, and write files nowhere in particular. Meanwhile something else — another run, an action block, a person — may have changed the same collection. A reconcile that just copies the place over the collection loses that other work without saying so.

## Getting started

```ts
import { createProjection, createHostPlace } from "@flow-state-dev/workspace";

const projection = createProjection({
  place: createHostPlace("/tmp/run-42"),
  mounts: [
    { prefix: "artifacts", collection: artifacts, writable: true },
    { prefix: "reference", collection: docs, writable: false },
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

The path becomes the projection's from then on, so a later flush can delete it if the run removes the file. `put` resolves `undefined` when there's nothing to decide — a read-only mount, or a collection's own metadata.

## Two runs, one file

Everything above is about one run and one collection. Concurrency needs one more thing.

The baseline tells a projection whether a file changed since *it* last wrote. It can't tell whether another run is writing that file right now: a second projection that never committed the path holds no baseline for it, reads the collection as untouched, and writes. The later write wins, and nobody is told.

So a projection claims each path it commits, and holds the claim until released:

```ts
const report = await projection.flush();
for (const c of report.contested) {
  console.log(`${c.path} is being written by another run`);
}
```

The claim covers the whole read-compare-write, not just the write. Taking it after the collection read would leave that read unprotected: another projection can commit and release during it, and this one then writes from a snapshot that predates it.

The claim lasts for the operation and no longer — that's the length of the race it exists to stop, two flushes interleaving at their awaits. A `put` and a `flush` in flight together release once the last one finishes. Writes that don't overlap in time are already covered: the second one finds the collection changed and reports a conflict.

`contested` is not `conflict`, and the difference is who the other writer is. A conflict is somebody who already wrote — the evidence is sitting in the collection, and three hashes describe it. A contested path is somebody writing *now*: nothing to compare yet, just a claim held elsewhere.

Claims are per **path**. Two runs sharing a collection while working on disjoint files both land and neither is refused — that's the case the design is for, not one it misses.

Pass a `claims` registry to scope arbitration to a subset of projections. Omit it and they share a process-wide one, which is what lets two projections nobody wired together still arbitrate.

This is in-process only, the same scope the baseline has. Two servers writing one collection is a bigger problem than this solves.

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
