# @flow-state-dev/shift-manager

## 0.1.0

### Minor Changes

- d1a4cab: Shift Manager says worker where it said seat, in its screens and the DevTeam lab (FIX-1796).
- 6c65b15: The DevTeam's coder takes a conversation's task: ask your Shift Coordinator to have the coder look at a project's repository, and it files a task for `eng.coder` naming the project (`input.project`, `{ visibility, id }`). The coder works it in its own checkout of that project's repository (or on its files when it has none), and its answer lands in the conversation under its name. A task naming no project, or one you aren't a member of, fails at once saying why; a run that fails, or whose answer Jev judges as missing the goal, gets one more attempt and then fails with the reason. A question from the coder lands as a line, and your answer goes back into the same run. Feature work from the EM's board runs as before (FIX-1866).
- 9590119: The Shift Coordinator is a coordinator: the DevTeam's Shift Coordinator runs on the `coordinator` flow, routing by judgment, and hands work to its delegates. Its panel lists the conversation's delegates, adds one from your roster and removes one; a delegate's answer appears under the delegate's name, each routing decision as a quiet note beside the lines, and the Shift Coordinator comes first on Roster (FIX-1791).
- 2b3fd17: The DevTeam profile has no mailboxes (FIX-1792): Storefront opens two workstreams, `feature` and `release`, led by the EM, which files the coder's tasks on the board of the workstream it leads. PROJECTS lists no mailbox under a project, and a person reads the organization's workers through their roster session when the Lab serves no mailbox kind.
- b2f2d4c: A project's Stream is now your own project coordinator, and its Workstreams tab lists every workstream with the project's progress. You open a workstream by asking your project coordinator for the work: it picks the lead from your workers, such as the DevTeam's engineering manager, and hands your ask to it. The Workstreams tab has no form for opening one, and the DevTeam profile has no workstream coordinator worker. The Tasks view groups a workstream's tasks under the workstream, so one worker leading two workstreams shows as two groups (FIX-1793).
- fc2826f: Shift Manager has three themes, Day, Evening and Night, instead of light and dark: the mark in the sidebar changes the theme, `--shift` also takes `evening`, and with no pick the page opens on the theme the clock calls for (FIX-1800).
- 5d4306a: Roster lists the signed-in person's own workers beside the Lab's standard ones, read through Workforce's roster flow, and the Shift Coordinator's conversation is a session of its flow that names the worker. A Lab registers the flows `hireWorkforce(installation)` returns (FIX-1788).

### Patch Changes

- 43649da: `defineProjectBlocks()` adds `listProjects`: the projects the caller is a member of, each with its address, title and repository. A shared project the caller isn't a member of is left out. The DevTeam Shift Coordinator has it as a tool, with a `forCoding` line saying what a coder's task that names no project does next, so asked to have the coder look at "our repo" it files the task for the one project with a repository without asking, and with two or more asks which one, naming them (FIX-1869).
- 9b4e7b1: `defineCoordinatorFlow` now honours `agent.isolateUserState`: the coordinator flow keys its user-scoped storage by its copy when the judgment turn asks, as the `agent` flow does. Before, the option was accepted and ignored (FIX-1776).

  Shift Manager's DevTeam Shift Coordinator carries the standard memory set (working memory, the rolling digest, `memory/recall`), read-side only unless `DEVTEAM_MEMORY_CAPTURE=1`. It says when it has no memory of something rather than inventing one.

- a6fe11a: The Shift Coordinator's TASKS panel lists only active tasks. Done tasks fold into a closed count and errored ones into their own closed group, each opening to its tasks. A workstream's Board still lists every task (FIX-1962).
- d48b16c: A task a conversation files shows in its feed as one card (title, worker, status, Open) instead of the conversation's whole task list, and the card follows the task's real status as it runs, fails, or finishes (FIX-2006).
- fa33814: Shift Manager now lists, adds, edits and deletes a worker's standing rules for the signed-in user, from a Rules view on its Roster row and a RULES section in the Shift Coordinator's panel (FIX-1945).
- 250bc9e: A worker's standing rules now live on its settings page (`/roster/<workerId>/settings`), opened from a Settings button on every Roster row and, for the Shift Coordinator, from a gear in its header. The Shift Coordinator's right panel no longer lists RULES. `/roster/<workerId>/rules` still opens the same page (FIX-2007).
- e71ea1a: The DevTeam and `fsd` Labs now ship a default model, so a worker that names no `model:` answers instead of failing every turn, and an `intent/<name>` with no model to fall back to fails with a setup error that names where to set one (FIX-2008).
- e71ea1a: A message sent from a task's composer, and the worker's reply to it, now show in that task's Session tab, including when the worker keeps one session for several tasks (FIX-2009).
- fc93035: A project's Workstreams and Board tabs read the project again every few seconds while they're on screen, so a workstream the Shift Coordinator or a project coordinator opens shows up without a reload (FIX-1922).
- 6a3ecf5: `@flow-state-dev/client` exports `readEveryCollectionPage`, one collection read with a single 1,000-page ceiling that fails when the server repeats a cursor, and the workforce panels, the DevTool Inventory tab, the Shift Manager and the workforce roster read now use it, so a repeated cursor ends a read with an error instead of 1,000 wasted page reads, a partial list shown as whole, or a read that never stops (FIX-1674).
- dd2563b: Task tools gain `readTask`, which returns one task whole: its goal, input, status, and what it came back with (its result, its error, or the question it is parked on). `listTasks` still lists without results. `taskToolActions` exposes it as `readTask_<board>`. A conversation board now shows a browser the question a task parked on a question waits on (`feedback`, with `parkedOnQuestion`). Shift Manager's shift summary lists tasks parked on a question for the user under Needs you, and its DevTeam chief of staff answers from what a finished task found (FIX-1972).
- c4150e7: A person's message on a finished task reopens it: task collections gain `reopen(id)`, the harness manager's door reopens a finished run when its board names `reopenIn`, a worker's reply in a finished task's session on a Workforce conversation board reopens that task, and Shift Manager's task composer takes a message on a finished task (FIX-1764).
- fa7b22e: A tool call that waited on an approval no longer reads as failed. A later turn's history replays it once, with its result; before, it also replayed the wait as a failed call carrying the approval's question, so the model read it as a failure it had retried. `isSuspensionWait(item)` (from `@flow-state-dev/contracts/items`, re-exported by `@flow-state-dev/core/items`) tells such a wait from a real failure, and the registry's tool card draws it as awaiting approval. Shift Manager draws a waiting call as waiting, and a conversation redraws once its ask is answered on the page, again when the run it resumed stops (FIX-1901).
- 07bf0e1: Shift Manager names the `chief-of-staff` worker the Shift Coordinator wherever it shows a worker: Roster, the on-call list, Jump to, Inbox, ask lines, Tasks and the task view, delegates and routing notes. The old docs address `/docs/workforce/chief-of-staff` redirects to the new page. The DevTeam's coordinator introduces itself as the Shift Coordinator. The worker's id is still `chief-of-staff` (FIX-1960).
- e112ab3: Shift Manager now shows tasks filed on a person's conversation boards beside workstream boards, in Roster, Tasks, the task screen and its run session (FIX-1792).
- 70c8651: A conversation that holds only state or resource changes, such as the Shift Coordinator's once its standing rules are read, now says nobody has talked with the worker yet instead of drawing an empty list, and the project caret under PROJECTS is drawn at design v2's 11px in a 12px box (FIX-2000).
- f146db2: Shift Manager drops On Call. A worker is on shift or off shift: one running a task, or waiting on you with a parked task or a pending ask, is on shift. Roster's last column is WAITING ON YOU, and the on-call counts, the Shift Coordinator's ON CALL list and its "Who's on call?" suggestion are gone. The DevTeam Lab no longer has an `ops.oncall` worker (FIX-1964).
- 195eaf4: Inbox shows the asks the signed-in person's own workers are waiting on them for, and those workers read as on shift on Roster and in TEAMS. The snapshot reader reads the person's roster before it reads asks (FIX-1830).
- 9cc903f: Shift Manager is published: install `@flow-state-dev/shift-manager` and run `shift-manager --config ./fsdev.config.mts` to open a Workforce Lab in the browser on `fsdev dev --app`, with `--dev` to restart the Lab and reload the page on a save, and `--team`, `--devtool` and `--devtool-assets` removed in favor of `--config` (FIX-1770).
- fd21824: The sidebar's TEAMS lists the signed-in person's own workers beside the Lab's standard ones, read from their roster as Roster reads it, and its on-shift counts include them (FIX-1741).
- 8b339b2: Shift Manager's sidebar nests each project's workstreams beneath it again. The project on screen shows them, the arrow beside any project shows or hides them, and a click opens the workstream's own view. A workstream opened elsewhere appears without a reload. Only a shown project's workstreams are read, by that project's one prefix (FIX-1961).
- 91b6b61: A conversation whose session exists but holds nothing yet, such as a project's Stream on its first visit, now shows its empty-state line instead of a blank panel (FIX-1893).
- e3a24a3: A project's Workstreams tab counts each workstream's objectives met on its row, and your own workstream opens with its objectives, each marked met or not, above the conversation with its lead (FIX-1921).
- Updated dependencies [b75c1ed]
- Updated dependencies [9490722]
- Updated dependencies [a3bfbc2]
- Updated dependencies [f469423]
- Updated dependencies [2c213b4]
- Updated dependencies [5492a77]
- Updated dependencies [211679a]
- Updated dependencies [bb1c224]
- Updated dependencies [204860e]
- Updated dependencies [7f892f6]
- Updated dependencies [9cc903f]
- Updated dependencies [83c48a7]
- Updated dependencies [a600325]
- Updated dependencies [e9f9316]
- Updated dependencies [82ec64e]
- Updated dependencies [7da156e]
- Updated dependencies [b808784]
- Updated dependencies [6a3ecf5]
- Updated dependencies [02ee032]
- Updated dependencies [65ddb90]
- Updated dependencies [d1a4cab]
- Updated dependencies [97894aa]
- Updated dependencies [cd180d7]
- Updated dependencies [912ae98]
  - @flow-state-dev/fsdev@0.3.0
  - @flow-state-dev/devtool@0.3.0
