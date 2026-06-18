---
"@flow-state-dev/core": minor
"@flow-state-dev/react": patch
"@flow-state-dev/devtool": patch
---

Add the `suspension_resume` item type and the resume replay read model, the foundation for continuing a suspended request under its own id.

- **`suspension_resume` item** — a new structural, client-visible (history-excluded), persisted item that records the resolution of a suspension: which suspension, how it resolved, by whom, and the injected resume payload. The DevTool renders it as a resume marker; the React client treats it as non-renderable (apps render their resume UI off the `suspension` item). The `suspension` item's documented visibility is corrected to `{ client: true, history: false }` to match how it resolves.
- **`buildReplayLog` / `ReplayLog`** — a log-as-source-of-truth read model keyed by a block's stable logical path (`${requestId}:${path}`). The core block executor consults it on re-entry: a block whose logical path already holds a committed output is injected rather than re-executed, with no duplicate trace emitted. Inert unless a `ReplayLog` is present, so existing execution is unchanged.
