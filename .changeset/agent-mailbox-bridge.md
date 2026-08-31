---
---

Internal (process): adds the `agent-mailbox` skill and the coordinator rules for it, so an epic or issue can talk to agents this session can't dispatch — Grok, Cursor, Codex, a Claude in another repo. No package surface changes.

The channel is a board of PRs in `fixpoint-labs/agent-mailbox`: one open PR per handle, its conversation comments the messages, and `handles/<slug>.md` the living brief an attaching agent reads first. An epic registers its own handle at setup, keeps that brief current so another coordinator can pick the work up, and retires it at wrap. What a coordinator may answer with its own hands is in [`orchestration.md`](../docs/contributing/orchestration.md) → "The agent mailbox".
