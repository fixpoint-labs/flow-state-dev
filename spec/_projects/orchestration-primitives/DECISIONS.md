# Orchestration Primitives — decisions that bind more than one epic

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

A call is here only when a second epic would otherwise have to make it again. One-epic calls live
in that epic's own `DECISIONS.md`.

## The calls

### PD-1 · One work unit: a Task row in a TaskCollection, durable through scope

**Binds** the Plan/Task series, FIX-930, FIX-939, FIX-980, FIX-1870, and every later epic that
stores or moves work.

A board-based pattern does not invent its own task storage, status vocabulary or lifecycle. It
is a configuration of the task board: a dispatcher, a worker and a loop over one collection. Task state
persists through the ordinary scope mechanism. Rejected: per-pattern task stores, and a separate
task-persistence layer.

**Costs** every board-based pattern pays the board's shape, including ones that would be simpler bespoke.
Accepted. The Plan/Task series reshaped Plan & Execute, Supervisor, Coordinator and the
queue-shaped patterns onto it (FIX-447, FIX-448), and the substrate epics since have hardened one
store rather than several.

![PD-1's trade-off](figures/pd1-one-work-unit.svg)

It comes down to hardening: one board is fixed once, per-pattern stores are each fixed alone.

### PD-2 · A skill carries instructions, never how its work runs

**Binds** FIX-930 and any epic that touches skills or patterns.

The project's first framing had skills declare a pattern in `SKILL.md` frontmatter, and FIX-450
shipped that in May. FIX-918, under FIX-930, reversed it in July: a skill carries instructions,
and its work runs as a dependency graph on a task board. FIX-918 also let a skill name a team it
may delegate to; FIX-1814 (Workforce) removed that, and a `SKILL.md` declaring `agents:` or
`workers:` is now refused, so teams belong to Workforce workers. The board is the one execution
path; `context: pattern` and `context: fork` are gone, and FIX-916
(skills declare a strategy) was canceled. Rejected: an execution mode as a skill-level setting.

**Costs** a skill can no longer pick a bespoke loop. Accepted, because three skill execution modes
collapsed into one, which is PD-1 applied to skills.

![PD-2's trade-off](figures/pd2-skill-carries-instructions.svg)

It comes down to how many ways a skill's work runs: a per-skill mode keeps three paths.

### PD-3 · Anything that expects an answer is a task; a tell is a plain message

**Binds** FIX-1870, FIX-1786's coordinator, FIX-1816 (its D3 is amended), and every later epic
that sends work or words from one worker to another.

A post that needs a confirmed answer is a task, sent through `dispatchTask`: claimed once, ended
done or failed, and the caller hears the ending. A tell that expects no reply is a plain message,
`dispatcher()` from flow code or a session message, with no row, deadline or once-only check. It
is the split Claude Code draws between a task and a message. FIX-1870's D2 becomes "every
coordinator post that expects an answer is a task", which amends FIX-1816's D3 from two answer-once
checks to one, the claim ticket, and lets FIX-1872 remove the coordinator delivery ledger. FIX-1872's
spec first checks whether any coordinator post today is a tell. Rejected: today's ledger-backed
message, a second check beside the claim ticket, and a task for every post, which gives a tell a
row nobody answers. No model-facing tell tool is added. A separate "question" task class, shown
differently in the UI, is deferred until something needs it.

**Costs** what D3 protected, each delegate's own line, the routing policy and the rounds, has to
ride on tasks instead of the ledger, and the sender has to know which kind it is sending. Accepted,
because one way to be answered once is one thing to keep right. If FIX-1870's regression gate
shows a post's per-delegate lines or rounds can't run as tasks, this flips back to D3's two checks.

![PD-3's trade-off](figures/pd3-asks-are-tasks.svg)

It comes down to a post that expects an answer: today's message needs a second once-only check to get one.

## Decided once

| Question | Answer | Settled by |
|---|---|---|
| Does work between workers need its own message layer? | **No.** Work moves as task rows on the board | FIX-1197 Relay, canceled Sep 20 |
| Can one session hold several parallel trains of thought? | **Not in this project** | FIX-1169 Strands, canceled Sep 20 |
| How does a flow reply to whoever dispatched it? | `session: { from: true }`, stamped by the seam, not supplied by the caller | FIX-1312 / FIX-1171 |
| How is a flow addressed when several instances of one kind run? | By its global instance id; a bare kind no longer means the first one registered | FIX-1320 |
| Can a task outlive the request that created it? | **Yes**, as a detached task under a lease | FIX-939 |
| Do True Plan Mode and the pattern catalog stay in this project? | **No.** FIX-312 and FIX-449 moved to Human-in-the-Loop; FIX-451, the architecture page and catalog, to Multi-Agent Patterns. Their milestones, v3 and v5, were deleted Oct 12 | Product owner, Oct 11 |
| Does the outcome cover every multi-agent pattern, or only those on the task board? | **Only board-based patterns.** A pattern that runs its own loop off the board, today `roundRobin` and `debate`, is outside the outcome; FIX-922 still decides whether those stay patterns. The work unit and the answer-once fence are what this project hardens, and a pattern that never touches the board gains nothing from either | Product owner, Oct 12 |
| What carries a post that expects an answer, and what carries one that doesn't? | **A task** through `dispatchTask`, claimed once; a tell is a plain message with no once-only check ([PD-3](#pd-3--anything-that-expects-an-answer-is-a-task-a-tell-is-a-plain-message)) | Product owner, Oct 11; amends FIX-1816 D3 |

## Open

None.
