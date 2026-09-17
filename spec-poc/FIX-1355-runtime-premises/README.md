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
| `openChannels` cannot thread an `orgId` through — though the client API has one | S4, FIX-1412 | `check-no-org-door.sh` |
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

Eighteen assertions plus a two-half compile check, all green on current `main`. Every one has a
control.

**Round 2 found three of these checks passing without discriminating** — the same defect they
exist to catch, in the checks themselves. All three are fixed, and each fix is described below.
Worth stating plainly: the probes were wrong in ways that made the evidence weaker than it looked,
and one of them was hiding a claim in the spec that was simply false.

## What makes each one fail

A check nobody can make fail has verified nothing, so each carries its red state **in the run**
rather than in a claim about the run. That discipline caught two false greens while these were
being written, which is the argument for it.

**The agent kind.** Asserts `instance.internal.actions` **directly** — the declaration itself, so
an entry added under *any* name goes red. Round 2 caught the earlier version probing five guessed
spellings (`run`, `brief`, `notify`, `onPosted`, `answer`): a kind gaining an internal action
called `wake` would have left D3's premise false and every assertion green. Three controls remain:
the probe *does* resolve that kind's public `run`; it *does* resolve a real internal entry on a
flow that declares one; and `internal` does not fall through to a public action of the same name.

**The org door — and the claim it corrected.** Round 2 found the spec wrong here, not just the
probe. The draft said an `orgId` was refused "at both doors". It is not:
`CreateSessionOptions` (`client/src/session-client/sessions.ts`) **declares `orgId?: string`**.
The old probe redeclared a local input type instead of deriving from `OpenChannelsOptions`, so its
second `TS2353` was an artefact of the redeclaration rather than a fact about the surface.

The true, narrower premise is that **`openChannels` cannot thread an org through** — its options
are `{ client, userId }` and the `createSession` it declares carries no `orgId`. That is *why the
wrap works*: the client can carry an org, the binder just won't, so a wrapper that injects one is
enough. The check now runs **both halves**, because either alone misleads — `no-org-door.probe.ts`
must **fail** to compile (derived from `OpenChannelsOptions`, so it reacts if that gains the
field), and `org-door-exists.probe.ts` must **compile** (the client does have one). The failing
half asserts its two exact `TS2353` diagnostics; a bare non-zero `tsc` would have been a
neighbour-of-the-claim pass.

This narrowed **FIX-1412** too: the ask is *thread the org through `openChannels`*, not *give the
client an org door*, which it already has.

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

**Seat skills.** Round 2 caught this one testing a shape no real kind has. `WorkerManifest.skills`
is `InitialSkill[]` — records of `{ name, skillMd, files? }` — and the earlier draft declared
`z.array(z.string())` and passed bare names, so its green said nothing about whether a realistic
kind receives the real union. It now uses loader-shaped records and the same `.strict()` object
schema the built-in kind declares, and asserts the **bodies** as well as the names, since BR-3
turns on two `port-scan` folders that differ only in body.

Three controls, because the claim is *conditional* — imposed on a kind that declares `seatSkills`
and only on such a kind. A kind that declares the key receives the union; a kind that does not is
left alone and still hires (without this, the check would stay green if `hireWorkforce` began
imposing the key unconditionally — one shared `org/skills/` folder would then break every custom
kind on a roster at once). And a kind declaring `seatSkills` as bare **names** is refused the real
union, which is the control that would have caught this file's own earlier draft:

```
worker "pentest.recon" — Flow "names-only" instance "pentest.recon" has an invalid
config bag: "seatSkills.0": Expected object, received string
```

## Scope

These pin **how the framework behaves today**, so the spec's premises are not guesses. They are
not the lab, and they do not stand in for the gate (VG) or the model-backed check (VM) that
FIX-1355 actually delivers. Nothing here ships: the implementation branch is cut from fresh
`origin/main`.
