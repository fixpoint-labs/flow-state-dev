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
| `readonly` | A single-path `put` under a read-only mount. Nothing was written, and a retry won't change that. |

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

### Scoping a mount to one key prefix

When one collection holds files for several owners, keyed `<owner>/…`, give the mount a `scope` so a place only ever sees and writes one owner's keys:

```ts
{
  prefix: "workspace",
  scope: "sandbox",            // only keys under sandbox/…
  collection: files,
  collectionId: collectionIdFor(files, principal),
  writable: true,
}
```

The collection's `sandbox/notes.md` appears in the place at `workspace/notes.md`, and a write there lands back at `sandbox/notes.md`. Every list, read, write and delete goes through the scope, and the listing is filtered by the collection itself, so other owners' rows are never read at all. A scope is a key prefix like `"a"` or `"a/b"`: no leading or trailing `/`, and no `.` or `..` segment.

## Workspace hosts and run sources

A **run source** says where a run's files come from: a git repository and the branch to cut from, or a set of files kept in a collection. A **workspace host** turns that answer into a directory a worker can edit, saves the work back, and lets the directory go when the run is done. Harness workers and tool workers use the same host.

```ts
import { localWorkspaceHost } from "@flow-state-dev/workspace";

const host = localWorkspaceHost({
  root: "/var/fsd/runs",
  remotes: { allow: ["github.com"] },   // list "file" to allow file:// remotes
  source: mySource,                      // (ctx) => an answer, below
});
```

A source is a function of the block context, and answers one of three ways:

```ts
{ kind: "repo", repo: "https://github.com/acme/storefront.git" }            // a fresh branch of a repository
{ kind: "repo", repo, baseRef: "release", projectId: "storefront", files }   // ...with kept files beside it
{ kind: "files", projectId: "sandbox", files }                               // no repository: the kept files are the work
{ kind: "refused", reason: "not-a-member", message: "..." }                  // no files for this run, and why
```

`files` is `{ collection, collectionId }`, and `projectId` is the key prefix inside that collection. The host never reads it as anything else.

A run then goes through four calls:

```ts
const answer = await host.source(ctx);
const place = await host.provision(answer, { place: [tenant, user, runId], branch: `fsd/${runId}` });
// the worker runs with place.cwd as its working directory
const report = await host.save(place);   // a FlushReport, as above
await host.release(place);
```

### What a place looks like

```
<root>/.clones/<repository>.git     one clone per remote, shared by every run
<root>/<place…>/
    checkout/     a git worktree on the run's branch
    project/      the kept files, next to the checkout
    workspace/    the kept files as the working directory, when there is no repository
```

For a repository, the host keeps one clone of each remote under `root` and gives every run its own branch in `checkout/`. `https://github.com/acme/x`, `https://github.com/acme/x.git` and `git@github.com:acme/x.git` share one clone. A non-default port, like `ssh://github.com:2222/acme/x`, is another server and gets its own. Before it cuts a new branch, the host fetches and reads the remote's default branch again, so a renamed `main` is followed. `place.repo` says which clone, branch, base branch and commit the run got. Record the remote and base on your run, and log the clone path so whoever runs the host can find it.

A checkout that already exists is handed back exactly as it was left. The host doesn't fetch, reset or rebase it, so a retry finds its uncommitted work. A checkout it can't explain, such as one on a different branch or with no `.git`, is refused and left alone. The one exception is a checkout whose `git worktree add` was killed before it finished: the host marks the place while that command runs, and when the mark is still there and the tree only has files missing, it rebuilds the checkout instead of handing a run a tree with half the repository gone. If the tree shows any other change, the host refuses it and keeps it.

Several hosts, in one process or several, can share a `root`. Provisioning a place, and working on a clone, take a lock file under the root, so a second host waits for the first instead of racing it. A lock left by a process that died is taken over after a minute.

Kept files go in `project/` next to the checkout, never inside it, so `git status` never sees them. With no repository they go in `workspace/`, which is also the run's working directory. Either way they're hydrated from one key prefix of the collection and flushed back by `save`, with the same conflict reporting as any projection. The first run in an empty prefix starts from an empty directory. A retry in the same process gets the same live directory back, unsaved edits included. From then on the kept files are the retry's: `save` refuses the earlier place handle, and `release` on it does nothing. A directory the process didn't fill itself, after a restart or because it was deleted, is rebuilt from the collection. The collection is the record, so anything a run never saved is gone.

### A repository on this machine

A repository the host's own machine already holds doesn't need a clone. List its absolute path in `localRepositories`, and a source that answers that path as its `repo` gets a worktree of the repository itself:

```ts
const host = localWorkspaceHost({
  root: "/var/fsd/runs",
  remotes: { allow: [] },
  localRepositories: ["/srv/storefront"],
  source: () => ({ kind: "repo", repo: "/srv/storefront", baseRef: "main" }),
});
```

The run's branch is cut from `baseRef` (or `HEAD`) and stays in that repository. Nothing is fetched, on the first run or a retry. The place directory is the checkout itself, so there is no `checkout/` level and no `project/` beside it, and a source that names kept files with a local repository is refused. Any bare path not on the list is still refused as `invalid-remote`, before git runs.

### Keeping a directory out of git

A caller that writes its own files inside the checkout can name that directory in the place request: `ignored: { dir, rule, why }`. Before the checkout is handed over, the host checks that the repository ignores `dir` and doesn't already track files under it. If either check fails, it refuses with a message that names `rule` as the line to add to `.gitignore`, and removes a checkout it had only just made. In a run with no repository, `save` leaves `dir` inside `workspace/` out of the kept files.

One provision, every git command and every wait for another provision of the same place or clone included, is held to `provisionTimeoutMs` (ten minutes by default). `host.locate(answer, { place })` says where `provision` would put a place, without making anything, for a caller that has to name the working directory first.

### Holding a run's work across machines

A run's checkout lives on its host's disk. When the next turn of that run lands on another machine, the checkout isn't there. Held work covers that case: at points you choose, the host copies the run's work into a store you provide, and a host on another machine rebuilds the checkout from it.

It's off unless you pass a `heldWork` store. A host that keeps its disk between turns, or a sandbox that preserves its state, doesn't need it.

```ts
import { fileHeldWorkStore, localWorkspaceHost } from "@flow-state-dev/workspace";

const host = localWorkspaceHost({
  root: "/var/fsd/runs",
  remotes: { allow: ["github.com"] },
  source: () => ({
    kind: "repo",
    repo: "https://github.com/acme/storefront.git",
    heldPrefix: "acme/storefront",   // where this run's held work goes in the store
  }),
  heldWork: fileHeldWorkStore({ dir: "/mnt/shared/held-work" }),
});
```

Holding applies to a run only when the host has a store, the source's repository answer names a `heldPrefix`, and the repository is a remote. A repository listed in `localRepositories` is never held. `host.holds(answer)` tells you whether an answer qualifies.

#### What is held

`host.checkpoint(place, previous?)` takes a git snapshot of the checkout: the run's commits since its base, plus everything uncommitted on top of them. Edits, untracked files and deletions are all included. It leaves the checkout's staging area alone, creates no branch or tag, and pushes nothing to the remote.

Some files are left out:

- Files the repository ignores, such as `.env` or `node_modules`.
- Any file over 10 MB. The snapshot keeps it as it was at the run's head commit, or leaves it out if it's new. `skipped` lists it with `why: "over-cap"`.
- Submodules and nested repositories, listed in `skipped` with `why: "submodule"`.

`checkpoint` returns `null` when holding doesn't apply to the place. Otherwise it writes the snapshot to the store and returns a `HeldWork`:

```ts
{
  base: "4f1c…",       // the commit the run's branch was cut at
  head: "9a2e…",       // the branch's commit when the snapshot was taken
  snapshot: "c07b…",   // the working tree, as a commit on top of head
  key: "acme/storefront/t1/u1/run-42/c07b….pack",   // <heldPrefix>/<place…>/<snapshot>.pack
  sha256: "…",         // hash of the stored bytes
  bytes: 18234,
  skipped: [{ path: "fixtures/dump.sql", why: "over-cap" }],
  unchanged: false,
}
```

Pass the last `HeldWork` you recorded as `previous`. If nothing has changed since, the result has `unchanged: true` and nothing is written.

Each new snapshot goes under a new key, and the one before it stays in the store. Save the new result on your run record first, then delete the key it replaced with `host.dropHeld(place, key)`. In that order, a run that dies in between still points at a key that exists. `dropHeld` throws for a key outside the place's own prefix, and for a place that holding doesn't apply to.

#### Bringing a run back

To bring a run back, call `provision` with `recorded`; `restore(place)` is a no-op on this host. `recorded` is a `RecordedPlace`, which your run keeps between turns. Every field is optional:

- `host`: the `hostId()` of the host that last provisioned the place. Write it yourself after each `provision`; the host never updates your record. A host's id belongs to its `root`, so hosts that share a root count as one host.
- `held`: the last `checkpoint` result you kept. `provision` reads `base`, `head`, `snapshot`, `key`, `sha256` and an optional `parked` flag (see [When a restore fails](#when-a-restore-fails)).
- `remote` and `branch`: what the place was cut from, as `place.repo.remote` and `place.repo.branch` reported them. When holding applies, `provision` rejects a record whose `remote` or `branch` differs from the request.
- `baseRef`: the branch the run was cut from, as `place.repo.baseRef` reported it. Used to find the base commit of a checkout handed back here when the record has no hold.

Keep the whole `HeldWork` in `held`, so you can also pass it to `checkpoint` as `previous`:

```ts
import type { HeldWork, RecordedPlace } from "@flow-state-dev/workspace";

type RunRecord = RecordedPlace & { held?: HeldWork | null };

const answer = await host.source(ctx);
const place = await host.provision(answer, {
  place: [tenant, user, runId],
  branch: `fsd/${runId}`,
  recorded: record,
});
record = {
  ...record,
  host: host.hostId(),
  remote: place.repo!.remote,
  branch: place.repo!.branch,
  baseRef: place.repo!.baseRef ?? record.baseRef,   // reported only when the branch was just cut
};
await saveRunRecord(runId, record);

// ...the worker's turn...

const held = await host.checkpoint(place, record.held);
if (held !== null && !held.unchanged) {
  const replaced = record.held?.key;
  record = { ...record, held };
  await saveRunRecord(runId, record);
  if (replaced !== undefined) await host.dropHeld(place, replaced);
}
```

Leave `recorded` out on a first provision.

A place whose record names another host, or names this host but has no checkout here, is lost here, and `provision` makes it again. The returned place says what happened in `origin`:

| `origin` | When |
| --- | --- |
| `new` | There's no record, or it names no host, and there's no checkout here yet. A branch is cut for the first time. |
| `live` | The place is live here: its checkout is on this host, and the record names this host or no host. The checkout is handed back as it was. |
| `held` | The place is lost here and the record has a hold that isn't parked. The checkout is rebuilt from it: the branch is at the recorded `head`, and the uncommitted changes are back in the working tree, unstaged, with new files untracked. |
| `base` | The place is lost here and the record has no hold, or its hold has `parked: true`. The branch is cut again from the base. |

On a host without a `heldWork` store, or for a run that holding doesn't apply to, `provision` never rebuilds, and `origin` is only ever `new` or `live`. A host without a store still checks `recorded.held`: if the record names held work and the run has no live checkout here, `provision` rejects with `field: "disabled"`.

A rebuilt checkout starts from a clone of the remote, so ignored files, `node_modules` included, aren't there. Reinstall dependencies before the worker runs.

To follow a rebuild, pass `progress` in the request:

```ts
progress?: (state: "lost" | "restoring") => void | Promise<void>;
```

It's called with `"lost"` when `provision` finds the place lost here, and with `"restoring"` just before a rebuild from held work starts, so you can record each state first. `provision` waits for the callback to resolve before going on.

A checkout this host still has for a lost place is renamed to `checkout.stale-<time>` and kept. A rebuilt checkout gets the same `ignored` check as a new one, and is refused the same way.

#### When a restore fails

When the held work and the record disagree, `provision` rejects with a `HeldWorkMismatchError` and nothing in the store changes. Provisioning again with the same record fails the same way, so the run needs a person to decide what happens to it. `field` says what disagreed:

| `field` | What disagreed |
| --- | --- |
| `remote` | The record names a different remote than the source answered. |
| `branch` | The record names a different branch than the request. |
| `scope` | The recorded key isn't under this run's prefix, `<heldPrefix>/<place…>/`. |
| `base` | The base commit isn't on any branch of the remote. |
| `pack` | The stored object is missing, its hash doesn't match the record, or it can't be read. |
| `head` | The head commit is in neither the held work nor the remote. |
| `snapshot` | The snapshot commit isn't in the held work, or doesn't sit on the recorded head. |
| `tree` | The rebuilt checkout doesn't match the snapshot. The rebuilt checkout is removed. |
| `disabled` | The record names held work, this host has no `heldWork` store, and the run has no live checkout here. |

`error.message` names the key or commit involved. A store that throws while it's being read fails the provision with the store's own error, which is worth retrying.

Once a person has decided, provision again with `parked: true` on the recorded hold:

```ts
const place = await host.provision(answer, {
  place: [tenant, user, runId],
  branch: `fsd/${runId}`,
  recorded: { ...record, held: { ...record.held!, parked: true } },
});
// place.origin is "base"; place.heldDir is set when the held files could be laid out
```

The run starts again from its base. If the held work can be read and matches the record, its files are laid out in a `held/` directory beside the checkout, and `place.heldDir` points there. Otherwise `heldDir` is absent.

#### Writing your own store

`fileHeldWorkStore({ dir })` keeps each key as a file under `dir`. For hosts on different machines, put `dir` on storage they all mount. For object storage, implement `HeldWorkStore`:

```ts
interface HeldWorkStore {
  put(key: string, bytes: Uint8Array): Promise<void>;   // replaces anything under key
  get(key: string): Promise<Uint8Array | undefined>;    // undefined when the key is absent
  delete(key: string): Promise<void>;                   // resolves when the key is already gone
  list(prefix: string): Promise<string[]>;              // every key starting with prefix
}
```

`put` must be atomic: a reader sees the whole object or nothing, never a partial write. A store that can expose half an object can leave a run whose record names work that can't be read back. `fileHeldWorkStore` writes atomically. Keys are `/`-separated, with no empty, `.` or `..` segments.

### Which remotes a host reaches

`remotes.allow` lists hosts, reached over `https` or `ssh`. Add `"file"` to permit `file://` remotes, which are refused otherwise. Every remote is checked before any git process starts, and the host refuses, with a `WorkspaceRefusedError`:

| `reason` | When |
| --- | --- |
| `invalid-remote` | The value starts with `-`, uses a transport helper like `ext::`, has a host starting with `-`, carries a password or an `https` login, or is a bare path rather than a URL |
| `remote-not-allowed` | Its host isn't listed, it's `file://` and `"file"` isn't listed, or its scheme isn't `https`, `ssh` or `file` |
| `remote-unreadable` | The host is allowed but git couldn't read it, or it has no branch to cut from |
| anything else | The source answered `refused`, with that reason |

Git itself runs with `GIT_ALLOW_PROTOCOL` set to the listed schemes, with `--` before every remote, and without a terminal prompt. A refusal names the remote without its credential. None of these clears on a retry, so fail the run with the reason.

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
| `localWorkspaceHost({ root, remotes, source, localRepositories?, provisionTimeoutMs?, heldWork? })` | A workspace host on this machine. Returns `{ root, source, provisionTimeoutMs, locate, provision, save, hostId, holds, checkpoint, dropHeld, restore, release }`. With a `heldWork` store, `checkpoint(place, previous?)` saves a repository run's work to it and returns a `HeldWork` (or `null` when holding doesn't apply), `dropHeld(place, key)` deletes one of the place's earlier keys, and `provision` takes `recorded` and rebuilds a lost checkout from it, reporting `origin`. |
| `HeldWorkStore` | Where held work goes: `put(key, bytes)`, `get(key)`, `delete(key)`, `list(prefix)`. `put` must be atomic. |
| `fileHeldWorkStore({ dir })` | A `HeldWorkStore` that keeps each key as a file under `dir`, written atomically. |
| `HeldWorkMismatchError` | What `provision` rejects with when held work disagrees with the run's record, or this host has no store to rebuild from. `field` is one of `remote`, `branch`, `scope`, `base`, `pack`, `head`, `snapshot`, `tree`, `disabled`. |
| `HeldWork` | What `checkpoint` returns: `{ base, head, snapshot, key, sha256, bytes, skipped, unchanged }`. |
| `RecordedPlace` | What `provision` takes as `recorded`: `{ host?, held?, remote?, branch?, baseRef? }`. |
| `RecordedHold` | The `held` field of a `RecordedPlace`: `{ base, head, snapshot, key, sha256, parked? }`. A `HeldWork` fits it. |
| `PlaceOrigin` | A place's `origin`: `"new" \| "live" \| "held" \| "base"`. |
| `SkippedPath` | A path a snapshot left out: `{ path, why: "over-cap" \| "submodule" }`. |
| `HeldWorkMismatchField` | The values of `HeldWorkMismatchError.field`. |
| `IgnoredDirectory` | The `ignored` field of a place request: `{ dir, rule, why }`. |
| `repositoryIdentity(dir)`, `identityFromCommonDir(dir, commonDir)` | Which repository a directory belongs to, as the real path of its git common directory. Two worktrees of one repository answer the same. |
| `resolvesToCommit(repo, ref)` | Whether `ref` names a commit in `repo`. |
| `isStrictlyInside(candidate, root)` | Whether `candidate` is a path below `root`, never `root` itself. |
| `run(cmd, args, options)`, `GIT_TIMEOUT_MS`, `CHECKOUT_CLEANUP_TIMEOUT_MS` | The bounded child-process runner the host runs git with, and its timeouts. |
| `acquireLock`, `releaseLock`, `sleep` | The lock file the host takes on a place or a clone, for a caller that holds one of its own. |
| `WorkspaceRefusedError` | What `provision` rejects with when it won't make a place. Carries `reason`. |
| `RunSource`, `RunSourceAnswer` | The run-source function type and its three answers. |

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

It resolves `undefined` only when there's genuinely nothing to decide — a collection's own metadata.

A read-only mount is not that case. A flush passes over one because it holds no baseline there and can't tell an edit from what it laid down itself, but `put` was handed one path and asked to persist it, so it answers `readonly` with the mount's prefix. Relay that as a refusal: unlike `conflict` and `contested`, which clear once the other writer is done, this one never does.

## License

MIT
