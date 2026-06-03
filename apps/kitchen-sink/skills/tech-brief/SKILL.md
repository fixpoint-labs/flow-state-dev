---
description: Produce a concise technology briefing on a topic, company, or product. Use when the user wants a quick but thorough tech rundown — what it is, why it matters, who the players are, and what the risks look like. A single agent-backed worker does the research and writes the brief.
keywords: [tech, brief, briefing, technology, overview, rundown, explain]
argument-hint: <technology, product, or company>

pattern: plan-and-execute
workers:
  briefer:
    agent-ref: tech-briefer
    visibility: primary

allowed-tools: [search, fetch]
---

This skill dispatches a single agent-backed worker to produce a technology briefing. The `tech-briefer` agent has a research-analyst persona and will search the web, synthesize findings, and deliver a concise briefing.

**Dispatching.** This is a pattern skill — invoke it through `runSkill`:

```
runSkill({ name: "tech-brief", input: "<topic>" })
```

The `input` is the subject — extract it from the user's message. For "give me a tech brief on WebTransport", pass `"WebTransport"`. For "what's the deal with Anthropic's MCP", pass `"Anthropic MCP"`.

Surface the result as-is. The agent has already done the research and written the briefing.
