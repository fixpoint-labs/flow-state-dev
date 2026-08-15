/**
 * The tick — the thing that assembles everything else.
 *
 * ```
 * observe ──▶ signals ──decide() per signal──▶ actions ──▶ execute ──▶ ledger
 * ```
 *
 * That is the whole loop, and the order is the contract. **No model runs
 * anywhere in it.** Judgment is welcome upstream of a signal — a classifier
 * reading a human's comment is real judgment — but by the time a signal reaches
 * this file the judgment has already been recorded, and what happens here is a
 * pure reduction plus its side effects. A tick that consulted a model would
 * produce a different answer from identical state, which is exactly the failure
 * the ledger exists to make impossible.
 *
 * Three properties this file is written to hold. Each is a consequence of an
 * ordering decision rather than of a check, which is the only way they survive
 * a change nobody remembers to re-verify.
 *
 * ---------------------------------------------------------------------------
 * 1. A REDUNDANT TICK COSTS NOTHING
 * ---------------------------------------------------------------------------
 *
 * A tick against an unchanged world appends **zero** ledger rows and performs
 * **zero** dispatches. It falls out of where signals come from: not from a
 * queue conductor drains, but from `reconcile` diffing the world against the
 * copy the previous tick persisted. An unchanged world diffs to nothing, and a
 * row is appended only when a signal produced an action.
 *
 * ---------------------------------------------------------------------------
 * 2. A RESTART RESUMES; IT DOES NOT REDO
 * ---------------------------------------------------------------------------
 *
 * The gate cannot be lost — it is never stored, so the next tick derives it
 * again from the same world. The dispatch is the part that can actually be
 * repeated, and two orderings stop it:
 *
 * - **The ledger row is written before the action it records takes effect.**
 *   A dispatch that ran has a row that was on disk before it ran, so a process
 *   killed mid-dispatch comes back to an entity whose history says the work was
 *   handed out. Nothing re-derives the entry that produced it.
 * - **The phase moves after its row, and the ledger wins if they disagree.**
 *   Writing the entity first and the row second would let a crash move a phase
 *   with nothing recording it, which is unrecoverable. Writing the row first
 *   leaves the entity one transition behind, which {@link loadEntity} repairs by
 *   adopting the ledger's phase — the ledger is the authority for a transition,
 *   and the entity is a projection of it.
 * - **A phase's entry work runs once, and runs at least once.** Adopting the
 *   ledger's phase moves the entity without moving the *entry* that dispatches
 *   that phase's opening work, so "resumes" has to cover the entry too: it is
 *   re-derived until the entry's *effect* is proved complete, and never after.
 *   See {@link entryCompleted} for why neither "the ledger is nonempty" nor "a
 *   row was written" is that proof — a row records what was decided, and the
 *   dispatch record is what records that it finished.
 * - **A signal the tick derived is re-derived until its consequence is on
 *   disk.** The two orderings above cover *observed* signals, which the cursor
 *   makes re-observable. A signal this tick derives exists only in its own
 *   queue, so it needs a durable source to be re-derived from and a written
 *   consequence to stop. `phase_entered` has {@link entryCompleted};
 *   `dispatch_failed` has {@link unreducedFailures}; `progress_stalled` has
 *   {@link stalled}; `goal_check_needed` and `goal_check_failed` have
 *   {@link proofGap}, whose durable source is the stored proof itself. One rule,
 *   one instance per derived signal — not one predicate stretched across the
 *   four.
 *
 * One assumption this file makes and does not enforce: **one tick at a time per
 * entity.** Nothing here is atomic across its read-modify-write, so overlapping
 * ticks duplicate a paid dispatch. `./session` serializes them, and states there
 * what that does and does not cover.
 *
 * The window this does *not* close is stated rather than papered over: the
 * observation cursor is persisted at the end of a tick, so a process killed
 * mid-tick re-observes the signals it had already reduced and may repeat a
 * dispatch that was in flight. The alternative — persisting the cursor before
 * reducing — loses those signals permanently and strands the entity at a gate
 * nothing will release, which is the worse of the two failures by a wide margin.
 *
 * ---------------------------------------------------------------------------
 * 3. EVERY TRANSITION IS REPRODUCIBLE FROM THE LEDGER
 * ---------------------------------------------------------------------------
 *
 * A row carries `decide`'s three arguments whole — the entity kind, the signal,
 * and the world snapshot it was reduced against — so
 * `decide({ id, kind: entityKind, phase: phaseBefore }, signal, world)` re-run
 * from the row alone produces that row's `actionKind` again. Anything the tick
 * does that `decide` did not produce therefore has no place in the ledger; see
 * the note on divergences in {@link runTick}.
 */

import { randomUUID } from "node:crypto";

import {
  isDispatch,
  MUTATES_WORK,
  type Action,
  type DispatchAction,
} from "../model/actions";
import {
  artifactKindForPhase,
  phaseDefinition,
  type EntityKind,
  type Gate,
  type Phase,
} from "../model/phases";
import type { Signal } from "../model/signals";
import {
  artifactOfKind,
  prForArtifact,
  requiredGround,
  type ArtifactFacts,
  type ArtifactKind,
  type ChildIssueFacts,
  type ProofGround,
  type World,
} from "../model/world";
import type { EpicState, IssueState, LedgerEntryState } from "../model/entities";
import { decide } from "../driver/decide";
import {
  deriveGate,
  isPhaseStranded,
  outstandingProof,
  type ConductorEntity,
} from "../driver/derive-gate";
import { branchNameFor, provisionWorkspace, DETACHED_AT_BASE } from "../dispatch/branch";
import { briefFor } from "../dispatch/brief";
import type { DispatchResult, PhaseBrief } from "../dispatch/types";
import { runGoalCheckCommand } from "./goal-check";
import { EMPTY_OBSERVATION_CURSOR, type ObservationCursor } from "../observe/types";
import type { ConductorCollections } from "./collections";
import type { RuntimeDeps } from "./deps";

/** What a tick, a read, or a `manage` answers with. */
export interface ManagedWork {
  /** The entity as durable state holds it — id, kind, and stored phase. */
  readonly entity: ConductorEntity;
  /**
   * What the entity is waiting on, derived from *this* pass's world. Never
   * stored, so a restart cannot lose it.
   */
  readonly gate: Gate | null;
  /** Every transition recorded for this entity, ordered by `seq`. */
  readonly ledger: readonly LedgerEntryState[];
  /** Phase executions performed for this entity, ever. */
  readonly dispatchCount: number;
}

/** Everything a tick needs that is specific to the work item it is ticking. */
export interface TickContext {
  readonly entityId: string;
  readonly entityKind: EntityKind;
  readonly collections: ConductorCollections;
  readonly deps: RuntimeDeps;
}

/** One signal waiting to be reduced, and whether the tick produced it itself. */
interface Queued {
  readonly signal: Signal;
  /**
   * True for a signal the tick derived — a phase entry, a dispatch settling, a
   * goal verdict a dispatch reported.
   */
  readonly derived: boolean;
}

/**
 * The entity's stored state, from whichever collection its kind lives in.
 *
 * Read and write are separate functions rather than one "pick a handle" helper
 * because the two collections hold different row types, and a caller holding
 * the union of two typed handles cannot write to either.
 */
async function readEntityState(
  context: TickContext,
): Promise<IssueState | EpicState | null> {
  return context.entityKind === "epic"
    ? context.collections.epics.read(context.entityId)
    : context.collections.issues.read(context.entityId);
}

/**
 * Write the entity's phase, and the timestamp of the newest signal it reduced.
 *
 * The only writer of a stored phase. Each branch narrows to one collection
 * before it writes, and the cast inside it is safe by construction: a phase
 * conductor is persisting for an entity came from that entity's own phase
 * table, because `decide` refuses a phase that does not belong to its kind.
 */
async function persistEntity(
  context: TickContext,
  phase: Phase,
  lastSignalAt: string | null,
): Promise<void> {
  if (context.entityKind === "epic") {
    const stored = await context.collections.epics.read(context.entityId);
    if (!stored) return;
    await context.collections.epics.write(context.entityId, {
      ...stored,
      phase: phase as EpicState["phase"],
      lastSignalAt: lastSignalAt ?? stored.lastSignalAt,
    });
    return;
  }

  const stored = await context.collections.issues.read(context.entityId);
  if (!stored) return;
  await context.collections.issues.write(context.entityId, {
    ...stored,
    phase: phase as IssueState["phase"],
    lastSignalAt: lastSignalAt ?? stored.lastSignalAt,
  });
}

/** The verdict a goal check can leave behind. `null` means it has not run. */
type GoalCheckVerdict = "passed" | "failed" | null;

/**
 * A verdict, the revision it was taken against, and the ground it stood on —
 * the triple every gate reads through `model/world`'s `standingVerdict`. A `sha`
 * of `null` means the revision is not known, which reads as *not proved*
 * everywhere it matters; the `ground` says which claim the verdict answers, and
 * a proof of the branch is not a proof of what landed.
 */
interface GoalProof {
  readonly verdict: GoalCheckVerdict;
  readonly sha: string | null;
  readonly ground: ProofGround;
}

/** No verdict, and therefore no revision and no claim. */
const UNPROVED: GoalProof = { verdict: null, sha: null, ground: "branch" };

/**
 * The stored goal proof for this entity.
 *
 * An epic has none: the goal check proves that *a change did what an issue
 * asked*, and an epic's own phases gate on its children rather than on a proof
 * of their own. `null` is what the epic branch of the phase table already reads.
 */
async function readGoalCheck(context: TickContext): Promise<GoalProof> {
  if (context.entityKind === "epic") return UNPROVED;
  const stored = await context.collections.issues.read(context.entityId);
  return {
    verdict: stored?.goalCheck ?? null,
    sha: stored?.goalCheckSha ?? null,
    ground: stored?.goalCheckGround ?? "branch",
  };
}

/**
 * Write the goal verdict and the revision it describes.
 *
 * The only writer of either field, and the counterpart to {@link readGoalCheck}:
 * conductor owns the proof, so if it is not written down here it does not exist
 * anywhere. It is written *before* it is read back into a world, which is what
 * makes the value survive the restart the whole tick is built around — a verdict
 * held only in this tick's snapshot would be lost with the process.
 *
 * **The three move together, always.** They are one fact in three columns (see
 * `model/entities` for why they are not one nested column), and a write of the
 * verdict that left the old revision or the old ground standing would claim the
 * new proof was taken against code it never saw, or for a question it was never
 * asked.
 */
async function persistGoalCheck(
  context: TickContext,
  proof: GoalProof,
): Promise<void> {
  if (context.entityKind === "epic") return;
  const stored = await context.collections.issues.read(context.entityId);
  if (!stored) return;
  await context.collections.issues.write(context.entityId, {
    ...stored,
    goalCheck: proof.verdict,
    goalCheckSha: proof.sha,
    goalCheckGround: proof.ground,
  });
}

/**
 * The head of the submission the entity's current phase is working on, or `null`
 * when the phase holds no submission — nothing yet, or an artifact that is not
 * hosted at one.
 *
 * Empty is `null` too: the local reader answers with an empty head for a
 * submission whose branch is gone and whose last head is unreachable, and that
 * is an absent revision rather than a revision named `""`.
 */
function activeHead(entity: ConductorEntity, world: World): string | null {
  const kind = artifactKindForPhase(entity.phase);
  if (!kind) return null;
  return prForArtifact(world, artifactOfKind(world, kind))?.headSha || null;
}

/**
 * The work item's own description, held as the entity's resource **content**.
 *
 * It is prose, `decide` never reads it, and it is the one thing a phase brief
 * needs that no source reports — which is exactly the split the entity model
 * draws between structured state and content.
 */
async function readEntitySummary(context: TickContext): Promise<string | null> {
  return context.entityKind === "epic"
    ? context.collections.epics.readContent(context.entityId)
    : context.collections.issues.readContent(context.entityId);
}

/** Ledger rows for the entity, ordered by `seq` rather than by storage key. */
async function readLedger(context: TickContext): Promise<LedgerEntryState[]> {
  const rows = await context.collections.ledger.list();
  return rows
    .filter((row) => row.entityId === context.entityId)
    .sort((a, b) => a.seq - b.seq);
}

/** One row of the dispatch record, as the collection hands it back. */
type DispatchRow = Awaited<ReturnType<ConductorCollections["dispatches"]["list"]>>[number];

/**
 * Has the entity's **current** phase had its entry work *finish*?
 *
 * Entry is what dispatches a phase's opening work, and the tick that enters a
 * phase drains it in the same pass — so the first half of the proof is the row
 * that entry produced: a `phase_entered` signal reduced *against the phase being
 * entered*. A row carrying both is proof for that phase and for no other. An
 * empty ledger is only the first instance of "the current phase has not been
 * entered"; a nonempty one says nothing about it, and reading it as proof
 * strands an entity that advanced a phase durably and died before the entry it
 * had queued.
 *
 * **But the row records that the entry was *decided*, not that its effect
 * completed, and the restart path needs the second fact.** The row is appended
 * ahead of the dispatch it records — deliberately, so a dispatch that ran always
 * has a row — which leaves a window where the row is on disk and the work is
 * not: the process dies after the append and before `runDispatch` settles. An
 * in-process agent cannot report back after its parent dies, so nothing ever
 * settles that dispatch, and a predicate reading the row alone suppresses the
 * entry forever. The entity sits in IMPLEMENTATION with no PR, no dispatch, and
 * no signal an artifact-free world could ever produce to start one.
 *
 * The second half of the proof is therefore the dispatch record, which already
 * carries it: `runDispatch` writes the row **before** the run with
 * `outcome: null` and rewrites it with the outcome when it settles, so an
 * unsettled dispatch is already durably visible and this needs no new state.
 * Entry is complete when every entry action the phase declares has a *settled*
 * dispatch — settled either way, because a failed one is escalated by `decide`
 * and re-running it would loop.
 *
 * Scoped to the phase's own `onEnter` actions rather than to any dispatch of the
 * phase: an `addressFeedback` that died mid-flight is unfinished work too, but
 * re-deriving *entry* for it would dispatch `implement` a second time on a PR
 * that already exists.
 *
 * **What this cannot tell apart, stated rather than papered over.** A dispatch
 * that is merely slow looks exactly like one whose process died — an unsettled
 * row is all either leaves behind. Within one process the two are separable by
 * construction and not by inspection: `./session` runs one tick at a time per
 * entity, and this predicate is evaluated before the tick dispatches anything,
 * so a dispatch this process started cannot be in flight while it runs. Across
 * processes nothing separates them, and that is already outside the "one tick at
 * a time per entity" assumption this file states and does not enforce. The
 * failure chosen is the recoverable one: a second dispatch costs money and lands
 * a second commit on a branch the branch policy already re-enters, while the
 * alternative strands the entity permanently with nothing able to release it.
 *
 * **What this predicate is not, and must not become.** A settled dispatch proves
 * the *dispatch* finished; it does not prove its outcome was ever acted on. The
 * process can die between the settling write and the ledger row that outcome
 * reduces to, and that gap is not entry's to close: entry ran, and re-deriving
 * it would buy the same dispatch again to recover a signal, not a run. It
 * belongs to the signal that went missing, and {@link unreducedFailures} is
 * where it lives. Each successive attempt to make this one predicate cover one
 * more moment is how it grew a step behind the thing it stands for three times
 * running.
 *
 * Matching on the phase *name* is enough because neither phase table cycles: a
 * phase is entered at most once per entity, so there is no earlier visit's row
 * to mistake for this one's.
 *
 * A phase whose entry reduces to no action at all (`ISSUES` waits on its
 * children) leaves no row and is therefore re-seeded on every tick. That is
 * deliberate and free — re-reducing an entry that produced nothing appends zero
 * rows and dispatches nothing — and the alternative, reading "no row" as
 * "already done", is the bug the first half of this predicate exists to close.
 */
function entryCompleted(
  ledger: readonly LedgerEntryState[],
  dispatches: readonly DispatchRow[],
  entity: ConductorEntity,
): boolean {
  const entered = ledger.some(
    (row) => row.signalKind === "phase_entered" && row.phaseBefore === entity.phase,
  );
  if (!entered) return false;

  const onEnter = phaseDefinition(entity.kind, entity.phase)?.onEnter ?? [];
  return onEnter.every((action) =>
    dispatches.some(
      (row) =>
        row.phase === entity.phase && row.action === action && row.outcome !== null,
    ),
  );
}

/**
 * Failures conductor recorded and never got to act on.
 *
 * **A derived signal has no cursor, so each one needs a durable source of its
 * own.** An *observed* signal survives a killed process because the observation
 * cursor is persisted last: whatever was not finished is re-observed and reduced
 * again. Signals the tick derives itself get none of that — they exist only in
 * the in-memory queue — so each derived kind needs somewhere durable to be
 * re-derived from, and needs to keep being re-derived until its consequence is
 * on disk. {@link entryCompleted} is that rule for `phase_entered`. This is the
 * same rule for `dispatch_failed`, which had none.
 *
 * The window it closes: `runDispatch` persists a failed outcome, the tick queues
 * the `dispatch_failed` for it, and `decide` answers with an escalation the
 * ledger records. A process that dies between the first and the last leaves a
 * dispatch that is durably failed and a human nobody told. {@link entryCompleted}
 * reads that dispatch as settled — correctly, it *is* settled — so the phase's
 * entry is not re-derived either, and an artifact-free issue sits idle with
 * nothing left that could move it. No observer can recover it: the failure was
 * conductor's own fact and no source ever knew it.
 *
 * The durable source is the dispatch record's own persisted outcome; the
 * consequence that stops the re-derivation is the ledger row `decide` writes for
 * the escalation. **Resuming the signal rather than re-deriving the phase's
 * entry is what makes this free** — the dispatch is not bought a second time,
 * because the dispatch is not what was lost.
 *
 * **Failures only, and that is the whole scope.** A `dispatch_completed` reduces
 * to no action at all (`decide`: "a dispatch settling changes the world, not the
 * phase"), so it leaves no ledger row — there is no consequence to wait for, and
 * requiring one would re-derive it on every tick forever, which is the
 * always-re-seed failure from the other side. Nothing is lost when it does go
 * missing: whatever that dispatch produced comes back as a structural fact the
 * next observation reads.
 *
 * **Not scoped to the entity's current phase, deliberately.** It looks like it
 * should be — {@link entryCompleted} is — but the resume is queued from the phase
 * loaded at the *start* of a tick, ahead of anything that could move it, so a
 * failure is always re-derived while the entity is still in the phase that ran
 * it. A phase filter would be a guard against an ordering this file does not
 * have.
 *
 * A ledger row written before rows carried their signal payload (BP-030) cannot
 * name a dispatch, so it does not count as the escalation for one. The cost is
 * at most one duplicate escalation against such a ledger, after which the row
 * this tick writes carries the id and the re-derivation converges.
 */
function unreducedFailures(
  ledger: readonly LedgerEntryState[],
  dispatches: readonly DispatchRow[],
): readonly string[] {
  const escalated = new Set<string>();
  for (const row of ledger) {
    const signal = row.signal;
    if (signal !== null && signal.kind === "dispatch_failed") {
      escalated.add(signal.dispatchId);
    }
  }
  return dispatches
    .filter((row) => row.outcome === "failed" && !escalated.has(row.id))
    .map((row) => row.id);
}

/**
 * Has the entity been left with **nothing that could move it**?
 *
 * The failure this exists for is the quiet one. A dispatch settles `completed`
 * and produces nothing observable — the agent hit ambiguity, decided the task
 * was underspecified, or asked its question into a final message nobody reads.
 * Now no gate of the phase applies, because every gate turns on a submission and
 * there is none; `completedWhen` is false; {@link entryCompleted} says the entry
 * work ran, so nothing re-dispatches; and nothing failed, so nothing escalates.
 * The entity sits there forever and every tick is a no-op. From outside it looks
 * healthy, which is what makes it expensive: the bug it generalizes cost most of
 * a day, and the fix that time (discovering submissions by branch) closed the
 * instance and not the class.
 *
 * **Derived, never stored** — the same rule a gate is held to, for the same
 * reason. Being stuck is a statement about durable state, so it must survive a
 * restart without being remembered, and a stored flag is one a killed process
 * loses or a repaired entity keeps.
 *
 * ---------------------------------------------------------------------------
 * THE THREE CONJUNCTS, AND WHY EACH IS THE ONE IT IS
 * ---------------------------------------------------------------------------
 *
 * - **The world leaves the phase nowhere to go** ({@link isPhaseStranded}) — no
 *   gate of the phase *applies*, it has not completed, and it is not terminal.
 *   All three are pure over the snapshot, so they live with the other world
 *   predicates and are argued there. The one worth repeating here: *applies* is
 *   not *outstanding*, and reading the derived gate instead would file a report
 *   at the ordinary end of a review.
 * - **The entry work has settled** ({@link entryCompleted}). This is what
 *   separates *stuck* from *in flight*, and it does it exactly: from the world's
 *   side a dispatch still running and a dispatch that produced nothing are
 *   identical — no submission, no gate — and the recovery for the first is to run
 *   it, not to file a report. It also covers the transient between an
 *   `enterPhase` and the observation that first sees what the new phase produced:
 *   entry is not complete until its dispatch settles, and the tick that enters a
 *   phase drains that dispatch in the same pass.
 * - **Nobody has been asked yet.** An outstanding escalation *is* something to
 *   wait for — a human — so an entity already escalated in this phase is waiting
 *   rather than unnoticed. One clause, three jobs: it converges this signal on
 *   the row its own escalation writes (the convergence `unreducedFailures` uses),
 *   it stops a second report stacking on the one a `dispatch_failed` already
 *   earned for the same idle entity, and it keeps a closed PR's escalation from
 *   being followed by a stall report about the same closure. Scoped to the
 *   current phase, because an ask answered two phases ago is not an ask.
 *
 * **What it deliberately does not report.** A phase whose entry reduces to no
 * action leaves no `phase_entered` row, so {@link entryCompleted} is permanently
 * false for it and it is never reported here — epic `ISSUES` is the instance.
 * That is under-reporting rather than a miss: an epic holds no registered
 * children today at all, so a report there would fire on every epic and say
 * nothing an operator could act on. And a gate that *applies* but that nothing
 * will ever release — `awaiting_goal_check` after a check that returned no
 * verdict is the live one — is a different shape needing a fact the phase table
 * does not carry: which gates the world releases and which conductor's own
 * dispatch does. Neither is guessed at here.
 *
 * @param dispatches The dispatch record **as it stood at the top of the tick**.
 *   Not re-read, and that is the point: a tick never judges the work it has just
 *   bought, so the earliest a stall can be reported is the following tick — which
 *   is the tick that first goes looking for a submission on the branch the agent
 *   pushed. Judging in-tick would escalate every agent that opens its own PR.
 */
function stalled(
  entity: ConductorEntity,
  world: World,
  ledger: readonly LedgerEntryState[],
  dispatches: readonly DispatchRow[],
): boolean {
  if (!isPhaseStranded(entity, world)) return false;
  if (!entryCompleted(ledger, dispatches, entity)) return false;
  return !humanAlreadyAsked(ledger, entity);
}

/**
 * Has a human already been asked to look at this entity, in the phase it is in?
 *
 * An outstanding escalation is *something to wait for*, so it converges every
 * derived signal that would otherwise keep asking: the stall report above, and
 * the proof gap below. Scoped to the current phase, because an ask answered two
 * phases ago is not an ask.
 *
 * One definition rather than two, because the two would drift and the failure is
 * asymmetric: a copy that stops matching either spams a human or goes quiet.
 */
function humanAlreadyAsked(
  ledger: readonly LedgerEntryState[],
  entity: ConductorEntity,
): boolean {
  return ledger.some(
    (row) => row.actionKind === "escalate" && row.phaseBefore === entity.phase,
  );
}

/**
 * What the work in front of the entity still owes the lifecycle — **the derived
 * signal that makes a proof re-earnable.**
 *
 * `runtime/tick` derives four signals, and each obeys the same rule: a derived
 * signal has no observation cursor, so it needs a durable source to be
 * re-derived from and a written consequence that stops it. This is that rule for
 * the goal proof, and it is what closes the transition the lifecycle was missing.
 *
 * - **The durable source** is the stored proof itself — the verdict, the revision
 *   it names and the ground it stood on — read back into the snapshot before any
 *   of this runs. Nothing new is stored to make this work, and nothing is
 *   remembered across a restart that is not already the proof.
 * - **The consequence that stops it** is a proof that *passes* at the revision
 *   and ground in front of us, which is precisely `awaiting_goal_check` being
 *   satisfied. So one check is bought per revision per ground and no more:
 *   running it writes the proof that closes the gap, whichever way the verdict
 *   went.
 *
 * Two gaps, because *no proof* and *a failed proof* are not the same state and
 * must not be answered the same way:
 *
 * - **`goal_check_needed`** — nothing has proved the code in front of us on the
 *   ground it needs. `decide` dispatches the check.
 * - **`goal_check_failed`** — something has, and it failed. `decide` sends the
 *   work back: to the agent while the submission is open, to a human once it has
 *   merged. Re-deriving it is what makes that survive a process that died between
 *   persisting the verdict and reducing the signal it produced — without it the
 *   next tick finds a durably failed proof and nobody who has been told.
 *
 * **Read off the derived gate rather than from a second copy of the predicates.**
 * `awaiting_goal_check` already answers *does this work need a proof it does not
 * have* — including the open-or-merged scoping and the ground — and asking the
 * table is what keeps the derivation from drifting away from the gate it exists
 * to release. Keying on the *derived* gate rather than on the gate's own
 * `appliesWhen` also means a red build or an outstanding review is answered
 * first, so nothing pays for a proof of code CI has already failed.
 *
 * `null` once a human has been asked in this phase: an escalation is an
 * outstanding ask, and a check that cannot run — a missing runner, a broken
 * workspace — would otherwise be re-derived and re-bought every tick, which is
 * unbounded paid work in exactly the situation that earned the escalation.
 */
function proofGap(
  entity: ConductorEntity,
  world: World,
  ledger: readonly LedgerEntryState[],
): "goal_check_needed" | "goal_check_failed" | null {
  if (humanAlreadyAsked(ledger, entity)) return null;
  return outstandingProof(entity, world);
}

/**
 * What a dispatch action would run against, so a tick can tell one piece of work
 * from the same piece of work asked for twice.
 *
 * The phase's active artifact is the identity: a revision dispatch is a pass
 * over everything outstanding on that artifact, so two of them produced by one
 * tick are one job. The head is not part of the key because it cannot vary
 * within a tick — every signal is reduced against one immutable snapshot, in
 * which an artifact's PR has exactly one head — and the tick is the whole
 * coalescing window. Across ticks the observation cursor is what stops a comment
 * being reduced twice.
 */
function dispatchKey(
  entity: ConductorEntity,
  action: DispatchAction,
  world: World,
): string {
  const kind = artifactKindForPhase(entity.phase);
  const hostedAt = kind ? artifactOfKind(world, kind)?.hostedAt : undefined;
  const host =
    hostedAt === undefined
      ? "none"
      : hostedAt.type === "pr"
        ? `pr/${hostedAt.number}`
        : `file/${hostedAt.path}`;
  return `${action.kind}@${host}`;
}

/** A work item nothing has put under management. */
export class ConductorNotManagedError extends Error {
  constructor(readonly entityId: string) {
    super(
      `${entityId} is not under management. Call \`manage\` before ticking it — ` +
        `conductor holds no registry entry, and therefore no session to read its state from.`,
    );
    this.name = "ConductorNotManagedError";
  }
}

/**
 * The entity, with its phase reconciled against the ledger.
 *
 * The ledger is the authority for a transition and the entity row is a
 * projection of it, so a disagreement between them has exactly one correct
 * resolution. It arises from one place: a process killed between the
 * `enterPhase` row and the entity write it precedes. Repairing on read rather
 * than leaving it means the next tick reduces against the phase the entity is
 * actually in, instead of re-entering a phase it already left and writing a
 * second row that breaks the chain.
 */
async function loadEntity(
  context: TickContext,
  ledger: readonly LedgerEntryState[],
): Promise<ConductorEntity> {
  const stored = await readEntityState(context);
  if (!stored) {
    throw new ConductorNotManagedError(context.entityId);
  }

  const last = ledger.at(-1);
  if (last && last.phaseAfter !== stored.phase) {
    const phase = last.phaseAfter as Phase;
    await persistEntity(context, phase, stored.lastSignalAt);
    return { id: stored.id, kind: context.entityKind, phase };
  }

  return { id: stored.id, kind: context.entityKind, phase: stored.phase };
}

/**
 * The entity's artifacts, oldest first.
 *
 * `World.artifacts` is newest-*last* and the ordering is load-bearing:
 * `artifactOfKind` resolves "the one this phase is working on" as the last of
 * its kind, so a reversed list points every gate at a superseded artifact. Ids
 * are minted with a zero-padded ordinal ({@link nextArtifactId}) precisely so
 * that the storage-key ordering the collection lists in *is* creation order.
 */
async function readArtifacts(context: TickContext): Promise<ArtifactFacts[]> {
  const rows = await context.collections.artifacts.list();
  return rows
    .filter((row) => row.entityId === context.entityId)
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      hostedAt: row.hostedAt,
      reviewRounds: row.reviewRounds,
    }));
}

/** The next artifact id for an entity, ordered so a list reads in creation order. */
function nextArtifactId(entityId: string, existing: number): string {
  return `${entityId}-${String(existing + 1).padStart(4, "0")}`;
}

/**
 * The children of an epic, read from the roster.
 *
 * `conductorIssues` is epic-level for exactly this: the issue entity and the
 * epic's roster are one collection, so an epic's tick reads each child's phase
 * without a second copy of it to drift.
 */
async function readChildIssues(context: TickContext): Promise<ChildIssueFacts[]> {
  if (context.entityKind !== "epic") return [];
  const rows = await context.collections.issues.list();
  return rows
    .filter((row) => row.epicId === context.entityId)
    .map((row) => ({ id: row.id, settled: row.phase === "SETTLED" }));
}

/** The cursor the previous observation left behind. */
async function readCursor(context: TickContext): Promise<ObservationCursor> {
  const prs = await context.collections.observations.list();
  const cursorRow = await context.collections.cursors.read(context.entityId);

  return {
    pullRequests: prs
      .filter((row) => row.entityId === context.entityId)
      .map((row) => ({
        number: row.number,
        state: row.state,
        headSha: row.headSha,
        checks: row.checks,
        mergeable: row.mergeable,
        baseRed: row.baseRed,
        knownReviewIds: row.knownReviewIds,
        observedAt: row.observedAt,
      })),
    // A cursor minted by another source names comments this one cannot
    // identify. Reading it as empty replays them once, which is the honest
    // answer and costs nothing an idempotent action does not absorb.
    commentKeys:
      cursorRow && cursorRow.source === context.deps.observer.source
        ? cursorRow.commentKeys
        : EMPTY_OBSERVATION_CURSOR.commentKeys,
  };
}

/**
 * Persist the cursor the observation returned, verbatim.
 *
 * Rows for submissions that are no longer in the cursor are deleted rather than
 * left: the observer rebuilds the cursor from what it actually saw, so a row it
 * dropped is a submission the source no longer reports, and keeping it would
 * hand `reconcile` a baseline the world does not have.
 */
async function persistCursor(
  context: TickContext,
  cursor: ObservationCursor,
  now: string,
): Promise<void> {
  const { observations, cursors } = context.collections;
  const keep = new Set(cursor.pullRequests.map((pr) => `pr/${pr.number}`));

  for (const pr of cursor.pullRequests) {
    await observations.write(`pr/${pr.number}`, {
      ...pr,
      entityId: context.entityId,
      knownReviewIds: [...pr.knownReviewIds],
      provenance: "poll",
    });
  }

  for (const row of await observations.list()) {
    if (row.entityId !== context.entityId) continue;
    if (!keep.has(`pr/${row.number}`)) await observations.remove(`pr/${row.number}`);
  }

  await cursors.write(context.entityId, {
    entityId: context.entityId,
    source: context.deps.observer.source,
    commentKeys: [...cursor.commentKeys],
    at: now,
  });
}

/** Append one transition. Written before the action it records takes effect. */
async function appendLedger(
  context: TickContext,
  row: Omit<LedgerEntryState, "id">,
): Promise<LedgerEntryState> {
  const key = `${context.entityId}/${row.seq}`;
  const entry: LedgerEntryState = { ...row, id: key };
  await context.collections.ledger.write(key, entry);
  return entry;
}

/**
 * Count a review round against the artifact a revision is answering.
 *
 * Conductor owns this number — no source reports it — and it is what the round
 * budget is spent against, so nothing else can maintain it.
 *
 * **A round is one handled feedback pass, and a pass is one revision dispatch.**
 * Two properties pull against each other here and both are wanted, so the rule
 * is written as the thing that separates them:
 *
 * - Comments arriving in **one poll** are one pass. They reduce to one
 *   `addressFeedback` action each and one ledger row each, but the
 *   {@link dispatchKey} coalescing in {@link runTick} lets only the first of
 *   them buy a run — and this is called from inside that guard, so the batch is
 *   one dispatch and one round. The coalescing window is the tick, which is also
 *   the window in which an artifact's head cannot move.
 * - A **later** pass on the same head is a second pass. It is a second paid
 *   dispatch answering feedback the first one did not settle, so it costs a
 *   second round.
 *
 * The head is what this used to key on, and keying on it collapsed the second
 * case into the first. A pass that pushes no commit leaves the head where it
 * was, so every later pass on that head counted **zero**: the counter could sit
 * at one while pass after pass was handled and paid for, and the cap meant to
 * park a stuck loop at twelve rounds never fired. Distinct heads are not
 * distinct attempts — distinct *dispatches* are, and a pass that changed nothing
 * is an attempt that failed to change anything rather than an attempt that never
 * happened.
 *
 * **And an attempt that never happened is exactly what a failed dispatch is**,
 * which is why {@link runTick} calls this *after* the run and only on one that
 * settled `completed`. A harness that was never installed, never given a
 * workspace, or never given a credential read no comment and wrote no code; the
 * failure is a fact about the runner, and the round budget is a statement about
 * the work.
 *
 * A redundant tick still costs nothing, and not because of a check here: a tick
 * that reduces no new signal produces no revision action, so this is never
 * reached. Nothing in this function can be reached without a dispatch having
 * settled on the other side of it.
 *
 * `lastRoundSha` is a record rather than a gate — the head the last round was
 * handled at, kept on the row for the audit trail. Nothing reads it.
 */
async function countReviewRound(
  context: TickContext,
  entity: ConductorEntity,
  world: World,
): Promise<void> {
  const kind = artifactKindForPhase(entity.phase);
  if (!kind) return;

  const rows = (await context.collections.artifacts.list()).filter(
    (row) => row.entityId === context.entityId && row.kind === kind,
  );
  const artifact = rows.at(-1);
  if (!artifact || artifact.hostedAt.type !== "pr") return;

  const head = world.pullRequests[artifact.hostedAt.number]?.headSha;

  await context.collections.artifacts.write(artifact.id, {
    ...artifact,
    reviewRounds: artifact.reviewRounds + 1,
    lastRoundSha: head ?? artifact.lastRoundSha,
  });
}

/**
 * Record what a dispatch produced, when it produced something conductor has to
 * know about before its next read.
 *
 * An artifact is the one such thing: the observation request is driven by the
 * artifacts an entity holds, so a pull request nobody recorded is a pull request
 * no gate will ever read. Everything else a vendor reports is left to the
 * structural read, which is the authority regardless — a vendor that says
 * nothing has not said "nothing happened".
 */
async function recordProduced(
  context: TickContext,
  entity: ConductorEntity,
  result: DispatchResult,
): Promise<void> {
  const kind = artifactKindForPhase(entity.phase);
  if (!kind) return;

  const hostedAt =
    result.produced.pullNumber !== undefined
      ? ({ type: "pr", number: result.produced.pullNumber } as const)
      : result.produced.artifactPath !== undefined
        ? ({ type: "file", path: result.produced.artifactPath } as const)
        : null;
  if (!hostedAt) return;

  await recordArtifact(context, kind, hostedAt);
}

/*
 * ---------------------------------------------------------------------------
 * WHAT `MUTATES_WORK` DOES FOR THE GOAL PROOF
 * ---------------------------------------------------------------------------
 *
 * The table lives in `model/actions`, beside the action union it is total over,
 * and answers one question: *can a dispatch of this kind put a commit on the
 * branch it ran against?* Two of this file's rules are consequences of it, which
 * is why they read it rather than each keeping a list.
 *
 * It used to be the *guarantee* behind "a merge gate never opens on unproved
 * work": a stored verdict survived unless a kind cleared it. It cannot be that,
 * and could never have been — an enumeration over conductor's own dispatches has
 * nothing to say about a head a human moved. The guarantee is now the revision
 * stored beside the verdict (`model/world`'s `goalCheckFor`), which a push
 * nobody dispatched fails exactly as a revision does. What the table answers now
 * is sharper:
 *
 * - **A verdict from before is stale.** The gate would catch it at the next
 *   observation anyway, but not until then — the snapshot this tick holds was
 *   read *before* the dispatch pushed, so for the rest of this pass the old head
 *   and the old proof still agree with each other. Clearing closes that window,
 *   and it is conductor's to close because conductor is the only thing that
 *   knows a dispatch it just ran may have moved the head. The visible cost of
 *   leaving it open is a tick reporting `awaiting_merge` to a human on work its
 *   own agent has just rewritten.
 * - **A verdict this dispatch reports names a revision nobody has read yet.**
 *   The check ran on what the agent wrote; the head in the snapshot predates it.
 *   So the proof is recorded *unbound* and resolved by the next observation —
 *   see {@link claimedGoalCheck} and {@link bindUnresolvedProof}. A kind that
 *   cannot push has no such gap: the head in the snapshot is the head the check
 *   ran on, and the proof is bound on the spot.
 *
 * **The failure mode is bounded, which is why reading it here is cheap.** A kind
 * wrongly marked `false` is caught by the revision at the next observation, so
 * it costs a stale gate for one tick rather than a false merge. A kind wrongly
 * marked `true` throws away a live proof and buys a goal check nobody needed.
 * Neither direction can open a merge gate on unproved work.
 */

/**
 * What a settled dispatch leaves the stored goal proof at, or `undefined` when
 * it leaves it alone.
 *
 * Two rules, in this order:
 *
 * - **A verdict the dispatch reported wins, always.** `runGoalCheck` is the
 *   obvious source — it exists to produce this and nothing else. `implement` is
 *   the one that is easy to miss and load-bearing: in the single-PR shape the
 *   goal is proved at implementation completion, *before* the PR opens, which is
 *   the only reason `awaiting_merge` is ever reachable at all. And a revision
 *   that re-ran the check is telling us something better than "unknown" — that
 *   is a fresh proof, not a stale one, so it is not cleared.
 * - **A dispatch that could have pushed and reported nothing clears it.** See
 *   {@link INVALIDATES_GOAL_CHECK}, and for why that is a window this closes
 *   rather than the guarantee it used to be.
 *
 * Everything else returns whatever the dispatcher reported, which is almost
 * always nothing — and for a dispatch that changed nothing, nothing means **no
 * claim**, not a failure. A vendor that is silent has not said the goal is
 * unmet, so the stored proof stands.
 *
 * **Which revision a fresh verdict is recorded against splits on the same
 * question.** A dispatch that cannot push proved the head that is already in
 * `head` — `runGoalCheck` is the case that matters, and it is the whole reason
 * this takes a head at all: after a merge it runs detached at the base, and the
 * merged submission's head is the revision that *put* the proved code there.
 * Nothing can move a merged head afterwards, so that binding never goes stale;
 * a base that moves on later is somebody else's change, not this issue's to
 * re-prove. Before a merge it runs on the submission's own branch, and the head
 * in the snapshot is the revision it stood on. A dispatch that *could* push
 * proved whatever it wrote, and the head in hand was read before it ran — so the
 * revision is left `null` for {@link bindUnresolvedProof} to resolve, and reads
 * as unproved until it does.
 *
 * **And which claim it answers is carried, not inferred.** `ground` comes from
 * where the workspace was actually provisioned, decided once by
 * {@link proofGroundFor} and used for the provisioning and the record alike, so
 * a check cannot be recorded as proving something other than what it stood on.
 * Every coding dispatch runs on the phase's branch, so its verdict is a branch
 * proof whatever it reports.
 */
function claimedGoalCheck(
  action: DispatchAction,
  result: DispatchResult,
  head: string | null,
  ground: ProofGround,
): GoalProof | undefined {
  const mayHavePushed = MUTATES_WORK[action.kind];
  const verdict = mayHavePushed ? (result.goalCheck ?? null) : result.goalCheck;
  if (verdict === undefined) return undefined;
  if (verdict === null) return UNPROVED;
  return { verdict, sha: mayHavePushed ? null : head, ground };
}

/**
 * The ground a goal check dispatched **now** would stand on, and therefore both
 * where its workspace is provisioned and what its verdict is recorded as
 * proving.
 *
 * One expression, read from `model/world`'s `requiredGround`, so the two can
 * never disagree. They must not: a check provisioned at the base before the
 * merge proves the code *without* the change and would pass while proving
 * nothing about it, which is worse than not running at all; and one provisioned
 * on the branch after the merge proves a branch that still exists and still
 * passes but is not what a reader of the base gets.
 */
function proofGroundFor(entity: ConductorEntity, world: World): ProofGround {
  const kind = artifactKindForPhase(entity.phase);
  const artifact = kind ? artifactOfKind(world, kind) : undefined;
  return requiredGround(prForArtifact(world, artifact));
}

/**
 * Give a proof whose revision is not known yet the head this observation just
 * read, once.
 *
 * **A dispatch proves code conductor has not seen.** The agent commits, the
 * check runs on what it committed, and the tick that receives the verdict is
 * holding a snapshot read before any of that happened — so the revision the
 * proof describes is genuinely unknown at the moment it is recorded, and it is
 * recorded as unknown rather than guessed. The single-PR shape is the sharpest
 * instance: the goal is proved *before the submission exists at all*, so there
 * is not even a submission to take a head from.
 *
 * The next observation is where it becomes knowable. The dispatch pushed a
 * branch; the submission conductor then reads on that branch is that push, so
 * its head is the revision the proof was taken against. Written down once — a
 * resolution of an unknown, not a re-proof — and never rewritten, because from
 * then on the stored revision is what a later head is compared *to*.
 *
 * **Only a tick resolves, never a read.** A read materializes a world and writes
 * nothing (see {@link observeWorld}), and that is not merely a rule being
 * respected here: adopting the current head on every read would mean an unbound
 * proof matched whatever head happened to be there, every time it was asked —
 * which is the defect this whole change removes, reintroduced through the read
 * path. Leaving it unbound reads as unproved, which is the safe direction.
 *
 * **The window this leaves, stated rather than papered over.** Between a
 * dispatch settling and the next observation, a commit conductor never saw would
 * be adopted as the revision the proof describes. That is bounded by how soon
 * the next tick runs rather than by anything structural, and it is strictly
 * narrower than what it replaces — a proof that outlived its code for as long as
 * the issue lived. Closing it needs the revision to come from the thing that ran
 * the check, and {@link DispatchResult} has nowhere to report one: a dispatcher
 * that produces a verdict from something with an exit status knows the commit it
 * ran against, and `produced` is where it would say so. That is a change to the
 * dispatcher seam, not to this file.
 */
async function bindUnresolvedProof(
  context: TickContext,
  entity: ConductorEntity,
  world: World,
): Promise<World> {
  if (world.goalCheck === null || world.goalCheckSha !== null) return world;
  const head = activeHead(entity, world);
  if (head === null) return world;
  await persistGoalCheck(context, {
    verdict: world.goalCheck,
    sha: head,
    // The ground is not an unknown being resolved — the dispatch that reported
    // the verdict already said which claim it was answering. Only the revision
    // was unknowable.
    ground: world.goalCheckGround,
  });
  return { ...world, goalCheckSha: head };
}

/**
 * Write down that the entity holds an artifact of `kind` hosted at `hostedAt`,
 * unless it already does.
 *
 * The one writer of an artifact row, and the reason artifact identity stays
 * conductor's: the id is minted here in creation order (see
 * {@link nextArtifactId}, and `World.artifacts` for why that order is
 * load-bearing) and `reviewRounds` starts where only conductor could start it.
 */
async function recordArtifact(
  context: TickContext,
  kind: ArtifactKind,
  hostedAt: ArtifactFacts["hostedAt"],
): Promise<void> {
  const rows = (await context.collections.artifacts.list()).filter(
    (row) => row.entityId === context.entityId,
  );
  const already = rows.some(
    (row) =>
      row.kind === kind &&
      row.hostedAt.type === hostedAt.type &&
      JSON.stringify(row.hostedAt) === JSON.stringify(hostedAt),
  );
  if (already) return;

  const id = nextArtifactId(context.entityId, rows.length);
  await context.collections.artifacts.write(id, {
    id,
    entityId: context.entityId,
    kind,
    hostedAt,
    reviewRounds: 0,
    lastRoundSha: null,
  });
}

/**
 * Adopt the submission somebody opened for this phase's branch.
 *
 * **The step that lets work an agent actually did enter the observed world.**
 * The read is driven by the artifacts an entity holds, so a submission nobody
 * recorded is a submission no gate will ever read — and the ordinary recording
 * path ({@link recordProduced}) only fires when a vendor *reported* a pull
 * request. The default Claude dispatcher reports the branch and nothing else, on
 * purpose: whether a PR exists is a structural fact, and parsing it out of an
 * agent's prose would make the agent a second authority on it. Without this
 * step, that correct refusal means the PR the agent opened never enters the
 * world at all, no `pr_opened`, CI, review or merge gate can appear, and the
 * entity goes idle after one dispatch. Reconciliation cannot recover it either,
 * because recovery works over PRs that were *read*, and this one never is.
 *
 * So conductor asks the source the one question it can answer: **which
 * submission is on this branch?** It is asked of the branch rather than the
 * vendor result deliberately, because that also covers the case a vendor report
 * never could — a *human* opening the PR for a branch the agent pushed, with
 * conductor nowhere in the loop.
 *
 * The lookup is skipped once the phase holds an artifact of its kind, so it
 * costs one extra source call per tick only in the window between the work being
 * handed out and the submission appearing. A replacement submission opened after
 * the first one closed is not adopted here: a PR closed unmerged is escalated to
 * a human by `decide`, and quietly picking up its successor would route around
 * the escalation.
 */
async function adoptSubmissionForBranch(
  context: TickContext,
  entity: ConductorEntity,
): Promise<void> {
  const kind = artifactKindForPhase(entity.phase);
  if (!kind) return;

  const branch = branchNameFor(entity);
  if (!branch) return;

  const rows = await context.collections.artifacts.list();
  const held = rows.some((row) => row.entityId === context.entityId && row.kind === kind);
  if (held) return;

  const number = await context.deps.observer.submissionForBranch(branch);
  if (number === null) return;

  await recordArtifact(context, kind, { type: "pr", number });
}

/**
 * The vendor recorded against a goal check.
 *
 * Not a coding harness, and the record says so rather than leaving a reader to
 * infer it: no harness ran, no model was consulted, and nothing about this
 * dispatch's outcome came from an agent.
 */
const GOAL_CHECK_VENDOR = "conductor";

/**
 * Run the work item's goal check, and turn its exit status into a verdict.
 *
 * **The one action conductor executes itself instead of handing to a harness.**
 * Every other dispatch is work that needs judgment, and judgment is what a
 * vendor harness is for. A goal check is the opposite: it is the single moment
 * where judgment is *disqualifying*, because the question is whether the work
 * did what the item asked and the agent under examination is the one being
 * asked. `DispatchResult.goalCheck` has always said the verdict must come from
 * something with an exit status — and no adapter could supply one, since a
 * harness returns the terminal subtype of its own agent loop rather than the
 * status of anything the agent ran inside it. So nothing ever set the field, and
 * `awaiting_goal_check` was a gate nothing could release: every merged issue
 * reached it and waited forever, looking healthy because a gate was named.
 *
 * Running it here rather than in each adapter is also what keeps it
 * vendor-neutral — the same command proves the work whoever wrote it, and a
 * harness conductor has never heard of needs no goal-check code at all.
 *
 * ---------------------------------------------------------------------------
 * WHERE IT RUNS — AND WHY THAT IS NOT ONE ANSWER
 * ---------------------------------------------------------------------------
 *
 * On the **ground the proof is being taken for**, which {@link proofGroundFor}
 * decides once for the provisioning and the record together. The two answers are
 * opposite and each is wrong in the other's place:
 *
 * - **After the merge — {@link DETACHED_AT_BASE}.** The entity is still in
 *   `IMPLEMENTATION` while it runs, so the phase's own branch is `fix/<id>`: the
 *   feature branch, which still exists and still passes, and which is not what
 *   landed whenever the merge squashed, resolved a conflict, or the base moved on
 *   in between. A proof taken there is a proof of code that never reached the
 *   base, and it settles the issue on it. `dispatch/branch`'s third plan says
 *   exactly what is wanted instead: fetch the base, put HEAD on
 *   `<remote>/<base>`, own no ref.
 * - **Before the merge — the phase's branch.** This provisioning used to be
 *   unconditional, which was right while a check could only be dispatched after a
 *   merge. Now that a proof is re-earnable on an open submission, standing at the
 *   base would prove the base — code *without* the change — and pass. That is
 *   worse than not running: it would open a merge gate having proved nothing
 *   about the work, which is the one thing this lifecycle exists to prevent.
 *
 * Both plans are run in conductor's own worktree, and the branch plan's re-entry
 * rule means the check stands on the branch's remote tip. What that tip contains
 * is `dispatch/branch`'s to guarantee: a workspace carrying edits that are in no
 * revision makes any verdict taken in it a statement about code that exists
 * nowhere, and nothing here can detect that.
 *
 * The isolation is conductor's own `worktree`, not the dispatcher's declared
 * model, because this is not the dispatcher's run: a `remote` harness provisions
 * nothing locally, and conductor cannot spawn a process in an environment it has
 * no path to. A worktree also keeps a `cwd` harness's repo root from being moved
 * under the developer standing in it.
 *
 * ---------------------------------------------------------------------------
 * THREE OUTCOMES, NOT TWO
 * ---------------------------------------------------------------------------
 *
 * - **The command ran.** Exit 0 is `passed`, anything else is `failed`, and
 *   either way the *dispatch* completed — the check did its job. A failing goal
 *   is a statement about the work, and `decide` routes it: back to the agent
 *   before the merge, to a human after it.
 * - **The command could not run** — missing, crashed on the way up, killed,
 *   timed out. That is conductor's machinery failing, not the work, so it
 *   settles `failed` with the reason and claims **no verdict at all**. Reporting
 *   it as a failed goal would tell somebody their change did not do what the
 *   issue asked because a runner was not installed.
 * - **No goal was declared.** Then there is nothing to prove and nothing to run,
 *   and the item is recorded as `passed`. That is the uncomfortable one, so it
 *   is argued rather than assumed: an issue with no goal check cannot be *held*
 *   on proving one — `awaiting_goal_check` is released by a verdict and by
 *   nothing else, so any other answer strands every merged issue in a project
 *   that declared no goal command, which is the exact failure this change
 *   exists to remove. It is distinguishable from a real pass in the record (the
 *   dispatch's own `error` line says nothing was run) and from a real failure by
 *   the verdict itself. What it is *not* is a silent vendor being read as a
 *   pass: silence from a harness that was asked is no claim, and this is a
 *   project stating there is no claim to make.
 *
 * Settles rather than throwing, the same contract {@link runDispatch} holds and
 * for the same reason: an exception skips the ledger, and a transition that
 * skipped the ledger cannot be recovered by a restart.
 */
async function runGoalCheck(
  context: TickContext,
  entity: ConductorEntity,
  ground: ProofGround,
): Promise<DispatchResult> {
  const { config, git, now } = context.deps;
  const startedAt = now().toISOString();
  const dispatchId = `${context.entityId}#${(await countDispatches(context)) + 1}`;

  const record = async (
    outcome: "completed" | "failed" | null,
    settledAt: string | null,
    detail: string | null,
  ): Promise<void> => {
    await context.collections.dispatches.write(dispatchId, {
      id: dispatchId,
      entityId: context.entityId,
      phase: entity.phase,
      action: "runGoalCheck",
      vendor: GOAL_CHECK_VENDOR,
      startedAt,
      settledAt,
      outcome,
      costUsd: null,
      detail,
    });
  };

  /**
   * `detail` is what the record keeps and `error` is what the seam carries, and
   * they are not the same string: a check that *ran* has a detail (the exit
   * status it saw) and no error, because it settled exactly as asked. Folding
   * the two would put "the goal command exited 0" in a field whose contract is
   * "why it failed".
   */
  const settle = async (
    outcome: "completed" | "failed",
    detail: string | null,
    verdict?: "passed" | "failed",
  ): Promise<DispatchResult> => {
    const settledAt = now().toISOString();
    await record(outcome, settledAt, detail);
    return {
      dispatchId,
      outcome,
      produced: {},
      costUsd: null,
      vendorRunId: null,
      error: outcome === "failed" ? detail : null,
      // Spread, so a run that proved nothing carries no key at all — absence is
      // the claim, and a `goalCheck: undefined` written by hand is a different
      // statement from one the seam never made.
      ...(verdict ? { goalCheck: verdict } : {}),
      startedAt,
      settledAt,
    };
  };

  // Down before the run, not after it, so a check in flight when the process
  // dies is visible to whoever looks next. Same ordering as `runDispatch`.
  await record(null, null, null);

  // `== null`, not `=== null`: a hand-built config that omitted the field
  // reaches here as `undefined`, and reading that as "declared" would spawn the
  // command's first element out of nothing.
  if (config.goalCheck == null) {
    return settle(
      "completed",
      "No goal command is declared, so conductor ran nothing and has nothing to prove.",
      "passed",
    );
  }

  let workspacePath: string;
  try {
    const workspace = await provisionWorkspace({
      isolation: "worktree",
      repoRoot: config.repoRoot,
      entityId: context.entityId,
      // The one place the two grounds differ, and the reason `ground` is passed
      // in rather than re-derived here: the claim the verdict is recorded as
      // making and the code it was taken against must come from one decision.
      branch: ground === "base" ? DETACHED_AT_BASE : branchNameFor(entity),
      git,
      baseBranch: config.baseBranch,
      remote: config.remote,
    });
    // `worktree` isolation always yields a path; the `null` belongs to `remote`,
    // which this never asks for. Answered rather than asserted so a provisioning
    // change cannot turn into a crash here.
    if (workspace.path === null) {
      return settle("failed", "The goal check was given no workspace to run in.");
    }
    workspacePath = workspace.path;
  } catch (error) {
    return settle(
      "failed",
      `The goal check could not be provisioned at the base: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  const outcome = await runGoalCheckCommand({
    goalCheck: config.goalCheck,
    cwd: workspacePath,
    entityId: context.entityId,
  });

  return outcome.kind === "verdict"
    ? settle("completed", `The goal command exited ${outcome.exitCode}.`, outcome.verdict)
    : settle("failed", outcome.reason);
}

/**
 * Run one dispatch action: provision the workspace its dispatcher's isolation
 * calls for, hand over the brief, and record what came back.
 *
 * **Nothing here throws.** A dispatcher that could not be given a workspace and
 * one that crashed are the same fact to the process — the work did not get
 * done — and both must reach the ledger as `dispatch_failed` so `decide` can
 * escalate them. An exception would skip the ledger and lose the transition,
 * which is the one outcome the seam's "`run` settles" rule exists to prevent;
 * catching here holds that rule even for a vendor adapter that breaks it.
 */
async function runDispatch(
  context: TickContext,
  entity: ConductorEntity,
  action: DispatchAction,
  summary: string | null,
): Promise<DispatchResult> {
  const { config, dispatcher, git, now } = context.deps;
  const startedAt = now().toISOString();
  const dispatchId = `${context.entityId}#${(await countDispatches(context)) + 1}`;
  const branch = branchNameFor(entity);

  // The record goes down before the run, not after it: a dispatch that is in
  // flight when the process dies has to be visible to whoever looks next.
  await context.collections.dispatches.write(dispatchId, {
    id: dispatchId,
    entityId: context.entityId,
    phase: entity.phase,
    action: action.kind,
    vendor: dispatcher.vendor,
    startedAt,
    settledAt: null,
    outcome: null,
    costUsd: null,
    detail: null,
  });

  const failed = (error: string): DispatchResult => ({
    dispatchId,
    outcome: "failed",
    produced: {},
    costUsd: null,
    vendorRunId: null,
    error,
    startedAt,
    settledAt: now().toISOString(),
  });

  let result: DispatchResult;
  try {
    const workspace = await provisionWorkspace({
      isolation: dispatcher.isolation,
      repoRoot: config.repoRoot,
      entityId: context.entityId,
      branch,
      git,
      baseBranch: config.baseBranch,
      remote: config.remote,
    });

    const brief: PhaseBrief = briefFor(entity, action, {
      dispatchId,
      branch,
      workspacePath: workspace.path,
      guidancePaths: config.guidance,
      summary,
      // Outward only: an agent is told what its work will be measured by, so it
      // can run the check itself before it stops. Nothing reads a brief back —
      // see `runtime/goal-check` on why the command may never come from one.
      goalCommand: config.goalCheck?.command ?? null,
    });

    result = await dispatcher.run(brief);
  } catch (error) {
    result = failed(error instanceof Error ? error.message : String(error));
  }

  await context.collections.dispatches.write(dispatchId, {
    id: dispatchId,
    entityId: context.entityId,
    phase: entity.phase,
    action: action.kind,
    vendor: dispatcher.vendor,
    startedAt: result.startedAt,
    settledAt: result.settledAt,
    outcome: result.outcome,
    costUsd: result.costUsd,
    detail: result.error,
  });

  if (result.outcome === "completed") await recordProduced(context, entity, result);

  return result;
}

/** Every dispatch record belonging to this entity, in storage order. */
async function dispatchRows(context: TickContext): Promise<readonly DispatchRow[]> {
  const rows = await context.collections.dispatches.list();
  return rows.filter((row) => row.entityId === context.entityId);
}

/** How many phase executions this entity has had, ever. */
export async function countDispatches(context: TickContext): Promise<number> {
  return (await dispatchRows(context)).length;
}

/**
 * Read the world once, without reducing anything.
 *
 * Used by the read path, which must derive a gate — a gate is a predicate over
 * a snapshot, so answering "what is it waiting on" means materializing one.
 * **It deliberately does not persist the returned cursor.** A cursor records
 * what has been *reduced over*, and a read reduces nothing; advancing it here
 * would swallow every signal the read happened to be the first to see.
 */
export async function observeWorld(
  context: TickContext,
  entity: ConductorEntity,
): Promise<World> {
  const proof = await readGoalCheck(context);
  const observation = await context.deps.observer.observe({
    entity: { kind: entity.kind, phase: entity.phase },
    entityId: context.entityId,
    artifacts: await readArtifacts(context),
    // Conductor-owned, and the reader has no other source for either half — a
    // request that omits them hands every gate `null`, which reads as "the goal
    // check has never run" and holds `awaiting_merge` shut however many times it
    // passed.
    goalCheck: proof.verdict,
    goalCheckSha: proof.sha,
    goalCheckGround: proof.ground,
    childIssues: await readChildIssues(context),
    guidancePaths: context.deps.config.guidance,
    policy: context.deps.config.policy,
    cursor: await readCursor(context),
    now: context.deps.now().toISOString(),
  });
  return observation.world;
}

/** Assemble the answer every entry point returns. */
export async function managedWork(
  context: TickContext,
  entity: ConductorEntity,
  world: World,
): Promise<ManagedWork> {
  return {
    entity,
    gate: deriveGate(entity, world),
    ledger: await readLedger(context),
    dispatchCount: await countDispatches(context),
  };
}

/**
 * One tick: read the world, reduce every signal it reports, execute what
 * `decide` returned, and append the ledger.
 *
 * **Divergences are adopted, not recorded.** The observer reports facts where
 * conductor's copy disagreed with the source in a direction that produces no
 * signal; the source wins, and it already has — the world this tick reduces
 * against is the source's. They are deliberately *not* written to the ledger:
 * `decide` never emits `recordDivergence`, so a row carrying it would be a row
 * that cannot be replayed to its own action, which breaks the one invariant the
 * ledger exists to hold. Conductor has nowhere else to put them today, and that
 * is a real gap rather than a decision.
 *
 * @param context The entity, its collections, and the runtime's seams.
 * @returns The entity as it stands after the tick, with its derived gate.
 */
export async function runTick(context: TickContext): Promise<ManagedWork> {
  const { now } = context.deps;
  const at = now().toISOString();

  let ledger = await readLedger(context);
  let entity = await loadEntity(context, ledger);
  let seq = ledger.at(-1)?.seq ?? 0;

  // Ahead of the read, because the read is driven by what this may record: a
  // submission opened for the phase's branch — by the agent at the end of its
  // run, or by a human — has no artifact naming it, and without one it is
  // invisible to the observation about to happen. See {@link
  // adoptSubmissionForBranch}.
  await adoptSubmissionForBranch(context, entity);

  const proof = await readGoalCheck(context);
  const observation = await context.deps.observer.observe({
    entity: { kind: entity.kind, phase: entity.phase },
    entityId: context.entityId,
    artifacts: await readArtifacts(context),
    // See `observeWorld` for why an omission here is silent and total.
    goalCheck: proof.verdict,
    goalCheckSha: proof.sha,
    goalCheckGround: proof.ground,
    childIssues: await readChildIssues(context),
    guidancePaths: context.deps.config.guidance,
    policy: context.deps.config.policy,
    cursor: await readCursor(context),
    now: at,
  });
  // `let`, for one fact and one only: the goal proof is conductor's own rather
  // than the source's, so the reductions after it read a snapshot carrying what
  // conductor now knows — a verdict a dispatch reports partway through this
  // tick, and the revision an earlier dispatch's verdict turns out to describe.
  // Nothing else here rebinds the world — an observed fact that moved mid-tick
  // is the *next* tick's read.
  //
  // Ahead of every reduction, because a proof whose revision this observation
  // has just made knowable reads as *unproved* until it is bound, and a gate
  // derived before that would be answering with a stale `null`.
  let world = await bindUnresolvedProof(context, entity, observation.world);

  const queue: Queued[] = [];
  const dispatches = await dispatchRows(context);

  // A phase whose entry work has not *finished* has not really been entered,
  // whatever its row says it advanced into. Entry is what dispatches a phase's
  // opening work, so without this a fresh item sits still forever, and a restart
  // taken mid-transition or mid-dispatch loses that phase's opening work
  // permanently. Derived from the ledger and the dispatch record rather than
  // stored on the entity, which is what makes it restart-safe in both
  // directions — see {@link entryCompleted}. The property is exact: a phase's
  // entry work runs once, and runs at least once.
  if (!entryCompleted(ledger, dispatches, entity)) {
    queue.push({
      signal: { kind: "phase_entered", entityId: context.entityId, at },
      derived: true,
    });
  }
  // The same rule for the other signal this tick derives: a failure that reached
  // the dispatch record and never reached the ledger is resumed, not re-run.
  // See {@link unreducedFailures} — a derived signal has no cursor to be
  // re-observed from, so it is re-derived from its own durable source until its
  // consequence is written down.
  for (const dispatchId of unreducedFailures(ledger, dispatches)) {
    queue.push({
      signal: { kind: "dispatch_failed", entityId: context.entityId, at, dispatchId },
      derived: true,
    });
  }
  for (const signal of observation.signals) queue.push({ signal, derived: false });

  const summary = await readEntitySummary(context);

  /** Dispatches this tick has already run, keyed by {@link dispatchKey}. */
  const dispatched = new Set<string>();

  let newestSignalAt: string | null = null;

  /**
   * Whether the stall check has been made. Made **once, when the queue first
   * empties**, and not at seeding time with the other derived signals.
   *
   * "Nothing left that could move it" is only knowable once everything the tick
   * had has been reduced. Seeded early it is answered against a world holding
   * signals nobody has acted on yet — a `merge_conflict` that is about to
   * dispatch a resolution, a `base_recovered` about to dispatch a rebase — and
   * it would file a report saying nothing will happen in the same pass that
   * makes something happen. Draining first is also what puts this tick's own
   * escalations on the ledger the check reads, so a stall never stacks on an ask
   * that was written moments earlier.
   */
  let stallChecked = false;

  /**
   * Whether this tick has bought work that could have moved the code.
   *
   * A goal check must stand on the revision its snapshot reports, and a coding
   * dispatch this tick just ran may already have pushed past it — so the proof
   * question is not asked at all in a tick that bought one. Same principle as
   * the dispatch record being read once at the top: **a tick never judges the
   * work it has just bought.** Deferring costs one tick and keeps every verdict
   * bound to a revision conductor has actually seen.
   */
  let boughtWork = false;

  /**
   * Whether the proof gap has been derived. Made **once, when the queue first
   * empties**, for the same reason the stall check is: what the work still owes
   * is only knowable after everything the tick had has been reduced. Derived
   * *before* the stall check, because dispatching a check is something that can
   * move the entity, and "nothing left that could move it" has to be asked last.
   */
  let proofChecked = false;

  for (;;) {
    if (queue.length === 0 && !proofChecked) {
      proofChecked = true;
      // Re-read: the rows this tick wrote are the ones that matter, an
      // escalation appended a moment ago being an ask already outstanding.
      ledger = await readLedger(context);
      const gap = boughtWork ? null : proofGap(entity, world, ledger);
      if (gap !== null) {
        queue.push({
          signal: { kind: gap, entityId: context.entityId, at },
          derived: true,
        });
      }
    }

    if (queue.length === 0) {
      if (stallChecked) break;
      stallChecked = true;
      // Re-read, because the rows this tick wrote are the ones that matter: an
      // escalation appended a moment ago is an ask already outstanding.
      ledger = await readLedger(context);
      if (!stalled(entity, world, ledger, dispatches)) break;
      queue.push({
        signal: { kind: "progress_stalled", entityId: context.entityId, at },
        derived: true,
      });
    }

    const next = queue.shift();
    if (!next) break;
    const { signal } = next;

    const phaseBefore = entity.phase;
    const gate = deriveGate(entity, world);
    const actions: Action[] = decide(entity, signal, world);
    if (!next.derived && (newestSignalAt === null || signal.at > newestSignalAt)) {
      newestSignalAt = signal.at;
    }

    for (const action of actions) {
      seq += 1;
      const phaseAfter = action.kind === "enterPhase" ? action.phase : entity.phase;

      // Ahead of the effect, always. See this file's header — this ordering is
      // what makes "performed" and "recorded" impossible to get out of order.
      await appendLedger(context, {
        entityId: context.entityId,
        entityKind: entity.kind,
        seq,
        signalKind: signal.kind,
        signalSynthesized: signal.synthesized ?? false,
        signal,
        world,
        actionKind: action.kind,
        phaseBefore,
        phaseAfter,
        gate,
        at,
      });

      if (action.kind === "enterPhase") {
        entity = { ...entity, phase: action.phase };
        await persistEntity(context, entity.phase, newestSignalAt);
        // Entering a phase is what dispatches its opening work, and it drains
        // in this same pass — ahead of whatever the observation reported next,
        // which is the order a live arrival would have produced.
        queue.unshift({
          signal: { kind: "phase_entered", entityId: context.entityId, at: signal.at },
          derived: true,
        });
        continue;
      }

      if (!isDispatch(action)) continue;

      // One paid run per artifact per tick. A human leaving five comments in one
      // review pass is the ordinary shape of a review: it produces five signals,
      // five reductions and five rows — every comment reaches the ledger, which
      // is what the replay invariant needs — but the brief the first one hands
      // over already asks the agent to address everything outstanding, so the
      // other four buy the same work again and land as sequential edits on top of
      // each other. This guard is also what makes the batch one *round*: a round
      // is counted per dispatch, and {@link countReviewRound} is called from
      // inside here. Coalescing suppresses the *run* only, never the record.
      const key = dispatchKey(entity, action, world);
      if (dispatched.has(key)) continue;
      dispatched.add(key);

      // The one action conductor performs itself. Everything downstream of this
      // line is identical either way — the same `DispatchResult`, the same
      // settling signal, the same proof handling — because what changes is who
      // ran the work, not what a result means. See {@link runGoalCheck}.
      const ground = proofGroundFor(entity, world);
      if (MUTATES_WORK[action.kind]) boughtWork = true;
      const result =
        action.kind === "runGoalCheck"
          ? await runGoalCheck(context, entity, ground)
          : await runDispatch(context, entity, action, summary);

      // **After the dispatch, and only for one that settled.** A round is a
      // handled feedback pass, and a harness that never ran handled nothing: a
      // dispatch that failed read no comment, wrote no code, and changed nothing
      // about the work. Counting it ahead of the run — which is where this used
      // to be — charged the pass to whatever broke the *runner*: an uninstalled
      // SDK, a workspace that could not be cut, a credential that never reached
      // the agent process. The ledger then asserts a pass that never happened,
      // and the cost is not bookkeeping: the budget is the loop detector that
      // parks a stuck review, so a round spent by a non-event is a round the
      // recovery does not get once the runner is fixed.
      //
      // A dispatch that *completed* and pushed nothing still counts — that is an
      // attempt that changed nothing, not an attempt that never happened, and it
      // is the distinction {@link countReviewRound} is written around.
      if (
        result.outcome === "completed" &&
        (action.kind === "reviseSpec" || action.kind === "addressFeedback")
      ) {
        await countReviewRound(context, entity, world);
      }

      queue.unshift({
        signal: {
          kind: result.outcome === "completed" ? "dispatch_completed" : "dispatch_failed",
          entityId: context.entityId,
          at: signal.at,
          dispatchId: result.dispatchId,
        },
        derived: true,
      });

      // The one thing a dispatch reports that conductor has to store rather than
      // re-read: no source has an opinion on whether the change did what the
      // issue asked. Persisted first, so the proof survives the process; then
      // folded into the snapshot and announced as a signal, which is what
      // actually moves the gate.
      //
      // The head handed over is the one this tick observed, which the dispatch
      // may already have moved past — `claimedGoalCheck` is where that is sorted
      // out, and it is why a fresh verdict is sometimes recorded with no
      // revision at all.
      //
      // Folded unconditionally. A pass reported before the phase's submission is
      // in the snapshot used to be held back here, because `IMPLEMENTATION`
      // completed on an absent PR — that is a phase-completion rule and it lives
      // in the phase table now, where the artifact it turns on is required
      // positively. A verdict this tick cannot act on is one the phase table
      // declines, not one this tick withholds.
      const claim = claimedGoalCheck(
        action,
        result,
        activeHead(entity, world),
        // A coding dispatch runs on the phase's branch whatever the submission's
        // state, so only a check conductor provisioned itself can be a base
        // proof. `proofGroundFor` is the provisioning decision, reused.
        action.kind === "runGoalCheck" ? ground : "branch",
      );
      if (claim !== undefined) {
        await persistGoalCheck(context, claim);
        // All three, or the snapshot the rest of this tick reduces against holds
        // a verdict under the previous claim — a base proof read as a branch one
        // is a proof the gates decline, and the issue sits one step from SETTLED
        // with nothing left to move it.
        world = {
          ...world,
          goalCheck: claim.verdict,
          goalCheckSha: claim.sha,
          goalCheckGround: claim.ground,
        };
        if (claim.verdict !== null) {
          queue.unshift({
            signal: {
              kind: claim.verdict === "passed" ? "goal_check_passed" : "goal_check_failed",
              entityId: context.entityId,
              at: signal.at,
            },
            derived: true,
          });
        }
      }
    }
  }

  if (newestSignalAt !== null) await persistEntity(context, entity.phase, newestSignalAt);

  // Last, deliberately: a cursor records what has been reduced over, and until
  // the loop above finished, nothing had been. See the header for the failure
  // this ordering chooses and the one it refuses.
  await persistCursor(context, observation.cursor, at);

  ledger = await readLedger(context);
  return {
    entity,
    gate: deriveGate(entity, world),
    ledger,
    dispatchCount: await countDispatches(context),
  };
}

/**
 * A fresh session id.
 *
 * Minted rather than derived, matching `SessionRecord.lineageId`: an address
 * computed from an issue key is one two ticks can compute their way to
 * different answers about, and a value written once and read back is not.
 */
export function mintSessionId(): string {
  return `conductor-${randomUUID()}`;
}
