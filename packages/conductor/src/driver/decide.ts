/**
 * `decide(entity, signal, world) → Action[]` — the deterministic spine.
 *
 * A reducer: one signal in, the actions that follow out. Pure, synchronous, and
 * exhaustively testable over the phase × gate × signal matrix.
 *
 * The invariant this file exists to hold:
 *
 * > **Every transition is reproducible from the ledger.**
 *
 * A model may sit anywhere *upstream* of a signal — classifying a human comment
 * into `feedback_received` versus `question_asked` is real judgment and belongs
 * to a model. Its output is recorded as a signal, so a wrong call produces a
 * wrong-but-valid transition that is visible in the ledger and replayable. A
 * model *inside this function* would produce a different transition each run
 * from identical state: unauditable, untestable, and the exact failure this
 * design exists to remove. That is the whole claim. It is not that judgment is
 * unwelcome; it is that judgment must be recorded before it is acted on.
 *
 * Two structural rules follow, and both are enforced here rather than assumed:
 *
 * - **Unknown input is inert, never fatal.** An unrecognized signal, a phase
 *   that does not belong to the entity kind, or a signal addressed elsewhere
 *   all reduce to `[]`. A hand-edited or partially-migrated ledger degrades
 *   instead of crashing the tick.
 * - **Duplicates and out-of-order arrivals are harmless.** Actions are
 *   idempotent, and every decision is taken against the *current* world rather
 *   than against signal history, so replaying a signal re-derives the same
 *   answer.
 */

import type { Action, ActionBase, RecordApprovalAction } from "../model/actions";
import {
  activeArtifact,
  activePr,
  artifactKindForPhase,
  phaseDefinition,
} from "../model/phases";
import type { Signal } from "../model/signals";
import {
  freshHumanApprovals,
  type PullRequestFacts,
  type World,
} from "../model/world";
import { deriveGate, isPhaseComplete, type ConductorEntity } from "./derive-gate";

/** The PR number a signal is about, or `undefined` when it is not PR-bound. */
function signalPullNumber(signal: Signal): number | undefined {
  return "pullNumber" in signal ? signal.pullNumber : undefined;
}

/**
 * Drop a signal that is about something other than the artifact this phase is
 * working on — a late approval on a spec PR must not advance an implementation,
 * and neither must a check that failed on it.
 *
 * Two scopes, because a signal can miss in two ways:
 *
 * - **By PR.** The signal names a pull request the phase does not own.
 * - **By SHA**, for `ci_concluded` specifically. Its `pullNumber` is optional
 *   (a check-run webhook does not always name a PR), so the PR test alone would
 *   let every unscoped conclusion through — the hole that let a spec PR's red
 *   check dispatch `addressFeedback` against the implementation. A conclusion
 *   for a commit that is not the active PR's head is stale whatever produced it:
 *   it grades code that has already been superseded.
 *
 * **The leniency for a phase that holds no PR yet is `pr_opened` and nothing
 * else.** A backdated `pr_opened` synthesized by reconciliation arrives
 * precisely because conductor had no record of that PR, so dropping it would
 * defeat the recovery it exists for — and it is the one PR-bound signal that
 * can dispatch nothing on its own. The most it does is re-derive completion
 * against the snapshot, which can only advance a phase the *world* already says
 * is finished. Every other PR-bound signal answers with work aimed at the
 * phase's own artifact, and with no artifact to aim at, that work lands on the
 * wrong branch.
 *
 * A blanket leniency did exactly that, on the ordinary happy path: closing an
 * approved spec PR unmerged *is* the process, and the batch that first observes
 * it advances the entity to `IMPLEMENTATION` on the backdated `pr_opened`
 * before the queued `pr_closed` is reduced. The new phase has no implementation
 * artifact yet, so the stale spec closure passed unscoped and the universal
 * handler filed a human-intervention escalation against correct behaviour. An
 * escalation that fires on the happy path trains everyone to ignore
 * escalations. A queued `merge_conflict` from the same spec PR was the same
 * hole with a dispatch on the end of it.
 */
function belongsToThisPhase(
  entity: ConductorEntity,
  signal: Signal,
  world: World,
): boolean {
  const artifact = activeArtifact(entity.phase, world);
  const hostPr =
    artifact && artifact.hostedAt.type === "pr" ? artifact.hostedAt.number : undefined;

  const signalPr = signalPullNumber(signal);
  if (signalPr !== undefined) {
    if (hostPr === undefined) return signal.kind === "pr_opened";
    if (hostPr !== signalPr) return false;
  }

  if (signal.kind === "ci_concluded" && hostPr !== undefined) {
    const pr = world.pullRequests[hostPr];
    if (pr && signal.sha !== pr.headSha) return false;
  }

  return true;
}

/**
 * A red base is not our failure. Both gates that handle a failing CI wait for
 * `base_recovered` rather than dispatching an agent to chase someone else's
 * breakage — `awaiting_ci` when CI is the only thing outstanding, and
 * `awaiting_review` when a red base lands while the PR is already under review.
 */
function baseIsRed(entity: ConductorEntity, world: World): boolean {
  return activePr(entity.phase, world)?.baseRed === true;
}

/** Review rounds allowed against the entity's active artifact. */
function roundBudget(entity: ConductorEntity, world: World): number {
  return entity.phase === "IMPLEMENTATION"
    ? world.policy.implementationReviewRoundBudget
    : world.policy.specReviewRoundBudget;
}

/** True when the artifact has spent its review-round budget. */
function budgetSpent(entity: ConductorEntity, world: World): boolean {
  const artifact = activeArtifact(entity.phase, world);
  if (!artifact) return false;
  return artifact.reviewRounds >= roundBudget(entity, world);
}

/**
 * Revise the artifact, or escalate once the round budget is spent. Past the
 * budget we stop auto-handling feedback and ask a human whether the approach
 * itself needs re-examining — grinding out round thirteen is not the answer the
 * process wants.
 *
 * **Every path that buys a revision goes through here**, comments and CI alike.
 * The cap is a loop detector, and a build nobody can get green is the same loop
 * as a thread nobody can settle — the process doc says new CI results past the
 * cap are recorded and not acted on, in the same breath as comments. A CI branch
 * that compared the budget itself would be a second copy of this rule, and two
 * copies is how one of them stops matching the doc.
 *
 * A red base never reaches here: it is suppressed at the call site, so someone
 * else's breakage neither dispatches nor spends a round.
 */
function reviseOrEscalate(
  entity: ConductorEntity,
  world: World,
  reviseKind: "reviseSpec" | "addressFeedback",
  because: string,
): Action[] {
  const base: ActionBase = { kind: reviseKind, entityId: entity.id };
  if (budgetSpent(entity, world)) {
    return [
      {
        kind: "escalate",
        entityId: entity.id,
        reason: `${reviseKind === "reviseSpec" ? "Spec" : "Implementation"} review budget of ${roundBudget(entity, world)} rounds is spent — the approach may need re-examining rather than another revision.`,
      },
    ];
  }
  return [{ ...base, kind: reviseKind, because } as Action];
}

/**
 * Why an entity has nothing left that could move it, in terms somebody can act
 * on.
 *
 * "Entity is stuck" is useless. What an operator needs is the phase, what that
 * phase was supposed to leave behind, and whether it left it — so the three
 * branches below are the three answers to *is there anything a gate could read*,
 * and each ends by naming where to go looking.
 *
 * **Read entirely from the world, never from the signal.** `progress_stalled`
 * carries no payload precisely so this is derivable from the row alone: the same
 * reason `approvalRecordFromWorld` reads the snapshot rather than the `approved`
 * in hand. A reason baked into the signal would be a second source of truth
 * about a fact the row already stores, and the two disagree the moment a row is
 * replayed.
 *
 * It also touches nothing a gate declares — the artifact's kind and where it is
 * hosted are scaffolding, present in every snapshot — so an escalation that is
 * emphatically *not* a gate reads no gate's facts.
 */
function stalledReason(entity: ConductorEntity, world: World): string {
  const kind = artifactKindForPhase(entity.phase);
  const artifact = activeArtifact(entity.phase, world);

  const holding =
    kind === null
      ? "produces no artifact of its own, and no gate applies to it"
      : artifact === undefined
        ? `produced no ${kind} artifact — there is no pull request for a gate to read`
        : artifact.hostedAt.type === "pr"
          ? `holds its ${kind} artifact at pull request #${artifact.hostedAt.number}, which no gate applies to`
          : `holds its ${kind} artifact at ${artifact.hostedAt.path}, which is not a pull request, so no review gate applies`;

  const lookAt =
    artifact === undefined
      ? "Read what the last dispatch actually did: it settled without leaving anything conductor can observe."
      : "Check that the artifact above is where the work really is.";

  return (
    `${entity.phase} finished its entry work and ${holding}. ` +
    `The phase cannot complete, so nothing will move ${entity.id} again. ${lookAt}`
  );
}

/**
 * A human's feedback on the artifact, whichever channel it arrived through.
 *
 * Three channels reach conductor and all three say the same thing — someone read
 * the work and wants something changed:
 *
 * - **A comment**, on the conversation or on a review thread, which the reader
 *   turns into `feedback_received`.
 * - **A review requesting changes**, `changes_requested`.
 * - **A review submitted with no verdict**, `review_submitted` — GitHub's
 *   summary box, submitted as a plain comment. It is neither of the two comment
 *   endpoints, so a reviewer who writes their whole review there produces *no
 *   prose signal at all*, and a branch consuming only the first two answered
 *   them with silence.
 *
 * Reading the third as feedback is the rule M1 already applies to prose
 * (`github/signals`: any human comment is feedback, without asking a model what
 * kind it is), raised to the one review state that carries prose and no verdict.
 * Being wrong costs one revision bought for a "nice work" summary and one round
 * against the budget; the alternative is a review that never becomes work.
 *
 * **Humanness is not checked here and must not be.** A bot's review never
 * becomes a signal in the first place — both readers drop it on the author
 * (`driver/reconcile`, `github/signals`), which is what keeps conductor from
 * reading its own comment back as fresh feedback and paying for it every turn.
 */
function isFeedback(signal: Signal): boolean {
  return (
    signal.kind === "feedback_received" ||
    signal.kind === "changes_requested" ||
    signal.kind === "review_submitted"
  );
}

/**
 * Signals that mean the same thing in any phase. Returns `undefined` when the
 * signal is not universal, so the caller falls through to the phase table.
 */
function decideUniversal(
  entity: ConductorEntity,
  signal: Signal,
  world: World,
): Action[] | undefined {
  switch (signal.kind) {
    // **Conductor never retries**, so the reason this used to carry — `Dispatch
    // <id> exhausted its attempts.` — was false for every failure it was ever
    // written about. It described a mechanism that does not exist, to the one
    // person being asked to intervene, while the real cause reached the dispatch
    // record and stopped there.
    //
    // The cause matters because the responses diverge: a credential that never
    // reached the agent process is fixed in the harness and the work re-run
    // untouched, and an agent that could not do the work is a task to
    // re-specify. Both used to arrive as the same sentence, so the ledger — the
    // thing that is supposed to make every transition reproducible — could not
    // tell an operator which of the two they were looking at.
    //
    // A **failure class** was the other shape considered, and rejected: nothing
    // upstream can produce one honestly. The only structural distinction
    // available is *where* the throw happened, which conflates a dispatcher that
    // broke its settle-don't-throw contract with a workspace that could not be
    // cut; anything finer would be a guess read out of an error string, and a
    // guess in a reducer is exactly what this file refuses. No branch here reads
    // it either — conductor escalates every dispatch failure identically, and
    // the class would be a coarser second copy of what `detail` already says.
    // Adopt one the day a dispatcher reports one structurally.
    //
    // `== null` covers both the absent and the explicitly-null field, which are
    // the same fact (BP-030). Saying so is the point: a reason rendered as
    // `failed: null` reads as a bug in conductor rather than as silence from
    // the vendor.
    case "dispatch_failed":
      return [
        {
          kind: "escalate",
          entityId: entity.id,
          reason:
            signal.detail == null
              ? `Dispatch ${signal.dispatchId} failed, and the record holds no reason.`
              : `Dispatch ${signal.dispatchId} failed: ${signal.detail}`,
        },
      ];

    // **Escalate, never retry.** The two are not close calls here. A retry is
    // unbounded paid work in the exact situation where the harness has already
    // demonstrated it cannot make progress — it ran, settled `completed`, and
    // left nothing — and conductor's posture is to stop for a human rather than
    // to guess. Nor is there anything to retry *into*: the phase's entry work is
    // what would run again, and it is the thing that just produced nothing.
    //
    // **It is its own signal kind rather than a `dispatch_failed`**, because the
    // two are different asks and the ledger is where an operator tells them
    // apart. `dispatch_failed` means the harness broke — a crash, a timeout, a
    // workspace it was never given — and the fix is usually to the harness.
    // This means the harness *worked* and the work did not happen, and the fix
    // is to the task: the issue was underspecified, or the agent asked a
    // question into a final message nobody reads. Folding it into
    // `dispatch_failed` would report a working vendor as a broken one, which is
    // the same mistake `DispatchResult.goalCheck` refuses to make with
    // `outcome`.
    //
    // The condition itself is derived by the tick, which holds the ledger and
    // the dispatch record this cannot see; this branch is the same shape as
    // `dispatch_failed`'s — the signal asserts the fact, `decide` turns it into
    // the ask.
    case "progress_stalled":
      return [
        { kind: "escalate", entityId: entity.id, reason: stalledReason(entity, world) },
      ];

    case "pr_closed":
      // A PR closed without merging is a human intervention, not a transition
      // conductor should route around.
      return [
        {
          kind: "escalate",
          entityId: entity.id,
          reason: `PR #${signal.pullNumber} was closed without merging.`,
        },
      ];

    // A dispatch settling changes the world, not the phase. Whatever it
    // produced arrives as its own structural signal.
    case "dispatch_completed":
      return [];

    default:
      return undefined;
  }
}

/**
 * The snapshot as it stood one moment before a fresh human approval landed —
 * every approving human review at its PR's head removed, and nothing else
 * touched.
 */
function withoutFreshHumanApproval(world: World): World {
  const pullRequests: Record<number, PullRequestFacts> = {};
  for (const pr of Object.values(world.pullRequests)) {
    pullRequests[pr.number] = {
      ...pr,
      reviews: pr.reviews.filter(
        (r) => !(r.isHuman && r.state === "APPROVED" && r.sha === pr.headSha),
      ),
    };
  }
  return { ...world, pullRequests };
}

/**
 * The gate a standing human approval released in this world, or `undefined`
 * when no gate turns on one — a stale approval against an older head, a bot's,
 * one its own author has since withdrawn, or a duplicate arriving after the
 * gate had already moved on.
 *
 * The gate is **derived, not named**: it is the gate that is satisfied in this
 * world and would not be without the approval. Naming it would get
 * `IMPLEMENTATION` wrong, whose approval releases `awaiting_review` in the
 * middle of the table rather than its last gate, and a phase added later could
 * forget to name one at all — which is exactly how the record goes missing.
 *
 * Only gates that declare `artifact.reviews` are candidates. That is not an
 * optimization: the tick materializes exactly what a phase declares, so a phase
 * whose gates never asked for reviews is handed an empty list, and normalizing
 * its snapshot would be reading a fact that was never fetched.
 */
function gateReleasedByApproval(
  entity: ConductorEntity,
  world: World,
): RecordApprovalAction["gate"] | undefined {
  const def = phaseDefinition(entity.kind, entity.phase);
  if (!def) return undefined;
  const candidates = def.gates.filter((g) => g.reads.includes("artifact.reviews"));
  if (candidates.length === 0) return undefined;
  const before = withoutFreshHumanApproval(world);
  const released = candidates.filter(
    (g) => g.appliesWhen(world) && g.satisfiedBy(world) && !g.satisfiedBy(before),
  );
  return released.at(-1)?.name;
}

/**
 * The ledger entry for the approval that released a gate in this world.
 *
 * **Read entirely from the snapshot, never from the signal in hand** — including
 * when that signal *is* an `approved`. The gate is derived from the world (see
 * {@link gateReleasedByApproval}), so taking the reviewer and SHA from the
 * signal would make one ledger row out of two sources of truth, and they
 * disagree the moment a signal arrives late: Alice's approval at the head opens
 * the gate, Bob's delayed approval against an older SHA arrives and releases
 * nothing, and the row credits Bob at a SHA nobody approved. Signals are
 * explicitly allowed to arrive out of order and be replayed, so that is an
 * ordinary arrival, not a corner case. One source for the gate and the reviewer
 * both, and the two can never disagree.
 *
 * Reading from the world is also what makes the record survive an approval that
 * landed before conductor was watching. That is the ordinary shape of a first
 * poll: reconciliation replays the missed `pr_opened` ahead of the approval that
 * revealed it, and the snapshot both are reduced against already carries the
 * approval. Completing the phase on the `pr_opened` and leaving the record to
 * the later `approved` loses it outright — by then the entity is in the next
 * phase, where the approval releases nothing and cannot be credited.
 *
 * The credited approval is the newest one standing at the head, taken from the
 * same `freshHumanApprovals` list `hasFreshHumanApproval` gates on: an approval
 * that has been withdrawn or outranked by its author's own change request is not
 * in the list at all, and when several stand it is the last to land that turned
 * the gate.
 */
function approvalRecordFromWorld(
  entity: ConductorEntity,
  world: World,
): RecordApprovalAction | undefined {
  const gate = gateReleasedByApproval(entity, world);
  if (!gate) return undefined;
  const approval = freshHumanApprovals(activePr(entity.phase, world)).at(-1);
  if (!approval) return undefined;
  return {
    kind: "recordApproval",
    entityId: entity.id,
    gate,
    reviewer: approval.reviewer,
    sha: approval.sha,
  };
}

/**
 * Reduce one signal against one entity.
 *
 * @param entity The entity being advanced — id, kind, and stored phase.
 * @param signal What the world reported, or what reconciliation inferred.
 * @param world A snapshot materialized before this call. Never fetched from here.
 * @returns The actions that follow. Empty when the signal does not apply.
 */
export function decide(
  entity: ConductorEntity,
  signal: Signal,
  world: World,
): Action[] {
  if (signal.entityId !== entity.id) return [];

  const def = phaseDefinition(entity.kind, entity.phase);
  if (!def) return [];

  // A settled entity absorbs everything. Late CI, a late comment, a duplicate
  // merge — none of it reopens finished work.
  if (def.next === null) return [];

  if (!belongsToThisPhase(entity, signal, world)) return [];

  // Universal handling and entry dispatch may *produce* work, and when they do
  // that work is the whole answer. What neither may do is **absorb** a signal on
  // behalf of a phase that has already completed. `CROSS_SPEC_REVIEW` is the
  // proof: it dispatches nothing on entry and is complete the moment it is
  // entered, so an entry branch that swallowed its own `phase_entered` left the
  // epic sitting in a finished phase with no signal left to move it. The same
  // hole strands `WRAP` when the `dispatch_completed` that produced the
  // retrospective is swallowed by the universal branch. Falling through on an
  // empty result closes both without touching a path that answers.
  const universal = decideUniversal(entity, signal, world);
  if (universal !== undefined && universal.length > 0) return universal;

  if (signal.kind === "phase_entered") {
    const entry = (def.onEnter ?? []).map(
      (kind) => ({ kind, entityId: entity.id }) as Action,
    );
    if (entry.length > 0) return entry;
  }

  // A human approval that releases a gate is recorded whether or not it also
  // completes the phase. `SPEC` completes on the very approval that releases
  // its gate, but `IMPLEMENTATION` completes on the goal check — so recording
  // only on the completing path loses the approval that opened `awaiting_merge`
  // entirely, and with it the ledger's ability to replay that release.
  const approval =
    signal.kind === "approved" ? approvalRecordFromWorld(entity, world) : undefined;

  // Advance before consulting the gate table, so the signal that *completes* a
  // phase advances it rather than being absorbed by the gate it just released.
  //
  // The record always comes from the snapshot, whatever signal is in hand — the
  // approval may even have landed before conductor was watching. See
  // `approvalRecordFromWorld`. Whatever completes the phase, the human release
  // that got it there is written down exactly once.
  if (isPhaseComplete(entity, world) && def.next) {
    const record = approval ?? approvalRecordFromWorld(entity, world);
    const actions: Action[] = [];
    if (record) actions.push(record);
    actions.push({ kind: "enterPhase", entityId: entity.id, phase: def.next });
    return actions;
  }

  if (approval) return [approval];

  const gate = deriveGate(entity, world);

  // Conflict and base recovery are handled phase-wide rather than only under
  // `awaiting_merge`: a conflict that lands while CI is still running is just
  // as real, and waiting for the merge gate to fix it would stall the PR.
  if (entity.phase === "IMPLEMENTATION") {
    // Phase-wide, but not artifact-state-blind. Both branches below aim an
    // agent at a *branch*, and a branch is only worth touching while the PR on
    // it is still open — once it has merged, the work is already on the base
    // and there is nothing left to rebase onto or resolve against.
    //
    // The pairing that makes this reachable is one poll reporting two things at
    // once. A snapshot recording a red base, then a read finding both the merge
    // and the recovery, queues `merged` and `base_recovered` together; the
    // merge is reduced first and leaves the entity in `IMPLEMENTATION` awaiting
    // its goal check, so the recovery lands on a phase that is still live and
    // dispatches a rebase against a merged PR. That is not only a paid run
    // wasted: the agent pushes commits to the branch of a merged PR, which is a
    // real change to the repository, and the branch policy's `-B` handling makes
    // branch-state surprises expensive.
    //
    // One predicate over both signals, not a guard on the one that bites today.
    // A conflict reported against a merged PR is exactly as impossible to act
    // on, and a pair fixed by halves is how the unfixed half survives.
    const prIsOpen = activePr(entity.phase, world)?.state === "open";

    if (signal.kind === "merge_conflict" && prIsOpen) {
      return [
        {
          kind: "resolveConflict",
          entityId: entity.id,
          because: `PR #${signal.pullNumber} is conflicting with its base.`,
        },
      ];
    }
    if (signal.kind === "base_recovered" && prIsOpen) {
      return [
        {
          kind: "rebaseOnBase",
          entityId: entity.id,
          because: "The base branch is green again.",
        },
      ];
    }
    // A human's feedback is handled phase-wide for the same reason a conflict
    // is — a reviewer does not wait for the build — and the failure it closes is
    // worse than a delay, because **a gate that declined a signal did not stop
    // the cursor moving past it.** A comment or a change request that lands
    // while checks are still running reduces under `awaiting_ci`, which had
    // nothing to say about a review; the tick persists the comment and review
    // cursor regardless, so when CI goes green and `awaiting_review` becomes
    // current there is nothing left to reduce. `addressFeedback` never runs, the
    // requested changes stay unresolved, and conductor waits for a review that
    // already happened.
    //
    // This is the *observed* half of the rule `runtime/tick`'s
    // `unreducedFailures` states for derived ones: **a signal is protected until
    // its consequence is on disk.** A derived signal gets that from a durable
    // source of its own; an observed one gets it from the cursor being persisted
    // last — and that only covers a signal the tick did not finish reducing,
    // never one a gate answered with nothing. The other shape considered was to
    // retain the feedback until CI cleared, which is more faithful to the gate
    // order and needs somewhere durable to retain it: a signal that produces no
    // action writes no ledger row, so retention means new persisted state that
    // is a second copy of what the world already reports. Acting on it now needs
    // none, and matches how `merge_conflict` and `base_recovered` are already
    // handled one branch up.
    //
    // Dispatching while checks are in flight costs the run that is in flight:
    // conclusions are read against the PR's head, so the moment the revision
    // pushes, the old head's run stops being read and the new head gets its own.
    // That is a wasted CI run, occasionally a second round when the failure the
    // reviewer had not seen comes back — against feedback that was otherwise
    // lost for the life of the issue.
    //
    // Same `prIsOpen` predicate as the two above, and for the same reason: a
    // revision aims an agent at a *branch*, and a merged or abandoned PR has
    // none worth touching.
    if (isFeedback(signal) && prIsOpen) {
      return reviseOrEscalate(
        entity,
        world,
        "addressFeedback",
        "Review feedback arrived on the implementation PR.",
      );
    }
    // A question is dropped by exactly the same gate, and answering one pushes
    // nothing — so there is nothing about a build in flight that makes it wrong.
    if (signal.kind === "question_asked" && prIsOpen) {
      return [
        {
          kind: "answerQuestion",
          entityId: entity.id,
          because: `Question on PR #${signal.pullNumber}.`,
        },
      ];
    }
    // A failed goal check means two different things either side of the merge,
    // and the merge is the only thing that tells them apart — so the predicate
    // has to be read rather than assumed. **After** the merge it needs a human:
    // there is no open PR left to push a fix to, and the change is already on
    // the base. **Before** it, this is the ordinary shape of work in progress —
    // the change does not do what the issue asked yet — and it sends the work
    // back exactly as review feedback and a red build do. Escalating that
    // instead filed a human-intervention report against the happy path, with a
    // reason claiming the change was on the base branch when it was sitting in
    // an open PR nobody had merged.
    //
    // Through `reviseOrEscalate` rather than a bare revision, because the cap is
    // a loop detector and a goal nobody can meet is the same loop as a thread
    // nobody can settle. A third hand-written budget comparison beside the two
    // this function already routes through here is how one of them stops
    // matching the process doc.
    if (signal.kind === "goal_check_failed") {
      if (activePr(entity.phase, world)?.state === "merged") {
        return [
          {
            kind: "escalate",
            entityId: entity.id,
            reason:
              "The goal check failed after merge — the change is on the base branch and did not do what the issue asked.",
          },
        ];
      }
      return reviseOrEscalate(
        entity,
        world,
        "addressFeedback",
        "The goal check failed: the change does not do what the issue asked yet.",
      );
    }
  }

  if (gate === null) return [];

  switch (gate) {
    case "awaiting_spec_review":
    case "awaiting_spec_approval":
    case "awaiting_objective_approval":
      if (isFeedback(signal)) {
        return reviseOrEscalate(entity, world, "reviseSpec", "Review feedback arrived.");
      }
      if (signal.kind === "question_asked") {
        return [
          {
            kind: "answerQuestion",
            entityId: entity.id,
            because: `Question on PR #${signal.pullNumber}.`,
          },
        ];
      }
      return [];

    case "awaiting_ci":
      if (signal.kind === "ci_concluded" && signal.conclusion === "failure") {
        if (baseIsRed(entity, world)) return [];
        return reviseOrEscalate(
          entity,
          world,
          "addressFeedback",
          `CI failed on ${signal.sha}.`,
        );
      }
      return [];

    case "awaiting_review":
      // Feedback and questions are handled phase-wide above rather than here.
      // They used to live at this gate alone, which is what lost every review
      // that arrived before the build finished — and a second copy kept here for
      // the gate that happens to be current most often is how the two would
      // drift. A red build is genuinely this gate's, because the suppression it
      // needs is a gate's fact.
      if (signal.kind === "ci_concluded" && signal.conclusion === "failure") {
        // Same suppression as `awaiting_ci`: a red base is someone else's
        // breakage whether or not review has started on this PR.
        if (baseIsRed(entity, world)) return [];
        return reviseOrEscalate(
          entity,
          world,
          "addressFeedback",
          `CI failed on ${signal.sha} after review started.`,
        );
      }
      return [];

    case "awaiting_merge":
      // Conductor never merges. It waits here until a human does.
      return [];

    case "awaiting_goal_check":
      // **One trigger, and it is a derived one.** `goal_check_needed` is
      // re-derived from durable state on every tick for exactly as long as the
      // work in front of the entity holds no passing proof on the ground it
      // needs (`runtime/tick`'s `proofGap`), so the re-proof happens because
      // the state calls for it rather than because some other signal happened to
      // arrive.
      //
      // **Not `merged`.** A `merged` is a one-shot event, so an approved,
      // green, *unmerged* PR whose proof a push had invalidated would have no
      // path to a new one at all, and a merge signal lost to a restart could
      // not be re-observed either. Keeping `merged` as a second trigger would
      // be a second path to the same dispatch that only works when an event
      // lands — an under-specification, not a belt-and-braces. The derived
      // signal is seeded from the same snapshot the merge is read in, so
      // nothing is slower for having one trigger.
      if (signal.kind === "goal_check_needed") {
        return [
          {
            kind: "runGoalCheck",
            entityId: entity.id,
            because:
              "The work has no passing goal verdict at the revision it is sitting at.",
          },
        ];
      }
      return [];

    case "awaiting_issues":
      // Completion is handled above; an individual child settling while others
      // are outstanding needs nothing.
      return [];

    default:
      return [];
  }
}
