# Sitemap · Start

[Index](README.md) · **Start** · [Concepts](concepts.md) · [Catalog](catalog.md) · [Build](build.md) · [Reference](reference.md)

Five pages, type `start`, 800 words of prose at most. All five are written by **FIX-2702**. The
cast for the section is the Teammates starter and its `researcher` worker.

**Unsettled, for the whole section.** How a starter is installed (O2). Until one command exists,
S-2 uses the clone path and says so. The kit factories in the config example are specified and not
built; FIX-2705 reconciles them (ER-8).

---

### S-1 · What Flow State is

`start/what-flow-state-is` · start · 650 words · piloted ([`pilot/what-flow-state-is.md`](../../../../docs/contributing/docs-revamp/pilot/what-flow-state-is.md))

**Job.** Say what the product is and what an app is made of, so the reader wants to run one.

**Contents.** (opening) · A starter is a whole app · A kit is a feature you install · Kits are made of flows and blocks · You build it with an agent · Where it stands · Next

**After reading, the reader can answer**
1. You want the researcher to cite sources differently. What do you edit, and in which language?
2. What do you add to an app to give it a feature somebody else built?
3. Name the layers of an app from the top down. Which one do you have to understand to run a starter?
4. Where do the code and the data live?

**Figures**
- *What an app is made of* (drawn: `pilot/figures/layers.svg`). Five layers with the verb for each: run, install, call, write, runs them. Adds the whole stack at once and the direction in which one kit fills another's slot. Marks: layer boxes, arrow (`FILLS A SLOT`), highlighter on Kits.

**Examples**
- A worker is a file: `WORKER.md` for `researcher`.
- An app lists its kits: `createFlowState({ kits })` in `fsdev.config.ts`.
- A pipeline handed to a model as one tool: `sequencer().step()` inside `generator({ tools })`.
- A flow runs from a terminal: `fsdev run`.

**Links to, does not explain.** Slots → C-12. The five block kinds → C-02. The terminal loop → S-4.

**Sources.** `docs/intro` (rewrite) · `fundamentals/overview` (merge) · `guides/anatomy-of-a-flow` (merge, with C-01).

**To fix at FIX-2702.** The pilot explains slot stacking, which the model pilot flagged as too deep for a first page; cut it to one sentence and link C-12. Its link to `./how-it-fits-together.md` becomes `../concepts/how-it-fits-together`.

---

### S-2 · Run a starter

`start/run-a-starter` · start · 600 words

**Job.** A working team in a browser tab in ten minutes, with one API key.

**Contents.** (opening: a screenshot of the running app) · What you need · Get the starter · Add your model key · Run it · Talk to a worker · What you are looking at · Next

**After reading, the reader can answer**
1. What two things do you need before you start?
2. The app starts but a worker does not answer. Where does the page tell you to look first?
3. Which folder holds the workers you just talked to?
4. Is anything stored between restarts, and where?

**Figures**
- *The running app*, a screenshot, not a drawing: the worker list, one conversation, one answer streaming. Adds proof that there is an app at the end of the page.
- *What just started*. Three columns: your browser, the app's server process, your store. Adds where the pieces run and that the conversation is kept. Marks: columns, arrow (`CALLS · STREAMS BACK`), hatching on the store.

**Examples**
- Get and run the starter: the install command (unsettled, O2) and `fsdev dev`.
- Set the key: `.env` with the provider key.
- The file behind the worker you talked to: `WORKER.md`.

**Links to, does not explain.** Model setup beyond one key → C-18 and `reference/models`. Store choice → C-14. Environment variables → `reference/environment`.

**Sources.** `getting-started/installation` (merge) · `getting-started/setting-up-models` (key setup only) · `getting-started/quick-start` (rewrite) · the Teammates starter's README.

**Unsettled.** The install command (O2). The screenshot waits for the starter's final screens.

---

### S-3 · Make it yours

`start/make-it-yours` · start · 700 words

**Job.** Change the app three ways in ten minutes, and learn that it is files you own.

**Contents.** (opening) · Rewrite a worker's brief · Add a worker · Look underneath: run one flow from the terminal · Watch the same run in the DevTool · Next

**After reading, the reader can answer**
1. You rewrote a brief. What do you do to see the worker follow it?
2. How do you add a second worker to the team?
3. Which command runs one of the app's flows with no browser, and what does it print?
4. Where do you look to see every step a run took?

**Figures**
- *One change, three places to see it*. The edited `WORKER.md`, the terminal run, the DevTool trace, as three columns joined by arrows. Adds that the file, the run and the trace are the same thing seen three ways. Marks: columns, arrow (`RUNS · SHOWS`), dashed outline on the run (it lasts one action run), highlighter on the edited line.

**Examples**
- The brief, before and after: `WORKER.md`.
- A new worker folder: `workforce/teams/teammates/workers/<name>/WORKER.md`.
- Run a flow headless: `fsdev run <flow> <action> -i '{…}'`.
- Open the DevTool on the app: `fsdev dev`.

**Links to, does not explain.** `WORKER.md` settings → `reference/worker-md`. The DevTool's panels → B-06. What a flow is → C-05.

**Sources.** `cli/overview` (the run command) · `devtool/overview`, `devtool/setup` (the first look only) · `guides/development-tips` (merge) · `workforce/workers-on-disk` (the edit loop).

---

### S-4 · Build with your coding agent

`start/build-with-your-coding-agent` · start · 700 words

**Job.** Set up a coding agent so it can write a flow, run it, read what happened and fix it.

**Contents.** (opening) · Why this works here · Give your agent the docs · Give it the skills · Ask for a change and watch the loop · When it gets stuck · Next

**After reading, the reader can answer**
1. What does the agent run to check its own work, and what does it read back?
2. Which two things do you hand the agent before asking for a change?
3. The agent's flow fails. What does it look at to find the step that failed?
4. Does any of this need a browser or a running server?

**Figures**
- *The loop*. Four steps in a ring: write, run, read the events, fix. Adds that the loop closes without a person in it. Marks: arrow (`THEN`), dashed outline on the run, highlighter on "read the events".

**Examples**
- Point the agent at the docs: the `llms.txt` URL (FIX-2700).
- The run it uses: `fsdev run` with NDJSON output.
- Run one block alone: `fsdev block`.
- A prompt to try, and the diff it should produce.

**Links to, does not explain.** Every CLI flag → `reference/cli`. The event shapes → `reference/items`. Testing → C-20.

**Sources.** `cli/agent-dev-loop` (rewrite, minus monorepo paths) · `cli/overview`.

**Unsettled.** The skills pack and agent instructions file ship in each starter only once starters install outside the monorepo (O2). Until then the page names the skills and where they will be.

---

### S-5 · Add to an existing app

`start/add-to-an-existing-app` · start · 750 words

**Job.** The integrator's door: one flow serving inside a Next.js or Node app you already have.

**Contents.** (opening) · Install the packages · Write one flow · Serve it · Call it from a page · Common pitfalls · Next

**After reading, the reader can answer**
1. Which file serves your flows over HTTP in a Next.js app?
2. What must every call say about who is calling?
3. Your page shows nothing while the model answers. Which pitfall is that?
4. You have no Next.js app. What do you use instead?

**Figures**
- *Where the new files go*. Your existing app as one box with three new parts inside it: the flow, the route, the page. Adds exactly what is added and that nothing else moves. Marks: box in a box, highlighter on the three new files.

**Examples**
- One flow with one action: `defineFlow`, `generator`.
- The route: `createFlowState` and `createNextHandler`. This page is the one home of that snippet; every other page links here.
- The page: `FlowProvider`, `useSession`.
- The Node alternative, in two lines: `@flow-state-dev/node`.

**Links to, does not explain.** The server options → C-13 and `reference/runtime`. Auth → C-17. Hooks → C-10. Deploying → B-07.

**Sources.** `getting-started/existing-project` (keep, trim) · `guides/nextjs-setup` (merge; keep "Common pitfalls").
