# Park on a task · Decisions

[Spec](SPEC.md)

<a name="d0"></a>
## D0 · No timer on a parked parent (settled)

A parked parent holds no lease, request or timer. A stuck child is bounded by its own lease lapsing (`isClaimable`, `internal.ts:868`) and its retry endings; its final `errored` unparks the parent. **Because** a timer on the parent is the stacked-timeout problem FIX-1816 avoids. **Locks in:** the parent waits as long as the child's own retry budget.

<a name="d1"></a>
## D1 · OPEN · The parent is cancelled while parked

- **(a) The child keeps running**; its ending is recorded and dropped (the parent is no longer parked). Simple; may waste work.
- **(b) The child is cancelled too**, recursively. No wasted work; a child shared by intent elsewhere is lost.
- Lean: **(b)** for a child filed by the park call (`parkedBy` set), since nothing else asked for it.

<a name="d2"></a>
## D2 · OPEN · Fan-out to several children

- **(a) v1: one child per park.** Smallest; a parent needing three results parks three times in sequence.
- **(b) Park on all**, unpark when every child has ended (one attempt, all notices as input).
- **(c) Park on any**, unpark on the first.
- Lean: **(a)** for v1, with `parkedOn` shaped as a list so (b) is additive.

<a name="d3"></a>
## D3 · OPEN · Does `deps` stay same-board?

- **(a) Yes.** Cross-board waiting is park-on-task; `deps` keeps its cheap same-board lookup (`resource-backed.ts:640`).
- **(b) `deps` takes `{ boardId, taskId }`** and the claim check reads other boards.
- Lean: **(a)**. A cross-board lookup in every claim is costly, and park-on-task covers the need.

<a name="d4"></a>
## D4 · OPEN · Does the coordinator also hear a parked-on child's ending?

- **(a) No**: `unpark-parent` replaces `wake-turn`. One owner per ending.
- **(b) Yes, as a `line`** (no turn), so its conversation still shows it.
- Lean: **(b)** if the line is cheap, else (a).

<a name="d5"></a>
## D5 · OPEN · The child parks on a question

- **(a) It unparks the parent** with the question, and the parent answers it (`answerTask`).
- **(b) It doesn't**; the question goes to the child's filer as today, and the parent stays parked.
- Lean: **(a)**: the parent filed the child, so it is the filer.
