---
sidebar_position: 4
sidebar_label: Delegation
---

# Delegating from a skill

A skill is usually just instructions: matched text spliced into the generator's system prompt. Sometimes one skill needs to hand pieces of its work to sub-workers — a research lead that dispatches subtopics, an analyst that farms out per-item lookups. That's delegation.

A skill turns on delegation by declaring a `workers:` field in its frontmatter. When a bound skill declares workers, the skills library gives that generator a private task board, the `taskTools` for planning on it, one callable tool per worker, and `runBoard` — a real board drain over that ledger. The generator stays in charge: it calls a worker directly for one-shot work, or plans a graph of tasks and runs the whole thing under concurrency and dependency gating with a single `runBoard` call. The skill runs the board.

Reach for delegation when a single agent isn't the right shape and you want the agent itself to stay in charge of the orchestration. If the graph is fixed in code (not planned by the model), a task board block in the generator's `tools:` is still the right shape — see [Running a board as a tool](#running-a-board-as-a-tool) below.

## Declaring workers

Add a `workers:` map to the skill's frontmatter. Each key is a worker name; each value is a spec that resolves to a runnable sub-worker. Declaring the field is the whole switch — there's no separate flag to set.

```yaml
---
description: Research a topic using a lead plus two specialists.
context: inline
workers:
  researcher: { prompt: "You research assigned subtopics and report findings." }
  writer: { prompt: "You synthesize findings into a short report." }
---
You are the research lead. Hand each subtopic to the `researcher` tool, then
pass the collected findings to the `writer` tool and return its report.
```

Each worker has exactly one resolution field:

| Field | Behavior | Portable? |
|-------|----------|-----------|
| `prompt` | Inline prompt body. `$ARGUMENTS` is substituted at activation. | Yes — ships inside the skill folder. |
| `prompt-ref` | Path to a Markdown prompt file inside the skill folder. Loaded at activation. | Yes — ships inside the skill folder. |
| `block-ref` | Registry key into the `blocks` map passed to the library. The worker is custom app code. | No — needs an app-supplied registry. |
| `agent-ref` | Name of a registered agent, resolved through the `agentRegistry` / `materializeAgent` pair passed to the library. | No — needs the app's agent registry. |

`prompt` and `prompt-ref` workers are fully portable: a skill folder carries its own delegation behavior with no app wiring beyond the tool catalog. `block-ref` and `agent-ref` workers resolve against registries the app supplies, so they can't travel alone. Workers materialize when the generator's tool surface resolves (per execution), so async resolution — an agent registry lookup, a prompt file read — is fine; a statically-bound skill with missing wiring (an unknown `block-ref`, an `agent-ref` with no registry) still fails loud at build time.

One naming rule for `block-ref`: the direct-call tool registers under the block's own name, so the worker key and the block's name must match — a mismatch fails at materialization rather than pointing the model at a tool that doesn't exist.

Per-worker tuning: `tools` (catalog keys the worker may call — `taskTools` is a special key that gives the worker the task tools bound to the executive's board, which is how a worker fans out follow-up tasks mid-run), `visibility` (`sub`, `primary`, or a `{ client, history }` mapping), and `model`.

## Board and overrides

By default the delegation board is the generator's own **own-state** — a state container scoped to the one generator that installed it, never shared with or namespaced against any other block. The board is a private ledger: your worker calls run against it, and nothing else can see it.

Force delegation off even though the skill declares workers:

```ts
skills.with({ active: ["research-lead"], delegation: false });
```

The delegation surface also injects a **guidance context** — a short capability-supplied prompt fragment that tells the model it has a board and worker tools, and lists the current workers by name. It means the skill body doesn't have to hand-write "how to delegate" boilerplate; it carries only skill-specific content (purpose, when to delegate, what "done" looks like). Turn it off with `guidance: false` if you'd rather write the orchestration instructions yourself:

```ts
skills.with({ active: ["research-lead"], guidance: false });
```

A skill that declares no `workers:` installs none of this — no board, no `taskTools`, no worker tools, no guidance. Ordinary inline skills carry zero delegation overhead.

## What the executive gets

Three things land on the generator when a worker-declaring skill is active.

**Worker tools — the single-shot path.** Each worker key becomes a tool the generator can call. Calling `researcher("WebTransport adoption")` runs that worker to completion and returns its result inline, in one tool call. That is the everyday "run this as a sub-agent, hand me the result" case: one call, one result, no board choreography. Call a worker, read what it returns, decide what to do next.

**`taskTools` — the planning ledger.** The eight task tools (`addTask`, `assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`, `updateTask`, `listTasks`) let the generator plan multi-step work on its private board. `addTask` takes a `goal`, an `assignee` (a worker key), `deps` (task ids that must complete first), and an optional structured `input` payload the worker receives.

**`runBoard` — the execution path for a plan.** One call drains the board: every runnable task is dispatched to its assigned worker — independent tasks in parallel, dependency-gated tasks once their deps complete — and the settled board comes back with each task's output. Task ids are generated and the drain claims pending tasks only, so plan-then-run again on the same ledger just executes the new tasks. A worker that declares `tools: [taskTools]` can enqueue more tasks mid-run (a discoverer fanning out one analyzer per thing it found), and the drain keeps going until everything settles.

The division of labor to keep straight: `addTask` writes a ledger row — it does not execute anything by itself. Execution happens when the generator calls a worker tool (one task, inline result) or `runBoard` (the whole runnable graph). Nothing drains the board behind the model's back; the skill decides when to run it.

```ts
const skills = createSkillsLibrary({ catalog, initialSkills });

const researchLead = generator({
  uses: [skills.with({ active: ["research-lead"] })],
});
// Because "research-lead" declares `workers:`, delegation installs
// automatically. researchLead now has: addTask/assignTask/completeTask/...
// (taskTools), a `researcher` tool and a `writer` tool (each a materialized
// worker), runBoard, and the guidance context.
```

The board's `task-change` stream is client-visible (it drives live plan UIs) but stays out of the generator's LLM history — the tools' return values and `runBoard`'s settled summary already carry that signal.

## Running a board as a tool {#running-a-board-as-a-tool}

`runBoard` covers the model-planned case. When the graph is fixed in *code* — seeded `initialTasks`, a custom collection backing, a tuned dispatcher — build the board yourself and put it in the generator's `tools:`. A `taskBoard(...).drain` (or a `goalSeekLoop`) is a block, and any block can be a tool. The generator calls it once, the board drains internally under its own concurrency and dispatcher, and only the finalized result re-enters the generator's history.

Register the drain block in the skills `catalog` and list it under the skill's `allowed-tools`, exactly as you'd list `search` or `fetch`. See [Any block can be a tool](../fundamentals/blocks#any-block-can-be-a-tool) for the mechanism and [Using a goalSeekLoop as a tool](../orchestration/goal-seek-loop#using-a-goalseekloop-as-a-tool) for a worked example.

## Migrating from pattern mode

Pattern skills declared a `pattern:` factory, a `workers:` map coupled to it, an `initial-tasks:` graph, and a `pattern-config:` block, then handed control to a session-global dispatcher through `runSkill`. That whole surface is gone. A skill is inline instructions plus, optionally, a `workers:` field.

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

**After** (the `workers:` field survives, decoupled; the body drops the dispatch boilerplate):

```yaml
---
description: Research a topic using a lead plus two specialists.
context: inline
workers:
  researcher: { prompt: "You research assigned subtopics." }
  writer: { prompt: "You synthesize findings into a report." }
---
You are the research lead. Hand each subtopic to the `researcher` tool, then
pass the collected findings to the `writer` tool and return its report.
```

```ts
// App wiring: no patternRegistry, no runSkill dispatch. Binding the skill
// through the library installs the board + worker tools + guidance.
const skills = createSkillsLibrary({ catalog, initialSkills });
generator({ uses: [skills.with({ active: ["research-lead"] })] });
```

The `context: pattern` mode, the `pattern:` / `pattern-config:` / `initial-tasks:` fields, and the `runSkill`-driven dispatch are all removed. `initial-tasks:` does not come back as data — the skill body instructs the generator to plan the tasks itself with `addTask` and execute them with `runBoard`. That is strictly more capable than the frozen YAML graph: the model sets the goals, fan-out, and dependencies per request. A `pattern:` field left in a skill file now fails loudly at parse rather than being reinterpreted.

## Where fork went

Fork mode (`context: fork`, a skill that ran as an isolated sub-agent) is also removed. The everyday case it served — run something as a sub-agent and get the result back in one call — is exactly what calling a worker tool does now, so declare a worker (even a trivial single one) and call it. The variant where a sub-agent inherits the conversation so far is planned separately.
