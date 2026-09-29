# 2 — Fan-in webhook + route rules

One GitHub URL receives everything. Rules on the desk worker pick the
session and the seat. Those rules **compile** to today's `webhooks.on`
(`when` + `sessionId`) plus `dispatcher({ flowKind, action, session })`.

```
2-fan-in-route/
  host.ts                         ← same GitHub registration; one desk URL
  workers/desk/WORKER.md          ← route: list (what an end user would see)
  workers/desk/route-rules.ts     ← compile → webhooks.on + leftovers
  workers/desk/kind.ts            ← compiled bindings live here
  workers/intake/kind.ts          ← no webhook
  workers/reviewer/kind.ts        ← no webhook
  leftover/CHANNEL.md             ← a route row that does not compile
```

How an end user would see it: the seat file lists rules, not a TypeScript
ingress. Hire does not apply `route:` — same closed-schema refusal as
`subscribe:` and #2369 `wakes:`.

This is close to #2370 A (one URL, then hop) and not #2370 B (each flow
owns `webhooks.on`). The difference from A is *where the rules are
written*: worker config on disk, compiled onto the desk kind.

`sessionId` here is delivery-time find-or-create from the payload. That
is today's model. It is not style 1's "this session asked first."

`{ key }` not `{ id }`. BullMQ `{ id }` is FIX-1634 — pointer only.
