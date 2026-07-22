---
description: Produce a competitor analysis as a comparison matrix plus a synthesized read. Use when the user asks who competes with a product, how one stacks up against another, what the landscape looks like for a category, or wants a comparison matrix. A discoverer identifies competitors and queues a worker per competitor; analyzers run in parallel; a synthesizer waits on all of them and writes the final analysis.
keywords: [competitor, competitors, competition, compare, versus, landscape, market]
argument-hint: <product, company, or market>

allowed-tools: [competitorAnalysis]
---

This skill runs a competitor-analysis team on a task board: a discoverer picks 3-5 competitors and queues one analyzer per competitor, the analyzers run in parallel, and a synthesizer waits on every analyzer to produce the final matrix and read.

The whole team is exposed as a single tool, `competitorAnalysis`. When this skill is the right fit for the user's question, call it with the target:

```
competitorAnalysis({ topic: "<the target product, company, or market>" })
```

Extract the `topic` from the user's message. For "who competes with Linear?", pass `"Linear"`. For "compare Notion against its rivals", pass `"Notion"`. If the user named multiple targets, pick the one they led with. The tool drains the board — the discoverer fans out one analyzer per competitor, then the gated synthesizer runs — and returns `{ report }`, the synthesizer's final analysis (a takeaway, a comparison matrix grouped by tier, and the strategic implications). Surface that result to the user as-is; don't paraphrase the matrix or add commentary on top. The team has already done the work.

Don't try to do competitor analysis yourself in the chat. If you're not sure this skill applies (e.g. the user's question is only tangentially competitive), ask once before calling the tool.
