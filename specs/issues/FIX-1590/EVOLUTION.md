# FIX-1590 · Evolution

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · **Evolution**

Only lineage this issue changes. The epic's own record is
[its EVOLUTION.md](../../epics/FIX-1592/EVOLUTION.md).

| Prior intent and precise source | Treatment | Reason / evidence | Replacement | Compatibility |
|---|---|---|---|---|
| The notify block names each member in a transient line and wakes none; "a real app puts a dispatcher here". Source: `apps/kitchen-sink/workforce/channel-notify.ts`, shipped by FIX-1476 ([#2007](https://github.com/fixpoint-labs/flow-state-dev/pull/2007)); the epic already records it as amended | **Amended** for agent members | A post has to reach the agents ([epic ER-2](../../epics/FIX-1592/BUSINESS-RULES.md#what-a-person-gets)); [POC W1–W3](poc/wake-premises/README.md) | [D3](DECISIONS.md#d3) · BR-1, BR-3 | Clerk and runner members, a seat-authored post and a member with no dispatcher keep the line, byte for byte. The writer skip ([FIX-1476](../FIX-1476/BUSINESS-RULES.md) BR-16a, leg V14) is retained |
| The agent kind declares only a public `run`. Source: `packages/workforce/src/agent-worker-flow.ts` | **Amended**: an internal entry is added; `run` is unchanged | A dispatch resolves only internal entries ([`action-forms.md`](../../../docs/architecture/action-forms.md#dispatched-internal-and-task-entries)); the round-1 finding on [#2265](https://github.com/fixpoint-labs/flow-state-dev/pull/2265#discussion_r4107585826) | [D1](DECISIONS.md#d1) · S1 | Existing seats gain the entry on the next boot. Nothing stored changes |
| This issue's first ask: a post runs the `desk-clerk` member's `answer` as well as the agent's `run`. Source: the FIX-1590 Linear description, "Acceptance honesty" (Architect, 2026-09-25) | **Superseded** | The epic keeps the wake agent-only ([epic D1](../../epics/FIX-1592/DECISIONS.md#d1), "Why the wake stays agent-only") | BR-2 | Nothing was built against it. Waking clerks is one map entry once the `escalations` call is made |

Re-check each source against current code before implementing: FIX-1585 and FIX-1589 land in
this area first.
