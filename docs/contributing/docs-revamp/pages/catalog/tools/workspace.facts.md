# Fact sheet: Workspace (K-35, `catalog/tools/workspace`)

Sources cited: the exported surface and doc comments of `packages/workspace/src/`, its tests under
`packages/workspace/test/`, the existing user docs (`apps/docs/docs/tools/workspace.md`,
`apps/docs/docs/tools/bash.md`, `apps/docs/docs/tools/overview.md`, `packages/workspace/README.md`,
`docs/contributing/docs-revamp/pages/catalog/tools/workspace.md`), and one example that uses it
(`packages/claude-code/src/sdk/workspace.ts`). No spec is cited.
Paths are relative to the repo root. `S/` is `packages/workspace/src/`, `T/` is
`packages/workspace/test/`. The page is kept from today's site and trimmed (sitemap: "Keep, trim"), so
the existing page's claims are listed here too, each re-checked against code.

## Stored data: the four questions

Four things are stored or held, and they differ in lifetime. The package declares no resource of its own
for the projection (the PR-recording helper's `observed-pull-requests` and the worktrees collection are
out of this page's job; see "Left out" below).

### 1. Collection entries (the files, stored side)

- Who owns them: the collection the mount points at, declared by whoever declares that resource. The
  projection only reads and writes entries in it. `Mount.collection` is a `ResourceCollectionRef`.
  `S/types.ts:56-66`.
- Who can see them: whoever can see that collection at its declared scope (`request`, `session`, `user`,
  `org`). The projection adds no visibility rule. `ScopeName` is `"request" | "session" | "user" | "org"`.
  `S/scope-identity.ts:61`. Collections are durable and client-readable, as the host place's own comment
  puts it. `S/host-place.ts:93-95`.
- Where stored: wherever the app's store keeps resource collections; the projection never names a store.
  Each entry is content plus state. `S/projection.ts:457-474` (`getOrCreate`, `patchState`, `writeContent`).
- How many: one entry per file. A mount covers a whole collection, or only the keys under a `scope` prefix
  of it. `S/types.ts:85-101`; `T/scoped-mount.spec.ts:32-52`.
- State the projection writes on each entry it commits: `path`, `hash` (hex SHA-256 of the content) and
  `updatedAt` (ISO time of the last sync). `S/types.ts:45-53`; `S/projection.ts:42-45,463-465`.
  `entryState(key)` adds other fields. It cannot replace `path`, `hash`, or `updatedAt`.
  `S/types.ts:107-130`;
  `T/projection.spec.ts:569-615`. It applies to entries that already existed as well as created ones.
  `T/projection.spec.ts:578-589`.
- A key starting `_` at the top of a mount is the collection's own bookkeeping: never hydrated, never
  flushed, never written by `put`. A `_` deeper in a path (`src/_helpers.ts`) is an ordinary file.
  `S/routing.ts:66-77`; `S/projection.ts:204,289,439`; `T/projection.spec.ts:59,787-813`.

### 2. The place (the files, working side)

- Who owns it: the caller. `createHostPlace(root)` is a real directory you name; the caller picks it, and
  each run should have its own, since two runs sharing a directory hydrate over each other.
  `S/host-place.ts:38-40`; the capability's note `packages/claude-code/src/sdk/workspace.ts:50-53`.
- Who can see it: whoever can read that directory on the host. A place keeps nothing the collection
  does not, so it is disposable. `S/types.ts:5-8`.
- Where: `createHostPlace` a directory on the machine the flow runs on; `createMemoryPlace` a `Map` in
  process. `S/host-place.ts:1-8`; `S/memory-place.ts:1-8,26-31`.
- How many: one place per projection. A projection takes exactly one. `S/projection.ts:86-97`.

### 3. The baseline (what the projection last put there)

- Who owns it: the projection object. Per-projection, discarded at teardown, never persisted.
  `S/projection.ts:28-33,112-113`.
- Who can see it: the caller, through `ownedPaths()`, which lists the paths it holds.
  `S/projection.ts:79-83,480`.
- Where: in memory, a `Map` from path to hash. `S/projection.ts:113`.
- How many: one per path the projection owns. A path is owned after `hydrate` (writable mounts only),
  or after it commits a `created`, `written` or `converged` outcome. `S/projection.ts:220,404-418`;
  `T/projection.spec.ts:53-57,838-861`.
- Consequence: a projection holding no baseline (a resumed session, a fresh object) owns nothing. It
  writes only where the collection is untouched and deletes nothing. `S/projection.ts:31-33`;
  `T/projection.spec.ts:193-205`.

### 4. Claims (who is writing right now)

- Who owns them: one in-flight `flush` or `put`. Not the projection, not the run. `S/claims.ts:10-22`;
  `S/projection.ts:242-249`.
- Who can see them: any projection in the same process sharing the registry. `S/claims.ts:86-93`.
- Where: in a process-wide `Map` by default (`sharedClaimRegistry`), or a registry you pass as `claims`.
  `S/claims.ts:67-84,93`; `S/projection.ts:86-97`.
- How many: one per entry being written, for the length of the operation, then released, including when
  the operation throws. `S/projection.ts:242-249`; `T/projection.spec.ts:746-767`.
- In-process only. Two servers writing one collection are not arbitrated. `S/claims.ts:30-35`.

## What it is

- W1. `@flow-state-dev/workspace` moves file content between resource collections (the durable store) and
  a place (wherever an agent works). `S/types.ts:1-8`; `S/index.ts:1-20`. Version 0.4.0 at time of
  writing. `packages/workspace/package.json:3`.
- W2. Three pieces: a **place** (`read`, `write`, `list`; runs no commands), a **mount** (one collection at
  one prefix, writable or not) and a **projection** (`hydrate`, `flush`, `put`, `ownedPaths`).
  `S/types.ts:24-36,56-118`; `S/projection.ts:48-84`; `packages/workspace/README.md:11-15`.
- W3. Imported from `@flow-state-dev/workspace`; the root export carries `createProjection`, `hashContent`,
  `createHostPlace`, `createMemoryPlace`, `PlaceUnreadableError`, `collectionIdFor`,
  `principalFromContext`, `unscopedCollectionId`, `createClaimRegistry`, `sharedClaimRegistry`,
  `claimKey`, and the types `Projection`, `ProjectionOptions`, `Mount`, `Place`, `FlushOutcome`,
  `FlushReport`, `ProjectedEntryState`, `HostPlace`, `MemoryPlace`, `ClaimRegistry`, `ScopePrincipal`,
  `ScopeName`. `S/index.ts:21-44`. Install line: `pnpm add @flow-state-dev/workspace`.
  `packages/workspace/README.md:7-9`.
- W4. The package is also the shell tool's mechanism: the bash tool mounts every collection at its pattern
  prefix and syncs it through a projection. `packages/tools/src/bash/projection-setup.ts:1-12,14-18`;
  `apps/docs/docs/tools/bash.md:5-9,29-35`. The Claude Code workspace capability hydrates before the
  agent runs and reconciles after. `packages/claude-code/src/sdk/workspace.ts:1-12,319-335`.

## Use it: hydrate, work, flush

- W5. The shape of a call: `createProjection({ place, mounts, claims? })`, then `await projection.hydrate()`,
  the agent works in the place, then `const report = await projection.flush()`. `S/projection.ts:86-110`;
  `packages/workspace/README.md:20-41`. Complete example with imports in the existing page, which
  type-checks against the exports in W3 once `artifacts` and `docs` are declared collections
  (`ResourceCollectionRef`) and `ctx` is a block context. `ctx` and the collections are free variables
  in that example and must be bound in a page example (a block's `ctx`, collections from a declared
  resource). `S/scope-identity.ts:26-29`.
- W6. `hydrate` writes every entry of every mounted collection to `<prefix>/<key>` in the place and records
  a baseline for each writable one. `S/projection.ts:197-223`; `T/projection.spec.ts:30-39`.
- W7. `hydrate` keys files off the entry's own storage path, not the application's `state.path`, so a
  collection written by something other than a projection (no `path` field) still hydrates.
  `S/projection.ts:199-203`; `T/projection.spec.ts:41-51`.
- W8. A mount with `writable: false` is hydrated and then never written or deleted. A flush skips its
  paths, and does not report them as orphans. `S/types.ts:102-106`; `S/projection.ts:286-288`;
  `T/projection.spec.ts:350-366`.
- W9. Longest prefix wins: a collection at `artifacts/drafts` nested inside one at `artifacts` gets the
  drafts. A neighbour (`artifacts-old/x`) is not a match, and the path equal to the prefix itself
  belongs to no entry. `S/routing.ts:33-61`; `T/projection.spec.ts:297-330`. Hydrate respects the same
  owner. `S/projection.ts:208-213`; `T/projection.spec.ts:815-836`.
- W10. Mounting one collection twice in one projection throws at `createProjection`, naming both prefixes.
  Two different collections at nested prefixes are allowed. `S/projection.ts:115-132`;
  `T/projection.spec.ts:863-901`.
- W11. `scope` on a mount narrows it to one key prefix of the collection (`"a"` addresses `a/...`). The
  agent sees those files as the whole mount, with the scope stripped; every list, read, write and delete
  is keyed under the scope, and the listing is filtered at the collection. A scope that is empty, has a
  leading, trailing or repeated `/`, or a `.` / `..` segment makes `createProjection` throw. A nested
  scope like `"a/b"` is accepted. `S/types.ts:85-101`; `S/projection.ts:134-136,173-188,492-500`;
  `T/scoped-mount.spec.ts:41-65,88-114,116-141`. A scoped run deletes only what it hydrated, never
  another owner's files. `T/scoped-mount.spec.ts:88-114`.
- W12. `entryState(key)` on a mount: extra state stamped on every entry the projection commits (a title, an
  author). It does not replace `path`, `hash`, or `updatedAt`; those stay the projection's.
  `S/types.ts:107-130`; `S/projection.ts:463-466`; `T/projection.spec.ts:591-630`.
- W13. Identifying the collection. `Mount.collectionId` is required: the same string for two runs addressing
  the same rows, a different one for two that only spell paths alike. `S/types.ts:67-84`.
  `collectionIdFor(collection, principal)` builds it from scope, the scope instance and the pattern;
  `principalFromContext(ctx)` reads the principal off a block's execution context.
  `S/scope-identity.ts:26-38,139-148`. `unscopedCollectionId(collection)` is for a door with no execution
  context, and errs toward refusing. `S/scope-identity.ts:150-166`.
- W14. Places. `createHostPlace(root)` creates `root` if missing, refuses a path that resolves outside it
  (error "path escapes the workspace root"), refuses to read or write through a symlink at the leaf or in
  the parent chain, and neither lists nor follows symlinks. `S/host-place.ts:38-59,103-120,122-162,164-213`;
  `T/host-place.spec.ts:103-127,158-234`. `createMemoryPlace(initial?)` keeps files in a `Map` and adds
  `snapshot()`, `remove(path)` and `breakListing(reason?)`. `S/memory-place.ts:12-24`.
- W15. A custom place implements `read(path): Promise<string | null>`, `write(path, content): Promise<void>`
  and `list(prefixes): Promise<readonly string[]>`. It does not run commands, so a place that can only
  hold files is a valid place. `S/types.ts:24-36`.
- W16. `list` must throw if the place cannot be read; returning `[]` asserts "readable and empty", and a flush
  acts on that by deleting what it owns. `S/types.ts:18-23,29-35`; `T/host-place.spec.ts:41-50,75-100`.
  `createHostPlace` re-checks the root when a prefix directory is missing, so a vanished root throws
  rather than reading as empty; a prefix never created lists as empty. `S/host-place.ts:133-153,214-219`;
  `T/host-place.spec.ts:68-73`.

## Two runs change one file: what happens?

- W17. Why three values. `flush` compares `theirs` (what the collection holds now), `ours` (what the place
  holds now) and `base` (what the projection last put there). Two values cannot tell "I changed this"
  from "somebody else changed this". `S/projection.ts:7-17`.
- W18. The decision for one path, in order: local hash equals base, `unchanged`; otherwise claim the entry
  (refused, `contested`); read the collection; no base and nothing in the collection, `created`; collection
  hash equals base, `written` (content and state are committed); local hash equals collection hash,
  `converged` (nothing written, baseline advances); otherwise `conflict`. `S/projection.ts:369-427`;
  `T/projection.spec.ts:72-136`.
- W19. A conflict is an outcome of a flush that succeeded. Everything uncontested still lands, and the
  contested path is left as both writers left it: the collection keeps the other writer's content.
  `S/types.ts:120-126`; `T/projection.spec.ts:129-135`.
- W20. A conflict outcome carries `path`, `base` (what the projection last committed, or `null` if it never
  laid the path down), `theirs` (what the collection holds now, or `null`) and `ours` (what the place holds
  now, or `null` if deleted). All three are SHA-256 hashes of content, not the content. `S/types.ts:176-189`;
  `S/projection.ts:420-426`; `T/projection.spec.ts:114-136`.
- W21. Two runs hydrate the same collection, both edit `spec.md`, A flushes first: A's write lands, B gets a
  `conflict` on `artifacts/spec.md` and A's content survives. `T/projection.spec.ts:261-281`.
- W22. Edit against delete is also a conflict: the run removes a file the projection owned while somebody
  edits it in the collection. The report says `ours: null` and the collection keeps the edit.
  `S/projection.ts:337-347`; `T/projection.spec.ts:207-229`.
- W23. Different files: both land and neither is contested. `T/projection.spec.ts:231-259,681-697`.
- W24. Writing the same file at the same moment is `contested`, not `conflict`. A conflict is somebody who
  already wrote (three hashes describe it). A contested path is somebody writing now, so there is nothing to
  compare. Nothing is written for it. `S/types.ts:165-175`; `S/projection.ts:394-397`;
  `T/projection.spec.ts:699-714`. A delete takes the same claim and is refused the same way.
  `S/projection.ts:315-319`; `T/projection.spec.ts:716-729`. The outcome has only `kind` and `path`.
  `S/types.ts:175`. The contested file stays in the caller's place, so it can retry; the other run's write
  stands. (The "stays in your place" half follows from nothing being written: `S/projection.ts:394-397`.)
- W25. The claim is taken after the "unchanged" check and before the collection read, and covers the
  read-compare-write. A path the run only read unchanged is never claimed, so it cannot be refused.
  `S/projection.ts:381-397`; `T/projection.spec.ts:731-744`; `T/concurrency.spec.ts:117-156`.
- W26. A claim is held for one operation (one `flush` or one `put`) and belongs to that operation, not the
  projection, so two overlapping requests sharing one projection (a session-scoped workspace) still
  arbitrate: exactly one writes, the other is `contested`. `S/projection.ts:225-249`;
  `T/concurrency.spec.ts:193-222`.
- W27. Claims are per durable entry (`collectionId` plus key), not per path. Two sessions each writing
  `artifacts/report.md` over different collections write two entries and neither refuses the other.
  `S/claims.ts:24-28,47-49`; `T/concurrency.spec.ts:224-260`. `claimKey(collectionId, entryKey)` is the
  key. `S/claims.ts:47-49`.
- W28. `claims` option scopes arbitration to a subset of projections. Omit it and all projections in the
  process share `sharedClaimRegistry`. `S/projection.ts:89-97,106-110`; `S/claims.ts:86-93`.
  `createClaimRegistry()` makes a registry. `S/claims.ts:67`.
- W29. `collectionIdFor` is close to, not equal to, the engine's storage key: two flows that isolate the same
  user's resources from each other share an id, so one can be told `contested` over a row it does not
  share. That direction is retryable and safe. `S/scope-identity.ts:129-137`.
  Source for reconciling with Reference only; a Concept-level page needs the sentence at most once.

## What does the flush report say?

- W30. `flush()` resolves (never rejects on disagreement) with `{ outcomes, conflicts, contested }`.
  `outcomes` is every path it reached in order; `conflicts` and `contested` are the filtered subsets.
  `S/types.ts:191-199`; `S/projection.ts:350-358`.
- W31. The outcomes (`FlushOutcome.kind`): `unchanged` (matches the baseline), `created` (no baseline, nothing
  in the collection), `written` (collection still held what the projection left), `converged` (collection
  already held this content, nothing written, baseline advances), `deleted` (run removed a file the
  projection owned and nobody changed it, or it was already gone), `orphan`, `readonly`, `contested`,
  `conflict`. `S/types.ts:127-189`. Each has a test: `T/projection.spec.ts:72-136`.
- W32. Deletes: the flush deletes the collection entry only for a path in the baseline that is absent from
  the place, writable, and whose collection content still hashes to the baseline. Already gone in the
  collection also reports `deleted`. A path the projection never laid down is never deleted, however
  absent it looks. `S/projection.ts:306-348`; `T/projection.spec.ts:175-205`.
  A file the run creates and flushes becomes owned, so a later removal propagates. `T/projection.spec.ts:176-191`.
- W33. Re-flushing: the baseline moves on every clean outcome, including `converged`, so a second flush over
  a path the first wrote reports `unchanged` and ordinary work stays quiet. `S/projection.ts:19-26,412-418`;
  `T/projection.spec.ts:139-173`.
- W34. A file that vanishes between the listing and the read is left alone and stays owned, so the flush does
  not delete the collection entry. `S/projection.ts:291-302`; `T/projection.spec.ts:620-666`.
- W35. `orphan`: a path no mount claims. From `put`, a path outside every mount is `{ kind: "orphan", path }`
  and nothing is written to a collection. `S/projection.ts:429-432`; `T/projection.spec.ts:496-503`.
  CAUTION (existing page vs code): a `flush` lists the place only under the mount prefixes, so a file the
  run dropped outside every prefix is never walked and never reported. The existing page's row "A file
  written outside every writable mount" is true of `put`, not of an ordinary flush. `S/types.ts:141-152`;
  `S/projection.ts:267`. The one case a flush reports an orphan is a file sitting at the mount root path
  itself (a file named `artifacts` where the directory should be); nothing is written to a collection.
  `T/projection.spec.ts:331-348`; `S/routing.ts:49-54`. Do not describe flush orphans as "files outside
  the mounts".
- W36. `readonly`: only `put` produces it, with the mount's prefix in the outcome (`{ kind: "readonly", path,
  prefix }`). Unlike `conflict` and `contested`, retrying never clears it. A flush skips read-only paths.
  `S/types.ts:153-164`; `S/projection.ts:445-447`; `T/projection.spec.ts:505-523`. The existing page's
  outcome table omits it from the table and covers it under `put`.
- W37. The flush rejects only when the place cannot be listed, with `PlaceUnreadableError`
  (message "the workspace could not be listed: ..."). Nothing was read, written or deleted, so a caller may
  swallow it; any other rejection (a collection read, write, delete) means work did not reach the store and
  must not be swallowed. `S/projection.ts:256-273`; `S/types.ts:201-217`; `T/projection.spec.ts:368-402`;
  `T/host-place.spec.ts:85-100`. Not on the existing page; the README has the `try/catch` example
  (`packages/workspace/README.md:134-142`).

## Writing one file at a time: `put`

- W38. `put(path, content): Promise<FlushOutcome | undefined>` commits one path already written, through the
  same decision as a flush (`decide` is shared). `S/projection.ts:61-78,361-368,429-449`.
- W39. Why not a flush: a flush walks the whole place, and a projection holding no baseline would report every
  pre-existing file as new. `put` narrows to one path and advances the baseline so the next flush reads it
  as the run's own. `S/projection.ts:62-72`.
- W40. Outcomes from `put`: `created`, `written`, `converged`, `conflict`, `contested`, `unchanged`
  (content equals baseline), `orphan` (no mount), `readonly` (read-only mount). It resolves `undefined`
  only for a collection's `_` bookkeeping key, even under a read-only mount. `S/projection.ts:429-449`;
  `T/projection.spec.ts:441-546`. A conflict from `put` happens when somebody else changed it since the
  projection last committed it. `T/projection.spec.ts:460-470`.
- W41. `put` normalises a `./`-prefixed path the way a flush does. `T/projection.spec.ts:487-494`;
  `S/routing.ts:23-25`.
- W42. After `put`, the path is owned, so a later `flush` deletes it if the run removes the file.
  `T/projection.spec.ts:472-485`.
- W43. `put` does not write to the place; the caller already did. It only commits to the collection.
  `S/projection.ts:61-66,448`.

## When to reach for this over Bash

- W44. Bash is a tool a model calls; the workspace is the mechanism under it. The bash tool "mounts each
  collection at its pattern prefix, routes writes back by longest-prefix match" and syncs after mutations.
  `apps/docs/docs/tools/bash.md:9-11,35`. `createBashTool` and `createBashBlocks` share one wiring over a
  projection. `packages/tools/src/bash/projection-setup.ts:1-12`.
- W45. Reach for the package directly when the agent is not a model calling a shell tool, for example a
  coding harness handed a directory, which "on its own is handed a directory and left there", and nothing
  carries its writes back. `packages/claude-code/src/sdk/workspace.ts:1-12`. A place need not execute
  anything. `S/types.ts:12-17,24-36`.
- W46. The collections are installed on the flow by the flow's blocks and capabilities; the projection is
  given `Mount`s, it does not discover them. Bash auto-discovers collections on `ctx.resources`.
  `apps/docs/docs/tools/bash.md:21-27`; `S/types.ts:57-66`. (The projection does not discover.)

## Limits (stated flat, not argued)

- W47. Arbitration is in-process only; the baseline is per-projection and not persisted. `S/claims.ts:30-35`;
  `S/projection.ts:28-33`.
- W48. A flush decides on content hashes of text; `read` and `write` move `string` content, UTF-8.
  `S/types.ts:26-28`; `S/host-place.ts:182,209`. Binary files are not addressed anywhere in the surface;
  do not state anything about them.
- W49. A mount is hydrated whole (or by `scope`): `hydrate` lists the collection and reads every entry.
  `S/projection.ts:173-205`. A collection with many entries is all laid into the place.
- W50. A read-only mount is not guarded against edits in the place: a flush skips it silently, so an edit to
  a hydrated read-only file is neither saved nor reported on flush. Only `put` says `readonly`.
  `S/types.ts:153-164`; `S/projection.ts:286-288`; `T/projection.spec.ts:350-366`.

## Left out of the page (surface exists, not this page's job)

- The package also exports the workspace host (`localWorkspaceHost`, `WorkspaceRefusedError`,
  `fileHeldWorkStore`, run sources, worktrees, `land`, checkout commands, lock helpers). `S/index.ts:45-107`.
  They serve the coding harness path and are outside "Projecting a collection to disk; writing one file".
  Cross-check against the sitemap before adding any.
- `recordBranchPullRequests` and `BranchPullRequestsResult`: documented on the existing page under "Pull
  requests on a branch" (`apps/docs/docs/tools/workspace.md`, last section), tied to the coding-agents
  page. `S/branch-pull-requests.ts`; `S/index.ts:63-72`. The page plan's "Keep, trim" and its two
  topics (projection, one file) leave it out; if it stays, its facts are on the existing page and the
  source above, and a separate sheet row is needed. FLAG for the caller.
- `refreshLock` and `privateTempRoot`: on the root export (`S/index.ts`), for harness packages (a held checkout's lock heartbeat; a per-account private temp folder). The package has one export.

## Contradictions and corrections found

- C1. Existing page, outcomes table, `orphan`: "A file written outside every writable mount." A flush does not
  see files outside every mount prefix (see W35). Say: "a path no mount owns, reported by `put`".
- C2. Existing page says of a conflict that "you get three hashes" and shows `c.base`, `c.theirs`, `c.ours`
  as hashes: correct (W20), but they are SHA-256 hex digests, not content. A reader may expect content.
- C3. Existing page: "`put` resolves `undefined` only when there's genuinely nothing to decide — a
  collection's own metadata". Correct. `S/projection.ts:439`.
- C4. Existing page: "It's applied last, so it can override what the projection chose." No longer true.
  The projection writes `path`, `hash`, and `updatedAt` after the mount's fields, so a mount cannot
  replace those three. `S/projection.ts:463-466`.
- C5. Existing page: contested "Nothing was written for that path, and nothing was lost: the other run's
  write stands, and yours is still in your place to retry." Correct, since a contested decision returns
  before any write. `S/projection.ts:394-397`.
- C6. The existing page's `hydrate` / example block uses free variables `ctx`, `artifacts`, `docs`. A page
  example must declare or import them (see W5).
- C7. README `claims` section says "hold the claim until it's released" (`packages/workspace/README.md`, "Two
  runs, one file"); code releases at the end of each operation (W26). Use the code.

## Revise round 1 (page as published after pass 8)

- The page now states only: the W1/W4/W44-45 summary; W5-W6 and W8 (one clause), W13 (`collectionId`, one sentence);
  ownership (W32, one sentence: deletes only paths the projection laid down or committed, `ownedPaths()`);
  W30-W31 outcome kinds as a bare list (`orphan` is not defined on the page; see W35); W19-W20 and W17 (`base`);
  W24 (`contested` defined in one sentence); W27-W28, W47 (one sentence, in-process); W36 (`readonly`, `put` only);
  W38-W40 (`put`); W14 (`snapshot`, `remove`, `breakListing` makes `list` throw: `S/memory-place.ts:12-24`);
  W15-W16 (own place, `list` must throw); the pull-request lookup (surface only, `S/branch-pull-requests.ts`).
- Moved to Reference R-42 (`reference/tools`), linked from the page: mount nesting (W9), `entryState` (W12), the full
  outcome table (W31, W35), conflict report detail, ownership (W28/W32), `put` ownership (W42), refusal between
  runs and its scope (W24-W28), `unscopedCollectionId`, place details (W14, W16), and the whole branch
  pull-request lookup detail (branches, `openedSince`, result rules, failure shapes, timeout).
- Corrections: `observedPullRequestsCollection` is exported from `@flow-state-dev/core/harness`, not the core root
  (`packages/core/src/harness/index.ts:111`). A flush reports `orphan` only for a path no mount routes (W35). A
  projection also creates and writes paths it does not own; only deletion and overwrite need ownership
  (`S/projection.ts:368-377`, `:275-295`).
- Examples type-check as `src/lib/*.ts` against the package source; free variables became parameters.

## Revise round 2

- `collectionId` sentence now states the observable effect: same id over the same rows means a simultaneous write to one entry is `contested` (W13, W24, W27, claims keyed by `collectionId` plus key, `S/claims.ts:47-49`); different ids are never arbitrated. The review's suggested `conflict` wording was not used: `conflict` comes from comparing hashes against the baseline (W18), not from `collectionId`.
- Refusal sentence names the outcome (`contested`, W24) and keeps the in-process limit flat (W47).

## Revise round 3

- The which-runs-get-checked rule (same `collectionId` over the same rows is arbitrated, different ids never; W13, W27) moved from the mount paragraph to the flush-report section where `contested` is defined. The mount paragraph now defines `collectionId` and `collectionIdFor` only.
- The conflict-hash note now says what a reader reads off the hashes: `ours: null` is a delete against someone's edit (W22), `base: null` is a path the projection never laid down (W20). The `/tmp/run-42` comment became generic, since `runResearch` is not given the run id.
