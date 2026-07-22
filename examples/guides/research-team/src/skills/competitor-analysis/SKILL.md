---
description: Produce a competitor analysis as a comparison matrix plus a synthesized read. Use when the user asks who competes with a product, how one stacks up against another, or what a category's landscape looks like. A discoverer picks the competitors and fans out one analyzer per competitor on your board; a comparison-writer waits on all of them.
keywords: [competitor, competitors, competition, compare, versus, landscape, market]
argument-hint: <product, company, or market>

# This skill shows all three ways to staff an agent:
#   - discoverer:        an inline prompt agent, defined right here in the skill.
#   - analyzer:          agent-ref to `competitor-analyst`, a shared agent
#                        defined in app code (src/agents.ts) via defineAgent().
#   - comparison-writer: agent-ref to `comparison-writer`, which resolves to a
#                        deterministic handler block — a block staffed as an agent.
agents:
  discoverer:
    prompt-ref: ./reference/discover.md
    tools: [search, taskTools]
  analyzer:
    agent-ref: competitor-analyst
  comparison-writer:
    agent-ref: comparison-writer
---

This skill runs a competitor-analysis team on your task board. A discoverer picks 3-5 competitors and queues one analyzer per competitor plus a comparison-writer gated on all of them. The analyzers run in parallel; the comparison-writer waits on all of them and formats the matrix.

The three agents come from three different places. The discoverer is an inline prompt agent defined in this skill. The analyzer is a shared agent registered in app code and referenced by name. The comparison-writer is a plain handler block staffed as an agent. From the board's point of view they're all just agents you assign tasks to.

You seed the board and run it. Extract the target from the user's message (for "who competes with Linear?", the target is `Linear`; if the user named several targets, pick the one they led with), then:

1. `addTask` — goal: `"Identify 3 to 5 competitors for <target> across direct / adjacent / DIY-status-quo tiers, then enqueue one analyzer task per competitor plus a single comparison-writer task whose deps cover every analyzer task you queued."`, `assignee: "discoverer"`.
2. Call `runBoard` once. The discoverer enqueues the analyzers and the gated comparison-writer mid-run; the board keeps draining until all of them settle.

The settled board's `comparison-writer` task carries the final comparison matrix. Surface it to the user as-is; don't paraphrase the matrix or add commentary on top. The team has already done the work — don't do the competitor analysis yourself in the chat.

If you're not sure this skill applies (e.g. the user's question is only tangentially competitive), ask once before planning the board.
