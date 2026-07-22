---
description: Multi-angle company research by a small team of analysts. Use when the user asks to research a company or wants several perspectives stitched into one brief. Runs a task board where market and financial analysts work in parallel and a synthesizer writes the final brief.
keywords: [research, company, deep-dive, briefing, analyst, market]
argument-hint: <company name or ticker>

allowed-tools: [researchCompany]
---

This skill runs a small research team on a task board: a market analyst and a financial analyst work in parallel, then a synthesizer waits on both and writes the final brief.

The whole team is exposed as a single tool, `researchCompany`. When this skill fits the user's question, call it with the target:

```
researchCompany({ topic: "<company name or ticker>" })
```

Extract the `topic` from the user's message. For "research ACME Corp", pass `"ACME Corp"`. The tool drains the board — analysts in parallel, then the gated synthesizer — and returns `{ report }`, the synthesizer's brief. Surface that report to the user as-is; the team has already done the work. Don't research the company yourself in the chat.
