---
description: Multi-angle company research delivered by a small team of analysts. Use when the user asks to research a company, wants a deep dive on what a company is up to, or wants several perspectives stitched into a single report. You plan the tasks on your board — a market analyst and a financial analyst in parallel, a synthesizer gated on both — and run it.
keywords: [research, company, deep-dive, deep, dive, briefing, analyst, market]
argument-hint: <company name or ticker>

agents:
  market-analyst:
    prompt-ref: ./reference/market.md
    tools: [search, fetch]
  financial-analyst:
    prompt-ref: ./reference/financials.md
    tools: [search, fetch]
  synthesizer:
    prompt-ref: ./reference/synthesis.md
---

This skill runs a small research team on your task board: a market analyst and a financial analyst work in parallel, then a synthesizer waits on both and writes the final brief.

You run the board. Extract the target from the user's message (for "research ACME Corp", the target is `ACME Corp`; for "what's Anthropic up to lately", it's `Anthropic`), then:

1. `addTask` — goal: `"Analyze market positioning of <target> — category, target customer, key differentiators, recent narrative shifts. Cite sources."`, `assignee: "market-analyst"`.
2. `addTask` — goal: `"Analyze financial health of <target> — revenue scale and trajectory, funding or public financials, profitability/burn, runway signals. Cite sources."`, `assignee: "financial-analyst"`.
3. `addTask` — goal: `"Synthesize the prior reports into a single research brief for <target>. Lead with the takeaway, then evidence, then risks."`, `assignee: "synthesizer"`, `deps` set to the two task ids returned above.
4. Call `runBoard` once. The analysts run in parallel; the synthesizer starts when both complete.

The settled board's synthesizer task carries the brief (takeaway, what they do, market position, financial picture, risks, sources). Surface it to the user as-is; don't restate it. The team has already done the work — don't research the company yourself in the chat.

If you're not sure this skill applies (e.g. the user wants only a one-line refresher), ask once before planning the board.
