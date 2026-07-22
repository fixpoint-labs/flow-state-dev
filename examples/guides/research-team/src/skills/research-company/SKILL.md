---
description: Multi-angle company research by a small team of analysts. Use when the user asks to research a company or wants several perspectives stitched into one brief. You plan the tasks on your board — market and financial analysts in parallel, a synthesizer gated on both — and run it.
keywords: [research, company, deep-dive, briefing, analyst, market]
argument-hint: <company name or ticker>

workers:
  market-analyst:
    block-ref: market-analyst
  financial-analyst:
    block-ref: financial-analyst
  synthesizer:
    block-ref: synthesizer
---

This skill runs a small research team on your task board: a market analyst and a financial analyst work in parallel, then a synthesizer waits on both and writes the final brief.

You run the board. Extract the target from the user's message (for "research ACME Corp", the target is `ACME Corp`), then:

1. `addTask` a market analysis — `assignee: "market-analyst"`, `input: { "subject": "<target>" }`.
2. `addTask` a financial analysis — `assignee: "financial-analyst"`, `input: { "subject": "<target>" }`.
3. `addTask` the synthesis — `assignee: "synthesizer"`, `deps` set to the two task ids returned above, `input: { "subject": "<target>" }`.
4. Call `runBoard` once. The analysts run in parallel; the synthesizer starts when both complete.

The settled board's synthesizer task carries `{ report }` — surface that report to the user as-is. The team has already done the work; don't research the company yourself in the chat.
