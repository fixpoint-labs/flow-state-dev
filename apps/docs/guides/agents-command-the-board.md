---
title: Agents that command the board
sidebar_label: Agents command the board
description: Let a model add, assign, and complete tasks on a private delegation board, using the taskTools surface a skill's workers field installs.
---

# Agents that command the board

So far the tasks on a board were decided by your code — a fixed `initialTasks`
list, or a router that computed them up front. Sometimes you want the *model* to
decide the work as it goes: look at the input, then track however many tasks the
situation calls for. That's what `taskTools` is for.

`taskTools` is a small tool surface a generator can carry. The model calls these
tools to shape a task board — a ledger it keeps while it works:

| Tool | What the agent does |
|------|---------------------|
| `addTask` | Enqueue a new task (returns its id). |
| `assignTask` | Reassign a task to a different worker. |
| `completeTask` / `failTask` | Mark a task done or failed with output. |
| `blockTask` / `cancelTask` | Park a task pending an external condition, or drop it. |
| `updateTask` | Patch priority, metadata, assignee, or labels. |
| `listTasks` | Read the board, filtered by status or assignee. |

## Where the board comes from

`taskTools` needs a board to command. A generator gets one by binding a skill
that declares `workers:`. When a skill declares workers, the skills library
installs a **private task board** on that generator — own-state, scoped to the
one generator, not shared with anything else — plus the `taskTools` and one
callable tool per worker. This is delegation. See
[Delegation](/docs/skills/delegation) for the full authoring surface.

```markdown title="skills/research-lead/SKILL.md (frontmatter)"
context: inline
workers:
  researcher:
    prompt-ref: ./reference/research.md
    tools: [search, fetch]
  writer:
    prompt-ref: ./reference/write.md
```

Binding that skill to a generator gives it a `researcher` tool, a `writer` tool,
the eight `taskTools`, and a private board they write to.

## The board is a ledger, not an engine

The one thing to keep straight: **nothing auto-runs the board.**
`addTask({ goal, assignee: "researcher" })` writes a ledger row — it does not
execute anything. There's no drain loop watching the board and dispatching rows
to workers. That auto-dispatch is a property of a code-defined `taskBoard`, not
of a delegation board.

The way the generator actually runs delegated work is by **calling a worker
tool**. `researcher("adoption of WebTransport")` runs the worker and returns its
result inline, in one call. So the model's loop looks like:

> Call `addTask` to note the subtopics you plan to cover. Then call the
> `researcher` tool for each one, collect the findings, and call the `writer`
> tool with them. Use `completeTask`/`listTasks` to keep the ledger current.

The board tracks the plan; the worker tools do the work. That split is the whole
model — one call to a worker is the single-shot "run this as a sub-agent, get the
result" path, with no board choreography required.

## When you want real concurrency

Worker tools serialize: the generator calls one, waits, calls the next. If you
need analysts running in parallel, or a synthesizer gated on all of them, a
serialized executive is the wrong shape. Reach for a code-defined
[task board](/docs/orchestration/task-board) instead — it drains under its own
concurrency and dispatcher — and call it as a single tool. A `taskBoard(...).drain`
is a block, and [any block can be a tool](/docs/fundamentals/blocks#any-block-can-be-a-tool).
Register the drain block in the skills catalog, list it under the skill's
`allowed-tools`, and the generator calls the whole board as one tool, getting
back only the finalized result.

So the two shapes are:

- **The model tracks and drives the work itself →** a delegation skill with
  `workers:`. The board is a ledger; the model calls workers. Serialized, but the
  model stays in charge of each step (this guide).
- **The work is a concurrent or dependency-ordered graph →** a code-defined
  `taskBoard` called as a tool, or mounted directly in a flow. The board's own
  dispatch runs the parallel work.

## Related

- [Delegation](/docs/skills/delegation) — the `workers:` field, the private board, and the `taskTools` ledger.
- [Building a research team](/guides/building-a-research-team) — a board that drains itself under concurrency.
- [The board lifecycle](/guides/board-lifecycle) — how blocks (as opposed to agents) add tasks to a board.
- [Task board](/docs/orchestration/task-board) — the concurrent-drain primitive you can call as a tool.
