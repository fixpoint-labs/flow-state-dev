# A — central locus

One file says when the desk wakes. That file decides which seats run.

```
a-central/
  ingress/night-watch.ts          ← schedules + webhooks live here
  host.ts                         ← verify + the one schedule POST
  workers/sweep/WORKER.md + kind.ts
  workers/intake/WORKER.md + kind.ts
  workers/triage/WORKER.md + kind.ts
  leftover/CHANNEL.md             ← Layer 2 leftover
```

## When each file fires

| File | When it fires | What runs | Who owns session id |
| --- | --- | --- | --- |
| `ingress/night-watch.ts` | Host POSTs `…/night-watch/schedules/sweep-open/dispatch` every 15 min (UTC). Verified `POST …/night-watch/webhooks/github` whose event is `issues` and `action` is `opened`. | `dispatcher({ flowKind: "night-sweep", action: "sweep", session })` or `… night-intake / record`. | Cron: new session on `night-watch` each tick. Webhook: `sessionId` is `repo#number` on `night-watch`. |
| `workers/sweep/*` | Only after that hop. No own cron. | `sweep-open-tickets` | Hop `{ key: "night-watch-sweep" }` on `night-sweep`. |
| `workers/intake/*` | Only after that hop. No own webhook. | `record-inbound-issue`, then hop to triage | Hop `{ key: repo#number }` on `night-intake`. |
| `workers/triage/*` | Only after intake hops. | `note-triage` | Hop `{ key: repo#number }` on `night-triage`. |
| `leftover/CHANNEL.md` | A post on the channel. | Layer 2 notify. Not an L1 binding. | Channel session. |

The hop is `dispatcher({ flowKind, action, session })` — today's cross-flow delivery. Not FIX-441 NotificationFlow. Session targeting uses `{ key }`, not `{ id }`. `{ id }` on a BullMQ host is the FIX-1634 fence (pointer only).

## Host ops

Secrets and the clock stay in `host.ts`. GitHub still hits **one** URL. Adding another seat means an extra dispatcher row on the ingress, not a second webhook endpoint.
