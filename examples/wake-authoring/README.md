# Wake authoring — three shapes, one dispatch door

A worker author should be able to see **when they run** and **what runs** without hunting host mounts. Today that answer is split: cron lives on `schedules.static`, GitHub lives on `webhooks[provider].on`, and a channel poke is a different layer entirely.

This example puts those three arrivals on one inbox-watch scenario and authors them three ways. Each L1 shape compiles to the bindings that already exist. Nothing here is a Heartbeats product, a second dispatch bus, or runtime work for [FIX-1634](https://linear.app/fixpoint-labs/issue/FIX-1634).

**The question it turns on:** where should a worker author write “every 15 minutes, and when GitHub opens an issue”? On the flow, in the worker file, or under a `wakes:` alias?

## Comparison

| Shape | Where config lives | When it fires | What runs | Host requirements |
| --- | --- | --- | --- | --- |
| **1. Flow-config** (`src/flow-config.ts`) | `defineFlow` → `schedules.static` + `webhooks[provider].on` via `defineScheduleBinding` / `defineWebhookBinding` | Cron: host POSTs `/api/flows/:kind/schedules/sweep-open/dispatch`. Webhook: verified `POST …/webhooks/github` whose `X-GitHub-Event` is `issues` and `payload.action` is `opened`. | `sweep-open-tickets` (new session each tick). `record-inbound-issue` (session `repo#number`). | `@flow-state-dev/scheduled` adapter + a clock that POSTs. Webhook adapter with `githubWebhookVerifier` + `eventType` from the header. Secrets stay on the host (`src/host.ts`). |
| **2. Worker-MD** (`src/worker-md/WORKER.md`) | Frontmatter `wakes:` plus an in-doc table. `compileWorkerWakes` expands cron/webhook rows into the same maps. | Same L1 doors as row 1, for the rows that compile. Channel `desk-poke` does **not** fire an L1 binding. | Same L1 handlers, when compiled onto a kind. Channel row is a leftover. | Same L1 host as row 1. **Plus a compile step the loader does not run.** `hireWorkforce` treats leftover frontmatter as flow *config* and refuses `wakes` on a closed `configSchema`. |
| **3. `wakes:` alias** (`src/expand-wakes.ts`) | `expandWakes([{ type: "cron" \| "webhook", … }])` → `{ schedules, webhooks }` assigned onto `defineFlow`. There is no `wakes` field on `FlowDefinition`. | Same as row 1. | Same as row 1. | Same as row 1. Naming only — no new route. |

The cron string is display/validation. FSD does not run the clock.

A scheduled dispatch always starts a **new** session (`sessionId` is undefined on that transport). Webhook `sessionId` is find-or-create. Delivering into an existing session from a BullMQ `dispatcher({ session: { id } })` is the [FIX-1634](https://linear.app/fixpoint-labs/issue/FIX-1634) fence — not solved here.

`epic-wake` (`.agents/workflows/epic-wake.js`) is Lab / former Conductor tooling, now DevForce. It is not a customer wake.

## Run it

Handlers are deterministic. No API key.

```bash
cd examples/wake-authoring
pnpm test
pnpm typecheck

# What the table says, as a flow result
pnpm fsdev run inbox-watch-flow inspect -i '{}'
pnpm fsdev run inbox-watch-worker sweep -i '{"reason":"manual"}'
pnpm fsdev run inbox-watch-alias record -i '{"provider":"github","repo":"acme/app","issueNumber":12,"title":"Login loop"}'
```

`src/host.ts` is the mount sketch (scheduler + GitHub verifier). `fsdev.config.ts` skips those adapters so inspect/sweep/record run locally.

## Architect notes

### Clearest for whom

**Flow authors — variant 1.** One file, typed helpers, fire conditions next to the binding. This is the published surface. The 24/7 guide should teach it.

**Worker authors — variant 2 is where they already look**, and the table in `WORKER.md` is the only shape that puts cron, webhook, and a channel poke in one list. That list is a lie today if you expect hire to honor it. Extra frontmatter keys become seat *config*. Schedules and webhooks live on the *kind*. Leaving `wakes:` on `declared` refuses at hire. Compiling onto `defineFlow` works, and then every seat of that kind shares the same wakes — two workers with different timers need two kinds, or a hire-time merge that does not exist.

**Variant 3 is the same as variant 1 with a grouping word.** I would take it as docs sugar if we want one noun in examples, not as a core API. Spreading `expandWakes` is enough; minting `FlowDefinition.wakes` is a second spelling of a map we already have.

### Layer 1 vs Layer 2

| Arrival | Layer | Door |
| --- | --- | --- |
| Cron tick | L1 inbound transport | Host clock → scheduled dispatch → `host.dispatch` |
| GitHub / Slack / Stripe | L1 inbound transport | Host verify → webhook binding → `host.dispatch` |
| Channel post | L2 Workforce | `CHANNEL.md` members → `onChannelPost` / `wakeMemberSeats` |
| `dispatcher({ session: { key } })` | L1 delivery | Child / adopt session |
| `dispatcher({ session: { id } })` on BullMQ | L1 delivery, fenced | FIX-1634 — do not invent a workaround noun here |

YAML cannot hold `input` / `when` / `sessionId` functions. Variant 2 therefore needs a **named mapper catalog** (`action: opened`, `session: issue`, `event: issues`). That catalog is the compile step, not a new bus. An unknown event becomes a leftover, not a guessed handler.

### What I would take forward

Teach variant 1 in the FIX-1637 guide. Keep variant 2 as evidence that a worker-file `wakes:` list is readable **and** that hire cannot apply it without a kind-level compile (or a new hire merge). Offer variant 3 only if the guide wants one heading for “inbound arrivals.” Do not mint a Heartbeats noun. Do not reopen Relay.

Experimental example for FIX-1637, not production code. Review direction, not polish.
