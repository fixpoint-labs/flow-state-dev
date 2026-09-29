# B — per-flow locus

Each flow owns when it wakes, which action runs, and how session id is chosen.

```
b-per-flow/
  flows/sweep/flow.ts + WORKER.md     ← owns the cron
  flows/intake/flow.ts + WORKER.md    ← owns the GitHub hook + sessionId
  flows/triage/flow.ts + WORKER.md    ← hop target only
  host.ts                             ← verify + one POST *per* scheduled flow
  leftover/CHANNEL.md                 ← Layer 2 leftover
```

## When each file fires

| File | When it fires | What runs | Who owns session id |
| --- | --- | --- | --- |
| `flows/sweep/flow.ts` | Host POSTs `…/inbox-sweep/schedules/sweep-open/dispatch` every 15 min. | `sweep-open-tickets` | This flow. New session each tick. |
| `flows/intake/flow.ts` | Verified `POST …/inbox-intake/webhooks/github` (`issues` + `opened`). | `record-inbound-issue`, then `dispatcher({ flowKind: "inbox-triage", action: "note", session })` | This flow. Webhook `sessionId` is `repo#number`. |
| `flows/triage/flow.ts` | Only after intake hops. | `note-triage` | Hop `{ key: repo#number }` on `inbox-triage`. |
| `leftover/CHANNEL.md` | A post on the channel. | Layer 2 notify. Not an L1 binding. | Channel session. |

The hop is `dispatcher({ flowKind, action, session })` — today's cross-flow delivery. Not FIX-441 NotificationFlow. `{ key }`, not `{ id }`. BullMQ `{ id }` is FIX-1634 (pointer only).

## Host ops

`host.ts` still holds the secret and the verifier. The scheduler must POST **each** flow that declared a cron. GitHub hits **this** intake URL. A second flow that also wants `issues` is a second webhook URL (or GitHub delivering twice).
