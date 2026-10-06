# devforce-lab › it codes in the project's repository

**Issue:** FIX-1762

**Outcome:** In the DevTeam lab, a coding run works where its project says. A project that names a
repository gets a fresh branch of that repository, with the project's files in `project/` beside
the checkout and never inside it. A project with no repository runs on its files alone, and each
run starts from what the last one saved. A remote the host does not allow is refused by name before
anything is cloned or run. Whatever a run keeps is saved back to the project.

Before this, every run in the lab was cut from one fixed scratch repository, whatever project held
the board, and nothing a run wrote outside git survived it.

**Input:** `fixtures/input.json`: the marker file's path, the note the storefront run keeps in
`project/`, the code it commits, the file the sandbox run writes, and a remote the host does not
allow. It is **held-out**: the stub reads every path and body from the row it is handed, so a
fixture with other paths, nested directories or another disallowed remote passes a correct
implementation (one was run; see the verdict log).

**Signal:** three legs, on one lab opened as the DevTeam profile opens it, with three projects
(storefront with a bare `file://` repository holding marker A, sandbox with none, platform). Which
project holds `eng.feature` is moved between legs with the project writes, as a person would.

- **a** storefront: its run's branch holds marker A and the run's commit (`a:ran`, `a:marker`,
  `a:commit`); the note is in neither the branch nor `git status` (`a:note-not-in-git`) and is in
  `project-files/storefront/` (`a:note-saved`); nothing from the checkout reached the project's
  files (`a:checkout-not-in-files`).
- **b** sandbox: the first run starts in an empty `workspace/` (`b:first-ran`,
  `b:first-run-empty`); its file is in `project-files/sandbox/` (`b:file-saved`); the second run
  starts with it (`b:second-ran`, `b:second-run-sees-file`); a run in platform starts with nothing
  (`b:other-project-ran`, `b:other-project-sees-nothing`).
- **c** platform names the disallowed remote: the row is cancelled before its harness runs
  (`c:not-run`), with a refusal naming the remote and `remote-not-allowed` (`c:refused-by-name`),
  and the host's clones hold only storefront's (`c:nothing-cloned`).

**Anti-game:** a hollow pass is a run whose files came from somewhere other than the project. So
every leg is read off where the work landed, never off what the lab says it did: git on the bare
remote's clone and the run's branch, the run's own directory, and the organization's storage read
through `lab.stored`. The stub records the directory it was started in and what was in it before it
wrote anything. Rows are filed through the EM worker and run by its drain, as in the other checks.

**Controls:** `GOAL_CONTROL=list` prints them.

| Control | Perturbs | Goes red on |
|---|---|---|
| `fixed-source` | the manager on the lab's one fixed scratch repository, as before | `a:marker` (and every leg that needs a project's source) |
| `no-sync-back` | the host saves nothing back | `b:second-run-sees-file` (and `a:note-saved`, `b:file-saved`) |

**Model:** n/a (model-free by design; the harness is the lab's scripted stub).

**Run:** `pnpm tsx goals/devforce-lab/it-codes-in-the-projects-repository/run.mts`

Needs `git` and a writable temp directory. No network, no model credential.

## What this establishes, and what it does not

It establishes that the lab's coder, built on `localWorkspaceHost` with `projectWorkspace` as its
source, takes its repository or its files from the project holding the board, saves what the run
keeps back to that project, and refuses a remote the host does not allow before anything runs. It
does **not** establish that a real coding agent uses `project/` well, nor that a remote over the
network clones: every remote here is a `file://` bare repository.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-04 | 8edde510c+wip (#2744 head merged with #2738 head) | n/a | PASS | All three legs green, about 4 s. `fixed-source` FAILs on `a:marker` "does not hold MARKER-A.txt with marker A: it was not cut from storefront's repository", and on the legs that need a project's source. `no-sync-back` FAILs on exactly `a:note-saved`, `b:file-saved` and `b:second-run-sees-file` "the second run started with [], not the first run's app/index.html". Same tree: `it-keeps…`, `it-waits…` and `it-wakes…` PASS. |
| 2026-10-04 | dfc3b2a4f+wip | n/a | PASS | Held-out run with a second fixture: nested paths and an ssh `git@` remote as the disallowed one. PASS once `c:refused-by-name` matched the remote's host and path, since the host leaves the login out of what it shows. The fixture was restored after. |
