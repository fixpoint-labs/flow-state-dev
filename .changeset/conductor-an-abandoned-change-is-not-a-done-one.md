---
---

Internal: `@flow-state-dev/conductor` (private, unpublished) no longer settles an
issue whose implementation PR was closed without merging. It escalates the
closure to a human instead.

`IMPLEMENTATION` completed on `implPr(w)?.state !== "open"`, which a **closed**
PR satisfies. And `requiredGround` asks anything that has not merged for a
**branch** proof — which is exactly the verdict `implement` reports before the PR
exists — so an abandoned change met every conjunct and settled. The `pr_closed`
that should have escalated then reduced against `SETTLED`, where a settled entity
absorbs everything, and nobody was told. The ordinary path there needs no race:
the agent opens its PR after the tick's observation was taken, so the first
snapshot to hold that PR holds it as closed, and the synthesized `pr_opened`
ahead of the closure completed the phase before the closure was read.

Completion now accepts only `merged` and *no PR at all*. The second is not an
oversight being preserved: the nested multi-PR shape hosts its implementation at
a file rather than a pull request, has no merge of its own to wait for, and
demanding one would strand it forever. It is told apart from *no PR yet* by the
artifact, which is required positively.

This is deliberately **not** the same rule `SPEC` uses. There, closing the PR
unmerged is the process — a spec lives on its spec PR and in Linear and never on
the base branch — so `SPEC` completes on `!== "merged"`. Here the base branch is
where the work was supposed to land, so the identical shape means the opposite
thing, and the two predicates are meant to stay unequal.

`awaiting_merge` gains the closed-PR exclusion `awaiting_goal_check` already
carried, and without it the fix above would have been worse than the defect. An
approval does not expire when a PR is closed, so the gate's approval-and-proof
test kept it *applying* to an abandoned change — inviting a merge nobody can
perform, and telling `isPhaseStranded` the table still had something to say about
the entity. No `progress_stalled` would have been derived and nothing would have
escalated: a loud wrong answer traded for a silent one.
