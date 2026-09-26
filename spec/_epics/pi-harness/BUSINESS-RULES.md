# LAB-162 · Rules every issue in the set obeys

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md)

At epic altitude the rules aren't behaviours of one feature; they're the constraints both child
specs and both implementations must satisfy, and the place a cross-spec review checks. Each says
who owns it and where it's checked. ER-1 to ER-7 are the rows of the ownership matrix in
[DECISIONS.md](DECISIONS.md#who-owns-what).

## What an operator gets, and what they don't

| # | Rule | Owner | Checked at |
|---|---|---|---|
| ER-1 | A dispatched OMP run executes in the selected checkout, produces observable output, and settles through the existing manager | LAB-163 | LAB-163's tests · the full-path proof |
| ER-2 | Cancellation stops work and throws. A prompt acknowledgement, an intermediate event or a process exit is never read as completion, and a runtime stop is never relabelled as successful parking | LAB-163 ([D4](DECISIONS.md#d4)) | LAB-163's tests · the proof's negative cases |
| ER-3 | A later attempt reopens the same saved session and remembers a fact the run generated before the question, absent from the new prompt. Missing, corrupt or mismatched resume material fails rather than starting a fresh conversation | LAB-163 ([D6](DECISIONS.md#d6)) | LAB-163's tests · the full-path proof |
| ER-4 | A captured question reaches the manager's intake through one trusted, attempt-correlated path | LAB-164 decides · LAB-163 co-specifies ([D3](DECISIONS.md#d3)) | The joint feasibility check · both spec reviews |
| ER-5 | The attempt and the worker request end at the park. No runtime process and no worker request is retained during human wait | LAB-164 ([D2](DECISIONS.md#d2)) | The full-path proof |
| ER-6 | Only a real question enters the parked-question path. Tool-permission prompts and extension UI dialogs do not; they follow the host's configured allow/deny policy | LAB-164 ([D2](DECISIONS.md#d2)) | LAB-164's tests · the proof |

## What no child may do

| # | Rule | Because |
|---|---|---|
| ER-7 | No child changes the harness contract or the manager's question intake without returning to this epic first | [D4](DECISIONS.md#d4). Two authorities over one seam is what the manager was extracted to prevent |
| ER-8 | No child routes a question by parsing a prompt, duplicating a fixed filename, or hiding it in `finalMessage` | [D3](DECISIONS.md#d3). Each of those is an untrusted channel wearing the handoff's clothes |
| ER-9 | No child adds a second inbox, a new answer verb, a bespoke HTTP answer transport, worker `ctx.suspend`, or a wait that holds a runtime or request open | [D2](DECISIONS.md#d2), and D-1 before it. The existing park/answer path is the one model |
| ER-10 | No child adds operator-approved tool execution, or moves tool permissions off the host's configured policy | [D1](DECISIONS.md#d1). A separate outcome, deferred by the owner |
| ER-11 | No child adds upstream pi support, ports the file-mailbox companion, or builds a shared pi/OMP abstraction | [D1](DECISIONS.md#d1), [D5](DECISIONS.md#d5). One runtime is supported; a two-runtime layer is speculation |
| ER-12 | No child changes another harness's behaviour or policy | The set adds a slot; it does not renegotiate the ones already in it |
| ER-13 | No child closes, supersedes or re-parents [FIX-1246](https://linear.app/fixpoint-labs/issue/FIX-1246), [LAB-140](https://linear.app/fixpoint-labs/issue/LAB-140), [LAB-151](https://linear.app/fixpoint-labs/issue/LAB-151) or [LAB-154](https://linear.app/fixpoint-labs/issue/LAB-154) | Consumed, not owned. FIX-1246 keeps the broader same-session standard this epic reuses |

## How the set is run

| # | Rule | Because |
|---|---|---|
| ER-14 | The joint feasibility check runs before either affected interface is finalized, and before either issue's production design is committed | [D3](DECISIONS.md#d3). The handoff is the epic's one empirical premise; committing a design to it first is the expensive order |
| ER-15 | A cross-cutting question a child hits is commented **up** on the epic PR, not answered locally | [DECISIONS.md](DECISIONS.md) is the single place. A local answer is a second authority |
| ER-16 | Both issues route *spec*; neither starts implementation before the epic objective gate **and** its own spec approval | Fail-closed gating. Owner scope choices are not implementation approval |
| ER-17 | Every claim records what was executed against which pinned OMP version, and what was not | The lead measure. Source inspection and model-free RPC probes are available-seam evidence, never end-to-end proof |
| ER-18 | A child's Linear state is mirrored the moment it changes | The epic wake derives blocked-by from Linear; a stale child blocks its dependant whatever its PRs say |

## The proof

| # | The epic is done when | Proved by |
|---|---|---|
| ER-19 | A real OMP run reaches a real question; the operator sees it through the existing surface after durable parking; the runtime is stopped; an answer continues the exact saved session, with a pre-question generated fact intact and absent from the answer prompt; the task settles | LAB-164's full-path evidence, reproducible, against a pinned OMP version |
| ER-20 | User cancellation stays cancellation; late, duplicate and cross-attempt answers cannot affect another run; missing or corrupt resume material and runtime failure fail safely, without a silent fresh session | LAB-164's negative cases, run separately from the happy path |
| ER-21 | If safe capture, stop, persistence or same-session continuation cannot be shown, the epic returns to the objective gate | The kill line. No live wait, fresh-session replay or adapter-only delivery is substituted and called complete |

**Restarting a process is an adversarial condition here, not the proof.** The same session identity
and the generated fact must survive it. No fresh-session success satisfies D-1 or FIX-1246
([DECISIONS.md → decided in review](DECISIONS.md#decided-in-review-recorded-so-no-child-reopens-them)).
