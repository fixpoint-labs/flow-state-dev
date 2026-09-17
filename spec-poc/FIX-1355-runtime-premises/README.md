# FIX-1355 · the two premises the shape rests on

Throwaway. Never merges — see [`spec-poc/README.md`](../README.md).

[DECISIONS → Settled](../../spec/FIX-1355/DECISIONS.md#settled) originally marked every premise
CONFIRMED off a **read** of merged code, because the spec worktree carried no install. Review
called that out. The install turned out to cost seven seconds, so the two premises that are
load-bearing — the ones where being wrong moves the shape rather than a detail — are now **run**.

Both are characterization checks: they pin how the framework behaves **today**, and they are
built to go red the day it stops behaving that way.

| Premise | Where it's load-bearing | If it were false |
|---|---|---|
| A channel fan-out cannot wake the built-in `agent` kind | D3 | The lab needs no kind of its own; the shape gets smaller |
| `openChannels` has nowhere to put an `orgId` | S4, ER-14 | The client wrap is cargo and the follow-up is already fixed |

## Run them

From the repo root, after `pnpm install` and
`pnpm --filter @flow-state-dev/contracts --filter @flow-state-dev/core --filter @flow-state-dev/orchestration build`:

```bash
node_modules/.bin/tsx spec-poc/FIX-1355-runtime-premises/check-agent-kind-has-no-internal-entry.mts
bash spec-poc/FIX-1355-runtime-premises/check-no-org-door.sh
```

Both exit 0 and print `CONFIRMED` on current `main`.

## What makes each one fail

Neither check would be worth anything if it could not go red, so each carries its control in the
run itself rather than in a claim about the run.

**The agent kind.** The two assertions are that an `internal` dispatch resolves nothing on the
built-in kind, under `run` and under every other name a fan-out might address. Three controls sit
beside them: the same probe *does* resolve that kind's public `run` (so a green is not a broken
import); the same probe *does* resolve an internal entry on a flow that declares one (so a green
is not a blind probe); and `internal` does not fall through to a public action of the same name
(the precise behaviour D3's `no-entry` rests on). Add an `internal.actions` entry to
`packages/workforce/src/agent-worker-flow.ts` and assertion 1 goes red.

**The org door.** This premise is about an **absent** field, so no runtime assertion can observe
it — the evidence is a compile that must fail. `no-org-door.probe.ts` passes `orgId` at both
doors, and the shell script asserts the *exact* two `TS2353` diagnostics on `orgId` and no
others. A bare non-zero `tsc` would be BP-003's neighbour-of-the-claim: any unrelated type error
would read as a pass. Add `orgId` to `OpenChannelsOptions` and the probe compiles clean, which
the script reports as `REFUTED`.

## What they do NOT cover

The other three Settled premises are still read, not run — the dispatcher addressing a hired seat,
`seatSkills` reaching a custom kind, and the org-boundary refusal. Each is a detail of wiring the
implementer meets immediately and where being wrong costs a correction, not a redesign, so the
ladder stopped where the cost of being wrong stopped. The `{ key }`-child claim is read too, but
it was read closely this round: `resolveChildSession` in
`packages/engine/src/context/create-request-host.ts` builds the record with
`...(identity.orgId !== undefined ? { orgId: identity.orgId } : {})`, which is the org inheritance
S3 depends on.
