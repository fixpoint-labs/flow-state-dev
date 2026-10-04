# FIX-1443 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md)

The FSD Architect's amended fence binds: *"lab-local only — remove obsolete org-inject wrap + stale
lab docs teaching the gap. After FIX-1442, openChannels no longer takes orgId — do NOT pass orgId;
re-derive no-org-wrap (may need principal/dev-org alignment, not a client wrap). Out: framework
require-org / principal pass; reopening FIX-1412/1442."* It supersedes the issue's first desired
outcome, "`host.mts` passes `orgId` to `openChannels`". That parameter no longer exists.

<a name="d1"></a>
## D1 · Decided: the lab names its org through a host-level `resolvePrincipal`

`createFlowState({ resolvePrincipal: () => ({ userId: LAB_USER_ID, orgId: LAB_ORG_ID }) })`. Every
request the lab sends through the router, channel session creation included, resolves to the
lab's user in the lab's org. The session route binds that org, and the `runAction` calls, which
already pass `LAB_ORG_ID`, match it.

| Option | Org the lab runs as | Keeps "channels open through the real session routes" | Framework change |
|---|---|---|---|
| **Host `resolvePrincipal` (chosen)** | `org_pentest_lab` | Yes | None, it's an existing public option |
| Write sessions straight to the store, as `manager-queue-lab` does | `org_pentest_lab` | No: the gate's Signal names the real routes | None |
| Drop `LAB_ORG_ID` and act as the development default | `__fsd_default_org__` | Yes | None, but it changes the org the lab runs as |
| Delete only the two wrap lines | `__fsd_default_org__` (the same as now) | Yes | None, and the lab stays red |

- **Why this isn't a sign-off ask:** the fence names this alignment. The org is the one
  `LAB_ORG_ID`, the verdict log and every document binding already use. The only other option
  that keeps it gives up the gate's stated signal.
- **Locks in:** the lab passes on current `main`. The org the lab runs as is written in one
  place, and that place is the seam a real app uses.

<a name="d2"></a>
## D2 · Decided: `no-org-wrap` becomes `no-principal-org`

The control leaves the resolver out, so the channel session binds to the development default while
`runAction` still acts as `org_pentest_lab`. It fails on the first read with the mismatch named.
It still has a job. It shows the org is load-bearing, and that the lab's org reaches the channel
session through the resolver and nowhere else.

- **Instead of:** deleting the control. Without it, "the resolver is what binds the org" has no
  red state (BP-003).
- **Out of scope:** the other direction. The control proves that *leaving the resolver out*
  fails; it doesn't prove that a resolver returning a *different* org fails. That would take a
  second control or an org override on this one, which is more surface than this issue needs.

<a name="d3"></a>
## D3 · Decided: BR-16's org-less probe goes to `runAction`

Since FIX-1442, a request coming through the router always has an org. Either the resolver
supplies one, or the host supplies the development default. So the router can't produce the
"org-less request refused `OrgRequired`" that the gate grades. With D1's resolver, the old HTTP
probe *succeeds*: the POC showed this before the probe was moved. `runAction` now refuses a
missing org itself, with `OrgRequiredError` at stage `"runAction"`
(`packages/engine/src/execution/runAction.ts`), so the probe sends the same `inspect` there with
no org. The half that must succeed is unchanged. The claim BR-16 names is unchanged. Only its
evidence path moves.

- **Deliberately dropped:** after this, nothing in the gate exercises "the HTTP route refuses a
  caller with no org". That is unreachable by construction, not weakened: the router always has
  an org. The router-side refusal is FIX-1442's to prove, and it does, in
  `packages/engine/test/transports/host.test.ts` → "validateDispatch — the envelope carries an
  organization", which the action route calls before dispatch.

## Engineering calls

- **E1 · The resolver ignores the request.** A lab has one caller. Reading `body.userId` would
  bring back the caller-controlled input FIX-1442 removed (BP-031).
- **E2 · Remove `omitOrgWrap` from `OpenLabOptions` and add `omitPrincipal`.** A removed key isn't
  kept as an alias. The lab is private and has one caller.
- **E3 · Fix `devforce-lab`'s pointer, and name one reference.** Its host comment says the
  pentest lab "still carries an `omitOrgWrap` control". After this change that is false (BP-034).
  It also calls `manager-queue-lab` "the current reference" while this lab's README teaches the
  resolver. Pick one: the pentest lab's host `resolvePrincipal` is the reference for how a lab
  gives `openChannels` the right org, since it is the seam real apps use and it keeps the real
  routes. The devforce comment says so and keeps "shaped after `manager-queue-lab`" as a
  description of its own code, not as the reference. Comment only.

## Open

None.

<a name="settled"></a>
## Settled

- **The resolver alignment turns both checks green, and the control still fails.** Settled by
  [`poc/principal-alignment/`](poc/principal-alignment/), applied to `main` at `7dd56cd74`. The
  gate ran PASS on all ten legs. `GOAL_CONTROL=no-org-wrap` (the POC's name for `no-principal-org`)
  ran FAIL with *"bound to org `__fsd_default_org__` but request supplied org `org_pentest_lab`"*.
  The model-backed sibling (`vercel/openai/gpt-5.4-mini`) ran PASS on 2 of 3 runs. The failing
  run's fan-out never settled and put 0 lines in the transcript. The runs either side of it passed
  with nothing changed, so that looks like model latency, not wiring. On unpatched `main`, both
  checks fail at the channel read.

## How it got here

- **Draft:** written from the issue, the Architect's amended fence, and `main` at `7dd56cd74`. The
  fence and the title disagreed about whether `openChannels` takes an `orgId`. `main` sides with
  the fence.
