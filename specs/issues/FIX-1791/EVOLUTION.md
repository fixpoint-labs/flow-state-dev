# FIX-1791 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

The mailbox designs this coordinator keeps, changes or replaces, and the closed coordinator
issues it carries. The epic's own lineage ([epic EVOLUTION](../../epics/FIX-1786/EVOLUTION.md))
covers the old worker naming rule and the mailbox boards at set level; this is the coordinator's detail.

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| Best fit holds a follow-up for the delegate still on the user's last post, with no model call; [FIX-1610 D1](../FIX-1610/DECISIONS.md#d1) | **Retained**, amended at the edge | Still the right default; delegates can now leave | BR-14: a removed or unreachable holder holds nothing. The ladder is extracted into one helper both flows call (S4) | The mailbox keeps D1, through the shared helper, until FIX-1792 |
| `routing:` has one subkey, `fallback:`, which must be a member whose worker hears posts, refused at bind; [FIX-1610 D3](../FIX-1610/DECISIONS.md#d3) | **Amended** | Delegates change at runtime, so a fallback fixed in a file can be removed | `routing:` names a policy; `fallback:` is its own key, a delegate per conversation ([D2](DECISIONS.md#d2)), BR-15, BR-16 | FIX-1792 converts `routing: { fallback: x }` to `routing: best-fit` plus `fallback: x` |
| The routed member's answer lands in the channel as that member, once per post; [FIX-1610 D2](../FIX-1610/DECISIONS.md#d2) | **Retained**, amended | One answer per delegate per post still holds | One answer per delegate per post per round, carrying its delivery's token (BR-20, BR-21) | None; new flow |
| A worker wakes when its flow declares the post entry, read off the workers passed at boot; a worker's own post wakes nobody (`seatAuthored`); [FIX-1602 D1, D2](../FIX-1602/DECISIONS.md#d2), `wakeMemberSeats` in `packages/workforce/src/mailbox/wake-member-seats.ts` | **Superseded in part** | A boot list can't see a hire; the PRD bounds answers by rounds instead | Live resolution per post; the round limit, zero by default, keeps "an answer wakes nobody" unless set ([D1](DECISIONS.md#d1)); a delegate whose flow can't take a post is refused when added (BR-4) | The mailbox keeps both until FIX-1792 |
| One answer per worker per post, crash-safe, in org-side `room-answers` and `room-deliveries` with a token per delivery; FIX-1650 [ER-26](../../epics/FIX-1650/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt), `packages/workforce/src/projects/collections.ts` | **Retained as the model**, amended | The concept names it the model for one answer per delegate | The same pending-then-delivered record and token, keyed by round, as one Workforce delivery ledger: the coordinator keeps it in server-written session state, and FIX-1793's project coordinators reuse it (S5) | Not ported. Rooms are FIX-1793's to remove |
| A coordinator sets up mailboxes and adds and removes their members at run time, the file being the starting list; [FIX-1779 D2](../FIX-1779/DECISIONS.md#d2) (canceled) | **Superseded** | Delegates per conversation replace runtime mailbox membership | ER-4, S2, S3. FIX-1779's lessons 1, 2, 3 and 5 are guardrails here | Nothing shipped |
| The coordinator routes, staffs, sets up mailboxes and follows work through; legs a to e; spec PR [#2747](https://github.com/fixpoint-labs/flow-state-dev/pull/2747), `specs/issues/FIX-1774/SPEC.md` at `a8e45d6` (closed, unmerged) | **Superseded in part** | Restated on delegates; tasks and projects wait on boards ([Q1](DECISIONS.md#q1)) | Legs a to c as this goal's legs a to c; leg d to FIX-1793 and leg e to FIX-1794, per Q1 | Nothing shipped |
| A filer hears how its task ended and can reassign it; [FIX-1780 D1, D2](../FIX-1780/DECISIONS.md#d1) | **Retained**, relocated by [Q1](DECISIONS.md#q1) | Its design stands; it rides board writes FIX-1794 owns | FIX-1794, with its goal check `a-filer-hears-how-its-task-ended` | Only S5a shipped |
| A coordinator's members are read as data, never guessed, and any listing of them is capped; spec PR [#2777](https://github.com/fixpoint-labs/flow-state-dev/pull/2777) (FIX-1785, closed) | **Retained** | #2768's run log showed a model inventing members from a short listing | BR-10, the cap of 25, VG leg d | None |
| The chief of staff is one `agent` worker with hire and project tools; `packages/shift-manager/teams/devteam/workforce/org/workers/chief-of-staff/WORKER.md` | **Superseded** | The PRD: a standard coordinator at the top of the roster | S10: `flow: coordinator`, `routing: judgment`, its tools kept | The wire id `chief-of-staff` and its display name stay |

Amended after merge (epic amendment #2837): a best-fit post the evaluator can't place goes to
the fallback delegate if one is set, otherwise to the coordinator's own judgment turn, and is
`unplaced` only when that turn fails (D2, BR-16, BR-16a). As merged in #2815, a miss with no
fallback delegate went `unplaced` and the judgment turn was rejected for cost. The product owner
reversed that on 2026-10-06 (epic D8): a coordinator is evaluator first, agent as the fallback.

None of these is wholly superseded until FIX-1792 removes the mailbox flow. Re-check each
cited intent against `main` before building: FIX-1788 changes how a worker is reached.
