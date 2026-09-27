# FIX-1592 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage that spans more than one child. The first nine rows are this set's earlier
versions; the rest are what the 2026-09-27 amendment changes. Child-specific predecessors stay
in each child's own record.

## Earlier versions of this set

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| A usable support desk, FIX-1585 → FIX-1589 → FIX-1591, FIX-1590 cut. Source: [#2265](https://github.com/fixpoint-labs/flow-state-dev/pull/2265), merged at `b6777d1`, its D1, D2, D4 and ER-1 to ER-20 | **Superseded** | The owner's re-scope, 2026-09-25 | [#2269](https://github.com/fixpoint-labs/flow-state-dev/pull/2269)'s D1 to D3 | Nothing was built against it. FIX-1591 keeps its Linear issue, held |
| The first version's fence: the only package change is FIX-1585's transcript line | **Superseded** | The owner allowed Workforce changes where a path needs them | ER-8 | The layer rule is retained |
| Waking an agent seat needs an internal receiver. Source: [#2265 review](https://github.com/fixpoint-labs/flow-state-dev/pull/2265#discussion_r4107585826) | **Retained** | Still true; FIX-1590 shipped it | ER-2 | — |
| `escalations` ships unattended so the boot warning is visible. Source: [FIX-1476 D3](../../issues/FIX-1476/DECISIONS.md#d3), its BR-10 | **Retained** | Not this epic's call; FIX-1591 is held | ER-13 · ER-25 | Specialists now file onto it; still nobody drains it |
| The notify block names each member and wakes none. Source: `apps/kitchen-sink/workforce/channel-notify.ts`, FIX-1476 (#2007) | **Amended** for agent seats | Path two needs agent members to run | ER-2, FIX-1590 | Its name-only line was for clerk and runner members; with both cut ([D7](DECISIONS.md#d7)) it reaches nobody in the new roster |
| An agent seat's question is not kept. Source: FIX-1585 BR-14 on its unmerged spec branch | **Superseded** | A seat is a conversation | ER-1, shipped | Nothing to migrate |
| No proof issue: each leg is its owner's check. Source: #2269, its *how we verify* and ER-17 | **Amended** | [The closure rule](../../../docs/contributing/orchestration.md#the-closure-issue-every-epic-ends-in-qa) | FIX-1601 · required | The legs now run inside FIX-1601's plan |
| Path two's wake is kitchen-sink host glue. Source: [#2290](https://github.com/fixpoint-labs/flow-state-dev/pull/2290); [#2289](https://github.com/fixpoint-labs/flow-state-dev/pull/2289) | **Amended** | Every host would copy it ([#2294](https://github.com/fixpoint-labs/flow-state-dev/pull/2294)) | FIX-1602, shipped | ER-2, ER-3 and D2 unchanged |
| V14's expected set: the roster minus the writer. Source: `goals/workforce-conventions/a-channel-holds-the-work-a-seat-drains/run.mts`, FIX-1476 | **Amended** | FIX-1602's rule: a member whose seat can hear a post gets nothing on a seat-authored post | FIX-1603, shipped · ER-18 | V14's intent stands |

## What this amendment changes

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The goal "a post to a channel reaches each agent in it", leg b "one post runs iris and otto once each", and ER-2 as the epic's promise. Source: [#2269](https://github.com/fixpoint-labs/flow-state-dev/pull/2269), SPEC.md goal and ER-2, ER-17 | **Amended** | The owner, 2026-09-26: one conversation, routed to the right agent, specialists segmented | [D5](DECISIONS.md#d5) · ER-21 | Every-member wake stays Workforce's default for unrouted channels; FIX-1590 and FIX-1602 are not reopened, and `a-fresh-host-wakes-its-member-agents` is unchanged |
| The roster and its channels: `desk`, `noticeboard` on the `digest` kind, the `ada-wren` DM, `followup-runner` on `followups`. Source: [FIX-1476 D1, D2, D3](../../issues/FIX-1476/DECISIONS.md#d1), [D6](../../issues/FIX-1476/DECISIONS.md#d6) | **Superseded** in kitchen-sink, per [D7](DECISIONS.md#d7) and [D8](DECISIONS.md#d8) | The owner: names instead of jobs, a contrived config | [D7](DECISIONS.md#d7) · [D8](DECISIONS.md#d8) · ER-26 | The `CHANNEL.md`, board and custom-kind conventions in Workforce are untouched. The checks those decisions proved are re-pointed, not deleted (ER-27) |
| The `desk-clerk` kind, its `desk` setting, `desk-note`, and the clerk that answers or files. Source: `apps/kitchen-sink/workforce/flows/workers/desk-clerk.ts` (FIX-1476, FIX-1589); this epic's ER-20 and D1's "why the wake stays agent-only" | **Superseded** | A clerk beside agents is the contrivance; the agent-only wake has nothing left to exclude | ER-25 for filing; ER-20 retired | FIX-1589's no-parrot intent holds for every specialist. The durable-hire check grades a value the `desk` setting carried, so it needs another hire-time value on the real app (ER-27) |
| The rail's hire door, and "reversing it removes the only way the Goal 1 run is demonstrable". Source: [FIX-1500 D1](../../issues/FIX-1500/DECISIONS.md#d1); mara's hire tools, FIX-1527 | **Superseded** in kitchen-sink | The owner: "I can hire more - but why". A hired specialist can't join the channel until FIX-1415, so hiring has no job on the page | [D8](DECISIONS.md#d8) · ER-26 | The operator's HTTP hire stays. `cli-principal` and the hire checks move to fixture hosts. Page hiring returns with FIX-1415 |
| Checks read the page after a reload; no real-model leg in the proof. Source: #2269's [D3](DECISIONS.md#d3) and ER-17; FIX-1601's plan, [#2288](https://github.com/fixpoint-labs/flow-state-dev/pull/2288) | **Amended** | Both failures the owner hit passed every keyless check (FIX-1609, FIX-1610) | D3 · ER-17 · [FIX-1601's plan amendment](PLAN.md#fix-1601s-plan-amendment) | Verdicts already recorded stand; FIX-1601's plan is amended before its next run |
| Kill line "a path needs a change in core or engine", and ER-8's "no new Layer 1 piece". Source: #2269, SPEC.md and ER-8 | **Amended** | The reply can't reach an open view without a session-wide stream the engine lacks (FIX-1609) | [D4](DECISIONS.md#d4) · ER-8 | The layer rule is retained: no Workforce word below Workforce |
| A seat answers in a channel only when its model calls `post-to-channel`; the README's "otto answers in the channel itself". Source: `packages/workforce/src/channel-post-capability.ts` header (FIX-1594); `apps/kitchen-sink/README.md` | **Amended** for routed channels | 4 posts in 6 on one real model, 0 in 2 on another | [D6](DECISIONS.md#d6) · ER-22 | The tool stays for seats that choose to post |

Re-check each source against current code before implementing. No row supersedes the channel
and board convention itself (board v1, [FIX-1455 EVOLUTION](../FIX-1455/EVOLUTION.md)).
