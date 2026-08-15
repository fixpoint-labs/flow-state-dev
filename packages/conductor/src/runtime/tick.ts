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
 *   `dispatch_failed` has {@link unreducedFailures}. One rule, one instance per
 *   derived signal — not one predicate stretched across both.
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

import { isDispatch, type Action, type DispatchAction } from "../model/actions";
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
  type ArtifactFacts,
  type ArtifactKind,
  type ChildIssueFacts,
  type World,
} from "../model/world";
import type { EpicState, IssueState, LedgerEntryState } from "../model/entities";
import { decide } from "../driver/decide";
import { deriveGate, type ConductorEntity } from "../driver/derive-gate";
import { branchNameFor, provisionWorkspace } from "../dispatch/branch";
import { briefFor } from "../dispatch/brief";
import type { DispatchResult, PhaseBrief } from "../dispatch/types";
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
 * The stored goal verdict for this entity.
 *
 * An epic has none: the goal check proves that *a change did what an issue
 * asked*, and an epic's own phases gate on its children rather than on a proof
 * of their own. `null` is what the epic branch of the phase table already reads.
 */
async function readGoalCheck(context: TickContext): Promise<GoalCheckVerdict> {
  if (context.entityKind === "epic") return null;
  return (await context.collections.issues.read(context.entityId))?.goalCheck ?? null;
}

/**
 * Write the goal verdict a dispatch reported.
 *
 * The only writer of the field, and the counterpart to {@link readGoalCheck}:
 * conductor owns the verdict, so if it is not written down here it does not
 * exist anywhere. It is written *before* it is read back into a world, which is
 * what makes the value survive the restart the whole tick is built around — a
 * verdict held only in this tick's snapshot would be lost with the process.
 */
async function persistGoalCheck(
  context: TickContext,
  verdict: GoalCheckVerdict,
): Promise<void> {
  if (context.entityKind === "epic") return;
  const stored = await context.collections.issues.read(context.entityId);
  if (!stored) return;
  await context.collections.issues.write(context.entityId, { ...stored, goalCheck: verdict });
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
 * budget is spent against, so nothing else can maintain it. A round is counted
 * once per head: several pieces of feedback on the same commit are one round,
 * and a push starts the next one, which is what `lastRoundSha` records.
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
  if (!head || head === artifact.lastRoundSha) return;

  await context.collections.artifacts.write(artifact.id, {
    ...artifact,
    reviewRounds: artifact.reviewRounds + 1,
    lastRoundSha: head,
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

/**
 * Can a dispatch of this kind leave the entity's code different from the code a
 * stored goal verdict was taken against?
 *
 * **The one place that question is answered, and it is answered for every kind
 * rather than for the few that bite today.** `awaiting_merge` refuses to apply
 * until the verdict is `"passed"`, so a verdict that outlives its code is
 * conductor inviting a human to merge a change it never proved — while its
 * ledger says it did. The rule was previously a single `if` naming
 * `addressFeedback`, which left `resolveConflict`, `rebaseOnBase` and
 * `reExamineOpenPrs` — three dispatches that commit different code — silently on
 * the "keeps the proof" side.
 *
 * A `Record` keyed on the action union rather than a list, because the failure
 * this keeps having is *an action nobody thought about*, not an action somebody
 * classified wrongly: adding a kind to {@link DispatchAction} is a **type
 * error** until its author answers this question here. The alternative
 * considered was inverting the default — clear unless the kind is on a
 * known-harmless list — which fails safe and *silently*, and silence is the
 * whole defect. It would make a new mutating action correct by accident and a
 * new inert one quietly throw away a valid proof, and neither makes anyone look
 * at this table. Failing loudly at compile time is the stronger of the two in
 * the direction that costs a false merge, and it also catches the other
 * direction, which failing safe cannot.
 *
 * `true` for every kind that can put a commit on a branch, including the ones
 * that cannot be holding a verdict when they run: `draftSpec`/`reviseSpec` run
 * in `SPEC`, before an issue has one, and `retrospect`/`polishDocs` belong to an
 * epic, which has no verdict at all (see {@link readGoalCheck}). Classifying
 * them by what they *do* rather than by where they happen to sit keeps this
 * readable as one rule, and costs a write of `null` over `null`.
 *
 * `false` is for the two that change nothing. `answerQuestion` replies to a
 * human and its brief says in as many words not to touch the work;
 * `runGoalCheck` measures rather than edits.
 *
 * **This is not the whole rule** — a dispatch that reports its own verdict has
 * re-proved whatever it just wrote, and that fresh proof wins over the clear.
 * See {@link claimedGoalCheck}, which is where the two combine.
 */
const INVALIDATES_GOAL_CHECK: Record<DispatchAction["kind"], boolean> = {
  draftSpec: true,
  reviseSpec: true,
  answerQuestion: false,
  implement: true,
  addressFeedback: true,
  resolveConflict: true,
  rebaseOnBase: true,
  runGoalCheck: false,
  retrospect: true,
  polishDocs: true,
  reExamineOpenPrs: true,
};

/**
 * What a settled dispatch leaves the stored goal verdict at, or `undefined` when
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
 * - **A dispatch that could have changed the code and reported nothing clears
 *   it.** See {@link INVALIDATES_GOAL_CHECK} for the enumeration and for why it
 *   is a total map rather than a list.
 *
 * Everything else returns whatever the dispatcher reported, which is almost
 * always nothing — and for a dispatch that changed nothing, nothing means **no
 * claim**, not a failure. A vendor that is silent has not said the goal is
 * unmet, so the stored verdict stands.
 */
function claimedGoalCheck(
  action: DispatchAction,
  result: DispatchResult,
): GoalCheckVerdict | undefined {
  if (INVALIDATES_GOAL_CHECK[action.kind]) return result.goalCheck ?? null;
  return result.goalCheck;
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
 * The branch a dispatch's workspace and brief are pointed at.
 *
 * {@link branchNameFor} answers this from the *phase*, which is right for every
 * action that produces work and wrong for the one that grades it.
 * `runGoalCheck` is dispatched from `awaiting_goal_check`, a gate that applies
 * only once the PR has **merged**, and the entity is still in `IMPLEMENTATION`
 * while it runs — so the phase answers `fix/<id>`: the feature branch, which
 * still exists and still passes, and which is not what landed whenever the merge
 * squashed, resolved a conflict, or the base moved on in between. A proof taken
 * there is a proof of code that never reached the base, and it settles the issue
 * on it. The proof has to be taken against what a reader of the base branch
 * would actually get.
 *
 * **How a base revision is named with today's branch policy, and what that
 * assumes.** `dispatch/branch` has two plans and no third: re-entry checks out a
 * branch the remote already has, and creation cuts one the remote does *not*
 * have from `<remote>/<base>` — resetting it there every time, which is exactly
 * the semantics a goal check wants. So a branch conductor never pushes is how
 * this file says "the base, at the revision on it now". The assumptions are
 * stated rather than buried: the base is `ConductorConfig.baseBranch`, the
 * remote's copy of it is authoritative, and `goal-check/<id>` stays absent from
 * the remote. Naming `baseBranch` itself instead would provision `checkout -B
 * <base> <remote>/<base>`, which occupies the shared base ref in a worktree —
 * the one thing that module's policy exists to prevent — and resets a
 * developer's local base under `cwd`. Passing `null` is worse than either: it
 * skips the branch plan, so a worktree left on `fix/<id>` by an earlier dispatch
 * is reused as-is, and the false proof comes back with nothing recording it.
 *
 * **The honest home for this is `dispatch/branch`**, as a third plan that
 * provisions *detached* at `<remote>/<base>` (`fetch <remote> <base>` then
 * `checkout --detach <remote>/<base>`). That needs no branch name at all and
 * cannot go stale if somebody pushes one. Until it exists, this keeps the goal
 * check off the superseded branch.
 */
function workspaceBranchFor(
  entity: ConductorEntity,
  action: DispatchAction,
): string | null {
  return action.kind === "runGoalCheck"
    ? `goal-check/${entity.id}`
    : branchNameFor(entity);
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
  const branch = workspaceBranchFor(entity, action);

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
  const observation = await context.deps.observer.observe({
    entity: { kind: entity.kind, phase: entity.phase },
    entityId: context.entityId,
    artifacts: await readArtifacts(context),
    // Conductor-owned, and the reader has no other source for it — a request
    // that omits it hands every gate `null`, which reads as "the goal check has
    // never run" and holds `awaiting_merge` shut however many times it passed.
    goalCheck: await readGoalCheck(context),
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

  const observation = await context.deps.observer.observe({
    entity: { kind: entity.kind, phase: entity.phase },
    entityId: context.entityId,
    artifacts: await readArtifacts(context),
    // See `observeWorld` for why an omission here is silent and total.
    goalCheck: await readGoalCheck(context),
    childIssues: await readChildIssues(context),
    guidancePaths: context.deps.config.guidance,
    policy: context.deps.config.policy,
    cursor: await readCursor(context),
    now: at,
  });
  // `let`, for one fact and one only: a goal verdict a dispatch reports partway
  // through this tick is conductor's own, not the source's, so the reductions
  // after it read a snapshot that carries it. Nothing else here rebinds the
  // world — an observed fact that moved mid-tick is the *next* tick's read.
  let world = observation.world;

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

  while (queue.length > 0) {
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
      // each other. `countReviewRound` already counts the batch as one round;
      // this is the dispatcher agreeing with the round accounting. Coalescing
      // suppresses the *run* only, never the record.
      const key = dispatchKey(entity, action, world);
      if (dispatched.has(key)) continue;
      dispatched.add(key);

      if (action.kind === "reviseSpec" || action.kind === "addressFeedback") {
        await countReviewRound(context, entity, world);
      }

      const result = await runDispatch(context, entity, action, summary);
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
      // issue asked. Persisted first, so the verdict survives the process; then
      // folded into the snapshot and announced as a signal, which is what
      // actually moves the gate.
      //
      // Folded unconditionally. A pass reported before the phase's submission is
      // in the snapshot used to be held back here, because `IMPLEMENTATION`
      // completed on an absent PR — that is a phase-completion rule and it lives
      // in the phase table now, where the artifact it turns on is required
      // positively. A verdict this tick cannot act on is one the phase table
      // declines, not one this tick withholds.
      const claim = claimedGoalCheck(action, result);
      if (claim !== undefined) {
        await persistGoalCheck(context, claim);
        world = { ...world, goalCheck: claim };
        if (claim !== null) {
          queue.unshift({
            signal: {
              kind: claim === "passed" ? "goal_check_passed" : "goal_check_failed",
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
