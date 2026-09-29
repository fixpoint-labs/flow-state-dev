# Register once, then subscribe — two ways an event finds a session

A builder who registered GitHub on the host still cannot point at a seat
file and see **who is listening** and **how a delivery picks a session**.
#2369 showed compile/authoring shapes. #2370 showed where the clock lives
on disk. This tree is the same GitHub desk as **subscribe / route**.

[FIX-1641](https://linear.app/fixpoint-labs/issue/FIX-1641/poc-wake-authoring-shapes-worker-md-vs-flow-config) under [FIX-1637](https://linear.app/fixpoint-labs/issue/FIX-1637/epic-keeping-flows-alive-247). Sibling to #2369 and #2370, not a replacement. Not a product pick.

**The open question:** once the host has registered GitHub, does each session subscribe to a pull request, or does one webhook fan in and route by rules?

This example does not mint a Heartbeats product, does not implement FIX-1634, and does not reopen FIX-441 NotificationFlow. A channel, if shown, is Layer 2 leftover.

## The same desk

GitHub is registered **once** at the host (`registerGitHubTransport` is a name over today's `createWebhookTransportAdapter({ providers: { github } })`). Then an opened issue or a review-requested pull request has to find a session. After a record, hop once with `dispatcher({ flowKind, action, session })` — that is today's cross-flow delivery.

```
examples/wake-subscribe/
  README.md                          ← this file
  src/host.ts                        ← shared registration note
  src/shared/github-provider.ts      ← the real host API
  1-per-session/                     ← 1. Cloud-like subscribe
    README.md
    host.ts
    workers/reviewer/WORKER.md + subscribe.ts + kind.ts
    workers/triage/
    leftover/CHANNEL.md
  2-fan-in-route/                    ← 2. one webhook + route rules
    README.md
    host.ts
    workers/desk/WORKER.md + route-rules.ts + kind.ts
    workers/{intake,reviewer,triage}/
    leftover/CHANNEL.md
```

Walk 1: [`src/1-per-session/README.md`](src/1-per-session/README.md). Walk 2: [`src/2-fan-in-route/README.md`](src/2-fan-in-route/README.md).

## Comparison

| | **Today B — per-flow `webhooks.on` (#2370)** | **Today A — central ingress (#2370)** | **1. Per-session subscribe** | **2. Fan-in + route rules** |
| --- | --- | --- | --- | --- |
| **Who registers GitHub** | Host, once (`providers.github`) | Host, once | Host, once (same) | Host, once (same) |
| **Who listens** | Each flow's `webhooks.github.on` | Ingress flow's `webhooks.github.on` | A session, after it subscribed | Desk worker `route:` compiled onto the desk kind |
| **How a delivery finds a session** | Binding `sessionId` from the payload (find-or-create) | Ingress `sessionId`, then hop `{ key }` | Prior subscribe row (sketch — adapter does not consult this) | Rule `session:` → today's `sessionId`, then hop `{ key }` |
| **GitHub URL** | `POST /api/flows/:flowKind/webhooks/github` per listening flow | One ingress URL | Sketch: `/api/webhooks/github`. Today: no route on `pr-reviewer` | One desk URL (same shape as A) |
| **Exists today?** | Yes | Yes | No. Compile does not write `webhooks.on` | Compile-to yes. Hire does not apply `route:` |
| **Clarity on disk** | Flow author sees the hook next to the action | One ingress file answers the desk | Seat file says *this session, this PR* | Seat file lists rules. Seats have no hook |

Channel poke is leftover in both trees (`leftover/CHANNEL.md`). It does not become a subscribe row or a webhook.

`dispatcher({ flowKind, action, session })` is the hop. Session targeting uses `{ key }`, not `{ id }`. Delivering into an existing session with `{ id }` on a BullMQ host is [FIX-1634](https://linear.app/fixpoint-labs/issue/FIX-1634) — pointer only.

`epic-wake` is Lab / DevForce tooling, not a customer file here.

## What is real vs sketch

- **Real:** host `createWebhookTransportAdapter({ providers: { github } })`. Flow `webhooks[provider].on`. Binding `when` / `sessionId`. `dispatcher({ flowKind, action, session })`.
- **Sketch / compile-to:** `registerGitHubTransport` (name only). Style 2 `route:` → those bindings. Hire still refuses the key.
- **Fictional stub:** style 1 subscribe table, `matchSubscriptions`, `autoSubscribeFromReview`, a host URL that is not `:flowKind`. No `FlowDefinition` field was added.

## Run it

Handlers are deterministic. No API key.

```bash
cd examples/wake-subscribe
pnpm test
pnpm typecheck

# 1 — seat file + inspect (no webhook to fire)
pnpm fsdev run pr-reviewer inspect -i '{}'
pnpm fsdev run pr-reviewer review -i '{"repo":"acme/app","number":88,"title":"Login loop"}'

# 2 — what the compiled desk says
pnpm fsdev run github-desk inspect -i '{}'
pnpm fsdev run github-desk recordIssue -i '{"provider":"github","kind":"issue","repo":"acme/app","number":12,"title":"Login loop"}'
```

`host.ts` in each layout is the mount sketch. `fsdev.config.ts` skips those adapters so the commands above run locally.

## What this is not

- Not the #2369 compile sugar (`wakes:` alias, WORKER.md `wakes:` list).
- Not a remake of #2370 A/B. Those stay the locus-of-the-clock trees. This is who subscribes after the host registered GitHub.
- Not a Heartbeats product.
- Not FIX-1634 runtime work.
- Not FIX-441 NotificationFlow. The hop is `dispatcher`.
