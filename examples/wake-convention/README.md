# Transports register by folder. Seats own the wake.

A builder keeping a desk alive still cannot point at one folder and see
**which events exist**, **which seat wakes on them**, and **which seat
wakes on a clock**. Today those answers live on each flow
(`schedules.static`, `webhooks[provider].on`). #2369/#2370/#2372 stay
inside that ownership — they compile or subscribe *onto* it.

This tree leaves that ownership. Transports and the events they produce
register the way seats and blocks already do: **a folder is the
registration**. A worker or channel folder then **references** those
ids, or writes a seat-local clock.

[FIX-1637](https://linear.app/fixpoint-labs/issue/FIX-1637/epic-keeping-flows-alive-247).
Sibling explore to [FIX-1641](https://linear.app/fixpoint-labs/issue/FIX-1641/poc-wake-authoring-shapes-worker-md-vs-flow-config)
(#2369 / #2370) and [FIX-1643](https://linear.app/fixpoint-labs/issue/FIX-1643/poc-register-providerstransports-workerchannel-subscribe-route-rules)
(#2372). No child id yet — cite the epic until LM files one. **Explore —
not locked.** Not a product pick.

This example does not mint a Heartbeats product, does not implement
FIX-1634, and does not reopen FIX-441 NotificationFlow.

## The tree

```
examples/wake-convention/
  transports/                         ← host registry, by convention
    github/TRANSPORT.md + events/*.md
    slack/TRANSPORT.md  + events/*.md
    scheduled/TRANSPORT.md + events/tick.md
  workers/                            ← config locus
    night-watch/WORKER.md             ← wake: every 4 hours
                schedule.yaml         ← same clock, richer form
                hooks.yaml            ← github.issues.opened
                kind.md               ← actions only; no schedules/webhooks maps
    reviewer/WORKER.md + hooks.yaml   ← github.pull_request.review_requested
    triage/WORKER.md                  ← no clock; a dispatcher hop lands here
  channels/support-desk/              ← leftover poke, not a catalog event
  src/walk.ts                         ← proposed readers (data, not compile)
```

A real workforce tree would nest seats under `teams/<id>/workers/<name>/`.
The locus is the folder, not the org layout, so this sketch keeps the
folders flat.

## Contrast

| | **Today — per-flow bindings** | **#2372 subscribe / route** | **This convention** |
| --- | --- | --- | --- |
| **Who registers GitHub** | Host code (`providers.github`) | Host code, named once | `transports/github/` on disk |
| **Where events are listed** | Each flow's `webhooks.github.on` | Same maps, after compile | `transports/*/events/` catalog |
| **Where cron lives** | `flow.schedules.static` | Not that PR's question | The worker folder (`wake:` / `schedule.yaml`) |
| **Who listens** | The flow that declared the binding | A session subscribe table, or desk `route:` compiled onto the kind | The worker/channel folder that references the catalog id |
| **Exists today?** | Yes | Subscribe table no; fan-in compile-to yes | **Proposed.** Walkers here are the sketch. Hire refuses `wake:`. |
| **Compile to today's maps?** | n/a | Style 2 does | **No.** Re-architecture is the point. |

#2372 asks *once GitHub is registered, does a session subscribe or does
one webhook route?* This tree asks a prior question: **what is the
config system**, such that registration and reference have a place on
disk?

Delivery is still `dispatcher({ flowKind, action, session })`. Session
targeting uses `{ key }`. `{ id }` on a BullMQ host is
[FIX-1634](https://linear.app/fixpoint-labs/issue/FIX-1634) — pointer
only.

`epic-wake` is Lab / DevForce tooling, not a file here.

## What is real vs proposed

**Real today**

- Flow-owned `schedules.static` and `webhooks[provider].on`.
- Host `createWebhookTransportAdapter({ providers })` and the scheduled adapter.
- `dispatcher({ flowKind, action, session })`.
- Layer-2 file convention: `WORKER.md`, `CHANNEL.md`, `blocks/*.ts`.
- Hire's closed `workerConfigSchema()` — extra frontmatter is refused.
- FIX-1342: the framework does not runtime-import seat files as config modules.

**Proposed (do not exist)**

- `readTransportRegistry` / `readSeatWakes` — the walkers in `src/walk.ts`.
- A host that mounts adapters from `transports/` and reads wakes from seat folders.
- Cron POST addressing a seat folder rather than `/api/flows/:kind/schedules/:id`.
- `wake:` on `WORKER.md`, `schedule.yaml`, `hooks.yaml` as admitted config.

**Rejected spelling**

- `webhooks.ts` in the seat folder, imported by the host. That is
  `WorkerManifest.ts` again.

**Fictional / leftover**

- Channel poke. Named leftover, not a catalog event.
- `github.issues.closed` on the reviewer — referenced, not registered, so the walk lists it as leftover. That is the catalog earning its keep.

## Run it

No API key. The walk reads the tree.

```bash
cd examples/wake-convention
pnpm test
pnpm typecheck
pnpm inspect
```

## What this is not

- Not #2369 compile sugar (`wakes:` alias, hire-gap as the finding).
- Not #2370 A/B (central ingress vs per-flow maps — both still flow-owned).
- Not #2372 subscribe/route (still compiles onto today's bindings).
- Not a Heartbeats product.
- Not FIX-1634 runtime work.
- Not FIX-441 NotificationFlow. The hop is `dispatcher`.
