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
 *   re-derived from the ledger until a row proves it was reduced against this
 *   phase, and never after. See {@link entrySeeded} for why "the ledger is
 *   nonempty" is not that proof.
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
  type EntityKind,
  type Gate,
  type Phase,
} from "../model/phases";
import type { Signal } from "../model/signals";
import {
  artifactOfKind,
  type ArtifactFacts,
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
  /** True for a signal the tick derived — a phase entry, a dispatch settling. */
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

/**
 * Has the entity's **current** phase already had its entry reduced?
 *
 * Entry is what dispatches a phase's opening work, and the tick that enters a
 * phase drains it in the same pass — so the record that it ran is the row that
 * entry produced: a `phase_entered` signal reduced *against the phase being
 * entered*. A row carrying both is proof for that phase and for no other, which
 * is the whole correction. An empty ledger is only the first instance of "the
 * current phase has not been entered"; a nonempty one says nothing about it, and
 * reading it as proof strands an entity that advanced a phase durably and died
 * before the entry it had queued — in IMPLEMENTATION with no PR, no dispatch,
 * and no signal an artifact-free world could ever produce to start one.
 *
 * Matching on the phase *name* is enough because neither phase table cycles: a
 * phase is entered at most once per entity, so there is no earlier visit's row
 * to mistake for this one's.
 *
 * A phase whose entry reduces to no action at all (`ISSUES` waits on its
 * children) leaves no row and is therefore re-seeded on every tick. That is
 * deliberate and free — re-reducing an entry that produced nothing appends zero
 * rows and dispatches nothing — and the alternative, reading "no row" as
 * "already done", is the bug this predicate exists to close.
 */
function entrySeeded(ledger: readonly LedgerEntryState[], phase: Phase): boolean {
  return ledger.some(
    (row) => row.signalKind === "phase_entered" && row.phaseBefore === phase,
  );
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

/** How many phase executions this entity has had, ever. */
export async function countDispatches(context: TickContext): Promise<number> {
  const rows = await context.collections.dispatches.list();
  return rows.filter((row) => row.entityId === context.entityId).length;
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

  const observation = await context.deps.observer.observe({
    entity: { kind: entity.kind, phase: entity.phase },
    entityId: context.entityId,
    artifacts: await readArtifacts(context),
    childIssues: await readChildIssues(context),
    guidancePaths: context.deps.config.guidance,
    policy: context.deps.config.policy,
    cursor: await readCursor(context),
    now: at,
  });
  const world = observation.world;

  const queue: Queued[] = [];

  // A phase whose entry has not been reduced has never been *entered*, whatever
  // its row says it advanced into. Entry is what dispatches a phase's opening
  // work, so without this a fresh item sits still forever and a restart taken
  // mid-transition loses that phase's opening work permanently. Derived from the
  // ledger rather than stored on the entity, which is what makes it restart-safe
  // in both directions — see {@link entrySeeded}. The property is exact: a
  // phase's entry work runs once, and runs at least once.
  if (!entrySeeded(ledger, entity.phase)) {
    queue.push({
      signal: { kind: "phase_entered", entityId: context.entityId, at },
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
