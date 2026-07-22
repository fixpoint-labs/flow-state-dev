---
description: Multi-angle company research delivered by a small team of analysts. Use when the user asks to research a company, wants a deep dive on what a company is up to, or wants several perspectives stitched into a single report. A market analyst and a financial analyst run in parallel and a synthesizer writes the final brief.
keywords: [research, company, deep-dive, deep, dive, briefing, analyst, market]
argument-hint: <company name or ticker>

allowed-tools: [researchCompany]
---

This skill runs a small research team on a task board: a market analyst and a financial analyst work in parallel, then a synthesizer waits on both and writes the final brief.

The whole team is exposed as a single tool, `researchCompany`. When this skill fits the user's question, call it with the target:

```
researchCompany({ topic: "<company name or ticker>" })
```

Extract the `topic` from the user's message. For "research ACME Corp", pass `"ACME Corp"`. For "what's Anthropic up to lately", pass `"Anthropic"`. The tool drains the board — analysts in parallel, then the gated synthesizer — and returns `{ report }`, the synthesizer's brief (takeaway, what they do, market position, financial picture, risks, sources). Surface that report to the user as-is; don't restate it. The team has already done the work.

Don't try to research the company yourself in the chat. If you're not sure this skill applies (e.g. the user wants only a one-line refresher), ask once before calling the tool.
