---
sidebar_position: 4
sidebar_label: Delegation
---

# Delegating from a skill

A skill is usually just instructions: matched text spliced into the generator's system prompt. Sometimes one skill needs to hand pieces of its work to a small team — a research lead that farms out subtopics, an analyst that fans out per-item lookups. That's delegation.

A skill turns on delegation by declaring an `agents:` field in its frontmatter. An agent is a prompt-driven teammate: a persona defined right inside the skill, or one borrowed from a shared registry. When a bound skill declares agents, the skills library gives that generator a private task board, the `taskTools` for planning on it, and `runBoard` — a real drain over that board. The generator plans the work as tasks (this depends on that, these two can run at once) and runs the whole graph with one `runBoard` call. The board is how the work runs.

There are no per-agent tools the generator calls directly. All delegated work goes on the board and runs when the board drains.

Reach for delegation when a single agent isn't the right shape and you want the agent itself to stay in charge of the orchestration. If the graph is fixed in code (not planned by the model), a task board block in the generator's `tools:` is still the right shape — see [Running a board as a tool](#running-a-board-as-a-tool) below.

This page is the reference: every field, every override, every bound. For the authoring path end to end (declaring a team, staffing each seat, planning the graph, and what the failures look like), start with [Authoring a delegating skill](/guides/agents-command-the-board).

## Declaring agents

Add an `agents:` map to the skill's frontmatter. Each key is an agent name; each value is a spec that resolves to a runnable participant. Declaring the field is what turns delegation on — there's no separate flag to set for the default case. The binding can override it in either direction with `delegation: true` / `false`, covered in [Board and overrides](#board-and-overrides).

```yaml
---
description: Research a topic using a lead plus two specialists.
agents:
  researcher:
    prompt: You research assigned subtopics and report findings.
  writer:
    prompt: You synthesize findings into a short report.
---
You are the research lead. Plan the work on your board, then run it:
1. addTask one research task per subtopic — assignee: "researcher".
2. addTask a write-up — assignee: "writer", deps set to the research task ids.
3. Call runBoard once. Surface the writer task's output.
```

Each agent resolves one of two ways: it's defined inline in the skill, or it references an agent in the registry.

| Field | Behavior | Portable? |
|-------|----------|-----------|
| `prompt` | Inline persona body. `$ARGUMENTS` is substituted at activation. | Yes — ships inside the skill folder. |
| `prompt-ref` | Path to a Markdown persona file inside the skill folder. Loaded at activation. | Yes — ships inside the skill folder. |
| `agent-ref` | Name of a registered agent, resolved through the `agentRegistry` / `materializeAgent` pair passed to the library. | No — needs the app's agent registry. |

An inline agent (`prompt` or `prompt-ref`) is fully portable: a skill folder carries its own team with no app wiring beyond the tool catalog. An `agent-ref` agent resolves against the registry the app supplies, so it can't travel alone — the payoff is that one agent definition is reused across many skills. Agents materialize when the generator's tool surface resolves (per execution), so async resolution — a registry lookup, a prompt file read — is fine; a statically-bound skill with missing wiring (an `agent-ref` with no registry) still fails loud at build time.

Per-agent tuning on an inline agent: `tools` (catalog keys the agent may call itself — `taskTools` is a special key that gives the agent the task tools bound to the coordinator's board, which is how an agent fans out follow-up tasks mid-drain), `visibility` (`sub`, `primary`, or a `{ client, history }` mapping), and `model`. An `agent-ref` agent tunes through `agent-overrides` instead (replace-semantics for `tools` / `model` / `visibility`).

## Board and overrides

By default the delegation board is the generator's own **own-state** — a state container scoped to the one generator that installed it, never shared with or namespaced against any other block. The board is private: your tasks run against it, and nothing else can see it.

The `delegation` flag overrides the default install rule (install when the skill declares `agents:`) in either direction:

```ts
// Force it OFF even though the skill declares agents.
skills.with({ active: ["research-lead"], delegation: false });

// Force it ON even though the skill declares NO agents. The full surface
// installs, and the only worker is the default floor (see below).
skills.with({ active: ["triage"], delegation: true });
```

The delegation surface also injects a **guidance context** — a short capability-supplied prompt fragment that tells the model it has a board and a roster of agents, lists the current agents by name, and reminds it to assign tasks and drain. It means the skill body doesn't have to hand-write "how to delegate" boilerplate; it carries only skill-specific content (purpose, when to delegate, what "done" looks like). Turn it off with `guidance: false` if you'd rather write the orchestration instructions yourself:

```ts
skills.with({ active: ["research-lead"], guidance: false });
```

A skill that declares no `agents:` and does not set `delegation: true` installs none of this — no board, no `taskTools`, no `runBoard`, no guidance. Ordinary inline skills carry zero delegation overhead.

### How much work the board will take on

Every task is an agent turn, and every turn costs tokens. `concurrency` (fixed at 4 for the delegation board) only paces how many run at once, so the board carries two more bounds on how much work can be *created*:

- `maxEnqueuedTasks` (default 100) — how many tasks the coordinator may add while others are still waiting. It refreshes as the board drains.
- `maxTotalTasks` (default 500) — how many tasks the board may hold over its whole run, completed ones included. Draining does not give any back.

When a bound is reached, `addTask` returns a soft error rather than throwing, and the coordinator is expected to react:

```
addTask({ goal: "…" })  → { ok: false, error: "enqueued_task_cap_exceeded" }   // drain, then continue
addTask({ goal: "…" })  → { ok: false, error: "total_task_cap_exceeded" }      // the run's ceiling
```

The recovery differs per error, and only one of them is recoverable by draining. `enqueued_task_cap_exceeded` measures pending work, so the loop the guidance already describes clears it: call `runBoard`, let the pending work drain, then add the next wave. `total_task_cap_exceeded` is the board's lifetime ceiling and counts every task it has ever held, so draining returns nothing — the coordinator has to finish the job within a smaller plan instead of retrying the same add.

That drain-then-continue loop assumes the pending work can run. It cannot always: a task stranded behind a failed dependency stays `pending`, holds its enqueue slot, and is exactly why `runBoard` came back `blocked`. Draining again frees nothing, so a coordinator that sees `blocked` alongside a refused `addTask` has to cancel or replan the stranded tasks rather than repeat the drain.

One thing to be precise about. The enqueue bound applies **when a task is created**. Tasks also come back to `pending` on their own — a retry, an unblock, a resumed review, a reclaimed lease — and those are not bounded, so the pending count can sit above the number for a while. The hard ceiling is `maxTotalTasks`.

The counts are read off the board's task ledger rather than kept as a separate tally, so they last as long as that ledger does. A delegation board lives on the coordinator generator's own state, and a generator's own state is rebuilt from its schema every time the block is entered — checkpointing is a sequencer thing. So a suspended run that resumes comes back to an empty board: the tasks are gone, and the counts start from zero. Don't treat a resumed coordinator as one that remembers what it already planned. See [how long the counts last](../orchestration/task-board#how-long-the-counts-last) for the full picture across backings.

Both are tunable on the library, beside `workerModelId`:

```ts
const skills = createSkillsLibrary({
  catalog,
  initialSkills,
  maxTotalTasks: 2_000,
  maxEnqueuedTasks: null, // explicitly unbounded on this axis
});
```

`null` is the opt-out. Omitting an option is not — it reapplies the default.

One boundary worth knowing, because it is easy to assume otherwise. The bounds come from the code that *builds* the board's task collection. Binding a delegating skill does that for you, so those boards are bounded. Wiring the `taskTools` capability by hand — `uses: [taskTools]` on a generator, outside a skill binding — does not: it reaches the generator's own-state board through a plain collection with no bounds at all, and `addTask` there is unbounded.

This is the same path that also has no roster to validate assignees against, so it is worth saying once: the hand-wired capability has **neither** guard. Both come from the skills binding, which is what constructs the board and knows the declared agents. That is intentional rather than an oversight — a capability wired by hand has nowhere to put either — but it means "delegation is bounded and checks assignees" is not a claim about `taskTools` on its own. If you want a bound on that path, build the collection yourself and hand the capability a resolver for it:

Two details make or break this, and both come from where the resolver runs. Each task tool executes as a *child* of the generator, so the generator's own state is `ctx.parent`, not `ctx.sequencer` — `ctx.sequencer` is the enclosing sequencer, which is a different container and often absent entirely. And the resolver has to name the same `stateKey` the board lives under, or it quietly reads and writes a different slot. Mirror the shipped `defaultOwnStateResolver`:

```ts
import {
  createTaskToolsCapability,
  DELEGATION_BOARD_FIELD,
  delegationBoardSchema,
  getOrCreateTaskCollection,
} from "@flow-state-dev/orchestration";

const bounded = (ctx) =>
  getOrCreateTaskCollection({
    ctx,
    backing: "sequencer",
    // The HOST generator's own state. Each tool runs as a child block, so the
    // generator's state is `ctx.parent` — `ctx.sequencer` is the per-call scope.
    sequencer: ctx.parent,
    stateKey: DELEGATION_BOARD_FIELD,
    collectionId: DELEGATION_BOARD_FIELD,
    maxEnqueuedTasks: 25,
  });

generator({
  // Declare the slot the resolver targets. The skills binding does this for
  // you; wiring the capability by hand means declaring it yourself.
  stateSchema: z.object({ [DELEGATION_BOARD_FIELD]: delegationBoardSchema }),
  uses: [createTaskToolsCapability(bounded)],
});
```

## Default worker (the floor)

Every delegation board has a **default worker** — a floor beneath the roster. It is a generic, capable worker (no special persona, no tools) that runs any task the roster doesn't claim. When a task's `assignee` names a declared agent, that agent runs it. When the `assignee` is unset, the task runs on the default worker instead of erroring.

That gives you two ways to reach it:

- **Roster plus floor.** A skill declares some agents and also delegates a task with no assignee. The named agents run their tasks; the floor catches the unassigned ones.
- **No roster at all.** Turn delegation on with `delegation: true` and declare no `agents:`. Every task runs on the floor. This is delegation without hand-writing a roster first — you plan tasks and drain, and a capable worker handles each one.

```ts
// A rosterless coordinator: no agents declared, floor on.
const planner = generator({
  uses: [skills.with({ active: ["triage"], delegation: true })],
});
// addTask({ goal }) with no assignee runs on the default worker; runBoard drains it.
```

The floor is the same kind of worker a declared inline agent is, so a named agent is really a specialization on top of it. Named workers are unaffected: a declared assignee never touches the floor.

Note what the floor does *not* catch. Once a skill declares agents, an assignee that names none of them is rejected when the task is added, not quietly run on the floor (see below). So the floor is reached by leaving the assignee unset, which is a deliberate "anyone can do this" — not by mistyping a specialist's name, which is a mistake worth hearing about. A board with no declared agents has no roster to check against, so it accepts any assignee and everything lands on the floor.

## What the coordinator gets

Two things land on the generator when an agent-declaring skill is active: the tools to plan work on the board, and the tool to run it.

**`taskTools` — the planning ledger.** Eight tools let the generator plan and steer multi-step work on its private board.

How they report a problem is uniform across the eight. Each returns `{ ok: true }` or `{ ok: false, error }`, so a bad call is a tool result the generator can read and correct. That covers a missing board (`no_delegation_board`), an unknown id (`task_not_found`), an assignee who isn't on the roster, a creation bound, and a status change the task's current status doesn't permit. The last of those is covered in full below. `cancelTask` against a task that already finished isn't a failure at all: it's a no-op that answers `{ ok: true }`.

| Tool | Input | What it does |
|------|-------|--------------|
| `addTask` | `goal`, plus optional `assignee`, `deps`, `input`, `priority`, `metadata` | Creates a task and returns its id. `assignee` is an agent key — leave it unset to run on the default worker. `deps` are task ids that must complete first. `input` is a structured payload handed to the worker. |
| `assignTask` | `taskId`, `assignee` | Reassigns an existing task to a different worker. |
| `completeTask` | `taskId`, `output` | Marks a task complete and records its output. |
| `failTask` | `taskId`, `error` | Marks a task failed with an error message. Its dependents stay `pending` — nothing cascades. |
| `blockTask` | `taskId`, optional `reason` | Marks a task as waiting on an external condition. The board stops treating it as runnable, so `runBoard` reports `blocked`. **One-way** — no task tool moves it back (see below). |
| `cancelTask` | `taskId`, optional `reason` | Cancels a task. Terminal — use it when the work is no longer needed. |
| `updateTask` | `taskId`, `patch` | Patches mutable fields: `priority`, `metadata`, `assignee`, `addLabel`, `removeLabel`. All optional; a patch that omits `assignee` skips the roster check. |
| `listTasks` | optional `status`, optional `assignee` | Reads the board back, filtered. `status` is one of `pending`, `in_progress`, `awaiting_review`, `completed`, `errored`, `cancelled`, `blocked`. |

Most skills only need `addTask` and `runBoard`. The rest matter when the coordinator has to steer a board mid-flight — cancelling a plan that turned out to be wrong, or reading back what settled.

**`blockTask` does not pause a task you can later resume.** The tool surface has no unblock: `updateTask` cannot change a status, and `failTask` on a blocked task comes back refused rather than releasing it, because tasks created through `addTask` carry no retry budget and `blocked → errored` is not a permitted transition. `cancelTask` is the only exit. Treat blocking as retiring a task with a reason recorded on it, not as parking one you intend to pick back up — if work needs to wait for something and then continue, keep it off the board until its precondition holds. (The underlying collection does have an unblock operation; it just isn't exposed to a coordinator.)

Assignment is checked as the task is created. `addTask`, `assignTask`, and `updateTask` reject an `assignee` that isn't one of the declared agents, and say which agents exist:

```
addTask({ goal: "Find sources", assignee: "reseacher" })
→ { ok: false,
    error: 'unknown_assignee: "reseacher" is not an agent on this board.
            Available: researcher (Researches sources), writer (Drafts prose).
            Name one of these exactly, or leave assignee unset to run the task
            on the default worker.' }
```

No task is created, so a typo can't sit on the board and surface much later as a failed task when you drain. The generator reads the error and re-issues the call with a real agent. The roster in that message is the same list the guidance context advertises and the same one the board dispatches from, so the three can't disagree.

Worth being precise about what a result buys you here, because it is easy to overstate. A tool that *throws* does not end the turn: the generator catches it and feeds the text back to the model, which can still recover. The difference is the shape and the quality of what arrives. A result is the contract every other tool on this surface already uses, and it carries what the model needs to act — which roster exists, which status the task is in, which calls are open. A throw arrives as a raw internal string that names what was rejected and nothing about what to do next.

When an `addTask` could fail more than one way, the checks run in a fixed order: no board, then an unknown assignee, then the creation bounds. The assignee is checked before the bounds deliberately. Naming a worker that doesn't exist is the more useful thing to hear, and a task rejected for a bad assignee never reaches the board — so a typo can't consume budget that a later, valid task needed.

Status changes come back the same way. A task only moves along the lifecycle the substrate allows, so a task still sitting `pending` can't jump straight to `completed` — nothing has started it. When a tool asks for a move the lifecycle refuses, the coordinator gets a result naming the status the task is actually in and the calls that would work from there:

```
completeTask({ taskId: "t_3", output: "…" })
→ { ok: false,
    taskId: "t_3",
    error: 'illegal_status_transition: task "t_3" is pending, so transitioning
            to completed is not available — a pending task has not been started
            yet. From here you can call blockTask or cancelTask.' }
```

Those are the calls this surface can make from that status, not every transition the substrate permits. The distinction matters: a `pending` task can legally reach `in_progress`, but no task tool moves it there, so listing it would point the model at an operation it doesn't have. A task already in a terminal status (`completed`, `errored`, `cancelled`) gets told that instead, with a suggestion to add a new task, because nothing will move it again.

Only a refused transition softens this way. Storage failures, concurrent-write conflicts, and ordinary bugs still throw. That line is deliberate — a real fault that came back as a polite `{ ok: false }` would read to the model as its own mistake, and it would narrate past a broken board. Driving a `TaskCollection` directly from your own code gets the throw in every case, including this one; see [the status state machine](../orchestration/task-substrate.md#the-status-state-machine).

**`runBoard` — the execution path.** One call drains the board: every runnable task is dispatched to its assigned agent — independent tasks in parallel, dependency-gated tasks once their deps complete — and the settled board comes back with each task's output. Task ids are generated and the drain claims pending tasks only, so plan-then-run again on the same board just executes the new tasks. An agent that declares `tools: [taskTools]` can enqueue more tasks mid-drain (a discoverer fanning out one analyzer per thing it found), and the drain keeps going until everything settles.

The division of labor to keep straight: `addTask` writes a task — it does not execute anything by itself. Execution happens when the generator calls `runBoard`, which drains the runnable graph. Draining the board is running it; there is no other path to executing a delegated agent. Nothing drains the board behind the model's back — the skill decides when to run it.

`runBoard` reports how the drain ended. `status: "drained"` means every task settled; `status: "blocked"` means at least one did not, counting any task left `pending`, `in_progress`, `awaiting_review`, or `blocked`. It is a statement about outstanding work, not about failure — an errored dependency and a task marked with `blockTask` both produce it, and terminal tasks do not, so a board whose only problem is one errored task still reports `drained`. A dependency counts as satisfied only when it `completed`, so a dependent of an errored task stays `pending` rather than being skipped or failed; `cascadeSkipDependents` is a `taskBoard` block the [supervisor](../patterns/supervisor) and [plan-and-execute](../patterns/plan-and-execute) patterns wire in, and it is not part of this drain. For how to tell the causes apart, see [When it goes wrong](/guides/agents-command-the-board#7-when-it-goes-wrong).

```ts
const skills = createSkillsLibrary({ catalog, initialSkills });

const researchLead = generator({
  uses: [skills.with({ active: ["research-lead"] })],
});
// Because "research-lead" declares `agents:`, delegation installs
// automatically. researchLead now has: addTask/assignTask/completeTask/...
// (taskTools), runBoard, and the guidance context — plus a board whose
// agent registry has one materialized worker per declared agent. There is
// no per-agent tool on the surface.
```

The board's `task-change` stream is client-visible (it drives live plan UIs) but stays out of the generator's LLM history — the tools' return values and `runBoard`'s settled summary already carry that signal.

## Running a board as a tool {#running-a-board-as-a-tool}

`runBoard` covers the model-planned case. When the graph is fixed in *code* — seeded `initialTasks`, a custom collection backing, a tuned dispatcher — build the board yourself and put it in the generator's `tools:`. A `taskBoard(...).drain` (or a `goalSeekLoop`) is a block, and any block can be a tool. The generator calls it once, the board drains internally under its own concurrency and dispatcher, and only the finalized result re-enters the generator's history.

Register the drain block in the skills `catalog` and list it under the skill's `allowed-tools`, exactly as you'd list `search` or `fetch`. See [Any block can be a tool](../fundamentals/blocks#any-block-can-be-a-tool) for the mechanism and [Using a goalSeekLoop as a tool](../orchestration/goal-seek-loop#using-a-goalseekloop-as-a-tool) for a worked example.

## Migrating from pattern mode

Pattern skills declared a `pattern:` factory, a `workers:` map coupled to it, an `initial-tasks:` graph, and a `pattern-config:` block, then handed control to a session-global dispatcher through `runSkill`. That whole surface is gone. A skill is inline instructions plus, optionally, an `agents:` field.

**Before** (pattern-mode SKILL.md):

```yaml
---
description: Research a topic using a lead plus two specialists.
context: pattern
pattern: task-board
workers:
  researcher: { prompt: "You research assigned subtopics." }
  writer: { prompt: "You synthesize findings into a report." }
pattern-config:
  concurrency: 2
---
When the user asks for research, the workers run on a task board.
```

**After** (the team survives as `agents:`, decoupled; the body plans and drains):

```yaml
---
description: Research a topic using a lead plus two specialists.
agents:
  researcher:
    prompt: You research assigned subtopics.
  writer:
    prompt: You synthesize findings into a report.
---
You are the research lead. Plan the work on your board, then run it:
1. addTask one research task per subtopic — assignee: "researcher".
2. addTask a write-up — assignee: "writer", deps set to the research task ids.
3. Call runBoard once. Surface the writer task's output.
```

```ts
// App wiring: no patternRegistry, no runSkill dispatch. Binding the skill
// through the library installs the board + taskTools + runBoard + guidance.
const skills = createSkillsLibrary({ catalog, initialSkills });
generator({ uses: [skills.with({ active: ["research-lead"] })] });
```

The `context: pattern` mode, the `pattern:` / `pattern-config:` / `initial-tasks:` fields, and the `runSkill`-driven dispatch are all removed. So are `workers:` and `block-ref` — both fail loudly at parse with a migration message pointing at `agents:` and `agent-ref`. `initial-tasks:` does not come back as data — the skill body instructs the generator to plan the tasks itself with `addTask` and execute them with `runBoard`. That is strictly more capable than the frozen YAML graph: the model sets the goals, fan-out, and dependencies per request.

## Where fork went

Fork mode (`context: fork`, a skill that ran as an isolated sub-agent) is also removed. The everyday case it served — run something as a sub-agent and get the result back — is now one task and a drain: declare an agent, `addTask` a single task assigned to it, and call `runBoard`. Read the task's output. The variant where a sub-agent inherits the conversation so far has shipped as a property of the agent rather than a resurrected direct-call path: set `context-supply: conversation` on an inline agent and it inherits the parent conversation up to the point it was dispatched, while its own steps stay out of the host's history. See [Context supply](../orchestration/context-supply).

## Related

- [Authoring a delegating skill](/guides/agents-command-the-board) — the guide: declaring the team, staffing each seat, planning the graph, draining it, and what the failures look like.
- [Building a research team](/guides/building-a-research-team) — the tutorial, code-first, with the two ways to staff an agent side by side.
- [Task board](../orchestration/task-board) — the concurrent-drain primitive the board is built on, and every config option.
- [Agents](../orchestration/agents) — the registry `agent-ref` resolves against.
- [Context supply](../orchestration/context-supply) — what prior conversation a delegated agent inherits.
- [Per-generator binding](./binding) — the `active` / `allowed` / `delegation` binding surface.
