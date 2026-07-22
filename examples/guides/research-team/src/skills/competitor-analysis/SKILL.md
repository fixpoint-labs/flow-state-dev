---
description: Competitor analysis as a comparison matrix plus a synthesized read. Use when the user asks who competes with a product, how one stacks up against another, or what a category's landscape looks like. You pick the competitors, fan out one analyzer per competitor on your board, and gate a synthesizer on all of them.
keywords: [competitor, competitors, competition, compare, versus, landscape]
argument-hint: <product, company, or market>

agents:
  competitor-analyst:
    agent-ref: competitor-analyst
  synthesizer:
    agent-ref: synthesizer
---

This skill runs a competitor-analysis team on your task board: one analyzer per competitor works in parallel, then a synthesizer waits on all of them and writes the final comparison.

You pick the competitors and you run the board. Identify 3 to 5 competitors for the target across direct, adjacent, and DIY/status-quo tiers, then:

1. `addTask` one analysis per competitor — `assignee: "competitor-analyst"`, `input: { "subject": "<competitor name>" }`.
2. `addTask` the synthesis — `assignee: "synthesizer"`, `deps` set to every analyzer task id from step 1, `input: { "subject": "<the target>" }`.
3. Call `runBoard` once. The analyzers run in parallel; the synthesizer starts when all of them complete.

The settled board's synthesizer task carries `{ report }` — the comparison matrix and read. Surface it to the user as-is; don't do the analysis yourself in the chat.
