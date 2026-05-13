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

This skill runs as a small team on a task board: a discoverer picks 3-5 competitors and queues one analyzer per competitor, the analyzers run in parallel, and a synthesizer waits on every analyzer to produce the final matrix and read.

**Dispatching the team.** This is a pattern skill — the team only runs when you invoke it through the `runSkill` tool. When this skill is the right fit for the user's question, call:

```
runSkill({ name: "competitor-analysis", input: "<the target product, company, or market>" })
```

The `input` is what the user wants analyzed — extract it from their message. For "who competes with Linear?", pass `"Linear"`. For "compare Notion against its rivals", pass `"Notion"`. If the user named multiple targets, pick the one they led with.

The tool returns the synthesizer's final analysis (a takeaway, a comparison matrix grouped by tier, and the strategic implications). Surface that result to the user as-is — don't paraphrase the matrix or add your own commentary on top. The team has already done the work.

Don't try to do competitor analysis yourself in the chat. If you're not sure this skill applies (e.g. the user's question is only tangentially competitive), ask once before dispatching.
