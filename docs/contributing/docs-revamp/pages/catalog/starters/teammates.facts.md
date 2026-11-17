# Facts for Teammates (K-02, catalog, starter template)

Every fact the page may state, with file and line. Sources are limited to what a fact sheet may cite: existing user docs, the exported surface and its doc comments, tests, `goals/`, one example (the lab). No spec, issue, changeset, `docs/internal` or `CLAUDE.md` was read. The kit surfaces named here are built, so no fact is a spec's name marked for reconciling.

Paths are from the repo root. Abbreviations:

- `lab` = `labs/teammates` (the one example this page is about)
- `readme` = `labs/teammates/README.md`
- `host` = `labs/teammates/host.mts`
- `cfg` = `labs/teammates/fsdev.config.mts`
- `pkg` = `labs/teammates/package.json`
- `tree` = `labs/teammates/workforce/teams/teammates`
- `ad` = `labs/teammates/src/adapter.ts`
- `panel` = `labs/teammates/src/components/TeammatePanel.tsx`
- `fl` = `labs/teammates/src/components/WorkersList.tsx`
- `wd` = `apps/docs/docs/workforce/workers-on-disk.md`
- `mw` = `apps/docs/docs/workforce/messaging-workers.md`
- `dw` = `apps/docs/docs/workforce/delegating-work.md`
- `bw` = `apps/docs/docs/workforce/built-in-worker.md`
- `cli` = `apps/docs/docs/api/cli.md`
- `wf` = `packages/workforce/src`
- `hm` = `packages/harness-manager/src`
- `g1` = `goals/teammates-lab/a-worker-talks-to-another-while-you-talk/goal.md`
- `g2` = `goals/teammates-lab/a-standard-teammate-takes-your-edits/goal.md`

Legend: **[page]** the page states it. **[ref]** it belongs on a Reference page; the page links, does not state it. **[verify]** not confirmed against running code; keep off the page or soften. **[cut]** history or mechanism; never on the page.

## Flags against the page plan and the lab's README (read first)

1. **There is nothing to install.** The plan calls this a "starter template". The lab is a private package (`"private": true`, version `0.0.0`) at `lab/` in the repository: `pkg:2-4`. The only installable starter is the UI registry item `workforce-starter`: one team, one worker (`assistant`), no flow, `packages/ui/registry.json:766-785`, graded by `packages/workforce/test/starter-files.test.ts:1-60`. Nothing copies the Teammates tree, host or screen into an app. The page's "install it" step can only be "run it from a checkout of this repository", or the page must say the starter is the folder you copy. Decision for the owner; the sheet states only what exists. [page]
2. **There is no `fsdev.config.ts`.** The plan's example is "its `fsdev.config.ts`". The file is `fsdev.config.mts` (`cfg`), 66 lines, and it holds no kit list: it reads environment variables and calls `openTeammates({...})` from `host.mts`, whose return (the `FlowState`) is the default export: `cfg:42-66`. The kits are in `host.mts:362-413`. An example for the page is `createFlowState({ kits: [...] })` excerpted from `host.mts:362-413`, not `cfg`. [page]
3. **The roster's lead is "Chief of Staff", the README and tests say "Lead".** The file is `workers/chief-of-staff/WORKER.md`, `name: Chief of Staff`, id `teammates.chief-of-staff`: `tree/workers/chief-of-staff/WORKER.md:2`, `g2:5`, `lab/test/address.test.tsx:95`. The README (`readme:12`, many lines), the host comments (`host:8`), the test double (`lab/test/fake-lab.ts:126`, `name: "Lead"`) and `g1` all say "Lead". The goal `g2` renames "Chief of Staff" and checks "Lead" as the file's name (`goals/teammates-lab/a-standard-teammate-takes-your-edits/run.mts:67`, `FILE_NAME = "Lead"`). The files on disk are the truth for what a reader gets: **Chief of Staff**. The page must not call it Lead. The README and goal are stale on the name; flagged for the owner. [page]
4. **The README says the file's three teammates can't be edited or fired; the code lets you edit any teammate.** `readme:176-178` ("*Edit instructions* ... The three teammates from the files can't be edited or fired") and `readme:289-292` ("Not wired yet: Editing a worker from the files ... read-only"). The code: every teammate's panel has an **Edit** button; an **edited** file teammate also gets **Reset to default**; **Fire** is shown only for a teammate the user hired: `panel:190-200` (Edit always; Reset when `worker.edited`), `labs/teammates/src/components/Conversation.tsx:166` (`worker.own ? ... Fire`), `ad:1163` (`own: true` only when the row is not `standard`). The adapter says so: "`editTeammate` ... on any teammate"; "the first edit of a file's teammate makes the user's own copy of it, under the same id": `ad:30`, `ad:526-533`. The goal `g2:3-11` checks it end to end. The page follows the code: the button reads **Edit**, not *Edit instructions*. [page]
5. **The README's "Routines section ... empty for now" matches the code.** `panel:276-281` renders "Routines" with "None yet." and nothing else, although the workers hold routine tools and the lab runs the schedule (see section 8). So the panel's list is not wired to the routines the workers save. [page, as a not-wired item]
6. **README "Not wired yet" item 2, "Saving writer's drafts"**: writer's `tools:` line (`tree/workers/writer/WORKER.md:6`) has no tool that writes a file; the README says "No package tool writes files from a worker's turn yet". Consistent with the file. [page]
7. **The README's "Hire a teammate" wording**: the form asks for a name, one line on what it does, and instructions: `lab/src/components/TeammateForms.tsx:35-52`. The name is lowercased and becomes the id (`onHire({ name: name.trim().toLowerCase(), ... })`, `TeammateForms.tsx:38`; `ad:1522-1523`, `workforce.hire({ id: name, description: role, instructions })`). A hired teammate runs on the built-in `agent` flow: `ad:523`. [page]
8. **README mentions an `ErrorBody`, `request-recovery`, `task-actions` etc.** These are the screen's UI-registry pieces (`readme:261-277`). Not for this page; link to the UI pages if at all. [cut]
9. **README and goal carry tracker ids and a spec link** (`readme:79`, `g1:3`). Never on the page. [cut]

## 1. What it is (opening)

- It is an app of three kinds of worker you talk to one at a time, with one conversation each. The tree's `TEAM.md` description: "Lead, researcher and writer, each with one long conversation, who message each other when they need a hand and start coding tasks that run in the background." `tree/TEAM.md:3` (says Lead; read as Chief of Staff per flag 3). [page, in the page's own words]
- The screen has three panels: the worker list on the left, the chosen worker's conversation in the centre, the open worker's panel on the right. `readme:12-60`. [page; see figure]
- Each row of the list is a worker with a continuing role, never a list of sessions. A row shows the worker's icon on its colour, a line saying what it is doing now (*Replying to you*, *Messaging writer*, *Running coding task: ...*, *Idle*) and the count of new entries since you last looked. `readme:12-17`. [page]
- A worker that needs you says so first in the attention colour with a badge, and keeps its place in the list: *Needs your OK: ...* while it waits for a yes, *Waiting on you: ...* while one of its tasks does. `readme:17-20`. [page, one sentence]
- The lab is "one half of the evidence that the same package pieces make familiar apps: an app adds only configuration, React UI and a few small flows". `readme:3-6`. [cut as the lab's own framing; the page may say the app is configuration, a screen and a few flows (`host:362-413`, `cfg:50-66`)]
- It copies the layout of an existing chat app (Grok Bot) and has its own dark theme in `src/lib/theme.css`: `readme:3-10`. [cut: names a product; the page says "a dark, chat-first screen"]
- It runs on `fsdev dev --app`, which serves an app's own pages at the root of the port and moves the DevTool to a port of its own: `cli:115`, `cli:149-155`; `pkg:78` (`dev` script); `lab/cli/index.ts:1-8`, `:15-24` (`getAssetPath()`). [page, one clause]

## 2. What each worker has that the others do not (question 1)

The five worker files, as read from `tree/workers/*/WORKER.md`:

| Worker (id) | `name` | Flow | Tools / capabilities | Delegates | Icon, colour | Source |
| --- | --- | --- | --- | --- | --- | --- |
| `teammates.chief-of-staff` | Chief of Staff | `agent` (no `flow:`) | no `tools:` line; `capabilities: consultSessions: [consult]`, `routines: [tools]` | `delegates: all` | `★`, amber | `tree/workers/chief-of-staff/WORKER.md:1-10` |
| `teammates.researcher` | researcher | `agent` | `tools: [globProjectSource, readProjectSource, grepProjectSource, search, fetch, listRoutines, saveRoutine, pauseRoutine, deleteRoutine]` | none | `🔎`, teal | `tree/workers/researcher/WORKER.md:1-7` |
| `teammates.writer` | writer | `agent` | `tools: [globProjectSource, readProjectSource, grepProjectSource, fetch, listRoutines, saveRoutine, pauseRoutine, deleteRoutine]` (no `search`) | none | `✎`, violet | `tree/workers/writer/WORKER.md:1-7` |
| `teammates.claude-code` | Claude Code | `coder` | none | none | none | `tree/workers/claude-code/WORKER.md:1-6` (`harness: claude-code`) |
| `teammates.codex` | Codex | `coder` | none | none | none | `tree/workers/codex/WORKER.md:1-6` (`harness: codex`) |
| `teammates.cursor` | Cursor | `coder` | none | none | none | `tree/workers/cursor/WORKER.md:1-6` (`harness: cursor`) |

- That is six worker files, three you talk to and three coding workers. The README says "the teammates, Lead, researcher and writer" and calls the three coding workers off the list: they are never messaged. `readme:12`, `readme:105-108` ("Each agent is a worker of its own, off the list and never messaged"). A message to a worker that hears only in task sessions is refused with `task_sessions_only`: `mw:28`, `mw:353`. [page]
- The coding workers are "off the list": `readme:107`, `readme:273` ("assigned to the worker on the coding flow, which the list leaves out"); the adapter marks them `takesTasks` when `flow === CODER_FLOW`: `ad:1162`. [page, one clause]
- id is team and folder joined with a dot: `teams/teammates/workers/chief-of-staff/` is `teammates.chief-of-staff`. `wd:148-152`; `tree` path; the id appears at `lab/test/contract/contract.test.ts:33`, `:34` (`teammates.cursor`). [page]
- `description` is the only key a file requires; `name:` is a display name apps show in place of the id. `wd:76`. [page, in passing]
- Chief of Staff's job, from its file: it runs the team's work with the user in one conversation; hands a quick fact to researcher and copy to writer by message, real work as a task; a code change is a coding task, not a teammate. `tree/workers/chief-of-staff/WORKER.md:12-17`, `:27-29`, `:33-44`. [page]
- Chief of Staff messages with `sendMessage` and `replyRequested: true` and never passes `wait`; the reply arrives as its own message after its current answer. `tree/workers/chief-of-staff/WORKER.md:23-25`, `:33-36`. [page]
- A coding task: `createTask` with a title and a goal; assignees `teammates.claude-code`, `teammates.codex`, `teammates.cursor`; name one and that one runs, name none and Cursor does, with no question first. `tree/workers/chief-of-staff/WORKER.md:38-44`; `readme:105-107`. [page]
- Chief of Staff files one task per ask; a refusal `already_open` means the task is already on it; naming another agent for a failed or open task is a switch (cancel the old one if still open, start a new one), not a retry. `tree/workers/chief-of-staff/WORKER.md:46-50`. [ref]
- A failed task takes no edits or messages; Chief of Staff corrects it with `createTask({ followUpOf })`, which runs in that task's session. `tree/workers/chief-of-staff/WORKER.md:60`. [ref]
- researcher reads files and searches the web and says where each fact came from, a file path or a URL; writer drafts from files and fetched pages. `tree/workers/researcher/WORKER.md:9-12`, `tree/workers/writer/WORKER.md:9-11`; `readme:92-94`. [page]
- When another worker messages researcher or writer: if the sender asked for a reply, the worker's answer in its own turn goes back to the sender; if not, it answers with `sendMessage`, `inReplyTo` set to the message's id. When a task is filed for it, it answers there. When the user asks it directly, it answers them. `tree/workers/researcher/WORKER.md:14-17`, `tree/workers/writer/WORKER.md:13-16`; `mw:86`, `mw:100-102`. [page]
- A coding worker's body: "You run coding tasks ... make it in the working folder the task runs in, check it, and say in one line what changed." `tree/workers/cursor/WORKER.md:8-9` (same on all three). Every run on it is told that body before the task: `readme:108-110`. [page]
- A coding worker's `harness:` names the agent it runs on; `flow: coder` is the one flow every coding worker runs on, so another coding worker is one more `WORKER.md`, never another flow. `hm/kit/coder-flow.ts:1-12`; `tree/workers/*/WORKER.md`. [page]
- A coding agent that this machine isn't set up for fails the task at once with a line naming the agent and what to run, "Codex isn't set up on this machine: Codex has no credential: Not logged in. Run `codex login`, or set CODEX_API_KEY. Then start the task again." It never runs on another agent instead. `readme:154-160`; `hm/kit/coder-flow.ts:10-12`. [page, one sentence]
- Where the three differ by sign-in: Claude Code signed in or `ANTHROPIC_API_KEY`; Codex signed in (`codex login`) or `CODEX_API_KEY`; Cursor signed in or `CURSOR_API_KEY`; Cursor runs on `composer-2.5`. `readme:220-222`, `host:140-141`. [page, with the run command]
- What `delegates: all` means: the worker may hand work to every worker on the roster, itself included; the roster is read on every call, so a teammate hired mid-conversation can be handed work on the next call. `dw:33-42`; `readme:172-178` ("Lead can hand it tasks"). [page, one sentence]
- The shared team brief: `TEAM.md`'s body reaches every worker on the team: "The team works on software with the user ... never ask the user which [folder]". `tree/TEAM.md:6-12`; `wd:117` ("The body is the instructions. They reach every worker on the team"). [page]

### What the three talkers have and the coding workers do not

- Memory and a history summary: `agent` installs `mem.capability` with presets `recall: false, connect: false, semantic: true, episodic: true`, records each turn with `afterAnswer: mem.captureFromItems`, and keeps a history summary: `uses: [..., earlier.capability]`, `beforeAnswer: earlier.fold`. `host:305-318`, `host:376-378`. These belong to the `agent` flow, so every worker on it has them: Chief of Staff, researcher, writer and any hired teammate. [page, one sentence: "the three keep a summary of old turns"]
- `maxSteps: 100` so researcher can read a repository a file at a time; the default is 50. `host:380`; `wf/agent-worker-flow.ts:141` (`DEFAULT_MAX_STEPS = 50`), `bw:110`. [ref]
- The tool catalog every worker on `agent` can name in `tools:`: the working folder's source tools (`projectSourceTools(workspace)`: `globProjectSource`, `readProjectSource`, `grepProjectSource`), `search` and `fetch`. `host:371-375`, `wf/projects/project-source.ts:5`. The routine tools come from the `routines` option: `host:382-386`. Chief of Staff gets them through `capabilities: routines: [tools]`; researcher and writer name them in `tools:`. `tree/workers/*/WORKER.md`. [page for "give a worker a tool"; the full catalog rule is `bw:45`, [ref]]

## 3. Where you see one worker message another (question 2)

- When Chief of Staff messages researcher, a line **Messaged researcher** shows in Chief of Staff's conversation, and the message lands in researcher's conversation, where it reads *From* the sender. `readme:85-88`; `g1:7-8` (signal 2: "a line *Messaged researcher* in Lead's conversation, a line *From Lead* in researcher's, and a delivered row Lead → researcher in the message log"). [page]
- The line opens researcher's turn on that message in a popup: what it read, what it did, and the reply it sent. `readme:86-88`, `readme:45-46` ("opens that piece of work in a popup over it: the other worker's session, live"). [page]
- researcher's reply lands in Chief of Staff's conversation under researcher's name. `readme:88`; `g1:8` (signal 3). [page]
- A message never interrupts the turn you are in: while Chief of Staff is answering you, researcher's reply shows as a pending line, and Chief of Staff reads it right after. `readme:88-90`; `mw:59` ("A recipient in the middle of a turn hears the message after that turn ends"); `g1:8` (the reply shows after Chief of Staff's answer to the second line). [page]
- You see all of it: both workers' sessions are yours. `mw:63`. [page, one clause]
- A result of a task lands as one line, *researcher finished: Look up the launch date*, that opens the task in a popup, where the whole result is; a task that finished without writing a result says so there. `readme:96-99`. [page]
- A task's line is drawn the moment it is filed and fills in where it is. `readme:33-34`. [ref or cut]
- The launch-date exercise: with a working folder whose README says the launch date, ask the lead "Ask researcher for our launch date, and help me outline the post." The lead messages researcher, researcher reads the date, and the reply lands under researcher's name. Send a second line before researcher replies: the reply shows pending, then lands after the answer, and the lead uses it in its next line. `readme:233-239`; goal `g1:3-8` grades it against a date drawn per run so the lead can state it only by hearing it from researcher (`g1:5`). [page, as the "try it" step; the prompt is the page's one example]
- The message log is a record: each message is a row, `queuedBehind: "user"` while the user holds the conversation. `mw:61`; the lab reads it through `watchTalk` = "the user's message log (`workforceMessages`)". `ad:22-23`. [ref]
- Messaging itself (sending, reply requested, wait, budget, delivery) is K-08 / the messaging page; the page links, does not explain. `mw:1-130`. [link only]
- Who can message whom: a worker may message any other worker on its user's roster, your own hires and the standard workers; a worker on another user's roster can't be reached, and the refusal reads the same as for a worker that doesn't exist. `mw:24`. [ref]

## 4. The conversation, long-running (what the three get)

- Each worker has one conversation that goes on for weeks. `readme:24`. [page]
- The history window is 50 turns; before a turn leaves the window it is folded into a running summary, and the worker reads the summary with the turns still word for word. `readme:24-27`; `host:305-318` (`utility.historySummary` with `utility.summarizer`); the window default is 50: `wf/agent-worker-flow.ts:1112`. [page, one sentence + a clause that the summary is lost-detail-tolerant is not stated; keep to the README's sentence]
- A divider marks where the word-for-word turns begin, and reads *summarized* once earlier turns have been folded in. `readme:26-27`; screen label *Earlier turns summarized* in `g1:9` (signal 4). [page, one clause]
- The summarizer is told to keep every name, date, code and number word for word and that its summary replaces the one so far. `host:312-316`. [cut: mechanism]
- Tools show in the conversation as they are used, each saying what it acted on (*Read .../next/plan.md*, *Search "codename" · 2 matches*); a run of them is one line, open while it runs and folded when done; a step whose result says it failed reads *(failed)* in red. `readme:27-31`. [page, one sentence; the rendering is UI]
- Typing: Enter sends; Cmd+Enter (Ctrl+Enter) sends from every box, including a teammate's instructions, where plain Enter is a new line. `readme:34-36`. [ref]
- Stop: while a teammate answers, *Stop* sits beside *Send*; Esc twice or Cmd+. (Ctrl+.) does the same; the conversation then shows *Interrupted by you*. `readme:39-44`. [ref or cut]
- Files: paste an image, pick files with **+**, or drop them on the box; the teammate sees them. `readme:37-38`. [ref]
- Keys: Cmd+K (Ctrl+K) finds a teammate or opens *Hire a teammate*; Alt+Up and Alt+Down move between teammates; `/` focuses the composer; `?` lists every key. `readme:61-64`. [ref]
- The page's address names the open teammate and an open task popup (`?worker=<id>&session=<id>&task=<id>`), so a reload or a link reopens them; a link to a teammate or task that is gone opens the first teammate. `readme:65-67`; `lab/test/address.test.tsx:95`. [ref]

## 5. Run it

- Command: `pnpm --filter @flow-state-dev/teammates dev`, which runs `vite build && tsx ../../packages/fsdev/bin/fsdev.ts dev --app @flow-state-dev/teammates`. `readme:198-202`; `pkg:78`. [page]
- It builds the pages, then serves them with the lab's server. It "reads" the variables below. `readme:204`. [page]
- The package is `@flow-state-dev/teammates`, private, from the repository's `labs/teammates/`. `pkg:2-4`. [page]
- The model needs a credential the gateway takes, `AI_GATEWAY_API_KEY`. `readme:220`. [page]
- researcher's web search needs one search provider's key (`TAVILY_API_KEY`, `EXA_API_KEY`, `BRAVE_API_KEY`, or another `@flow-state-dev/tools` takes); fetching a page needs none. `readme:222-224`. [page, one sentence]
- Default model `openai/gpt-6-luna` (`TEAMMATES_MODEL`). `readme:208`, `cfg:52`, `host:81`. [page]
- Working folder `TEAMMATES_WORKDIR`: an absolute path to a git checkout on this machine; default is the root of the repository the lab lives in (`PROJECT_ROOT = ../..` from `labs/teammates`). `cfg:44-45`, `cfg:54`, `readme:209`, `readme:226-228`. [page]
- A working folder that doesn't exist or isn't a git checkout stops the lab at start with an error naming the setting and the path; it never falls back to the current directory. `host:184-202` (`workingFolder` throws `teammates: TEAMMATES_WORKDIR names <folder>, which is not a folder on this machine.` / `... is not a git checkout.`), `readme:226-228`. [page, one sentence]
- There is one working folder for the whole team; "nothing on the page picks a folder, and no worker can name another one". `readme:168-170`, `host:27-33`, `tree/TEAM.md:10-12`. [page]
- Each coding run works in a worktree of the folder, under `.fsdev/teammates-runs/` (or `TEAMMATES_RUNS`); the checkout's `.gitignore` must ignore `**/.fsdev/`, and a run refuses a checkout that doesn't; the checkout's own branch and working tree are never changed. `readme:228-231`; `cfg:55`; `host:330-335` (the check is read at start, a warning, never fatal). [page, two sentences]
- The page's context strip tells you if the folder's `.gitignore` doesn't ignore `.fsdev/`. `readme:163-164`. [ref]
- The store: SQLite file `.fsdev/teammates.sqlite` here (`TEAMMATES_STORE`); the lab runs durable. `readme:211`, `host:400`, `host:403`, `host:418-420`. [page]
- `TEAMMATES_USER`: who the page acts as, default `you`. `readme:212`, `cfg:53`. [ref]
- `TEAMMATES_TREE`: the workers' tree, default `workforce/` beside the lab. `readme:213`, `cfg:60`, `host:77-78`. [ref]
- `TEAMMATES_HARNESS`: the harness a coding worker whose file names none runs on; `claude-code`, `codex` or `cursor`; default `cursor`. `readme:210`, `host:102`, `host:329`. [ref]
- `TEAMMATES_RUN_TIMEOUT_MS`: wall-clock budget for one coding run, default `1200000` (20 minutes); a value that isn't a positive whole number a timer can hold stops the lab at start. `readme:215`, `cfg:56`, `host:204-215`, `host:327`. [ref]
- `TEAMMATES_SETUP`: one command each fresh worktree runs before a coding run starts, no shell. `readme:216`, `host:217-228`. [ref]
- `TEAMMATES_CHECKS`: commands a coding run's worktree must pass before its task is done, `;`-separated, no shell; a red one sends the run back with the command's output; none by default. `readme:218`, `host:230-245`, `hm/kit/coder-flow.ts:19-21`. [ref]
- `GITHUB_TOKEN` for GitHub routines; default what `gh auth token` answers at start; with neither, a GitHub routine is refused, naming the variable, and clock routines still run. `readme:217`, `host:247-261`, `host:268-279`. [ref]
- Variable names that are for goal checks only: `GOAL_HARNESS`, `GOAL_HARNESS_STEP_MS`, `GOAL_STALE_THRESHOLD_MS`. `cfg:32-37`. [cut]
- Try it: the three steps are the launch-date ask (section 3), past 50 turns (the divider reads *summarized*; a fact given "a hundred lines ago is above it, and the lead still knows it") and "Fix the typo in the README's first line." — the lead starts a coding task, the run shows its steps, and the result lands in the lead's conversation. `readme:233-246`; `g1:9-10`. [page, the first and last]
- The run needs a model credential and at least one coding agent this machine is signed in to; the page's context strip shows which agents are ready, each with what to run for one that isn't ("Codex has no credential: Not logged in. Run `codex login`, or set CODEX_API_KEY."), with a Re-check button, next to the working folder, the model and the default agent. `readme:150-166`. [page, one sentence]
- The lead sees the same readiness rows and starts coding tasks only on an agent marked ready, and tells you what to run for one that isn't. `readme:154-156`; `host:23-26`. [page]

## 6. What it installs (the figure: "what it installs")

The app with its kits and the `workforce/` folder, from `host.mts` and the tree.

- `cfg` (the app's config file) is the entry: `export default await openTeammates({...})`. `cfg:50-66`. [page]
- The app is `createFlowState({ kits: [...], fill: {...}, flows: [...], stores: {...}, durable: true, resolvePrincipal, ... })`. `host:362-413`. [page; excerpt]
- Three kits in `kits: [...]` (a kit is a feature an app installs): `workforce({...})`, `harnesses({...})`, and `claudeCode()`. `host:363-391`. [page]
  - `workforce({ directory: tree, agent: {...}, routines: {...}, github: {...} })` from `@flow-state-dev/workforce/kit`: reads the `workforce/` folder and serves the roster flow and the `agent` flow. `host:364-388`, `host:71-72`. [page]
  - `harnesses({ workspace, defaultHarness, review: true, checks, runTimeoutMs, logReadiness: true })` from `@flow-state-dev/harness-manager/kit`: adds the `coder` flow (every coding worker runs on it), the `harnesses` flow with its `readiness` view, and the readiness lines in the workers' context. `host:390`, `host:62`, `hm/kit/coder-flow.ts:1-12`, `host:23-26`. [page]
  - `claudeCode()` from `@flow-state-dev/claude-code`: fills the harness slot for Claude Code. `host:391`. [page; with `fill` below]
- The slot: `fill: { [harnesses.slots.harnesses]: [codexHarness(), cursorHarness({ model: CURSOR_MODEL })] }`: the harnesses kit leaves an opening, `harnesses.slots.harnesses`, and the app fills it with Codex's and Cursor's harnesses; `claudeCode()` fills it with Claude Code's on its own. `host:393-398`, `host:391`, `hm/kit/harnesses-kit.ts:92-93` (the doc comment example). [page, as "slots it opens / fills" for a starter]
- No adapter: the route `serve()`'s tick dispatches each due clock routine and poll to is the router's built-in scheduled endpoint. [ref]
- `durable: true`. `host:403`. [ref]
- One extra flow, `lab-context`, whose `context` view answers (with no session) what the lab works on and with: the working folder, its problem if any, the model, the default harness, and each worker's delegates. The screen's context strip and first-run lines read it. `host:143-179`, `host:349-360`, `host:34-39`. [ref]
- Stores: `stores: { default: { primary: sqliteStores({ filename: options.store }) } }`. `host:400`. [page]
- Every request is the lab's own user, in the organization `teammates-lab`: `resolvePrincipal: () => ({ userId: options.userId, orgId: "teammates-lab" })`. `host:407-408`. [page, see section 8: the lab serves one user]
- Clock routines and GitHub polls tick from two SQLite files beside the store (`<store>-clock.sqlite`, `<store>-poll.sqlite`). `host:281-286`, `host:345-347`, `host:383-385`; `readme:193-194`. [ref]
- The workspace: `localWorkspaceHost({ root: runsRoot, remotes: { allow: [] }, localRepositories: [workdir], source: () => ({ kind: "repo", repo: workdir }) })`: one host for the coder's runs and the workers' source reads, on one constant source. `host:319-326`. [ref]
- Memory is composed into `agent` through `uses` and `afterAnswer`: `system({ model, working: { capacity: 7 }, episodic: true, semantic: true })`. `host:305`, `host:376-378`. [ref]
- Folder layout: `labs/teammates/` holds `fsdev.config.mts`, `host.mts`, `workforce/teams/teammates/{TEAM.md, workers/<name>/WORKER.md}`, `src/` (the screen), `cli/index.ts` (the app contract `fsdev dev --app` reads), `test/`. `labs/teammates` listing; `pkg:73-75`. [page, one figure]
- The workforce folder is the standard tree: `workforce/teams/<team>/TEAM.md` and `workers/<name>/WORKER.md`. `wd:19-39`; `tree`. [page]
- Every file in the folder is used or refused: a file workforce doesn't read stops the app starting, and the error names it. `docs/contributing/docs-revamp/pages/concepts/workers.facts.md` section 3 (cited there to `wf/loader/read-workforce-folder.ts:1-12`). [ref]

## 7. Change it (the first three changes)

### Rewrite a brief

- A worker's brief is the body of its `WORKER.md`: "Everything below the second `---` is the worker's instructions." `wd:57-59`, `wd:622-624`; `tree/workers/*/WORKER.md`. [page]
- Edit the file and restart the lab: the folder is read when the app starts, so a changed file changes the worker "for everyone who hasn't edited it" on the next start. `wf/workers/standard-workers.ts:1-9` ("a deploy that changes a file changes the worker for everyone who hasn't edited it"); `wd:956` ("Read it once, at startup"); concept sheet `docs/contributing/docs-revamp/pages/concepts/workers.facts.md` §2 for the same citations. [page]
- A shared brief for the team goes in `TEAM.md`'s body; it reaches every worker on the team. `tree/TEAM.md:6-12`, `wd:92-117`. [page, one clause]
- In the screen: **Edit** on a teammate's panel renames it and replaces its instructions in full; a blank box keeps them; the new instructions apply from its next turn, a turn already running keeps the ones it started with. `TeammateForms.tsx:55-80 (EditForm at :63)` (doc comment on `EditForm`: "Its next turn reads them; a turn already running keeps the ones it started with. The page can't read the old instructions back, since they stay on the server, so a blank box keeps them and a filled one replaces them whole."), `ad:526-530`. [page]
- Editing a file's teammate in the screen makes the user's own copy of it under the same id; the file is untouched; **Reset to default** removes the copy and the file's version is read from the next turn; the conversation and history stay as they were; another user in the same organization still gets the file's worker. `ad:526-533`, `wf/workers/standard-workers.ts:5-10`, `wf/workers/hire-blocks.ts:11-14`; `g2:3-11` (legs a, b, c, d). [page]
- A hired teammate can be edited the same way. `g2:11` (leg e). [page]
- A rename shows the new name in the next turn's prompt (`You are <name>`) and in other workers' lists of who they can message. `g2:11` (leg a: "researcher's next turn lists `teammates.chief-of-staff` as Chief of Staff"). [ref]
- Four questions for the edited copy: see section 8. [page]

### Add a worker

Two doors.

- **From the files:** add a folder `workforce/teams/teammates/workers/<name>/WORKER.md` with at least a `description`; its id is `teammates.<name>`; it runs on the built-in `agent` flow when no `flow:` is named. `wd:76`, `wd:148-152`, `bw:13`. The new worker then appears in the list after a restart. [page]
- A worker is reachable by Chief of Staff because Chief of Staff has `delegates: all`; the roster is read on every call. `tree/workers/chief-of-staff/WORKER.md:6`, `dw:33-42`. [page]
- A worker is told who it can message: "The prompt opens with its name, its team and its `description`, then lists the workers it can message, by name and id, and the workers that take only tasks." `bw:39`. [page, one clause: the description is what others pick by]
- A new coding agent is one more `WORKER.md` with `flow: coder` and a `harness:`, never another flow; the harness has to be one the app filled in the slot. `hm/kit/coder-flow.ts:8-10`; `tree/workers/claude-code/WORKER.md:4-5`. [page, one sentence; the harness fill is in `host.mts`]
- **From the screen:** *Hire a teammate* (under the list, or Cmd+K): a name, one line on what it does, and its instructions; Hire is disabled until the name and the line are filled in. The teammate joins the list at once and the lead can hand it tasks; nothing restarts. `TeammateForms.tsx:35-52`, `readme:172-174`, `host:40-41`; the roster write is the workforce client's `hire`: `ad:29`, `ad:1522-1523`. [page]
- A hired teammate runs on the `agent` flow. `ad:523`. [page]
- A hired teammate's header has **Fire**, which asks first in a row under the header with **Keep** focused, and takes it off the list; its conversation stays readable. `readme:174-178`, `readme:63-64`, `Conversation.tsx:166`, `Conversation.tsx:113`, `ad:533`. [page, one sentence]
- A hired teammate's icon is an initial on a colour picked from its id. `readme:285-287`. [ref]
- `color:` names one of `blue`, `green`, `amber`, `rose`, `violet`, `teal`; `icon:` is a character. Both are declared on the `agent` flow with `settings: { icon, color }` and shown on its roster row with `showSettings: ["icon", "color"]`. `readme:285-287`, `host:367-369`, `tree/workers/*/WORKER.md`. [ref]

### Give a worker a tool

- A worker names its tools by key in `tools:`; each key resolves first against its own `blocks/` folder, then its team's, then the worker flow's catalog. A key nothing registers is refused when the worker is hired, naming the key. `bw:45`. [page]
- A written `tools:` list is the whole of what the worker can call. `bw:49`. [page]
- In this app the catalog is in `host.mts`: `catalog: { ...projectSourceTools(workspace), search: search(), fetch: fetch() }`. So the names `globProjectSource`, `readProjectSource`, `grepProjectSource`, `search` and `fetch` are available to any worker on `agent`; a tool outside them needs an entry in the catalog (an edit in `host.mts`) or a `blocks/` folder beside the worker. `host:371-375`, `bw:45`, `bw:93`. [page: the example is adding `search` to writer's `tools:` line]
- Example of the smallest change: add `search` to writer's `tools:` (writer's line has no `search`; researcher's has): `tree/workers/writer/WORKER.md:6` vs `tree/workers/researcher/WORKER.md:6`. Web search then needs a search provider key. `readme:222-224`. [page; verified: `search` is in the catalog, `host:373`]
- Routine tools are named in `tools:` too: `listRoutines`, `saveRoutine`, `pauseRoutine`, `deleteRoutine`; Chief of Staff gets them through `capabilities: routines: [tools]`. `tree/workers/*/WORKER.md`, `host:382-386`. [ref]
- A capability preset can carry tools too: `capabilities: consultSessions: [consult]` gives Chief of Staff `consultSessionHistory`, which reads a teammate's conversation without waking it. `tree/workers/chief-of-staff/WORKER.md:7-9`, `:20-21`, `:62-67`; `mw:378-394`. [page, one clause or ref]
- Reading versus messaging: asked what the user already told researcher or writer, Chief of Staff reads the conversation with `consultSessionHistory` (`of` is the teammate's id) instead of messaging; the answer is as of when it was read. `tree/workers/chief-of-staff/WORKER.md:62-67`; goal `goals/teammates-lab/consults-a-conversation-without-waking-it/`. [ref]
- A worker whose `tools:` line is absent can call the tools of the capability presets it selected and the blocks of the packages it holds, and nothing else. `bw:49`. [ref]
- The working folder's tools are read-only: no worker has a tool that writes a file, so writer answers with the draft rather than saving it. `tree/workers/writer/WORKER.md:6`, `readme:293-294`. [page, in not wired]

## 8. The four questions, for each stored part

### A worker file (`WORKER.md`, `TEAM.md`)

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The app: the files are in the lab's folder. | `tree`, `wf/workers/standard-workers.ts:1-12` |
| Who can see it | Every user gets the worker it defines. The screen reads a roster row (name, description, flow, `icon`, `color`), not the file. | `wf/workers/standard-workers.ts:98` (`client: { state: { read: true } }`), `ad:1163` |
| Where it is stored | Nowhere but the folder: read when the app starts, not stored per user. | `wf/workers/standard-workers.ts:1-9`, `wd:956` |
| How many exist | One per `WORKER.md`: six here (Chief of Staff, researcher, writer, and three coding workers). | `tree` listing |

### A user's edited or hired teammate

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The user who edited or hired it, in the organization they are signed in to. Here, the lab's one user in `teammates-lab`. | `wf/workers/hire-blocks.ts:11-14`, `host:408`, `g2:3` |
| Who can see it | Its owner. Another user in the same organization still sees the file's version. | `g2:5-8` (legs a, c) |
| Where it is stored | One row in the user's scope in the app's store, here the SQLite file. The file is never written. | `wf/workers/hire-blocks.ts:1-14`, `wf/workers/keys.ts:11-15`, `host:400` |
| How many exist | One per id on the user's roster. An edited file worker has one copy per user, under the file's id; Reset deletes it. A hired teammate stays until fired. | `wf/workers/hire-blocks.ts:11-14`, `ad:30-32` |

### A conversation

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The user who opened it. | `wf/workers/derive-session-id.ts:1-25`, `wd:875-877` |
| Who can see it | Its owner only: the lab serves one user (`TEAMMATES_USER`) and takes every request as that user, whatever user the request names. In an app with several users, each sees only their own. | `host:407-408`, `readme:189-192`, `wd:875-877` |
| Where it is stored | In the app's store, here `.fsdev/teammates.sqlite`, with its history; it outlives the request and a restart. Data saved before the lab named its organization (`teammates-lab`) doesn't open. | `host:49-50`, `host:400`, `readme:191-193`, `wd:837-840` |
| How many exist | One default conversation per user per worker; the screen has no new-chat button and no session list. | `wf/workers/derive-session-id.ts:1-25`, `wd:853-873`, `readme:77-79` |

The conversation's summary (the divider's *summarized*) is a session resource: "the session's `historySummary` resource": `readme:277`; it lives with the conversation. [page, one clause]

### A task, and a coding run

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The user whose conversation filed it. | `docs/contributing/docs-revamp/pages/concepts/workers.facts.md` §5 table (`wf/conversation-board/ledger.ts:3-11`) |
| Who can see it | The same user: the row shows in the filing worker's panel, and in the popup. | `readme:50-60`, `readme:273` |
| Where it is stored | A row on the conversation's board, in the app's store. A coding run's work is a git worktree of the working folder, under `.fsdev/teammates-runs/` (or `TEAMMATES_RUNS`), on its own branch. | `readme:228-231`, `host:320-324`, `ad:1688` |
| How many exist | One row per task. One worktree per coding run; the working folder's own branch and tree are never changed. | `readme:228-231`; `g1:10` ("exactly one worktree ... carries a commit that changes README.md alone") |

The panel's Clear hides failed tasks in this browser only, deleting nothing: that state is browser-local. `readme:53-57`; `lab/src/lib/cleared.ts`. [ref]

### Messages

| Question | Answer | Source |
| --- | --- | --- |
| Who owns it | The user whose roster the two workers are on. | `mw:24` |
| Who can see it | The user: it is in both conversations and in the message log. | `mw:63` |
| Where it is stored | In the message log and in each side's session, in the app's store. | `mw:40`, `mw:50-55` |
| How many exist | One row per message; a reply is one more row, with `inReplyTo`. | `mw:100`, `mw:55` |

### Routines (if the page mentions them)

- Lead (Chief of Staff), researcher and writer can each follow a GitHub pull request, or run something on a clock; ask in words (*"Follow acme/api#412 and tell me about every review on it."*). `readme:182-186`. [ref; the page can say they exist and link]
- The panel's Routines list is empty: "None yet." `panel:276-281`. [page, not wired]

## 9. What is not wired yet (question 3)

From the README's "Not wired yet" list, checked against the code:

1. **Editing a worker from the files.** The README says files are read-only and a user's change "waits on a product call" (`readme:291-293`). **The code contradicts this**: every teammate has Edit and an edited file teammate has Reset (flag 4). The page does not repeat it. [do not state]
2. **Saving writer's drafts.** True: no tool on writer's `tools:` line writes a file (`tree/workers/writer/WORKER.md:6`); "writer answers with the draft rather than saving it". `readme:293-294`. [page]
3. **The source tools' own descriptions say "project".** `projectSourceTools` describe what they read as "the project this session works in"; here that is the working folder. `readme:295-297`. [page, one sentence, since a reader sees it in a trace]
4. **No group chats, no new-chat button, no session list.** "Scope is core messaging and session management." `readme:77-79`. [page]
5. **The panel's Routines list shows "None yet."** `panel:276-281`. Routines can be created by asking a worker, but the panel does not list them. [page]
6. **One user.** The lab takes every request as the one user `TEAMMATES_USER`, whatever user the request names, and the GitHub token serves nobody else. `readme:189-192`, `host:407-408`, `host:268-279`. The framework keeps conversations per user (section 8), but this app does not sign anyone in. [page]
7. **The screen needs a checkout of this repository**: it is a private package built by `vite build` from `labs/teammates/`, and the lab's default working folder is the repository root. `pkg:2-4`, `pkg:78`, `cfg:44-45`. [page, ties to flag 1]
8. **Coding runs in an app that isn't a git checkout.** "The working folder: an absolute path to a git checkout"; missing or not a checkout fails at start. `host:184-202`. [page]

## 10. The figures

Both figures belong to the page plan; the facts they draw on:

- **The screen** (screenshot): the three panels in section 1, with the lead's panel showing a line *Messaged researcher*. `readme:12-60`, `readme:85-88`. A screenshot must show the real screen; the figure brief says "screenshot", so it cannot be drawn from this sheet. [figure]
- **What it installs** (box in a box, hatching on each user's conversations): the app contains the `workforce/` folder (six `WORKER.md`, one `TEAM.md`), the three kits (`workforce`, `harnesses`, `claudeCode`), the extra `lab-context` flow, and the SQLite store. Hatching ("outlives the request", `docs/contributing/user-docs.md` figures table) belongs on what the store keeps per user: the conversations, the message log, the boards and a user's edited or hired teammates (section 8). The worker files are not hatched: they are in the repo and read at start (`wf/workers/standard-workers.ts:1-9`). The working folder and the runs' worktrees are on disk beside the store. `host:362-413`, `readme:226-231`. [figure]
- Per-user hatching: the lab pins one user (section 9, item 6), so a figure that draws more than one user draws what the framework does, not what the lab shows. [flag for the owner]

## 11. Everything else in the README the page does not state

- Notifications (*Notify me*), the tab title count, the unread counts, the two-minute *Coding task finished* line. `readme:17-23`. [cut: screen detail]
- Task buttons (Cancel, Steer, Retry, Re-run on ...), the review card (**Open a PR**, **Merge locally**, **Ask for changes**), the judge's verdict, token and cost totals, *quiet for 40m*. `readme:101-148`, `readme:68-75`. [ref; the page may say a coding task that committed waits for your review (`host:390`, `review: true`) in one sentence]
- The "What the screen reads" table (adapter to package calls). `readme:256-277`. [cut: contributor material]
- The test double and contract tests. `readme:250-254`. [cut]

## 12. Words and names to avoid (for the page's author)

- Say "Chief of Staff" (the file's name), never "Lead", and never "Grok Bot" (a product; `readme:3`). [page]
- Use "worker" for a name on the team; "teammate" is the lab's word for the same thing, in its screen text (`Hire a teammate`, `Edit`, `Fire`). The page may use "teammate" where it quotes the screen. The retired words are `person` and `member` (`docs/contributing/user-docs.md`). [page]
- "Lab" is the repository's word for a private example app. The page should call it "the app" or "Teammates". [page]
- "Kit" and "slot" are the framework's words; define each at first use: a kit is a feature an app installs, a slot is an opening a kit leaves for other kits. `docs/contributing/user-docs.md` "Words". [page]
- No tracker ids, no spec link (`readme:79`, `g1:3`, `g2:3`). [cut]

## Revisions (round 1)

Verified against code, then the page changed to match:

- The panel's Routines section is a fixed "None yet." with no data behind it (`panel:276-281`), so the page says the list never shows routines, which do exist when a worker is asked for one. [page]
- `fsdev dev --app` prints an `App:` line with the URL; the app takes the root of that port (`packages/fsdev/src/commands/dev.ts:9`, `:613`). [page]
- A received message's visible header is `← <sender>` (`src/components/Entry.tsx:107-116`); `From <name>` is only an aria-label. [page]
- `consultSessionHistory` reads a conversation without starting a turn in it. [page, as "without starting a turn there"]
- Per-user copies of an edited file teammate: the lab takes every request as one user (`TEAMMATES_USER`), so the page no longer mentions other users. [cut]
- A name in `tools:` that nothing registers is refused at the hire with an error naming it (`packages/workforce/src/agent-worker-flow.ts:489-503`). The page links this to the WORKER.md reference. [ref R-28]
- The tool names a worker's `tools:` line can use here also include `listRoutines`, `saveRoutine`, `pauseRoutine` and `deleteRoutine` (the workforce kit's routines), beyond the five the catalog passes (`host:371-375`). The page no longer lists names. [ref R-28]
- `claudeCode()` is a kit, so it appears in `kits:` and needs no `fill` entry. [page]

Rows moved off the page, which now links them (reference slugs by sitemap id): R-25 `reference/workforce` (conversation length and the summary of older turns, roster states of edited, forked and hired teammates, hiring at runtime, `flow: coder` and `harness:`); R-26 `reference/messaging` (a message never interrupts the receiving turn; a pending reply lands after the current answer; slug not yet in the repo); R-27 `reference/harness-runs` (coding workers not messaged, a checkout per run, the `readiness` view, ready agents only); R-28 `reference/worker-md` (id formation, `flow:` default, delegation, `tools:` resolution and refusal); R-29 `reference/workforce-folder` (folder read at start, `TEAM.md` body); R-15 `reference/environment` (`TEAMMATES_WORKDIR`, `TAVILY_API_KEY`, `TEAMMATES_USER` and defaults).

## Revisions (round 2)

Added to the page, each already on this sheet above:

- A message never interrupts the turn in progress; a pending reply is read right after the answer (section 3, `readme:88-90`, `mw:59`, `g1:8`). [page]
- A "Start a coding task" section: named agent runs it, none named runs Cursor with no question; own worktree under `.fsdev/teammates-runs/`; an agent not set up fails at once with the quoted line and never falls back; the context strip shows ready agents (sections 2, 5; `readme:154-160`, `readme:228-231`, `tree/workers/chief-of-staff/WORKER.md:38-44`). [page]
- Edit: leaves `WORKER.md` untouched, makes the user's own copy under the same id as a row in their scope in the app's store; running turn keeps its instructions; blank box keeps them; another user in the organization gets the file's worker; Reset deletes the copy; editing the file and restarting changes everyone who has not edited (section 7, 8; `ad:526-533`, `TeammateForms.tsx:55-80`, `g2:3-11`, `wf/workers/standard-workers.ts:1-9`). [page]
