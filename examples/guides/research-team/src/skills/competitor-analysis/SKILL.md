---
description: Competitor analysis as a comparison matrix plus a synthesized read. Use when the user asks who competes with a product, how one stacks up against another, or what a category's landscape looks like. A discoverer identifies competitors and queues one analyzer per competitor; the analyzers run in parallel; a synthesizer waits on all of them.
keywords: [competitor, competitors, competition, compare, versus, landscape]
argument-hint: <product, company, or market>

pattern: task-board
workers:
  discoverer:
    prompt-ref: ./reference/discover.md
    tools: [search, taskTools]
    visibility: sub
  analyzer:
    prompt-ref: ./reference/analyze.md
    tools: [search, fetch]
    visibility: sub
  synthesizer:
    prompt-ref: ./reference/synthesize.md
    visibility: primary

initial-tasks:
  - id: discover
    goal: Identify 3 to 5 competitors for $ARGUMENTS, then enqueue one analyzer task per competitor plus a single synthesizer task whose deps cover every analyzer task you queued.
    assignee: discoverer

pattern-config:
  concurrency: 4
  dispatcher: topological

allowed-tools: [search, fetch, taskTools]
---

This skill fans out at runtime. The board starts with one task — a discoverer — which picks 3-5 competitors and calls `addTask` once per competitor (assignee `analyzer`) plus one `addTask` for a synthesizer whose `deps` cover every analyzer it queued. The analyzers run in parallel; the synthesizer waits on all of them.

**Dispatching the team.** This is a pattern skill — invoke it with `runSkill`:

```
runSkill({ name: "competitor-analysis", input: "<product, company, or market>" })
```

Pass the target the user named as `input`. The tool returns the synthesizer's comparison matrix and read; surface it as-is.

The discoverer's `tools` include `taskTools`, which is what gives it `addTask` — the runtime mutation surface. A worker only gets `taskTools` when its own `tools:` list contains it; listing it only in the top-level `allowed-tools` would not install it on the worker.
