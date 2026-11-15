# Notes: docs-revamp pilot pages (run a-opus)

## Deviation from the recipe, up front

The recipe says to dispatch the two checks per page as `model: "opus"` sub-agents. This session had
no sub-agent tool: no Agent or Task tool was loaded, and a ToolSearch for one found nothing. So I
ran both checks myself, in this context, as separate passes after the drafts were finished. That
cuts against the reason for the split:

- The **fact check** was not independent. The same reader who wrote the claims checked them.
- The **prose check** was not blind. `docs-editor` is meant to be as ignorant of the implementation
  as the reader. I had read the code and the kits spec, so I could not decline that context. I
  applied its checklist (the tells table and voice section in `docs/contributing/user-docs.md`) and
  its return format, but its main safeguard was missing.

I made one fold and ran no second round, as the recipe says.

## What I read

- Inputs: `RECIPE.md`, `EPIC.md`, `RECOMMENDATION.md`.
- Standard: `docs/contributing/user-docs.md`, `.claude/agents/docs-editor.md`, the glossary
  (`docs/contributing/glossary.mjs`: Worker, Assignee, Standard worker, Fork, Roster, Kit, Slot, View).
- Kits epic, the planned surface: `specs/epics/FIX-2618/SPEC.md`, `DECISIONS.md` (O1 and ER-5),
  `examples/kit.md`, `app-install.md`, `view.md`.
- Code: `packages/core/src/kit/define-kit.ts`, `packages/engine/src/flowstate/types.ts`
  (`kits`, `fill`, `root`, `flows` as a list), `packages/orchestration` (README; `task-board/index.ts`;
  `blocks/board-meta.ts` termination reasons; `tasks/schema/{task,task-init,task-status}.ts`;
  `tasks/workers/types.ts` `input.deps`; `tasks/collection/cascade.ts`; `tasks/claim-orders/fifo.ts`;
  lease and abandonment defaults in `tasks/collection/internal.ts`; the createTask schema in
  `skills/task-tools-capability.ts`), `packages/workforce` (`workers/hire-blocks.ts`,
  `workers/client.ts`, `workers/register.ts`, `workers/roster-view.ts`, `agent-worker-flow.ts`,
  `worker-door.ts`), `packages/client/src/types/index.ts` (SessionSummary), `packages/react` (`useView`),
  `packages/store-sqlite`, `packages/fsdev/README.md`.
- Changesets for this release: `kits-install-a-feature`, `flows-as-a-list`, `edit-any-worker`,
  `roster-view`, `use-view`, `views-at-scope`, `board-and-changes-views`, `orchestration-one-claim-order`,
  `stores-shorthand`.
- Today's site: `apps/docs/guides/board-lifecycle.md` and its SVG, `guides/building-agents.md`,
  `docs/orchestration/agents.md`, `docs/workforce/overview.md`, `docs/workforce/durable-hire.md`,
  `docs/advanced/durable-execution.md` (first lines), the `Figure` component, and the drawing classes
  in `labs/design-system/page.css`.
- `examples/README.md`, `examples/hello-chat`, the `goals/` listing.

Two things in today's site are out of date against the code, and I followed the code on both.
`durable-hire.md` says a standard worker can't be edited. `edit-any-worker` changed that: an edit
makes the user's own copy, and `reset` drops it. The orchestration README gives `"topological"` as the
default claim order, where the code (`task-board/index.ts:688`) defaults to `"fifo"`.

**Off-limits material:** none came up. I touched no other git ref, no other worktree, no other
scratchpad, and nothing named `docs-revamp`, `pilot-concept-doc` or `specs/epics/FIX-2696`. The
input `RECOMMENDATION.md` names FIX-2696 in its header. It is one of my given inputs, and I didn't
follow the reference.

## Figures

There is one per page, drawn with the `.drawing` classes from `page.css`: `figures/layers.svg`,
`figures/task-life.svg` and `figures/roster.svg`. I rendered each one in light and dark with the
Chromium at `/opt/pw-browsers` (`.render/render.py`; the PNGs are in `.render/`) and looked at every
render. Several rounds fixed overlapping labels, text running past box edges and one leader line
crossing a box. After the fold I renamed the board figure's "worker" labels to "assignee" or "claim"
and rendered it again.

## Fact check (claims against code, and against FIX-2618 for the planned surface)

Before the fold: **9 wrong or unsupported claims** (page 1: 3, page 2: 4, page 3: 2).

| # | Page:line | Claim | Finding |
|---|---|---|---|
| F1 | what-flow-state-is:49 | Harnesses filling the slot means "a workforce app gains a worker that writes code" | Unsupported. Harnesses contributes a coder worker *flow* through `workerFlows`, not a worker (`specs/epics/FIX-2618/DECISIONS.md:124`). A worker has to name it |
| F2 | what-flow-state-is:144 | An app's own flow "can read the same data" as the kits' flows | Unsupported and vague. Nothing guarantees it. The engine serves an app's flows beside a kit's (`engine/src/flowstate/types.ts`, `kits`) |
| F3 | what-flow-state-is:14 | The server "picks a run back up after a crash" | Holds only on a store that persists (`apps/docs/docs/advanced/durable-execution.md:11`). The same page says an app with no `stores` runs in memory |
| F4 | tasks-and-boards:14, 60, 62, 111 | Calls the blocks a board runs "workers" | Clashes with the glossary: Worker is the owned configuration, and what a board hands a task to is an Assignee (`docs/contributing/glossary.mjs:484-507`). It also contradicts the Workers page |
| F5 | tasks-and-boards:80 | Held "is how you file a plan for a person to look over" | Unsupported use. `held` only means "doesn't start until released" (`orchestration/src/tasks/schema/task-init.ts:60-66`) |
| F6 | tasks-and-boards:96-104 | The table of stop reasons, presented as the list | Incomplete. It leaves out `retry-budget-exhausted` (`task-board/blocks/board-meta.ts:205`) |
| F7 | tasks-and-boards:111 | "It doesn't let two workers run one task at the same time" | Overstated. A slow assignee can lose its lease while another claims the task. What the code guarantees is that the stale result is dropped (`orchestration/README.md:230-247`, `tasks/collection/internal.ts:1131`) |
| F8 | workers:94 | An edit reaches the worker's next turn "in every session" | Wrong when the edit changes `flow`. Earlier sessions stay on the old flow and refuse new messages (`apps/docs/docs/workforce/durable-hire.md`, "Changing or firing") |
| F9 | workers:100 | "The same four changes are blocks" | There are five blocks: hire, fork, edit, fire and reset (`workforce/src/workers/hire-blocks.ts:73-90`) |

Everything else checked out, line by line: API names, import paths, defaults (concurrency 4, fifo,
a two-minute lease, three abandonments), the cascade, holds and answers, the `getTask` wait, follow-ups and
retry, `hire`/`fork`/`edit`/`reset`/`fire` signatures and refusals, `RosterEntry` fields, `useView`
and `rosterView`, and `createFlowState({ kits, flows: [...], stores })`. Kits, workforce and
harnesses as kits, the `workforce/` folder and screens importing kit hooks are planned surface,
matched against FIX-2618 O1 and ER-5 and `examples/app-install.md`.

After the fold: **0 open** of the 9. F4 also changed the figure.

## Prose check (docs-editor checklist, not blind; see above)

**what-flow-state-is.md: SHIP.** Taste-level notes only:
- 43, mild design defense: "so a screen never assembles server data by hand" implies a before. Cut the clause.
- 49, an internal the reader can't observe: "Neither kit imports the other's internals." Cut.
- 12 and 92 are near counted openers ("Most agent frameworks…", "There are five kinds"). Kept: the
  count is the fact, since the set of kinds is closed.

**tasks-and-boards.md: REVISE.**
1. 14/60/62/111, term drift: "worker" for a board's block. A reader of the Workers page trips. Use "assignee".
2. 36, counted preamble: "## A board is two things". Name the two instead.
3. 74, counted preamble: "A task can wait on three kinds of thing". Cut the count.
4. 88, counted preamble: "A task ends in one of three statuses". Cut the count.
5. 62, mechanism as reassurance: claim renewal. Give the guarantee (a dead process's task is claimed again) and drop the renewal.
6. 76, triumphant closer: "The writer never starts on half the research." Cut.

**workers.md: REVISE.**
1. 31, counted preamble: "The difference shows in three places." Cut.
2. 60, counted preamble: "one of two kinds". Rewrite.
3. 66, diff tell: "One file still means…". Rewrite.
4. 96, diff tell: "every other user still gets the file". Drop "still".

No em-dashes, banned adjectives or "This"-led sentences turned up on any page.

## What changed in the fold

- **Page 1:** the harnesses sentence now says a worker can name the coding flow (F1), and the
  "internals" sentence is gone. "Can read the same data" became "is served beside the kits' flows"
  (F2). Crash recovery is qualified with "on a store that persists" (F3). The screens sentence lost
  its "never by hand" clause. The figure description was aligned with the drawing.
- **Page 2:** board blocks are "assignees" throughout, in prose, the figure and its description
  (F4, editor 1). The heading is now "Stored tasks and the drain", and the counted openers are gone.
  The lease mechanism became the guarantee. The closer is cut. The held sentence keeps only what
  held means (F5). `retry-budget-exhausted` joined the table (F6). The exclusivity bullet now states
  the real guarantee: one claim settles, and a late result is dropped (F7).
- **Page 3:** the counted openers and both "still"s are rewritten. Edit now says what happens when the flow
  changes (F8). The blocks line names all five (F9).

## Word counts (whole file, frontmatter and code included)

| Page | Draft | After fold |
|---|---|---|
| what-flow-state-is.md | 1,475 | 1,462 |
| tasks-and-boards.md | 1,436 | 1,430 |
| workers.md | 1,419 | 1,448 |

All three are under 1,500. Prose alone is lower, since code blocks and figure descriptions count here.

## Left for a person

- Page 1 links to pages that don't exist yet: `start/run-a-starter`, `kits-and-slots`,
  `generators-and-tools`. Page 2 links to `background-work`. They are the revamp's planned pages.
- The planned-surface code assumes the shapes in FIX-2618: `workforce({ model })` and `harnesses({})`
  imported from `@flow-state-dev/workforce` and `@flow-state-dev/harness-manager`. FIX-2627 owns
  their real shape. If the factory names or the config keys change, recheck both code blocks on page 1 and the
  folder path on pages 1 and 3.
- The glossary still lets the code's `taskBoard({ workers })` option clash with the published term
  "worker". The pages work around it by calling the entries assignees. RECOMMENDATION.md calls the
  rename a vocabulary decision.
