---
"@flow-state-dev/workforce": patch
"@flow-state-dev/shift-manager": patch
---

A worker flow of your own can open its prompt with the same default layer as the built-in worker flow (FIX-2493).

- **workforce:** exports `workerIdentityPrompt(ctx, installation)` and `TOOL_USE_RULE`. Put `(_input, ctx) => workerIdentityPrompt(ctx, installation)` first in a model block's `prompt` and its workers are told who they are, who they can reach, and to work things out themselves first.
- **shift-manager:** the DevTeam's Engineering Manager now gets that layer ahead of its team's and its own instructions.
