# poc/page-facts — is the page true on `main`?

Retained as evidence. Nothing under `specs/` is built, tested or walked by `fsdev gen`, and
`knip` ignores `specs/issues/*/poc/**`. Three scripts, no new dependencies, nothing patched.
They import the packages' own source by relative path.

**One-time checks, not a gate.** The implementer runs them once, on the final page, in the
implementation PR ([PLAN V0–V2](../../PLAN.md#checks)). Nothing maintains them after that PR
merges. This README is the one place that says what they showed; the `*.evidence.txt` files
are the raw transcripts only.

## `names.mts` · every name on the page resolves

Reads the quoted prose and code in [`DOCS.md`](../../DOCS.md) (or `PAGE=<published file>`).
Every named import in a code fence must be exported by the package it names. Every inline code
span must be classified, and each classification is checked: an export, a property path on a
real type (`FlowDefinition`, `CreateFlowStateOptions`, `dispatcher`'s options), a union member
in source, or a route already published on a reference page. **A span nobody classified fails
the run** (totality). A concrete `/api/flows/<segment>/…` route must name the id of a flow the
page's code registers. The segment is the registered instance's id: for a singleton its `kind`,
for a collection member the id its factory was called with, never the `flows` map key. Each run
proves both shapes on one runtime. A singleton `kind: "billing"` registered as
`flows: { payments: billing() }` answers a webhook at `/api/flows/billing/…` (`202`) and 404s
`flow_not_found` at `/api/flows/payments/…`. A collection member of `kind: "tenant-billing"`
registered as `flows: { acme: tenantBilling({ id: "acme-billing" }) }` answers at
`/api/flows/acme-billing/…` (`202`) and 404s at both `/api/flows/tenant-billing/…` and
`/api/flows/acme/…`.

```bash
pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/names.mts                          # must PASS
CONTROL=planted       pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/names.mts    # must FAIL: notifyTopic not exported
CONTROL=unclassified  pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/names.mts    # must FAIL: totality
CONTROL=false-option  pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/names.mts    # must FAIL: dispatcher has no delay
CONTROL=wrong-segment pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/names.mts    # must FAIL: payments is the map key, not the flow's id
```

## `compile.mts` · every code fence compiles

Writes each TypeScript fence to a temp dir under its `title=` and compiles them together,
strict, against package source. A fixed preamble declares the three names the page leaves to
the reader (`recordPayment`, `generateMonthlyInvoices`, `StripeEvent`); an elided
`{ /* ... */ }` compiles as `{} as never`.

```bash
pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/compile.mts                        # must PASS
CONTROL=unminted pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/compile.mts       # must FAIL: flows: { billing } is not an instance
```

## `fence.mts` · the queue-host paragraph matches the runtime

Boots `createFlowState` with a dispatcher that has no `dispatchLocal`, which is how the host
decides "external" and what BullMQ's `createWorkerDispatcher` lacks. It consumes a queued job
with `runAction`, as `createFlowJobProcessor` does.

| Check | Claim on the page |
|---|---|
| F1 | A `{ key }` dispatch is enqueued |
| F2 | An `{ id }` delivery is refused `external-dispatcher`, and nothing is enqueued |
| F3 | A `{ from: true }` reply from a queued run, on a process with the external dispatcher (colocated), is refused the same way |
| F4 | A webhook whose `sessionId` names an existing session is enqueued, not refused |
| F5 | The same queued job consumed by a `worker-only` process (its own runtime over the same stores, no dispatcher): the reply goes in process and is not refused |

```bash
pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/fence.mts                          # must PASS
CONTROL=in-process pnpm exec tsx specs/issues/FIX-1639/poc/page-facts/fence.mts       # must FAIL all five
```

Under the control the same flow runs with no queue: the `{ id }` delivery, the `{ from: true }`
reply and the webhook all run in process, so F1–F4 go red, and F5 has no queued job to
consume. F3 and F5 are one job with two consumers, so each is the other's contrast.

## What it showed

- **Every name on the page resolves on `main`**, and each control fails on the one thing it
  planted. A route's flow segment is the flow's id (a singleton's `kind`, a collection
  member's instance id), never its key in `flows`: proved on the runtime for both shapes, and
  the page's routes and samples agree. [`names.evidence.txt`](names.evidence.txt).
- **Every code fence compiles, after four fixes the first draft needed.** The draft registered
  `flows: { billing }` (the flow type, not an instance), declared flows without `actions`,
  gave the bearer resolver a principal without `orgId`, and left the dispatcher's `key`
  callback untyped (`input` inferred as `unknown`). [`compile.evidence.txt`](compile.evidence.txt).
- **The fence holds, one row wider than the epic's draft, and scoped to the process.** F1, F2
  and F4 confirm the epic's ER-4. F3: a `{ from: true }` reply is refused when the run sending
  it is on a process with the external dispatcher. F5: from a `worker-only` worker it goes in
  process and is not refused. The refusal follows the process the sending run is in, for a
  reply as for `{ id }`. [`fence.evidence.txt`](fence.evidence.txt).
- **Not run:** a real Redis. The stub is the host's own discriminator, and the closure
  (FIX-1642) runs the page on a real BullMQ host.
