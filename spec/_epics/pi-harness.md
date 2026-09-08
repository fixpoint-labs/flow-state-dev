# OMP coding runs ask, park, and continue

OMP cannot yet run under FSD's harness manager. This epic adds it without another
manager or operator console, then connects spontaneous questions
to the existing durable human-wait path.

**Epic:** [LAB-162](https://linear.app/fixpoint-labs/issue/LAB-162) ·
**Review:** [#1612](https://github.com/fixpoint-labs/flow-state-dev/pull/1612), never merged.
The historical branch and file names are retained so existing review links keep working.

## 1. Purpose & objective

**Outcome.** A person dispatches an OMP coding run through the harness manager.
When it encounters a real question, it asks and parks. The person answers through
the existing operator surface, and a later attempt
continues the same coding conversation rather than starting over.

The manager already supports multiple harnesses; Claude Code is not its only slot.
Its question-marker path already supports prompted asking, parking, and answering,
but has no trusted handoff for a runtime-captured question. This epic must supply that
handoff—not infer that spontaneous ask is already wired or invent another human-wait model.

**Proof.** Dispatch a real OMP run, capture a spontaneous question, durably park the
task and end its attempt, stop the runtime, answer through the existing surface, and
resume the exact saved session. A generated fact learned before the question must
survive without being included in the answer prompt. The run then settles.
User cancellation must remain cancellation. Missing or mismatched resume data must
fail rather than silently start a fresh conversation.

**Holistic necessity.** Two issues: [LAB-163](https://linear.app/fixpoint-labs/issue/LAB-163)
provides the OMP harness; [LAB-164](https://linear.app/fixpoint-labs/issue/LAB-164) connects
questions and owns the shared handoff and full proof. Keep that work within the two
issues; no separate transport, console, or contract-extraction project. An adapter alone is independently
useful, but does not discharge this epic's question-and-resume objective.

**Lead measure.** Report which parts of that full-path proof have run, against which
OMP version. Model-free RPC compatibility is not a completed outcome.

**Not doing.** Upstream pi support; a console or FSD flow-running extension inside
pi/OMP; a second inbox or answer verb; operator-approved tool execution; worker
`ctx.suspend`; holding a runtime or request open during human wait; a bespoke HTTP
answer channel; a shared pi/OMP abstraction; changes to unrelated harnesses' policy.

**Kill line.** If OMP cannot do all of the following—safely capture a question, stop
and persist the conversation, and continue that exact session after an answer—return
to the objective gate. Do not substitute live blocking, fresh-session replay,
or adapter-only delivery and call the epic complete. The full sequence is **unproven**.

**Approval sought.** Approve this outcome and two-issue scope. The owner has selected
harness-only, **OMP first, pi deferred**, and **questions first, tool approvals deferred**.
These choices do not approve this objective or either issue's implementation design.
The smaller scope delays pi users and operator-controlled tool execution; reconsider
when either is an immediate need. Tool permissions remain the host's configured policy.
No implementation starts at this gate.

## 2. Themes & long-horizon direction

1. **One human-wait model.** Preserve
   [FIX-1241 / D-1](https://linear.app/fixpoint-labs/issue/FIX-1241)
   ([decision record #1429](https://github.com/fixpoint-labs/flow-state-dev/issues/1429)):
   a question becomes durable, the task parks, the worker request ends, and the existing
   answer/unblock path starts a later attempt. `announce` follows parking. The runtime
   adapter supplies evidence; the manager remains authoritative for task and inbox state.
   A live RPC dialog is only a runtime seam, not durable human wait.
   Classify dialog origin: tool approvals and extension UI are not operator questions.
   Non-question permission prompts follow the host's configured allow/deny policy;
   they do not enter this epic's parked-question path.

2. **One trusted question handoff, currently missing.** The manager's existing intake
   reads an attempt-keyed ask marker after the harness returns; it parks only when the
   handle is `completed` and that attempt has a question. Throw, user cancellation,
   deadline abort, or a non-completed handle does not take that park arm. A runtime
   stop therefore cannot be relabeled as completion just to make parking happen.
   LAB-164 owns the handoff from captured question to this intake and specifies it
   jointly with LAB-163 before either affected interface is finalized. The manager
   must provide the attempt-correlated destination through a trusted path or callback:
   no prompt parsing, invented fixed filename, or question hidden in `finalMessage`.
   The POC first tests preserving the single marker intake plus an orderly completed
   harness step. If that is not honest or viable, a change to the harness contract
   **or manager question intake** returns to this epic before either issue assumes it.
   This is explicit integration work in the two-issue set, not a seam claimed to exist.

3. **Conform to the shipped harness contract.** `packages/core/src/types/harness.ts`
   owns the contract, and `packages/harness-manager` owns the slot and manager policy.
   Keep model-visible input prompt-only; cwd, resume, and other run configuration use
   the trusted channel. Report session identity through `onSession` during the run.
   User cancellation throws; do not translate it into successful parking. Respect
   `HarnessRunOutcome`, not process exit or RPC acknowledgement as a substitute.
   The handoff in theme 2 is shared work; any other harness-contract or manager-intake
   change must come back here before either issue assumes it.

4. **OMP is a runtime, not a renamed pi executable.** Use OMP's native integration
   seams rather than port the old file-mailbox companion. Source inspection identifies
   `--mode rpc-ui` as the native-ask path; plain `rpc` supports extension dialogs but does
   not enable the native ask tool. Installed OMP 18.1.14 registered `ask` in a local
   `rpc-ui --tools ask` probe; the mode distinction rests on source inspection,
   not a local negative control. Keep runtime translation inside the OMP harness. The public package
   name and adapter API belong to LAB-163's spec, not to a speculative two-runtime layer.

5. **Conversation identity survives; pending UI promises do not.** Both inspected
   runtimes keep outstanding RPC UI requests in process memory. An old UI response ID
   cannot be answered after restart. The manager's durable answer must continue the
   recorded conversation in a new attempt. Resume lookup must fail closed on missing,
   corrupt, or mismatched material, because the runtimes can otherwise create a new
   session at an explicit missing path. Neither a reported path nor an in-memory ID
   proves that resumable history has been persisted.

6. **Prove the risky boundary before committing the production design.** LAB-164's
   bounded feasibility POC precedes finalizing either issue's affected interface. After
   their own spec approvals, LAB-163 implements the adapter first and LAB-164 builds on
   it. LAB-164 is blocked by LAB-163 for delivery, not forbidden from investigating the
   shared premise first. A failed safe-stop/persistence proof reopens the epic rather
   than creating an unplanned suspension or transport issue.

## 3. Shape of the whole

**Built:** the original throwaway pi probes, plus a model-free RPC dialog probe run on
installed pi 0.85.1 and OMP 18.1.14; a separate OMP `rpc-ui` registration check.
**See:** [POC record](../../spec-poc/epic-pi-harness/README.md) and its `runtime-check/` evidence.
**Showed:** both answered the same extension confirmation over stdio; OMP exposed native
`ask` in `rpc-ui`. No model/tool approval, durable park, restart-resume, or assembled manager
loop was proved. The model-free commands did not persist session files in either runtime.
**Changed:** choose OMP first; remove console work, the bespoke answer transport, and
live-held human wait. Keep the full-path proof as an explicit requirement, not a claimed result.

<details>
<summary>Runtime comparison and evidence boundaries</summary>

| Concern | OMP | Upstream pi | Evidence |
|---|---|---|---|
| Headless control | `rpc` and `rpc-ui` over stdio | `rpc` over stdio | Source; both launched locally |
| Spontaneous ask | Native `ask`, enabled in `rpc-ui` | No native ask; a registered question tool is needed | Source; OMP registration checked locally |
| Extension confirmation | `extension_ui_request` / response | Same round-trip shape | Executed locally on both |
| Saved-session continuation | Explicit file + later prompt | Explicit file + later prompt | Source only; no restart-resume proof here |
| Terminal completion and cancellation | OMP-specific events and lifecycle | Pi-specific events and lifecycle | Source; not interchangeable |
| Durable human wait | Manager must own it | Manager must own it | Pending RPC maps are process-local |

Pinned source: OMP
[`daf07999`](https://github.com/can1357/oh-my-pi/tree/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e)
and pi
[`b2602be7`](https://github.com/earendil-works/pi/tree/b2602be77cb7b0de45dd616407fd210daa48aa75).
The inspected manifests report 18.1.14 and 0.85.1 respectively; matching version strings
are not proof that an installed release contains every inspected main-branch change.

Primary references: [OMP RPC](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/docs/rpc.md),
[OMP CLI setup](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/packages/coding-agent/src/main.ts),
[OMP ask](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/packages/coding-agent/src/tools/ask.ts),
[OMP sessions](https://github.com/can1357/oh-my-pi/blob/daf07999c2fee9b22edc7bf8fea1fb6272e0df5e/packages/coding-agent/src/session/session-manager.ts),
[pi RPC](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/docs/rpc.md),
and [pi sessions](https://github.com/earendil-works/pi/blob/b2602be77cb7b0de45dd616407fd210daa48aa75/packages/coding-agent/src/core/session-manager.ts).

</details>

## 4. Running index

| Issue | What it delivers | Route | Spec PR | Impl PR | State |
|---|---|---|---|---|---|
| [LAB-163](https://linear.app/fixpoint-labs/issue/LAB-163) | Dispatch, observe, cancel, resume OMP through the existing contract | spec | — | — | Backlog; epic approval pending |
| [LAB-164](https://linear.app/fixpoint-labs/issue/LAB-164) | Spontaneous questions, trusted handoff, durable wait, integrated proof | spec | — | — | Backlog; delivery blocked by LAB-163 |

Related, not duplicated: [LAB-140](https://linear.app/fixpoint-labs/issue/LAB-140)
owns the manager program; [LAB-154](https://linear.app/fixpoint-labs/issue/LAB-154)
owns its packaging and manager-side session association. LAB-163 supplies OMP's side
of `resume`/`onSession`; it does not redo that manager work.
[LAB-151](https://linear.app/fixpoint-labs/issue/LAB-151) owns the operator board.
[FIX-1246](https://linear.app/fixpoint-labs/issue/FIX-1246) is the standing substrate
same-session POC. LAB-164 adds OMP-specific capture/stop evidence and must reuse its
continuity standard, not claim to close or supersede that broader issue. Restarting
a process is an adversarial condition here, **not** proof: the same session identity
and generated fact must survive. No fresh-session success satisfies D-1 or FIX-1246.

No existing Linear epic for this pi/OMP proposal was found; LAB-162 and its two children
replace the draft's placeholder PI issue numbers. They share the Development Workflow
Orchestration project and the OMP question-and-resume proof milestone.

## 5. Open cross-cutting questions

- **Can the trusted handoff and safe capture → stop → persist → answer → same-session
  continuation work?** Open empirical premise, owned by LAB-164's feasibility POC
  with LAB-163 under theme 2. Blocks committing the affected production design. Test orderly parking
  separately from user abort, including blocked-tool cancellation and process shutdown;
  a working UI round trip does not settle it.
- **Runtime audience?** Resolved by owner: OMP first; upstream pi deferred. Reopen for an
  immediate pi audience, not because the protocol names look alike.
- **Console and human-wait model?** Console removed by owner scope choice; existing
  park/end-request/answer model retained under [D-1](https://linear.app/fixpoint-labs/issue/FIX-1241).
  [D-9](https://linear.app/fixpoint-labs/issue/FIX-1309)
  ([record #1562](https://github.com/fixpoint-labs/flow-state-dev/issues/1562)) retains
  the existing operator surface. No issue may reopen either locally.
- **Tool authorization?** Resolved by owner after restraint review: questions first;
  operator-approved tool execution deferred. It is a separate outcome, not free delivery plumbing.

## Epic evolution

- **Original draft** — pi harness plus an in-editor operator console and live question channel.
- **Four-lens review** — found conflicts with D-1/D-9, a stale Claude-only baseline, and
  unsupported live-wait assumptions; synced the branch with the shipped harness substrate.
- **Owner scope choices and runtime research** — harness-only, OMP first, pi deferred;
  replaced five placeholder work items with LAB-163 → LAB-164 under LAB-162 and made the
  missing durable interaction proof explicit. Objective approval remains pending.
- **Final review and owner cut** — removed tool approvals; named the missing trusted
  question handoff and its completed-handle gate; reconciled FIX-1246. Deferred the
  exact handoff design to the joint feasibility check rather than assuming it shipped.
