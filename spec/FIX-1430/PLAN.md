# FIX-1430 · Plan

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · **Plan**

For the implementing agent. IDs cross-reference [BUSINESS-RULES.md](BUSINESS-RULES.md) (BR-n) and [DECISIONS.md](DECISIONS.md) (D-n). `tdd`. One PR. Written against `d8e4c99`.

## What this consumes, and what it waits for

**From FIX-1394: neither the contract nor the implementation as a build input — only [ER-2](https://github.com/fixpoint-labs/flow-state-dev/pull/1905) as a fence.** The lab's seats carry instructions, skills and tools on surfaces that already shipped, and FIX-1394 changes none of them: its own spec ships no format and leaves today's behaviour byte for byte. Nothing to write against, nothing to wait for. What ER-2 binds is *authoring* — this lab invents no package shape — so all four of FIX-1394's possible answers, *don't collapse* included, leave it compatible. The worry that a ratify might not satisfy a proof needing the package to **exist** does not reach here: the proof needs no package.

**From FIX-1385: the implementation, landed.** `boards:` in a channel file, the minted ledger id, the channel's file and read actions, the task-tools resolver on the kind, the seat-side helper. A real blocking edge, not a contract one.

**Which side of [ER-14](https://github.com/fixpoint-labs/flow-state-dev/pull/1905) this sits on.** The one PR is on the **evidence** side: it adds no file to a published package (BR-14), so it is no W4 ship PR and the fence does not hold it. It still cannot go green until FIX-1385's board PRs have landed, and those *are* ship PRs the fence holds. Unfenced, and behind the fence in practice — spec now, build when the board surface exists.

## Surfaces

| ID | Role | Change | Rules |
|---|---|---|---|
| S1 | `goals/manager-queue-lab/lab/workforce/` · the tree | One team: a channel declaring one board, a coordinator seat naming the task tools in its own file, three worker seats | BR-1 BR-2 |
| S2 | The kinds, under `flows/workers/` | The coordinator's installs the task tools against the channel's ledger; the worker's declares the same ledger and drains it, one assignee key per worker seat, no default worker. **Each drain narrows its own claim to its assignee** — see the guardrail below, which is the difference between BR-4 holding and the lab eating its own rows | BR-4 BR-5 BR-7 |
| S3 | `lab/host.mts` | Read the tree, build the kinds, hire, register, open the channel, hand back handles — through the package's own roster reader, **no third `LabRoster`** | BR-1 |
| S4 | `lab/queue.mts` | A pure read: rows plus the hired seats to four columns and per-seat idle. Writes nothing | BR-10 BR-11 BR-12 |
| S5 | `lab/refusal-trees/` | Two twins and their corrected pairs: a coordinator naming no task tools (**hires, then refuses at filing** — not a hire-time refusal, so do not file it under the refusal trees without saying so), a seat folder holding a block that declares the board (refused at hire) | BR-2 BR-3 |
| S6 | The contract gate, model-free | The tree, both refusals, the columns, the enum, the diff check | BR-1–BR-3 BR-8–BR-14 |
| S7 | The goal check, model-backed | The coordinator decides who gets what: four rows across three assignees, so one assignee holds two | BR-4–BR-7 |
| S8 | The drain-width **switch** | One documented knob that runs the lab at either width with no edit to the tree and none to the checks. **The comparison itself is not on this issue's merge bar** ([D3](DECISIONS.md#d3)): what ships here is the wiring plus a stated way to run it, and the two-width evidence lands when the epic asks for it | BR-17 |
| S9 | `lab/README.md` and the diff check | What the lab proves, what it does not, the check keeping it inside `goals/` **and out of `goals/devforce-lab/`** — the diff gate rejects that subtree too, because BR-15's "byte for byte" is not something a behavioural suite can prove | BR-14 BR-15 BR-16 |

## Sequence

```mermaid
flowchart TD
  S1["S1 · the tree"] --> S2["S2 · the two kinds"]
  S2 --> S3["S3 · the host"]
  S3 --> S4["S4 · the queue read"]
  S3 --> S5["S5 · the refusal trees"]
  S4 --> S6["S6 · the contract gate"]
  S5 --> S6
  S6 --> S7["S7 · the goal check"]
  S7 --> S8["S8 · the drain-width comparison"]
  S7 --> S9["S9 · README and the diff check"]
```

## Checks

| ID | After | Passes when |
|---|---|---|
| V1 | S3 | BR-1. **Negative control:** rename one seat's kind to an unregistered one, watch the whole roster refuse, restore it |
| V2 | S5 | BR-2 and BR-3, each against its corrected twin. **They fail at different moments, and the checks must not be written alike:** BR-3's tree is refused at hire and is asserted on the block **named**; BR-2's twin *hires cleanly* — omitting `tools:` leaves nothing to refuse — and is asserted on the refusal it gets **at filing**, naming the tool. Neither asserts on message text |
| V3 | S4 | BR-10, BR-11, BR-12. BR-10 by comparing the ledger before and after a queue read — a view that wrote something fails here |
| V4 | S6 | BR-13 on the enum itself; BR-14 as a check over this issue's diff, run rather than read; BR-8 and BR-9 through the channel |
| VG | S7 | **Goal, real path:** four rows, three assignees, three worker seats. Every row lands where its assignee points (BR-4), each in a session parented to the coordinator's (BR-5); the fourth is not re-routed and not dropped, and runs once its seat frees (BR-6); a row naming nobody refuses loudly (BR-7). **Negative control, and the red state it actually produces:** re-point one assignee in the host's map at a different declared seat, leaving the tree alone. The row is then observed running on a seat whose own file claims a different assignee — implementation and oracle disagree — and BR-4 fails on that mismatch. The control moves only the thing under test, which is why it can fail |
| V5 | S8 | The switch is exercised at both values and the lab boots at each — cheap, model-free, and the whole of what this issue owes. **Not on the merge bar:** the full two-width comparison, run and written out for [ER-15](https://github.com/fixpoint-labs/flow-state-dev/pull/1905) when the epic asks. Record what each run did to the waiting row *then* |

**Every held-out fact is read out of the tree at run time**, as both existing labs do: a token that decides a check lives in one convention file and in none of the lab's code, so a different valid tree still passes a correct implementation.

## Pinned names · the only three

| Where | Name | Why pinned |
|---|---|---|
| The channel | `eng.queue`, holding `boards: [work]` | The ledger id is minted from it, and the checks address that id |
| The board's assignee keys | Deliberately **not** the seat ids — a distinct spelling for each | [ER-5](https://github.com/fixpoint-labs/flow-state-dev/pull/1905): an assignee is a routing key, not a seat. Identical spellings would let a check that conflates them pass |
| The lab root | `goals/manager-queue-lab/` | Cited from the epic, and by BR-14's diff check |

Everything else is yours, the column names included.

## Guardrails

| Rule | Because |
|---|---|
| The seat-tool fence is not widened, anywhere | It landed stricter than its own spec read, and a board tool in a seat folder is the shape that tempts a loosening. BR-3 is that temptation, as a refusal |
| Nothing under `goals/` is imported by anything under `packages/` | D1. A lab that becomes a dependency has stopped being evidence |
| Every column is derived on read, and the queue module holds no state | BR-10, and [ER-11](https://github.com/fixpoint-labs/flow-state-dev/pull/1905). A cached column is a second copy of the board |
| The assignee-to-seat map lives in the host, supplied by the caller, never read from the tree. **The expected association is held out separately, in the tree** — each worker seat's own file names the assignee it answers for | The map is the app's, and a supplied map is the only way VG's negative control can point an assignee at the wrong seat. But the check may not grade the map against itself: repointing it would move the oracle along with the implementation and the control would stay green. The tree is the oracle, the map is what is under test (BR-4) |
| **Every drain passes an assignee `eligibility` predicate into `collection.claim`** — `eligibility: (t) => t.assignee === "<this seat's key>"`. Never a bare `claim`, and never a status arm in that predicate | This is the one place a seat-per-drain layout goes wrong, and it goes wrong loudly. `ClaimOptions.eligibility` **narrows the candidate set before the CAS flip** (`packages/orchestration/src/tasks/collection/types.ts`), and both backings compose it with `isClaimable` rather than replacing it. Omit it and the drain claims whatever is next — including a row addressed to another seat — and then `keyedRouter` misses, throws out of the router, and `.rescue()` routes to `recordError`, which writes `collection.fail` against that row (`blocks/worker-step.ts`). The row does not merely mis-route: it settles `errored`. Do not add `t.status === "pending"` to the predicate either — that silently opts this drain out of lapsed-lease recovery, which the substrate calls out by name |
| No epic wall is answered in a comment in this folder | [ER-15](https://github.com/fixpoint-labs/flow-state-dev/pull/1905). Evidence goes up to the epic PR; decisions come back down |
| **The narrow shape is required while [Q1](DECISIONS.md#q1) is open, not preferred:** worker handlers are stubs doing small deterministic work (write a file the check reads back), the model appears at **one** surface only — the coordinator deciding who gets what — and waiting is driven by pentest-style poll and timeout fixtures rather than sleeps | VG is the epic's exit gate, and a gate that goes red for reasons unrelated to routing stops being one ([D2](DECISIONS.md#d2)). Writing this as a guardrail rather than a recommendation is what stops the gate drifting toward devforce economics (a harness per row, ×4) while the question is still with the owner. If Q1 comes back wide, widen it deliberately and price it then |

## Docs

- **CREATE** `goals/manager-queue-lab/lab/README.md` — what the tree declares, what each check grades, what the drain-width comparison is for, and one paragraph on what this lab does **not** prove. *Voice risk:* writing it as a tutorial. It is evidence.
- **No `apps/docs` page and no package README change.** Teaching routing as something a team gets by attaching a board is [ER-22](https://github.com/fixpoint-labs/flow-state-dev/pull/1905), the epic's docs pass; FIX-1385 already carries the channels-page edit.
- **No changeset** (BP-022): `goals/` is private and no published package changes.

## Sketch · pseudocode, illustrative, react to the shape

```
the tree:      one channel declaring one board; a coordinator seat whose own
               file names the task tools; three worker seats

the host:      read the tree through the package's reader
               build the coordinator kind:  task tools -> this channel's ledger
               build the worker kind:       the same ledger, drained,
                                            one assignee key per worker seat
               hire, register, open the channel

the queue:     rows, and the seats we hired ->
                 queued         = claimable, grouped by assignee
                                  (pending, OR in_progress with a lapsed
                                   lease -- a row whose worker died)
                 running        = in progress with a live claim
                 waiting-on-you = parked or blocked, with the row's own reason
                 done           = terminal
                 idle           = a hired seat holding no live claim
               reads only; writes nothing

the check:     coordinator files four rows across three assignees
               each row runs where its assignee points, and nowhere else
               the fourth is not re-routed and not dropped, and runs
                 once its seat frees -- its status while waiting is
                 recorded, not asserted (BR-6)
               a row naming nobody refuses at the drain
               each drain claims with eligibility narrowed to its own
                 assignee -- never a bare claim (see Guardrails)
```

**POC: none.** The two premises underneath this — that a channel can hold a ledger a seat drains, and that a seat's declared task tools can be pointed at it — are FIX-1385's, and its plan records reading them in the code rather than running them. A POC here would re-derive a sibling's premise against a surface that does not exist yet. The premise this issue owns is the queue, and a queue POC over an unbuilt board is this lab, early.

## At implement time

- **Re-read the board surface as it actually landed**, not as [PR #1917](https://github.com/fixpoint-labs/flow-state-dev/pull/1917) specified it. The minted id, the seat-side helper's shape and where the task-tools resolver is installed are what move.
- **Check whether `readDeclaredRoster` has landed** (FIX-1405). If so, read the tree through it; if not, use the three readers directly, and still hand-roll nothing reusable.
- **Check the four returned session-policy walls** on the epic before wiring the dispatcher. Two are visible at this queue depth: whether a seat already running has its session reused, and what a busy seat does. If either has been ruled, follow it; otherwise show it and report up.
- **`goals/devforce-lab/` declares one ledger twice on purpose.** Interim, and not the shape to copy.

## Notes from review

Round 1. Below the spec-review bar — recorded for the implementer rather than folded into the approach ([BP-040](../../docs/contributing/best-practices.md)).

- **Contract-gate scope may be trimmed if schedule bites** (Cursor). S6 covers refusals, the enum, the goals-only diff, the channel's BR-8/BR-9 and the column checks — a lot of fence before VG runs. A thinner first cut is BR-1 plus BR-10 via the ledger compare, with the full refusal trees kept only where the pentest lab already proved the pattern (BR-3). **BR-9 as a graded rule is optional hygiene** — it records observed behaviour and grades nothing anyone chose. Implementer's call; the rules stay as written.
- **Column semantics still appear in three places** (Cursor): `the-view.svg`, the BR-10 to BR-12 rows, and this plan's sketch. The duplicate mermaid in `BUSINESS-RULES.md` was cut in round 1. The remaining three have different readers — the figure is the picture, the rules are the contract, the sketch is the shape — so they stay. If the sketch drifts from the rules while you build, the rules win.
- **Two findings were refuted, not folded, and the threads are left open** for anyone who wants to push back: that `SPEC.md` must lead with the problem ahead of its nav and header lines, and that its sign-off section must use the `Need your sign-off` heading with the open question first. Both are measured against `AGENTS.md`, which governs asks **in conversation**; `docs/contributing/spec-template.md` is canonical for a spec document's own headings and prescribes exactly the shape this spec has. `writing-for-humans.md` also exempts structural navigation from "nothing precedes the problem" in as many words. Don't re-file these.

## Follow-ups

- **Whether a channel board should carry a default worker** is FIX-1385's surface, not this lab's. BR-7 shows what happens without one; file the question there.
- If the queue columns survive a second consumer, they are a candidate export. Not before ([D1](DECISIONS.md#d1)).
