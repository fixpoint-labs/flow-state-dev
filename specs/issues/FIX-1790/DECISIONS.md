# FIX-1790 · Decisions

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The calls above this issue are the epic's: user data is kept per (user, org) for every flow, and
a record stored before is dropped, never read in any org and never moved
([ER-3](../../epics/FIX-1786/BUSINESS-RULES.md#what-a-team-gets-and-what-it-doesnt),
[D3](../../epics/FIX-1786/DECISIONS.md#d3), [D9](../../epics/FIX-1786/DECISIONS.md#d9)). The
two cards here answered how an operator's copy step attributed a saved record to an org. The
epic's D9 withdrew the step, and the cards with it. What this issue still decides is under
*Decided, not asked*.

<a name="d1"></a>
## D1 · Removed by epic D9 · data saved before the upgrade was read by nothing until an operator copied it

Its first half holds as epic ER-3: data saved before this release is read by nothing, and each
user starts empty in each org. Its second half, the operator's copy, was withdrawn on 2026-10-07
by [epic D9](../../epics/FIX-1786/DECISIONS.md#d9): "No consumers yet. No need for backwards support of any kind." The card as written
is at [the commit before the sweep](https://github.com/fixpoint-labs/flow-state-dev/blob/2ab5e6b0bd77c798142a48922131aa52f45f737d/specs/issues/FIX-1790/DECISIONS.md#d1).

<a name="d2"></a>
## D2 · Removed by epic D9 · the step copied a saved cell to the one org its writers' sessions named

Withdrawn with D1: it decided which org the copy step chose, and the step is gone. The card as
written is at [the commit before the sweep](https://github.com/fixpoint-labs/flow-state-dev/blob/2ab5e6b0bd77c798142a48922131aa52f45f737d/specs/issues/FIX-1790/DECISIONS.md#d2).

## Decided, not asked

- **One cell per (user, org) for every flow, the one hired workers already use**,
  `<user>:~org:<org>`, plus the flow when flow-isolated ([pinned names](PLAN.md#pinned-names)).
  A hired worker's shared data doesn't move, and it now shares a user's cell with the app's other flows
  in that org, as any two flows do; the registry still refuses incompatible schemas. FIX-1538 kept
  them apart only because the app's cell crossed orgs ([EVOLUTION.md](EVOLUTION.md)).
- **The org comes from the admitted run or the stored session**, never a header or body (BP-031).
  A pinned worker's equals its pin's; admission checked that.
- **A missing or blank org throws.** No path builds the cross-org key (ER-13).
- **Flow-isolated keys gain the org too.**
- **A schedule's dispatch names the org**, and the row must name the same one: the id selects a
  cell and grants nothing. It has to be in the id, not only on the index row: every producer,
  the Vercel tick and BullMQ included, reaches the resolver through the one dispatch id, and
  Alice can hold a schedule `daily` in Acme and in Globex. A two-part id names neither, and
  finding it from the index would be a read across orgs.
- **The harness seeds through the engine's derivation**, with the run's org.
- **Old-term exports left in place** for FIX-1796 and FIX-1798: `IsolationFlow.ownerPin`
  (accepted and ignored, with no deprecation marker, per [epic D9](../../epics/FIX-1786/DECISIONS.md#d9)), `ScheduleResolutionContext.ownerPin`, `InstanceOwnerPin`.

## Considered and dropped

| Alternative | Why not |
|---|---|
| A new cell shape for unpinned flows, hired workers kept apart | Keys on the pin FIX-1798 removes, and two cells per user per org isolate nothing |
| A deployment-wide "old data belongs to org X" setting | A permanent second read path, wrong for any deployment that ever had two orgs |
| A shipped migration command, or moving cells instead of copying them | Withdrawn with the step: since [epic D9](../../epics/FIX-1786/DECISIONS.md#d9), nothing moves or copies an old cell |

## Settled

- **No new key equals an old one, and no two (user, org, flow) tuples share one** —
  **CONFIRMED** by `poc/key-shape/`: about four million keys from ids over `a : \ ~ o` and `~org`,
  all distinct; the shared key equals FIX-1538's pinned cell every time; without the `~org`
  marker, 24,964 collisions. An old cell is unreachable by construction, so nothing reads it and no
  guard is needed (epic ER-3).
- **Every production user key comes from the one derivation; only the schedule resolver lacks an
  org** — **CONFIRMED** at `fbecfe6f2` by `poc/key-sites/`: nine files, planted control failed.

## How it got here

- **Draft** — framed as ER-3's attribution question; one (user, org) cell for every flow,
  reusing the hired worker's shape, with the org from the run or the stored session; old cells inert by
  construction and copied by a documented operator step that attributes per writing flow; one PR.
- **Review round 1** — D2 now needs the operator to vouch that no session is missing, because a
  deleted session leaves no trace and the ones left could name one org while the deleted ones
  named another (Codex). The step's SQL is walked on Postgres as well as SQLite before it is
  published (second look).
- **Amended after merge, the D9 sweep (2026-10-07)** — [epic D9](../../epics/FIX-1786/DECISIONS.md#d9) withdrew the copy step: D1 and D2,
  BR-15 to BR-20, leg c and its `fallback-read` control, V4, V7 and the upgrade docs. Old records
  are dropped ([EVOLUTION.md](EVOLUTION.md#amendment-d9)).

**Open: none.**
