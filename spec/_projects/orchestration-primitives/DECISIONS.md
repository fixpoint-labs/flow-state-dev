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
to keep right. It would have flipped back had FIX-2056's closure shown those can't run as routed
tasks; FIX-2087's closure passed on `main` on Oct 24, so it holds.

**Amended by FIX-2070** (approved with its epic spec, #3983): "expects an answer" means tracked
work. Tracked work (attempts, a retry, an ending owed to its filer) is a task. A call is talk that
waits on the wait gate and is owed no tracked ending (concept rule 9; the owner's Oct 20 call).
One model-facing message tool, `sendMessage`, replaces `messageWorker`; no epic adds a second.

![PD-3's trade-off](figures/pd3-asks-are-tasks.svg)

It comes down to a post that is tracked work: a ledger-backed message needs a second once-only check to get one, which is why FIX-1872 removed the ledger on Oct 13.

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
| Does the outcome cover a task that stops for a person? | **Yes.** Each stop is one Inbox item, answered once, and FIX-2058 stays in this project. The screens that ask (approvals, AskCard, the harness question inbox) stay outside | Coordinator, Oct 21, under the owner's standing authorization for reversible calls: the recommendation, applied when the owner had not answered within an hour |
| Do retired task APIs get a deprecation release? | **No.** Removed outright in the owning PR, pre-1.0 minor bump, one migration line per removal in its changeset; no alias, wrapper or warning. FIX-2058 retiring `answerTask` and the parks, and FIX-2071's renames, follow it | Product owner, Oct 21 ([FIX-2056 (e)](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2056/DECISIONS.md#e)) |
| After a server crash, how soon does a worker hear its task's ending? | **Within a minute-scale bound**, about 50–92 s with defaults (heartbeat freshness plus releasing held notices once the sweeper marks the request interrupted). Seconds-scale needs an owner-liveness lease, deferred to FIX-2169 | Product owner, Oct 24 ([FIX-2056](https://linear.app/fixpoint-labs/issue/FIX-2056/epic-one-task-primitive-boards-settling-task-tools-and-authority#comment-44236c63); FIX-2166) |
| Does a request parked on a person keep the slot a timed-out wait holds? | **No.** It releases it at the park, the same as the filing case since FIX-2149. FIX-2058 then retired the parks this named | Product owner, Oct 24 ([FIX-2056](https://linear.app/fixpoint-labs/issue/FIX-2056/epic-one-task-primitive-boards-settling-task-tools-and-authority#comment-44236c63); FIX-2170) |
| Do the four reservation records behind an ending's delivery merge into one? | **No.** They do three jobs: the timed-out-wait hold and its crash re-check, the `noticeTaken` delivery lock, and a resend-timing hint. Merging would reverse FIX-2149 or need a kind field. FIX-2184 adds an event-order check and does not reopen this | Owner call, Oct 24 ([FIX-2056](https://linear.app/fixpoint-labs/issue/FIX-2056/epic-one-task-primitive-boards-settling-task-tools-and-authority#comment-44236c63)) |
| When does a wait on a task that already finished return? | **Once the task's notice has been handled**, and a parked notice turn counts as handled. Follow-up FIX-2186 | FIX-2181, merged Oct 24 (6ed70211) |
| Does a host without durable execution keep a park for stopping on a person? | **No.** Suspending for a person needs durable execution, on by default wherever stores persist; a host without it refuses the suspension loudly. A question holds its row and needs none. Every later epic that stops for a person builds one path | FIX-2058 D1, owner, Oct 23 ([D1](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2058/DECISIONS.md#d1)) |
| Does a person's stop end on a default deadline? | **No.** It waits until it is answered, stopped or cancelled. A host sets `userDeadlineMs` or a call passes `deadline` to opt in. Binds every kind (approval, review, input, question) and every later consumer, FIX-2163's harness review included | Owner, Oct 24 ([FIX-2058 D3](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2058/DECISIONS.md#d3)) |
| Who tells a filer that its task now waits on a person? | **FIX-2070.** FIX-2058 records the question on the row as a hold; telling the filer is a message and moved to messages | Owner, Oct 23 ([FIX-2058](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2058/DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them)) |
| Does a send or a call to a session waiting on a person run? | **Not yet: it queues** (the coordination concept's rule 10), and a FIX-2129 test pins that so a change is seen. Whether giving the key back lets one run is FIX-2070's call | FIX-2058 D2 ([D2](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2058/DECISIONS.md#d2)) |
| Does FIX-2058 rename what it built? | **No.** The word stays *hold* and `updateTask`'s field stays `question`; FIX-2071 renames them, and also owns a block throwing at its deadline where a tool returns | FIX-2058 ER-8; [wrap analysis](https://linear.app/fixpoint-labs/issue/FIX-2058/epic-one-waiting-on-a-person-always-in-inbox#comment-df99e412), Oct 27 |
| When a name is renamed, does the old one keep working? | **No.** A renamed name is refused loudly, never kept as an alias, a re-export or a second spelling read. A line that names it on purpose carries `retired-name-refusal`. The no-deprecation-release row above, applied to renames | FIX-2071 D1 ([D1](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2071/DECISIONS.md#d1)), Oct 28 |
| How does a rename land? | **From a committed codemod** under `scripts/codemod/`, in the PR that renames. A PR that conflicts is regenerated by re-running it on fresh `main`, never merged by hand | FIX-2071 ER-2 ([who owns what](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2071/DECISIONS.md#who-owns-what)) |
| Can a retired name leave the vocabulary sweep's list? | **No.** The `RETIRED` rows in `goals/vocabulary/one-word-per-thing` only ever grow. A hit kept on purpose goes in `KEEP` with its reason | FIX-2071 ER-3 ([who owns what](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2071/DECISIONS.md#who-owns-what)) |
| Where is a coordination name decided? | **In the rename table**, [`specs/epics/FIX-2071/renames.md`](https://github.com/fixpoint-labs/flow-state-dev/blob/main/specs/epics/FIX-2071/renames.md): the vocabulary contract. A later epic that finds a name wrong amends the table; it does not pick a new name in a PR | FIX-2071 D2, owner, merged with [#3985](https://github.com/fixpoint-labs/flow-state-dev/pull/3985) Oct 28 |

<a name="open"></a>
## Open

None.
