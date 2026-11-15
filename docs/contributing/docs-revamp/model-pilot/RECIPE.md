# Recipe: write the three docs-revamp pilot pages

You are reproducing how an earlier session first wrote three pilot pages for the Flow State user-docs revamp. Work alone. Write the pages from scratch.

## Inputs, and the only things you may read
- `EPIC.md` and `RECOMMENDATION.md` in this folder: the epic's problem, its outcome and the docs audit.
- Your own worktree of the repo (current `main`): the code in `packages/`, `specs/epics/FIX-2618/` (the kits epic: the planned surface the pages describe), `docs/contributing/user-docs.md` (the voice standard), `docs/contributing/writing-for-humans.md`, `docs/philosophy.md`, `apps/docs/` (today's site and its figure/drawing CSS classes), `examples/`, `goals/`.
- **Off limits, to keep the run independent:**
  - any git ref other than your worktree's HEAD (no `git fetch`, no `git show <other-branch>`, no `git log --all`);
  - `/home/user/flow-state-dev/.claude/worktrees/` (other agents' checkouts);
  - every scratchpad folder except this one and your own output folder;
  - anything named `docs-revamp`, `pilot-concept-doc` or `specs/epics/FIX-2696`;
  - GitHub PRs and Linear.
  
  Those hold other versions of these pages. If you come across one, stop reading it and say so in your notes.

## The task
Write three pages for the docs that ship with the kits release (FIX-2618). The pages describe kits as the planned surface. Readers are engineers new to Flow State, and the story runs from the app down: you start with an app; the app is made of kits; kits are made of flows and blocks.
1. **What Flow State is**: the orientation page. An app, kits, flows and blocks, and which one you change.
2. **Tasks and boards**: tasks, the task board, and how work is claimed, run, waited on and ends.
3. **Workers**: what a worker is, how it differs from an agent, standard workers vs a user's own, and hiring, forking, editing and firing workers.

Each page is a Concepts page of 1,500 words or fewer.
- Each page has at most one figure, as an SVG drawn with the site's existing drawing classes so it fits the brand in light and dark themes. Render it with the headless Chromium at /opt/pw-browsers and look at it before you keep it.
- Code examples are short and use `openai/gpt-6-luna` as the model.

## The process (do exactly this, once)
1. Read the inputs and the code each page relies on. Draft all three pages and their figures.
2. Dispatch two checks per page as sub-agents, both with `model: "opus"`:
   - A **fact check**: every claim against the code and against `specs/epics/FIX-2618` for planned surface. It reports each wrong or unsupported claim with file:line.
   - A **prose check**: the `docs-editor` agent.
3. Fold their findings into the pages once. Don't run a second round.

## Output
Write into your output folder:
- `what-flow-state-is.md`, `tasks-and-boards.md`, `workers.md`
- `figures/*.svg`
- `NOTES.md`: what you read, the two check reports (fact counts, the editor's verdict), and what you changed in the fold.

Commit nothing, push nothing, and don't touch the repo outside your output folder.
