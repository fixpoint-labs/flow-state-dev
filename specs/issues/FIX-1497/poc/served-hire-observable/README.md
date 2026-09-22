# POC · a served hire is something the DevTool can open

A throwaway experiment retained as design evidence for [FIX-1497](../../SPEC.md). Not production
code, not a workspace package, and in no default build, test, lint or knip discovery. Nothing
imports it. The `package.json` beside it exists only so its modules load as ESM.

## The premise it settles

FIX-1497 grades a handoff that a person can see. Every acceptance row in
[BUSINESS-RULES.md](../../BUSINESS-RULES.md) therefore rests on one claim that could not be read
off source:

> Seats and a channel minted from a Markdown tree are ordinary registered flow instances, and the
> shipped `fsdev dev` will serve them — so the DevTool's navigator has a hire to open, and the
> scenario's doors are the framework's own rather than something written to make the inspection
> possible.

If that were false, "observed in DevTool, with no special wrapper" would need a different shape
entirely, and the spec's plan would be wrong from its first surface.

## What it runs

`check.mts` spawns the real `fsdev dev` against `flows/`, from a scratch working directory, and
reads the real catalog at `GET /api/flows`. The tree under `workforce/` is three `WORKER.md` files
and one `CHANNEL.md` declaring `boards: [work]`; `hire.ts` reads it, builds two kinds, and hires.
Nothing writes a ledger id — the framework mints it from where the channel folder sits.

| Leg | The claim | Observed |
|---|---|---|
| a | The served catalog carries every seat the tree declared, plus the channel | `channel, eng.builder, eng.planner, eng.reviewer` |
| b | Two seats sit on **one** kind, each a `collection` copy the navigator can open alone | both `eng.builder` and `eng.reviewer` are kind `worker`, cardinality `collection` |
| c | The scenario's doors are the channel's own | `fileTask, post, read, readBoard` |
| d | Each worker seat carries a drain **and** a door a person answers through | `eng.builder: answer, drain` · `eng.reviewer: answer, drain` |
| d | The planner files and never drains | `eng.planner: file` |

Run it:

```bash
# Once per checkout: fsdev dev refuses to start without a built DevTool bundle.
pnpm --filter @flow-state-dev/devtool build
pnpm --filter @flow-state-dev/devtool build:assets

pnpm tsx specs/issues/FIX-1497/poc/served-hire-observable/check.mts
```

**Both build steps, in that order, and not the CLI's suggestion.** `fsdev dev`'s error names
`cd apps/devtool && pnpm build`, which fails on a clean checkout — that app's build typechecks
against `packages/devtool`'s declarations, so the package has to be built first. And only
`build:assets` populates `packages/devtool/dist-client`, which is the copy that resolves through
`node_modules` from **any** working directory; `apps/devtool/dist` is found only when the server's
cwd is the repository root, and this probe deliberately runs the server in a scratch directory so
it cannot read or pollute the repo's own `.fsdev/data`. If you skip this, the check now fails
naming these two commands rather than timing out.

## Both controls were run

A green check nobody has watched fail is not evidence (tenet 7).

| Control | What it perturbs | Observed |
|---|---|---|
| `POC_CONTROL=no-tree` | The hire reads a directory that is not there | **FAIL**, naming all four registrations. **Coarse, and said so rather than dressed up**: the server does not start at all, so every leg goes red together and none is isolated |
| `POC_CONTROL=no-answer` | The worker kind is built without its answer action; the tree is untouched | **FAIL**, and *only* at the answer assertion — twice, once per worker seat. The server starts, every seat registers, every other leg stays green. This is the isolating red state `no-tree` does not give |

```bash
POC_CONTROL=no-tree   pnpm tsx specs/issues/FIX-1497/poc/served-hire-observable/check.mts
POC_CONTROL=no-answer pnpm tsx specs/issues/FIX-1497/poc/served-hire-observable/check.mts
```

## The stall, and what it turned out to be

While this was being written, **every** action POSTed to `fsdev dev` on the authoring box stalled:
`202`, a request record, `request.created` and `request.in_progress`, and then nothing — no items,
no settlement, nothing on the router's `onError`. It reproduced on the shipped
`goals/flow-instances/devtool-shows-the-selected-copy` fixture and on a three-line control flow
whose handler returns a constant, so it was never evidence about this hire. Two controls pointing
away from your own change is the shape of a substrate defect, so it was isolated rather than
disclosed and left.

**It is environmental, and here is the variable.** This sandbox exports `FSDEV_DEFAULT_MODEL` and
four `FSDEV_INTENT_*` overrides. With no flow declaring an intent, `createModelResolver` throws —
*"FSDEV_DEFAULT_MODEL was set, but no intents are declared; the override has no effect"* — and the
served path swallows it into a request that never advances.

The A/B, one variable, on the same three-line flow:

| Driver | Env | Result |
|---|---|---|
| `createFlowApiRouter` in-process, in-memory stores | stripped | **completed**, 1 item, 100 ms |
| `createFlowApiRouter` in-process, SQLite stores (what `fsdev dev` builds) | stripped | **completed**, 1 item, 100 ms |
| `fsdev dev` over a real socket | **inherited** | stalls at `in_progress`, 0 items, indefinitely |
| `fsdev dev` over a real socket | stripped | **settles in 0 ms**, with a correct refusal on its own terms |

`goals/lib/env` (`intentFreeEnv` / `stripIntentOverrides`) strips exactly this prefix set before
every goal run, which is why the shipped fixture has a green verdict elsewhere and stalled here.
`check.mts` **imports that helper** rather than copying it — a local subset could drift away from
the verdict it is evidence for — and the goal check must use it too. It
is a guardrail in [PLAN.md](../../PLAN.md).

**Two things follow.** [D1](../../DECISIONS.md#d1) stands: the served path executes. And the
*silent* shape of the failure — a throw about model resolution, on a flow with no generator in it,
surfacing as a request that never advances and never errors — is a sharp edge worth someone's
attention. It is **not diagnosed beyond the A/B above** and is not this issue's to fix; it is
raised up rather than worked around ([ER-17](../../../../epics/FIX-1457/BUSINESS-RULES.md#er-17)).

**This POC still grades registration only, and now that is a choice rather than a limit.** Driving
the scenario is the goal check's job ([PLAN.md](../../PLAN.md) V1–VG), and a registration probe
that also ran a scenario would be two checks wearing one verdict.

## Two limits worth naming

- **The imports reach into `packages/*/src` by relative path.** A spec folder is not a workspace
  package, so `@flow-state-dev/*` does not resolve from here. Same limit, same reason, as
  [FIX-1481's POC](../../../FIX-1481/poc/what-the-tree-can-say/run.mts). It is a property of where
  the file sits, not a claim about the package boundary.
- **The assignee→seat map is the app's, not the tree's**, and here it is derived from each
  `WORKER.md`'s own `answersFor` line — which means the tree sits on both sides of that
  association. Fine for a registration check, and **not** fine for the graded run: the real check
  owes the two-source discipline `goals/manager-queue-lab` already carries, which
  [PLAN.md](../../PLAN.md) names as a guardrail.
