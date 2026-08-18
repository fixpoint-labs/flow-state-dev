# harness-workstream › it reconstructs a run from state alone

**Issue:** LAB-135

**Outcome:** Hand someone nothing but this system's stored state — no harness transcript, no
working tree, no git — and they can say what a coding run did: which files it touched, how each
turned out, in what order, what it said, and what it thought its job was, or that it kept no
plan and why we can tell. If that account does not hold up against the job the run was given,
the layers built on top of this state have nothing to read.

**Input:** `fixtures/input.json` — the workstream topic, two files the run is asked to create,
one existing file it is asked to edit, and how many to-do items to keep. Held out twice over:
the reader never sees any of it, and the grader receives it only after the account exists. A
different valid fixture must still pass a correct implementation. `fixtures/known-state.json`
and `fixtures/known-account.json` are the calibration pair — a state the routes could really
return, and the one account a correct reader derives from it.

**Signal:** Eight assertions, each of which must fail or declare itself unmeasured when the set
it reads is empty.

1. Every held-out path appears with a recorded kind and a **settled** outcome (`applied` or
   `failed`; `pending` and absent both fail) — or, absent and with a shell call in the run, is
   named **unmeasured for that path**
2. Every mutation the item stream shows and the file record lacks is accounted for by a gap row
   **carrying that path**; a difference nothing accounts for fails, and so does a record row the
   stream never showed
3. Order is non-decreasing over `itemIndex`, per request, across at least two distinct positions
4. The run's activity precedes the report it wrote about that activity
5. The plan half resolves to rows, or to UNMEASURED with its reason named — never to LOST
6. Every set an assertion iterates is non-empty, failing by name
7. Every `nextCursor` was followed, on all three collections
8. The reader's own source imports nothing but the collection accessor keys

Two arms report rather than fail, and neither may pass silently: assertion 5's UNMEASURED, and
assertion 1's per-path unmeasured. If **every** expected path lands unmeasured the run proved
nothing and the goal is inconclusive, which is a failure.

**Anti-game:** Must not read the harness transcript, the working tree — including any file the
run wrote — or git. The reader's deprivation is a **parameter shape**: its only input is a bound
route reader, and assertion 8 checks that mechanically over its own source rather than trusting
it. Must not grade whether the run did a **good** job: no assertion on the run's prose, on any
file's contents, or on whether the change would compile — the grader's parameter type removes
the run's words, so reaching for them is a compile error rather than a rule to remember. Must
not assert **how the run was settled** (a stated gap, FIX-1182). Must not search the stored
state for a value it already holds: the account is derived before the expectation is introduced,
which is the whole difference from the two checks that came before. An account that comes back
empty is a FAIL that names which emptiness it hit.

**Model:** real — the Claude Code Agent SDK resolves its own model; the flow declares no
generator actions. The calibration and every guard case are **model-free** and run first.

**Run:** `pnpm tsx goals/harness-workstream/reconstructs-a-run-from-state-alone/run.mts`

## The preconditions, and why they run every time

The reader derives the known account from the known state **exactly**, a deliberately lossy copy
of that state is caught by assertion 2, and 30 guard cases each break one assertion on purpose
and confirm it reaches the verdict it is supposed to. All of it is model-free, so it runs on
every invocation rather than sitting in this log as a one-time claim — and if any of it fails,
no coding run is dispatched at all. An instrument is sanity-checked against a case whose answer
is known before its sweep is trusted.

**The broken world is handed in rather than provoked**, and that is the point. Mutating a grader
and re-running a real check has a blind spot congruent with the defects it is meant to catch: a
mutation inside a branch no run reaches never executes, and *"the mutation was rejected"* and
*"the mutation never ran"* produce the identical green. This goal is full of such branches by
construction — the plan half's ROWS arm never executes on this driver, and most of assertion 2's
broken worlds cannot be produced by a correct system at all. So each case follows three steps,
not two: name the broken world · check the assertion rejects **that** world · check the world can
be produced at all.

**Four cases exist because a mutation did not go red**, which is a result rather than a
formality:

- Whole-segment path matching was unreachable until `known-state.json` gained `my-alpha.txt` — a
  still-pending row whose name ends with `alpha.txt`. Until then a naive `endsWith` derived the
  identical account.
- Assertion 6 read the account's own counts, which can drift from the arrays assertions 1 and 2
  iterate. It now sizes those sets from the arrays themselves, and a case pins the disagreement.
- Assertion 4's two can't-tell conditions sat in one `if`. Deleting the missing-report half left
  the ordering comparison to handle it, `firstToolOutputAt > null` coerced to a comparison
  against `0`, and the resulting failure satisfied a status-only guard perfectly — **the guard
  reported itself proven while the branch it names had been removed.** Every finding now carries
  a stable branch tag, and every guard case asserts on it.
- Assertion 1 treated any shell call as grounds to call a missing path unmeasured. A real run
  reached for `Bash`, was **refused**, and said so — a call that never ran cannot have made the
  change, so counting it would have turned a lost write into an inconclusive. Only a shell call
  the harness actually ran softens the verdict now.

One masking relationship among the preconditions themselves was removed for the same reason: a
failed lossy-calibration used to return early and hide the entire guard table. All preconditions
now report together.

## What this deliberately does not re-assert

That the workstream is a child session carrying the held-out topic; that `include_items=true` is
load-bearing on this adapter; that the originating request's stream carries none of the run's
items; that the dispatching board's task collection stayed clean; and that the collections
declare client state reads. Each has its own goal, and duplicating it here would inflate this
one's PASS into a claim about theirs.

## Verdict log

**Assertion 5 has reported UNMEASURED on every run**, and that is the finding rather than a
footnote. Through the in-process Agent SDK path the run invokes no plan tool at all — it writes
its to-do list as **prose in its own messages**, which the account shows verbatim
(`To-do list: 1. … — completed 2. … — in progress`). The predecessor ruled out both of our own
configuration suspects by measurement across eight consecutive runs, and the plan tools are named
in `allowedTools` here too, so this is the driver's behaviour and not this file's. Filed as
FIX-1185. It cannot fail the kill line by design — the proof rests on what the run **did** — but
the plan half of the graph remains unexercised end to end and must not be read as proven.

**Every run has also reached for the shell**, with `Bash` absent from `allowedTools`. That is
assertion 1's split doing its job rather than an anomaly: the allowlist is a permission filter,
not an availability one. On one run the call was **refused** and the agent said so in its own
words, which is what surfaced the difference between a shell call that ran and one that did not.
On these runs no expected path was missing, so nothing went unmeasured — but both branches are
live, and the branch that would call the whole run inconclusive sits behind them.

| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-08-18 | `1067fa7ac` | Agent SDK default | PASS | Fifth consecutive real run, on the committed tree. 3 of 3 held-out paths present with a kind and a settled outcome; 3 stream mutations and 3 rows naming the same files; non-decreasing across 31 top-level items at 27 distinct positions; activity at 14 before the last word at 25; 0 gap rows. **1 shell call, 0 of them ran** — the refused-`Bash` case again, on the very next run after the fix for it. All paths were present, so nothing went unmeasured on that account. Plan arm UNMEASURED. 30 guards proven first |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | Agent SDK default | PASS | First real run. 3 of 3 held-out paths `created`/`edited` and `applied`; 3 stream mutations and 3 rows naming the same files; non-decreasing across 30 top-level items at 25 distinct positions; activity at 13 before the last word at 24; 0 gap rows; 1 shell call. Plan arm UNMEASURED — 0 plan tool calls; tools used `Bash`, `Edit`, `Read`, `Write` |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit (fixture + assertion 6 strengthened) | Agent SDK default | PASS | Second consecutive run, same shape; 26 distinct positions of 30 items. 27 guards proven, up from 24 |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit (branch tags added) | Agent SDK default | PASS | Third consecutive run, 32 items at 28 distinct positions, 4 messages, 6 tool_outputs. **The run reached for `Bash`, was refused, and said so** — which is what exposed assertion 1 treating a denied shell call as grounds to call a missing path unmeasured. Fixed after this run |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | Agent SDK default | PASS | Fourth consecutive run, with the denied-shell split in place. 30 guards proven |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | The reader stopped following `nextCursor` (page cap 1). *"CALIBRATION FAILED — the reader does not derive the known account from the known state"*, aborting **before** spending a coding run. The single-page read that would otherwise have graded a fragment while reporting on the whole |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | Agent SDK default | FAIL *(deliberate)* | `import { readFileSync } from "node:fs"` added to the reader. Assertion 8: *"the reader imports "node:fs" — its deprivation is a parameter shape, and an import is a second way in"* |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | Assertion 2's **reverse** direction — a record row the stream never showed — disabled. Caught by its own guard case before any run was dispatched |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | Assertion 2's **forward** direction disabled. Caught four ways: the lossy calibration plus three independent guard cases. Also how the precondition masking was found — the lossy check used to return early and hide the guard table entirely |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | Assertion 5's status check (`no plan row carries a status`) disabled — a branch **no real run reaches**, so only a directly-fed world could catch it. *"GUARD NOT PROVEN — 'A5 — plan rows are worded but none carries a status'"* |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | Assertion 4's missing-report condition deleted. **Caught only after branch tags existed:** *"did not reach A4/a4-unevaluable with a fail; it produced ["a4-out-of-order=fail"]"*. The first attempt at this mutation passed — the ordering comparison absorbed the case via `null` coercion, and a status-only guard accepted it |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | FAIL *(deliberate)* | Whole-segment path matching degraded to `a.endsWith(b)`. The calibration went red on `my-alpha.txt` being dragged into `alpha.txt`'s grading. **This mutation passed silently until the fixture was changed to make it fail** — the guard was there and nothing could reach it |
| 2026-08-18 | working tree at `4f2f63d37`, pre-commit | — | PASS *(model-free half)* | 30 guard cases, each breaking one assertion on purpose and pinned to the exact branch it must reach: assertion 1's seven (absent with a shell call that ran, absent with every shell call refused, absent with no shell call, all-paths-unmeasured, pending, projected-away outcome, missing kind), assertion 2's six, assertion 3's four, assertion 4's three, assertion 5's five arms, assertion 6's three, assertion 7's two. 30/30 reached the branch they name |
