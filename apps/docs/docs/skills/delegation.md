---
sidebar_position: 4
sidebar_label: Delegation
---

# Delegating from a skill

A skill is usually just instructions: matched text spliced into the generator's system prompt. Sometimes one skill needs to hand pieces of its work to sub-workers — a research lead that dispatches subtopics, an analyst that farms out per-item lookups. That's delegation.

A skill turns on delegation by declaring a `workers:` field in its frontmatter. When a bound skill declares workers, the skills library gives that generator a private task board, the `taskTools` for tracking a plan, and one callable tool per worker. The generator's own tool-calling loop drives the work — it decides when to call a worker, reads the result, and moves on. There's no separate dispatch engine running underneath.

Reach for delegation when a single agent isn't the right shape and you want the agent itself to stay in charge of the orchestration. If the work is a fixed or dependency-ordered graph that should run under explicit concurrency, put a task board in the generator's tools instead — see [Running a board as a tool](#running-a-board-as-a-tool) below.

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

`prompt` and `prompt-ref` workers are fully portable: a skill folder carries its own delegation behavior with no app wiring beyond the tool catalog. `block-ref` workers resolve a string key against a `blocks` registry the app supplies, so they can't travel alone.

The `WorkerSpec` also has an `agent-ref` field (staffing a worker from a registered agent). Agent resolution is asynchronous, so `agent-ref` workers are not built by the delegation surface today — use a `prompt`/`prompt-ref` worker, or expose the agent as a `block-ref`. For a whole deterministic team (concurrency, dependencies), build a task-board block and call it as a tool instead (see [Running a board as a tool](#running-a-board-as-a-tool)).

Per-worker tuning: `tools` (catalog keys the worker may call), `visibility` (`sub`, `primary`, or a `{ client, history }` mapping), and `model`.

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

Two things land on the generator when a worker-declaring skill is active.

**Worker tools — the single-shot path.** Each worker key becomes a tool the generator can call. Calling `researcher("WebTransport adoption")` runs that worker to completion and returns its result inline, in one tool call. That is the everyday "run this as a sub-agent, hand me the result" case: one call, one result, no board choreography. Call a worker, read what it returns, decide what to do next.

**`taskTools` — an optional ledger.** The eight task tools (`addTask`, `assignTask`, `completeTask`, `failTask`, `blockTask`, `cancelTask`, `updateTask`, `listTasks`) let the generator track a multi-step plan. They write to the private board.

The point to keep straight: **nothing auto-runs the board.** `addTask({ goal, assignee })` writes a ledger row — it does not execute anything. The generator still runs delegated work by calling a worker tool. The board is note-taking; the worker tools are execution. There is no drain loop watching the ledger. When you want a board that drains itself under concurrency, that's a task board as a tool (below), not this.

```ts
const skills = createSkillsLibrary({ catalog, initialSkills });

const researchLead = generator({
  uses: [skills.with({ active: ["research-lead"] })],
});
// Because "research-lead" declares `workers:`, delegation installs
// automatically. researchLead now has: addTask/assignTask/completeTask/...
// (taskTools), plus a `researcher` tool and a `writer` tool, each a
// materialized worker, plus the guidance context.
```

## Running a board as a tool {#running-a-board-as-a-tool}

Worker tools serialize: the generator calls one, waits, calls the next. When you need real concurrency or a dependency graph — analysts running in parallel, a synthesizer gated on all of them — put a task board in the generator's `tools:` instead. A `taskBoard(...).drain` (or a `goalSeekLoop`) is a block, and any block can be a tool. The generator calls it once, the board drains internally under its own concurrency and dispatcher, and only the finalized result re-enters the generator's history.

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

The `context: pattern` mode, the `pattern:` / `pattern-config:` / `initial-tasks:` fields, and the `runSkill`-driven dispatch are all removed. `initial-tasks:` does not come back — the generator adds its own tasks with `addTask`, or you use a board-as-tool that carries its own seed. A `pattern:` field left in a skill file now fails loudly at parse rather than being reinterpreted.

For a graph that genuinely needs concurrent, dependency-ordered dispatch (the old `pattern: task-board` with `initial-tasks` and `concurrency`), re-express it as a `taskBoard(...).drain` block and call it as a tool ([above](#running-a-board-as-a-tool)). The board's own dispatch does the parallel work; only the invocation path changed.

## Where fork went

Fork mode (`context: fork`, a skill that ran as an isolated sub-agent) is also removed. The everyday case it served — run something as a sub-agent and get the result back in one call — is exactly what calling a worker tool does now, so declare a worker (even a trivial single one) and call it. The variant where a sub-agent inherits the conversation so far is planned separately.
