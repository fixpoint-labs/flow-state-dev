# Orchestration Primitives — decisions that bind more than one epic

[Spec](SPEC.md) · **Decisions** · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md)

A call is here only when a second epic would otherwise have to make it again. One-epic calls live
in that epic's own `DECISIONS.md`.

## The calls

### PD-1 · One work unit: a Task row in a TaskCollection, durable through scope

**Binds** the Plan/Task series, FIX-930, FIX-939, FIX-980, FIX-2056, and every later epic that
stores or moves work.

A board-based pattern invents no task storage, status vocabulary or lifecycle of its own. It
is a configuration of the task board: a dispatcher, a worker and a loop over one collection. Task
state persists through the ordinary scope mechanism. Rejected: per-pattern task stores, and a
separate task-persistence layer.

**Costs** every board-based pattern pays the board's shape, including ones that would be simpler
bespoke. Accepted. The Plan/Task series reshaped the plan- and queue-shaped patterns onto it
(FIX-447, FIX-448), and every substrate epic since hardened one store.

![PD-1's trade-off](figures/pd1-one-work-unit.svg)

It comes down to hardening: one board is fixed once, per-pattern stores are each fixed alone.

### PD-2 · A skill carries instructions, never how its work runs

**Binds** FIX-930 and any epic that touches skills or patterns.

FIX-450 shipped skills declaring a pattern in `SKILL.md` frontmatter in May; FIX-918, under
FIX-930, reversed it in July. A skill carries instructions, and its work runs as a dependency
graph on a task board. FIX-1814 (Workforce) later refused `agents:` and `workers:` in a
`SKILL.md`, so teams belong to Workforce workers. `context: pattern` and `context: fork` are
gone, and FIX-916 was canceled. Rejected: an execution mode as a skill-level setting.

**Costs** a skill can no longer pick a bespoke loop. Accepted: three skill execution modes
collapsed into one, which is PD-1 applied to skills.

![PD-2's trade-off](figures/pd2-skill-carries-instructions.svg)

It comes down to how many ways a skill's work runs: a per-skill mode keeps three paths.

### PD-3 · Anything that expects an answer is a task; a tell is a plain message

**Binds** FIX-2056 (FIX-2083 carries it out), FIX-2058, FIX-2070, FIX-1786's coordinator,
FIX-1816 (its D3 is amended), and every later epic that sends work or words between workers.

A post that needs a confirmed answer is a task: filed with `createTask`, waited on with
`getTask({ id, wait })`, claimed once, and its ending told to the filer once. A tell is a plain
message with no row, deadline or once-only check. FIX-1872 removed the coordinator delivery ledger
on Oct 13; FIX-2083 finishes the job by making posts routed tasks. Rejected: a ledger-backed
message, and a task for every post, which gives a tell a row nobody answers. No model-facing tell
tool; a "question" task class is deferred until something needs it.

**Costs** what FIX-1816's D3 protected, each delegate's line, routing and rounds, rides on
tasks, and the sender must know which kind it sends. Accepted: one answer-once check is one thing
to keep right. If FIX-2056's closure shows those can't run as routed tasks, this flips back.

![PD-3's trade-off](figures/pd3-asks-are-tasks.svg)

It comes down to a post that expects an answer: today's message needs a second once-only check to get one.

## Decided once

| Question | Answer | Settled by |
|---|---|---|
| Does work between workers need its own message layer? | **No.** Work moves as task rows | FIX-1197 Relay, canceled Sep 20 |
| Can one session hold several parallel trains of thought? | **Not in this project** | FIX-1169 Strands, canceled Sep 20 |
| How does a flow reply to whoever dispatched it? | `session: { from: true }`, stamped by the seam, never the caller | FIX-1312 / FIX-1171 |
| How is a flow addressed when several instances of one kind run? | By its global instance id | FIX-1320 |
| Can a task outlive the request that created it? | **Yes**, as a detached task under a lease | FIX-939 |
| Do True Plan Mode and the pattern catalog stay here? | **No.** FIX-312 and FIX-449 went to Human-in-the-Loop, FIX-451 to Multi-Agent Patterns; milestones v3 and v5 deleted Oct 12 | Product owner, Oct 11 |
| Does the outcome cover every multi-agent pattern? | **Only board-based ones.** `roundRobin` and `debate` run their own loop; FIX-922 decides whether they stay patterns | Product owner, Oct 12 |
| What carries a post that expects an answer, and one that doesn't? | **A task**, filed by `createTask` and waited on by `getTask({ id, wait })`; a tell is a plain message ([PD-3](#pd-3--anything-that-expects-an-answer-is-a-task-a-tell-is-a-plain-message)). `dispatchTask` and `addTask` retire | Product owner, Oct 11; re-homed by FIX-2056, Oct 21 |
| Does any FIX-2056 child wait on FIX-2058? | **No**, or each blocks the other and FIX-2056 never wraps. Answering a question by steer and marking a task *waiting on a person* are FIX-2058's; `answerTask` and the parks stay until then | FIX-2056 D2, approved Oct 21 ([#3588](https://github.com/fixpoint-labs/flow-state-dev/pull/3588)) |

<a name="open"></a>
## Open

### FIX-2058 and "not a way to ask a person": widen the outcome, or move the epic?

**Plain terms.** This spec puts asking a person something outside the project. FIX-2058, filed
here, makes every stop for a person one Inbox item, and FIX-2056's D2 hands it the answer by
steer. Both can't stand.

**The trade-off.** Widening keeps the Inbox beside the task gate it hangs on, but this project
then owns a person-facing surface. Moving FIX-2058 to Human-in-the-Loop keeps this project to
work between workers, at the cost of a cross-project dependency.

**My recommendation:** widen. Add "a task that stops for a person waits in one place, answered
once" to *Winning when*, and narrow the exclusion to the asking screens themselves.

**What would change my mind:** Human-in-the-Loop already planning to own the Inbox.

**What being wrong costs:** low and reversible: one line of scope, and where FIX-2058's spec is
reviewed.
