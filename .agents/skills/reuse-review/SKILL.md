---
name: reuse-review
context: fork
agent: general-purpose
description: Dedicated reuse review of a spec or epic — each Adds item against existing blocks and pieces. Separate from second-look (restraint) and from the job check (question 7 / coherence). Verdict per item: reuse X, extend X, or genuinely new. Run on every spec and epic PR.
argument-hint: "<PR# | FIX-XXX | epic/<id> | (empty = current spec/epic on the branch)>"
---

# Reuse review

A read-only **mechanism-reuse** pass over one spec or epic. It asks the question
line-level review and `second-look` don't: *does each thing this spec adds to a
package compose an existing block or piece, or is it a second mechanism beside
one we already have?*

The rule is stated once in
[`orchestration.md`](../../../docs/contributing/orchestration.md#compose-existing-pieces).
Do not restate it. This skill is how the rule is checked.

**Output is a report only.** No edits. No Linear tickets. A `reuse X` or `extend X`
verdict on an Adds item the spec treated as new is **spec-level** for the caller
to fold.

## Not this skill

| Job | Use instead |
|-----|-------------|
| Overbuilt / YAGNI / 80-20 on *this* change's surface | `second-look` (restraint) |
| Nth public way to do a person-visible job | `issue-spec` Step 3.5 question 7; coherence's job check |
| Two patterns in the codebase that already disagree | `audit-coherence` |
| Other shapes this could have taken | `adhd` |
| Line-level correctness | `review`'s correctness lens |

**Its lane vs. restraint.** `second-look` asks whether the surface earns its keep
against its own requirement. This skill asks whether an Adds item is a *duplicate
mechanism* — a second cap, a second marker, a second release path, a hook where
block composition would do. They compose; they do not merge. Do not drop a
near-duplicate because the new surface is small.

**Its lane vs. the job check.** Question 7 names public methods, tools, actions
and entries that do a job (hand off work, wait, answer, report an ending). This
pass names *package mechanisms*: caps, markers, records, hooks, delivery paths,
hold/release. A change can pass question 7 and still fail here.

## When it runs

The caller dispatches this skill. It is not a new lifecycle. Existing triggers:

- **The spec-altitude [`analysis`](../analysis/SKILL.md) dispatch** — every spec and
  epic-spec, before the PR opens (`issue-spec` Step 4.5, `epic-agent` on Create). The analyst
  runs this skill for its reuse objective and reads the verdicts.
- **`issue-spec` Step 6.5** — again after a fold that moves Adds or *What's already here*.
- **`epic-agent`** — again after a fold that moves the set's Adds.
- **`review`** — the reuse lens, on every spec/epic target and on every implementation change
  (so an Adds item the spec missed, or one the implementer invented, still gets a verdict).
- **`epic-pm`** — once per spec at the approval gate, separately from its `second-look` pass.

A second pass on the same head is fine; skip only when this exact head already has a
reuse-review report in the thread.

## Resolve the target

| Target | Review object |
|--------|----------------|
| `<PR#>` or current spec/epic branch | `SPEC.md` + `DECISIONS.md` on that head, plus `main` for the search |
| `FIX-XXX` | the retained spec at `specs/issues/<ID>/` or `specs/epics/<ID>/` |
| an implementation diff | every package addition the diff introduces, whether or not the spec listed it |

Read `SPEC.md` → *What's already here, and the debt*, including the **Builds on / Adds**
table. An Adds item with no existing-piece column is already a finding.

## Process

1. **List the Adds.** Every row in Builds on / Adds, every debt *Adds* item, and —
   on an implementation diff — every new hook, cap, marker, record, path, or public
   method the diff introduces. The Adds list should be as short as possible; a long
   list is itself a smell.
2. **Search the code for each item.** Search by what the code *does*, not where the
   spec says to look: `graft` for callers and similar signatures, then the item's
   nouns and verbs across `packages/` (for a new cap: `cap`, `limit`, `max`, `bound`;
   for a reservation: `held`, `taken`, `deferred`, `lapsed`, `reserved`). The package
   the spec is touching is the one place you cannot stop. "None" needs the searches.
   Inside an epic, also search the other children's specs (open spec PRs and merged
   `specs/issues/<ID>/`): sibling Adds count as existing
   ([`orchestration.md`](../../../docs/contributing/orchestration.md#compose-existing-pieces)).
3. **Compare to the closest existing piece.** Prefer composition from the five block
   kinds (`handler`, `generator`, `evaluator`, `sequencer`, `router`) and from
   sequencer control (`step`, `stepIf`, `tap`, `doWhile`) over a new hook or loop.
4. **Give each item one verdict** (below). Then emit the report.

## Verdicts

Exactly one per Adds item:

| Verdict | When |
|---------|------|
| **reuse X** | X already does this. The spec should call X, not add the item. |
| **extend X** | X is the right piece; the difference is a parameter, a caller, or a composition around X. |
| **genuinely new** | You searched, named the closest pieces, and can say why none of them fits *and* why this cannot be composed from them. |

**Genuinely new is rare.** The bar is [the rule](../../../docs/contributing/orchestration.md#compose-existing-pieces):
powerful yet elegant, no second way to do the same thing. A new mechanism is allowed
only when it is built on the pieces we already have.

## Near-duplicates to flag

Hunt these even when the spec did not list them as Adds:

- **A second cap or limit** beside one that already bounds the same loop or queue.
- **A second marker or record that means the same reservation** (held / taken /
  deferred / lapsed for "reserved for request R").
- **A second release or answer path** for a hold, park, or question.
- **A second delivery path** for a notice, result, or ending.
- **A hook where block composition would do** — especially a factory hook that
  reimplements `sequencer` / `doWhile` / `stepIf` / a handler the package already
  wraps.
- **Framework work landing in Kitchen Sink** — an Adds item under `apps/kitchen-sink/`
  that fails the second-app test in
  [`apps/kitchen-sink/CLAUDE.md`](../../../apps/kitchen-sink/CLAUDE.md). The verdict
  names the owning package.

A near-duplicate is **must-fix** (spec-level) unless the spec's Builds on / Adds
row names the existing piece and shows why it cannot be reused or extended.

## Worked examples

Verified against `main` at the time this skill landed. If the code has moved, search
again — do not copy these as facts about a later `main`.

### 1. A hook that reimplements `planned`'s answer step (FIX-2159 / #3799)

**On `main` today:** `defineAgentWorkerFlow` has no `answerAgain` hook. With a
conversation-board installation it wraps the run once:
`board.planned(answeredRun)` in `packages/workforce/src/agent-worker-flow.ts`.
`Planning.planned` (`packages/workforce/src/conversation-board/plan.ts`) is a
`sequencer`: the turn runs, and `stepIf(owesPlan, …, answer)` answers once more
after the plan board drains. That answer path is **not** `doWhile`. The `3` you
will find nearby is `MAX_PASS_ROUNDS` on the **board-pass** `doWhile` in
`board.ts`, not an answer-again cap. Do not conflate them.

**The anti-pattern (rejected draft, not shipped):** PR #3799 D3 option (c) added a
hook on the agent flow with its own answer-again loop and its own cap of three,
beside `planned`'s step. That is a hook where block composition would do, and a
second cap.

**Verdict that should have been:** **extend** `planned`'s answer step (share one
step, one cap; a slot may supply the *message*, not a second loop).

### 2. Four notice records, four jobs (not four names for one)

`packages/orchestration/src/tasks/notice/task-notice.ts` on `main`:

| Record | What it actually is |
|--------|---------------------|
| `OwedMarker.held` | Ending held for the request whose `getTask` wait **lapsed** (FIX-2082). Not "any R". |
| `noticeTaken:` | Exclusive **delivery claim** by request R (FIX-2123). Can outlive the marker. |
| `noticeDeferred` + `whileRunning` | Pass **defer** while filing request R runs (FIX-2113 / FIX-2149). |
| Lapsed wait slot + `LAPSED_SLOT_CHECK_MS` / `LAPSED_SLOT_CHECK_CAP_MS` | Pass **backoff** until R ends, so a held ending is released. Scheduling, not a fourth held flag. |

They are **not** four records that each mean "reserved for request R until R
stops." A review that treats them as synonyms is wrong. A review that asks "is
this Adds item a *fifth* reservation record?" is the job. Flag a new marker that
repeats one of these meanings as **reuse** or **extend** that record.

### 3. Two siblings, one hold (FIX-2058 / #3881)

Epic FIX-2058 split "a task waits on a person" by a sorting rule: approvals and input
suspend the request (`waitForUser`, engine); questions hold the task on its row (board). Two
sibling specs then each added a row field (`waitingOn: "user"` + `waitingFor`; `questions[]`),
an Inbox source, an answer route, a deadline payer, a cancel path and crash debt. Each was
searched against `main` only, so both passed as **genuinely new**. A third PR added glue so
they wouldn't collide: a reconciler clause for a task listed by both, and a CI sweep rule.

**Verdict that should have been:** **extend** one hold type that both write. The amendment
is one `holds[]` list on the task row (`specs/epics/FIX-2058/DECISIONS.md` → ER-8): the
engine's suspensions are mirrored there as one `source`, and a new hold kind is a new value.
A spec that adds a second "this task waits" field, route or release path beside `holds[]`
is **extend `holds[]`**.

## Report

```
## reuse-review: <target>

**Verdict:** <Compose existing pieces | Some Adds should reuse or extend | New mechanism beside an old one> — <one sentence>.

| Adds | Closest existing piece | Verdict | Why |
|------|------------------------|---------|-----|
| 1 | <symbol or "none; searched …"> | reuse X / extend X / genuinely new | <one line> |

### Findings
**1. <title>** (`path`) — <the existing piece, the search that found it, what the spec should do instead>.

### Considered & deemed genuinely new
- `<Adds item>` — searched <nouns>; closest is <X>; does not fit because <reason>.
```

Rules:

- **Verdict + table first.** Empty Adds with an honest search is a valid, common
  clean verdict.
- **Every Adds row gets a verdict.** A row with no search is a finding.
- **Cite the file you searched**, not the spec's claim about it.
- **"Considered & deemed genuinely new" is required** when any row is new. It is
  the proof the pass looked.
- Do not invent a fourth verdict. Do not recommend a new process mechanism.
