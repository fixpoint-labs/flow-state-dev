---
description: Multi-angle company research by a small team of analysts. Use when the user asks to research a company or wants several perspectives stitched into one brief. Activates a task board where market and financial analysts run in parallel and a primary synthesizer writes the final brief.
keywords: [research, company, deep-dive, briefing, analyst, market]
argument-hint: <company name or ticker>

pattern: task-board
workers:
  market-analyst:
    prompt-ref: ./reference/market.md
    tools: [search, fetch]
    visibility: sub
  financial-analyst:
    prompt-ref: ./reference/financials.md
    tools: [search, fetch]
    visibility: sub
  synthesizer:
    prompt-ref: ./reference/synthesis.md
    visibility: primary

initial-tasks:
  - id: market
    goal: Analyze market positioning of $ARGUMENTS — category, target customer, key differentiators, recent narrative shifts. Cite sources.
    assignee: market-analyst
  - id: financials
    goal: Analyze financial health of $ARGUMENTS — revenue scale and trajectory, funding or public financials, profitability/burn, runway signals. Cite sources.
    assignee: financial-analyst
  - id: synth
    goal: Synthesize the reports into one research brief for $ARGUMENTS. Lead with the takeaway, then evidence, then risks.
    assignee: synthesizer
    deps: [market, financials]

pattern-config:
  concurrency: 2
  dispatcher: topological

allowed-tools: [search, fetch]
---

This skill runs a small team on a task board: the market analyst and financial analyst run in parallel, then a primary synthesizer waits on both to produce the final brief.

**Dispatching the team.** This is a pattern skill — the team only runs when you invoke it through the `runSkill` tool:

```
runSkill({ name: "research-company", input: "<company name or ticker>" })
```

The `input` is the target — extract it from the user's message. For "research ACME Corp", pass `"ACME Corp"`. The tool returns the synthesizer's brief; surface it to the user as-is.

`pattern-config` omits `on-idle`, so the board uses the `complete-or-blocked` default. That's what you want for this dependency graph: if an analyst fails, the synthesizer's dependency is unmet, and the board reports a blocked drain instead of idle-polling to a timeout.
