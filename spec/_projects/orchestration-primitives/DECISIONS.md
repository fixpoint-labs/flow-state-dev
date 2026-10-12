# Orchestration Primitives — decisions that bind more than one epic

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

A call is here only when a second epic would otherwise have to make it again. One-epic calls live
in that epic's own `DECISIONS.md`.

## The calls

### PD-1 · One work unit: a Task row in a TaskCollection, durable through scope

**Binds** the Plan/Task series, FIX-930, FIX-939, FIX-980, FIX-1870, and every later epic that
stores or moves work.

A pattern does not invent its own task storage, status vocabulary or lifecycle. It is a
configuration of the task board: a dispatcher, a worker and a loop over one collection. Task state
persists through the ordinary scope mechanism. Rejected: per-pattern task stores, and a separate
task-persistence layer.

**Costs** every pattern pays the board's shape, including ones that would be simpler bespoke.
Accepted. The Plan/Task series reshaped Plan & Execute, Supervisor, Coordinator and the
queue-shaped patterns onto it (FIX-447, FIX-448), and the substrate epics since have hardened one
store rather than several.

### PD-2 · A skill declares a team and its work, never how it runs

**Binds** FIX-930 and any epic that touches skills or patterns.

The project's first framing had skills declare a pattern in `SKILL.md` frontmatter, and FIX-450
shipped that in May. FIX-918, under FIX-930, reversed it in July: a skill carries instructions,
optionally a team it may delegate to, and the work as a dependency graph on a task board. The
board is the one execution path; `context: pattern` and `context: fork` are gone, and FIX-916
(skills declare a strategy) was canceled. Rejected: an execution mode as a skill-level setting.

**Costs** a skill can no longer pick a bespoke loop. Accepted, because three skill execution modes
collapsed into one, which is PD-1 applied to skills.

## Decided once

| Question | Answer | Settled by |
|---|---|---|
| Does work between workers need its own message layer? | **No.** Work moves as task rows on the board | FIX-1197 Relay, canceled Sep 20 |
| Can one session hold several parallel trains of thought? | **Not in this project** | FIX-1169 Strands, canceled Sep 20 |
| How does a flow reply to whoever dispatched it? | `session: { from: true }`, stamped by the seam, not supplied by the caller | FIX-1312 / FIX-1171 |
| How is a flow addressed when several instances of one kind run? | By its global instance id; a bare kind no longer means the first one registered | FIX-1320 |
| Can a task outlive the request that created it? | **Yes**, as a detached task under a lease | FIX-939 |

## Open

### Keep True Plan Mode and the docs catalog in this project, or move them out?

**In plain terms.** When this project started in April it promised five things. Two shipped (the
Task primitive and patterns reshaped onto it), one shipped and was then reversed (skills declaring
patterns, PD-2),
and two never started: True Plan Mode in kitchen-sink (FIX-312, FIX-449) and the architecture page
plus pattern catalog (FIX-451, with FIX-922 asking what the catalog should still list). The
project's target date was Jun 12. Since then the project has turned into a home for the task
substrate and, now, for consolidating how workers hand work to each other.

**The trade-off.** Keeping them says this project is not done until a person can plan with an
agent in kitchen-sink and read a catalog of patterns. Moving them out lets this project finish
when hand-offs are one tool, and gives True Plan Mode an owner that is about the product
experience.

**My recommendation.** Move FIX-312 and FIX-449 to the kitchen-sink or Workforce project that owns
the reference app's experience. Keep FIX-451 here, re-cut after FIX-1870 wraps so the catalog
documents one hand-off tool, not four.

**What would change my mind.** If True Plan Mode is still the demo you mean to launch the
multi-agent story with, it belongs beside the primitive it proves, and stays.

**What being wrong costs.** Low and reversible: moving an issue between projects is one field.
The real cost of not deciding is that this project reads as permanently unfinished, with two
stale milestones nobody is working toward.
