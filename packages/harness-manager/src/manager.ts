/**
 * The manager — a task row becomes a watched, settled coding run.
 *
 * One dispatched worker on a conductor board:
 *
 *   open the run row → build the prompt & take the checkout → run the harness
 *   → read the verdict → settle or fail
 *
 * Two things make the supervision real. The checkout is the run's OWN, rather
 * than whatever directory the server happens to sit in. And **one step decides
 * the verdict**, before the row is settled, so a run that produced nothing can
 * never close as done.
 *
 * ## The phase surface is options, not a record type
 *
 * A manager is constructed with a prompt builder, a done-condition re-evaluated
 * on each wake, and the collections the phase may read. Three values. A record
 * type, a registry, or a second phase module would be abstraction for a set of
 * one; when the spec and review phases arrive there will be a second shape to
 * generalise from.
 *
 * ## Where the throws go
 *
 * `decide` is the only place that DECIDES, and the chain-level rescue is the
 * only place that RECORDS a failure. Everything that can fail before the
 * verdict — a deleted branch, a wedged checkout, a prompt that cannot be
 * built, a mid-stream throw out of the SDK — arrives at the same handler, is
 * written to the row, and is re-thrown so the board's own fenced failure
 * recorder still routes it (back to `pending` with the reason as `feedback`,
 * or to `errored` once the retry budget is spent). Conductor adds no settlement
 * path of its own.
 */
import { existsSync } from "node:fs";
import {
  OBSERVED_PULL_REQUESTS,
  SuspensionTimeoutError,
  defineCapability,
  handler,
  observedPullRequestsCollection,
  sequencer,
  type DefinedCapability,
  type PresetDef,
  type UsesSlot,
} from "@flow-state-dev/core";
import type { HarnessRunOutcome } from "@flow-state-dev/core/types";
import { withTimeout } from "@flow-state-dev/core/helpers";
import type {
  BlockContext,
  BlockDefinition,
  DeclaredResourceEntry,
  HarnessActivityHook,
  HarnessBlock,
  HarnessResolver,
  HarnessSessionHook,
  HarnessSteer,
  HarnessSteerHook,
  HarnessUsageHook,
} from "@flow-state-dev/core/types";
import { renderSteers, showTakenSteers, STEERED_WHILE_RUNNING } from "@flow-state-dev/orchestration";
import { TaskEndsForGoodError, currentWorkerClaim, taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  answerOf,
  getOrCreateTaskCollection,
  hasFrozenLedgerAssignee,
  isRowQuestion,
  MAX_STEERS,
  readCommittedTask,
  resolveResourceCollection,
  shownSteer,
  steersTakenIn,
  taskClaimTicketSchema,
  ticketForClaim,
  untakenSteers,
  type DefinedTaskCollection,
  type ShownSteer,
  type Task,
  type TaskClaimTicket,
  type TaskCollectionRef,
  type TaskSteer,
  type TaskWorker,
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import {
  CHECKOUT_CLEANUP_TIMEOUT_MS,
  GIT_TIMEOUT_MS,
  HeldWorkMismatchError,
  WorkspaceRefusedError,
  recordBranchPullRequests,
  type HeldWork,
  type RecordedPlace,
  type RunSourceAnswer,
  type WorkspaceHost,
  type WorkspacePlace,
} from "@flow-state-dev/workspace";
import { NETWORK_CALL_TIMEOUT_MS } from "./timeouts";
import { MAX_TIMER_MS } from "./guards";
import {
  RUNS,
  assertPlaceAndHeld,
  heldSchema,
  placeStateSchema,
  openRunRow,
  readConfirmedSession,
  readRunRow,
  runRecordCollection,
  runTopic,
  writeRunRow,
  type AttemptIdentity,
  type HeldRecord,
  type PlaceState,
  type RunRowWrite,
} from "./run-record";
import {
  failedHeldRecord,
  heldPromptSection,
  heldRecordOf,
  mismatchQuestion,
  recordedHoldOf,
  withHoldRetries,
} from "./held";
import { askMarkerPath, readAskMarker } from "./ask";
import { HeldOnQuestion, askStep } from "./ask-step";
import { HARNESS_USAGE, harnessUsageCollection, recordHarnessUsage } from "./harness-usage";
import { readRunCommits, type RunCommits } from "./commits";
import { progressNoteOf, throttledNotes, type ProgressNotes } from "./progress-note";
import {
  HARNESS_RUN_OWNER_KEY,
  foreignRunMessage,
  isRunOwner,
  runOwnerFor,
  runOwnerOf,
  runPrincipal,
  type RequestIdentityContext,
} from "./run-owner";

export type { RequestIdentityContext } from "./run-owner";
import {
  assertDerivedIdentity,
  harnessTaskId,
  sameSegment,
  ASK_MARKER_IGNORED,
  acquireCheckout,
  branchFor,
  locationFor,
  hostForConfig,
  placeFor,
  releaseCheckout,
  runBoardSegment,
  taskIssueSegment,
  type RunLocation,
  type RunPrincipal,
  type OwnershipBounds,
  type WorkspaceConfig,
} from "./workspace";

/** What a phase's prompt builder and done-condition are handed. */
export interface PhaseRunContext {
  /**
   * The board's discriminator — see `RunLocation.epic`. A fixed board's id, or
   * for a board read from the claim, its ledger id and partition digest
   * (`runBoardSegment`).
   */
  epic: string;
  issue: string;
  phase: string;
  /** Which attempt this is, as the board counted it. */
  attempt: number;
  /** The run's own checkout. */
  workspacePath: string;
  branch: string;
  /**
   * Whatever this phase's own {@link PhaseSpec.validate} returned, for THIS
   * conductor.
   *
   * `unknown` because only the phase that produced it knows its shape — the
   * manager carries it and never reads it. Absent when the phase has no
   * `validate`, or when one is invoked outside `conductorFlow`.
   */
  validated?: unknown;
  /**
   * Why the LAST attempt stopped, as the board captured it when `fail()`
   * re-pended the row. This — not the run record — is the carry-forward:
   * without it a deterministic failure replays and the retry budget burns for
   * nothing.
   */
  feedback?: string;
  /** The block context, so a builder can read its phase's collections. */
  ctx: BlockContext;
}

/** One answered question, as the prompt fold receives it. */
export interface AnsweredQuestion {
  /** What was asked: the run's own words, or the question the task was filed with. */
  question: string;
  /** What the person answered. */
  answer: string;
}

/**
 * What a prompt builder gets on top of {@link PhaseRunContext}: the task it was
 * claimed for, and the two things the ask adds.
 *
 * Separate from `PhaseRunContext` rather than optional fields on it. The
 * done-condition needs none of them, and a field that is sometimes absent is the
 * silent-partial shape this lab exists to remove — a builder cannot tell "no
 * answers" from "nobody read them" if the same `undefined` means both.
 */
export interface PromptRunContext extends PhaseRunContext {
  /**
   * The task this attempt was claimed for, as the board packed it: its `goal`,
   * and its `title`, `context`, `input`, `deps` and `priorWork` when the row has
   * them. A field the row lacks is an absent key, never `undefined`.
   *
   * The same on every attempt, so a retry or the attempt after a person's
   * message starts from the same work. Build the prompt from this rather than
   * from {@link PhaseRunContext.issue}, which is only the row's identity.
   * `metadata` is left out: it is the board's bookkeeping, not the brief.
   *
   * A `Pick` of the board's worker-input schema, so its fields keep the
   * board's names and there is no second field list to drift.
   */
  task: Pick<
    z.infer<typeof taskWorkerInputSchema>,
    "goal" | "title" | "context" | "input" | "deps" | "priorWork"
  >;
  /**
   * The task's answered questions, read from its row, oldest first: the
   * questions it was filed with and the ones its runs asked, each paired with
   * the person's answer. A question closed at a deadline with no answer is not
   * here; its "no answer came" message reaches the run with the task's other
   * messages. Read the same on a replay, and correct whether the coding
   * session resumed or started cold.
   */
  answers: readonly AnsweredQuestion[];
  /** Where THIS run must write a question if it has one: a new path for every run. */
  askMarkerPath: string;
}

/**
 * What a done-condition gets on top of {@link PhaseRunContext}: the one thing
 * the run's own report adds.
 *
 * Separate from `PhaseRunContext` for the same reason {@link PromptRunContext}
 * is — a prompt builder has no use for it, and the two sides carry facts about
 * different attempts. `feedback` describes the attempt BEFORE this one and is
 * prompt-side only; `stopReport` describes THIS one and is completion-side
 * only. A single field meaning "this attempt" in one place and "the last one"
 * in another lies by position.
 */
export interface CompletionRunContext extends PhaseRunContext {
  /**
   * How the run said it stopped, as it said it — the run's own three-way word
   * (`finished` / `stopped-at-limit` / `failed`), reached only on a clean
   * verdict.
   *
   * **Not the run record's `outcome`**, which is this manager's own
   * bookkeeping (`running` / `succeeded` / `failed`) and is never what a
   * phase reads. Two fields, two enums; the names are kept apart on purpose.
   *
   * **The word crosses as reported**, which is why `string` widens
   * {@link HarnessRunOutcome} here rather than the closed union being reused.
   *
   * A *conforming* harness can only report the three words:
   * `harnessRunHandleSchema` is a `z.enum`, so the union is the whole
   * vocabulary the contract offers. But this manager does not read a handle
   * through that schema — `decide` declares `outcome: z.string().nullable()`,
   * deliberately loose, so a harness that reports something else is seen
   * rather than rejected at the door. This type says what can actually arrive
   * at this seam. Narrowing it would not make the value narrower; it would
   * only stop a phase being able to notice, which is the silent partial
   * success this field exists to prevent, one layer down. `null` means no
   * terminal result was reported at all — a distinct fact from `"finished"`,
   * and a check that cannot tell them apart is the sometimes-absent shape
   * this contract already refuses.
   *
   * **No settlement decision is made on it here.** The manager's one read of
   * the same value is arm 3's failure text, chosen after the arm already was.
   * What "done" means is the phase's call, and a phase that ignores this
   * field settles exactly as one written before the field existed —
   * including on a run that committed half the job and ran out of road.
   */
  stopReport: HarnessRunOutcome | (string & {}) | null;
  /**
   * The run's final message, as it reported it; `null` when it reported
   * none. A phase whose work is an answer rather than a change reads it: a
   * run that ended with nothing to say has not answered.
   */
  answer: string | null;
}

/** Everything that makes one phase a phase. Three values, passed in. */
export interface PhaseSpec {
  /** The phase segment of the run record's topic. */
  phase: string;
  /** Rebuilt on every wake from current state, never computed when the row was filed. */
  buildPrompt(run: PromptRunContext): string | Promise<string>;
  /**
   * Has the job actually been done? Re-evaluated now, and consulted ONLY after
   * a successful verdict — never as an alternative route to completion.
   *
   * **The carry-forward field is prompt-time only: `feedback` is absent here,
   * deliberately and always.** It describes the attempt BEFORE this one, which
   * is what a prompt needs and what a done-condition has no use for — the
   * question is whether the job is done now, not how the last attempt went. It
   * is also not reachable at this point: it arrives on the worker's input, and
   * the verdict handler is handed the run's own result instead. A phase whose
   * done-condition genuinely needs it wants it put on the manager's state
   * first; do that when such a phase exists rather than plumbing a field
   * nothing reads.
   *
   * **What it DOES get is {@link CompletionRunContext.stopReport}: how this
   * run said it stopped.** A clean end and a finished job are not the same
   * predicate, and a run that exhausted its turn or spend budget is where they
   * most reliably diverge — it commits the half it managed and reports
   * `stopped-at-limit`. A check that answers from the branch alone closes that
   * row as done, silently. Reading the field is the phase's call, and
   * declining to is a real choice with a real cost; the framework imposes
   * nothing, because only the phase knows what finishing means for it.
   */
  isDone(run: CompletionRunContext): boolean | Promise<boolean>;
  /**
   * What this phase needs from the workspace, checked before anything is
   * claimed. Throws to refuse; absent means the phase needs nothing.
   *
   * **A phase's own preconditions are configuration, and configuration is
   * refused at startup.** The other guards at that door — the repository, the
   * base ref, the numbers — protect a *task* from paying for a shell typo: the
   * row is claimed, the attempt is charged, and the failure is permanent, so
   * every retry spends itself on it. A precondition belonging to the phase has
   * exactly that shape and could not use that door, because only the phase knows
   * what it needs and only the flow holds the workspace.
   *
   * The implement phase's completion probe reads the source repository's
   * `origin`; a checkout whose GitHub remote is called something else fails it
   * AFTER the paid agent run, once per retry. That is the case this exists for,
   * and it is why the hook takes the workspace rather than being a boolean.
   *
   * **Whatever it returns is handed back to this phase's own `isDone` as
   * {@link PhaseRunContext.validated}, once per conductor.** That is the only
   * way a phase can carry something it learned at construction into a run:
   * closing over it does not work, because one `PhaseSpec` can be given to two
   * conductors and `conductorFlow`'s snapshot copies function references rather
   * than what they close over. Three separate defects came out of a phase that
   * tried — a pin shared between conductors, a pin retained by a construction
   * that then failed, and a comparison written to paper over both.
   */
  validate?(workspace: WorkspaceConfig | WorkspaceHost): unknown;
}

/**
 * Finds a board by the ledger id and partition a task's claim names, or
 * answers `undefined` for a board this manager may not read. Typed as
 * orchestration's `taskLedgers` resolver, so one function can serve both.
 *
 * Resolve against `ctx`, at the running user's scope, never from a
 * process-wide map: the ledger id and partition arrive on the manager's input,
 * and the row the returned ref holds is what the attempt fence then checks.
 */
export type HarnessLedgers = (
  ledgerId: string,
  ctx: BlockContext,
  partition: string | undefined,
) => Promise<TaskCollectionRef | undefined>;

/** What a {@link HarnessJudge}'s block is handed: the task, the run's answer, and its commits. */
export const harnessJudgeInputSchema = z.object({
  /** The task's goal, as filed. */
  goal: z.string(),
  /** The run's final message, as its output carries it. */
  answer: z.string().nullable(),
  /** The commits the run made: how many, and their subjects, newest first (at most 20). */
  commits: z.object({ count: z.number().int().nonnegative(), subjects: z.array(z.string()) }),
});
export type HarnessJudgeInput = z.infer<typeof harnessJudgeInputSchema>;

/**
 * What a {@link HarnessJudge}'s block answers. `done` closes the task;
 * `not-done` fails the attempt with `reason` as the next attempt's feedback;
 * `ask` holds the task on `reason` as a question. A `not-done` or `ask`
 * under the judge's floor counts as `done`.
 */
export const harnessJudgeVerdictSchema = z.object({
  verdict: z.enum(["done", "not-done", "ask"]),
  /** How sure the judge is, from 0 to 1. Read against {@link HarnessJudge.floor}. */
  confidence: z.number(),
  /** Why: the next attempt's feedback on `not-done`, the question on `ask`. */
  reason: z.string(),
});
export type HarnessJudgeVerdict = z.infer<typeof harnessJudgeVerdictSchema>;

/**
 * The verdict as the manager reads it: a confidence outside 0 to 1 is not a
 * verdict. Kept off the exported schema, which a host may hand its evaluator
 * as an output schema, where a bound is one more keyword a provider can refuse.
 */
const judgeVerdictReadSchema = harnessJudgeVerdictSchema.extend({ confidence: z.number().min(0).max(1) });

/**
 * A second reading of a run that passed the phase's own check, on a board
 * read from the claim: did the answer meet the task's goal?
 *
 * The block is the host's, typically an evaluator; the manager names no
 * model. It runs after `isDone` passes, for a row with a goal, and its
 * output is read through {@link harnessJudgeVerdictSchema}. A judge that
 * throws, times out or answers something else is not a verdict: the task
 * settles on the phase's check alone, with `judged: false` in the output.
 */
export interface HarnessJudge {
  block: BlockDefinition<any, any, HarnessJudgeInput, unknown>;
  /** The confidence a `not-done` or `ask` must reach to count. Below it, the run is done. */
  floor: number;
}

/** How the manager is wired to its board and its host. */
export interface ManagerOptions {
  /**
   * The board's ledger collection id — the fence reads the live claim from it,
   * and every run's checkout folder, branch and run record are derived from it.
   *
   * Used as is: a dotted board id (`eng.feature.work`) is accepted with its
   * dots. Checked when the manager is built, so an id a git branch cannot carry
   * (a `.lock` ending, a doubled or trailing dot, a separator) is refused here
   * rather than after a row has been claimed.
   *
   * Give it with {@link boardCollection}, or give {@link ledgers}, or both.
   */
  boardCollectionId?: string;
  /**
   * The board's ledger declaration.
   *
   * Two things read it: the attempt fence, which resolves it as a plain
   * resource collection to read the live claim, and the ask step, which
   * resolves it as a `TaskCollectionRef` so a question holds the task through
   * the board's own write.
   */
  boardCollection?: DefinedTaskCollection;
  /**
   * Read each run's board from its claim instead of from one fixed board.
   *
   * A worker that takes tasks from many boards (each conversation keeps its
   * own) has no single board to name. With this, the manager reads the ledger
   * id and partition from the claim the entry adapter hands it on its input
   * (`claim`, next to the task's fields) and resolves the board through this
   * function. It never trusts that claim by itself: every read and write goes
   * through the attempt fence against the row at that ledger and partition.
   *
   * A task whose claim names {@link boardCollectionId} with no partition is
   * that fixed board's row and runs exactly as it does without this option.
   * On every other board, two things differ: a refused run fails the row for
   * good instead of cancelling it, and the {@link judge} may read the answer.
   * A question holds its task the same way on both.
   *
   * Called on every fenced read and write, not once per run: a fence must read
   * the row fresh. Keep it cheap.
   */
  ledgers?: HarnessLedgers;
  /**
   * Read a run that passed the phase's check once more, against its task's
   * goal, before the row closes (see {@link HarnessJudge}). Only on a board
   * read from the claim: a fixed board's rows never reach it. Size a host's
   * shutdown with `harnessDrainBudgetMs({ ..., judge: true })` when given.
   */
  judge?: HarnessJudge;
  /**
   * Hold a run that ends with commits on its branch for a person's review
   * before its task completes (FIX-2163). Off by default: every run settles
   * on its verdict, as without it.
   *
   * On, a run the phase's check passed (and the {@link judge}, when one read
   * it, found done or was under its floor) that has commits over its base
   * waits through `ctx.waitForUser({ kind: "review" })`, its prompt naming the
   * commits and the judge's verdict as information. The answer is
   * `{ verdict: "accepted" }`, which completes the task with no further
   * harness run, or `{ verdict: "revise", words }`, whose words become the
   * user's steer: the run goes on in the same coding session on the same
   * attempt, and comes back for review. At the host's deadline for a user's
   * stop the task completes with `review: "deadline"` on its output, never
   * read as accepted. A run with no commits, or one that failed, is not
   * reviewed. Needs durable execution: a host without it is refused when the
   * request starts, before any harness run.
   */
  reviewChanges?: boolean;
  /**
   * The tenant this conductor serves — the same value that partitions the
   * board's collection identity. Every request must resolve to it.
   */
  tenant: string | undefined;
  phase: PhaseSpec;
  /**
   * Where each run's files come from, and where it works.
   *
   * `{ root, sourceRepo, baseRef }` cuts every run a new branch of
   * `sourceRepo`, kept in that repository, with the checkout under `root`.
   * A workspace host (`localWorkspaceHost` from `@flow-state-dev/workspace`)
   * answers per run from its run source instead: a branch of an allowed
   * remote with kept files beside it, or kept files alone. Both go through
   * one provisioning path; the first is a host whose source is constant.
   */
  workspace: WorkspaceConfig | WorkspaceHost;
  /** Wall-clock budget for the harness run itself. */
  runTimeoutMs: number;
  /**
   * How checkout contention is bounded. Defaults derive from the longest a live
   * attempt can hold the lock — the run's deadline plus the provisioning budget,
   * not the deadline alone.
   */
  ownership?: Partial<OwnershipBounds>;
  /**
   * **The slot.** How this manager is pointed at a coding harness.
   *
   * Called ONCE, at construction, with the feeds the harness contract
   * declares — and the harness package closes over the ones it takes. That is the whole
   * coupling: this package imports no harness, names no vendor, and a second
   * harness needs no edit here.
   *
   * ```ts
   * harness: ({ cwd, resume, onSession, onUsage, onSteerable }) =>
   *   cursorAgent({ cwd, resume, onSession, onUsage, onSteerable }),
   * ```
   *
   * **What the host writes inside the factory is the host's**, deliberately.
   * `detached: true` is not decoration there: the harness becomes a child block
   * of the flow's gated task entry, and the claim gate refuses an entry that
   * authors session state anywhere beneath it. A non-detached harness therefore
   * fails at `defineFlow`, naming the entry — at startup, where a host can act
   * on it, rather than mid-run.
   *
   * **A factory rather than a block**, because the feeds are per-manager: they
   * read and write THIS manager's own run state, and a block built before the
   * manager exists cannot have been given them. Called once rather than per run
   * for the same reason a flow is built once — the feeds resolve per run, the
   * block does not.
   */
  harness: HarnessSlot;
  /**
   * Stop a running step for a steer only when the harness's abort waits for
   * its process to exit (FIX-2086). Otherwise two processes could share one
   * checkout. Off: the steer waits for the step's own end. The row is polled
   * ({@link STEER_POLL_MS}) while a step runs.
   *
   * A run that offers a live steer (`onSteerable`) takes the line into its
   * turn instead, and is never stopped for one it took; the row is polled
   * while it offers one, with or without this.
   */
  stopsOnAbort?: boolean;
  /**
   * Capabilities installed on the blocks whose contexts a phase sees — the same
   * `uses` slot any other block takes.
   *
   * **This replaces a bespoke `PhaseSpec.readable` record**, which was a second
   * way to say what the framework already says. A phase that reads its own
   * collections ships them as a capability and the host puts it here; the
   * manager spreads it onto the blocks a phase's hooks run inside (the prompt
   * builder's and the done-condition's), so `ctx.resources` resolves for them
   * exactly as it does anywhere else.
   *
   * The reserved-accessor guard is unchanged in effect and re-aimed at this:
   * a capability claiming `runs`, the usage record or the board's own accessor
   * is refused at construction with the same message.
   */
  uses?: UsesSlot;
  name?: string;
}

/**
 * The feeds a manager hands its harness, in one call.
 *
 * All of them are **declared in `@flow-state-dev/core`** and imported
 * here rather than restated: what this package picks is the slot that bundles
 * them, not the callbacks' names or their signatures.
 *
 * Why `onSession` and not only `cwd` and `resume`. A harness that throws on the manager's deadline
 * returns no handle at all, and a status item is transient by contract — so
 * neither can carry the session id to the next attempt in exactly the case
 * resume exists for. Unless the harness hands the id to manager-owned durable
 * state the MOMENT the run names it, the resume resolver reads nothing after a
 * deadline kill. `onSession` is that write side.
 */
export interface HarnessFeeds {
  /** Where this run works. Reads the checkout off the manager's own state. */
  cwd: HarnessResolver<string>;
  /**
   * Which session this attempt continues, or `null` to start fresh.
   *
   * `null` on attempt 1, and on every attempt following one whose harness never
   * confirmed a session — a resume the vendor refused, above all — so a dead id
   * is asked for once rather than forever.
   */
  resume: HarnessResolver<string | null>;
  /**
   * Called by the harness the moment its vendor names the session, writing the
   * id onto the run row. **The sole writer of that field.**
   */
  onSession: HarnessSessionHook;
  /**
   * Called by the harness with each subscription usage window its vendor
   * reports during the run, writing it into the run owner's usage record
   * (`harness-usage/**`, through `recordHarnessUsage`). A harness that reports
   * no usage ignores it.
   */
  onUsage: HarnessUsageHook;
  /**
   * Called by a harness whose run can take a line into its turn in flight
   * (FIX-2254), with the steer that does it, and with `null` once it can't.
   * While a run offers one, the manager hands it each steer as it lands
   * instead of stopping the step; a line the run refuses takes the step's
   * end (or the stop, with `stopsOnAbort`). A harness that can't steer
   * ignores it.
   *
   * Optional only so a host that wraps the manager's feeds in a slot of its
   * own keeps compiling; the manager always hands one.
   */
  onSteerable?: HarnessSteerHook;
  /**
   * Called by the harness with each assistant message and tool call of its
   * run (FIX-2290). The manager keeps the task's `statusNote` from it: the
   * first at once, then the latest at most once per `PROGRESS_NOTE_MS`,
   * fenced by the run's claim. A harness that reports none ignores it.
   *
   * Optional only so a host that wraps the manager's feeds in a slot of its
   * own keeps compiling; the manager always hands one.
   */
  onActivity?: HarnessActivityHook;
}

/**
 * The `harness` option: a factory the manager calls once with {@link HarnessFeeds}.
 *
 * Returns a block conforming to the harness contract — `HarnessBlock` is core's
 * alias, and this slot is what makes that alias earn its place.
 */
export type HarnessSlot = (feeds: HarnessFeeds) => HarnessBlock;

/** The typed payload a conductor task carries. Not model-writable — see `./workspace`. */
export const harnessTaskInputSchema = z.object({
  /** The Linear issue this row drives. */
  issue: z.string(),
  /** Which phase of it. */
  phase: z.string(),
});

/**
 * The board a task was claimed on, as the trusted entry adapter hands it to
 * the manager: the gate's verified ticket's ledger id and partition, and its
 * incarnation when the adapter passes it.
 *
 * **Server-supplied, and still never trusted by itself** (BP-031). The adapter
 * copies it from the gate's ticket, never from the task. The manager resolves
 * the board through its `ledgers` resolver at the running user's scope, and
 * then requires the row there to be this task, on this attempt, still running
 * (and of this incarnation, when one is named) before it opens a run, and
 * again on every write. A claim naming another board fails that check.
 */
export const harnessClaimSchema = z.object({
  collectionId: z.string().min(1),
  partition: z.string().min(1).optional(),
  incarnationId: z.string().optional(),
});

/** The manager's input: the board's worker input, plus the claim a board read from the claim names. */
export const harnessManagerInputSchema = taskWorkerInputSchema.extend({
  claim: harnessClaimSchema.optional(),
});

/** A board read from the claim, as the manager records it on its state. */
const stateClaimSchema = z.object({
  collectionId: z.string(),
  partition: z.string().nullable(),
  incarnationId: z.string().nullable(),
});
type StateClaim = z.infer<typeof stateClaimSchema>;

/** The most of a run's final message its output carries. */
export const MAX_ANSWER_CHARS = 8_000;

/** The manager's own result. Two outcomes; there is deliberately no third. */
const managerOutputSchema = z.object({
  issue: z.string(),
  phase: z.string(),
  sessionId: z.string().nullable(),
  /** The run's final message, cut at {@link MAX_ANSWER_CHARS}; `null` when it reported none. */
  answer: z.string().nullable(),
  /** The run's branch; `null` for a run with no repository, only kept files. */
  branch: z.string().nullable(),
  /** How many commits the run's branch has that its base does not. */
  commits: z.number().int().nonnegative(),
  /** Whether the host's judge read the run before it settled. */
  judged: z.boolean(),
  /**
   * How a person's review of the run's changes ended (`reviewChanges`):
   * `"accepted"` is the only value meaning a person accepted them;
   * `"deadline"` means nobody reviewed them before the host's deadline. `null`
   * when no review was asked. Defaulted so a decision kept before it parses (BP-030).
   */
  review: z.enum(["accepted", "deadline"]).nullable().default(null),
});
type ManagerOutput = z.infer<typeof managerOutputSchema>;

/** A person's answer to the review of a run's changes: accept them, or ask for changes in words. */
export const harnessReviewAnswerSchema = z.discriminatedUnion("verdict", [
  z.object({ verdict: z.literal("accepted") }),
  // A word, not just space: a revision with none is refused when it is given.
  z.object({ verdict: z.literal("revise"), words: z.string().regex(/\S/) }),
]);
export type HarnessReviewAnswer = z.infer<typeof harnessReviewAnswerSchema>;

/**
 * What `decide` hands the steps after it: what a judge reads, or `null` when
 * no judge runs. The output itself goes only on state (`decided`).
 */
const decisionSchema = harnessJudgeInputSchema.nullable();

/**
 * The manager's per-run values.
 *
 * Sequencer state, not session state: `defineFlow` refuses a dispatched worker
 * that declares session state, because the entry runs in a child session it
 * may share with other rows, where two blocks choosing one key with different
 * shapes corrupt each other silently.
 */
const managerStateSchema = z.object({
  /**
   * The board this run's task was claimed on, when it was read from the claim
   * rather than from the fixed board. Recorded when the run opens; every read
   * and write of the board goes through it.
   */
  claim: stateClaimSchema.nullable().default(null),
  /** The board segment of the run's identity (`runBoardSegment`). */
  epic: z.string().nullable().default(null),
  issue: z.string().nullable().default(null),
  phase: z.string().nullable().default(null),
  topic: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  attempt: z.number().nullable().default(null),
  /**
   * The claim this run holds, as the claim gate (or the board's drain) stamped
   * it when it claimed the turn: the task, its attempt, and its turn
   * generation (FIX-2133 D3). Every write this run makes to the task presents
   * it, never a ticket minted from the row as it stands later. Two turns can
   * share an attempt (an answered question owes one more), so a write is this
   * run's only while the row is still on the ticket's turn.
   */
  ticket: taskClaimTicketSchema.nullable().default(null),
  /** Which run of the manager's on this issue-phase this is: the ask marker's second number (`./ask`). */
  run: z.number().nullable().default(null),
  workspacePath: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  /**
   * When this run opened (epoch ms): the branch check writes only pull
   * requests created since, so a reused branch's older ones are not this
   * run's. `null` on a run recorded before it was kept: every pull request on
   * the branch counts.
   */
  openedAt: z.number().nullable().default(null),
  /**
   * The session the LAST attempt's harness confirmed it was in, captured before
   * this attempt's opening write clears the row's copy (see `openRun`).
   *
   * Read by exactly one thing: the `resume` resolver handed to the harness. It
   * reaches no phase and no prompt.
   */
  previousSessionId: z.string().nullable().default(null),
  /** The task's goal, as handed to this attempt: what a judge reads the answer against. */
  goal: z.string().nullable().default(null),
  /** How many more harness steps this request ran for a steer (FIX-2086). Each names that read. */
  steerSteps: z.number().nullable().default(null),
  /**
   * What `decide` decided, for the step that settles it once a judge (if
   * any) has read the run: the output to return, and whether the task is held
   * on the run's question (`asked`: nothing left to settle) or passed its
   * check (to complete, or not, on the judge's verdict).
   */
  decided: z
    .object({
      settle: z.enum(["asked", "complete"]),
      output: managerOutputSchema,
      /**
       * The commits read once by `decide`, for the review step's prompt and
       * its one test of "made changes": skipped only on a verified zero.
       */
      changes: z
        .object({ count: z.number().int().nonnegative(), subjects: z.array(z.string()), verified: z.boolean() })
        .nullable()
        .default(null),
      /**
       * How this decision's review ended (FIX-2163): `accepted` or `deadline`
       * settle on it; `revise` and `cancelled` must not complete the run.
       */
      reviewed: z.enum(["accepted", "deadline", "revise", "cancelled"]).nullable().default(null),
    })
    .nullable()
    .default(null),
  /**
   * The checkout lease this attempt holds, as a VALUE — see
   * `CheckoutLease.token`.
   *
   * It lives here rather than in a module-level table because the release has
   * to be reachable from two exits that share nothing but this state: the
   * harness step's settle hook (synchronous, handed only a context) and the
   * chain's rescue. A live handle had nowhere to live but a process-wide map
   * keyed by request; a value has the run's own state.
   *
   * `.nullable().default(null)` on both, so a run row persisted before this
   * change still parses (BP-030).
   */
  lockPath: z.string().nullable().default(null),
  leaseToken: z.string().nullable().default(null),
  /**
   * The repository and base this run was first provisioned from, read off its
   * run record when the attempt opened. A retry provisions from these rather
   * than from whatever its source answers now (BR-19). `null` before the
   * first provision, and on a record written before they were kept.
   */
  remote: z.string().nullable().default(null),
  baseRef: z.string().nullable().default(null),
  baseCommit: z.string().nullable().default(null),
  /** The run was first provisioned as kept files alone, read off its run record with them. */
  filesOnly: z.boolean().nullable().default(null),
  /**
   * The place this attempt was provisioned into, as the workspace host
   * described it — what a save hands back to the host. `null` until
   * provisioned, and again once its kept files were saved and released.
   */
  place: z.custom<WorkspacePlace>().nullable().default(null),
  /**
   * The run record's `place` when this attempt opened: the host the run was
   * last ready on. Handed to `provision` and never written back from here.
   */
  recordedPlace: z.object({ host: z.string(), state: placeStateSchema }).nullable().default(null),
  /**
   * The run record's `held`, read when the attempt opened and kept current by
   * every hold this attempt writes: the key a new hold replaces.
   */
  held: heldSchema.nullable().default(null),
});


/**
 * An attempt failed. Carries only a message — the board captures it as
 * `feedback`, which is how the next attempt is told why this one stopped.
 */
export class HarnessAttemptFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessAttemptFailed";
  }
}

/**
 * The run's workspace refused it: its source answered `refused`, or the host
 * would not provision what the source named. The same answer next time, so
 * the recorder ends the row on this attempt instead of retrying.
 */
export class HarnessRunRefused extends TaskEndsForGoodError {
  constructor(message: string, options: { taskId: string; ending: "errored" | "cancelled" }) {
    super(message, options);
    this.name = "HarnessRunRefused";
  }
}

/**
 * This attempt is no longer the live one.
 *
 * Distinct from {@link HarnessAttemptFailed} because it is not a failed
 * attempt — §9's taxonomy puts a lost claim in neither class: the attempt
 * writes nothing and leaves the row to be recovered. Throwing is still the
 * right exit, because the board's own fenced recorder declines a settlement
 * from a lost claim, so nothing is settled and no retry is spent.
 */
export class HarnessAttemptSuperseded extends Error {
  constructor(where: string) {
    super(
      `[harness-manager] this attempt was superseded before ${where}; stopping rather than ` +
        `continuing to work a row another attempt now holds.`,
    );
    this.name = "HarnessAttemptSuperseded";
  }
}

/**
 * Write through the fence and **read the answer**.
 *
 * A fence whose refusal is discarded is not a fence. Every refusal here means
 * the same thing — a replacement holds the row — and the only correct response
 * is to stop: continuing spends paid agent execution on work that belongs to
 * another attempt, and can take the checkout ahead of its rightful holder,
 * which is obligation B's harm reached through the mechanism meant to prevent
 * it.
 *
 * This is the same shape as the SDK reporting an errored verdict that nobody
 * reads — the defect decision 1 exists to remove, occurring inside this lab's
 * own fence.
 */
async function fenced(
  write: Promise<RunRowWrite>,
  where: string,
): Promise<void> {
  if ((await write) === "refused") throw new HarnessAttemptSuperseded(where);
}

/**
 * The tenant a request resolved to.
 *
 * **One derivation, exported, because two places enforce it.** The flow's
 * per-action gate refuses before the board is touched; the manager refuses
 * before the work executes. If they computed the tenant differently — one
 * defaulting, the other not — the gate would pass a request the manager then
 * rejects mid-run, which is the charged-attempt failure the gate exists to
 * remove, reintroduced by a second copy of one rule.
 *
 * **Absence is the value.** An untenanted request resolves to `undefined`, and
 * that is compared directly — it is not folded into a placeholder name. The
 * earlier version defaulted to a literal, which made a real tenant of that name
 * and no tenant at all the same fact: they shared a board while
 * `tenantSegment` kept them in different checkouts, so a task could execute
 * against a tree that was not its own. Presence is carried by the type here and
 * tagged by `tenantSegment` in every derived identity.
 */
export function requestTenant(ctx: RequestIdentityContext): string | undefined {
  return runPrincipal(ctx).tenantId;
}

/** How a tenant reads in a message. Absence is a fact, so it gets words. */
export function describeTenant(tenantId: string | undefined): string {
  return tenantId === undefined ? "no tenant" : `"${tenantId}"`;
}

/**
 * Read the typed payload off the worker input: the `{ issue, phase }` a
 * feature row carries, or `undefined` for a row that names neither (a task a
 * conversation filed), whose task id then stands in for the issue.
 *
 * A row naming one of the two and not the other, or either as something other
 * than a string, is refused: feature work names both, and such a row is never
 * run as a task that names neither. A refusal, not a failed attempt, because
 * a retry reads the same row.
 *
 * A fixed board's rows are feature rows only, as they always were: one
 * without a usable payload is a failed attempt there, never a task naming
 * neither.
 */
function taskPayload(
  input: { input?: unknown; taskId: string },
  fixedBoard: boolean,
): { issue: string; phase: string } | undefined {
  const parsed = harnessTaskInputSchema.safeParse(input.input);
  if (parsed.success) return parsed.data;
  if (fixedBoard) {
    throw new HarnessAttemptFailed(
      `[harness-manager] task ${input.taskId} carries no usable issue/phase payload: ` +
        `${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  const named = input.input;
  if (typeof named === "object" && named !== null && ("issue" in named || "phase" in named)) {
    throw new HarnessRunRefused(
      `[harness-manager] task ${input.taskId} names only part of a feature payload: ` +
        `${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}. ` +
        `Feature work names both an issue and a phase.`,
      { taskId: input.taskId, ending: "errored" },
    );
  }
  return undefined;
}

/**
 * The manager's per-run values, as the blocks that declare
 * {@link managerStateSchema} are handed them.
 */
type ManagerState = z.infer<typeof managerStateSchema>;

/** The attempt identity every run-record write is fenced against. */
function identityFrom(
  state: ManagerState | undefined,
  boardCollectionId: string,
): AttemptIdentity {
  if (state?.topic == null || state.taskId == null || state.attempt == null) {
    throw new Error(
      "[harness-manager] the manager's sequencer state is empty — this block ran outside the " +
        "manager, or before the row was opened.",
    );
  }
  return {
    taskId: state.taskId,
    attempt: state.attempt,
    ...(state.ticket != null ? { turn: state.ticket.turn } : {}),
    topic: state.topic,
    boardCollectionId,
  };
}

/**
 * The manager's state as a HARNESS's callback sees it.
 *
 * The harness is not one of our blocks, so its callbacks are handed the
 * framework's DEFAULT sequencer state rather than this manager's — the cast is
 * where that gap is crossed. One function rather than the same cast at each of
 * the three feeds: three spellings of one assumption is the shape that drifts,
 * and only one of them would be updated when the state grows.
 *
 * Typed by what it reads, like {@link RequestIdentityContext} above, so any
 * context satisfies it structurally and no caller needs the harness alias.
 *
 * It asserts nothing. The manager owns this shape and the harness never learns
 * it, which is the point of the channel; what each feed does about an empty
 * state is the feed's own business, and they differ.
 */
function harnessCtxState(ctx: {
  sequencer?: { state?: unknown } | undefined;
}): ManagerState | undefined {
  return ctx.sequencer?.state as ManagerState | undefined;
}

/** This run's refusal of the row it holds. Claim board: `errored` (a cancel there reaches nobody). Fixed board: `cancelled`. */
function runRefused(ctx: { sequencer?: { state?: unknown } | undefined }, message: string): HarnessRunRefused {
  const state = harnessCtxState(ctx);
  return new HarnessRunRefused(message, {
    taskId: state?.taskId ?? "",
    ending: state?.claim != null ? "errored" : "cancelled",
  });
}

/**
 * What a person reviewing a run's changes reads (FIX-2163): the commits, or
 * that they couldn't be read, and the judge's verdict as information.
 */
function reviewPrompt(
  changes: RunCommits | null,
  branch: string | null,
  read: HarnessJudgeVerdict | null,
): string {
  const lines: string[] = [];
  if (changes === null || !changes.verified) {
    lines.push("The run's commits couldn't be read, so its changes wait for your review rather than settling unseen.");
  } else {
    lines.push(`${changes.count} commit${changes.count === 1 ? "" : "s"} on ${branch ?? "the run's branch"}:`);
    lines.push(...changes.subjects.map((subject) => `- ${subject}`));
    if (changes.count > changes.subjects.length) lines.push(`- and ${changes.count - changes.subjects.length} more`);
  }
  lines.push("");
  lines.push(
    read === null
      ? "No judge read this run."
      : `The judge: ${read.verdict} (${read.confidence.toFixed(2)})${read.verdict === "done" ? "" : ", under its floor"}: ${read.reason}`,
  );
  lines.push("The judge's verdict is information, not approval. Accept the changes, or ask for changes in words.");
  return lines.join("\n");
}

/** Read the manager's state, or throw rather than derive a wrong directory. */
function managerState(state: ManagerState | undefined): ManagerState {
  if (state?.workspacePath == null) {
    throw new Error("[harness-manager] the manager's sequencer state has no checkout on it.");
  }
  return state;
}

/**
 * Everything one worker can legitimately spend, end to end.
 *
 * **The shutdown budget has to cover the whole worker, not the agent step.**
 * `dispatchDrainTimeoutMs` was set to `runTimeoutMs`, which is only one of four
 * things a claimed row does before it settles — and the engine carves its
 * cancellation reserve OUT of that budget rather than adding to it, so the
 * effective wait was already *less* than the agent's own deadline. A valid run
 * near its deadline was cancelled before it could produce a verdict, and the
 * row it was working settled on an outcome nothing had decided.
 *
 * The four terms, in the order a worker spends them:
 *
 * 1. `waitMs` — the lock wait. A worker queued behind another attempt's tree is
 *    working, not stuck, and cancelling it is the same defect.
 * 2. the provisioning budget — one deadline for all of git, see
 *    `WorkspaceConfig.provisionTimeoutMs`.
 * 3. `runTimeoutMs` — the agent.
 * 4. the network calls after the agent: the completion check, the prompt
 *    builder, and the branch check for the run's pull requests
 *    (`checkBranchPullRequests`), each bounded by `NETWORK_CALL_TIMEOUT_MS`.
 *
 * **The margin is deliberate and is not a mirrored constant.** The engine
 * reserves a share of this budget for unwinding cancelled children — a fraction
 * capped by a flat value, both module-private. Copying either would be a silent
 * coupling to a number we do not own, so instead the budget is scaled past the
 * largest reserve that fraction can take and given absolute slack on top. If the
 * engine's reserve changes, this is generous rather than wrong; the failure mode
 * is a longer worst-case shutdown wait, which is bounded and visible, instead of
 * a cancelled run, which is neither.
 */
/**
 * Core's `withTimeout`, with the conductor's verdict on top.
 *
 * All this adds is *whose fault it is*: a hook that misses its deadline is a
 * failed attempt, not a conductor defect, so it rejects with
 * {@link HarnessAttemptFailed} and the board records that message as the next
 * attempt's feedback. The wording differs from core's for the same reason — a
 * person reading the feedback is being told the hook did not answer, not that a
 * timer expired.
 */
export async function withDeadline<T>(
  work: () => Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  return withTimeout(
    work(),
    ms,
    what,
    (label, timeoutMs) =>
      new HarnessAttemptFailed(`${label} did not answer within ${timeoutMs}ms`),
  );
}

export function harnessDrainBudgetMs(options: {
  runTimeoutMs: number;
  provisionTimeoutMs?: number | undefined;
  ownershipWaitMs: number;
  /** The manager was given a judge, which runs after the completion check, bounded the same way. */
  judge?: boolean | undefined;
}): number {
  const work =
    options.ownershipWaitMs +
    (options.provisionTimeoutMs ?? GIT_TIMEOUT_MS) +
    options.runTimeoutMs +
    // The completion check, the prompt builder and the branch check for the
    // run's pull requests. Each is bounded by this constant, and the budget has
    // to reserve time for each — a bound the budget does not account for is as
    // wrong as no bound.
    NETWORK_CALL_TIMEOUT_MS * 3 +
    (options.judge === true ? NETWORK_CALL_TIMEOUT_MS : 0);

  // `* 4 / 3` clears a reserve of up to a quarter; the flat minute dwarfs the
  // small absolute cap that binds instead on tiny budgets.
  const budget = Math.ceil((work * 4) / 3) + 60_000;

  if (budget > MAX_TIMER_MS) {
    throw new Error(
      `[harness-manager] the derived drain budget (${budget}ms) exceeds the largest delay a ` +
        `timer honours (${MAX_TIMER_MS}ms). Lower runTimeoutMs, the ownership wait, or ` +
        `workspace.provisionTimeoutMs — a budget past the ceiling is silently clamped and ` +
        `would cancel every run immediately.`,
    );
  }
  return budget;
}

/**
 * Resolve the ownership bounds and check them, once.
 *
 * Pure and exported because **two callers need the resolved numbers**: the
 * manager enforces them, and the flow needs `waitMs` to size the drain budget.
 * Re-deriving in the second place is how the last three defects on this branch
 * happened, so there is one derivation and it is called twice.
 */
export function resolveOwnership(options: {
  runTimeoutMs: number;
  provisionTimeoutMs?: number | undefined;
  ownership?: Partial<OwnershipBounds> | undefined;
}): { ownership: OwnershipBounds; maxLockHeldMs: number } {
  const { runTimeoutMs } = options;
  // **How long a live attempt can legitimately hold the lock.**
  //
  // Not `runTimeoutMs`. The lock is acquired BEFORE the checkout is provisioned
  // — deliberately, so a displaced attempt cannot switch branches under its
  // replacement — and provisioning is git, which on a large repository takes
  // minutes. The run's own deadline only starts at the agent step, so a stale
  // window sized against it alone can elapse while the holder is still inside
  // `worktree add`: the replacement declares the lock stale, clears it, and two
  // agents mutate one checkout. Obligation B, defeated by arithmetic.
  //
  // `provisionBudget` is a bound and not an estimate — it is the same number
  // provisioning is given as a SINGLE deadline for the whole operation, so the
  // two cannot drift. That it is one deadline rather than one timeout per git
  // call is what makes this arithmetic true: provisioning runs up to three
  // commands back to back, so a per-call bound of N would let the real hold
  // reach 3N while this sum said N.
  //
  // **What follows provisioning is a fork, not a sequence — so the second term
  // is a maximum, not a sum.** Provisioning either refuses, in which case it
  // discards the checkout it just made and throws before any agent is
  // dispatched, or it succeeds, in which case the run happens and that cleanup
  // never does. One lock, two mutually exclusive tails.
  //
  // Both tails have to be counted, and leaving the cleanup one out was a real
  // gap: it cannot draw from `provisionBudget` — the case it exists for is that
  // budget running out — so on the refusal path the hold genuinely outlasts
  // provisioning. Unaccounted, a slow cleanup runs past the point a waiter may
  // call this lock stale, and two attempts prune the same worktree bookkeeping:
  // the same defeat-by-arithmetic the paragraph above describes, through the
  // door added to prevent a wedge.
  //
  // Adding all three instead would price a run and its own cancellation as if
  // they happened back to back. That is not conservatism with no cost — this
  // number is the floor `staleAfterMs` is REFUSED against, so every millisecond
  // of slack rejects deployments whose configuration is in fact safe.
  const provisionBudget = options.provisionTimeoutMs ?? GIT_TIMEOUT_MS;
  const maxLockHeldMs =
    provisionBudget + Math.max(runTimeoutMs, CHECKOUT_CLEANUP_TIMEOUT_MS);

  const ownership: OwnershipBounds = {
    // Sized against the lease-renewal lag that produces overlap, and well
    // inside the run's own deadline: an ordinary reclaim resolves in seconds.
    // **At least the stale bound**, or a waiter gives up on a lock it was about
    // to be allowed to take. With a dead host the board reclaims after the
    // lease, but the lock is not stale-eligible until `staleAfterMs` — so a
    // shorter wait times out, throws, and spends a retry, and repeated wakes
    // exhaust the budget on infrastructure long before takeover is permitted.
    //
    // The alternative — not charging lock waits as coding failures — needs an
    // exit that neither completes nor fails the row, and that third outcome is
    // exactly what this spec defers to LAB-139. So the bound moves instead: it
    // costs latency on a genuinely wedged tree and no design change.
    // **Strictly longer than the stale window, by at least one poll.** See the
    // check below for why equal is not enough; the default has to satisfy the
    // rule it is the reference for.
    waitMs:
      options.ownership?.waitMs ??
      maxLockHeldMs + 300_000 + (options.ownership?.pollMs ?? 1_000),
    pollMs: options.ownership?.pollMs ?? 1_000,
    // Past the longest legitimate hold — the run's deadline AND the
    // provisioning that precedes it — so a lock is declared stale only once no
    // live attempt could still hold it. That is what removes the need for a
    // heartbeat.
    staleAfterMs: options.ownership?.staleAfterMs ?? maxLockHeldMs + 300_000,
  };

  // The default satisfies this by construction; an override can break it, and
  // the breakage is silent and severe. A stale window inside the legitimate
  // hold — the run's deadline plus provisioning — means a live attempt's lock
  // ages past "stale" while it is still
  // working, so a replacement clears it and two coding agents mutate one
  // checkout — obligation B violated by configuration rather than by a race.
  // Refused at construction because there is no runtime moment at which the
  // mistake announces itself.
  // **Strictly longer, and by at least one poll — equal is a boundary that never
  // resolves.** `acquireCheckout` tests `age > staleAfterMs`, so a waiter whose
  // wait EQUALS the stale window reaches its deadline at the exact moment the
  // lock becomes eligible and times out instead of taking over. The defaults
  // were equal, so this was not an exotic override: the ordinary configuration
  // charged a coding retry for a dead holder it was about to be allowed to
  // reclaim.
  //
  // One poll interval of headroom, because eligibility is only observed on a
  // poll: a wait that ends between two passes is a wait that never looked.
  //
  // What this does NOT fix, stated so nobody reads more into it: a lock created
  // AFTER the waiter started can always age past the waiter's deadline. That
  // holder is fresh rather than dead, so timing out is the correct answer there
  // — the guarantee bought here is for a lock the waiter found already held.
  const minimumWaitMs = ownership.staleAfterMs + ownership.pollMs;
  if (ownership.waitMs < minimumWaitMs) {
    throw new Error(
      `[harness-manager] ownership.waitMs (${ownership.waitMs}ms) must exceed ` +
        `ownership.staleAfterMs (${ownership.staleAfterMs}ms) by at least one poll ` +
        `interval (${ownership.pollMs}ms), so at least ${minimumWaitMs}ms: a lock becomes ` +
        `stale-eligible only once its age is STRICTLY past the window, and eligibility is ` +
        `only observed on a poll. A wait that ends at or before that point gives up on a ` +
        `dead holder's lock it was about to be allowed to take, and spends a retry doing it.`,
    );
  }

  if (ownership.staleAfterMs <= maxLockHeldMs) {
    throw new Error(
      `[harness-manager] ownership.staleAfterMs (${ownership.staleAfterMs}ms) must exceed the ` +
        `longest a live attempt can hold the lock (${maxLockHeldMs}ms = the provisioning ` +
        `budget ${provisionBudget}ms + whichever of runTimeoutMs ${runTimeoutMs}ms and the ` +
        `${CHECKOUT_CLEANUP_TIMEOUT_MS}ms to undo a checkout provisioning refused is ` +
        `longer, since a refusal throws before any run): the ` +
        `lock is taken before the checkout is provisioned, so a window sized against the ` +
        `run's deadline alone can elapse while the holder is still inside git. Raise the ` +
        `stale window, lower the deadline, or lower options.provisionTimeoutMs.`,
    );
  }


  return { ownership, maxLockHeldMs };
}

/**
 * Every collection the manager and its phase read, as ONE capability.
 *
 * A factory rather than a singleton, because the set is per-conductor: the
 * board ledger is registered under its own collection id, and that id
 * partitions by tenant and epic. The capability's name carries the same id for
 * the same reason — two conductors in one process are two capabilities, and a
 * shared name is a merge collision.
 *
 * **The widened return type is load-bearing, not decoration.** Left to
 * inference, the capability's resources are a literal object type, which
 * narrows `ctx.resources` AND `ctx.targets` on every block that lists it — and
 * a narrowed `BlockContext` is not assignable to a plain one, so all fourteen
 * helper calls in this file would need `ctx as BlockContext` back. That is the
 * invariance trap {@link RequestIdentityContext} describes, reached from the
 * `uses` side. The accessor set is genuinely open here (a phase brings its
 * own), so declaring it open is the honest type as well as the usable one.
 */
function createManagerCapability(options: {
  /** The capability's name: the fixed board's id, or the manager's name when it has none. */
  name: string;
  /** The fixed board's ledger collection id — also the accessor the fence reads it under. */
  boardCollectionId: string | undefined;
  /** The fixed board's ledger declaration — the same object the board itself registers. */
  boardCollection: DefinedTaskCollection | undefined;
}): DefinedCapability<
  string,
  Record<string, never>,
  never,
  Record<string, PresetDef>,
  undefined,
  Record<string, DeclaredResourceEntry>
> {
  const { boardCollectionId, boardCollection } = options;
  return defineCapability({
    name: `harness-manager:${options.name}`,
    resources: {
      [RUNS]: runRecordCollection,
      // Where `onUsage` records the subscription windows a run reports, in the
      // run owner's row. The usage query declares the same definition object.
      [HARNESS_USAGE]: harnessUsageCollection,
      // Where the branch check writes the pull requests on the run's branch.
      // The harness blocks declare the same definition object.
      [OBSERVED_PULL_REQUESTS]: observedPullRequestsCollection,
      // Declared so the fence can read the LIVE claim off the board row. The
      // board declares the same definition object, so this is one registration
      // rather than a second storage slot that looks like the first. A board
      // read from the claim is resolved by the host's resolver instead.
      ...(boardCollectionId !== undefined && boardCollection !== undefined
        ? { [boardCollectionId]: boardCollection }
        : {}),
    },
  });
}

/**
 * The pull requests on the run's branch, added to the run session's record
 * where it lacks them, stamped with this request. The harness block records
 * the ones its create calls name as they settle; this catches one opened any
 * other way. A run with no repository, or with no checkout yet, has no branch
 * to check. Never throws: a missing or signed-out `gh` is a status note.
 */
async function checkBranchPullRequests(ctx: BlockContext): Promise<void> {
  // Read raw, not through `managerState`: a run that failed before its checkout has none, and that is not an error here.
  const state = harnessCtxState(ctx);
  if (state?.workspacePath == null || state.branch == null || !existsSync(state.workspacePath)) return;
  const result = await recordBranchPullRequests(ctx, {
    cwd: state.workspacePath,
    branches: [state.branch],
    openedSince: state.openedAt ?? undefined,
    // The whole check, however many branches, inside the one network-call bound the drain budget reserves.
    timeoutMs: NETWORK_CALL_TIMEOUT_MS,
  });
  if (result.status === "unavailable") {
    ctx.emit.status(`Pull requests on the run's branch were not checked: ${result.reason}`, { transient: false });
  }
}

/**
 * Build the manager: one dispatched worker for one phase.
 *
 * A steer on the task is in the attempt's first prompt, and one that arrives
 * while a step runs is the next step of the same request (FIX-2086).
 */
export function harnessManager(options: ManagerOptions): TaskWorker {
  const {
    boardCollectionId,
    boardCollection,
    ledgers,
    judge,
    reviewChanges = false,
    tenant,
    phase: callerPhase,
    workspace,
    runTimeoutMs,
    harness,
    uses: hostUses,
    name = "harness-manager",
  } = options;

  // **A removed option, refused by name** (BP-030). A host that still passes
  // it expects to be told of each question; dropping it silently would leave
  // that host waiting on a call that never comes.
  if ("announce" in (options as object)) {
    throw new Error(
      "[harness-manager] `announce` was removed: a run's question now keeps its task waiting on the board, " +
        "where the Inbox lists it. Read held tasks from the board (`openRowQuestions`) instead of being told.",
    );
  }

  // **A board to read, named one way or the other.** A fixed board needs both
  // halves; without one, the resolver is the only way to a board.
  if ((boardCollectionId === undefined) !== (boardCollection === undefined)) {
    throw new Error(
      "[harness-manager] give `boardCollectionId` and `boardCollection` together: the fence " +
        "reads the board by the id, and the ask step resolves it from the declaration.",
    );
  }
  if (boardCollectionId === undefined && ledgers === undefined) {
    throw new Error(
      "[harness-manager] give a board: `boardCollectionId` with `boardCollection`, or " +
        "`ledgers` to read each run's board from its claim.",
    );
  }

  if (judge !== undefined && !(Number.isFinite(judge.floor) && judge.floor >= 0 && judge.floor <= 1)) {
    throw new Error(`[harness-manager] the judge's floor is a confidence, from 0 to 1; got ${judge.floor}.`);
  }

  // **The board id is checked HERE, not first at an attempt.** It becomes a
  // path segment and a git ref component in every run. Refused at the attempt,
  // the row is claimed, the checkout fails, and the retry budget is spent on a
  // name no retry can fix; refused here, the host fails before anything is
  // hired. The attempt still derives through the same function, so the two
  // cannot disagree.
  if (boardCollectionId !== undefined) assertDerivedIdentity("boardCollectionId", boardCollectionId);

  // **A phase is caller-owned validated configuration, so it is snapshotted.**
  // Held by reference, a host could swap `implement` for `review` after this
  // returns and leave the implement prompt and completion check attached to
  // rows both runtime guards now accept. Shallow, which is all the shape needs.
  const phase: PhaseSpec = Object.freeze({ ...callerPhase });

  // **The phase's own preconditions, at the manager's door.**
  //
  // This used to live in one host's flow builder, which meant a host
  // constructing this manager directly — the documented way — silently skipped
  // it. What that costs is exactly what `validate` exists to prevent: a
  // permanent precondition failure landing AFTER a paid agent run, once per
  // retry, until the budget is gone. A preflight only one caller runs is not a
  // preflight.
  //
  // **Captured, not left on the phase.** What `validate` learns belongs to THIS
  // manager; a phase that stored it on itself would hand it to the next one.
  const validated = phase.validate?.(workspace);

  // The phase this manager actually runs: this construction's `validated` bound
  // into every run context, by a closure that belongs to it and nothing else.
  // Two managers from one `PhaseSpec` get two wrappers, so neither can reach the
  // other's value — the property the phase cannot give itself, since the
  // snapshot above copies function references and not what they close over.
  //
  // Gated on the VALUE rather than on `validate` being defined, and the two are
  // equivalent: binding `undefined` produces a context whose `validated` is
  // `undefined`, which is what an unwrapped phase already receives. So a
  // `validate` that only refuses costs no allocation per run.
  //
  // **Both hooks, because the type promises both.** `validated` lives on
  // `PhaseRunContext`, which `PromptRunContext` extends — so a prompt builder is
  // told it receives the value. Binding it into `isDone` alone made the type a
  // lie for the other half: a phase whose prompt depends on what `validate`
  // found would read `undefined` and build the wrong prompt, silently, after a
  // construction that succeeded.
  const runPhase: PhaseSpec =
    validated === undefined
      ? phase
      : Object.freeze({
          ...phase,
          isDone: (run: CompletionRunContext) => phase.isDone({ ...run, validated }),
          buildPrompt: (run: PromptRunContext) => phase.buildPrompt({ ...run, validated }),
        });

  // **One provisioning path.** A fixed repository is a host whose source is
  // constant and whose repository is used as it stands, so its runs' branches
  // stay in `sourceRepo` and their checkouts where they always were.
  const host: WorkspaceHost = isWorkspaceHost(workspace) ? workspace : hostForConfig(workspace);

  const { ownership } = resolveOwnership({
    runTimeoutMs,
    provisionTimeoutMs: host.provisionTimeoutMs,
    ...(options.ownership !== undefined ? { ownership: options.ownership } : {}),
  });

  // **Three accessors are the manager's and a capability may not claim them.**
  //
  // A capability whose resources carried `runs` would send this manager's
  // bookkeeping into a collection the status surface never reads — the row
  // would be written, and every read of it would answer nothing. One carrying
  // the board's accessor is worse: the live-claim fence would consult unrelated
  // rows, quietly defeating the whole attempt-fence mechanism while every test
  // that does not stage two attempts still passes. The usage record is the
  // third: a run's usage windows would land where the usage query never reads.
  //
  // Merging the manager's entries LAST would prevent all three, and it is the
  // wrong fix: the host's declaration would simply not work, with nothing
  // anywhere saying why. This fails loudly, naming the key.
  const RESERVED_ACCESSORS = new Set([RUNS, HARNESS_USAGE, ...(boardCollectionId !== undefined ? [boardCollectionId] : [])]);

  /** Refuse a capability set that claims one of the manager's accessors. */
  const assertClaimsNothingReserved = (
    entries: readonly unknown[],
    when: string,
  ): void => {
    const claimed = [
      ...new Set(
        entries.flatMap((entry) =>
          Object.keys(
            (entry as { resources?: Record<string, unknown> })?.resources ?? {},
          ),
        ),
      ),
    ].filter((key) => RESERVED_ACCESSORS.has(key));
    if (claimed.length === 0) return;
    throw new Error(
      `[harness-manager] a capability on \`uses\` declares collection(s) ` +
        `${claimed.map((k) => `"${k}"`).join(", ")}, which the manager owns (${when}) — ` +
        `"${RUNS}" is the run record, "${HARNESS_USAGE}" is the usage record` +
        (boardCollectionId !== undefined
          ? `, and "${boardCollectionId}" is the board ledger the attempt fence reads`
          : "") +
        `. All ` +
        `are already available to the phase; declaring them again would replace ` +
        `the manager's own.`,
    );
  };

  // **Static entries are checked here; DYNAMIC ones are checked when they
  // resolve, and skipping them would have been a hole rather than a limit.**
  //
  // A dynamic `uses` entry is a function the framework calls per invocation, so
  // its capabilities cannot be inspected at construction. Passing it through
  // unchecked would let a host override `runs`, the usage record or the board ledger at
  // run time through a documented framework feature — a guard a host bypasses
  // by using the framework normally is not a guard.
  //
  // Refusing dynamic `uses` outright would close it too, and costs more than it
  // saves: conditional capabilities are a real thing hosts need. So each dynamic
  // entry is wrapped instead, and the same rule runs on what it actually
  // returns. The wrapper is transparent — it returns the entry's own value —
  // and the cost is one array scan per invocation on a path that already builds
  // a context.
  const staticUses = (hostUses ?? []).filter((e) => typeof e !== "function");
  assertClaimsNothingReserved(staticUses, "declared statically");

  const guardedUses = (hostUses ?? []).map((entry) =>
    typeof entry === "function"
      ? (ctx: never) => {
          const resolved = (entry as (c: never) => unknown)(ctx);
          const list = Array.isArray(resolved) ? resolved : [resolved];
          assertClaimsNothingReserved(list, "returned by a dynamic `uses` entry");
          return resolved;
        }
      : entry,
  ) as typeof hostUses;

  const managerCapability = createManagerCapability({
    name: boardCollectionId ?? `${name}:by-claim`,
    boardCollectionId,
    boardCollection,
  });

  /**
   * The board's rows as the SUBSTRATE sees them, not as a resource collection.
   *
   * The fence reads the ledger as a plain collection because all it needs is
   * two fields off the persisted row. The ask step needs a write, and a write
   * has to be the substrate's: the claim fence, the hold, and the lease it
   * drops all hang off the board's own ask rather than off fields this
   * manager writes by hand.
   *
   * Composed from the two exported pieces rather than reached for through
   * `board.capability`, because the capability does not exist yet when this
   * manager is constructed — the board is built FROM this worker. It is the
   * same resolve the board's own drain and its accessor perform, including the
   * frozen-assignee policy, which is read off the shared declaration here
   * rather than captured as a boolean per call site.
   */
  const boardTasks = (ctx: BlockContext): Promise<TaskCollectionRef> => {
    if (boardCollectionId === undefined || boardCollection === undefined) {
      throw new Error("[harness-manager] this manager has no fixed board; its runs read their board from the claim.");
    }
    const collection = resolveResourceCollection(ctx, boardCollectionId);
    if (collection === undefined) {
      throw new Error(
        `[harness-manager] the board ledger "${boardCollectionId}" is not registered on this ` +
          `worker, so its rows cannot be read or asked a question on.`,
      );
    }
    return getOrCreateTaskCollection({
      ctx,
      backing: "resource",
      collectionId: boardCollectionId,
      collection,
      immutableAssignee: hasFrozenLedgerAssignee(boardCollection),
    });
  };

  /**
   * The board a claim names, through the host's resolver, or `undefined` when
   * the resolver does not answer for it or answers with another ledger or
   * partition than the claim names. Every read of a board read from the claim
   * goes through here.
   */
  const claimLedger = async (ctx: BlockContext, claim: StateClaim): Promise<TaskCollectionRef | undefined> => {
    const partition = claim.partition ?? undefined;
    const resolved = await ledgers?.(claim.collectionId, ctx, partition);
    if (resolved === undefined) return undefined;
    if (resolved.collectionId !== claim.collectionId || resolved.partition !== partition) return undefined;
    return resolved;
  };

  /** The run's row as stored now: a steer is another request's write (FIX-2086). */
  const committedRow = async (ctx: BlockContext): Promise<Task | undefined> => {
    const taskId = managerState(harnessCtxState(ctx)).taskId;
    if (taskId === null) return undefined;
    const board = await runBoard(ctx);
    return readCommittedTask(board, taskId);
  };

  /** Take this attempt's untaken steers in `takenIn`, fenced to the claim, then return what `select` reads. */
  const takeSteersFor = async (
    ctx: BlockContext,
    takenIn: string,
    select: (row: Task, takenIn: string) => NonNullable<Task["steers"]>,
  ): Promise<{ steers: ShownSteer[]; taken: TaskSteer[] } | null> => {
    const board = await runBoard(ctx);
    const row = await committedRow(ctx);
    if (row === undefined || row.status !== "in_progress") return { steers: [], taken: [] };
    let taken: readonly string[] = [];
    if (board.takeSteers !== undefined && untakenSteers(row).length > 0) {
      // The claim this run holds, never one minted from the row now: a later
      // turn of the attempt holds another ticket, and its steers are its own.
      const claim = harnessCtxState(ctx)?.ticket ?? null;
      if (claim === null) return null;
      const outcome = await board.takeSteers(row.id, { claim, takenIn });
      // Declined: the attempt no longer holds the row (claimed again, finished).
      if (outcome.outcome === "declined") return null;
      taken = outcome.taken ?? [];
    }
    const now = board.get(row.id) ?? row;
    return {
      steers: select(now, takenIn).map((steer) => shownSteer(now, steer)),
      // What this take wrote, as the write says: a re-run of the read took none.
      taken: (now.steers ?? []).filter((steer) => taken.includes(steer.id)),
    };
  };

  /** The run's board as the substrate sees it: the one its claim names, or the fixed board. */
  const runBoard = async (ctx: BlockContext): Promise<TaskCollectionRef> => {
    const claim = harnessCtxState(ctx)?.claim ?? null;
    if (claim === null) return boardTasks(ctx);
    const board = await claimLedger(ctx, claim);
    if (board === undefined) {
      throw new Error(
        `[harness-manager] the board this run was claimed on (ledger "${claim.collectionId}"` +
          `${claim.partition === null ? "" : `, partition "${claim.partition}"`}) no longer resolves.`,
      );
    }
    return board;
  };

  /**
   * The attempt identity every run-record write is fenced against. On a board
   * read from the claim, the fence reads the row through the resolver at the
   * claim's ledger and partition, and compares its incarnation too.
   *
   * Typed by what it reads, like {@link harnessCtxState}: a harness feed is
   * handed a narrower context than a block, and the resolver needs only what
   * every block context carries.
   */
  const identityOf = (
    ctx: { sequencer?: { state?: unknown } | undefined },
    state: ManagerState | undefined,
  ): AttemptIdentity => {
    const claim = state?.claim ?? null;
    const base = identityFrom(state, claim?.collectionId ?? boardCollectionId!);
    // The task this run's turn belongs to: a task filed again under the same id is another one.
    const incarnationId = state?.ticket?.incarnationId;
    if (claim === null) return incarnationId === undefined ? base : { ...base, incarnationId };
    return {
      ...base,
      readBoardRow: async () => (await claimLedger(ctx as BlockContext, claim))?.get(base.taskId),
      ...(claim.incarnationId !== null ? { incarnationId: claim.incarnationId } : {}),
    };
  };

  /**
   * The board this task was claimed on, from the claim on the manager's input:
   * `null` for the fixed board (no claim, or a claim naming it with no
   * partition), the claim otherwise. Refused when this manager cannot read
   * the board the input names.
   */
  const claimFrom = (input: z.infer<typeof harnessManagerInputSchema>): StateClaim | null => {
    const named = input.claim;
    if (named === undefined) {
      if (boardCollectionId === undefined) {
        throw new Error(
          `[harness-manager] task ${input.taskId} reached a manager that reads its board from the ` +
            `claim, with no claim on its input. Its entry must hand the manager the gate's claim.`,
        );
      }
      return null;
    }
    if (named.partition === undefined && named.collectionId === boardCollectionId) return null;
    if (ledgers === undefined) {
      throw new Error(
        `[harness-manager] task ${input.taskId} was claimed on ledger "${named.collectionId}", and ` +
          `this manager reads only its fixed board "${boardCollectionId}".`,
      );
    }
    return {
      collectionId: named.collectionId,
      partition: named.partition ?? null,
      incarnationId: named.incarnationId ?? null,
    };
  };

  /**
   * Save the run's kept files, and let them go once saved.
   *
   * A save that fails is recorded on the run record's `lastSave` and leaves
   * the files live, so the next save point tries again with nothing lost; it
   * answers `false` rather than throwing. Conflicted and contested paths were
   * left as they were by the flush and are named on the record. A place with
   * no kept files (a fixed repository) writes nothing and answers `true`.
   */
  const saveKeptFiles = async (ctx: BlockContext): Promise<boolean> => {
    const state = harnessCtxState(ctx);
    const place = state?.place;
    if (place == null || place.filesDir === undefined) return true;
    let error: string | null = null;
    let leftAlone: string[] = [];
    try {
      const report = await host.save(place);
      leftAlone = [...report.conflicts, ...report.contested].map((outcome) => outcome.path);
    } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause);
    }
    if (state?.topic != null && state.taskId != null && state.attempt != null) {
      await fenced(
        writeRunRow(ctx, identityOf(ctx, state), {
          lastSave: { at: Date.now(), conflicts: leftAlone, error },
        }),
        "the run's kept files were saved",
      );
    }
    if (error !== null) return false;
    await host.release(place);
    await ctx.sequencer!.patchState({ place: null });
    return true;
  };

  /**
   * Hold the run's repository work, where the host holds it: write the pack,
   * then switch the record to it, then drop the pack the record named before
   * (BR-6). Beside every save point: turn end, a question, failure.
   *
   * Answers `false` when the hold failed, after recording why and keeping the
   * last good hold on the record (BR-7); the caller decides whether that fails
   * the attempt (BR-8). The pack and the record write are each tried a few
   * times first. A displaced attempt's record write is refused like every
   * other one (BR-9), and nothing is dropped. With holding off, nothing runs.
   */
  const holdWork = async (ctx: BlockContext): Promise<boolean> => {
    const state = harnessCtxState(ctx);
    const place = state?.place;
    if (place == null || place.holding === undefined) return true;
    const identity = identityOf(ctx, state);
    const previous = state?.held ?? null;
    const recorded = recordedHoldOf(previous);
    const writeHeld = (held: HeldRecord, where: string) =>
      withHoldRetries(
        () => fenced(writeRunRow(ctx, identity, { held }), where),
        (error) => !(error instanceof HarnessAttemptSuperseded),
      );

    let hold: HeldWork | null;
    try {
      hold = await withHoldRetries(() =>
        host.checkpoint(place, recorded === null ? null : { snapshot: recorded.snapshot, sha256: recorded.sha256, bytes: previous!.bytes ?? 0 }),
      );
    } catch (cause) {
      const failed = failedHeldRecord(previous, identity.attempt, Date.now(), cause instanceof Error ? cause.message : String(cause));
      await writeHeld(failed, "a failed hold was recorded");
      await ctx.sequencer!.patchState({ held: failed });
      return false;
    }
    if (hold === null || hold.unchanged) return true;

    // **The record switches after the pack is stored, to a key no earlier
    // hold used**: a machine dying before this write leaves the record on the
    // last good pack, and one dying after it leaves an orphan, never a gap.
    const held = heldRecordOf(hold, identity.attempt, Date.now());
    await writeHeld(held, "the run's work was held");
    await ctx.sequencer!.patchState({ held });

    // **Last, and only the key the record named before**: never the one just
    // written, and never one that parked the run, which stays as evidence. A
    // failed drop leaves an orphan for the sweep, not a failed hold.
    if (previous?.key != null && previous.key !== held.key && !previous.parked) {
      await host.dropHeld(place, previous.key).catch(() => undefined);
    }
    return true;
  };

  /**
   * Write where the run's place stands, where the host holds work. With
   * holding off this is never called and the record gains no `place`.
   */
  const recordPlace = async (ctx: BlockContext, placeHost: string, placeState: PlaceState): Promise<void> => {
    await fenced(
      writeRunRow(ctx, identityOf(ctx, harnessCtxState(ctx)), {
        place: { host: placeHost, state: placeState },
      }),
      `the place was recorded ${placeState}`,
    );
  };

  /**
   * Provision the run's place through the host, handing it what the record
   * says, and write `place.state` around it in the order the rules give:
   * `provisioning`, then `lost` and `restoring` when the host reports them,
   * then `ready` naming this host (BR-25). Until it is ready the record keeps
   * naming the host the place was last ready on, so a machine that dies mid-
   * rebuild never reads as the run's live place.
   *
   * A refusal settles the row as before. Held work that disagrees with the
   * record holds the task on a question for the run's owner, before any
   * harness runs.
   */
  const provisionPlace = async (
    ctx: BlockContext,
    answer: RunSourceAnswer,
    location: RunLocation,
  ): Promise<WorkspacePlace> => {
    const state = managerState(harnessCtxState(ctx));
    const holding = host.holds(answer);
    const recordedHost = state.recordedPlace?.host ?? null;
    const held = recordedHoldOf(state.held);
    // Off, and nothing held: exactly the call the host always got.
    const recorded: RecordedPlace | undefined =
      holding || held !== null
        ? { host: recordedHost, held, remote: state.remote, branch: state.branch, baseRef: state.baseRef }
        : undefined;
    const before = recordedHost ?? (holding ? host.hostId() : null);
    if (holding) await recordPlace(ctx, before!, "provisioning");
    try {
      const place = await host.provision(answer, {
        place: placeFor(location),
        branch: state.branch!,
        ignored: ASK_MARKER_IGNORED,
        ...(recorded !== undefined ? { recorded } : {}),
        ...(holding ? { progress: (reported: "lost" | "restoring") => recordPlace(ctx, before!, reported) } : {}),
      });
      // A checkout left on another branch with uncommitted changes is the
      // run's to sort out; running on it would commit to the wrong branch.
      if (place.repo?.offBranch !== undefined) {
        throw new WorkspaceRefusedError("checkout-moved", place.repo.offBranch.message);
      }
      if (holding) await recordPlace(ctx, host.hostId(), "ready");
      return place;
    } catch (cause) {
      if (cause instanceof WorkspaceRefusedError) {
        if (holding) await recordPlace(ctx, before!, "refused").catch(() => undefined);
        throw runRefused(ctx, refusedMessage("host", cause));
      }
      if (cause instanceof HeldWorkMismatchError) await holdOnMismatch(ctx, cause, before);
      throw cause;
    }
  };

  /**
   * Hold the run's task on `question`, through the ask step (`./ask-step`):
   * the manager's one way to stop for a person. Stops the run when its turn
   * no longer holds the row.
   */
  const holdOnQuestion = async (ctx: BlockContext, question: string): Promise<void> => {
    if ((await askStep(ctx, await runBoard(ctx), question)) === "superseded") {
      throw new HarnessAttemptSuperseded("the run's question held its task");
    }
  };

  /**
   * Ask the run's owner: its held work cannot be used here. The place goes
   * `lost`, the pack is marked so nothing ever drops it, the task is held on
   * the owner's question through the ask step, and the operator's log names
   * the run and the field, never the work's contents (BR-19, BR-29, D2).
   */
  const holdOnMismatch = async (
    ctx: BlockContext,
    mismatch: HeldWorkMismatchError,
    placeHost: string | null,
  ): Promise<never> => {
    const state = managerState(harnessCtxState(ctx));
    const identity = identityOf(ctx, state);
    const held = state.held === null ? null : { ...state.held, parked: true };
    await fenced(
      writeRunRow(ctx, identity, {
        ...(placeHost !== null ? { place: { host: placeHost, state: "lost" as const } } : {}),
        held,
      }),
      "the mismatch was recorded",
    );
    await ctx.sequencer!.patchState({ held });

    await holdOnQuestion(ctx, mismatchQuestion(mismatch.field, state.held?.attempt ?? null));
    console.warn(
      `[harness-manager] run ${identity.topic} (task ${identity.taskId}, attempt ${identity.attempt}): ` +
        `held work does not match its record (${mismatch.field}); its task waits on a question for the run's owner.`,
    );
    throw new HeldOnQuestion(mismatch.field);
  };

  /**
   * Open the row — BEFORE the attempt waits for anything.
   *
   * The checkout path is derived here rather than read back, so a task woken in
   * a coordinator session that never saw the previous run still resolves the
   * same directory (see `./workspace`).
   */
  const openRun = handler({
    name: "harness-manager-open-run",
    inputSchema: harnessManagerInputSchema,
    outputSchema: z.void(),
    sequencerStateSchema: managerStateSchema,
    // The host's capabilities too: the workspace's run source is asked here,
    // and a source that reads a collection resolves it off this context.
    uses: [managerCapability, ...(guardedUses ?? [])],
    // Annotated for the reason `prepare`'s is: the host's `uses` widens the
    // inferred context past what the helpers below accept.
    execute: async (input, ctx: BlockContext) => {
      // **Which board, from the claim, checked against the row before
      // anything else.** The claim on the input is the entry adapter's copy of
      // the gate's ticket; the row at that ledger and partition is the
      // authority. It must be this task, on this attempt, still running, and
      // of the claim's incarnation when it names one; the incarnation found is
      // kept, so every later write is fenced against it too.
      let claim = claimFrom(input);
      const board = claim === null ? await boardTasks(ctx) : await claimLedger(ctx, claim);
      if (board === undefined) {
        throw new Error(
          `[harness-manager] task ${input.taskId} was claimed on ledger "${claim!.collectionId}", ` +
            `which this manager's resolver does not answer for at that partition.`,
        );
      }
      // **The claim this run holds: its attempt AND its turn** (FIX-2133 D3).
      // An answered question owes its task one more turn on the same attempt,
      // so the attempt alone no longer tells this run from the next. The
      // ticket is the one the claim gate stamped when it claimed this turn,
      // and every later write presents it: the opening write below is fenced
      // on its turn, so a turn that is already over stops there.
      const ticket = heldTicket(ctx, board, input);
      if (claim !== null) {
        const row = board.get(input.taskId);
        const sameIncarnation =
          claim.incarnationId === null || row?.incarnationId === undefined || row.incarnationId === claim.incarnationId;
        if (row === undefined || row.attempts !== input.attempts || row.status !== "in_progress" || !sameIncarnation) {
          throw new HarnessAttemptSuperseded("the run was opened (its claim names no live row of this attempt)");
        }
        claim = { ...claim, incarnationId: claim.incarnationId ?? row.incarnationId ?? null };
        assertDerivedIdentity("the claim's ledger id", claim.collectionId);
      }
      const epic = claim === null ? boardCollectionId! : runBoardSegment(claim.collectionId, claim.partition ?? undefined);
      // On state before anything can refuse, so a refusal settles under this
      // attempt's own claim.
      await ctx.sequencer!.patchState({
        claim,
        epic,
        taskId: input.taskId,
        attempt: input.attempts,
        ticket,
        goal: input.goal,
        decided: null,
        openedAt: Date.now(),
      });

      // A row naming no issue and phase (a task a conversation filed) runs as
      // this manager's phase, with its task id standing in for the issue
      // (encoded by `taskIssueSegment` when the grammar refuses it). So
      // does a feature row on a board read from the claim: such a board mints
      // its own task ids, unique in their partition, so there the task id
      // keeps two rows with one payload out of one tree, as the derived id
      // does on a fixed board.
      const payload = taskPayload(input, claim === null);
      const phaseName = payload?.phase ?? phase.phase;
      const issue = payload === undefined || claim !== null ? taskIssueSegment(input.taskId) : payload.issue;
      if (payload !== undefined) {
        assertFeatureRowIdentity(input.taskId, payload.issue, phaseName, phase.phase, claim === null);
      }

      // **A conductor serves one tenant, and refuses any other.**
      //
      // The board's collection identity is partitioned by tenant at
      // construction, so a request resolved to a different tenant would be
      // reading and claiming rows that are not its own — the ledger half of the
      // isolation the checkout and branch already have. Refused here for the
      // same reason the phase is: this is where the wrong work would execute.
      const resolvedTenant = requestTenant(ctx);
      if (resolvedTenant !== tenant) {
        throw new HarnessAttemptFailed(
          `[harness-manager] this conductor serves ${describeTenant(tenant)}; the request resolved ` +
            `to ${describeTenant(resolvedTenant)}. Refusing rather than running one tenant's ` +
            `task in another's workspace.`,
        );
      }

      // **A review needs a host that can hold a wait** (FIX-2163), refused
      // before any coding run: a run whose changes it couldn't hold for review
      // would otherwise be spent, or completed unreviewed. A host with durable
      // execution offers `resumeWait`; one without leaves it absent.
      if (reviewChanges && ctx.requestHost?.resumeWait === undefined) {
        throw runRefused(
          ctx,
          `[harness-manager] this manager reviews a run's changes (\`reviewChanges\`), which waits for ` +
            `a person, and this host has no durable execution to hold that wait. Turn durable ` +
            `execution on, or turn \`reviewChanges\` off.`,
        );
      }

      // **On a board kept per organization, the run is its starter's** (see
      // `./run-owner`). Checked before anything is derived from this request's
      // principal, so a refused drain opens no record and takes no checkout.
      // The first run records its starter; a row another member owns is
      // refused here, which is the backstop for a board whose drain was not
      // wired with `runOwnerClaimOrder` — that dispatcher refuses before the
      // claim and so charges nothing, where this refusal comes after it. A
      // board read from the claim gets the same check through its own ref:
      // the manager cannot see that board's scope, and on a board one user
      // holds the starter is always that user.
      if (claim !== null || boardCollection!.scope === "org") {
        const principal = runPrincipal(ctx);
        const tasks = await runBoard(ctx);
        const owner = runOwnerOf(tasks.get(input.taskId));
        if (owner === null) {
          await tasks.patchMetadata(input.taskId, {
            [HARNESS_RUN_OWNER_KEY]: runOwnerFor(principal),
          });
        } else if (!isRunOwner(owner, principal)) {
          throw new HarnessAttemptFailed(foreignRunMessage(input.taskId, owner));
        }
      }

      // **One location, three derivations.** The checkout, the branch and the run
      // topic all partition on the same thing — the principal so two users never
      // share a tree or a ref, and the epic so two boards never do either.
      // Building them from one object is what stops a discriminator reaching one
      // and missing another, which would leave the report partitioned and the
      // overwrite on disk.
      const topic = runTopic(epic, issue, phaseName);

      await ctx.sequencer!.patchState({
        issue,
        phase: phaseName,
        topic,
        taskId: input.taskId,
        attempt: input.attempts,
      });

      // **Where the run works, from the workspace host.** Its source is asked
      // now because the checkout's path is recorded on the row and named in
      // the prompt before anything is provisioned. A run already provisioned
      // keeps the repository its record names (see `pinnedAnswer`). With a
      // fixed `sourceRepo` this is the path `checkoutPathFor` derives.
      const recorded = await readRunRow(ctx, topic);
      try {
        assertPlaceAndHeld(recorded);
      } catch (corrupt) {
        throw new HarnessAttemptFailed((corrupt as Error).message);
      }
      // The record is read first because a run it names an older branch for
      // keeps that branch and its tree (see `locationFor`).
      const location = locationFor(
        { principal: runPrincipal(ctx), epic, issue, phase: phaseName },
        recorded?.branch,
      );
      const branch = branchFor(location);
      await ctx.sequencer!.patchState({ branch });
      const pinned = {
        remote: recorded?.remote ?? null,
        baseRef: recorded?.baseRef ?? null,
        baseCommit: recorded?.baseCommit ?? null,
        filesOnly: recorded?.filesOnly ?? null,
      };
      await ctx.sequencer!.patchState({
        ...pinned,
        place: null,
        recordedPlace: recorded?.place ?? null,
        held: recorded?.held ?? null,
      });
      const answer = pinnedAnswer(await host.source(ctx), pinned);
      if (answer.kind === "refused") throw runRefused(ctx, refusedMessage("source", answer));
      const workspacePath = host.locate(answer, { place: placeFor(location) }).cwd;
      await ctx.sequencer!.patchState({ workspacePath });

      // **Read the session the LAST attempt confirmed, before opening clears it.**
      //
      // `openRunRow` applies the attempt-scoped clear, which sets `sessionId` to
      // null — correctly, since the field describes the attempt now running and
      // this one has not reported yet. So the read has to happen here: after the
      // open, it is always `null`.
      //
      // What the value feeds is the harness's `resume` resolver at the bottom of
      // this file, and nothing else. No phase is handed it and no prompt names
      // it: a session id is not something a model can act on, and while the
      // prompt carried one, "the run resumed" and "the run was told" were the
      // same observation.
      //
      // `null` here is the whole self-heal. It means the previous attempt's
      // harness never confirmed a session — it was never sent one, or it was
      // sent one the vendor could not honour — so this attempt starts fresh
      // rather than asking for a dead id again.
      const previousSessionId = recorded?.sessionId ?? null;
      // **Which run this is**, counted on the record and never reset: the
      // second number of the ask marker, so this run is never pointed at a
      // question an earlier turn already asked (`./ask`). A replay of this
      // run counts it once: the same request, on the same turn of the same
      // task. An inline drain runs the turn an answer owes in the request it
      // ran the asking turn in, so the request alone would reuse that run's
      // number, and its marker.
      const runKey = `${ctx.request.identity.id}:${ticket.turn}:${ticket.incarnationId ?? ""}`;
      const run = recorded?.runKey === runKey && recorded.runs != null ? recorded.runs : (recorded?.runs ?? 0) + 1;
      await ctx.sequencer!.patchState({ previousSessionId, run });

      // **Refusal stops the attempt.** The row can be reclaimed between the
      // runner's start gate and this call, and a discarded refusal let the
      // known-stale worker walk on into checkout preparation and paid agent
      // execution — taking the tree ahead of its replacement for roughly a
      // lease-renewal interval.
      await fenced(
        openRunRow(
          ctx,
          identityOf(ctx, harnessCtxState(ctx)),
          { workspacePath, branch, childSessionId: ctx.session.identity.id, run, runKey },
        ),
        "the run row was opened",
      );
    },
  });

  /**
   * Build the prompt, then take the checkout.
   *
   * Ownership is acquired LAST so nothing between the acquire and the harness
   * step can leak a held lock — the harness step's `onSettled` is what releases
   * it, and it only fires once the step has been dispatched.
   */
  /**
   * Provision the run's place, the one its record and prompt name, under the
   * lease the caller holds: asked of the source on this context, refused when
   * the source moved the run since it opened.
   */
  const provisionRunPlace = async (ctx: BlockContext): Promise<WorkspacePlace> => {
    const state = managerState(harnessCtxState(ctx));
    const location = locationFor(
      { principal: runPrincipal(ctx), epic: state.epic!, issue: state.issue!, phase: state.phase! },
      state.branch,
    );
    const answer = pinnedAnswer(await host.source(ctx), state);
    if (answer.kind === "refused") throw runRefused(ctx, refusedMessage("source", answer));
    if (host.locate(answer, { place: placeFor(location) }).cwd !== state.workspacePath) {
      throw new HarnessAttemptFailed(
        `[harness-manager] the run's workspace source changed between opening the run and ` +
          `provisioning it, so the place its prompt names is not where it would work. ` +
          `Stopping before the agent runs.`,
      );
    }
    return provisionPlace(ctx, answer, location);
  };

  const prepare = handler({
    name: "harness-manager-prepare",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ prompt: z.string() }),
    sequencerStateSchema: managerStateSchema,
    // The host's capabilities ride alongside the manager's own, so a phase's
    // prompt builder reads its collections off `ctx.resources` like any block.
    uses: [managerCapability, ...(guardedUses ?? [])],
    // **`ctx` is annotated rather than inferred, and the annotation is
    // load-bearing.** The host's `uses` widens the context `handler()` infers —
    // its capabilities' resources and namespaces appear in it — and a narrowed
    // `BlockContext` is not assignable to a plain one, so every helper called
    // below would need a cast. Narrowing here keeps the option's cost at the
    // option; `createManagerCapability` carries the long form of the same
    // argument.
    execute: async (input, ctx: BlockContext) => {
      const state = managerState(harnessCtxState(ctx));

      // **Two channels, two meanings, and they never carry each other.** The
      // board's `feedback` says why the LAST ATTEMPT FAILED; `answers` say what
      // a person answered. Handing an answer back through `feedback` is the
      // cheapest wiring and the one that already means something else — a run
      // would be told *"your last attempt stopped because: take the second
      // option."*
      //
      // Read from the task's row, where each answer is kept beside its
      // question (FIX-2133), and read here rather than inside the builder so
      // the ORDER is the manager's: a fold whose order depends on where a phase
      // happens to sort is a prompt that changes between replays.
      const answers = answeredQuestions(await committedRow(ctx));

      const run: PromptRunContext = {
        epic: state.epic!,
        issue: state.issue!,
        phase: state.phase!,
        attempt: input.attempts,
        workspacePath: state.workspacePath!,
        branch: state.branch!,
        ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
        ctx,
        task: {
          goal: input.goal,
          ...(input.title !== undefined ? { title: input.title } : {}),
          ...(input.context !== undefined ? { context: input.context } : {}),
          ...(input.input !== undefined ? { input: input.input } : {}),
          ...(input.deps !== undefined ? { deps: input.deps } : {}),
          ...(input.priorWork !== undefined ? { priorWork: input.priorWork } : {}),
        },
        answers,
        // The prompt is the only place this path is named, which is what makes
        // the ask FORCED rather than spontaneous — the harness offers no seam
        // for a question to leave through (see `./ask`).
        askMarkerPath: askMarkerPath(state.workspacePath!, input.attempts, state.run!),
      };

      // **Bounded for the same reason the completion check is.** This await
      // happens after the row is claimed and opened and before the agent's own
      // deadline starts, so an unbounded hook leaves the row `in_progress` with
      // nothing to settle it — past the budget a host sized its shutdown from.
      // `isDone` was bounded and this was not, which is the same enumeration
      // failure the rest of this branch keeps producing: two public hooks, one
      // rule, one of them carried through.
      //
      // Unlike `isDone`, the derived budget did NOT already reserve time here,
      // so `harnessDrainBudgetMs` gains the term. A bound the budget does not
      // account for would make the advertised number wrong in the other
      // direction, which is the defect being fixed, inverted.
      const prompt = await withDeadline(
        async () => runPhase.buildPrompt(run),
        NETWORK_CALL_TIMEOUT_MS,
        `the ${state.phase} phase's prompt builder`,
      );

      // **Ownership first, then provisioning.** Validating the worktree and
      // then waiting for the lock leaves a window in which the displaced
      // attempt — still running — switches branches, so the replacement
      // launches in a checkout whose HEAD no longer matches the branch it was
      // told about, and an existing pull request for that branch can satisfy
      // completion incorrectly. Acquiring first removes the window rather than
      // validating twice around it.
      //
      // Safe in this order because `acquireCheckout` needs only the path, not a
      // provisioned tree: it creates the parent directory and locks beside the
      // checkout.
      const lease = await acquireCheckout(
        state.workspacePath!,
        `${input.taskId}#${input.attempts}`,
        ownership,
        Date.now,
        // Cancellation stops the WAIT. A cancelled attempt that kept polling
        // could still acquire and provision a tree whose result it can no
        // longer record — and the wait is now long enough for that to cost a
        // replacement most of an hour.
        ctx.signal,
      );
      // **Persisted immediately, before anything that can throw.** The window
      // between taking the lock and recording how to release it is a window in
      // which a crash orphans the lock until the stale bound expires — the same
      // exposure the module-level map had when the process died, now bounded to
      // one `patchState` instead of the whole provisioning call.
      await ctx.sequencer!.patchState({
        lockPath: lease.lockPath,
        leaseToken: lease.token,
      });
      // **Provisioned through the host, under the lease.** The source is asked
      // again on THIS context, because a collection ref it hands back is bound
      // to the context that resolved it. If its answer moved the run since
      // the row was opened, the prompt already names the old place, so the
      // attempt stops rather than running the agent somewhere else.
      // The branch the run opened on decides the derivation, so this step
      // derives the place the open step did.
      const place = await provisionRunPlace(ctx);
      await ctx.sequencer!.patchState({ place });
      // A checkout rebuilt or started over on another machine has no vendor
      // conversation to continue: that lives on the machine it ran on.
      if (place.origin === "held" || place.origin === "base") {
        await ctx.sequencer!.patchState({ previousSessionId: null });
      }

      // **The repository and base the run started on, kept on its record**
      // the first time it is provisioned, so a later change to its source
      // applies to new rows and never moves this one. A run with no
      // repository is kept as one, so a repository added later does not
      // move it off the files it saved.
      if (state.remote == null && state.filesOnly !== true) {
        const pin =
          place.repo !== undefined
            ? {
                remote: place.repo.remote,
                baseRef: place.repo.baseRef ?? null,
                baseCommit: place.repo.baseCommit ?? null,
              }
            : { filesOnly: true };
        await fenced(
          writeRunRow(ctx, identityOf(ctx, harnessCtxState(ctx)), pin),
          "the run's source was recorded",
        );
        await ctx.sequencer!.patchState(pin);
      }

      // Steers after the phase prompt, once the checkout exists (FIX-2086):
      // a third channel beside `feedback` and `answers`, so a failure and a
      // person's answer stay their own sections. An answer is the phase's
      // (`answers`), so it is not shown here a second time.
      const steers =
        (
          await takeSteersFor(ctx, `brief:${ctx.request.identity.id}`, (row) =>
            (row.steers ?? []).filter((steer) => steer.takenBy === row.attempts && !isAnswer(row, steer)),
          )
        )?.steers ?? [];
      const restored = heldPromptSection(place, state.held);
      const withRestored = restored === undefined ? prompt : `${prompt}\n\n${restored}`;
      return {
        prompt: steers.length === 0 ? withRestored : `${withRestored}\n\n${renderSteers(steers, STEERS_IN_BRIEF)}`,
      };
    },
  });

  /**
   * Read the verdict, then decide. **Three outcomes, in this order, and the
   * order is the design. Every arm is a conjunction.**
   *
   * 1. **The verdict did NOT fail AND this run's marker holds a question →
   *    hold the task on it** (the ask step), then return normally. A held
   *    row settles only by cancel, so the child session's request ends with
   *    the task waiting on the question and the run costs nothing while a
   *    person thinks. The answer owes the task one more turn on this attempt.
   * 2. **The verdict succeeded AND the done-condition holds → return.**
   * 3. **Anything else → throw.** A question a failed run wrote is never
   *    asked: the attempt is over, so nobody would be waiting on its answer.
   *
   * **The question is asked FIRST, and the order is the whole guarantee.** The
   * done-condition is not attempt-scoped and cannot be: the branch is derived
   * from (epic, issue, phase), so every attempt on a task shares it, and the
   * implement phase's probe reports on the branch. Attempt 1 opens a pull
   * request and fails; attempt 2 asks a question and stops having produced
   * nothing; the probe still says done. Consulted first, that reading drops
   * a question a person was about to be shown and records the phase as
   * succeeded — a silent wrong success arriving through the completion check.
   *
   * A question marker is the run stating outright that it needs a decision.
   * That statement is about THIS attempt and nothing else, so it is the one to
   * believe when the two disagree. The cost is a run that asked, unblocked
   * itself and finished anyway: it now waits for one human round trip instead
   * of completing. Rejected alternative: keep the old order but scope the probe
   * to this attempt, which needs a pull-request timestamp compared against a
   * locally-stamped attempt start — a clock-skew race guarding a rarer case
   * than the one it opens.
   *
   * **Completion is a conjunction.** A run can open the pull request and THEN
   * exhaust its turn budget — the SDK reports that as an errored handle rather
   * than a throw, which is this whole lab's premise. So a done-condition
   * consulted alone would complete the row for a run that failed. A successful
   * verdict whose done-condition does not hold is a failed attempt too.
   *
   * **Arm 1's FIRST half is the one easy to drop, and dropping it is the same
   * defect from the other side.** A question is only worth holding the board
   * for if the run is still in a position to use the answer, and a run that
   * asked and then failed is not — the SDK reports its most common failures by
   * *returning*. An arm gated on the marker alone matches that run, holds its
   * task, and waits on a person for an attempt that is already dead: the row
   * never re-pends, the retry budget is never spent, and nothing reports it. A
   * silent stall, which is the mirror of the silent success arm 2 exists to
   * kill.
   *
   * The run record's `outcome` stays `running` while its task waits on the
   * question, deliberately: the attempt is not over, and **the board row is the
   * authority on the job's state** while this record is the manager's own
   * bookkeeping. A fourth outcome here would be a second answer to a question
   * the board already answers.
   */
  const decide = handler({
    name: "harness-manager-decide",
    // **The NEUTRAL contract's fields, and no vendor field at all.** This used
    // to read `resultSubtype` — the SDK's own enum — so the manager could only
    // classify runs from one vendor, which is the coupling the harness contract
    // exists to remove. `outcome` is the framework's three-way reading of the
    // same fact, and every harness owes it.
    //
    // The contract names four optional fields beyond identity and status —
    // terminal text, usage, cost, outcome — so this reads four. An attempt that
    // reports three would otherwise leave the fourth showing the previous
    // attempt's value, silently and only on the attempts that could not report
    // it.
    //
    // `sessionId` is read for nothing: it is on the handle, and it is
    // deliberately NOT what the row records. See the write below.
    inputSchema: z.object({
      status: z.string(),
      sessionId: z.string().nullable(),
      // Which harness produced this handle. Recorded beside the session; the
      // CHECK that a resumed session belongs to the harness now dispatched
      // belongs to the issue that introduces per-task harness choice.
      source: z.string(),
      outcome: z.string().nullable(),
      finalMessage: z.string().nullable(),
      usage: z
        .object({ inputTokens: z.number(), outputTokens: z.number() })
        .nullable(),
      cost: z
        .object({ usd: z.number(), basis: z.string() })
        .nullable(),
    }),
    outputSchema: decisionSchema,
    sequencerStateSchema: managerStateSchema,
    // The done-condition runs in here, and it sees a phase's collections too.
    uses: [managerCapability, ...(guardedUses ?? [])],
    // **`ctx` is annotated rather than inferred, and the annotation is
    // load-bearing.** The host's `uses` widens the context `handler()` infers —
    // its capabilities' resources and namespaces appear in it — and a narrowed
    // `BlockContext` is not assignable to a plain one, so every helper called
    // below would need a cast. Narrowing here keeps the option's cost at the
    // option; `createManagerCapability` carries the long form of the same
    // argument.
    execute: async (handle, ctx: BlockContext) => {
      const state = managerState(harnessCtxState(ctx));
      const identity = identityOf(ctx, harnessCtxState(ctx));
      const succeeded = handle.status === "completed";
      await checkBranchPullRequests(ctx);

      /**
       * What this attempt hands back, kept on state for `settle`: the run's
       * answer (cut), its branch (none for a run with only kept files) and
       * the commits it made. `judged` is the settle step's to set.
       */
      const keep = async (
        settle: "asked" | "complete",
        commits: RunCommits,
        judgeInput: HarnessJudgeInput | null = null,
      ): Promise<HarnessJudgeInput | null> => {
        const output: ManagerOutput = {
          issue: state.issue!,
          phase: state.phase!,
          sessionId: handle.sessionId,
          answer: handle.finalMessage === null ? null : handle.finalMessage.slice(0, MAX_ANSWER_CHARS),
          branch: state.filesOnly === true ? null : state.branch!,
          commits: commits.count,
          judged: false,
          review: null,
        };
        await ctx.sequencer!.patchState({ decided: { settle, output, changes: commits, reviewed: null } });
        return judgeInput;
      };
      // A run of kept files alone has no branch, so nothing on one to review: a verified none.
      const commitsOf = (): Promise<RunCommits> =>
        state.filesOnly === true
          ? Promise.resolve({ count: 0, subjects: [], verified: true })
          : readRunCommits(state.workspacePath!, state.baseRef, state.baseCommit);

      // Everything the run reported goes on the row before anything is decided,
      // so a failed attempt's row is as complete as a successful one's.
      //
      // **`sessionId` is deliberately absent from this write.** The row's
      // session id means one thing — the session the harness CONFIRMED it was
      // in — and the harness's own `onSession` hook is its sole writer, firing
      // the moment the vendor names it. Writing the handle's id here would put
      // back the path that re-persisted a dead one: a resume the vendor
      // refuses can return a handle still carrying the id that was SENT, and
      // recording that makes the next attempt resume it again, forever.
      // Leaving it to the opening clear is what makes the retry self-heal.
      await fenced(
        writeRunRow(ctx, identity, {
        source: handle.source,
        finalMessage: handle.finalMessage,
        usage: handle.usage,
        costUsd: handle.cost?.usd ?? null,
        childSessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
        }),
        "the verdict was recorded",
      );

      // **The run's kept files, saved at the end of its turn** — before any
      // arm, so a run that asks a question, completes, or fails its check
      // has saved what it wrote either way. Its repository work is held first,
      // while the place is still in hand: a save lets the place go.
      const held = await holdWork(ctx);
      const saved = await saveKeptFiles(ctx);

      // **The ask, before any arm.** Reading THIS run's marker path — never
      // a fixed one: the checkout survives a retry and an answered question's
      // next turn, so an earlier run's question file is still on disk, and a
      // fixed path makes a run that quietly did nothing look exactly like a run
      // that asked.
      const question = await readAskMarker(state.workspacePath!, identity.attempt, state.run!);

      // ── Arm 1: the verdict did NOT fail AND this run asked ──────────────────
      if (succeeded && question !== undefined) {
        // After the verdict and the saves: the run's work is held and its kept
        // files saved before the turn ends, and the checkout lease is free.
        // Returning normally is the point: the request ends with the task held
        // on the question, which nothing but its answer or a cancel ends.
        await holdOnQuestion(ctx, question);
        return keep("asked", await commitsOf());
      }

      // ── Arm 2: succeeded AND done ──────────────────────────────────────────
      if (succeeded) {
        // **Bounded, because the whole-worker budget already says it is.**
        // `harnessDrainBudgetMs` reserves `NETWORK_CALL_TIMEOUT_MS` for this
        // step. `isDone` is a public seam, so another phase's check was
        // unbounded and could outlive the budget a host sized its shutdown
        // from, leaving the row `in_progress` with nothing to settle it. The
        // bound is the constant the budget already spends, so it makes the
        // advertised number true rather than adding one.
        const done = await withDeadline(
          async () =>
            runPhase.isDone({
              epic: state.epic!,
              issue: state.issue!,
              phase: state.phase!,
              attempt: identity.attempt,
              workspacePath: state.workspacePath!,
              branch: state.branch!,
              // **Crossed as reported, and compared on by nothing here.** This
              // block's own input schema reads `outcome` as a plain string
              // deliberately, so a harness that reports outside the contract's
              // three words is seen here rather than refused at the door;
              // narrowing it or defaulting it to `finished` would put the
              // silent partial success back, one layer down. `null` stays
              // `null`: "reported nothing" is its own fact.
              stopReport: handle.outcome,
              answer: handle.finalMessage,
              ctx,
            }),
          NETWORK_CALL_TIMEOUT_MS,
          `the ${state.phase} phase's completion check`,
        );
        if (done) {
          // **Not completed on files it could not save.** Completing is the
          // last save point a run has, so a failed save here would settle the
          // row with the run's work only on this machine. Failing the attempt
          // makes the retry the next save point (`lastSave` names why).
          if (!saved) {
            throw new HarnessAttemptFailed(
              `the ${state.phase} phase is done, but the run's kept files could not be saved, ` +
                `so it is not completed on work that exists only in its workspace`,
            );
          }
          // **Nor on work held nowhere** (BR-8): the retry holds it.
          if (!held) {
            throw new HarnessAttemptFailed(
              `the ${state.phase} phase is done, but the run's work could not be held, ` +
                `so it is not completed on work that exists only on this machine`,
            );
          }
          // Arm 1 returned on every run that asked, so reaching here with a
          // succeeded verdict means the marker was empty. The row is completed
          // by `settle`, once the judge (when this
          // run gets one) has read it: only a board read from the claim, and
          // only a task with a goal to read the answer against.
          const commits = await commitsOf();
          const judgeInput =
            judge !== undefined && state.claim !== null && (state.goal ?? "").trim() !== ""
              ? {
                  goal: state.goal!,
                  answer: handle.finalMessage === null ? null : handle.finalMessage.slice(0, MAX_ANSWER_CHARS),
                  commits: { count: commits.count, subjects: commits.subjects },
                }
              : null;
          return keep("complete", commits, judgeInput);
        }
      }

      // ── Arm 3: anything else, INCLUDING a failed verdict with a question ───
      if (!succeeded) {
        // **Named in the framework's vocabulary, plus whatever the run said.**
        // The outcome word is what a reader can act on across harnesses; the
        // closing text is the only part carrying what actually went wrong, and
        // this string becomes the next attempt's feedback.
        //
        // `null` here is the contract's "no terminal result arrived" — a
        // distinct fact from `"failed"`, which is a terminal result that
        // failed, including one whose vendor subtype this framework version
        // does not recognise.
        const because = handle.outcome ?? "no result reported";
        throw new HarnessAttemptFailed(
          `the run stopped without finishing: ${because}` +
            (handle.finalMessage === null ? "" : ` — ${handle.finalMessage}`),
        );
      }
      // **Phrasing, not a decision.** The arm was already chosen — the check
      // refused — and all this reads the stop report for is to say WHICH kind
      // of clean end the phase refused, because this string becomes the next
      // attempt's feedback and "still not done" alone loses the one fact that
      // explains it. A run that ran out of road and one that finished and got
      // it wrong want different next prompts.
      //
      // **Every clean end gets its own words, not two.** `status` and `outcome`
      // are independent fields, so terminating normally while reporting
      // `failed` — or reporting nothing at all — is a pairing this contract
      // permits. Folding those into "finished cleanly" would tell the next
      // attempt the run succeeded and simply missed the target, which is the
      // same narrator-says-it-went-fine defect this field exists to close, one
      // layer up.
      const ended =
        handle.outcome === "finished"
          ? "the run finished cleanly"
          : handle.outcome === "stopped-at-limit"
            ? "the run stopped at its limit"
            : `the run terminated normally reporting ${handle.outcome ?? "no terminal result"}`;
      throw new HarnessAttemptFailed(
        `${ended} and the ${state.phase} phase is still not done`,
      );
    },
  });

  /**
   * The one place a failure is written down — and it re-throws.
   *
   * A rescue handler receives the thrown error as its input and runs with the
   * sequencer's context, so it reaches the same state and the same fence every
   * other write uses. Re-throwing is what keeps settlement the board's: swallow
   * it here and the row would complete for an attempt that failed.
   */
  const recordFailure = handler({
    name: "harness-manager-record-failure",
    inputSchema: z.unknown(),
    outputSchema: z.never(),
    sequencerStateSchema: managerStateSchema,
    uses: [managerCapability],
    execute: async (error: unknown, ctx): Promise<never> => {
      // A failed attempt's owed lines go with it: the next attempt's brief carries every steer.
      owedLines.delete(ctx.request.identity.id);
      // **Release the tree on the way out, whatever failed.**
      //
      // The only other release is the agent step's `onSettled`, which never
      // fires if the throw happened before that step was dispatched — a git
      // timeout, a deleted branch, a worktree on the wrong branch. The lock and
      // its map entry then outlived the attempt, and the next retry waited for
      // the stale window to expire before it could even start.
      //
      // Raising that window to cover provisioning made this strictly worse: it
      // went from the run's deadline to the deadline PLUS the git budget, so
      // the fix for one defect lengthened this one. Released here rather than
      // around `provisionCheckout`, because the rule is "any failure after the
      // lock is taken releases it" — a `try` around today's one throwing call
      // is the same fix aimed at the instance, and the next step added between
      // acquire and dispatch would not be covered.
      //
      // Idempotent: the release is token-guarded, so the harness path's
      // `onSettled` having already released makes this a no-op, and it can
      // never remove a replacement's lock.
      releaseLeaseFromState(ctx);

      // **A failed run keeps what it wrote.** Saved after the lease is let go:
      // the save touches only the run's kept files, never the checkout. A
      // failure before provisioning has no place, and one after `decide`
      // already saved has released it, so this is a no-op for both. Its own
      // failure, a superseded attempt's refusal included, must not replace
      // the error this handler is unwinding.
      // Its repository work is held the same way, first, while the place is
      // in hand; a hold `decide` already wrote is unchanged and writes nothing.
      await holdWork(ctx as BlockContext).catch(() => undefined);
      await saveKeptFiles(ctx).catch(() => undefined);
      // A failed run's pull requests are still its own.
      await checkBranchPullRequests(ctx as BlockContext);

      const reason = error instanceof Error ? error.message : String(error);
      const state = ctx.sequencer?.state;
      // **A run held on its owner's question is waiting, not failed.** The
      // task is already held, and a held row settles only by cancel; the
      // record's outcome stays `running`, as on any question.
      if (error instanceof HeldOnQuestion) throw error;
      // A failure BEFORE the row was opened has no identity to fence against —
      // and cannot have left stale metadata either, since nothing was written.
      if (state?.topic != null && state.taskId != null && state.attempt != null) {
        // **The one refusal that is deliberately not read.** This handler is
        // already unwinding and re-throws below whatever happens, so a refusal
        // means only that a superseded attempt recorded nothing — which is the
        // correct outcome. Every other call site stops on refusal.
        await writeRunRow(
          ctx,
          identityOf(ctx, state),
          { outcome: "failed", reason },
        );
      }
      // A refusal's task row is ended by the recorder, not retried (see
      // `HarnessRunRefused`); this handler updates only the run record above.
      throw error;
    },
  });

  /**
   * **The slot, called once.**
   *
   * Every feed reads or writes MANAGER state — never the block's input
   * (BP-031). A model holding the harness as a tool can choose neither where
   * the run writes nor what conversation it continues, and that is structural
   * rather than a convention this manager keeps: a resolver is handed the
   * context alone, so the caller's prompt is not reachable from here at all.
   *
   * All three reach the manager's state through `harnessCtxState`, which is
   * where the cast lives and says why.
   */
  const harnessBlock = harness({
    // The run edits ITS checkout, and the record of what it touched is keyed
    // there too.
    cwd: (ctx) => managerState(harnessCtxState(ctx)).workspacePath!,
    // Which session this attempt continues. `null` on attempt 1, and on every
    // attempt after one whose harness named no session — a resume the vendor
    // refused, above all — so a dead id is not re-sent forever.
    resume: (ctx) => harnessCtxState(ctx)?.previousSessionId ?? null,
    // **Fenced like every other write.** A refusal here means a replacement
    // holds the row, and recording this attempt's session onto it would hand
    // the replacement's next attempt a conversation that belongs to a run
    // nobody is waiting on. Stopping is also the right answer for the run
    // itself: it is mid-stream in paid model work on a row it no longer owns.
    onSession: async (sessionId, ctx) => {
      await fenced(
        writeRunRow(ctx, identityOf(ctx, harnessCtxState(ctx)), {
          sessionId,
        }),
        "the harness named its session",
      );
    },
    // **Not fenced, unlike `onSession`.** A replaced attempt's window is still
    // a true reading of the pool, and it lands in the run owner's own row, not
    // on the run record a replacement holds. The harness swallows a throw.
    onUsage: async (report, ctx) => {
      await recordHarnessUsage(ctx, report);
    },
    // Held by the step's watch, which hands it each steer the poll takes.
    onSteerable: (steer, ctx) => {
      const watch = steerWatches.get(ctx.request.identity.id);
      if (watch === undefined) return;
      watch.steer = steer;
      if (steer !== null) watch.kick();
    },
    // The step's notes, throttled, onto the task's `statusNote`.
    onActivity: (activity, ctx) => {
      const note = progressNoteOf(activity);
      if (note !== null) progressNotes.get(ctx.request.identity.id)?.report(note);
    },
  });

  /**
   * Each running step's progress notes (FIX-2290), by request. Written through
   * the board's `reportProgress` with the claim this run holds, so a replaced
   * attempt's note declines rather than land on its replacement's row; a
   * decline stops that step's notes. Dropped when the step ends, so a step a
   * steer adds starts its own window. Started with the step, from the step's
   * own context, like the steer watch.
   */
  const progressNotes = new Map<string, ProgressNotes>();
  const startProgressNotes = (ctx: BlockContext): void => {
    progressNotes.get(ctx.request.identity.id)?.stop();
    progressNotes.set(
      ctx.request.identity.id,
      throttledNotes(async (statusNote) => {
        const state = harnessCtxState(ctx);
        const claim = state?.ticket ?? null;
        const taskId = managerState(state).taskId;
        if (claim === null || taskId === null) return false;
        const board = await runBoard(ctx);
        if (board.reportProgress === undefined) return false;
        const outcome = await board.reportProgress(taskId, { statusNote }, { claim });
        return outcome.outcome !== "declined";
      }),
    );
  };
  const stopProgressNotes = (ctx: BlockContext): void => {
    const requestId = ctx.request.identity.id;
    progressNotes.get(requestId)?.stop();
    progressNotes.delete(requestId);
  };

  /**
   * **The judge, as a step, never failing the run by failing itself.** Its
   * output is read through the verdict schema; a throw, a timeout or an
   * answer of another shape becomes "no verdict", and the run settles on the
   * phase's check alone (`judged: false`). Absent when no judge was given, so
   * a manager without one runs the chain it always ran.
   */
  //
  // Wrapped in a sequencer of the manager's own, whose chain-level rescue
  // catches a failure anywhere beneath it: a block-level rescue on the host's
  // block does not reach a failure inside a composite judge (a sequencer
  // around an evaluator, which is what a judge usually is).
  const judgeStep =
    judge === undefined
      ? undefined
      : sequencer({ name: `${name}-judge`, inputSchema: harnessJudgeInputSchema })
          .step(judge.block)
          .step(
            handler({
              name: `${name}-judge-verdict`,
              inputSchema: z.unknown(),
              outputSchema: z.object({ verdict: harnessJudgeVerdictSchema }),
              execute: (verdict: unknown) => ({ verdict: judgeVerdictReadSchema.parse(verdict) }),
            }),
          )
          .rescue([
            {
              block: handler({
                name: "harness-manager-judge-unavailable",
                inputSchema: z.unknown(),
                outputSchema: z.object({ verdict: z.null() }),
                execute: (error: unknown) => {
                  console.warn(
                    `[harness-manager] the judge gave no verdict (${error instanceof Error ? error.message : String(error)}); ` +
                      `settling on the phase's check alone.`,
                  );
                  return { verdict: null };
                },
              }),
            },
          ]);

  /**
   * Settle what `decide` decided. A task held on the run's question has
   * nothing left to settle. A run that passed its check completes, unless a
   * judge read it and, at or over its floor, said `not-done` (the attempt fails
   * with its reason, which is the next attempt's feedback) or `ask` (the task
   * is held on its reason, through the ask step every question takes).
   */
  const settle = handler({
    name: "harness-manager-settle",
    // `null` when no judge ran (`decide`'s output, passed through), the judge
    // step's verdict when one did.
    inputSchema: z.object({ verdict: harnessJudgeVerdictSchema.nullable() }).nullable(),
    outputSchema: managerOutputSchema,
    sequencerStateSchema: managerStateSchema,
    uses: [managerCapability],
    execute: async (input: { verdict: HarnessJudgeVerdict | null } | null, ctx: BlockContext) => {
      const state = managerState(harnessCtxState(ctx));
      const decision = state.decided!;
      if (decision.settle === "asked") return decision.output;
      // Cancelled while it waited for review: the run records nothing more.
      if (decision.reviewed === "cancelled") return decision.output;
      // Changes asked for and no step took them (the steer check found none to
      // take): never completed over the request.
      if (decision.reviewed === "revise") {
        throw new HarnessAttemptFailed("the review asked for changes, and no step of this run took them");
      }
      const read = input?.verdict ?? null;
      const identity = identityOf(ctx, state);
      if (read !== null && read.verdict !== "done" && read.confidence >= judge!.floor) {
        if (read.verdict === "not-done") {
          throw new HarnessAttemptFailed(`the judge found the task not done: ${read.reason}`);
        }
        await holdOnQuestion(ctx, read.reason);
        return { ...decision.output, judged: true };
      }
      await fenced(
        writeRunRow(ctx, identity, { outcome: "succeeded", reason: null }),
        "the row was completed",
      );
      const review = decision.reviewed === "accepted" || decision.reviewed === "deadline" ? decision.reviewed : null;
      return { ...decision.output, judged: read !== null, review };
    },
  });

  /**
   * **The review of a run's changes** (FIX-2163), between the judge and the
   * steer check before the settle; a pass-through unless `reviewChanges` is
   * on. A run that passed its check (and that a judge found done, or read
   * under its floor, or that no judge read) waits for a person's review when
   * its branch has commits over its base, or when they couldn't be read: only
   * a verified zero skips it. The manager's one suspension; questions hold.
   *
   * - **accepted**: the settle completes the task, with no harness run.
   * - **revise**: the words are written as the user's steer, so the steer
   *   check after this takes them into one more step of the same coding
   *   session, on the same attempt, which comes back here. A run whose harness
   *   confirmed no session can't be continued: the try fails, and the steer
   *   stays on the row for the next try's brief.
   * - **the host's deadline**: the task completes with `review: "deadline"`.
   * - **cancelled**: nothing more is recorded, and no run starts.
   *
   * The prompt is read from state alone, so a resume, which runs this step's
   * code again up to the wait, reads nothing new before it.
   */
  const reviewStep = handler({
    name: `${name}-review`,
    inputSchema: z.object({ verdict: harnessJudgeVerdictSchema.nullable() }).nullable(),
    outputSchema: z.object({ verdict: harnessJudgeVerdictSchema.nullable() }).nullable(),
    sequencerStateSchema: managerStateSchema,
    uses: [managerCapability],
    execute: async (input: { verdict: HarnessJudgeVerdict | null } | null, ctx: BlockContext) => {
      const state = managerState(harnessCtxState(ctx));
      const decision = state.decided;
      if (!reviewChanges || decision?.settle !== "complete") return input;
      const read = input?.verdict ?? null;
      // The judge's not-done fails the try and its ask holds a question, at the settle, as without review.
      if (read !== null && read.verdict !== "done" && read.confidence >= judge!.floor) return input;
      const changes = decision.changes;
      if (changes?.verified === true && changes.count === 0) return input;
      const reviewed = async (outcome: "accepted" | "deadline" | "revise" | "cancelled") =>
        ctx.sequencer!.patchState({ decided: { ...decision, reviewed: outcome } });

      let asked: Awaited<ReturnType<BlockContext["waitForUser"]>>;
      try {
        asked = await ctx.waitForUser({
          kind: "review",
          title: "Review the run's changes",
          prompt: reviewPrompt(changes, decision.output.branch, read),
          resumeSchema: harnessReviewAnswerSchema,
          data: {
            branch: decision.output.branch,
            commits: changes?.verified === true ? changes.count : null,
            subjects: changes?.subjects ?? [],
            judge: read,
          },
        });
      } catch (error) {
        if (!(error instanceof SuspensionTimeoutError)) throw error;
        await reviewed("deadline");
        return input;
      }
      if (asked.cancelled) {
        await reviewed("cancelled");
        return input;
      }
      const answer = harnessReviewAnswerSchema.parse((asked as { answer: unknown }).answer);
      if (answer.verdict === "accepted") {
        await reviewed("accepted");
        return input;
      }

      // The words, as the user's steer on the row: keyed by this round, so a
      // resume that runs this again adds it once.
      const board = await runBoard(ctx);
      if (board.steer === undefined) {
        throw new Error(`[harness-manager] the board "${board.collectionId}" keeps no steers, so a review can't ask for changes.`);
      }
      const written = await board.steer(state.taskId!, {
        message: answer.words,
        from: "user",
        key: `review:${ctx.request.identity.id}:${state.steerSteps ?? 0}`,
      });
      if (written.outcome === "declined") {
        if (written.reason === "steer-limit") {
          throw new HarnessAttemptFailed(
            `the review asked for changes, and the task has taken the most steers it can (${MAX_STEERS})`,
          );
        }
        throw new HarnessAttemptSuperseded("the review's changes were written");
      }
      if ((await readConfirmedSession(ctx, state.topic!, state.attempt!)) === null) {
        throw new HarnessAttemptFailed(
          `the review asked for changes, and the run's harness confirmed no coding session to continue; ` +
            `the next try takes them: ${answer.words}`,
        );
      }
      await reviewed("revise");
      return input;
    },
  });

  /**
   * Poll the row while the step runs. A run that offers a live steer is handed
   * each untaken steer (taken first, so it is taken once); otherwise, with
   * `stopsOnAbort`, the step is stopped (not the request) for it. Without
   * either, nothing is read: the step's own end takes the steer.
   */
  const steerWatches = new Map<string, SteerWatch>();
  const watchForSteers = (ctx: BlockContext): AbortSignal | undefined => {
    const requestId = ctx.request.identity.id;
    const controller = new AbortController();
    const watch: SteerWatch = { stopped: false, timer: undefined, steer: null, handed: 0, polling: false, kick: () => {} };
    // The step ended while a poll was mid-read: `stopWatching` dropped this
    // watch, so the poll stops rather than read the row for good.
    const live = () => steerWatches.get(requestId) === watch;
    const stop = () => {
      watch.stopped = true;
      controller.abort(new Error("[harness-manager] stopped for a steer"));
    };
    // Polled only while there is something to do: a stop to make, or a live steer to hand.
    const wanted = () => options.stopsOnAbort === true || watch.steer !== null;
    const schedule = () => {
      if (live() && !controller.signal.aborted && watch.timer === undefined && !watch.polling) {
        watch.timer = setTimeout(() => void poll(), STEER_POLL_MS);
      }
    };
    const poll = async () => {
      watch.timer = undefined;
      watch.polling = true;
      try {
        if (!wanted()) return;
        const state = managerState(harnessCtxState(ctx));
        const row = await committedRow(ctx);
        if (!live()) return;
        const owed =
          row !== undefined &&
          row.status === "in_progress" &&
          row.attempts === state.attempt &&
          // This turn's own row (FIX-2133 D3): a later turn of the attempt is another run's.
          (state.ticket == null || (row.turn ?? 0) === state.ticket.turn) &&
          untakenSteers(row).length > 0;
        // Stopped only once the harness confirmed a session to resume: a stop
        // before that would cost the attempt the steer must not use. A line
        // handed live needs one too, for the step a refusal falls back to.
        const confirmed = owed && (await readConfirmedSession(ctx, state.topic!, state.attempt!)) !== null;
        if (!live() || !confirmed) return;
        const steer = watch.steer;
        if (steer !== null) {
          watch.handed += 1;
          // Named by the step too: a request's later step must not read an earlier step's take as its own.
          const takenIn = `live:${requestId}:${state.steerSteps ?? 0}:${watch.handed}`;
          const nextStep = owedFor(requestId);
          const taking = (async () => {
            const take = await takeSteersFor(ctx, takenIn, (now, id) => steersTakenIn(now, id));
            if (take === null || take.steers.length === 0) return;
            showTakenSteers(ctx, take.taken);
            // The step ended, or its run withdrew the offer, while the take wrote
            // the row: these lines are the next step's, never dropped (D2).
            if (!live() || watch.steer !== steer) {
              nextStep.lines.set({ steers: take.steers }, "refused");
              return;
            }
            handLive(ctx, steer, take.steers, () => {
              if (options.stopsOnAbort === true && live() && !controller.signal.aborted) stop();
            });
          })();
          nextStep.taking.add(taking);
          try {
            await taking;
          } finally {
            nextStep.taking.delete(taking);
          }
          return;
        }
        stop();
        return;
      } catch {
        // A read that fails stops nothing: the step's own end takes the steer.
      } finally {
        watch.polling = false;
        if (wanted()) schedule();
      }
    };
    watch.kick = schedule;
    steerWatches.set(requestId, watch);
    if (wanted()) schedule();
    return options.stopsOnAbort === true ? controller.signal : undefined;
  };

  /**
   * Lines a request took for its run that the run didn't take into its turn
   * (FIX-2254 D2), owed to its next step. The row has no untake, so these are
   * kept here, beside the row's taken mark: refused lines, and lines still
   * waiting on the run's answer when its step ended.
   */
  const owedLines = new Map<string, OwedLines>();
  const owedFor = (requestId: string): OwedLines => {
    let owed = owedLines.get(requestId);
    if (owed === undefined) {
      owed = { lines: new Map(), taking: new Set() };
      owedLines.set(requestId, owed);
    }
    return owed;
  };

  /**
   * Hand taken steers to the run as one line. **Every exit hands it on or
   * counts it refused, never drops it** (D2): `refused` is owed to the next
   * step; an answer still pending when the step ends is owed too, marked as
   * one the conversation may already hold.
   */
  const handLive = (ctx: BlockContext, steer: HarnessSteer, steers: ShownSteer[], onRefused: () => void): void => {
    const owed = owedFor(ctx.request.identity.id);
    const handed: PendingLine = { steers };
    owed.lines.set(handed, "pending");
    const refused = () => {
      // Settled after the next step already counted it: that step has it.
      if (!owed.lines.has(handed)) return;
      owed.lines.set(handed, "refused");
      onRefused();
    };
    void steer(renderSteers(steers, STEERED_WHILE_RUNNING)).then(
      (answer) => {
        if (answer === "delivered") owed.lines.delete(handed);
        else refused();
      },
      refused,
    );
  };

  /** Take what this request owes its run's next step, in the order its lines were taken, clearing it. */
  const takeOwed = (requestId: string): { steers: ShownSteer[]; maybeHeld: boolean } => {
    const owed = owedLines.get(requestId);
    owedLines.delete(requestId);
    if (owed === undefined) return { steers: [], maybeHeld: false };
    const lines = [...owed.lines];
    owed.lines.clear();
    return {
      steers: lines.flatMap(([line]) => line.steers),
      maybeHeld: lines.some(([, state]) => state === "pending"),
    };
  };

  // A watch that stopped its step stays until the rescue reads it; any other
  // goes when its step ends, so the map holds only steps still running.
  const stopWatching = (ctx: BlockContext): void => {
    const requestId = ctx.request.identity.id;
    const watch = steerWatches.get(requestId);
    if (watch === undefined) return;
    if (watch.timer !== undefined) clearTimeout(watch.timer);
    watch.timer = undefined;
    watch.steer = null;
    if (!watch.stopped) steerWatches.delete(requestId);
  };

  // The harness step, with what a steer's stop does to it: a step stopped for
  // a steer ends with a marker, not an error, so the request goes on.
  const harnessStep = sequencer({ name: `${name}-harness-step`, inputSchema: z.object({ prompt: z.string() }).passthrough() })
    .step(harnessBlock, {
      // The cancellable-under-a-deadline obligation, met by a primitive core
      // already has: this composes into the block's own signal, which the SDK
      // path forwards into the query's abort controller. A steer's watch
      // composes in beside it.
      abortSignal: (ctx) => {
        const deadline = AbortSignal.timeout(runTimeoutMs);
        // Armed for every step: a run may offer a live steer once it starts.
        const steer = watchForSteers(ctx);
        startProgressNotes(ctx);
        return steer === undefined ? deadline : AbortSignal.any([deadline, steer]);
      },
      // Fires on every exit from the dispatch — returned, threw, or
      // suspended. The tree is only written by the agent, so releasing the
      // moment it stops is tighter than holding through the verdict; a step
      // the request runs next for a steer takes it again.
      onSettled: (ctx) => {
        stopWatching(ctx);
        stopProgressNotes(ctx);
        releaseLeaseFromState(ctx);
      },
    })
    .rescue([
      {
        block: handler({
          name: `${name}-stopped-for-steer`,
          inputSchema: z.unknown(),
          outputSchema: z.unknown(),
          execute: (error: unknown, ctx) => {
            const watch = steerWatches.get(ctx.request.identity.id);
            steerWatches.delete(ctx.request.identity.id);
            if (watch?.stopped !== true) throw error;
            return STOPPED_FOR_STEER;
          },
        }),
      },
    ]);

  /**
   * One more step for a steer (FIX-2086), when this attempt still has an
   * untaken steer or the step was stopped for one: it resumes the session
   * this attempt confirmed, with the checkout taken again. None when a step
   * that ended on its own took nothing (the gate's check owes the turn), or
   * no session was confirmed and the step wasn't stopped. Each step takes a
   * steer or follows a stop, so the steer cap bounds them; past it the
   * attempt fails.
   */
  const stepForSteer = async (ctx: BlockContext, stopped: boolean): Promise<{ prompt: string; again: true } | undefined> => {
    const state = managerState(harnessCtxState(ctx));
    const row = await committedRow(ctx);
    // Only this attempt's own row: a task cancelled, finished or claimed again
    // since takes no more steps from this request.
    const ours =
      row !== undefined &&
      row.status === "in_progress" &&
      row.attempts === state.attempt &&
      // A later turn of the attempt claimed since is another run's (FIX-2133 D3).
      (state.ticket == null || (row.turn ?? 0) === state.ticket.turn);
    // What the run didn't take into its turn: counted here with the untaken
    // steers, so the step's end, a stop and the settle all carry it. A live
    // take still writing the row lands first, or its lines would miss both.
    await Promise.allSettled([...(owedLines.get(ctx.request.identity.id)?.taking ?? [])]);
    const carried = takeOwed(ctx.request.identity.id);
    if (!ours) {
      if (!stopped) return undefined;
      throw new HarnessAttemptFailed(STALE_AFTER_STOP);
    }
    const owed = untakenSteers(row).length > 0 || carried.steers.length > 0;
    if (!owed && !stopped) return undefined;
    const session = await readConfirmedSession(ctx, state.topic!, state.attempt!);
    if (session === null) {
      if (!stopped) return undefined;
      throw new HarnessAttemptFailed(
        `[harness-manager] the run was stopped for a steer, and its harness confirmed no coding session to continue.`,
      );
    }
    const loop = (state.steerSteps ?? 0) + 1;
    if (loop > MAX_STEERS) {
      throw new HarnessAttemptFailed(
        `[harness-manager] the run has already taken ${MAX_STEERS} steps for steers, the most a task's steers can ask for.`,
      );
    }
    const take = await takeSteersFor(ctx, `step:${ctx.request.identity.id}:${loop}`, (now, takenIn) => steersTakenIn(now, takenIn));
    if (take === null) {
      if (!stopped) return undefined;
      throw new HarnessAttemptFailed(STALE_AFTER_STOP);
    }
    const steers = [...carried.steers, ...take.steers];
    if (steers.length === 0 && !stopped) return undefined;
    // The steers this take wrote, as lines in the run's session from their senders.
    showTakenSteers(ctx, take.taken);
    const lease = await acquireCheckout(state.workspacePath!, `${state.taskId}#${state.attempt}`, ownership, Date.now, ctx.signal);
    await ctx.sequencer!.patchState({ lockPath: lease.lockPath, leaseToken: lease.token, previousSessionId: session, steerSteps: loop });
    // A turn's save points let a place with kept files go (`saveKeptFiles`):
    // the step a steer that came during the verdict adds works in it again,
    // provisioned from what was saved, so its own end saves and holds it too.
    if (state.place == null) await ctx.sequencer!.patchState({ place: await provisionRunPlace(ctx) });
    const lead = (stopped ? STOPPED_LEAD : ARRIVED_LEAD) + (carried.maybeHeld ? MAYBE_HELD_NOTE : "");
    return { prompt: steers.length === 0 ? CONTINUE_AFTER_STOP : renderSteers(steers, lead), again: true };
  };

  /** After a harness step: one more step for a steer, or the step's handle on to the verdict. */
  const steerNext = handler({
    name: `${name}-steer-next`,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    sequencerStateSchema: managerStateSchema,
    uses: [managerCapability],
    execute: async (value: unknown, ctx: BlockContext) => {
      // A step that ended on its own after its watch stopped it leaves the watch: it goes here.
      steerWatches.delete(ctx.request.identity.id);
      return (await stepForSteer(ctx, value === STOPPED_FOR_STEER)) ?? value;
    },
  });

  /**
   * Before the settle: a steer that landed while the verdict, the judge or
   * this check ran gets one more step too, resuming the session this attempt
   * confirmed. A run whose harness confirmed none gets no step here: the steer
   * stays on the task untaken, and only a board with a late-steer turn of its
   * own gives it a turn; on any other board the task completes over it. A run
   * held on a question settles nothing: its answer's turn takes the steer.
   */
  const steerBeforeSettle = handler({
    name: `${name}-steer-before-settle`,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    sequencerStateSchema: managerStateSchema,
    uses: [managerCapability],
    execute: async (value: unknown, ctx: BlockContext) => {
      if (managerState(harnessCtxState(ctx)).decided?.settle !== "complete") return value;
      return (await stepForSteer(ctx, false)) ?? value;
    },
  });

  /** Back to the harness step when a steer step was granted. The steer cap fails the attempt first. */
  const steerLoop = {
    when: (value: unknown) => (value as { again?: unknown } | null)?.again === true,
    maxIterations: MAX_STEERS + 1,
  };

  const chain = sequencer({
    name,
    inputSchema: harnessManagerInputSchema,
    outputSchema: managerOutputSchema,
    stateSchema: managerStateSchema,
  })
    .tap(openRun)
    .step(prepare)
    .step(harnessStep)
    .step(steerNext)
    .loopBack(harnessStep.name, steerLoop)
    .step(decide);
  const worker = (
    judgeStep === undefined
      ? chain
      : chain.stepIf(
          (judgeInput: HarnessJudgeInput | null) => judgeInput !== null,
          (judgeInput: HarnessJudgeInput | null) => judgeInput!,
          judgeStep,
          // Bounded like the phase's own hooks, and reserved for by
          // `harnessDrainBudgetMs({ judge: true })`.
          { abortSignal: () => AbortSignal.timeout(NETWORK_CALL_TIMEOUT_MS) },
        )
  )
    .step(reviewStep)
    .step(steerBeforeSettle)
    .loopBack(harnessStep.name, steerLoop)
    .step(settle)
    .rescue([{ block: recordFailure }]);

  worker.validate();
  return worker;
}

/**
 * A feature row's identity checks: the row's phase is the manager's, and, on a
 * fixed board, its id is the one its `{ issue, phase }` payload derives. A row
 * with no payload (a task a conversation filed) has neither to check. A row on
 * a board read from the claim is keyed by its own task id, so it has no
 * derived id to match.
 */
function assertFeatureRowIdentity(
  taskId: string,
  issue: string,
  phaseName: string,
  configuredPhase: string,
  fixedBoard: boolean,
): void {
  // **A manager runs exactly one phase, and it must be the one on the row.**
  // Without this the caller's phase names the checkout, the branch and the
  // run record while the CONFIGURED phase supplies the prompt and the
  // done-condition — so a row seeded `review` would be handed implement's
  // instructions, judged by implement's completion check, and settled as a
  // completed review. That is the silent wrong success this lab exists to
  // remove, wearing the phase surface as a disguise.
  //
  // Refused here as well as at `seed`, because a task can reach this board
  // by any route that can write a row, and this is where the wrong
  // semantics would actually execute.
  // **Compared canonically, because the identity it guards is.** A durable
  // row outlives the process that filed it, so a restart with the phase
  // spelled differently — `IMPLEMENT` for `implement` — meets rows already
  // on the board. `harnessTaskId` folds case, so those are the SAME task,
  // the same checkout and the same branch; a raw comparison here called them
  // different and refused, after `wake` had claimed the row and charged it.
  // Once per wake, until a valid task's budget was gone, for a mismatch its
  // own identity says does not exist.
  if (!sameSegment(phaseName, configuredPhase)) {
    throw new HarnessAttemptFailed(
      `[harness-manager] task ${taskId} is a "${phaseName}" row on a manager ` +
        `configured for "${configuredPhase}". Refusing rather than running ` +
        `${configuredPhase}'s prompt and completion check against it.`,
    );
  }

  // **And the row's ID must be the one its payload derives**, for the same
  // reason and by the same route. The board capability this flow returns
  // lets a sibling or outer block add a row with an ID of its choosing, and
  // every partition below — checkout, branch, run topic — is built from the
  // PAYLOAD. Two rows carrying one `{ issue, phase }` under two different
  // IDs therefore both pass every guard here and land on one tree, one
  // branch and one run record: duplicate paid model work on a single
  // artifact, one run's record overwritten by the other, and either run's
  // pull request satisfying the other's completion check. "Separate trees
  // pushing one ref is not isolation" is the rule `branchFor` states; this
  // is the same collapse reached through the row id instead. A board read
  // from the claim builds those partitions from the task id rather than the
  // payload, so the collapse can't happen there, and its ids are minted.
  if (!fixedBoard) return;
  const canonicalId = harnessTaskId(issue, phaseName);
  if (taskId !== canonicalId) {
    throw new HarnessAttemptFailed(
      `[harness-manager] task ${taskId} carries the payload for ${canonicalId}. ` +
        `Refusing: the checkout, the branch and the run record are all derived from ` +
        `that payload, so a second row under a different id would run the same work ` +
        `in the same tree.`,
    );
  }
}

/**
 * The claim this run holds on `board`'s row: the ticket the claim gate (or the
 * board's drain) stamped on this request when it claimed the turn.
 *
 * Minted from the row only for a manager run with no claim stamped at all,
 * outside any board's worker: there is no claim to carry, and the open's check
 * of the row is all the fence there is. A stamp naming another attempt of this
 * task is a turn that is over.
 */
function heldTicket(
  ctx: BlockContext,
  board: TaskCollectionRef,
  input: { taskId: string; attempts: number },
): TaskClaimTicket {
  const stamped = currentWorkerClaim(ctx);
  if (stamped !== undefined && stamped.collectionId === board.collectionId && stamped.taskId === input.taskId) {
    if (stamped.attempt !== input.attempts) {
      throw new HarnessAttemptSuperseded("the run was opened (its claim is another attempt's)");
    }
    return stamped;
  }
  const row = board.get(input.taskId);
  if (row === undefined) throw new HarnessAttemptSuperseded("the run was opened (its task is gone)");
  return ticketForClaim(board.collectionId, row, board.partition);
}

/** Whether `steer` answers one of `row`'s questions for a person: a steer a deadline wrote is a message, not an answer. */
function isAnswer(row: Pick<Task, "questions">, steer: Pick<TaskSteer, "answers" | "from">): boolean {
  if (steer.answers === undefined || steer.from === "board") return false;
  const hold = row.questions?.find((h) => h.id === steer.answers);
  return hold !== undefined && isRowQuestion(hold);
}

/**
 * The task's answered questions, oldest first, each with its answer: what a
 * phase's prompt builder is handed as `answers`. Read from the row, the one
 * place a question and its answer are kept.
 */
function answeredQuestions(row: Task | undefined): AnsweredQuestion[] {
  if (row === undefined) return [];
  const answered: AnsweredQuestion[] = [];
  for (const hold of row.questions ?? []) {
    if (!isRowQuestion(hold)) continue;
    const steer = answerOf(row, hold.id);
    if (steer === undefined || !isAnswer(row, steer)) continue;
    answered.push({ question: hold.ask.prompt, answer: steer.message });
  }
  return answered;
}

/** Is the `workspace` option a host, rather than a fixed repository's config? */
function isWorkspaceHost(workspace: WorkspaceConfig | WorkspaceHost): workspace is WorkspaceHost {
  return typeof (workspace as WorkspaceHost).provision === "function";
}

/**
 * What a run provisions from: its source's answer, except that a run already
 * provisioned keeps the repository and base its record names (BR-19), and a
 * run first provisioned with no repository stays on its kept files alone. The
 * answer's kept files still come from the source, which is the only thing
 * that can hand back a collection bound to this context.
 */
function pinnedAnswer(
  answer: RunSourceAnswer,
  pinned: { remote: string | null; baseRef: string | null; filesOnly: boolean | null },
): RunSourceAnswer {
  if (answer.kind === "refused") return answer;
  const files =
    answer.kind === "files"
      ? { projectId: answer.projectId, files: answer.files }
      : answer.projectId !== undefined && answer.files !== undefined
        ? { projectId: answer.projectId, files: answer.files }
        : {};
  if (pinned.filesOnly === true) {
    if (files.projectId !== undefined && files.files !== undefined) {
      return { kind: "files", projectId: files.projectId, files: files.files };
    }
    return {
      kind: "refused",
      reason: "files-run-without-files",
      message:
        "this run started on its project's kept files alone, and its source no longer names " +
        "them, so there is nothing to put it back on.",
    };
  }
  if (pinned.remote === null) return answer;
  return {
    kind: "repo",
    repo: pinned.remote,
    ...(pinned.baseRef !== null ? { baseRef: pinned.baseRef } : {}),
    ...files,
    // Where held work goes is answered for THIS attempt, from its own
    // context, like the kept files (BR-15): never pinned from the record.
    ...(answer.kind === "repo" && answer.heldPrefix !== undefined ? { heldPrefix: answer.heldPrefix } : {}),
  };
}

/** A source's or host's refusal, as the reason the run records. */
function refusedMessage(by: "source" | "host", refusal: { reason: string; message: string }): string {
  return `[harness-manager] the workspace ${by} refused this run (${refusal.reason}): ${refusal.message}`;
}

/** How often a running step's row is read for a steer (FIX-2086). */
export const STEER_POLL_MS = 1_000;

/** What a harness step stopped for a steer hands on, in place of a handle. */
const STOPPED_FOR_STEER = "harness-manager:stopped-for-steer";

/** One harness step's watch for a steer. */
interface SteerWatch {
  /** Set when the watch stopped the step for a steer. */
  stopped: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** The run's live steer while it offers one (FIX-2254), else `null`. */
  steer: HarnessSteer | null;
  /** How many takes this step handed live: each names its read. */
  handed: number;
  /** Set while a poll runs, so a kick never starts a second one beside it. */
  polling: boolean;
  /** Schedule a poll now that the run offers a steer, unless one is due or running. */
  kick: () => void;
}

/** Lines taken together for a run, owed to its next step until the run takes them. */
interface PendingLine {
  readonly steers: ShownSteer[];
}

/** What a request owes its run's next step (FIX-2254 D2). */
interface OwedLines {
  /**
   * Lines owed, in the order they were taken: refused, or handed over with
   * no answer yet. A line the run took leaves.
   */
  readonly lines: Map<PendingLine, "pending" | "refused">;
  /** Live takes still writing the row: the next step waits for them before it counts. */
  readonly taking: Set<Promise<void>>;
}

/** The lead a run's first prompt shows the task's steers under. */
const STEERS_IN_BRIEF =
  "Since this task was filed, you were also sent the messages below about it, oldest first. They are part of the task: follow them.";

/** The lead the step after a stop for a steer opens with. */
const STOPPED_LEAD =
  "You were stopped so the messages below could reach you. The checkout keeps everything you wrote before you were " +
  "stopped. Carry on from where you were, following them.";

/** Added to a step's lead when a line handed live had no answer when its step was stopped. */
const MAYBE_HELD_NOTE =
  " Some of them were sent to you while you worked but you were stopped before it was clear they arrived, so your " +
  "conversation may already hold them: follow each one once.";

/** The lead the step after one that ended while steers arrived opens with. */
const ARRIVED_LEAD =
  "These messages about the task arrived while you were working. The checkout is as you left it. Carry on, following them.";

/** Why a step stopped for a steer goes no further: its task left this attempt meanwhile. */
const STALE_AFTER_STOP =
  "[harness-manager] the run was stopped for a steer, and its task is no longer this attempt's: it was cancelled, finished or claimed again.";

/** The prompt of a step after a stop whose steers another read took. */
const CONTINUE_AFTER_STOP =
  "You were stopped while you were working. The checkout keeps everything you wrote. Carry on from where you were.";

/**
 * **The one convergence point: release the checkout from state alone.**
 *
 * Called from both exits — the harness step's `onSettled` and the chain's
 * rescue — and neither of them passes anything but a context. That is what
 * forces the lease to be a value: `onSettled` is synchronous and gets only a
 * context, so a live handle had nowhere to live except a process-wide map, and
 * the map existed only because a completion hook could not reach the run that
 * took the lock.
 *
 * It reads `(lockPath, token)` off the run's own state and nothing else. **A
 * second release path that read anything else is the defect this shape
 * removes, coming back** — so if a third exit ever needs to release, it calls
 * this.
 *
 * Idempotent: `releaseCheckout` removes a lock only when the token still
 * matches, so a second call after the first succeeded finds nothing of ours and
 * does nothing.
 *
 * No module-level state remains, so two managers in one process cannot touch
 * each other's lock by construction rather than by keying a table correctly.
 */
function releaseLeaseFromState(ctx: {
  sequencer?: { state?: unknown } | undefined;
}): void {
  const state = harnessCtxState(ctx);
  if (state?.lockPath == null || state.leaseToken == null) return;
  releaseCheckout({ lockPath: state.lockPath, token: state.leaseToken });
}

export { RUNS };
