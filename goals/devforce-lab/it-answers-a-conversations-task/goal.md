# devforce-lab › it answers a conversation's task

**Issue:** FIX-1866

**Outcome:** In the DevTeam lab, a person asks a coordinator to have the coder look at a project's
code, and gets the coder's answer in the same conversation, about the right repository. The
coordinator files a task for `eng.coder`; the coder works it in a checkout of its own of the
project the conversation works in, or the one the task names, and its answer lands as one line
under its name. A task it can't do is heard failing, with the reason, and never hangs. Jev reads
the answer against the task's goal before the task closes.

Before this, the coder took rows from the feature board only, so a conversation's task for it was
refused when filed.

**Input:** `fixtures/input.json`: the marker file's name, a second project with its own repository
and a workstream in it, a project the person isn't a member of, the ask a person types, and the
two answers a run gives without doing the work. It is **held-out**: the stub reads the marker file by the name in the fixture, and
every project, workstream and word is read from it, so another file name, another second project
or another ask passes a correct implementation. Each marker is a random string committed to a
project's repository, or left in a project's files by an earlier run, after the lab opens.

**Signal:** five legs on the DevTeam lab opened as its profile opens it, driven over its HTTP door
as the lab's owner. Each clock starts at the filing.

- **a** a Shift Coordinator (chief of staff) conversation; the scripted coordinator files a task
  naming storefront. The turn returns within 10 s (`a:turn-returns`); exactly one line under the
  row's assignee, `eng.coder`, names the task (`a:one-line-under-eng.coder`), and it is a
  completed line carrying storefront's marker (`a:carrying-the-marker`). The run record's working
  folder is a checkout of its own cut from storefront's repository (`a:own-checkout`), and the
  repository's branches are unchanged (`a:branches-unchanged`).
- **b** a workstream's conversation in the second project files a task that names nothing: the
  same, carrying that project's marker, cut from its repository (`b:in-its-project`). Then in
  Sandbox (no repository): a first task leaves a marker in the project's files
  (`b:sandbox-note-kept`), and a second one's line carries it (`b-sandbox:…`).
- **c** a task naming no project, one naming a project the person isn't a member of, a run that
  throws a random string twice, and a run that answers "I could not find the repository" while
  the scripted judge says not done twice: each `errored` after 1, 1, 2 and 2 attempts
  (`c:<case>:errored`), with one failed line carrying `input.project`, `not a member`, the string,
  and the judge's reason (`c:<case>:one-line-saying-why`), the harness run 0, 0, 2 and 2 times
  (`c:<case>:runs`), and every row still `errored` 5 s later (`c:stays-errored`).
- **d** a real model as every turn and Jev as the judge, on the standard projects (storefront is
  the only one with a repository): the ask files a task for `eng.coder` naming storefront
  (`d:names-storefront`), and its one completed line carries the marker, judged done by Jev.
- **d2** the same ask with a run that answers "Storefront is a project.": the task ends `errored`
  with one failed line (`d2:ends-errored`) carrying Jev's reason (`d2:jevs-reason`).

**Anti-game:** a hollow pass is an answer that could be written without the project's code, or a
line read off the row instead of the conversation. So the marker is planted after the lab opens
and appears in no task, prompt, brief or coordinator context; only a run that worked in the
project's checkout or files can say it. Every line is read from the conversation's own requests
over the HTTP door, the worker read off the row's assignee. The check writes no drain, row, notice
or session beyond what a person's app does (opening a conversation, sending a turn, opening a
workstream through the projects flow). A crash or timeout is not a FAIL for a control.

**Controls:** `GOAL_CONTROL=list` prints them.

| Control | Perturbs | Goes red on |
|---|---|---|
| `feature-door-only` | the coder's `work` entry as before: the feature board only | `a:one-line-under-eng.coder` (and every leg: no task is ever filed for the coder) |
| `no-filing-project` | the stores drop the workstream and project a hand-over writes onto a task session | `b:carrying-the-marker` and `b-sandbox:carrying-the-marker` (legs a, c, d, d2 stay green) |
| `no-judge` | the coder runs with no judge | `d2:ends-errored` (and `c:judged-not-done:…`) |

**Model:** legs a to c script the coordinator and the judge through the lab's model resolver.
Legs d and d2: `openai/gpt-5.4-mini` for every turn and `typesafe-ai/jev` as the judge, through
the AI Gateway; they report `d:blocked` when no key serves both. The coder's harness is the lab's
scripted stub in every leg.

**Run:** `pnpm tsx goals/devforce-lab/it-answers-a-conversations-task/run.mts`
(`GOAL_LEGS=a,b,c` for the scripted legs alone). Needs `git` and a writable temp directory, and
`AI_GATEWAY_API_KEY` for legs d and d2.

## What this establishes, and what it does not

It establishes that a task a coordinator files for the DevTeam coder runs as a supervised coding
run in the right project, that its answer reaches the conversation as one line, that a task that
can't run or fails is heard failing and settles, and that real Jev tells a marker-reading answer
from one off the point. It does **not** establish that a real coding agent answers well: the
harness is a stub.

Two departures from the spec's wording, both forced by the lab as it is:

- **Leg b runs from a workstream's conversation.** In DevTeam a project's own conversation (the
  project coordinator) hands work to the workstreams the person owns, and it is a workstream's
  lead that files the coder's task. So the conversation that names nothing is the workstream's,
  and the project comes from its workstream.
- **Leg d files on the person's first words.** The chief of staff reads the person's projects
  with `listProjects` and names storefront, the one with a repository, without asking; that it
  does is FIX-1869's goal (`goals/devforce-lab/it-names-the-project-a-coders-task-works-in/`). A
  real model's filing is retried up to `GOAL_ATTEMPTS` conversations (3 by default), under a
  control too, since every control perturbs what happens after the filing; what happens to a
  task once filed is graded on the first one, never retried.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-10 | `6c65b15f1`+wip (fix/FIX-1866-p3) | scripted (a–c); `openai/gpt-5.4-mini` + `typesafe-ai/jev` (d, d2) | PASS | Controls first: `feature-door-only` FAILs `a:one-line-under-eng.coder` (no task is filed for the coder: every leg red); `no-filing-project` FAILs exactly `b:carrying-the-marker` and `b-sandbox:carrying-the-marker` ("failed for good … refused this run (no-project)"), `b:sandbox-note-kept`; `no-judge` FAILs `d2:ends-errored` ("ended completed after 1 attempt") and `c:judged-not-done:…`. Then PASS, about 40 s: d filed on the first turn, Jev `done` at 0.89; d2 Jev `not-done` at 1.0 twice. On earlier runs the coordinator asked which project and filed on the person's answer. Found on the way: with three overlapping not-done outcomes Jev's confidence split (0.66 on "Storefront is a project.", under the 0.7 floor), so the judge now asks its verdict apart from the reason; and a filing with `waitForResponse` hears the ending in the turn, not as a line, so the chief of staff's file now says never to wait on a coder's task. |
| 2026-10-11 | branch `claude/fix-1869-list-projects-6y4pfh` | `openai/gpt-5.4-mini` + `typesafe-ai/jev` (d, d2) | PASS | Legs d and d2 only, after FIX-1869 gave the chief of staff `listProjects` and the person's answer was dropped: d filed for storefront on the first turn, Jev `done` at 0.64; d2 Jev `not-done` at 0.98 twice. |
