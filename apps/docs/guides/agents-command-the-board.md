---
title: Agents that command the board
sidebar_label: Agents command the board
description: Let a model decide the work at runtime — assign tasks to a team of agents on a private delegation board and drain it with runBoard, the taskTools surface a skill's agents field installs.
---

# Agents that command the board

So far the tasks on a board were decided by your code — a fixed `initialTasks`
list, or a router that computed them up front. Sometimes you want the *model* to
decide the work as it goes: look at the input, then plan however many tasks the
situation calls for, assign each to a teammate, and run the lot. That's what
`taskTools` and `runBoard` are for.

`taskTools` is a small tool surface a generator can carry. The model calls these
tools to plan a task board — the work it's about to run:

| Tool | What the agent does |
|------|---------------------|
| `addTask` | Enqueue a new task with an `assignee` and optional `deps` (returns its id). |
| `assignTask` | Reassign a task to a different agent. |
| `completeTask` / `failTask` | Mark a task done or failed with output. |
| `blockTask` / `cancelTask` | Park a task pending an external condition, or drop it. |
| `updateTask` | Patch priority, metadata, assignee, or labels. |
| `listTasks` | Read the board, filtered by status or assignee. |

Planning is only half of it. `runBoard` is the other tool the surface installs,
and it's the one that does the work: it drains the board, dispatching every
runnable task to its assigned agent and returning the settled result.

## Where the board comes from

`taskTools` and `runBoard` need a board to command. A generator gets one by
binding a skill that declares `agents:`. When a skill declares agents, the skills
library installs a **private task board** on that generator — own-state, scoped to
the one generator, not shared with anything else — plus the `taskTools` and
`runBoard`. This is delegation. See
[Delegation](/docs/skills/delegation) for the full authoring surface.

```markdown title="skills/research-lead/SKILL.md (frontmatter)"
agents:
  researcher:
    prompt-ref: ./reference/research.md
    tools: [search, fetch]
  writer:
    prompt-ref: ./reference/write.md
```

Binding that skill to a generator gives it the eight `taskTools`, `runBoard`, and
a private board whose agent registry has a `researcher` and a `writer` ready to be
assigned tasks. The generator never calls the agents directly — it puts work on
the board and drains it.

## Assign tasks, then drain

The one thing to keep straight: **the drain is the execution.**
`addTask({ goal, assignee: "researcher" })` writes a task — it does not run
anything yet. `runBoard` is what runs it. Draining the board dispatches each
runnable task to its assigned agent, honors `deps`, and hands back every task's
output. So the model's loop looks like:

> Look at the request and `addTask` one research task per subtopic, each
> `assignee: "researcher"`. `addTask` a write-up assigned to `"writer"`, with
> `deps` set to the research task ids so it waits for them. Then call `runBoard`
> once and surface the writer task's output.

The board holds the plan; the drain runs it. That split is the whole model — you
describe the work as tasks, then run the graph in one call. Independent tasks run
in parallel; a task with `deps` waits until they complete. The model decides what
the tasks are; the board decides how they run.

## The model decides the tasks at runtime

Because the plan is built by `addTask` calls, the model can shape it from the
input rather than from a frozen list. The sharpest version of this is an agent
that plans its *own* fan-out mid-drain. Give one agent `taskTools`, and it can
`addTask` more work onto the same board while the drain is running:

```markdown title="skills/competitor-analysis/SKILL.md"
---
description: Competitor analysis — the team decides the competitors.
agents:
  discoverer: { prompt-ref: ./reference/discover.md, tools: [search, taskTools] }
  analyzer:   { prompt-ref: ./reference/analyze.md,   tools: [search, fetch] }
  synthesizer:{ prompt-ref: ./reference/synthesize.md }
---
1. addTask({
     goal: "Identify 3-5 competitors for <topic>, then addTask one 'analyzer'
            task per competitor plus a single 'synthesizer' task whose deps
            cover every analyzer you queued.",
     assignee: "discoverer", input: { topic } })
2. Call runBoard once. Surface the synthesizer task's output.
```

One `addTask`, one `runBoard`. The drain runs the discoverer first; the discoverer
looks at the topic, decides there are (say) four competitors, and enqueues four
analyzer tasks plus a gated synthesizer. The same drain picks those up — the
analyzers in parallel, the synthesizer once all four complete. Nobody wrote the
number four into code. The team decided the shape of the work at runtime, and the
board ran it.

## When the graph is fixed in code

Reach for a delegation skill when the *model* should decide the tasks. When the
graph is fixed in code instead — a known set of seeded `initialTasks`, a custom
collection backing, a tuned dispatcher — you don't need agents or `runBoard` at
all. Build a code-defined [task board](/docs/orchestration/task-board) and call it
as a single tool. A `taskBoard(...).drain` is a block, and
[any block can be a tool](/docs/fundamentals/blocks#any-block-can-be-a-tool).
Register the drain block in the skills catalog, list it under the skill's
`allowed-tools`, and the generator calls the whole board as one tool, getting back
only the finalized result.

So the two shapes are:

- **The model plans the work per request →** a delegation skill with `agents:`.
  The model assigns tasks and drains the board with `runBoard`. Parallel and
  dependency-gated, with the model in charge of what the tasks are (this guide).
- **The graph is fixed in code →** a code-defined `taskBoard` called as a tool, or
  mounted directly in a flow. Your code seeds the tasks; the board's own dispatch
  runs them.

## Related

- [Delegation](/docs/skills/delegation) — the `agents:` field, the private board, and the `taskTools` + `runBoard` surface.
- [Building a research team](/guides/building-a-research-team) — a board that drains itself under concurrency.
- [The board lifecycle](/guides/board-lifecycle) — how blocks (as opposed to agents) add tasks to a board.
- [Task board](/docs/orchestration/task-board) — the concurrent-drain primitive you can call as a tool.
