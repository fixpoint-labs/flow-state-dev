---
description: Competitor analysis as a comparison matrix plus a synthesized read. Use when the user asks who competes with a product, how one stacks up against another, or what a category's landscape looks like. One analyzer runs per competitor in parallel; a synthesizer waits on all of them.
keywords: [competitor, competitors, competition, compare, versus, landscape]
argument-hint: <product, company, or market>

allowed-tools: [analyzeCompetitors]
---

This skill runs a competitor-analysis team on a task board: one analyzer per competitor works in parallel, then a synthesizer waits on all of them and writes the final comparison.

The team is exposed as a single tool, `analyzeCompetitors`. You pick the competitors, then hand the target and that list to the tool:

```
analyzeCompetitors({ topic: "<the target>", competitors: ["<name>", "<name>", ...] })
```

Identify 3 to 5 competitors across direct, adjacent, and DIY/status-quo tiers, then call the tool once with the target as `topic` and the names as `competitors`. It fans out one analyzer per competitor, gates a synthesizer on all of them, and returns `{ report }` — the comparison matrix and read. Surface that report to the user as-is. Don't do the analysis yourself in the chat.
