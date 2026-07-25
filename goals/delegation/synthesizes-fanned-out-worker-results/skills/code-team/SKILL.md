---
description: A two-agent team that reports codes. Use when asked to collect the team's codes.
argument-hint: <researcher-secret> <audit-token> <handoff-code>

agents:
  researcher:
    prompt-ref: ./reference/researcher.md
    tools: [taskTools]
  auditor:
    prompt-ref: ./reference/auditor.md
---

This skill defines its own team. The two `agents:` above are inline prompt agents — each
one's persona is a file in this skill folder, so the whole team travels with the skill.

You run the board. When the user asks you to collect the team's codes:

1. `addTask` — goal: `"report your code"`, `assignee: "researcher"`. Create exactly ONE task,
   and do not assign any other agent yourself.
2. Call `runBoard` once.
3. Read EVERY task's output in the settled board, then write a final answer listing every
   distinct code you found, each on its own line, verbatim.
