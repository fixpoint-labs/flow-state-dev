# Sitemap · Catalog

[Index](README.md) · [Start](start.md) · [Concepts](concepts.md) · **Catalog** · [Build](build.md) · [Reference](reference.md)

Forty-three pages, type `catalog`, 1,500 words of prose at most. All are written by **FIX-2703**,
which waits on FIX-2627 for the real install lines. The shelves: Starters, Kits, From the
community, Libraries.

Entries are shorter than in Start and Concepts, because every page follows one of two templates
and the contents line names only what is particular to the page.

**The kit template** (kits, their sub-pages, libraries): What you get · Install it · Use it ·
Slots it opens · Slots it fills and views it serves · Change it · Next. A library that opens no
slots drops those two headings and says so in one line under Install it.

**The starter template:** (a screenshot) · Who it is for · Run it · The kits it installs · The
first three things to change · What isn't wired yet · Next.

**Unsettled, for the whole section.** The kit factories and their config keys (FIX-2627,
reconciled at FIX-2705 under ER-8). The install path of a starter (O2). The Claude Code-style
starter's name. Whether Codex and Cursor ship as kits or as fills of the harnesses slot.

**Figure conventions here.** A kit page's first figure is always *what this installs*: the kit
as one box set into an app, with its flows, the folder it reads, the slots it opens and the
views it serves. Same layout on every kit page, so a reader compares kits by eye. Marks: box in
a box, arrow (`FILLS A SLOT`), hatching on stored data.

---

### K-01 · Catalog

`catalog/` · catalog · 300 words

**Job.** The three shelves in one screen, and how to pick between a starter, a kit and a library.
**Contents.** Starters · Kits · From the community · Libraries · Which one do I want
**Questions.** (1) You want a whole app to reshape: which shelf? (2) You want one function to import: which shelf? (3) Where would a kit you published appear?
**Figures.** None; three short tables.
**Examples.** None.
**Sources.** `ecosystem/overview` (replace).

---

## Starters

### K-02 · Teammates

`catalog/starters/teammates` · catalog · 800 words · starter template

**Job.** A small team you talk to one at a time, whose workers message each other where you can see it.
**Contents.** Starter template. First three changes: rewrite a brief · add a worker · give a worker a tool.
**Questions.** (1) What does each worker have that the others do not? (2) Where do you see one worker message another? (3) What is not wired yet?
**Figures.** *The screen* (screenshot). *What it installs*: the app with its kits and the `workforce/` folder. Marks: box in a box, hatching on each user's conversations.
**Examples.** Its `fsdev.config.ts` · one `WORKER.md` · the run command.
**Links to, does not explain.** Workers → C-22. Messaging → K-08.
**Sources.** `labs/teammates` README (no page exists today).

### K-03 · The Claude Code-style starter

`catalog/starters/<name>` · catalog · 800 words · starter template

**Job.** A coding app: sessions on the left, the main thread in the centre, background tasks on the right.
**Contents.** Starter template. First three changes: point it at your repository · change the main worker's brief · add a second harness.
**Questions.** (1) Where does a coding run make its changes? (2) How do you add Codex beside Claude Code? (3) What is not wired yet?
**Figures.** *The screen* (screenshot). *What it installs*: workforce, harnesses and the coding-agent kit in a chain. Marks: box in a box, arrow (`FILLS A SLOT`).
**Examples.** Its config · the workspace setting · the run command.
**Links to, does not explain.** Coding harnesses → C-23. Harnesses kit → K-14.
**Sources.** `labs/claude-code-style` README (no page exists today).
**Unsettled.** Its name, and so its slug and title. The page cannot be written before it has one.

### K-04 · Shift Manager

`catalog/starters/shift-manager` · catalog · 900 words · starter template

**Job.** The browser app a Workforce team is worked through: asks, tasks, workstreams and projects in one tab.
**Contents.** Starter template, plus: What you see (Inbox; Tasks; Projects) · The Shift Coordinator · Your own keys.
**Questions.** (1) What do you point Shift Manager at? (2) What does the Shift Coordinator do that an ordinary worker does not? (3) Where do you set a key for a tool a coding run uses?
**Figures.** *The screen* (screenshot, leading the page). *A Lab*: one config holding a team, and Shift Manager reading it. Marks: columns, arrow (`READS`), hatching.
**Examples.** The `shift-manager` command · a Lab's config.
**Links to, does not explain.** Coordinators → K-06. Projects → K-10.
**Sources.** `shift-manager/overview`, `shift-manager/settings` (rewrite as one; lead with the screens) · `workforce/shift-coordinator` (move here) · `shift-manager/from-a-checkout` (to contributor docs).
**Unsettled.** "Lab" is defined once here or dropped (the audit's open item).

---

## Kits

### K-05 · Workforce

`catalog/workforce/` · catalog · 1,200 words · kit template

**Job.** What the kit installs: a roster of workers for each user, the built-in agent they run on, and the screens' views.
**Contents.** Kit template, plus under Use it: The built-in agent (tools; skills; memory) · A user's own workers (hire; fork; edit; fire) · What a worker can find (discovery).
**Questions.** (1) What does a worker run on when its file names no flow? (2) A user hires a worker while the app runs: what changes on disk? (3) Which views does the kit serve? (4) Which slot would a kit fill to add a kind of worker?
**Figures.** *What this installs* (the convention). *A worker's turn*: brief, tools, memory and the conversation going into one model call. Marks: arrow (`GOES INTO`), hatching on memory and the conversation, dashed outline on the turn.
**Examples.** `workforce({ directory })` · a worker with tools · hiring from the client: `createWorkforceClient`.
**Links to, does not explain.** The model → C-22. Hire options, inventory, usage, discovery output → `reference/workforce`. File settings → `reference/worker-md`.
**Sources.** `workforce/built-in-worker`, `workforce/durable-hire` (merge) · `orchestration/discovery` (move here) · `workforce/inventory`, `workforce/worker-usage` (to Reference).

### K-06 · Coordinators

`catalog/workforce/coordinators` · catalog · 1,100 words · kit template

**Job.** One front door for a team: a worker that hands each message to the right delegate.
**Contents.** Kit template, plus under Use it: Choosing how it routes · Letting delegates answer each other · Handing out tasks.
**Questions.** (1) Name two ways a coordinator can choose a delegate. (2) A message fits no delegate: what happens? (3) How do you make your own flow a delegate?
**Figures.** *One door, several workers*: a message arriving at the coordinator and going to one delegate. Marks: arrow (`HANDS TO`), highlighter on the choice.
**Examples.** A coordinator's `WORKER.md` · talking to it · changing its delegates.
**Links to, does not explain.** Routing modes, what it records → `reference/workforce`.
**Sources.** `workforce/coordinators` (sub-page of about 1,500, plus Reference).

### K-07 · Delegating work

`catalog/workforce/delegating-work` · catalog · 1,000 words · kit template

**Job.** A worker files tasks for the workers that work for it, and a worker given a task can split it.
**Contents.** Kit template, plus under Use it: Filing a task · Splitting a task · Seeing what came back.
**Questions.** (1) Who can a worker hand a task to? (2) Where does the delegate do the work? (3) How does the worker that asked learn the task is done?
**Figures.** *A task handed down and reported back*: lead, board, coder's session, result. Marks: arrow (`FILES`, `REPORTS`), hatching on the board and the session.
**Examples.** `delegates:` in `WORKER.md` · the task on the conversation's board · rendering the board.
**Links to, does not explain.** Boards → C-21. Task statuses → `reference/task-board`.
**Sources.** `workforce/delegating-work` (rewrite to about 1,200; cut "After upgrading").

### K-08 · Messaging between workers

`catalog/workforce/messaging` · catalog · 1,100 words · kit template

**Job.** A worker sends another worker on the same roster a short message, and can wait for the reply or go on.
**Contents.** Kit template, plus under Use it: Send and go on · Ask and wait · Where you see it.
**Questions.** (1) Can Alice's worker message Bob's? (2) Ask-and-go-on or ask-and-wait: which for a question that blocks the answer? (3) Where does a user see the exchange?
**Figures.** *Two ways to ask*: two short timelines, one that continues and one that waits. Marks: arrow, dashed outline on each turn, hatching on the stored message.
**Examples.** A worker allowed to message · the message as it appears in the conversation.
**Links to, does not explain.** Delivery states and refusals → `reference/worker-messaging`.
**Sources.** `workforce/messaging-workers` (sub-page plus Reference).

### K-09 · Standing rules

`catalog/workforce/standing-rules` · catalog · 900 words · kit template

**Job.** Notes a user asks a worker to keep; the worker follows them on every later turn with that user.
**Contents.** Kit template; the page stays close to today's.
**Questions.** (1) Who can see a rule Alice set? (2) How does a user remove one? (3) Rule or brief: "always answer in French"?
**Figures.** *A rule, kept*: said once in a conversation, stored for that user, present in every later turn. Marks: arrow, hatching on the rule.
**Examples.** Turning it on · a rule being saved in a conversation.
**Sources.** `workforce/standing-rules` (keep; the model for the other sub-pages).

### K-10 · Projects

`catalog/workforce/projects` · catalog · 1,200 words · kit template

**Job.** A project is a body of work with an owner, private or shared, that users talk to through their own workers.
**Contents.** Kit template, plus under Use it: Private and shared · Workstreams · Talking to a project.
**Questions.** (1) Is a project a folder? (2) Two users share a project: whose worker answers each of them? (3) What does a workstream have exactly one of?
**Figures.** *A shared project*: one project, two users, each reaching it through their own worker. Marks: box in a box, hatching, red on what the other user cannot read (`CANNOT READ`).
**Examples.** Creating a project · adding a workstream · opening its conversation.
**Links to, does not explain.** The row's fields, collections → `reference/workforce`. A project's code → K-14.
**Sources.** `workforce/projects` (sub-page of about 1,500; the coding half to Harnesses) · `guides/projects-on-org-scope` (cut; it collides with this meaning).

### K-11 · The workforce folder

`catalog/workforce/the-workforce-folder` · catalog · 1,300 words · kit template

**Job.** Everything a team keeps on disk, in one tree: workers, shared documents, code, capabilities, packages.
**Contents.** Kit template, plus under Use it: Workers · Documents · Code · Capabilities · Packages · What reads it, and when.
**Questions.** (1) Where does a document every worker on a team should read go? (2) You add a flow under the tree: what do you run? (3) A file is in the wrong place: what happens at startup? (4) Who holds a package placed at team level?
**Figures.** *The tree*: the folder drawn as a tree with a label on each branch saying what it becomes in the app. Adds the map five pages lacked. Marks: box in a box, arrow (`BECOMES`), highlighter on the one folder a newcomer touches first.
**Examples.** The tree as a listing · one document · one capability file · the generate command.
**Links to, does not explain.** Every path rule and file format → `reference/workforce-folder`, `reference/worker-md`.
**Sources.** `workforce/documents-on-disk`, `code-on-disk`, `capabilities-on-disk`, `packages-on-disk` (merge into one) · `workforce/workers-on-disk` (the folder half).

### K-12 · Workforce screens

`catalog/workforce/screens` · catalog · 900 words · kit template

**Job.** The views and components that put a roster, its coordinators and its boards on a page.
**Contents.** Kit template, plus under Use it: The roster · A conversation · A board.
**Questions.** (1) Which view lists a user's workers? (2) What re-renders when a worker starts waiting? (3) Do you have to use the shipped components?
**Figures.** *Which view feeds which part of the screen*: a page wireframe with each region tied to a view. Marks: arrow (`READS`), hatching on the data behind each view.
**Examples.** `useView` on the roster · the roster component · the board component.
**Links to, does not explain.** Views → C-09. Component props → `reference/ui-components`.
**Sources.** `workforce/ui` (sub-page).

### K-13 · Error reporter

`catalog/workforce/error-reporter` · catalog · 700 words · kit template

**Job.** A worker that turns a failure that stayed failed, or a problem a user describes, into one bug report.
**Contents.** Kit template.
**Questions.** (1) What two things can start a report? (2) Who sees it before it is filed? (3) Where does it go?
**Figures.** None; the page is short and has no shape to draw.
**Examples.** Turning it on · a report as the operator previews it.
**Sources.** `workforce/error-reporter` (sub-page; missing from the sidebar today).

### K-14 · Harnesses

`catalog/harnesses/` · catalog · 1,300 words · kit template

**Job.** What the kit installs: a worker that turns a task into a supervised coding run in its own checkout.
**Contents.** Kit template, plus under Use it: Where a run works · The verdict · Questions to a person · A project's code and files.
**Questions.** (1) Which slot does this kit open, and what fills it? (2) What must hold before a run's task is marked complete? (3) Where is a run's checkout, and what is it made from? (4) What does the kit need from Workforce?
**Figures.** *What this installs* (the convention). *One run*: reuses the supervised-run figure from C-23, with this kit's config keys named on it.
**Examples.** `harnesses({ workspace })` · filling the slot from the app · reading a run's changes on a page.
**Links to, does not explain.** The model → C-23. Run states, verdict contract, workspace options → `reference/harness-runs`.
**Sources.** `orchestration/harness-manager` (kit page of about 2,000, plus Reference) · `workforce/projects` (the coding half).

### K-15 · Claude Code

`catalog/harnesses/claude-code` · catalog · 1,000 words · kit template (adapter)

**Job.** Run a Claude Code agent as a harness, or as a block in your own flow.
**Contents.** Kit template, plus under Use it: As a harness · As a step · Continuing a session · Approving tools.
**Questions.** (1) What credential does it need, and how do you check for it before a run? (2) How do you continue yesterday's session? (3) What does it emit while it works?
**Figures.** None of its own; it points at the supervised-run figure.
**Examples.** `claudeCode()` in `kits` · the block as a sequencer step.
**Links to, does not explain.** Options, emitted items, usage → `reference/harness-runs` and generated `@flow-state-dev/claude-code`.
**Sources.** `tools/claude-code-sdk` (adapter page on the shared template, plus Reference).

### K-16 · Codex

`catalog/harnesses/codex` · catalog · 800 words · kit template (adapter)

**Job.** Run OpenAI's Codex agent as a harness or a block.
**Contents.** As K-15: As a harness · As a step · Continuing a thread.
**Questions.** As K-15, for Codex.
**Figures.** None of its own.
**Examples.** Filling the harnesses slot with Codex · the block as a step.
**Sources.** `tools/codex` (adapter page on the shared template).

### K-17 · Cursor

`catalog/harnesses/cursor` · catalog · 800 words · kit template (adapter)

**Job.** Run Cursor's coding agent as a harness or a block.
**Contents.** As K-15: As a harness · As a step · Steering a running turn.
**Questions.** As K-15, for Cursor.
**Figures.** None of its own.
**Examples.** Filling the harnesses slot with Cursor · the block as a step.
**Sources.** `tools/cursor` (adapter page on the shared template).

---

## From the community

### K-18 · From the community

`catalog/community` · catalog · 250 words

**Job.** The shelf for kits other people publish. It starts empty and says how to get on it (O1).
**Contents.** What goes here · Add yours.
**Questions.** (1) What is a community kit, technically? (2) How do you list one? (3) Is there a registry?
**Figures.** None. **Examples.** None.
**Links to, does not explain.** Writing and publishing a kit → B-04.
**Sources.** New. FIX-2703 also edits `docs/objectives.md` to match (O1).

---

## Libraries

Libraries open no slots. Their pages use the kit template without the two slot headings.
Config tables on today's pages move to `reference/patterns`, `reference/tools` and
`reference/memory`.

### K-19 · Patterns

`catalog/patterns/` · catalog · 800 words

**Job.** A chooser: which ready-made composition fits the job, and how to measure instead of guess.
**Contents.** What a pattern is · Pick by the shape of the work (a table of eight) · Measure on your own tasks · Build your own.
**Questions.** (1) Each result needs a review before it counts: which pattern? (2) The plan should change as results come in: which? (3) How do you compare two patterns on your tasks?
**Figures.** *Eight shapes*: one small drawing per pattern on a shared grid. Adds recognition at a glance. Marks: arrow, highlighter on none; this is an index, not an idea.
**Examples.** One pattern used as an action's block.
**Links to, does not explain.** Boards → C-21. Benchmarks → B-33. Writing one → B-21.
**Sources.** `patterns/overview` (rewrite as a chooser) · `guides/choosing-patterns-with-benchmarks` (merge).

### K-20 to K-27 · The eight pattern pages

Each: `catalog/patterns/<name>` · catalog · kit template without slots. Contents: When to use it ·
How it works (one figure) · Use it · Change it (the planner, the worker, the synthesizer, as the
pattern has them) · Next. One figure each: *the pattern's shape*, its blocks and what passes
between them, drawn on the grid K-19 uses. Marks: arrow, dashed outline on what runs inside one
action run, hatching where a list or transcript is stored. Config tables → `reference/patterns`.

| Id | Page | Words | Job | Cold-read questions | Examples | Source verdict |
| --- | --- | --- | --- | --- | --- | --- |
| K-20 | Parallel Tasks | 800 | Split a goal once, run the pieces side by side, combine | One task fails: what does the result hold? · Is there a review step? · Where do you swap the planner? | `parallelTasks` basic use; a custom synthesizer | Keep |
| K-21 | Supervisor | 1,000 | Fan out, review each result, retry the ones rejected | Who decides a result is good? · How many retries does a task get? · What does a worker receive on a retry? | `supervisor` basic use; a reviewer | Keep |
| K-22 | Plan and Execute | 1,300 | Plan a task graph, work through it, replan with what came back | When does it replan? · A step fails: what happens to steps that depend on it? · Where does the goal come from in a conversation? | `planAndExecute` basic use; a custom step executor | Keep; trim |
| K-23 | Debate | 1,300 | Agents argue assigned positions; a judge reads the transcript and decides | Who ends the debate? · Pick a winner or synthesize: who chooses? · When is debate the wrong tool? | `debate` basic use; stances | Keep; trim |
| K-24 | Round Robin | 1,100 | A fixed roster takes turns; an optional referee critiques each round | What stops the loop? · What does the referee change? · Who reads the contributions? | `roundRobin` basic use; a referee | Keep |
| K-25 | Routed Specialists | 700 | A controller picks the next specialist over a shared workspace until it converges | Who decides which specialist runs next? · What do specialists share? · What ends it? | `routedSpecialists` minimal example | Keep |
| K-26 | Event Actors | 900 | Actors react to topics they watch; no controller | You add an actor: what else changes? · One actor throws: what happens to the others? · How does an actor trigger another? | `eventActors` basic use; topic matching | Keep |
| K-27 | Response Auditor | 1,000 | Run a finished answer through analyzers that score and annotate it | What does an analyzer return? · Where does the audit show? · How do you add your own analyzer? | The auditor after a generator; a custom analyzer | Keep |

All eight: FIX-2703. Sources: `patterns/parallelTasks`, `patterns/supervisor`, `patterns/plan-and-execute`, `patterns/debate`, `patterns/round-robin`, `patterns/routed-specialists`, `patterns/event-actors`, `patterns/response-auditor`.

### K-28 · Goal-seek loop

`catalog/patterns/goal-seek-loop` · catalog · 1,000 words

**Job.** Re-drain a board until a judge says the goal is reached, or a budget runs out.
**Contents.** The loop · Writing a judge · Use it · How the patterns map onto it.
**Questions.** (1) What two things can end the loop? (2) What does the judge see? (3) Which shipped patterns are this loop underneath?
**Figures.** *The loop*: produce work, drain, judge, repeat. Marks: arrow, dashed outline on one pass, hatching on the board, highlighter on the judge.
**Examples.** `goalSeekLoop` with a judge.
**Sources.** `orchestration/goal-seek-loop` (keep).

### K-29 · Tools

`catalog/tools/` · catalog · 500 words

**Job.** The tool blocks that ship, in one table, and how any of them reaches a generator.
**Contents.** What ships · Giving one to a generator · Provider keys.
**Questions.** (1) How does a generator get web search? (2) Which tools need a provider key? (3) Is a shipped tool different from a block you write?
**Figures.** None. **Examples.** `tools: [search, fetch]`.
**Sources.** `tools/overview` (keep).

### K-30 to K-35 · The tool pages

Each: `catalog/tools/<name>` · catalog · kit template without slots. Provider and option tables →
`reference/tools`.

| Id | Page | Words | Job | Cold-read questions | Figures | Examples | Source verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| K-30 | Search | 600 | Web search across providers behind one interface | Which provider is used when you name none? · How do you restrict domains? · What comes back? | None | `search` in `tools`; a domain filter | Keep |
| K-31 | Fetch | 500 | One page as clean Markdown | What happens with no provider key? · What comes back on a failed fetch? · How does it pair with search? | None | `fetch` in `tools` | Keep |
| K-32 | Crawl | 600 | Follow links from a root URL and return each page | How do you bound a crawl? · Which URLs are followed? · When should you use a provider instead of the built-in crawler? | None | `crawl` with a pattern | Keep |
| K-33 | MCP tools | 500 | Connect an MCP server and give its tools to a generator | How do you turn one tool off for a turn? · What helps the model pick the right tool? · Where is the server configured? | None | An MCP server in `tools` | Keep |
| K-34 | Bash | 1,100 | Run shell commands in a sandbox whose files persist | Where do files written by a command go after the request? · What can the sandbox reach? · Which line gives a generator the tool? | *Sandbox and store*: the sandbox for one run, the files kept. Marks: dashed outline on the sandbox, hatching on the stored files, arrow (`SYNCS`) | `createBashCapability` in `uses` | Keep, trim |
| K-35 | Workspace | 1,000 | Move files between stored collections and the place an agent works | Two runs change one file: what happens? · What does the flush report say? · When do you reach for this over Bash? | *Stored files, working files*: two columns and the sync between. Marks: hatching, arrow, red on a conflict | Projecting a collection to disk; writing one file | Keep, trim |

All six: FIX-2703. Sources: `tools/search`, `tools/fetch`, `tools/crawl`, `tools/mcp`, `tools/bash`, `tools/workspace`.

### K-36 · Memory

`catalog/memory/` · catalog · 900 words

**Job.** Give an agent something to hold onto between turns: four optional tiers behind one capability.
**Contents.** What memory is · Install it · Use it · The four tiers · Where it lives.
**Questions.** (1) What line gives a generator memory? (2) Which tier holds a fact about the user, and which a past conversation? (3) Whose memory is it?
**Figures.** *Four tiers*: working, episodic, semantic, digest, by how long each holds something. Marks: columns, dashed outline on working memory, hatching on the stored tiers.
**Examples.** `createMemoryCapability` in `uses`.
**Links to, does not explain.** Every option → `reference/memory`.
**Sources.** `memory/overview` (keep) · `memory/configuration` (to Reference).

### K-37 to K-39 · Memory sub-pages

| Id | Page | Slug | Words | Job | Cold-read questions | Figures | Examples | Source verdict |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| K-37 | Memory relations | `catalog/memory/relations` | 600 | Store connections between things, for questions about how they relate | When are facts alone not enough? · What does it cost? · Who sets the vocabulary? | *Facts and connections*: three subjects and the links between them. Marks: arrow (`RELATES TO`), hatching | Turning it on; a connection question | Keep |
| K-38 | The recall tool | `catalog/memory/recall-tool` | 700 | What the model calls when the always-on memory view is not enough | When does the model reach for it? · How are results ranked? · Tool or automatic context: which for a rare lookup? | None | The tool on a generator | Keep |
| K-39 | Memory hygiene | `catalog/memory/hygiene` | 700 | Keep a long-lived store useful: old and stale memories lose out | What happens to a fact from eighteen months ago? · How do you turn it off? · What can an operator see? | None | The default; calling the janitor | Keep |

All three: FIX-2703. Sources: `memory/relations`, `memory/recall-tool`, `memory/hygiene`.

### K-40 · UI

`catalog/ui/` · catalog · 800 words

**Job.** Components for chat and agent screens, copied into your project so you own them.
**Contents.** How you get them · What is in the box · Theming · With your flows.
**Questions.** (1) After installing a component, where does its code live? (2) How do you theme them? (3) Which components know about a flow's session?
**Figures.** *Yours after install*: the registry on one side, your `src/` on the other, the component copied across. Marks: arrow (`COPIES INTO`), highlighter on your copy.
**Examples.** The install command · one component on a page.
**Links to, does not explain.** Every component's props → `reference/ui-components`.
**Sources.** `ui/overview` (keep) · `ui/common-components`, `ui/flow-aware-components` (to Reference).

### K-41 · Generative UI

`catalog/ui/generative` · catalog · 800 words

**Job.** Let the model answer with a component: a tool that emits the shape and a renderer that draws it.
**Contents.** A shape is a tool and a renderer · Set it up · Pick a tighter set · Your own shapes.
**Questions.** (1) Which two things travel together for one shape? (2) How do you limit what the model can emit? (3) Where does your own renderer go?
**Figures.** *From tool call to component*: the model's call, the item it emits, the renderer on the page. Marks: arrow (`EMITS`, `RENDERS`), dashed outline on the run.
**Examples.** The starter pack on a generator · the renderers on a page.
**Sources.** `ui/generative` (keep).

### K-42 · Skills

`catalog/skills` · catalog · 1,400 words

**Job.** Markdown playbooks an agent loads when a task calls for them.
**Contents.** What a skill is · Skill or capability? · Install it · Use it (a skills folder; how a skill activates; binding skills to one generator) · Change it.
**Questions.** (1) What is in a skill's folder? (2) Name the two ways a skill activates. (3) Only the main agent should load skills: how? (4) Skill or capability: a checklist for writing release notes?
**Figures.** *A skill activating*: a message, the match, the skill's body joining the prompt for that turn. Marks: arrow, dashed outline on the turn, highlighter on the match.
**Examples.** A `SKILL.md` · `createSkillsLibrary` · `createSkillsCapability` in `uses`.
**Links to, does not explain.** The file format and every option → `reference/skill-md`. Routing with an evaluator → B-23.
**Sources.** `skills/overview`, `skills/binding`, `skills/activation` (one library page) · `guides/adding-skills-to-your-app` (merge) · `skills/authoring` (to Reference).

### K-43 · Voice

`catalog/voice` · catalog · 900 words

**Job.** Speech in and audio out on a flow that already streams text.
**Contents.** What you need · Install it · Use it (server; flow; page) · Change it (your own provider).
**Questions.** (1) Does a flow that does not opt in change? (2) What does the page use to record and play? (3) Where does transcription happen?
**Figures.** *Voice around a text flow*: speech to text, the unchanged flow, text to speech. Marks: arrow (`THEN`), highlighter on the unchanged flow.
**Examples.** The server setting · the flow setting · `useVoice`.
**Links to, does not explain.** Providers, endpoints, content types → `reference/voice`.
**Sources.** `advanced/voice` (keep; trim upgrade notes).
