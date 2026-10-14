# Park on a task · Decisions

[Spec](SPEC.md)

D1–D5 below are written as the Architect leaned, which the product lead reported on 2026-10-14 as Jake's call. That report is a relay, not Jake's sign-off: Jake merging this spec is the approval, and until then each one is the recommendation.

<a name="d0"></a>
## D0 · No timer on a parked parent (settled)

A parked parent holds no lease, request or timer. A stuck child is bounded by its own lease lapsing (`isClaimable`) and its retry endings; its final `errored` unparks the parent. **Because** a timer on the parent is the stacked-timeout problem FIX-1816 avoids. **Locks in:** the parent waits as long as the child's own retry budget.

<a name="d1"></a>
## D1 · The parent is cancelled while parked (lean: cancel the child)

- **(a) The child keeps running**; its ending is recorded and dropped (the parent is no longer parked). Simple; may waste work.
- **(b) The child is cancelled too**, recursively. No wasted work; a child shared by intent elsewhere is lost.
- **Lean, reported as Jake's call: (b)** for a child filed by the park call (`parkedBy` set), since nothing else asked for it. The same rule covers the race where the parent is cancelled and the child then ends: the child is already cancelled, and its `cancelled` notice finds no parked parent, so the unpark write refuses and the notice is cleared.

<a name="d2"></a>
## D2 · Fan-out to several children (lean: one child per park)

- **(a) v1: one child per park.** Smallest; a parent needing three results parks three times in sequence.
- **(b) Park on all**, unpark when every child has ended (one attempt, all notices as input).
- **(c) Park on any**, unpark on the first.
- **Lean, reported as Jake's call: (a).** `parkedOn` is a single ref, not a list: (b) and (c) are the "waiting on several tasks at once" that the Orchestration Primitives project rules out, and if they are ever wanted, BP-030's dual-read lets a list arrive later without a migration now.

<a name="d3"></a>
## D3 · Does `deps` stay same-board? (lean: yes)

- **(a) Yes.** Cross-board waiting is park-on-task; `deps` keeps its cheap same-board lookup in `claim`.
- **(b) `deps` takes `{ boardId, taskId }`** and the claim check reads other boards.
- **Lean, reported as Jake's call: (a).** A cross-board lookup in every claim is costly, and park-on-task covers the need.

<a name="d4"></a>
## D4 · Does the coordinator also hear a parked-on child's ending? (lean: as a line)

- **(a) No**: `unpark-parent` replaces `wake-turn`. One owner per ending.
- **(b) Yes, as a `line`** (no turn), so its conversation still shows it.
- **Lean, reported as Jake's call: (b).** `decideNotice` still returns one act per notice: `unpark-parent`, whose handler both unparks the parent and lands the line in the conversation the notice was delivered to. No second act, and never a `wake-turn`.

<a name="d5"></a>
## D5 · The child parks on a question (lean: unpark the parent)

- **(a) It unparks the parent** with the question, and the parent answers it (`answerTask`).
- **(b) It doesn't**; the question goes to the child's filer as today, and the parent stays parked.
- **Lean, reported as Jake's call: (a)**: the parent filed the child, so it is the filer. P3 confirms `answerTask` reaches a child on another board before this ships, with a goal-check leg.
