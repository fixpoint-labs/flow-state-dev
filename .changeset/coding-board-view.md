---
"@flow-state-dev/harness-manager": minor
---

The harness kit serves a conversation's coding board, and the coding worker flow serves a run's recorded work, as live views (FIX-2725).

- `codingBoardViewRef()` with `{ sessionId }` is a user view on the `harnesses` flow. It answers the conversation's board tasks, each with:
  - what holds it for you and where each answer goes (`asks`);
  - its harness (its run's, else its worker's `harness:` setting);
  - how its review ended, where its work landed, and why it failed;
  - the numbers of the pull requests it waits on.

  It reaches a conversation on any flow, including an app's own agent flow. Another user's conversation answers nothing. No action runs in another session to build it.
- `recordedWorkViewRef()` with `{ requestId }` is a session view on the coding worker flow, at its `recordedWork` name. It answers a run's plan and the pull requests it opened, with their links.
- The `harnesses` flow is now built through workforce's `flows` slot. Its `readiness` view is unchanged.
- `landedOf` and `LandedWork` are exported from `@flow-state-dev/harness-manager/browser`.

Docs: packages/harness-manager/README.md (list `codingBoardViewRef`, `recordedWorkViewRef`, `landedOf`); the Views page's "reading your sessions" section names the coding board as a user view reading across kits.
