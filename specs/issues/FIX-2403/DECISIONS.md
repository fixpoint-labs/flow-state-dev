# FIX-2403 · Decisions

[Spec](SPEC.md) · **Decisions**

The issue settles the what: copy, chips and starter lines per app, and a repository check
before a project is made. The epic places the chips on FIX-2391's read (build order, wave 2)
and keeps shared UI in the registry (D4). One call is left: where the repository check lives.
The issue says "workforce's createProject error path"; this spec keeps the refusal there and
puts the check itself in the workspace host, which is what knows this machine.

```mermaid
flowchart TD
  E["FIX-2403"] --> D1["D1 · host's check, asked by the project writes through an option"]
  D1 -.->|"rejected"| X1["the lab's picker checks; the server doesn't"]
  D1 -.->|"rejected"| X2["workforce reads the disk itself in createProject"]
  E --> P["copy, chips, starter lines: per app (decided, not asked)"]
```

<a name="d1"></a>
## D1 · The repository check is the workspace host's, asked by workforce's project writes through an option

| | Host's check, through an option (chosen) | Lab picker only | Workforce reads the disk |
|---|---|---|---|
| A client that skips the page is refused | yes | no | yes |
| Same answer as the run's checkout gets | yes: one function, on the last commit's tree (E5) | a copy | a copy |
| Refuses by this server's disk | only where the app passes the option (opt-in) | no | always |
| Knows the host's remotes and listed repositories | yes | by lab code | no |

- **Instead of:** checking in the picker only, or making `createProject` stat paths and run
  git itself.
- **Because:** `repositoryProblem`'s own header says which remotes a host reaches is the host's
  call, made when it provisions. The host already holds the allow-list, the listed
  repositories and the ignore check (`ignoredProblem`), so asking it earlier gives one answer in
  two places instead of two answers that can drift (tenet 2; ER-3). Workforce stays a Layer 2
  package that offers the hook and holds no machine knowledge (ER-1, ER-2: opt-in, no default
  changes).
- **Locks in:** `WorkspaceHost.checkRepository` and its answer shape; the `checkRepository`
  option and action on `defineProjectBlocks`; the refusal code `repository-unusable`.
- **What would change my mind:** a second host kind (a cloud workspace) that can't answer
  without a network call per keystroke. Then the action stays and the picker asks on submit
  only.
- **If wrong, it costs:** moving an option between two packages; the host method stays.

## Decided, not asked

- **E1 · A starter line fills the composer; it never sends.** The person reads and edits it.
  Kitchen Sink's chips already behave so (FIX-2415); Shift Manager writes the composer's
  draft, not the palette's auto-send.
- **E2 · Starter lines come from what the app read at run time.** Shift Manager from the
  Shift Coordinator's delegates in the snapshot, Teammates from the roster row's delegates and
  role, the Claude Code-style lab from the view. Nothing names a Lab's worker in Shift
  Manager's source (it stays Lab-agnostic).
- <a name="e3"></a>**E3 · A network remote is not reached at create.** `https://` and `ssh://`
  remotes the host allows answer `usable` with `how: "clone"`; reach and credentials are still
  learned at the first run. A `git ls-remote` per keystroke is slow and needs credentials the
  page doesn't have.
- **E4 · Provision keeps its check.** A repository can change between create and run (a
  `.gitignore` edit, a deleted folder), so the run's refusal stays the last word. The two calls
  share `ignoredProblem`, so they can't disagree on the same tree.
- <a name="e5"></a>**E5 · The ignore check reads the last commit's tree, the one a run's
  checkout is cut from.** Not the working tree: a rule written but not committed protects
  nothing in a worktree or a clone, and following the picker's own remedy without a commit
  would pass the check and fail the run. The check writes the commit's `.gitignore` files to a
  scratch folder under a scratch index and runs the same `ignoredProblem` there. A rule that is
  only in uncommitted changes is refused with "commit the .gitignore change"; a repository with
  no commit yet is refused, since a run is cut from one. A pinned remote branch (`baseRef:
  origin/main`) is not fetched here; E4 covers it at the run. *(Amended after review: the
  first draft read the working tree.)*
- **E6 · The chips are one registry component** (`harness-readiness`), copied into both labs
  (epic D4). Each lab reads the rows through its own `harness-readiness` flow's `read`
  action, which FIX-2391 already serves.
- **E7 · Teammates' strip is one lab read** (folder, model, default harness, and the folder's
  ignore problem if any), served beside the readiness flow; no new package surface.
- **E8 · Teammates checks its folder's ignore rule at start, non-fatally,** with the same host
  method, and shows the problem in the strip. Start still refuses only a missing or non-git
  folder, as today.
- **E9 · The empty right pane in the Claude Code-style lab says what will appear there**
  (background tasks in Sessions, threads in Projects). Copy, no data.
- <a name="e11"></a>**E11 · The allow-list comes before the disk.** A path that is neither a
  listed repository nor a remote the host allows is refused before any `stat` or git call, so
  the read-only action can't probe the server's disk. The problems it names (no folder, not a
  repository, tracked files under `.fsdev/`) are the ones a run's refusal already shows for
  the same repository.
- **E10 · Order of work.** One package PR from `main` (workspace method, workforce option,
  harness-manager export, registry component), then one apps PR. Kitchen Sink's change touches
  `flow-state/page.tsx` by one prop; it merges after that file's open stacks if any are up.

## Considered and dropped

- **A first-run tour or overlay.** More surface than the issue asks for, and FIX-2340's shared
  overlay is still open.
- **Starter lines written by a model at session start.** A model turn before the first line
  costs money and time on every open, and the lines from live data already fit.

## Notes from review

Round 1 (Codex, and a second look posted on the PR):

- **Folded:** the check read the working tree, so an uncommitted rule passed and the run
  failed (both reviews). E5 now reads the last commit's tree; the unit list and goal leg a gain
  the uncommitted-rule case.
- **Folded:** allow-list first, as a decision (E11).
- **Folded:** D1's table overstated machine independence; the row now says the refusal is
  opt-in. A consequence: a project made on one host can be refused on another, and
  `setRepository` can refuse an existing project whose folder moved.
- **Recorded, not folded:** split the apps' copy into their own issues so the risky package
  piece isn't held behind it. E10 already ships the package first; the issue is scoped as one.
- **Recorded:** type the workforce option structurally (it is), reuse `ASK_MARKER_IGNORED`
  (it is), and say in the picker that a remote's reach is checked on the first run (E3).

## How it got here

- **Draft**: framed as four apps' first runs teaching from data they already have; the one
  shared mechanism is the repository check, moved from the first run to the project's
  creation by asking the workspace host's existing check earlier through a workforce option;
  the chips read FIX-2391's action through one registry component.
