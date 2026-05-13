---
description: Multi-angle company research delivered by a small team of analysts. Use when the user asks to research a company, wants a deep dive on what a company is up to, or wants several perspectives stitched into a single report. The skill activates a task board where market, financial, and synthesis workers run in parallel and a primary synthesizer writes the final brief.
keywords: [research, company, deep-dive, deep, dive, briefing, analyst, market]
argument-hint: <company name or ticker>

pattern: task-board
workers:
  market-analyst:
    prompt-ref: ./reference/market.md
    tools: [search, fetch]
    agent-type: sub
  financial-analyst:
    prompt-ref: ./reference/financials.md
    tools: [search, fetch]
    agent-type: sub
  synthesizer:
    prompt-ref: ./reference/synthesis.md
    agent-type: primary

initial-tasks:
  - id: market
    goal: Analyze market positioning of $ARGUMENTS — category, target customer, key differentiators, recent narrative shifts. Cite sources.
    assignee: market-analyst
  - id: financials
    goal: Analyze financial health of $ARGUMENTS — revenue scale and trajectory, funding history or public financials, profitability/burn, runway signals. Cite sources.
    assignee: financial-analyst
  - id: synth
    goal: Synthesize the prior reports into a single research brief for $ARGUMENTS. Lead with the takeaway, then evidence, then risks.
    assignee: synthesizer
    deps: [market, financials]

pattern-config:
  concurrency: 2
  dispatcher: topological
  on-idle: complete
  on-error: skip

allowed-tools: [search, fetch, taskTools]
---

This skill runs as a small team on a task board: the market analyst and financial analyst run in parallel, then a primary synthesizer waits on both to produce the final brief.

**Dispatching the team.** This is a pattern skill — the team only runs when you invoke it through the `runSkill` tool. When this skill fits the user's question, call:

```
runSkill({ name: "research-company", input: "<company name or ticker>" })
```

The `input` is the target — extract it from the user's message. For "research ACME Corp", pass `"ACME Corp"`. For "what's Anthropic up to lately", pass `"Anthropic"`.

The tool returns the synthesizer's final brief (takeaway, what they do, market position, financial picture, risks, sources). Surface that to the user as-is — don't restate it. The team has already done the work.

Don't try to research the company yourself in the chat. If you're not sure this skill applies (e.g. the user wants only a one-line refresher), ask once before dispatching.

You may add follow-up research questions mid-flow via `addTask` if a gap surfaces while the board runs (for example, when the user clarifies that they care about a specific product line or geography). Keep the team small — every added task delays the synthesizer.
