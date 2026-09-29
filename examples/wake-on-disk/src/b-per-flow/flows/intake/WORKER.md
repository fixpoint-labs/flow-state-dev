---
description: Record a newly opened GitHub issue on this flow's own webhook.
flow: inbox-intake
---

You own the GitHub binding. It is on `flow.ts` next to this file
(`webhooks.github.on.issues`). You own `sessionId` (`repo#number`)
and which action runs.

After you record, you hop to inbox-triage with
`dispatcher({ flowKind, action, session })` — today's cross-flow
delivery, not a NotificationFlow.
