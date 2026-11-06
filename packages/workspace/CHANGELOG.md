# @flow-state-dev/workspace

## 0.4.0

### Minor Changes

- 73f8352: Accepting a coding run's review can now land its work: **Open a PR** pushes the run's branch and opens a pull request, and **Merge locally** merges it into the base branch where your checkout has it (FIX-2543).

  - **harness-manager:** with `reviewChanges`, an accept can name `land: "pull-request" | "merge"` (`harnessReviewAnswerSchema`). The review's data lists the ways this host offers (`lands`). If the landing fails, the task doesn't complete: the review is asked again with the error (`landFailed: { land, message }`), so the user can retry or pick the other way, and the run's branch and commits are kept. The output gains `landed`: `{ kind: "pull-request", url, number, branch, base, remote }` or `{ kind: "merge", branch, commit, checkout, from }`, `null` unless the work landed. A pull request is written to the run session's `observed-pull-requests` record. `ReviewDetail` gains optional `lands` and `landFailed`, and `ReviewLand` is exported from the `browser` entry. A plain `{ verdict: "accepted" }` completes the task without landing anything.
  - **workspace:** `WorkspaceHost.land(target, request)`, implemented by `localWorkspaceHost` for a repository in `localRepositories`. A pull request pushes to the remote pinned at start (the base's upstream, else `origin`), never force-pushes, and returns the pull request already open for the branch instead of opening a second. A merge lands the run's commits on the base by fast-forward or a merge commit, whatever the repository's squash or no-commit settings say, never overwrites an ignored file, and never resolves a conflict. A base that names a pinned remote's branch (`origin/main`, `refs/remotes/origin/main`) targets that branch on the remote for a pull request and the local branch tracking it for a merge; a local branch named `origin/main` stays that branch. A refusal is a `WorkspaceRefusedError` whose `reason` is `land-unsupported`, `base-unknown`, `no-push-remote`, `remote-repointed`, `push-failed`, `pull-request-failed`, `base-not-checked-out`, `checkout-dirty`, `checkout-busy` (the checkout is mid-merge, rebase, cherry-pick or revert, and is left alone), `merge-conflict` (aborted, naming the files) or `merge-failed`; after a merge refusal the checkout is as it was. New exports: `LAND_TIMEOUT_MS`, `Landed`, `LandRequest`, `LandTarget`.
  - **ui registry (`review-hold`):** with `lands`, Accept is two buttons, **Open a PR** and **Merge locally**, and a review asked again with `landFailed` shows the error and **Retry**. Pass the stop's suspension id, or the hold's id, as `holdId`, so a retry that fails with the same error still shows Retry. `LandedOutcome` draws where accepted work went and what to do next.

  Docs: apps/docs/docs/orchestration/harness-manager.md, packages/harness-manager/README.md, packages/workspace/README.md, packages/ui/README.md

### Patch Changes

- a124a8e: A project's repository can be checked before any run. `localWorkspaceHost` answers `checkRepository(repository, { ignored })` without making anything: whether a run's checkout could be made there, and if not, a sentence naming the fix. The ignore rule is read from the last commit, as a run's checkout gets it, so a rule that is only in uncommitted changes is refused with "commit it". `defineProjectBlocks({ checkRepository })` uses it to refuse `createProject` and `setRepository` with `repository-unusable`, and serves a read-only `checkRepository` action a page can ask before Create. `harness-manager` exports `ASK_MARKER_IGNORED`, the rule coding runs need (FIX-2403).
- Updated dependencies [531bf32]
- Updated dependencies [05a7022]
- Updated dependencies [c67aa49]
- Updated dependencies [f1e6315]
- Updated dependencies [da4a4bb]
- Updated dependencies [5f569fd]
- Updated dependencies [844a4f9]
  - @flow-state-dev/core@0.5.0

## 0.3.0

### Minor Changes

- cc0ab62: Choose where a coding session starts, and remove what it left on disk (FIX-2419).

  - `@flow-state-dev/workspace`: a `baseRef` naming a pinned remote's branch (`origin/main`) in a listed repository is fetched before the cut, and refused as `remote-unreadable` when the fetch fails. `PlaceRequest.existing` checks a branch out instead of cutting one, making it from the remote's when absent (`no-such-branch` when there is none). `localWorkspaceHost` gains `list()` and `remove(target, { deleteBranch?, force? })`, the one removal path, which refuses uncommitted work (`uncommitted-work`), a place mid-provision (`place-busy`) and, unless forced, deleting a branch that holds the only copy of a commit, or removing a detached HEAD that does (`unique-commits`). `pullRequestHead` resolves a same-repository pull request to its head branch. `occupyWorktree` holds a worktree in use (`<dir>.lock`), and `remove` refuses one a run holds (`in-use`); `checkedOutBranch` reads the branch a worktree is on.
  - `@flow-state-dev/harness-manager`: harness session state gains `start` (`{ base } | { branch } | { pullRequest } | { worktreeOf }`, fixed at create like `model`) and a server-owned `workspace` record. `HarnessSessionWorkspace.provision(place, { start })` may return `{ path, branch }`; the turn-end pull-request check reads the recorded branch. A `removeWorktree` action, refused while a turn runs, calls the workspace's optional `remove`. `resolveHarnessSessionStart` maps a start to a workspace host's request. `{ worktreeOf: sessionId }` attaches a session to another session's worktree and branch: refused at create (404) when that worktree isn't there in the caller's tenant and at its turn when it isn't in the user's own list of worktrees, each turn holds the same in-use lock as the owner's, only the owner may `removeWorktree`, and an attached turn that leaves the worktree on another branch is recorded as failed. The workspace record carries `owner`.
  - `@flow-state-dev/fsdev`: `fsdev worktrees <root>` lists a workspace host's worktrees and removes one with `--remove`.

- cb395b2: `localWorkspaceHost({ setup: { command, env? } })` runs a setup command, such as `pnpm install`, in each new repository checkout before handing it over. It runs again on later provisions until it succeeds, and it counts against `provisionTimeoutMs`. `PlaceRequest.onSetup` is called when it starts, and `WorkspacePlace.setup` reports `done`, or `failed` with the tail of the output. A failure doesn't refuse the provision. In harness-manager, `WorkspaceConfig.setup` is passed through to the host, and task-board runs show the setup on their stream. The session flow's `provision(place, request)` may return `{ path, setup }` and pass `request.onSetup` to the host, and the turn record gains `setup` (FIX-2420).
- cc0ab62: Add a shared list of worktrees (FIX-2439).

  - `@flow-state-dev/workspace`: `worktreesCollection` is a user-scoped, `llmReadable` collection with one row per worktree a host made. A row holds `name`, `path`, `branch`, `repo`, `baseCommit`, `owner`, `attached`, `state`, `commits`, `lastTurnAt` and `pullRequests`. To have the host write rows, give it the collection: `PlaceRequest.worktrees` writes `provisioning`, then `ready`; the new `host.attach` adds a session or run to `attached` (`{ kind, id, lastTurnAt }`); the new `host.recordCheckout` writes the branch and commit count together at a turn's end and returns what it read; and `RemoveOptions.worktrees` marks the row `removed`. `recordBranchPullRequests` takes `worktree: { collection, key }`. `WorkspacePlace.worktree` is the row's key.
  - `@flow-state-dev/harness-manager`: the session flow declares the collection and passes it to `HarnessSessionWorkspace`: on `provision` and `remove`, and on the new optional `attach` and `recordCheckout`. It stores the row's key as `state.workspace.worktree`, and marks `worktrees` read-only to the model's resource tools. The board manager writes a row for each run's checkout.

### Patch Changes

- 488b203: `@flow-state-dev/workspace` exports `parseCheckoutCommand(command)`, which checks and splits a command in one call: `{ words }` with the program first, or `{ problem }` with the same sentence `checkoutCommandProblem` gives. Use it where a setting becomes a command to run, such as a host's setup command (FIX-2387).
- Updated dependencies [e0daf6e]
- Updated dependencies [151309c]
- Updated dependencies [824ce87]
- Updated dependencies [7d92efe]
- Updated dependencies [387bee2]
- Updated dependencies [6c4a3b3]
  - @flow-state-dev/core@0.4.0

## 0.2.0

### Minor Changes

- 71ab534: A workspace host can read a run source's files without a run (FIX-2285). `WorkspaceHost.readSource(answer, request)` is an optional method that lists paths by a glob, reads a range of one file's lines, or searches with grep. `localWorkspaceHost` implements it. It reads a repository from its shared clone at the remote's default branch, never a run's branch. It reads a checkout listed in `localRepositories` at the base a new run there would be cut from, and kept files from their collection. It makes no place. A read fetches the clone at most once a minute and never waits on the clone's lock. Results are capped by `SOURCE_READ_LIMITS` (500 paths; 2,000 lines or 256 KB; 200 matches with 200-character snippets) and say when they were cut. A path that is not a plain repository path is refused as `invalid-path`. `tryAcquireLock` is new: it tries the host's lock once and does not wait. The host now keeps `<root>/.clones/<key>.fetched.json` beside each clone, naming when it was fetched and the default branch and commit that fetch landed on, which reads serve. `run` takes an `onLine` option that hands standard output over line by line instead of buffering it.
- 0d55d46: A session keeps a record of the pull requests it opened (FIX-2268). Core adds the `observed-pull-requests` collection (`observedPullRequestsCollection`), one writer (`writePullRequests`), a replaceable GitHub rule (`githubPullRequestRule`, `DEFAULT_PULL_REQUEST_RULES`) and the recorder: `recordPullRequests(ctx)` for a block, and `pullRequestRecorder()` for a flow with no harness to add as a `.tap` step. A `gh pr create` command or a `create_pull_request` tool whose output holds the link is one row, written as the call settles. Each row carries the `requestId` that opened it.

  The Codex, Claude Code and Cursor blocks record by default; `recordPullRequests: false` turns it off. Workspace adds `recordBranchPullRequests`, a host-side check that asks GitHub through `gh` which pull requests a checkout's branch has. The harness manager declares the record and runs that check before its verdict and when a run fails.

  **Migration.** A Codex, Claude Code or Cursor block now declares the `observed-pull-requests` session collection by default. A test that asserts the block declares no resources must pass `recordPullRequests: false`.

- 06ea781: A checkout handed back off its run's branch is no longer refused. The host moves it back onto the run's branch and keeps what the run made elsewhere: a fast-forward when the checkout's commit contains the branch, and otherwise a checkout of the branch. It reports this as `place.repo.movedBack`. A checkout with uncommitted changes on a branch that lacks the run's commits is handed back as it is and reported as `place.repo.offBranch`, because those changes are the run's to commit, stash or discard; harness-manager refuses that attempt with the message. A half-done git operation, or the branch checked out in another worktree, is refused as the typed `WorkspaceRefusedError` `checkout-moved`, naming the git command that clears it. A run that switches its own branch no longer strands its session (FIX-2211).
- ba74f01: `harnessManager({ workspace })` accepts a workspace host from `@flow-state-dev/workspace` as well as a fixed `{ root, sourceRepo, baseRef }`, and provisions every run through the host either way. A run keeps the repository and base it started on (recorded on its run record) when its source later changes, and a run that started with no repository stays on its kept files. Its kept files are saved at the end of each turn, when it asks a question, and when the harness fails, and a run is not completed while its last save failed. A run its workspace refuses (the source answers `refused`, or the host won't provision the remote) is cancelled on its first attempt instead of being retried, and `HarnessRunRefused` is exported. `localWorkspaceHost` gains `localRepositories`, for a repository on the machine that runs are cut from directly, with no clone and no fetch, and a place request can name a directory the checkout's repository must keep out of git, which a run with no repository also leaves out of its saved files. A provision's `provisionTimeoutMs` now covers its waits for other provisions of the same place or clone, and `save` refuses a place handle that a later provision of the same place has replaced. `run`, `GIT_TIMEOUT_MS` and `CHECKOUT_CLEANUP_TIMEOUT_MS` from `@flow-state-dev/harness-manager/checkout` are now re-exported from `@flow-state-dev/workspace` (FIX-1762).
- 2348dbd: A repository listed in `localRepositories` now fetches the base's upstream and cuts a new run's branch from whichever of local and upstream is newer, refusing a base whose two copies have each moved as `base-diverged` and recording the commit cut at as `place.repo.baseCommit`, which the run record keeps and `readRunCommits` now counts a run's commits from (FIX-1927).
- 9510a03: Requests now carry `ctx.request.incarnation`, a token that stays the same across a request's retries and resumes and that request-scoped workspace keys and local `scope: "run"` bash directories now include, so a request reusing a deleted request's id starts empty; existing run workspaces move once on upgrade, and a run in flight at deploy continues in an empty directory (FIX-1286).
- 57a859d: A workspace host can now hold a repository run's commits and uncommitted files off the machine, and rebuild the checkout on another host. Off by default: pass `heldWork: fileHeldWorkStore({ dir })` (or your own `HeldWorkStore`) to `localWorkspaceHost`, and have the run source answer a `heldPrefix`. `checkpoint(place, recorded?)` now returns the hold (or `null`) instead of nothing; new `dropHeld`, `hostId` and `holds` on the host; `provision` takes the run's `recorded` place and hold, returns `origin`, and rejects with `HeldWorkMismatchError` when held work disagrees with the record. A host without a store rejects a recorded hold with `field: "disabled"` instead of starting the run over (FIX-1766).
- 707b340: Add `localWorkspaceHost`, which turns a run source's answer into a place a worker edits (a fresh branch of an allowed remote in `checkout/` with kept files in `project/`, or kept files alone in `workspace/`) and saves the kept files back, plus a `scope` on `Mount` that confines a projection to one key prefix of its collection (FIX-1762).

### Patch Changes

- 8628a54: `redactRemote` is exported so a caller can show a git remote with its userinfo removed (FIX-1762).
- f2f8527: A repository listed in `localWorkspaceHost`'s `localRepositories` now keeps the remote URLs and branch upstreams the host pinned across restarts, so a run that rewrites the repository's config can't aim a later host's fetch. A remote that no longer matches its pin is not fetched, and the warning names the pin file to delete to accept a deliberate change. A fetch that fails or is skipped now starts the run from the local base instead of the remote-tracking ref (FIX-1934).
- 315f7f3: `projectWorkspace({ checkouts })` runs a listed shared project's coding runs in worktrees of a checkout on the server's machine, with the project's kept files beside each worktree, which `localWorkspaceHost`'s `localRepositories` now supports (FIX-1906).
- c4d14f6: The local workspace host no longer runs the repository's git hooks while it makes or hands back a checkout (`-c core.hooksPath=/dev/null` on its worktree git calls). A `post-checkout` hook that builds, such as `pnpm packages:build`, used to fail `git worktree add` in the fresh tree and fail the provision with it (FIX-1947).
- Updated dependencies [92b2b70]
- Updated dependencies [20aa58f]
- Updated dependencies [5d31955]
- Updated dependencies [bea14a0]
- Updated dependencies [24afa6e]
- Updated dependencies [f8df86f]
- Updated dependencies [82eea02]
- Updated dependencies [e2c190e]
- Updated dependencies [0d55d46]
- Updated dependencies [1abab86]
- Updated dependencies [8e67ce5]
- Updated dependencies [dd353e2]
- Updated dependencies [3221d05]
- Updated dependencies [58ffc93]
- Updated dependencies [f97b0ed]
- Updated dependencies [397cfa7]
- Updated dependencies [53b50f0]
- Updated dependencies [646f8d2]
- Updated dependencies [16a8dab]
- Updated dependencies [456fe85]
- Updated dependencies [62133c4]
- Updated dependencies [9d02ac6]
- Updated dependencies [d5ce1e0]
- Updated dependencies [8dc242e]
- Updated dependencies [89af7db]
- Updated dependencies [7d4158f]
- Updated dependencies [5492a77]
- Updated dependencies [6819520]
- Updated dependencies [ad5df6f]
- Updated dependencies [211679a]
- Updated dependencies [dd80e01]
- Updated dependencies [2ce15c7]
- Updated dependencies [5181ddb]
- Updated dependencies [2969b30]
- Updated dependencies [a74429a]
- Updated dependencies [e71ea1a]
- Updated dependencies [49d6397]
- Updated dependencies [a55d07f]
- Updated dependencies [7db4d13]
- Updated dependencies [9e3b823]
- Updated dependencies [df3de3b]
- Updated dependencies [fe5df7d]
- Updated dependencies [423a405]
- Updated dependencies [08a9b05]
- Updated dependencies [7da156e]
- Updated dependencies [01b29f0]
- Updated dependencies [712dc22]
- Updated dependencies [afb512f]
- Updated dependencies [f9995b1]
- Updated dependencies [a7f1c41]
- Updated dependencies [3a6c910]
- Updated dependencies [80f6e25]
- Updated dependencies [3cbab3a]
- Updated dependencies [849f6ec]
- Updated dependencies [028af6f]
- Updated dependencies [a965a50]
- Updated dependencies [eb831f8]
- Updated dependencies [41638f3]
- Updated dependencies [311a6d5]
- Updated dependencies [7d4c413]
- Updated dependencies [27b198a]
- Updated dependencies [db7df1c]
- Updated dependencies [0d6278e]
- Updated dependencies [968faa6]
- Updated dependencies [653549d]
- Updated dependencies [839e915]
- Updated dependencies [02ee032]
- Updated dependencies [16bb676]
- Updated dependencies [9510a03]
- Updated dependencies [adbcf0b]
- Updated dependencies [1027b98]
- Updated dependencies [1cfd80c]
- Updated dependencies [3b0161c]
- Updated dependencies [385d01e]
- Updated dependencies [d1a4cab]
- Updated dependencies [3311cc2]
- Updated dependencies [7c9e932]
- Updated dependencies [60c8192]
- Updated dependencies [0503c38]
- Updated dependencies [8195995]
- Updated dependencies [295e96a]
- Updated dependencies [97894aa]
- Updated dependencies [334c1e3]
- Updated dependencies [9ed6b29]
- Updated dependencies [b552b50]
- Updated dependencies [a021cd1]
- Updated dependencies [cd180d7]
- Updated dependencies [68b8957]
- Updated dependencies [e11764a]
- Updated dependencies [872a088]
- Updated dependencies [9cd314d]
- Updated dependencies [9af8ce5]
- Updated dependencies [30aa133]
- Updated dependencies [407964a]
- Updated dependencies [5708f16]
- Updated dependencies [50edfd4]
- Updated dependencies [d97031f]
- Updated dependencies [49d2aca]
- Updated dependencies [3c10d9d]
- Updated dependencies [96ff077]
- Updated dependencies [84cc226]
  - @flow-state-dev/core@0.3.0

## 0.1.3

### Patch Changes

- Updated dependencies [b597600]
- Updated dependencies [6b8bfe4]
- Updated dependencies [b48158a]
- Updated dependencies [f25f03c]
- Updated dependencies [e4c443e]
- Updated dependencies [bff5e06]
  - @flow-state-dev/core@0.2.0

## 0.1.2

### Patch Changes

- b56e7d1: Every package can be imported again: 0.1.1 shipped JavaScript whose relative imports were missing the file extensions Node's ESM resolver requires, so importing any 0.1.1 package failed with `ERR_MODULE_NOT_FOUND` (FIX-1431).
- Updated dependencies [b56e7d1]
  - @flow-state-dev/core@0.1.2

## 0.1.1

### Patch Changes

- Updated dependencies [7c52923]
- Updated dependencies [a8e22c4]
  - @flow-state-dev/core@0.1.1

## 0.1.0

### Minor Changes

- b3e6e22: Initial release (FIX-1187).

### Patch Changes

- Updated dependencies [67b4157]
- Updated dependencies [527c5ca]
- Updated dependencies [4e562d0]
- Updated dependencies [afcac3d]
- Updated dependencies [3cbc411]
- Updated dependencies [b3e6e22]
- Updated dependencies [ce85e80]
- Updated dependencies [d7208f7]
- Updated dependencies [1b94521]
- Updated dependencies [5fa52aa]
- Updated dependencies [2c4b0f5]
- Updated dependencies [4054c64]
- Updated dependencies [fda9b15]
  - @flow-state-dev/core@0.1.0

## 0.0.0

- Initial release. The file projection between resource collections and
  wherever an agent works: `createProjection({ mounts, place })` hydrates
  mounted collections into a place and flushes them back, reporting an
  outcome for every path it reached. A path two writers touched comes back
  as a `conflict` carrying what the projection last committed, what the
  collection holds, and what the place holds — the three values needed to
  tell "I changed this" from "somebody else changed this". Ships
  `createHostPlace` (a real directory, contained, symlinks neither listed
  nor followed) and `createMemoryPlace` (a `Map`, for tests).
