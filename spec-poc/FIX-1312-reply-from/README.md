# POC — reply to who dispatched me (FIX-1312 + FIX-1171)

Throwaway. Never merge. The question: can a dispatched child deliver a real
request back into the session that sent it, using only the seam-stamped
`from`, without treating `settleParentTask` as that path?

## Run it

```bash
pnpm --filter @flow-state-dev/core test dispatcher.test.ts
pnpm --filter @flow-state-dev/engine test dispatch-reply-from.test.ts
```

## What it showed

Request A (`start`, session `s_parent`) dispatches to B (child, `{ key: "job" }`).
B replies with `session: { from: true }`. Request C runs `receive` on `s_parent`.

The reverse address is a third `dispatcher()` session target, not a new verb,
not a second bus, not `ctx.dispatch`, not a message board. The seam reads
`metadata.dispatch.from.sessionId` through `readDispatchStamp` and then uses
the existing `{ id }` guards (principal, tenant, flow, org, incarnation).

A public action with `{ from: true }` refuses `no-sender`, including when the
HTTP body carries a perfectly shaped `metadata.dispatch.from`.

`settleParentTask` on that same child refuses `no-parent-task`. Board-row
settle and reverse delivery are two verbs. A task child can do both; this
POC does not wire a board.

## Deliberately not built

- Strands (FIX-1170 / FIX-1169) — which train, not the address
- Cross-flow address kind
- Workforce message board, pi, Conductor TUI
- A product docs / changeset land
