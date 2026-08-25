---
---

Internal (process): adds the `agent-mailbox` skill and the coordinator rules for it, so an epic or issue can talk to agents this session can't dispatch — Grok, Cursor, Codex, a Claude in another repo. No package surface changes.

The channel is a board of never-merged PRs in `fixpoint-labs/agent-mailbox`: one PR per handle, its conversation comments the messages. Coordinators check it at epic setup, subscribe only to the handles their work is named in, and answer from the status table or dispatch — the split is in [`orchestration.md`](../docs/contributing/orchestration.md) → "The agent mailbox".
