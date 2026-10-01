# FIX-1443 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

These are internal lab docs only. Nothing under `apps/docs` or any package README changes, and
there's no changeset (BP-022: `goals/` is private). The Architect's guidance applies: stop
describing the gap as open, and don't present an optional org as the product answer. The org
always comes from the verified caller.

## 1. `goals/pentest-lab/lab/README.md`

**Replace** the paragraph that begins "**The session client is wrapped to bind an org**" with:

> **The org is named once, where the host resolves who is calling.** `openLab` gives
> `createFlowState` a `resolvePrincipal` that answers "the lab's user, in the lab's org". A
> channel session is bound to the org of the caller that created it, never to anything in the
> request body, so this is what puts the channel and the seats in the same org. Every
> file-declared document is org-scoped, so a lab without it opens a channel under the
> development org that its own seats are then refused delivery into, by name. Leaving the
> resolver out is one of the gate's controls (`GOAL_CONTROL=no-principal-org`), and it fails at
> the first read.

**Delete** the bullet "**`openChannels` cannot thread an `orgId` through** (FIX-1412)…". Change the
section intro from "Two things it has to work around" to "One thing it has to work around".

## 2. `goals/pentest-lab/a-post-reaches-both-declared-seats/goal.md`

- **Signal, leg 5 (BR-16):** "a request carrying no org is refused `OrgRequired` at `runAction`,
  which is the door every action passes through, while the same read with the org lands."
- **Controls paragraph:** name `no-principal-org` wherever `no-org-wrap` appears.
- **Verdict log:** leave the dated rows as they are. Add rows for this change's gate PASS,
  `no-principal-org` FAIL (with its message) and sibling PASS.

## 3. `goals/pentest-lab/lab/host.mts` comments

**Header, the "fifth thing" paragraph**, becomes:

> The fifth thing: **the lab names its org at the host's `resolvePrincipal`**, the seam every app
> uses to say who a request is. A session's org comes from the caller that created it, so this is
> what binds the channel to the same org the seats act in. Leaving it out is the gate's
> `no-principal-org` control, and it fails.

**The session-client doc comment** becomes "The session client `openChannels` is handed: the real
session routes, unmodified. The org the channel session binds comes from the resolver above, not
from this body."

**The `CreateSessionOptions` comment** ("The `orgId` the wrap injects…") becomes "The fields
`openChannels` passes to `createSession`."

## 4. `goals/devforce-lab/lab/host.mts`

In the session-client comment, delete the sentence that begins "`goals/pentest-lab/lab/host.mts`
still carries an `omitOrgWrap` control", and replace "which is the current reference" so the
comment names one reference (E3): "Shaped after `goals/manager-queue-lab/lab/host.mts`. The
reference for how a lab gives `openChannels` the right org is `goals/pentest-lab/lab/host.mts`:
a host `resolvePrincipal`, with channels opened through the real session routes."
