# devforce-lab › it names the project a coder's task works in

**Issue:** FIX-1869

**Outcome:** In the DevTeam lab, a person tells the Shift Coordinator (Shift Coordinator) "the coder
should take a look at our repo" without naming a project. When exactly one of the projects they are
a member of has a repository, the coordinator files the coder's task for that project on the spot.
When two or more do, it files nothing and asks which one, naming them. A project in the
organization they aren't a member of is never offered.

Before this, the coordinator had no way to see the person's projects, so it asked "which
project?" or guessed one.

**Input:** `fixtures/input.json`: the ask a person types, a second project of theirs with a
repository, and a stranger's project with a repository. It is **held-out**: every project id and
title, and the ask, is read from the fixture, so another second project, another stranger's
project or another wording passes a correct implementation.

**Signal:** two legs on the DevTeam lab opened as its profile opens it, driven over its HTTP door
as the lab's owner, a real model playing the Shift Coordinator. The person is a member of storefront
(a repository), platform and sandbox; the stranger's project, with a repository, is created by
another user of the organization.

- **one** the ask, as one turn in a new conversation: the turn's `listProjects` tool output names
  storefront and never the stranger's project (`one:read-the-projects`), and the task the
  conversation filed for `eng.coder`, as the board stores it, names storefront
  (`one:files-naming-storefront`).
- **two** the person's second project with a repository is added: the turn files nothing
  (`two:files-nothing`), its reply names both projects (`two:asks-naming-both`), and neither the
  reply nor the read names the stranger's (`two:no-strangers-project`).

**Anti-game:** a hollow pass is a coordinator that files for storefront because its prompt or a
default names storefront, or that asks a generic "which project?". So the read is graded on the
tool's own output item, the filing on the stored row's `input.project`, and leg two on a reply that
names the second project, which appears only in the person's project list. The stranger's project
has a repository, so a list that leaked it would make leg one ambiguous.

**Controls:** `GOAL_CONTROL=list` prints them.

| Control | Perturbs | Goes red on |
|---|---|---|
| `no-project-list` | the Shift Coordinator without `listProjects`, in its catalog and its `tools:` | `one:read-the-projects`, always. Usually also `one:files-naming-storefront` and `two:asks-naming-both`, but the model can guess storefront without the list, so those two are not required |

**Model:** `openai/gpt-5.4-mini` for every turn, through the AI Gateway. Each leg is one turn,
graded once: nothing is retried. Reports `blocked` when no key serves it. The coder's harness is the lab's stub, and what a filed task does
next is not graded (the coder runs with no judge).

**Run:** `pnpm tsx goals/devforce-lab/it-names-the-project-a-coders-task-works-in/run.mts`
(`GOAL_LEGS=one` for one leg). Needs `git`, a writable temp directory and `AI_GATEWAY_API_KEY`.

## What this establishes, and what it does not

It establishes that the Shift Coordinator reads the person's projects as data and picks the one a
coder's task works in from them, and that the read leaves out projects the person isn't a member
of. It does **not** establish what happens to the task after the filing; that is
`goals/devforce-lab/it-answers-a-conversations-task/`.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-11 | branch `claude/fix-1869-list-projects-6y4pfh` (on FIX-1866 P3) | `openai/gpt-5.4-mini` | PASS | Control first: `no-project-list` FAILs `one:read-the-projects` ("never called listProjects") and `one:files-naming-storefront` in 3 of 3 conversations; on one it filed for a project id it made up (`repo`). Then PASS 6 of 6 runs: leg one filed for storefront on the first conversation 5 times, the second once; leg two asked naming Billing and Storefront, though in about one conversation of three the model picked Billing and filed, so it was retried. |
| 2026-10-11 | branch `claude/fix-1869-list-projects-6y4pfh` (on FIX-1866 P3) | `openai/gpt-5.4-mini` | PASS | The retries above are gone: each leg is one turn, graded once. With the rule only in prose, single-shot runs passed 1 of 6, then 3 of 6 (the model offered instead of filing, or picked Billing of two), so the chief of staff's `listProjects` now adds `forCoding`, what to do next worked out from the projects with a repository. Then PASS 6 of 6 single-shot runs. Control `no-project-list` FAILs `one:read-the-projects`, `one:files-naming-storefront` and `two:asks-naming-both`. |
| 2026-10-11 | `7af86476` (DevTeam off mailboxes, merged with FIX-1866 P3 `f4978593`) | `openai/gpt-5.4-mini` | PASS; `no-project-list` FAIL (expected) | On the DevTeam with no mailboxes (the goal's `mailboxes:` option and `eng.feature` workstream dropped in the merge). The EM-free chief-of-staff path is unchanged: one turn read the three projects and filed for eng.coder naming storefront. `no-project-list` fails at `one:read-the-projects`, `one:files-naming-storefront` and `two:asks-naming-both`. |
