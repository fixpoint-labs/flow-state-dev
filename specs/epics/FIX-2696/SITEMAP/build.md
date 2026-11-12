# Sitemap · Build

[Index](README.md) · [Start](start.md) · [Concepts](concepts.md) · [Catalog](catalog.md) · **Build** · [Reference](reference.md)

Thirty-seven pages: six tutorials (type `tutorial`, 2,500 words at most) and thirty-one recipes
(type `recipe`, 800 at most). All are written by **FIX-2704**, which consolidates today's guides
with `polish-docs`. B-04 and B-05 wait on the kits release.

A tutorial ends with something running, and every step ends with something the reader can see.
A recipe is a task-shaped title, numbered steps and the finished code; its contents line below
lists the steps. Recipes explain nothing: each links to the concept that does.

---

## Tutorials

### B-01 · Your first flow

`build/your-first-flow` · tutorial · 2,200 words

**Job.** Write a small chat flow from nothing: a handler, a generator, a two-step sequence, exposed as an action, with a test. The one home of the hello-chat app.

**Contents.** What you will build · 1 Start a project (the layout) · 2 A generator that answers · 3 Run it from the terminal · 4 Add a step before it · 5 Keep a count in session state · 6 Put it on a page · 7 Test it · Where to go next

**After finishing, the reader can answer**
1. Which file would you open to change what the model is told?
2. What does `fsdev run` show you that the page does not?
3. Where does the message count live between two messages?
4. What stands in for the model in the test?

**Figures**
- *What you build*. The finished flow: two blocks, one action, one session. Adds the target before the steps. Marks: arrow (`PASSES ITS OUTPUT`), hatching on the session, dashed outline on the action run.
- *Where each file goes*. The example-app layout with the tutorial's five files placed in it (redraw of the published `first-flow-homes.svg`). Marks: box in a box, highlighter on `flow.ts`.

**Examples.** One per step: `generator` · `fsdev run` · `handler`, `sequencer().step()` · session state on the flow · `FlowProvider`, `useSession` · `testFlow`.

**Links to, does not explain.** Blocks → C-02. Composition → C-04. State → C-07. The route file → S-5.

**Sources.** `getting-started/your-first-flow` (keep as the one tutorial) · `getting-started/project-structure` (merge) · `guides/building-a-chat-app` (merge; keep the tests step) · `getting-started/quick-start` (the terminal run).

### B-02 · Build a research team

`build/research-team` · tutorial · 1,500 words

**Job.** Build the board from C-21 with real models, then let the list of competitors arrive at run time.

**Contents.** What you will build · 1 Two blocks: analyst and writer · 2 A board with four tasks · 3 Run it and read the result · 4 Let a planner write the tasks · 5 When one analyst fails · Where to go next

**After finishing, the reader can answer**
1. How does the writer get the three analysts' output?
2. What changes when the tasks come from a planner instead of a list?
3. One analyst fails. What does the user get?

**Figures**
- *The board at three moments*: reuses C-21's second figure with this tutorial's task names.

**Examples.** `generator` ×2 · `taskBoard` · `fsdev run` · a planner step feeding the board · reading the stop reason.

**Links to, does not explain.** Boards → C-21. Stop reasons → `reference/task-board`. Patterns that do this for you → K-19.

**Sources.** `guides/building-a-research-team` (keep as a tutorial).

### B-03 · Put a human in the loop

`build/human-in-the-loop` · tutorial · 2,300 words

**Job.** Build an approval gate end to end. The one home for how to build approvals.

**Contents.** What you will build · 1 A flow that proposes a refund · 2 Pause for a decision · 3 Show what is waiting · 4 Approve or reject from the page · 5 Resume, and what runs again · 6 Survive a restart · 7 Let a model or a router ask too · Where to go next

**After finishing, the reader can answer**
1. Where is the run between the pause and the approval?
2. What does the approver's page read to list what is waiting?
3. After approval, which blocks run again?
4. What must be configured for the wait to survive a deploy?

**Figures**
- *The gate*: reuses C-15's first figure with the refund example.
- *Two screens*: the requester's page and the approver's page, and the one paused run between them. Marks: columns, arrow, hatching on the paused run, highlighter on the approver's button.

**Examples.** `ctx.suspend()` · `useSuspensions` · `useApproval` · a persistent store in `stores` · suspending from a generator's tool.

**Links to, does not explain.** The idea → C-15. Every rule → `reference/durable-execution`.

**Sources.** `guides/human-in-the-loop` (keep; canonical for approvals) · `advanced/generator-and-router-suspend-resume` (merge).

### B-04 · Write a kit

`build/write-a-kit` · tutorial · 2,200 words

**Job.** Package a feature as a kit, open a slot, fill another kit's slot, and publish it to npm.

**Contents.** What you will build · 1 A flow worth sharing · 2 Wrap it in a kit · 3 Take config · 4 Open a slot · 5 Fill a slot another kit opened · 6 Serve a view for screens · 7 Install it in an app · 8 Publish it · Where to go next

**After finishing, the reader can answer**
1. What does a kit's install return?
2. How does another kit add to yours without you knowing about it?
3. What does an app write to use your kit?
4. How does someone else get your kit?

**Figures**
- *Before and after*: the feature as loose flows in one app, then as one kit line in two apps. Marks: box in a box, arrow (`INSTALLS`), highlighter on the one line.
- *Your kit in the chain*: reuses C-12's chain with the tutorial's kit added.

**Examples.** `defineKit({ name, config, install })` · `slot.keyed` · `requires`, `contributes` · `defineView` · `createFlowState({ kits })` · the package's `exports`.

**Links to, does not explain.** Kits and slots → C-12. Every option → `reference/kits`. The community shelf → K-18.

**Sources.** New. The exported kit surface, its doc comments and tests · `goals/kits/`.

**Unsettled.** Written against `defineKit` as merged; reconciled at FIX-2705. Publishing is plain npm (O1).

### B-05 · Ship a starter of your own

`build/ship-a-starter` · tutorial · 1,800 words

**Job.** Turn an app you built into a starter others can run and reshape.

**Contents.** What you will build · 1 What makes an app a starter · 2 Put the team in files · 3 Write the README a newcomer needs · 4 Add the agent instructions and skills · 5 Check it from a clean machine · 6 Share it · Where to go next

**After finishing, the reader can answer**
1. What does a starter contain besides code?
2. What should the README list that is not wired yet?
3. How do you check that a stranger can run it?

**Figures**
- *From your app to theirs*: your repo, the starter, a new user's copy. Marks: columns, arrow (`BECOMES`).

**Examples.** The starter's `fsdev.config.ts` · its `workforce/` folder · its agent instructions file.

**Links to, does not explain.** Starters → K-02 to K-04. Kits → C-12.

**Sources.** New. The starters' READMEs and `examples/`'s copy-out recipe.

**Unsettled.** How a starter is installed and shared (O2). The page's steps 5 and 6 depend on it; if no one-command install exists at cutover, the page ships after it.

### B-06 · Debug a run with the DevTool

`build/debug-a-run` · tutorial · 1,500 words

**Job.** A tour: follow one failing run from the session list to the block that failed.

**Contents.** What you will do · 1 Open the DevTool · 2 Find the run · 3 Read the items · 4 Open the block that failed · 5 Look at state and resources at that moment · 6 Resolve a paused run · Where to go next

**After finishing, the reader can answer**
1. Where do you see what a block received and returned?
2. How do you tell what the model was told?
3. A run is waiting on approval. Can you resolve it here?

**Figures**
- *The DevTool's panels* (annotated screenshot): sessions, items, block detail, state.

**Examples.** `fsdev dev` · the failing flow's two blocks · the fix.

**Links to, does not explain.** Items → C-06. Trace events → `reference/items`. CLI flags → `reference/cli`.

**Sources.** `devtool/overview`, `devtool/setup` (rewrite as one tour of about 1,500) · `guides/development-tips` (merge) · `streaming/trace-channel` (move to dev tools).

---

## Recipes

Each recipe: no cold-read set beyond the three questions listed, no figure unless one is
named, and its finished code as the last block. "Verdict" is the audit's.

### Deploy

**B-07 · Choose where to deploy** · `build/deploy` · 700 words
Steps: what your flows need from a host · long requests and streaming · where the store lives · pick one. Questions: Which host if a request can run ten minutes? · Does serverless change your flows? · What must persist outside the process? Figure: *Hosts by what they keep alive*, a three-row comparison; marks: dashed outline, hatching. Links: C-13, C-14, C-16. Source: `guides/deployment` (keep as the overview).

**B-08 · Deploy to Vercel** · `build/deploy/vercel` · 750 words
Steps: the adapter · the route · environment · streaming limits · deploy. Questions: Which handler do you use on Vercel? · What keeps a long stream open? · Where do keys go? Example: `createVercelNextHandler`. Links: `reference/runtime`, `reference/environment`. Source: `guides/deploying-to-vercel` (keep; cut kitchen-sink specifics).

**B-09 · Deploy to Railway** · `build/deploy/railway` · 600 words
Steps: a Node server · the store · environment · deploy. Questions: What starts the server? · Where does SQLite's file live? Example: the Node host call. Source: `guides/deploying-to-railway` (keep).

**B-10 · Deploy with Docker** · `build/deploy/docker` · 650 words
Steps: the Dockerfile · the store volume · run it. Questions: What must the image contain? · What do you mount? Example: the Dockerfile. Source: `guides/deploying-with-docker` (keep).

**B-11 · Deploy to AWS Lambda** · `build/deploy/aws-lambda` · 600 words
Steps: the handler · streaming · the store · deploy. Questions: What limits a streamed reply on Lambda? · Which store? Example: the Lambda handler. Source: `guides/deploying-to-aws-lambda` (keep).

### Start a flow from outside

**B-12 · Receive a Stripe webhook** · `build/webhooks/stripe` · 600 words
Steps: declare the binding · verify the signature · map the event to an action · test it. Questions: What refuses a forged event? · Which user does the run belong to? Example: `defineWebhookBinding`. Links: `reference/webhooks`, C-17. Source: `guides/webhooks-stripe` (keep; the model recipe).

**B-13 · Receive a GitHub webhook** · `build/webhooks/github` · 600 words · as B-12. Source: `guides/webhooks-github` (keep).

**B-14 · Receive Slack events** · `build/webhooks/slack` · 650 words · as B-12, plus the URL challenge. Source: `guides/webhooks-slack-events` (keep).

**B-15 · Run on a schedule with Vercel Cron** · `build/schedules/vercel-cron` · 650 words
Steps: declare the schedule · the cron entry · protect the endpoint · check a run. Questions: Who is the user of a scheduled run? · What stops a stranger calling the endpoint? Links: `reference/schedules`. Source: `guides/scheduled-vercel-cron` (keep).

**B-16 · Run on a schedule with Cloud Scheduler** · `build/schedules/cloud-scheduler` · 500 words · as B-15. Source: `guides/scheduled-cloud-scheduler` (keep).

**B-17 · Run on a schedule with EventBridge** · `build/schedules/eventbridge` · 500 words · as B-15. Source: `guides/scheduled-eventbridge` (keep).

**B-18 · Let users schedule work at run time** · `build/schedules/at-run-time` · 750 words
Steps: store a schedule as data · one tick that runs what is due · let a flow add or remove one. Questions: Where are user-made schedules kept? · What runs them? Links: `reference/schedules`. Source: `guides/scheduled-dynamic` (rewrite; half is Reference) · `server/schedule-index` (to Reference).

**B-19 · Run background jobs with BullMQ** · `build/background-jobs-bullmq` · 750 words
Steps: install the adapter · a worker process · send an action to the queue · watch it. Questions: What runs the job after the request returns? · What does the page see meanwhile? Figure: *Request, queue, worker*; marks: columns, arrow, dashed outline on the request, hatching on the queue. Links: C-16, `reference/background-work`. Source: `guides/background-jobs-bullmq` (keep).

**B-20 · Send errors to Sentry** · `build/errors-to-sentry` · 450 words
Steps: the hook · what to attach · check it. Questions: Which hook? · What identifies the run? Example: `onErrored`. Links: C-19, `reference/errors`. Source: `guides/routing-errors-to-sentry` (keep).

**B-28 · Run a flow from your own code** · `build/run-a-flow-from-code` · 600 words
Steps: get the flow · call an action without HTTP · read the items. Questions: When would you skip the HTTP layer? · What do you still have to supply? Links: C-05, `reference/flows`. Source: `advanced/manual-flow-execution` (keep; a basic task).

**B-29 · Chat with a flow from the terminal** · `build/chat-from-the-terminal` · 500 words
Steps: start a chat · continue a session · switch flows. Questions: How do you resume yesterday's session? Example: `fsdev chat`. Links: `reference/cli`. Source: `cli/interactive-chat` (keep).

**B-30 · Expose flows as an MCP server** · `build/mcp-server` · 700 words
Steps: turn it on · choose which actions are tools · connect a client · who the caller is. Questions: Which actions become tools? · How is the caller identified? Links: `reference/mcp-server`, C-17. Source: `server/mcp` (keep, trim).

### Build blocks and prompts

**B-21 · Write your own pattern** · `build/write-a-pattern` · 800 words
Steps: the plan, drain, reduce skeleton · wrap it in a factory · accept `uses` · test it. Questions: What does a pattern return? · Why a factory? Example: a `planMapReduce` factory over `taskBoard`. Links: C-21, K-19. Source: `guides/create-your-own-pattern` (keep).

**B-22 · Keep prompts in Markdown files** · `build/prompts-in-markdown` · 750 words
Steps: a prompt file · variables · load it on a generator · a resource template. Questions: Who can edit the prompt after this? · Where do variables come from? Links: `reference/markdown-templates`, C-03. Source: `guides/prompts-as-markdown` (keep) · `advanced/generator-prompts-markdown`, `advanced/resource-templates-markdown` (to Reference).

**B-23 · Route with an evaluator** · `build/route-with-an-evaluator` · 800 words
Steps: ask a typed question · route on the answer · send doubtful cases to a person. Questions: What does an evaluator return? · What happens to a doubtful case? Figure: *The routing tree*; marks: arrow, dashed arrow (`ONLY WHEN UNSURE`), highlighter on the hand-off. Example: `evaluator`, `router`. Links: C-04. Source: `guides/routing-with-evaluators` (keep).

**B-32 · Write a capability** · `build/write-a-capability` · 800 words
Steps: a tool, a context section, a resource · bundle them · presets · a factory for config. Questions: What does a block write to get all three? · How does a consumer turn the tools off? Example: `defineCapability`. Links: C-11, `reference/capabilities`. Source: `advanced/capabilities-authoring` (rewrite).

**B-33 · Benchmark patterns on your own tasks** · `build/benchmark-patterns` · 700 words
Steps: a task suite · run two patterns · read the table. Questions: What do you hold fixed? · What does the result compare? Example: `fsdev benchmark`. Links: K-19. Source: `testing/benchmarks` (keep).

### Work with data

**B-34 · Search a collection** · `build/search-a-collection` · 750 words
Steps: mark fields searchable · query from a block · give search to a model. Questions: What is searched? · Whose records come back? Links: C-08, `reference/resources`. Source: `resources/searching` (keep; cut migration notes).

**B-35 · Link records with edges** · `build/link-records` · 500 words
Steps: declare an edge · add one · follow it. Questions: What does an edge connect? Links: `reference/resources`. Source: `resources/edges` (keep).

**B-36 · Run a block when a resource changes** · `build/react-to-a-change` · 650 words
Steps: declare what to watch · the block that runs · what it must not do. Questions: What starts the block? · Does the writer wait for it? Links: C-08, C-16. Source: `resources/reactive-blocks` (keep).

**B-37 · Serve data your app already owns** · `build/serve-your-own-data` · 600 words
Steps: declare a read-only collection over your data · the read function · read it from a page. Questions: Where is the data stored? · What happens on each read? Links: C-08, C-09. Source: `resources/projected-collections` (keep).

**B-31 · Move data between stores** · `build/move-data-between-stores` · 700 words
Steps: what to move · export · import · check counts · switch. Questions: What is copied and what is not? · How do you know it worked? Links: C-14, `reference/stores`. Source: `persistence/overview` (the data-migration operations page).

**B-24 · Push live updates to the browser** · `build/live-updates` · 750 words
Steps: what changes without a request · subscribe on the page · scope it. Questions: Which hook follows a change? · Who receives it? Example: `useSubscription`. Links: C-06, C-10. Source: `guides/realtime` (keep).

### Use the DevTool

**B-25 · Embed the DevTool in your app** · `build/embed-the-devtool` · 500 words
Steps: install · mount the route · restrict it. Questions: Who can open it in production? Source: `devtool/embedding` (recipe).

**B-26 · See which resources a run loaded** · `build/see-resource-loads` · 500 words
Steps: open the run · the resources panel · read a load. Questions: Why did a resource not load? Links: C-08. Source: `devtool/observing-resource-loads` (recipe).

**B-27 · Compare server state with what the browser sees** · `build/server-state-and-browser-state` · 600 words
Steps: open both views · find the field · check what is exposed. Questions: A field is on the server and not on the page: why? Links: C-07, C-10. Source: `devtool/debug-vs-client-state` (recipe).

---

## Guides that do not become Build pages

| Today | Goes to |
| --- | --- |
| `guides/anatomy-of-a-flow` | S-1 and C-01 |
| `guides/building-agents` | C-03 |
| `guides/board-lifecycle` | C-21 |
| `guides/background-work`, `guides/keeping-a-flow-running` | C-16 (and C-13) |
| `guides/nextjs-setup` | S-5 |
| `guides/building-a-chat-app` | B-01 |
| `guides/development-tips` | S-3 and B-06 |
| `guides/adding-skills-to-your-app` | K-42 |
| `guides/choosing-patterns-with-benchmarks` | K-19 |
| `guides/projects-on-org-scope` | Cut; C-07 and C-17 cover organization-wide data |
| `guides/writing-ui-stories` | Contributor docs |
