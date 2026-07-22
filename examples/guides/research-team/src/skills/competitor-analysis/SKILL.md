---
description: Produce a competitor analysis as a comparison matrix plus a synthesized read. Use when the user asks who competes with a product, how one stacks up against another, or what a category's landscape looks like. A discoverer picks the competitors and fans out one analyzer per competitor on your board; a comparison-writer waits on all of them.
keywords: [competitor, competitors, competition, compare, versus, landscape, market]
argument-hint: <product, company, or market>

# This skill shows the two ways to staff an agent:
#   - discoverer, comparison-writer: inline prompt agents, defined right here in
#                                    the skill (prompt-ref to the skill folder).
#   - analyzer:                      agent-ref to `competitor-analyst`, a shared
#                                    agent defined in app code (src/agents.ts)
#                                    via defineAgent() and borrowed by name.
agents:
  discoverer:
    prompt-ref: ./reference/discover.md
    tools: [search, taskTools]
  analyzer:
    agent-ref: competitor-analyst
  comparison-writer:
    prompt-ref: ./reference/compare.md
---

This skill runs a competitor-analysis team on your task board. A discoverer picks 3-5 competitors and queues one analyzer per competitor plus a comparison-writer gated on all of them. The analyzers run in parallel; the comparison-writer waits on all of them and formats the matrix.

The team is staffed two ways. The discoverer and comparison-writer are inline prompt agents defined in this skill — their personas live in the skill folder. The analyzer is a shared agent registered in app code and referenced by name (`agent-ref`), so other skills can borrow the same participant. From the board's point of view they're all just agents you assign tasks to.

You seed the board and run it. Extract the target from the user's message (for "who competes with Linear?", the target is `Linear`; if the user named several targets, pick the one they led with), then:

1. `addTask` — goal: `"Identify 3 to 5 competitors for <target> across direct / adjacent / DIY-status-quo tiers, then enqueue one analyzer task per competitor plus a single comparison-writer task whose deps cover every analyzer task you queued."`, `assignee: "discoverer"`.
2. Call `runBoard` once. The discoverer enqueues the analyzers and the gated comparison-writer mid-run; the board keeps draining until all of them settle.

The settled board's `comparison-writer` task carries the final comparison matrix. Surface it to the user as-is; don't paraphrase the matrix or add commentary on top. The team has already done the work — don't do the competitor analysis yourself in the chat.

If you're not sure this skill applies (e.g. the user's question is only tangentially competitive), ask once before planning the board.
