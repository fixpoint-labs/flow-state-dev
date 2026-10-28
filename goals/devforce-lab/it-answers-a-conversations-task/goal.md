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

- **a** a Shift Coordinator (Shift Coordinator) conversation; the scripted coordinator files a task
  naming storefront. The turn returns within 10 s outside the model's calls (`a:turn-returns`; none
  here, the scripted model answers at once), and a turn that blocks on the coder's run or hangs in
  the hand-over still fails it; exactly one line under the
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
  (`d:names-storefront`), and its one completed line carries the marker, judged done by Jev. The
  turn's checks are leg a's (`d:turn-returns`); the real model's calls are left out because their
  latency is the provider's, and varies from run to run.
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
| `no-filing-project` | the stores drop the workstream and project a hand-over writes onto a task session | `b:carrying-the-marker` and `b-sandbox:carrying-the-marker` (legs a, c, d, d2 stay green) |
| `no-judge` | the coder runs with no judge | `d2:ends-errored` (and `c:judged-not-done:…`) |

`feature-door-only` (the coder's `work` entry reading the feature board only) is gone with that
board: the DevTeam's feature work is a workstream the EM leads, and the coder has the one entry.
`a:one-line-under-eng.coder`'s red state is now a mutation: drop the coder flow's `work` entry
and no task is filed for it.

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
- **Leg d files on the person's first words.** The Shift Coordinator reads the person's projects
  with `listProjects` and names storefront, the one with a repository, without asking; that it
  does is FIX-1869's goal (`goals/devforce-lab/it-names-the-project-a-coders-task-works-in/`).
  Each real-model leg runs one conversation and is never retried.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-10-10 | `6c65b15f1`+wip (fix/FIX-1866-p3) | scripted (a–c); `openai/gpt-5.4-mini` + `typesafe-ai/jev` (d, d2) | PASS | Controls first: `feature-door-only` FAILs `a:one-line-under-eng.coder` (no task is filed for the coder: every leg red); `no-filing-project` FAILs exactly `b:carrying-the-marker` and `b-sandbox:carrying-the-marker` ("failed for good … refused this run (no-project)"), `b:sandbox-note-kept`; `no-judge` FAILs `d2:ends-errored` ("ended completed after 1 attempt") and `c:judged-not-done:…`. Then PASS, about 40 s: d filed on the first turn, Jev `done` at 0.89; d2 Jev `not-done` at 1.0 twice. On earlier runs the coordinator asked which project and filed on the person's answer. Found on the way: with three overlapping not-done outcomes Jev's confidence split (0.66 on "Storefront is a project.", under the 0.7 floor), so the judge now asks its verdict apart from the reason; and a filing with `waitForResponse` hears the ending in the turn, not as a line, so the chief of staff's file now says never to wait on a coder's task. |
| 2026-10-11 | branch `claude/fix-1866-p3-lb0hhy`, filing retry removed | `openai/gpt-5.4-mini` + `typesafe-ai/jev` (d, d2) | d2 6/6, d 5/6 | Six single runs of legs d and d2, no retry. d2 passed all six (Jev `not-done`, 0.98 to 1.0). d failed once: the chief of staff guessed a project id (`our-repo`) instead of asking, because it can't list projects. The same six runs on top of FIX-1869 (`listProjects`) passed 6/6 for both legs, filing on the first turn. `no-judge` still FAILs `d2:ends-errored` with no retry, on both. |
| 2026-10-11 | `cfafdf52`+wip (DevTeam off mailboxes) | scripted (a–c); `openai/gpt-5.4-mini` + `typesafe-ai/jev` (d, d2) | PASS | On the DevTeam with `feature` a workstream and no mailbox: a, b, c PASS; d filed on the person's answer, Jev `done` at 0.89; d2 Jev `not-done` at 1.0 twice. `no-filing-project` FAILs `b:carrying-the-marker`, `b:sandbox-note-kept`, `b-sandbox:carrying-the-marker` ("refused this run (no-project)"); `no-judge` FAILs `d2:ends-errored` and `c:judged-not-done:…`. `feature-door-only` retired with the feature board; its assertion's red state by mutation (the coder flow's `work` entry commented out, `GOAL_LEGS=a`): FAILs `a:one-line-under-eng.coder` ("the task is undefined"), file restored. |
| 2026-10-11 | `7af86476` (DevTeam off mailboxes, merged with FIX-1866 P3 `f4978593`) | scripted (a–c); `openai/gpt-5.4-mini` + `typesafe-ai/jev` (d, d2) | PASS; `no-filing-project` and `no-judge` FAIL (expected) | Re-run on the merged tree. `no-filing-project` fails at `b:carrying-the-marker`, `b:sandbox-note-kept` and `b-sandbox:carrying-the-marker` (the run refused, no-project). `no-judge` fails at `c:judged-not-done:*`, `c:stays-errored` and `d2:ends-errored`. |
| 2026-10-11 | FIX-1792 P4 on 617aeabb + uncommitted | scripted (a–c); `openai/gpt-5.4-mini` + `typesafe-ai/jev` (d, d2) | PASS | Converted with no change: nothing the goal reads moved in P4. a: one completed line under eng.coder carrying storefront's marker, in the checkout derived for its task. b: billing's line cut from its remote, sandbox's carrying the marker a run left in its files. c: no project, a stranger's project, a run throwing twice and a judged miss each end in one errored line saying why. d: "the coder should take a look at our repo" filed a task for eng.coder naming storefront on the first turn, judged done by Jev (0.97). d2: "Storefront is a project." ended errored, Jev not-done four times. No control re-run: no leg changed. |
| 2026-10-11 | FIX-1883 (FIX-1793 P5) on 9a618969 + uncommitted | as the row above | PASS | The workstream's lead is a hired `workstream-lead` (agent, delegates [eng.coder]) named over HTTP, replacing the fork of the removed workstream coordinator |
| 2026-10-12 | fa95ebf3 + uncommitted (FIX-1910) | scripted (a–c); d and d2 not run | PASS (a–c); `no-filing-project` and `no-judge` FAIL (expected) | Since best fit asks again as a language model (`coordinator-route-ask`), the scripted resolver handed that call the queued `addTask`, so the judgment turn filed nothing: on fa95ebf3 unchanged, a and c red ("the task is undefined", lines only "Filed it." under coordinator-judgment). The resolver now throws for `coordinator-route-ask`, as `devteam-repository-ask.test.ts` does, and a–c PASS. `no-filing-project` FAILs `b:carrying-the-marker`, `b:sandbox-note-kept`, `b-sandbox:carrying-the-marker` (refused, no-project); `no-judge` FAILs `c:judged-not-done:*` and `c:stays-errored`. |
| 2026-10-13 | `07c6ca14` + uncommitted (FIX-1935) | scripted (a–c); `openai/gpt-5.4-mini` + `typesafe-ai/jev` (d, d2) | PASS; `no-filing-project` FAILs (expected), d stays green | `turn-returns` now times the turn outside the model's calls, since run 5's `no-filing-project` reddened `d:turn-returns` at 12175 ms of mostly provider latency. Green: a 104 ms; d 4878 ms, 874 ms outside the model's calls. `no-filing-project` FAILs only `b:carrying-the-marker`, `b:sandbox-note-kept`, `b-sandbox:carrying-the-marker`. Red state by scratch mutation (an 11 s sleep at the top of `dispatchTask`'s execute, `GOAL_LEGS=a,d`): FAILs `a:turn-returns` (11087 ms, all outside) and `d:turn-returns` (14761 ms, 11458 ms outside); file restored. A streamed model call counts only the waits on its next chunk: with the whole stream timed, an 11 s scratch sleep after the first `finish` chunk in the generator's step loop hid inside the model's time (d PASS, 15372 ms, 540 ms outside); timed per pull it FAILs `d:turn-returns` (15005 ms, 11511 ms outside). Re-run on that: green PASS (d 5326 ms, 729 ms outside), `no-filing-project` FAILs the same three b signals only. |
