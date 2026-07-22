---
description: Produce a competitor analysis as a comparison matrix plus a synthesized read. Use when the user asks who competes with a product, how one stacks up against another, what the landscape looks like for a category, or wants a comparison matrix. A discoverer picks the competitors and fans out one analyzer per competitor on your board; a synthesizer waits on all of them.
keywords: [competitor, competitors, competition, compare, versus, landscape, market]
argument-hint: <product, company, or market>

agents:
  discoverer:
    prompt-ref: ./reference/discover.md
    tools: [search, taskTools]
  analyzer:
    prompt-ref: ./reference/analyze.md
    tools: [search, fetch]
  comparison-synthesizer:
    prompt-ref: ./reference/synthesize.md
---

This skill runs a competitor-analysis team on your task board: a discoverer picks 3-5 competitors and queues one analyzer per competitor plus a synthesizer gated on all of them, the analyzers run in parallel, and the synthesizer writes the final matrix and read.

You seed the board and run it. Extract the target from the user's message (for "who competes with Linear?", the target is `Linear`; if the user named multiple targets, pick the one they led with), then:

1. `addTask` — goal: `"Identify 3 to 5 competitors for <target> across direct / adjacent / DIY-status-quo tiers, then enqueue one analyzer task per competitor plus a single comparison-synthesizer task whose deps cover every analyzer task you queued."`, `assignee: "discoverer"`.
2. Call `runBoard` once. The discoverer enqueues the analyzers and the gated synthesizer mid-run; the board keeps draining until all of them settle.

The settled board's `comparison-synthesizer` task carries the final analysis (a takeaway, a comparison matrix grouped by tier, and the strategic implications). Surface it to the user as-is; don't paraphrase the matrix or add commentary on top. The team has already done the work — don't do competitor analysis yourself in the chat.

If you're not sure this skill applies (e.g. the user's question is only tangentially competitive), ask once before planning the board.
