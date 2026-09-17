# FIX-1355 · the premises the spec rests on, run

Throwaway. Never merges — see [`spec-poc/README.md`](../README.md).

[DECISIONS → Settled](../../spec/FIX-1355/DECISIONS.md#settled) originally marked every premise
CONFIRMED off a **read** of merged code, because the spec worktree carried no install. Review
called that out twice. The install turned out to cost seven seconds.

The first pass ran only the two premises where being wrong moved the *shape*, and argued the rest
could stay read because being wrong about them was cheap. Review upheld against that, correctly:
BP-003 says *"execute or parse it, don't read it"* about **every claim the change rests on**, and
attaches no cost exemption. The cost boundary was a reasonable engineering instinct and it was not
what the BP says. So all of them now run.

| Premise | Load-bearing for | Check |
|---|---|---|
| A channel fan-out cannot wake the built-in `agent` kind | D3 | `check-agent-kind-has-no-internal-entry.mts` |
| `openChannels` has nowhere to put an `orgId` | S4, ER-14 | `check-no-org-door.sh` |
| A `{ key }` delivery creates the seat session and inherits the sender's org | S3 | `check-key-child-created-and-inherits-org.mts` |
| A dispatcher addresses one hired seat by its exact instance id | S3 | same file |
| A delivery never crosses an org boundary | the client wrap | `check-org-boundary-refusal.mts` |
| A seat's skills reach a custom kind that declares the key | BR-3 | `check-seat-skills-reach-a-custom-kind.mts` |

## Run them

```bash
bash spec-poc/FIX-1355-runtime-premises/check-all.sh
```

Prerequisites, because a bare worktree has none (`TS6305` is the tell, and it presents first as a
broken workspace import):

```bash
pnpm install
pnpm --filter @flow-state-dev/contracts --filter @flow-state-dev/core \
     --filter @flow-state-dev/orchestration build
pnpm --filter @flow-state-dev/engine build      # engine BEFORE testing and workforce
pnpm --filter @flow-state-dev/testing build
pnpm --filter @flow-state-dev/workforce build
```

Sixteen assertions, all green on current `main`. Every one of them has a control.

## What makes each one fail

A check nobody can make fail has verified nothing, so each carries its red state **in the run**
rather than in a claim about the run. That discipline caught two false greens while these were
being written, which is the argument for it.

**The agent kind.** Asserts an `internal` dispatch resolves nothing on the built-in kind, under
`run` and under every other name a fan-out might address. Three controls: the probe *does* resolve
that kind's public `run`; it *does* resolve a real internal entry on a flow that declares one; and
`internal` does not fall through to a public action of the same name. Add an `internal.actions`
entry to `agent-worker-flow.ts` and it goes red.

**The org door.** An **absent field**, so nothing observes it at runtime — the evidence is a
compile that must fail. The probe passes `orgId` at both doors; the script asserts the *exact* two
`TS2353` diagnostics and no others. A bare non-zero `tsc` would have been a neighbour-of-the-claim
pass: any unrelated type error would have read as proof.

**The `{ key }` child.** This is the premise round 1's own P1 fix rests on, which is why it gets
the most. It runs a real channel fan-out over two declared members and asserts each seat ran, in
its own session, on its own hired instance, with the sender's org both in the running request and
persisted on the created record. The control runs the identical wiring with `session: { id }` —
the shape the plan carried *before* round 1 — and asserts the refusal **by name**:

```
session-not-found — no session "pentest.recon.session" is reachable from this request
```

That control started out asserting only "no seat ran", and went green while the harness was not
dispatching at all. Asserting the reason is what caught it.

**The org boundary.** Both directions, because one alone proves nothing: a same-org delivery into
an existing session must **land**, and a cross-org one must be refused as
`session-not-addressable`. A blanket refusal would otherwise read as a pass.

**Seat skills.** The claim is *conditional* — imposed on a kind that declares `seatSkills`, and
only on such a kind — so both halves are asserted. A kind that declares the key receives the
union; a kind that does not is left alone and still hires. Without the second half the check would
stay green if `hireWorkforce` began imposing the key unconditionally, which is the specific
regression the conditional exists to prevent (one shared `org/skills/` folder would otherwise
break every custom kind on the roster at once).

## Scope

These pin **how the framework behaves today**, so the spec's premises are not guesses. They are
not the lab, and they do not stand in for the gate (VG) or the model-backed check (VM) that
FIX-1355 actually delivers. Nothing here ships: the implementation branch is cut from fresh
`origin/main`.
