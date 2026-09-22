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
pnpm tsx specs/issues/FIX-1497/poc/served-hire-observable/check.mts
```

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

## What this could not run, and why that is not a finding

**Nothing here exercises execution.** On the machine this was authored on, `fsdev dev` accepts an
action — `202`, a request record, `request.created` and `request.in_progress` on the stream — and
the run never advances. No items, no settlement, on a 30-second poll of the persisted record.

**That is the environment, and the control says so.** The same stall reproduces on the shipped
`goals/flow-instances/devtool-shows-the-selected-copy` fixture, which has a green verdict-log row
on a normal dev box, and on a three-line control flow whose handler returns a constant. A stall
that reproduces on a flow with no board, no channel and no seat is not evidence about a hire.

So this POC grades **registration only**, and the spec says so where it leans on it. The run half
is [PLAN.md](../../PLAN.md)'s V1–VG, on a machine where `fsdev dev` executes.

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
