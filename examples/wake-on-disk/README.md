# Night-watch on disk — two places the clock can live

A builder keeping a support desk alive overnight needs to see, on disk, **when it fires**, **what runs**, and **who owns the session id**. Draft PR #2369 showed compile/authoring shapes. This tree is the same night-watch **as files a customer would keep**.

[FIX-1641](https://linear.app/fixpoint-labs/issue/FIX-1641/poc-wake-authoring-shapes-worker-md-vs-flow-config) under [FIX-1637](https://linear.app/fixpoint-labs/issue/FIX-1637/epic-keeping-flows-alive-247). Sibling to #2369, not a replacement. Not a product pick.

**The open question:** one central file that fans out, or each flow owning its own schedules and hooks?

This example does not mint a Heartbeats product, does not implement FIX-1634, and does not reopen FIX-441 NotificationFlow. A channel, if shown, is Layer 2 leftover.

## The same desk

Every 15 minutes, sweep open tickets. When GitHub opens an issue, record it. After a record, hop once to triage with `dispatcher({ flowKind, action, session })` — that is today's cross-flow delivery.

```
examples/wake-on-disk/
  README.md                          ← this file
  a-central/                         ← A. one ingress owns wakes
    README.md
    ingress/night-watch.ts
    host.ts
    workers/{sweep,intake,triage}/WORKER.md + kind.ts
    leftover/CHANNEL.md
  b-per-flow/                        ← B. each flow owns its wakes
    README.md
    host.ts
    flows/{sweep,intake,triage}/flow.ts + WORKER.md
    leftover/CHANNEL.md
```

Walk A: [`src/a-central/README.md`](src/a-central/README.md). Walk B: [`src/b-per-flow/README.md`](src/b-per-flow/README.md).

## Comparison

| | **A. Central locus** | **B. Per-flow locus** |
| --- | --- | --- |
| **Where wakes live** | `a-central/ingress/night-watch.ts` only | `b-per-flow/flows/sweep/flow.ts` (cron) and `…/intake/flow.ts` (GitHub) |
| **Session ownership** | Ingress owns webhook `sessionId` (`repo#number`) and starts a new session per cron tick. Seats get a session from the hop `{ key }`. | Each flow owns it. Sweep: new session every tick. Intake: webhook `sessionId` is `repo#number`. |
| **Multi-flow fan-out** | One GitHub URL, one cron POST. Ingress adds a `dispatcher({ flowKind, action, session })` row per seat. | Host POSTs each flow that declared a cron. GitHub hits that flow's webhook URL. A second consumer is a second URL (or GitHub delivering twice). |
| **Secret / host ops** | Same adapters either way (`host.ts`: verifier + scheduler POST). A has one schedule path and one webhook path. | Same secrets. Scheduler must know every scheduled kind. Webhook URL is per flow. |
| **Clarity when it fires** | One file answers “when does the desk wake?” Seat `WORKER.md` files say they do not own the clock. | A flow author sees cron/webhook next to the action. There is no single desk-wide wake file. |

Channel poke is leftover in both trees (`leftover/CHANNEL.md`). It does not become a schedule or webhook.

`dispatcher({ flowKind, action, session })` is the hop. Session targeting uses `{ key }`, not `{ id }`. Delivering into an existing session with `{ id }` on a BullMQ host is [FIX-1634](https://linear.app/fixpoint-labs/issue/FIX-1634) — pointer only.

`epic-wake` is Lab / DevForce tooling, not a customer file here.

## Run it

Handlers are deterministic. No API key.

```bash
cd examples/wake-on-disk
pnpm test
pnpm typecheck

# A — what the central file says
pnpm fsdev run night-watch inspect -i '{}'
pnpm fsdev run night-sweep sweep -i '{"reason":"manual"}'

# B — what each flow says
pnpm fsdev run inbox-sweep inspect -i '{}'
pnpm fsdev run inbox-intake record -i '{"provider":"github","repo":"acme/app","issueNumber":12,"title":"Login loop"}'
```

`host.ts` in each layout is the mount sketch. `fsdev.config.ts` skips those adapters so the commands above run locally.

## What this is not

- Not the #2369 compile sugar (`wakes:` alias, WORKER.md `wakes:` list, hire-gap). Those stay on that PR.
- Not a Heartbeats product.
- Not FIX-1634 runtime work.
- Not FIX-441 NotificationFlow. The hop is `dispatcher`.
