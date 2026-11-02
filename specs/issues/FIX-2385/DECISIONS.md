# FIX-2385 · Decisions

[Spec](SPEC.md) · **Decisions**

The epic settles where the reader goes (ER-4: the harness-manager `./browser` entry) and that the
app's copy is deleted with the move (ER-3). What is left is how the reader meets the client, how it
fails, and where one storage key lives.

<a name="d1"></a>
## D1 · The reader takes the two resource reads it makes, not a whole client

| | `Pick<ResourcesApi, …>` (chosen) | The `Client` type | A local structural type |
|---|---|---|---|
| Any app's `Client` passes as is | yes | yes | yes |
| A test fakes it in a few lines | yes | no, the whole client | yes |
| One definition of the read's shape | yes, the client's | yes | no, a second copy |

- **Because:** it is what the client's own `read-every-page` does, and the reader makes only
  `getResourceManifest` and `listCollectionItems` calls.
- **Locks in:** `@flow-state-dev/client` is a harness-manager dependency. Type imports only, so
  nothing runtime reaches the root's graph. The run is `{ sessionId, requestId }`, not Shift
  Manager's `OpenRun`.

<a name="d2"></a>
## D2 · A failed read throws the client's own error

| | Pass through (chosen) | A package error type |
|---|---|---|
| Each app words its own failure | yes | it unwraps first |
| Shift Manager changes | an import only: the package drops the app's `fail()` wrapper, and the task screen's catch already words a raw error with `describeFailure` | its `RunReadError` maps a second type |

- **Because:** `RunReadError` carries Shift Manager's wording (`describeFailure`), which a package
  must not own. The task screen's catch already handles any error.
- **Locks in:** callers catch and word. **What would change my mind:** a second consumer needing
  the same split of "not recorded" from "could not read". Today `null` says not recorded and a
  throw says could not read, so it is already there.

<a name="d3"></a>
## D3 · The file-ops key stays a literal in the reader

| | Literal here (chosen) | Move `OBSERVED_FILE_OPS` into core |
|---|---|---|
| Change size | none beyond the move | a core export and a Claude Code re-export |
| One spelling | no, two | yes |

- **Because:** only Claude Code records file operations, and harness-manager cannot import it.
  The plan and pull-request keys moved to core when a second harness needed them, and this one
  should too, at that point.
- **Debt:** two spellings, named in the spec. Shift Manager's integration test drives the real
  recorder's rows, so a rename on one side fails it.

## Decided, not asked

- **E1 · Row shapes and names unchanged** (`RecordedWork`, `PlanStep`, `FileTouch`,
  `OpenedPullRequest`), so the task screen only changes an import.
- **E2 · Every section stays nullable.** FIX-2386 adds a run section (branch, base, path) the same
  way, as the epic's EM asked: `null` when the run has none (BP-023, BP-030).
- **E3 · No changeset.** The entry is new and its one consumer is in this repository; noted in the
  PR per BP-022.

## How it got here

- Drafted 2026-10-31 with the move built beside it, to prove both controls fail before proposing
  the checks.

## Notes from review

- Cursor (2cc91d8): approved direction. Folded: D2's table now says the package drops the app's
  `fail()` wrapper; the testing devDependency is named in the spec's Adds; the local patch path is
  dropped. For the implementer: keep `@flow-state-dev/client` imports in the entry's modules
  type-only, so the browser walk stays small. Deferred, uncertain until FIX-2384/2396: the pull
  request read lists the session's rows and filters by request, which may over-fetch as callers
  grow; don't swap in a read-every-page helper without a product reason.
