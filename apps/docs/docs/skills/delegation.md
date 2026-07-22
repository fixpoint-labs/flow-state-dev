---
sidebar_position: 4
sidebar_label: Delegation
---

# Delegating from a skill

A skill is usually just instructions: matched text spliced into the generator's system prompt. Sometimes one skill needs to hand pieces of its work to a small team — a research lead that farms out subtopics, an analyst that fans out per-item lookups. That's delegation.

A skill turns on delegation by declaring an `agents:` field in its frontmatter. An agent is a prompt-driven teammate: a persona defined right inside the skill, or one borrowed from a shared registry. When a bound skill declares agents, the skills library gives that generator a private task board, the `taskTools` for planning on it, and `runBoard` — a real drain over that board. The generator plans the work as tasks (this depends on that, these two can run at once) and runs the whole graph with one `runBoard` call. The board is how the work runs.

There are no per-agent tools the generator calls directly. All delegated work goes on the board and runs when the board drains.

Reach for delegation when a single agent isn't the right shape and you want the agent itself to stay in charge of the orchestration. If the graph is fixed in code (not planned by the model), a task board block in the generator's `tools:` is still the right shape — see [Running a board as a tool](#running-a-board-as-a-tool) below.

## Declaring agents

Add an `agents:` map to the skill's frontmatter. Each key is an agent name; each value is a spec that resolves to a runnable participant. Declaring the field is the whole switch — there's no separate flag to set.

```yaml
---
description: Research a topic using a lead plus two specialists.
agents:
  researcher: { prompt: "You research assigned subtopics and report findings." }
  writer: { prompt: "You synthesize findings into a short report." }
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

Per-agent tuning on an inline agent: `tools` (catalog keys the agent may call itself — `taskTools` is a special key that gives the agent the task tools bound to the executive's board, which is how an agent fans out follow-up tasks mid-drain), `visibility` (`sub`, `primary`, or a `{ client, history }` mapping), and `model`. An `agent-ref` agent tunes through `agent-overrides` instead (replace-semantics for `tools` / `model` / `visibility`).

## Board and overrides

By default the delegation board is the generator's own **own-state** — a state container scoped to the one generator that installed it, never shared with or namespaced against any other block. The board is private: your tasks run against it, and nothing else can see it.

Force delegation off even though the skill declares agents:

```ts
skills.with({ active: ["research-lead"], delegation: false });
```

The delegation surface also injects a **guidance context** — a short capability-supplied prompt fragment that tells the model it has a board and a roster of agents, lists the current agents by name, and reminds it to assign tasks and drain. It means the skill body doesn't have to hand-write "how to delegate" boilerplate; it carries only skill-specific content (purpose, when to delegate, what "done" looks like). Turn it off with `guidance: false` if you'd rather write the orchestration instructions yourself:

```ts
skills.with({ active: ["research-lead"], guidance: false });
```

A skill that declares no `agents:` installs none of this — no board, no `taskTools`, no `runBoard`, no guidance. Ordinary inline skills carry zero delegation overhead.

## What the executive gets

Two things land on the generator when an agent-declaring skill is active: the tools to plan work on the board, and the tool to run it.

**`taskTools` — the planning ledger.** The eight task tools (`addTask`, `assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`, `updateTask`, `listTasks`) let the generator plan multi-step work on its private board. `addTask` takes a `goal`, an `assignee` (an agent key), `deps` (task ids that must complete first), and an optional structured `input` payload the agent receives.

**`runBoard` — the execution path.** One call drains the board: every runnable task is dispatched to its assigned agent — independent tasks in parallel, dependency-gated tasks once their deps complete — and the settled board comes back with each task's output. Task ids are generated and the drain claims pending tasks only, so plan-then-run again on the same board just executes the new tasks. An agent that declares `tools: [taskTools]` can enqueue more tasks mid-drain (a discoverer fanning out one analyzer per thing it found), and the drain keeps going until everything settles.

The division of labor to keep straight: `addTask` writes a task — it does not execute anything by itself. Execution happens when the generator calls `runBoard`, which drains the runnable graph. Draining the board is running it; there is no other path to executing a delegated agent. Nothing drains the board behind the model's back — the skill decides when to run it.

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
  researcher: { prompt: "You research assigned subtopics." }
  writer: { prompt: "You synthesize findings into a report." }
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

Fork mode (`context: fork`, a skill that ran as an isolated sub-agent) is also removed. The everyday case it served — run something as a sub-agent and get the result back — is now one task and a drain: declare an agent, `addTask` a single task assigned to it, and call `runBoard`. Read the task's output. The variant where a sub-agent inherits the conversation so far is a separate direction, tracked as a task context-supply mode rather than a resurrected direct-call path.
