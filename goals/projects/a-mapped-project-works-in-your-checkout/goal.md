# projects › it a mapped project works in your checkout

**Issue:** FIX-1906 (epic FIX-1903), its goal: `specs/issues/FIX-1906/SPEC.md` → "The goal, and how we'll know it's met"; PLAN VG.

**Outcome:** a coding run for a shared project the host config names works in a fresh worktree of the operator's own checkout, installs and builds there, and leaves its branch in that checkout. A project with the same id and remote that the config doesn't name for the run's organization (another organization's, or a private one) never gets a worktree of it. A settled run continues in the same worktree, on the same branch, with its kept files.

**Input:** this repository's checkout, at the commit under test (`GOAL_CHECKOUT` names another; held out: nothing in the check names this repository's packages except the build target, `GOAL_BUILD`, default `pnpm --filter @flow-state-dev/workspace... build`). The projects' remote is a label the host never reaches (`GOAL_REMOTE`), since it allows no remote: an unmapped run is refused, never cloned. The note and the uncommitted file carry the run's stamp.

**Signal:** in process, on the real engine: a harness manager whose workspace is `localWorkspaceHost` over the checkout (in `localRepositories`, `remotes.allow: []`) with `projectWorkspace({ checkouts })` as its source, mapping shared project `mapped` of organization `goal-org-a` to the checkout. The owner makes three projects through the project blocks: shared `mapped` in `goal-org-a`, private `mapped` in `goal-org-a`, shared `mapped` in `goal-org-b`, all on the same remote. Each row's task session is filed from its project (`filingProjectId`, as a project conversation's hand-over files it). The harness is scripted.

- **a**. A row on the mapped project. Its first attempt runs `pnpm install --frozen-lockfile --offline` and the build in its working directory, keeps a note in `project/`, leaves an uncommitted file, and asks a question, so the task is held on it. `a:in-checkout`: the run's working directory is listed by `git worktree list` in the checkout. `a:installs`, `a:builds`: both exit 0 there. `a:branch-in-checkout`: the run's branch is in the checkout's `git branch`. `a:note-saved`: the note's hash is in the organization's stored `project-files/mapped/`, and the note is not in the worktree's `git status`.
- **b**. A row on the shared project in `goal-org-b`, then one on the private project in `goal-org-a`. `b:other-org-not-in-checkout`, `b:private-not-in-checkout`: `git worktree list` in the checkout gains no entry, and the run (if its harness ran at all) didn't work in one.
- **c**. Leg a's question is answered and its row drained again. `c:continues`: the second turn ran in the same directory, on the same branch, found the first turn's uncommitted file and the note in `project/`, and the row completed.

**Anti-game:** no assertion reads the source's answer, `place.repo` or what the host returned: the checkout is read with git, the run's directory with the file system, the note from the store. No scratch repository: the checkout is this repository. The check removes the worktrees under its own places root and the run branches it saw, on exit, pass or fail, so a pass never depends on a leftover; it never fetches, switches, resets or cleans the checkout's own tree.

**Model:** n/a (model-free: the harness is scripted, the install and build are real).

**Run:** `pnpm tsx goals/projects/a-mapped-project-works-in-your-checkout/run.mts`. Needs `git`, `pnpm`, and a pnpm store this checkout was installed from (the install is offline). About 35 s.

**Controls:**

- `GOAL_CONTROL=no-mapping`: `projectWorkspace()` with no `checkouts`. Must FAIL **`a:in-checkout`**. Also fails every other leg-a assertion and `c:continues`, which need leg a's run.
- `GOAL_CONTROL=ignore-org`: a module patch on `packages/workforce/src/projects/project-workspace.ts` drops the organization from the match (the run re-executes itself with the patch loaded and fails if it never reached the module). Must FAIL **`b:other-org-not-in-checkout`**, and nothing else.
- `GOAL_CONTROL=detach`: `git switch --detach` in leg a's worktree after the task is held (DECISIONS D3's loser). Must FAIL **`c:continues`**, and nothing else.

**What each assertion was shown failing on** (BP-003; ad-hoc mutations, restored): `a:builds` alone with `GOAL_BUILD="pnpm --filter @flow-state-dev/workspace exec false"`; `a:installs` (with `a:builds`, which never ran) with `npm_config_store_dir` an empty store; `b:private-not-in-checkout` alone with the visibility check removed from `checkoutFor`; `a:note-saved` alone with the local place's `filesDir` dropped in `local-host.ts`. `a:branch-in-checkout` has no isolating red state: a branch not in the checkout means a worktree not of the checkout, which `a:in-checkout` fails first.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-12 | 9460c273+goal | n/a | PASS | Legs a, b, c on this checkout. a: the run worked in `<places>/…/goal-a-…--implement/checkout`, listed by `git worktree list` in the checkout, on its `conductor/…` branch; offline install and `@flow-state-dev/workspace...` build exited 0; note saved, not in `git status`. b: both rows refused `remote-not-allowed` before their harness ran; no worktree added. c: the second turn ran in the same worktree and branch with the uncommitted file and the note; row completed. Worktrees and branches removed on exit |
| 2026-10-12 | 9460c273+goal | n/a | FAIL (expected) | `GOAL_CONTROL=no-mapping`: failed on `a:in-checkout` ("the row ended cancelled before its harness ran: … remote-not-allowed"), and on the other leg-a assertions and `c:continues`, which need its run. b PASS |
| 2026-10-12 | 9460c273+goal | n/a | FAIL (expected) | `GOAL_CONTROL=ignore-org`: failed on `b:other-org-not-in-checkout` and nothing else: `goal-org-b`'s run got `<places>/…/goal-other-…--implement/checkout`, a worktree of the checkout. The patch reached `project-workspace.ts` |
| 2026-10-12 | 9460c273+goal | n/a | FAIL (expected) | `GOAL_CONTROL=detach`: failed on `c:continues` and nothing else: the second turn never ran, the provision refusing "the checkout … is on branch "null", not the expected …"; the row went back to pending |
| 2026-10-12 | 24bd349b (main, goal copied in) | n/a | FAIL (expected) | Today's `main`: `a:in-checkout` "the row ended cancelled before its harness ran: … remote-not-allowed", with the other leg-a assertions and `c:continues`. Run from a scratch worktree of `main` after an offline install, mapping that worktree |
