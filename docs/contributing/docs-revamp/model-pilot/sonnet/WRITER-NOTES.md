# Notes

## Deviation from the recipe

The recipe says to dispatch two checks per page as sub-agents with `model: "opus"`, one of them the `docs-editor` agent. This session has no sub-agent tool and no way to name a model for one, so neither check was dispatched. I ran both myself, once, against the code and the style standard, and the counts below come from those self-runs. They are not independent checks by Opus agents, and a reviewer should treat them as weaker than that. The fold was done once, as the recipe says.

## What I read

- Inputs: `EPIC.md`, `RECOMMENDATION.md`, `RECIPE.md`.
- Kits spec: `specs/epics/FIX-2618/SPEC.md`, the O1 section of `DECISIONS.md`, `examples/kit.md`, `examples/app-install.md`.
- Voice and rules: `docs/contributing/user-docs.md`, the head of `writing-for-humans.md`, `.agents/subagents/docs-editor.md`, `docs/contributing/glossary.mjs` (worker, assignee, standard worker, fork, roster, kit, slot), the philosophy blog post for voice.
- Code: `packages/core/src/kit/define-kit.ts`, `packages/engine/src/flowstate/kits.ts`, `goals/kits` fixture, `packages/orchestration/src/tasks` (status machine, holds, task schema, lease comment), `task-board` (quiescence, defaults), `packages/workforce/src/workers/hire-blocks.ts`, `roster-flow.ts`, `agent-worker-flow.ts`, `workers/client.ts`.
- Today's site, for content and the drawing classes: `apps/docs/docs/orchestration/{overview,task-board,agents}.md`, `guides/board-lifecycle.md`, `docs/workforce/{overview,durable-hire,workers-on-disk}.md`, `docs/fundamentals/blocks.md`, `guides/building-agents.md`, `labs/design-system/page.css`, `src/components/Figure`, existing SVGs.
- `examples/hello-chat` and `examples/guides/research-team`.

## Figures

Three SVGs in `figures/`, drawn with the `.drawing` classes (`solid`, `thin`, `hi`, `ln`, `ln-dash`, `ground`, `plate`, `hl`, `x`, `lb`, `nm`, `sub`, `c`, `t`). Each was rendered with `chrome-headless-shell` from `/opt/pw-browsers` against `page.css`, in the light and dark themes, and looked at. Fixes from the first look: a label overflowing a box and a plate covering an arrowhead in the lifecycle drawing.

## Fact check (self-run)

Before the fold, three claims were wrong or unsupported:

1. "Each slot is filled once" (what-flow-state-is). Slots merge contributions from several kits, and only a duplicate key is refused. `define-kit.ts`, `kits.ts`.
2. "The Inbox lists every open question across the boards they filed to" (tasks-and-boards). Not supported as stated. The Inbox is a client over a task's holds (`orchestration/src/inbox`); the page now says a person answers from an inbox or by typing into the task's session.
3. "The server exposes each action as an endpoint" (what-flow-state-is). Flows also have internal actions. Reworded.

After the fold: 0 known.

Two things I could not check against code, because they are the planned surface and exist only in the spec:

- `workforce({ model })`, `harnesses({ claudeCode: {} })`, `workforce.slots.workerFlows`, the `workforce/` default folder and its scaffolding by the kit. `defineKit`, slots, `requires`, `contributes` and the folder claim pass are real (`core/src/kit`, `engine/src/flowstate/kits.ts`); the two kits are not.
- The board example's generators, which return text as the task output. The shape matches `examples/guides/research-team` and `orchestration/agents.md`, but there is no `node_modules` in this worktree, so no example was typechecked or run.

Conflict to flag for cleanup: `apps/docs/docs/workforce/durable-hire.md` says an edit of a standard worker is refused. The code (`workers/hire-blocks.ts`) copies it onto the user's roster under the same id, and a `reset` action removes the copy. The Workers page follows the code.

## Prose check (self-run against the tells table)

Before the fold, five findings:

1. Counted preamble, "A kit can have three things." (what-flow-state-is).
2. Counted preamble, "A task moves through six states." (tasks-and-boards), and "A board is two things" in the same page.
3. Design defense, "Naming the pieces for what they do keeps a flow readable as it grows."
4. "Package a feature for other apps to install" promises sharing, which the epic leaves open.
5. A five-row table outside Reference.

After the fold: 0. A grep for em dashes, "now", "no longer", "still", "This" openers, "deliberately", "honest" and issue numbers returns nothing in the prose. Verdict from my own read: SHIP. That is not the `docs-editor` verdict, which I could not obtain.

## What changed in the fold

- Reworded the slot sentence to merge-and-check.
- Replaced both counted preambles, dropped the design-defense sentence, turned the layer table into a list, and softened the sharing line.
- Dropped `requireUser: true` from the examples, since it is the default.
- Reworded the inbox sentence and the "no hidden layer" sentence.
- Workers: opened on "a name and a job, usually done by an agent", and changed one "still sees the file" to "keeps the file's version".
- Added "asked midway" to the lifecycle figure's waiting note.

## Word counts

what-flow-state-is 1,088 · tasks-and-boards 1,148 · workers 1,143, counted with `wc -w` over the whole file, front matter and code included.

## Off-limits material

None opened. `ls` of the scratchpad root listed the names of other agents' folders (I did not open any). `RECOMMENDATION.md` names the FIX-2696 epic in its own text; I did not read `specs/epics/FIX-2696`.
