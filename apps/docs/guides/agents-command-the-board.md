---
title: Agents that command the board
sidebar_label: Agents command the board
description: Let a model add, assign, and complete tasks while the board drains, using the taskTools surface inside a pattern skill.
---

# Agents that command the board

So far the tasks on a board were decided by your code — a fixed `initialTasks`
list, or a router that computed them up front. Sometimes you want the *model* to
decide the work while the board is running: look at the input, then enqueue
however many tasks the situation calls for. That's what `taskTools` is for.

`taskTools` is a small tool surface a worker can carry. When the worker is a
generator, the model can call these tools mid-drain to shape the board:

| Tool | What the agent does |
|------|---------------------|
| `addTask` | Enqueue a new task (returns its id). |
| `assignTask` | Reassign a task to a different worker. |
| `completeTask` / `failTask` | Mark a task done or failed with output. |
| `blockTask` / `cancelTask` | Park a task pending an external condition, or drop it. |
| `updateTask` | Patch priority, metadata, assignee, or labels. |
| `listTasks` | Read the board, filtered by status or assignee. |

The classic use is **runtime fan-out**: one worker discovers how much work there
is and queues the rest. The [research team](./building-a-research-team) example
ships exactly this as the `competitor-analysis` skill — a discoverer worker
finds 3-5 competitors, calls `addTask` once per competitor plus one for a
synthesizer that depends on all of them, and the board drains what it queued:

```markdown title="skills/competitor-analysis/SKILL.md (frontmatter)"
pattern: task-board
workers:
  discoverer:
    prompt-ref: ./reference/discover.md
    tools: [search, taskTools]   # ← taskTools on the worker that fans out
  analyzer:
    prompt-ref: ./reference/analyze.md
    tools: [search, fetch]
  synthesizer:
    prompt-ref: ./reference/synthesize.md
initial-tasks:
  - id: discover
    goal: Find 3-5 competitors for $ARGUMENTS, then addTask one analyzer per
          competitor plus a synthesizer whose deps cover them.
    assignee: discoverer
```

The discoverer's prompt tells it to enqueue the work:

> Use `search` to find the competitors. For each, call `addTask({ goal, assignee: "analyzer" })` and collect the ids. Then `addTask({ goal, assignee: "synthesizer", deps: [...those ids] })`.

## Giving a worker taskTools

Opt a worker in by putting `taskTools` in **that worker's own `tools:` list**,
as the discoverer does above. Listing it only in the skill's top-level
`allowed-tools` does not install it on the worker — the pattern materializer
composes the capability per-worker from the worker's own `tools`.

For an `agent-ref` worker (staffed by a `defineAgent`'d agent), the worker's
`tools:` field isn't read; put `taskTools` in the agent's `allowedTools` or in
`agent-overrides.tools` instead. See [Pattern skills](/docs/skills/pattern-skills).

## Why this runs as a skill

`taskTools` resolves *which* board to command by looking at the **active pattern
skill**. When a `pattern: task-board` skill is dispatched (via `runSkill`), the
runtime records that the pattern is active, and every `taskTools` call resolves
that skill's live collection. That's why the example is a `SKILL.md`: the skill
dispatch is what gives `addTask` a board to add to.

Concretely, an agent commanding the board works today when the board is run as a
pattern skill. The agent doesn't need to know the collection id or anything about
the substrate — it just calls `addTask`, and the tool finds the active board.

## The current limitation

`taskTools` has no board to resolve **outside** an active pattern skill. If you
mount a `taskBoard` directly in a flow action (a "code-first" board, no skill)
and give a generator `taskTools`, every call returns
`{ ok: false, error: "no_active_pattern" }` — a bare `taskBoard` doesn't register
itself as an active pattern, so there's nothing for the tool to target.

So the choices today are:

- **Agent decides the tasks →** run the board as a `pattern: task-board` skill and
  give the fan-out worker `taskTools`. Works now (this guide).
- **Your code decides the tasks →** a code-first board with `initialTasks` or a
  router. Blocks inside the flow can still add tasks directly with
  `getOrCreateTaskCollection(...).addTask(...)` (see [The board lifecycle](./board-lifecycle));
  that's *code* commanding the board, not an agent via tools.

A collection-bound `taskTools` variant — one you point at a specific
`collectionId` so an agent can command a code-first board without the skill
wrapper — is planned but not shipped. Until then, reach for the skill form when
you want a *model* driving the board.

## Related

- [Building a research team](./building-a-research-team) — includes the `competitor-analysis` fan-out skill.
- [The board lifecycle](./board-lifecycle) — how blocks (as opposed to agents) add tasks to a board.
- [Pattern skills](/docs/skills/pattern-skills) — the `taskTools` reference and worker wiring.
