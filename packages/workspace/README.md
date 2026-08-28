# @flow-state-dev/workspace

Project files from resource collections into a directory an agent works in, and reconcile them back when it's done.

An agent that edits files needs somewhere to edit them. That somewhere is usually temporary — a sandbox, a checkout, a scratch directory — while the files themselves need to outlive it. This package moves content between the two and, on the way back, tells you what it decided about every path.

```bash
pnpm add @flow-state-dev/workspace
```

## The shape of it

Three pieces:

- A **place** is wherever files live while the run is happening. It reads, writes, and lists. It doesn't run commands.
- A **mount** binds one resource collection to one prefix inside the place, and says whether writes may flow back.
- A **projection** hydrates the mounts into the place, then flushes the place back into the collections.

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

After `hydrate`, `/tmp/run-42/artifacts/notes.md` holds whatever the `artifacts` collection has under `notes.md`. After `flush`, the collection holds whatever the agent left there.

## What a flush decides

`flush` resolves with a report rather than throwing on disagreement. Every path it reached gets an outcome:

| Outcome | What happened |
| --- | --- |
| `unchanged` | The run never touched the file. |
| `created` | New file, nothing in the collection to disturb. |
| `written` | The collection still held what the projection last put there, so the write was safe. |
| `converged` | The collection already held exactly this content. Nothing written. |
| `deleted` | The run removed a file the projection owned, and nobody else had changed it. |
| `orphan` | A file written outside every writable mount. Reported, never guessed into a collection. |
| `conflict` | Two writers, one path. Nothing was written. |

A conflict is an outcome of a flush that *succeeded*. Everything uncontested still landed; the contested path was left exactly as both writers left it. The report hands you three hashes so you can say why:

```ts
for (const c of report.conflicts) {
  console.log(c.path, {
    base: c.base,     // what the projection last committed, or null
    theirs: c.theirs, // what the collection holds now, or null
    ours: c.ours,     // what the place holds now, or null if deleted
  });
}
```

Comparing two values — collection against place — can't tell "I changed this" from "somebody else changed this". The third value, `base`, is what makes the question answerable, and it's why a concurrent write shows up as a report line instead of quietly winning.

`base` tracks what this projection last committed, not what it hydrated. A file the run creates and flushes belongs to the projection from then on, which is what lets a later deletion of that file propagate. A projection holding no baseline for a path owns nothing there: it writes only where the collection is untouched, and deletes nothing.

## Two runs, one file

The baseline tells a projection whether a file changed since *it* last wrote. It can't tell whether another run is writing that file right now — a second projection that has never committed the path holds no baseline for it, reads the collection as untouched, and writes. The later write wins and nobody is told.

So a projection also **claims** each path it commits, and holds the claim until it's released:

```ts
const report = await projection.flush();
for (const c of report.contested) {
  console.log(`${c.path} is being written by another run`);
}
```

The claim covers the whole read-compare-write, not just the write. Taking it after reading the collection would leave the read unprotected: another projection can commit and release inside that await, and this one then writes from a snapshot that predates it — granted a claim that proves nothing.

The claim lasts for the operation and no longer, and it belongs to that operation rather than to the projection. Those are two separate things and both matter. A session-scoped workspace is one projection shared by every request that overlaps in it, so a claim belonging to the projection is the same claim for all of them — each one is granted a key somebody already holds, and they commit over each other with everyone told they wrote. A claim held for the whole run, at the other extreme, would need releasing on every path a run can end, and one missed release leaves an entry claimed by an operation nobody will run again, refusing every later one. Writes that don't overlap in time need none of this: the second one finds the collection changed and reports a conflict.

A `contested` outcome is not a `conflict`. A conflict is somebody who already *wrote* — the evidence is in the collection and three hashes describe it. A contested path is somebody writing *now*: there's nothing to compare yet, only a claim held elsewhere.

Claims are per **durable entry**, not per collection, per mount, or per path. Two runs sharing a collection while touching disjoint files both land, and neither is refused — that case is the point of the design rather than a gap in it.

An entry is named by its mount's `collectionId` plus its key, never by its path. A path can't name a durable row: `artifacts/report.md` is a naming convention, so two sessions writing their own copy would refuse each other over a row they don't share, and one collection mounted under two prefixes would evade arbitration over a row that genuinely is one.

Pass your own `claims` registry to `createProjection` to scope arbitration to a subset of projections; omit it and they share a process-wide one, which is what makes two projections nobody wired together still arbitrate.

**In-process only.** This is the same scope the baseline has. Two servers writing one collection is a larger problem, and this doesn't pretend to solve it.

## Places

`createHostPlace(root)` projects into a real directory. It creates `root` if it doesn't exist and refuses any path that would leave it — including by symlink, which a lexical `..` check doesn't catch. A link planted anywhere in the path, at the file or at a parent directory, is refused rather than followed, and the walk never lists one.

`createMemoryPlace(initial?)` keeps everything in a `Map`. Use it to test wiring without standing up a directory. It adds `snapshot()`, `remove(path)`, and `breakListing()` for asserting against.

Supply your own by implementing three methods:

```ts
interface Place {
  read(path: string): Promise<string | null>;
  write(path: string, content: string): Promise<void>;
  list(prefixes: readonly string[]): Promise<readonly string[]>;
}
```

One rule matters more than the rest: **`list` must throw when the place can't be read.** Returning an empty array asserts the place is readable and empty, and a flush acts on that by deleting what it owns.

`flush` re-throws that one failure as a `PlaceUnreadableError`, and nothing else. It is the only rejection a caller can safely swallow: nothing was read and nothing was written, so the run's files are still where the run left them. A collection read or write that fails is the opposite — the work did not reach the store — so catch the named error and let the rest through. Catching both alike is how a run reports success for files that went nowhere.

```ts
try {
  await projection.flush();
} catch (err) {
  if (!(err instanceof PlaceUnreadableError)) throw err;
  // Nothing was decided. Log it and carry on.
}
```

## Mounts

```ts
interface Mount {
  prefix: string;      // where the collection appears in the place
  collection: ResourceCollectionRef<ProjectedEntryState>;
  collectionId: string; // what the collection IS, durably
  writable: boolean;   // may a flush write back?
  entryState?: (key: string) => Record<string, unknown>;
}
```

`collectionId` is what write arbitration is keyed on: the same string for two runs addressing the same rows, a different one for two that only spell their paths alike. It's required rather than defaulted because both plausible defaults are wrong in one direction — omit the scope and unrelated tenants refuse each other's writes; use the collection object and two runs in one session stop arbitrating at all.

You don't usually build it by hand. `principalFromContext(ctx)` reads the scoping identity off a block's execution context, and `collectionIdFor(collection, principal)` turns that plus the collection into the id:

```ts
const principal = principalFromContext(ctx);
const mounts = collections.map((collection) => ({
  prefix: getPatternPrefix(collection.pattern),
  collection,
  collectionId: collectionIdFor(collection, principal),
  writable: true,
}));
```

For a door with no execution context — plain tools rather than blocks — `unscopedCollectionId(collection)` is the fallback. It names only the scope and the pattern, so two tool sets over one pattern arbitrate whether or not they share rows. That over-arbitrates on purpose: a false refusal is reported and retryable, a missed claim is a silent overwrite.

This is close to the engine's storage key, not equal to it. The engine also folds per-resource flow isolation into where a user- or org-scoped resource lands, and that rule belongs to the engine. So two flows that isolate the same user's resources from each other share an id here while their rows are separate, and one can be told `contested` over a row it doesn't share — the safe direction, and the same reason as above.

The projection sets `path`, `hash`, and `updatedAt` on every entry it commits, because it needs them. Anything else your collection carries — a title, an author, a timestamp in the shape your UI expects — comes from `entryState`, which is applied last, so a mount can override what the projection chose.

Nested prefixes work. A collection at `artifacts/drafts` inside one at `artifacts` gets the drafts; the longest matching prefix wins.

A read-only mount is hydrated and then left alone. Its paths aren't written back and aren't reported as orphans — the projection knows who owns them, and the answer is "not us".

## API

| Export | What it is |
| --- | --- |
| `createProjection({ mounts, place, claims? })` | Returns `{ hydrate, flush, put, ownedPaths }`. |
| `createHostPlace(root)` | A place backed by a directory. |
| `createMemoryPlace(initial?)` | A place backed by a `Map`. |
| `hashContent(content)` | The hex SHA-256 the projection compares with. |
| `createClaimRegistry()` | A registry scoping write arbitration to the projections you give it. |
| `sharedClaimRegistry` | The process-wide registry projections use by default. |
| `claimKey(collectionId, entryKey)` | The key one durable entry is claimed under. |
| `principalFromContext(ctx)` | The scoping identity, read off a block's execution context. |
| `collectionIdFor(collection, principal)` | A `Mount.collectionId` for a scoped door. |
| `unscopedCollectionId(collection)` | A `Mount.collectionId` for a door with no principal. |

`ownedPaths()` returns the paths the projection currently holds a baseline for — what it would write to, and what it would delete.

### Committing a single path

If your write channel doesn't go through the place — a tool call that writes one named file and already knows which — `put(path, content)` applies the same decision to that one path and returns its outcome:

```ts
const outcome = await projection.put("artifacts/notes.md", content);
if (outcome?.kind === "conflict") {
  // somebody else changed it since we last committed it
}
```

It's not a shortcut for `flush`. A full flush would walk everything to learn one thing, and a projection holding no baseline would report every pre-existing file in the place as new. `put` takes ownership of the path, so a later flush can delete it if the run removes it.

It resolves `undefined` when there's nothing to decide: a read-only mount, or a collection's own metadata.

## License

MIT
