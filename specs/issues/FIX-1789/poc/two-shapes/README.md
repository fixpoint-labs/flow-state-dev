# POC · the worker contract, as a list and as a wrapper

An experiment retained as evidence for [FIX-1789](../../SPEC.md)'s
[Q1](../../DECISIONS.md#q1) and [Q2](../../DECISIONS.md#q2), both decided on 2026-10-06. Not
production code: nothing imports it, it has no package manifest, and it is outside default build,
test, lint and knip discovery ([specs/README.md](../../../../README.md)).

**After the gate.** Review of the merged POC found three gaps in the shared checks; the
[K legs](#after-the-gate-2026-10-06) pin them and the fixes. The legs above them are unchanged and
still record what the two shapes were compared on.

## The question

The epic left one call to this spec ([FIX-1786 Q1](../../../../epics/FIX-1786/DECISIONS.md#q1)):
where does an author say "this flow runs workers"? Two shapes, built side by side with equal effort:

| | **A · a list the installation keeps** (`list.ts`) | **B · a `defineWorkerFlow()` wrapper** (`wrapper.ts`) |
|---|---|---|
| The author writes | A plain `defineFlow`, composing `workerConfigSchema()` | `defineWorkerFlow({ kind, config, actions, shared, standardOnly })` |
| The installation writes | `{ coordinator: { flow, standardOnly: true } }` | `{ coordinator: coordinatorFlow }` |
| The checks run | Once per flow, when the installation registers its list | When the flow is defined; registration trusts the wrapper's mark |
| Standard-only lives | On the installation's entry | On the flow |

Both call the same three checks (`contract.ts`): the flow accepts the standard configuration, has
one door, and keeps private state off the org scope. So the legs measure **where** the checks run
and **who** declares what, not two different checks.

The epic also asked, under both shapes: can the private-state rule be checked from what a flow
declares, or does it need a gate at run time?

**What would make me pick the wrapper:** the list missing a requirement the wrapper catches, or the
wrapper holding every requirement with no second authority and no cost to existing flows.

## How to run it

```bash
pnpm install          # once per checkout
bash specs/issues/FIX-1789/poc/two-shapes/run.sh
```

It copies this directory into `packages/workforce/test` for the run and removes it afterwards.
The runtime legs use the real engine: `createFlowState` with in-memory stores and `runAction` for
two users of one org. Nothing in the scope or store layer is stubbed.

## What was observed

On `fbecfe6f2`: **19 passed**. Each assertion pins what is true, so a change shows up as a red test.

| Leg | Question | Observed |
|---|---|---|
| S1–S4 | Same verdicts? | Yes. Both accept the app's own flow, a coordinator with delegates in session state, and a flow writing a shared resource; both refuse a flow with no door and one keeping private notes at org scope, naming each; a worker can name only a registered flow. A flow that doesn't accept the standard configuration is refused by A at registration; B can't express one |
| T1–T2 | When is a broken flow refused? | B: where it is defined. A: when the installation registers it, at boot, before any worker runs. A's check is one exported function a library can call in its own tests |
| H1 | A flow that meets the contract by hand | A registers it, as `hire.ts` admits a hand-declared schema today. **B refuses it** for lacking the mark: the second authority `worker-config.ts` rejects on purpose |
| G1–G3 | Today's built-in `agent` | **Fails in both shapes**: its skills drawer is an org-scoped collection, so on a singleton every member's workers share it. Its config and door pass. B also refuses it until it moves onto the wrapper |
| G4 | `agent` taking tasks from a mailbox board | A second refusal: the board's ledger is at org scope. Mailbox boards go in FIX-1792 |
| F1–F2 | Standard-only and the default | Same in both. A worker naming no flow resolves to `agent` first, then the flag applies, and the refusal names `agent` |
| F3 | Replacing `agent` | **A keeps the installation's flag** on the entry. In B the flag is the replacement flow's: an installation that kept `agent` for standard workers loses that when it swaps in a library's agent |
| F4 | One flow, two installations | A gives each its own flag. B needs two definitions of one flow |
| R1–R2 | Shared state with attribution | An entry written through the helper lands in the org's cell naming `alice` and her worker. An entry written without `writtenBy` is refused by the resource's own schema |
| R3–R4 | **Control:** a flow that declares nothing and writes the org scope record | **Passes both shapes**, and bob's run reads alice's write (R3). Declaring a strict, empty org schema doesn't stop it either (R4). No declaration shows this path |

Size, code lines without comments: the shared checks 75 (110 after the K fixes), A 41, B 63.

## What it showed

- **Contract integrity is the same for everything a declaration shows.** Both run one set of
  checks, and both run them before any worker runs. B fails earlier, at definition; A gets the
  same for a library through the exported check.
- **The wrapper's mark costs two things the list doesn't.** It refuses a flow that meets every
  requirement, which is the second authority Q1 named; and it puts standard-only on the flow,
  where an installation can't set its own policy and loses it when it replaces `agent`.
- **"The agent flow is unchanged under the list" is false.** Under either shape its skills drawer
  moves off org scope, and under B it also moves onto the wrapper.
- **The private-state rule can't be held from declarations alone.** Org-scoped resources are
  declared and the check catches them. The org scope record is open to any block, declared or
  not, and leaks one user's write to every member. Neither shape closes it; only the engine can.

## My pick

**A, the list**, with the check exported. It holds every requirement the wrapper holds, at a moment
that is still before any worker runs; it keeps one authority; and standard-only stays with whoever
runs the installation, which is where the concept puts it. A wrapper is additive later, as authoring
sugar over the list, with no mark. The reverse, removing a mark every flow carries, is breaking.

**The question the choice turns on:** is standard-only a property of a flow, or of an installation?
If a flow, B's placement is right and its costs are the price.

**Decided, 2026-10-06:** the list (Q1), and no engine rule for org scope (Q2). See
[DECISIONS.md](../../DECISIONS.md).

<a name="after-the-gate-2026-10-06"></a>
## After the gate · 2026-10-06

The spec merged before its first review round was folded. Codex found three gaps in the shared
checks on [#2811](https://github.com/fixpoint-labs/flow-state-dev/pull/2811); Jake decided Q2 the
other way from the recommendation. Five legs were added, on `f71b9b55b`. **24 passed** after the
fixes. Before them, K1 and K2 failed: the merged checks returned no problem for any of their flows.

| Leg | Question | Observed |
|---|---|---|
| K1 | A flow that names all six keys, with `seatId: z.number()` | A real hire's mint refuses it. **The merged check admitted it**: it read only "not a declared setting". Now any refusal naming a contract key is a problem, and the probe's lists are not empty |
| K2 | `writtenBy` declared as `z.any().optional()`, the attribution made optional, `userId` optional, or a string | **The merged check admitted all four**: it read the field's name. Now the field must take a user, with or without a worker, and refuse an entry with no user |
| K2b | What the loose field lets through | An unsigned entry is stored in the org's cell |
| K3 | Flow code writing a shared entry directly with `writtenBy: { userId: "bob" }` while alice runs | **Stored, naming bob.** The stamp is the helper's, not the store's. Attribution is as trustworthy as the registered flow's code |
| K4 | The contract as decided (Q2): configuration, one door, complete attribution where declared | Today's `agent`, with and without a mailbox board, and the `leaky` flow all pass: org scope is not refused. Configuration and door verdicts are the same as before |

`workerFlowProblems` in `contract.ts` is the decided contract. `contractProblems` is kept as the
spec went to its gate, so the S, G and R legs still read as they were run.
