---
description: Produce a competitor analysis as a comparison matrix plus a synthesized read. Use when the user asks who competes with a product, how one stacks up against another, what the landscape looks like for a category, or wants a comparison matrix. A discoverer identifies competitors and queues a worker per competitor; analyzers run in parallel; a synthesizer waits on all of them and writes the final analysis.
keywords: [competitor, competitors, competition, compare, versus, landscape, market]
argument-hint: <product, company, or market>

pattern: task-board
workers:
  discoverer:
    prompt-ref: ./reference/discover.md
    tools: [search, taskTools]
    agent-type: sub
  analyzer:
    prompt-ref: ./reference/analyze.md
    tools: [search, fetch]
    agent-type: sub
  synthesizer:
    prompt-ref: ./reference/synthesize.md
    agent-type: primary

initial-tasks:
  - id: discover
    goal: Identify 3 to 5 competitors for $ARGUMENTS across direct / adjacent / DIY-status-quo tiers, then enqueue one analyzer task per competitor plus a single synthesizer task whose deps cover every analyzer task you queued.
    assignee: discoverer

pattern-config:
  concurrency: 4
  dispatcher: topological
  on-idle: complete
  on-error: skip

allowed-tools: [search, fetch, taskTools]
---

When the user asks for a competitor analysis, this skill runs as a small team: the discoverer picks the right competitors and queues one analyzer per competitor, the analyzers run in parallel via the task board, and the synthesizer waits on every analyzer to produce the final matrix and read.

The user-facing result is the synthesizer's output — the discoverer and analyzer reports are intermediate context.
