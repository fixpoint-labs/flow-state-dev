/**
 * The manager — a task row becomes a watched, settled coding run.
 *
 * One detached worker on a conductor board:
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
import { handler, sequencer } from "@flow-state-dev/core";
import type {
  BlockContext,
  DeclaredResourceEntry,
} from "@flow-state-dev/core/types";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import {
  getOrCreateTaskCollection,
  hasFrozenLedgerAssignee,
  resolveResourceCollection,
  type DefinedTaskCollection,
  type TaskCollectionRef,
  type TaskWorker,
} from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { CHECKOUT_CLEANUP_TIMEOUT_MS, GIT_TIMEOUT_MS, NETWORK_CALL_TIMEOUT_MS } from "./exec";
import { MAX_TIMER_MS } from "./config-env";
import {
  RUNS,
  openRunRow,
  readRunRow,
  runRecordCollection,
  runTopic,
  writeRunRow,
  type AttemptIdentity,
  type RunRowWrite,
} from "./run-record";
import { askMarkerPath, readAskMarker } from "./ask";
import {
  INBOX,
  askQuestion,
  inboxCollection,
  listQuestions,
  questionFingerprint,
  questionTopic,
  withdrawEarlierQuestions,
  withdrawQuestion,
} from "./inbox";
import {
  conductorTaskId,
  sameSegment,
  acquireCheckout,
  branchFor,
  checkoutPathFor,
  provisionCheckout,
  type RunLocation,
  type RunPrincipal,
  type CheckoutLease,
  type OwnershipBounds,
  type WorkspaceConfig,
} from "./workspace";

/** What a phase's prompt builder and done-condition are handed. */
export interface PhaseRunContext {
  /** The board's discriminator — see `RunLocation.epic`. */
  epic: string;
  issue: string;
  phase: string;
  /** Which attempt this is, as the board counted it. */
  attempt: number;
  /** The run's own checkout. */
  workspacePath: string;
  branch: string;
  /**
   * The harness session the LAST attempt used, or `undefined` on attempt 1.
   *
   * Supplied by the manager, captured before this attempt's opening write
   * cleared it. A phase must not read it off the run record: that row describes
   * the attempt now running, and the clear has already been applied by the time
   * a phase builds its prompt.
   */
  previousSessionId?: string;
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
  /** What the run asked, in its own words. */
  question: string;
  /** What the operator said to do. */
  answer: string;
}

/**
 * What a prompt builder gets on top of {@link PhaseRunContext}: the two things
 * the ask adds.
 *
 * Separate from `PhaseRunContext` rather than optional fields on it. The
 * done-condition needs neither, and a field that is sometimes absent is the
 * silent-partial shape this lab exists to remove — a builder cannot tell "no
 * answers" from "nobody read them" if the same `undefined` means both.
 */
export interface PromptRunContext extends PhaseRunContext {
  /**
   * Every ANSWERED question for this issue-phase, oldest first — across all
   * attempts, deliberately. That is the question history, not a freshness
   * assumption, and folding it is idempotent, so a replay produces the same
   * prompt and it is correct whether the coding session resumed or started
   * cold.
   */
  answers: readonly AnsweredQuestion[];
  /** Where THIS attempt must write a question if it has one. */
  askMarkerPath: string;
}

/** Everything that makes one phase a phase. Three values, passed in. */
export interface PhaseSpec {
  /** The phase segment of the run record's topic. */
  phase: string;
  /** Rebuilt on every wake from current state, never computed when the row was filed. */
  buildPrompt(run: PromptRunContext): string | Promise<string>;
  /**
   * Has the job actually been done? Re-evaluated now. The boolean is
   * consulted only after a successful verdict — never as an alternative
   * route to completion. `{ prUrl }` is recorded after any verdict: a
   * run can open the pull request and then exhaust its turns.
   *
   * **The two carry-forward fields are prompt-time only: `feedback` and
   * `previousSessionId` are absent here, deliberately and always.** They
   * describe the attempt BEFORE this one, which is what a prompt needs and what
   * a done-condition has no use for — the question is whether the job is done
   * now, not how the last attempt went. `feedback` is also not reachable at this
   * point: it arrives on the worker's input, and the verdict handler is handed
   * the run's own result instead. A phase whose done-condition genuinely needs
   * either wants them put on the manager's state first; do that when such a
   * phase exists rather than plumbing a field nothing reads.
   */
  isDone(run: PhaseRunContext): DoneAnswer | Promise<DoneAnswer>;
  /**
   * Collections this phase's prompt builder may read, keyed by the accessor it
   * reads them under. The manager declares them so `ctx.resources` resolves.
   */
  readable: Record<string, DeclaredResourceEntry>;
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
  validate?(workspace: WorkspaceConfig): unknown;
}

/** The job is done, and optionally the pull request that proves it. */
export type DoneAnswer = boolean | { done: boolean; prUrl?: string | null };

function interpretDone(value: DoneAnswer): { done: boolean; prUrl?: string | null } {
  if (typeof value === "boolean") return { done: value };
  return { done: value.done, prUrl: value.prUrl };
}

/** How the manager is wired to its board and its host. */
export interface ManagerOptions {
  /** The board's ledger collection id — the fence reads the live claim from it. */
  boardCollectionId: string;
  /**
   * The board's ledger declaration.
   *
   * Two things read it: the attempt fence, which resolves it as a plain
   * resource collection to read the live claim, and the park arm, which
   * resolves it as a `TaskCollectionRef` so `awaitReview` is the substrate's
   * own transition rather than a status this lab writes by hand.
   */
  boardCollection: DefinedTaskCollection;
  /**
   * The tenant this conductor serves — the same value that partitions the
   * board's collection identity. Every request must resolve to it.
   */
  tenant: string | undefined;
  phase: PhaseSpec;
  workspace: WorkspaceConfig;
  /** Wall-clock budget for the harness run itself. */
  runTimeoutMs: number;
  /**
   * How checkout contention is bounded. Defaults derive from the longest a live
   * attempt can hold the lock — the run's deadline plus the provisioning budget,
   * not the deadline alone.
   */
  ownership?: Partial<OwnershipBounds>;
  /** Forwarded to the coding agent, so tests can script the SDK. */
  agent?: Omit<Parameters<typeof claudeCodeAgent>[0], "detached" | "recordWork" | "cwd">;
  /**
   * Tell the coordinator session a question exists, so it learns without
   * polling. Defaults to a no-op.
   *
   * **The inbox row is the durable carrier; this is only the announcement.**
   * Relay (FIX-1230) is not in tree, so the seam's default is doing nothing at
   * all — and what that costs while it is absent is that the operator finds
   * the question by reading (`status`) rather than being told.
   */
  announce?: (event: QuestionAnnouncement) => void | Promise<void>;
  name?: string;
}

/**
 * What the announcement carries: **the row's key and nothing else.**
 *
 * The key already names the issue, the phase and the attempt, so a wider
 * payload would be a second copy of facts the durable row holds — and the row,
 * not this, is what an answer is written against.
 */
export interface QuestionAnnouncement {
  /** The bare inbox topic — the name `answer` takes. */
  question: string;
}

/** The typed payload a conductor task carries. Not model-writable — see `./workspace`. */
export const conductorTaskInputSchema = z.object({
  /** The Linear issue this row drives. */
  issue: z.string(),
  /** Which phase of it. */
  phase: z.string(),
});

/**
 * The manager's per-run values.
 *
 * Sequencer state, not session state: a detached board refuses a worker that
 * declares session state, because every detached worker in a flow becomes a
 * route on one shared workstream flow where two routes choosing one key with
 * different shapes corrupt each other silently.
 */
const managerStateSchema = z.object({
  issue: z.string().nullable().default(null),
  phase: z.string().nullable().default(null),
  topic: z.string().nullable().default(null),
  taskId: z.string().nullable().default(null),
  attempt: z.number().nullable().default(null),
  workspacePath: z.string().nullable().default(null),
  branch: z.string().nullable().default(null),
  /**
   * The harness session the LAST attempt used, captured before this attempt's
   * opening write clears it. See `openRun`.
   */
  previousSessionId: z.string().nullable().default(null),
});

/** The manager's own result. Two outcomes; there is deliberately no third. */
const managerOutputSchema = z.object({
  issue: z.string(),
  phase: z.string(),
  sessionId: z.string().nullable(),
});

/**
 * An attempt failed. Carries only a message — the board captures it as
 * `feedback`, which is how the next attempt is told why this one stopped.
 */
export class ConductorAttemptFailed extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConductorAttemptFailed";
  }
}

/**
 * Who this run belongs to, from the request's RESOLVED identity.
 *
 * `ctx.user.identity` is what the principal resolver produced, not anything a
 * caller put in a body — which is what makes it usable as an isolation boundary
 * (BP-031). A missing user id is refused rather than defaulted: a default would
 * put every unauthenticated run in one shared checkout, which is the exact
 * collision the principal is here to prevent.
 */
/**
 * What the principal is read from — the request's authenticated identity, and
 * nothing else.
 *
 * Typed by what it READS rather than as a whole `BlockContext`, so any caller
 * can pass its own narrower context without a cast. The casts were not free:
 * `as BlockContext` on a handler whose resources are typed fails to compile,
 * and the escape hatch that fixes it (`as unknown as`) would silently accept a
 * context that has no identity at all — on the one derivation where a missing
 * identity means two principals sharing a checkout.
 */
export interface RequestIdentityContext {
  user?: { identity?: unknown } | undefined;
}

function runPrincipal(ctx: RequestIdentityContext): RunPrincipal {
  const identity = ctx.user?.identity as
    | { id?: unknown; tenantId?: unknown }
    | undefined;
  const userId = identity?.id;
  if (typeof userId !== "string" || userId === "") {
    throw new Error(
      "[conductor] this request has no resolved user identity, so a run cannot be " +
        "isolated to one. Refusing rather than sharing a checkout across principals.",
    );
  }
  return {
    userId,
    ...(typeof identity?.tenantId === "string" && identity.tenantId !== ""
      ? { tenantId: identity.tenantId }
      : {}),
  };
}

/**
 * This attempt is no longer the live one.
 *
 * Distinct from {@link ConductorAttemptFailed} because it is not a failed
 * attempt — §9's taxonomy puts a lost claim in neither class: the attempt
 * writes nothing and leaves the row to be recovered. Throwing is still the
 * right exit, because the board's own fenced recorder declines a settlement
 * from a lost claim, so nothing is settled and no retry is spent.
 */
export class ConductorAttemptSuperseded extends Error {
  constructor(where: string) {
    super(
      `[conductor] this attempt was superseded before ${where}; stopping rather than ` +
        `continuing to work a row another attempt now holds.`,
    );
    this.name = "ConductorAttemptSuperseded";
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
  if ((await write) === "refused") throw new ConductorAttemptSuperseded(where);
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

/** Read the typed payload off the worker input, refusing an unusable one loudly. */
function taskPayload(input: { input?: unknown; taskId: string }): {
  issue: string;
  phase: string;
} {
  const parsed = conductorTaskInputSchema.safeParse(input.input);
  if (!parsed.success) {
    throw new ConductorAttemptFailed(
      `[conductor] task ${input.taskId} carries no usable issue/phase payload: ` +
        `${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`,
    );
  }
  return parsed.data;
}

/** The attempt identity every run-record write is fenced against. */
function identityFrom(ctx: BlockContext, boardCollectionId: string): AttemptIdentity {
  const state = ctx.sequencer?.state as z.infer<typeof managerStateSchema> | undefined;
  if (state?.topic == null || state.taskId == null || state.attempt == null) {
    throw new Error(
      "[conductor] the manager's sequencer state is empty — this block ran outside the " +
        "manager, or before the row was opened.",
    );
  }
  return {
    taskId: state.taskId,
    attempt: state.attempt,
    topic: state.topic,
    boardCollectionId,
  };
}

/** Read the manager's state, or throw rather than derive a wrong directory. */
function managerState(ctx: BlockContext): z.infer<typeof managerStateSchema> {
  const state = ctx.sequencer?.state as z.infer<typeof managerStateSchema> | undefined;
  if (state?.workspacePath == null) {
    throw new Error("[conductor] the manager's sequencer state has no checkout on it.");
  }
  return state;
}

/**
 * Everything one worker can legitimately spend, end to end.
 *
 * **The shutdown budget has to cover the whole worker, not the agent step.**
 * `detachedDrainTimeoutMs` was set to `runTimeoutMs`, which is only one of four
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
 * 4. the completion probe — `gh pr list`, which runs AFTER the agent deadline
 *    and is what turns a finished run into a verdict.
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
 * Run `work`, and reject if it has not settled within `ms`.
 *
 * **The timer never outlives the call.** A bare `setTimeout` race leaks a
 * pending timer per invocation — harmless once, and this runs on every settled
 * attempt of every row, so the handles accumulate on a long-lived dispatcher and
 * hold the event loop open past a shutdown that is otherwise finished.
 *
 * The bounded work is not cancelled, because nothing here can cancel it: the
 * hook is somebody else's function. What this buys is that the *worker* stops
 * waiting and the row settles, which is the property the drain budget rests on.
 */
export async function withDeadline<T>(
  work: () => Promise<T>,
  ms: number,
  what: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ConductorAttemptFailed(`${what} did not answer within ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export function conductorDrainBudgetMs(options: {
  runTimeoutMs: number;
  provisionTimeoutMs?: number | undefined;
  ownershipWaitMs: number;
}): number {
  const work =
    options.ownershipWaitMs +
    (options.provisionTimeoutMs ?? GIT_TIMEOUT_MS) +
    options.runTimeoutMs +
    // The completion check AND the prompt builder. Both are public hooks, both
    // are bounded by this constant, and the budget has to reserve time for each
    // — a bound the budget does not account for is as wrong as no bound.
    NETWORK_CALL_TIMEOUT_MS * 2;

  // `* 4 / 3` clears a reserve of up to a quarter; the flat minute dwarfs the
  // small absolute cap that binds instead on tiny budgets.
  const budget = Math.ceil((work * 4) / 3) + 60_000;

  if (budget > MAX_TIMER_MS) {
    throw new Error(
      `[conductor] the derived drain budget (${budget}ms) exceeds the largest delay a ` +
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
      `[conductor] ownership.waitMs (${ownership.waitMs}ms) must exceed ` +
        `ownership.staleAfterMs (${ownership.staleAfterMs}ms) by at least one poll ` +
        `interval (${ownership.pollMs}ms), so at least ${minimumWaitMs}ms: a lock becomes ` +
        `stale-eligible only once its age is STRICTLY past the window, and eligibility is ` +
        `only observed on a poll. A wait that ends at or before that point gives up on a ` +
        `dead holder's lock it was about to be allowed to take, and spends a retry doing it.`,
    );
  }

  if (ownership.staleAfterMs <= maxLockHeldMs) {
    throw new Error(
      `[conductor] ownership.staleAfterMs (${ownership.staleAfterMs}ms) must exceed the ` +
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

/** Build the manager: one detached worker for one phase. */
export function harnessManager(options: ManagerOptions) {
  const {
    boardCollectionId,
    boardCollection,
    tenant,
    phase,
    workspace,
    runTimeoutMs,
    agent = {},
    announce = () => {},
    name = "harness-manager",
  } = options;

  const { ownership } = resolveOwnership({
    runTimeoutMs,
    provisionTimeoutMs: workspace.provisionTimeoutMs,
    ...(options.ownership !== undefined ? { ownership: options.ownership } : {}),
  });

  /** Every collection the manager or its phase touches, by accessor key. */
  // **Two accessors are the manager's and a phase may not claim them.**
  // Refused rather than silently overridden, and rather than merged last.
  //
  // A phase whose `readable` carried `runs` would send this manager's
  // bookkeeping into a collection `status` never reads — the row would be
  // written, and every read of it would answer nothing. One carrying the board's
  // accessor is worse: the live-claim fence would consult unrelated rows,
  // quietly defeating the whole obligation-A mechanism while every test that
  // does not stage two attempts still passes.
  //
  // Merging the manager's entries LAST would also prevent both, and it is the
  // wrong fix: the phase author's declaration would simply not work, with
  // nothing anywhere saying why. This fails at construction, naming the key.
  // `INBOX` joins the two for the same reason and with a third harm of its own:
  // a phase re-declaring it would send the ask into a collection `answer` and
  // `status` never read, so a run would park on a question no operator could
  // ever see and no answer could ever reach.
  const RESERVED_ACCESSORS = new Set([RUNS, boardCollectionId, INBOX]);
  const claimed = Object.keys(phase.readable).filter((key) =>
    RESERVED_ACCESSORS.has(key),
  );
  if (claimed.length > 0) {
    throw new Error(
      `[conductor] the "${phase.phase}" phase declares readable collection(s) ` +
        `${claimed.map((k) => `"${k}"`).join(", ")}, which the manager owns — ` +
        `"${RUNS}" is the run record, "${INBOX}" is the question inbox, and ` +
        `"${boardCollectionId}" is the board ledger ` +
        `the attempt fence reads. Both are already available to the phase; declaring ` +
        `them again would replace the manager's own.`,
    );
  }

  const resources: Record<string, DeclaredResourceEntry> = {
    ...phase.readable,
    [RUNS]: runRecordCollection,
    // Where a question is posted, withdrawn, and read back as an answer. The
    // `answer` and `status` actions declare the same definition object, so the
    // question a detached workstream writes is the one the coordinator session
    // reads — one registration, not two storage slots that look alike.
    [INBOX]: inboxCollection,
    // Declared so the fence can read the LIVE claim off the board row. The
    // board declares the same definition object, so this is one registration
    // rather than a second storage slot that looks like the first.
    [boardCollectionId]: boardCollection as unknown as DeclaredResourceEntry,
  };

  /**
   * The board's rows as the SUBSTRATE sees them, not as a resource collection.
   *
   * The fence reads the ledger as a plain collection because all it needs is
   * two fields off the persisted row. The park arm needs a transition, and a
   * transition has to be the substrate's: status legality, the recorders'
   * parked-row refusal and the lease's governance all hang off `awaitReview`
   * rather than off the string it writes.
   *
   * Composed from the two exported pieces rather than reached for through
   * `board.capability`, because the capability does not exist yet when this
   * manager is constructed — the board is built FROM this worker. It is the
   * same resolve the board's own drain and its accessor perform, including the
   * frozen-assignee policy, which is read off the shared declaration here
   * rather than captured as a boolean per call site.
   */
  const boardTasks = (ctx: BlockContext): Promise<TaskCollectionRef> => {
    const collection = resolveResourceCollection(ctx, boardCollectionId);
    if (collection === undefined) {
      throw new Error(
        `[conductor] the board ledger "${boardCollectionId}" is not registered on this ` +
          `worker, so a run cannot be parked on a person — the question it just posted ` +
          `would sit open with the row still reading as running.`,
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
   * Open the row — BEFORE the attempt waits for anything.
   *
   * The checkout path is derived here rather than read back, so a task woken in
   * a coordinator session that never saw the previous run still resolves the
   * same directory (see `./workspace`).
   */
  const openRun = handler({
    name: "conductor-open-run",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.void(),
    resources,
    execute: async (input, ctx) => {
      const { issue, phase: phaseName } = taskPayload(input);

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
      // on the board. `conductorTaskId` folds case, so those are the SAME task,
      // the same checkout and the same branch; a raw comparison here called them
      // different and refused, after `wake` had claimed the row and charged it.
      // Once per wake, until a valid task's budget was gone, for a mismatch its
      // own identity says does not exist.
      if (!sameSegment(phaseName, phase.phase)) {
        throw new ConductorAttemptFailed(
          `[conductor] task ${input.taskId} is a "${phaseName}" row on a manager ` +
            `configured for "${phase.phase}". Refusing rather than running ` +
            `${phase.phase}'s prompt and completion check against it.`,
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
      // is the same collapse reached through the row id instead.
      const canonicalId = conductorTaskId(issue, phaseName);
      if (input.taskId !== canonicalId) {
        throw new ConductorAttemptFailed(
          `[conductor] task ${input.taskId} carries the payload for ${canonicalId}. ` +
            `Refusing: the checkout, the branch and the run record are all derived from ` +
            `that payload, so a second row under a different id would run the same work ` +
            `in the same tree.`,
        );
      }

      // **A conductor serves one tenant, and refuses any other.**
      //
      // The board's collection identity is partitioned by tenant at
      // construction, so a request resolved to a different tenant would be
      // reading and claiming rows that are not its own — the ledger half of the
      // isolation the checkout and branch already have. Refused here for the
      // same reason the phase is: this is where the wrong work would execute.
      const resolvedTenant = requestTenant(ctx as BlockContext);
      if (resolvedTenant !== tenant) {
        throw new ConductorAttemptFailed(
          `[conductor] this conductor serves ${describeTenant(tenant)}; the request resolved ` +
            `to ${describeTenant(resolvedTenant)}. Refusing rather than running one tenant's ` +
            `task in another's workspace.`,
        );
      }

      // **One location, three derivations.** The checkout, the branch and the run
      // topic all partition on the same thing — the principal so two users never
      // share a tree or a ref, and the epic so two boards never do either.
      // Building them from one object is what stops a discriminator reaching one
      // and missing another, which would leave the report partitioned and the
      // overwrite on disk.
      const location: RunLocation = {
        principal: runPrincipal(ctx as BlockContext),
        epic: boardCollectionId,
        issue,
        phase: phaseName,
      };
      const workspacePath = checkoutPathFor(workspace, location);
      const branch = branchFor(location);
      const topic = runTopic(boardCollectionId, issue, phaseName);

      await ctx.sequencer!.patchState({
        issue,
        phase: phaseName,
        topic,
        taskId: input.taskId,
        attempt: input.attempts,
        workspacePath,
        branch,
      });

      // **Read the previous attempt's session BEFORE opening clears it.**
      //
      // `openRunRow` applies the attempt-scoped clear, which sets `sessionId`
      // to null — correctly, since the field describes the attempt now running
      // and this one has not reported yet. But the next attempt's prompt wants
      // to name the session the last one used, and reading the row after the
      // clear always saw `null`. A rule and a reader that were each right on
      // their own.
      //
      // Captured here and carried on the manager's own state, so the phase is
      // handed the value rather than reaching into a record whose lifetime it
      // would have to know about. That is why `PhaseRunContext` gained a field
      // instead of `implement.ts` moving its read earlier: the same collision
      // is unavailable to the next phase that wants carry-forward.
      const previousSessionId =
        (await readRunRow(ctx as BlockContext, topic))?.sessionId ?? null;
      await ctx.sequencer!.patchState({ previousSessionId });

      // **Refusal stops the attempt.** The row can be reclaimed between the
      // runner's start gate and this call, and a discarded refusal let the
      // known-stale worker walk on into checkout preparation and paid agent
      // execution — taking the tree ahead of its replacement for roughly a
      // lease-renewal interval.
      await fenced(
        openRunRow(
          ctx as BlockContext,
          {
            taskId: input.taskId,
            attempt: input.attempts,
            topic,
            boardCollectionId,
          },
          {
            workspacePath,
            branch,
            // Known now, not at the verdict. `status` is the only board read,
            // and a live row with no request id cannot be followed.
            requestId: ctx.request.identity.id,
            childSessionId: ctx.session.identity.id,
          },
        ),
        "the run row was opened",
      );

      // **Reconcile before this attempt runs.** The create-only write commits
      // before the outcome arms are selected, so a process that dies in between
      // leaves the previous attempt's row `open` with no arm having decided it.
      // Left alone, that orphan satisfies the answer's proceed guard the moment
      // THIS attempt parks — and answering it re-queues the run while this
      // attempt's real question is still open.
      //
      // A question from an attempt that is over is moot, which is what arm 3
      // already says; the gap is only that a crash skips it. Arm 1 is NOT a
      // second witness to that — it parks, and parking is the one outcome that
      // deliberately leaves the question open, because the attempt is not over.
      // After this there is at most ONE `open` row per issue-phase, which is
      // what both the proceed guard and recovery's nothing-open condition
      // already assumed.
      //
      // After the fenced open, not before: a superseded attempt stops there and
      // must not reach in and withdraw its replacement's question.
      await withdrawEarlierQuestions(ctx as BlockContext, issue, phaseName, input.attempts);
    },
  });

  /**
   * Build the prompt, then take the checkout.
   *
   * Ownership is acquired LAST so nothing between the acquire and the harness
   * step can leak a held lock — the harness step's `onSettled` is what releases
   * it, and it only fires once the step has been dispatched.
   */
  const prepare = handler({
    name: "conductor-prepare",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ prompt: z.string() }),
    resources,
    execute: async (input, ctx) => {
      const state = managerState(ctx as BlockContext);

      // **Two channels, two meanings, and they never carry each other.** The
      // board's `feedback` says why the LAST ATTEMPT FAILED; these say what an
      // operator answered. Handing the answer back through `feedback` is the
      // cheapest wiring and the one that already means something else — a run
      // would be told *"your last attempt stopped because: take the second
      // option."*
      //
      // Read here rather than inside the builder so the ORDER is the manager's:
      // a fold whose order depends on where a phase happens to sort is a prompt
      // that changes between replays.
      const answers = (
        await listQuestions(ctx as BlockContext, state.issue!, state.phase!)
      )
        .filter((row) => row.state.status === "answered" && row.state.answer !== null)
        .map((row) => ({ question: row.state.question, answer: row.state.answer! }));

      const run: PromptRunContext = {
        epic: boardCollectionId,
        issue: state.issue!,
        phase: state.phase!,
        attempt: input.attempts,
        workspacePath: state.workspacePath!,
        branch: state.branch!,
        ...(input.feedback !== undefined ? { feedback: input.feedback } : {}),
        ...(state.previousSessionId != null
          ? { previousSessionId: state.previousSessionId }
          : {}),
        ctx: ctx as BlockContext,
        answers,
        // The prompt is the only place this path is named, which is what makes
        // the ask FORCED rather than spontaneous — the harness offers no seam
        // for a question to leave through (see `./ask`).
        askMarkerPath: askMarkerPath(state.workspacePath!, input.attempts),
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
      // so `conductorDrainBudgetMs` gains the term. A bound the budget does not
      // account for would make the advertised number wrong in the other
      // direction, which is the defect being fixed, inverted.
      const prompt = await withDeadline(
        async () => phase.buildPrompt(run),
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
      leases.set(
        leaseKey(ctx as BlockContext),
        await acquireCheckout(
          state.workspacePath!,
          `${input.taskId}#${input.attempts}`,
          ownership,
          Date.now,
          // Cancellation stops the WAIT. A cancelled attempt that kept polling
          // could still acquire and provision a tree whose result it can no
          // longer record — and the wait is now long enough for that to cost a
          // replacement most of an hour.
          (ctx as BlockContext).signal,
        ),
      );
      const checkout = await provisionCheckout(workspace, {
        principal: runPrincipal(ctx as BlockContext),
        epic: boardCollectionId,
        issue: state.issue!,
        phase: state.phase!,
      });
      if (checkout.healed.length > 0) {
        await fenced(
          writeRunRow(ctx as BlockContext, identityFrom(ctx as BlockContext, boardCollectionId), {
            healed: checkout.healed,
          }),
          "the setup heal was recorded",
        );
      }
      return { prompt };
    },
  });

  /**
   * Read the verdict, then decide. **Three outcomes, in this order, and the
   * order is the design. Every arm is a conjunction.**
   *
   * 1. **The verdict did NOT fail AND this attempt's marker holds a question →
   *    park.** `awaitReview`, announce, then return normally. The recorders
   *    refuse a parked row, so the workstream request ends with the row still
   *    `awaiting_review` and the run costs nothing while a person thinks.
   * 2. **The verdict succeeded AND the done-condition holds → return.**
   * 3. **Anything else → throw**, withdrawing this attempt's question first: the
   *    attempt failed, so its question is moot, and leaving it open means an
   *    answer later lands against a row no attempt is waiting on.
   *
   * **The park is asked FIRST, and the order is the whole guarantee.** The
   * done-condition is not attempt-scoped and cannot be: the branch is derived
   * from (epic, issue, phase), so every attempt on a task shares it, and the
   * implement phase's probe reports on the branch. Attempt 1 opens a pull
   * request and fails; attempt 2 asks a question and stops having produced
   * nothing; the probe still says done. Consulted first, that reading withdraws
   * a question a person was about to be shown and records the phase as
   * succeeded — a silent wrong success arriving through the completion check.
   *
   * A question marker is the run stating outright that it needs a decision.
   * That statement is about THIS attempt and nothing else, so it is the one to
   * believe when the two disagree. The cost is a run that asked, unblocked
   * itself and finished anyway: it now parks for one human round trip instead
   * of completing. Rejected alternative: keep the old order but scope the probe
   * to this attempt, which needs a pull-request timestamp compared against a
   * locally-stamped attempt start — a clock-skew race guarding a rarer case
   * than the one it opens.
   *
   * **Arm 3 withdraws THIS attempt's row and no other, and that is sufficient
   * rather than narrow.** Start-of-attempt reconciliation already withdrew
   * every earlier attempt's `open` row, so at most one can exist for the
   * issue-phase and it is this one's. Written as "withdraw any open row" the
   * code would range over a set the reconciliation has already emptied — and
   * the next reader would derive a guarantee from the wrong place.
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
   * *returning*. An arm gated on the marker alone matches that run, parks it,
   * and waits on a person for an attempt that is already dead: the row never
   * re-pends, the retry budget is never spent, and nothing reports it. A silent
   * stall, which is the mirror of the silent success arm 2 exists to kill.
   *
   * **The row is created BEFORE the arms, not inside the park arm.** Arm 3
   * WITHDRAWS it, and a marker with an errored verdict never reaches arm 1 at
   * all — so creating it there means withdrawing a row that was never created,
   * while the question history a later attempt and a late answer both read
   * wants it durably `withdrawn`.
   *
   * The run record's `outcome` stays `running` across a park, deliberately: the
   * run is not over, and **the board row is the authority on the job's state**
   * while this record is conductor's own bookkeeping. A fourth outcome here
   * would be a second answer to a question the board already answers.
   */
  const decide = handler({
    name: "conductor-decide",
    // Read off the handle. The verdict contract names FOUR optional fields —
    // session id, terminal text, usage and cost — so this reads four. An
    // attempt that reports three would otherwise leave the fourth showing the
    // previous attempt's value, silently and only on the attempts that could
    // not report it.
    inputSchema: z.object({
      status: z.string(),
      sessionId: z.string().nullable(),
      resultSubtype: z.string().nullable(),
      finalMessage: z.string().nullable(),
      usage: z
        .object({ inputTokens: z.number(), outputTokens: z.number() })
        .nullable(),
      costUsd: z.number().nullable(),
    }),
    outputSchema: managerOutputSchema,
    resources,
    execute: async (handle, ctx) => {
      const state = managerState(ctx as BlockContext);
      const identity = identityFrom(ctx as BlockContext, boardCollectionId);
      const succeeded = handle.status === "completed";

      // Everything the run reported goes on the row before anything is decided,
      // so a failed attempt's row is as complete as a successful one's.
      await fenced(
        writeRunRow(ctx as BlockContext, identity, {
        sessionId: handle.sessionId,
        finalMessage: handle.finalMessage,
        usage: handle.usage,
        costUsd: handle.costUsd,
        childSessionId: ctx.session.identity.id,
        requestId: ctx.request.identity.id,
        }),
        "the verdict was recorded",
      );

      // **The ask, before any arm.** Reading THIS attempt's marker path — never
      // a fixed one: the checkout survives a retry, so last attempt's question
      // file is still on disk, and a fixed path makes an attempt that quietly
      // did nothing look exactly like an attempt that asked.
      const question = await readAskMarker(state.workspacePath!, identity.attempt);
      const questionTopicKey =
        question === undefined
          ? undefined
          : questionTopic(
              state.issue!,
              state.phase!,
              identity.attempt,
              questionFingerprint(question),
            );
      if (question !== undefined && questionTopicKey !== undefined) {
        // Create-only, and the single ask path. The step commits no output, so
        // it re-executes on recovery: the patch branch has nothing to apply, so
        // a second execution is a read and a replay cannot erase an answer.
        await askQuestion(ctx as BlockContext, questionTopicKey, {
          question,
          askedBy: identity.taskId,
          askedAt: Date.now(),
        });
      }

      /** Arm 3 clears this attempt's question: the attempt failed, so it is moot. */
      const withdrawOwnQuestion = async (): Promise<void> => {
        if (questionTopicKey === undefined) return;
        await withdrawQuestion(ctx as BlockContext, questionTopicKey);
      };

      // ── Arm 1: the verdict did NOT fail AND this attempt asked ─────────────
      if (succeeded && question !== undefined && questionTopicKey !== undefined) {
        const board = await boardTasks(ctx as BlockContext);
        // The substrate's own transition, never a status this lab writes by
        // hand: the recorders' parked-row refusal, the drain's excusal and the
        // lease's governance all key off it.
        await board.awaitReview(identity.taskId, question);

        // **After the park, never before.** What is announced must already be
        // answerable: a subscriber fast enough to act on an announcement sent
        // first is refused by the parked-only guard, and then watches the task
        // park on the question it just tried to answer.
        await announce({ question: questionTopicKey });

        // Returning normally is the point: the workstream request ends and the
        // row stays parked, because both recorders decline a row the worker
        // parked for review.
        return {
          issue: state.issue!,
          phase: state.phase!,
          sessionId: handle.sessionId,
        };
      }

      // ── Arm 2: succeeded AND done ──────────────────────────────────────────
      if (succeeded) {
        // **Bounded, because the whole-worker budget already says it is.**
        // `conductorDrainBudgetMs` reserves `NETWORK_CALL_TIMEOUT_MS` for this
        // step. `isDone` is a public seam, so another phase's check was
        // unbounded and could outlive the budget a host sized its shutdown
        // from, leaving the row `in_progress` with nothing to settle it. The
        // bound is the constant the budget already spends, so it makes the
        // advertised number true rather than adding one.
        const answer = interpretDone(
          await withDeadline(
            async () =>
              phase.isDone({
                epic: boardCollectionId,
                issue: state.issue!,
                phase: state.phase!,
                attempt: identity.attempt,
                workspacePath: state.workspacePath!,
                branch: state.branch!,
                ctx: ctx as BlockContext,
              }),
            NETWORK_CALL_TIMEOUT_MS,
            `the ${state.phase} phase's completion check`,
          ),
        );
        if (answer.prUrl) {
          await fenced(
            writeRunRow(ctx as BlockContext, identity, { prUrl: answer.prUrl }),
            "the pull request was recorded",
          );
        }
        if (answer.done) {
          // No question to withdraw: arm 1 returned on every attempt that asked
          // one, so reaching here with a succeeded verdict means the marker was
          // empty.
          await fenced(
            writeRunRow(ctx as BlockContext, identity, { outcome: "succeeded", reason: null }),
            "the row was completed",
          );
          return {
            issue: state.issue!,
            phase: state.phase!,
            sessionId: handle.sessionId,
          };
        }
      } else {
        try {
          const answer = interpretDone(
            await withDeadline(
              async () =>
                phase.isDone({
                  epic: boardCollectionId,
                  issue: state.issue!,
                  phase: state.phase!,
                  attempt: identity.attempt,
                  workspacePath: state.workspacePath!,
                  branch: state.branch!,
                  ctx: ctx as BlockContext,
                }),
              NETWORK_CALL_TIMEOUT_MS,
              `the ${state.phase} phase's pull-request check`,
            ),
          );
          if (answer.prUrl) {
            await fenced(
              writeRunRow(ctx as BlockContext, identity, { prUrl: answer.prUrl }),
              "the pull request was recorded",
            );
          }
        } catch {
          // A failed listing must not replace the run's own failure reason.
        }
      }

      // ── Arm 3: anything else, INCLUDING a failed verdict with a question ───
      await withdrawOwnQuestion();
      if (!succeeded) {
        throw new ConductorAttemptFailed(
          `the run stopped without finishing: ${handle.resultSubtype ?? "no result reported"}`,
        );
      }
      throw new ConductorAttemptFailed(
        `the run finished cleanly and the ${state.phase} phase is still not done`,
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
    name: "conductor-record-failure",
    inputSchema: z.unknown(),
    outputSchema: z.never(),
    resources,
    execute: async (error: unknown, ctx): Promise<never> => {
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
      // Idempotent: `releaseLease` deletes the entry, so the agent path's
      // `onSettled` having already released makes this a no-op, and `release()`
      // is identity-guarded so it can never remove a replacement's lock.
      releaseLease(ctx as BlockContext);

      const reason = error instanceof Error ? error.message : String(error);
      const state = ctx.sequencer?.state as z.infer<typeof managerStateSchema> | undefined;
      // A failure BEFORE the row was opened has no identity to fence against —
      // and cannot have left stale metadata either, since nothing was written.
      if (state?.topic != null && state.taskId != null && state.attempt != null) {
        // **The one refusal that is deliberately not read.** This handler is
        // already unwinding and re-throws below whatever happens, so a refusal
        // means only that a superseded attempt recorded nothing — which is the
        // correct outcome. Every other call site stops on refusal.
        await writeRunRow(
          ctx as BlockContext,
          {
            taskId: state.taskId,
            attempt: state.attempt,
            topic: state.topic,
            boardCollectionId,
          },
          {
            outcome: "failed",
            reason,
            requestId: ctx.request.identity.id,
            childSessionId: ctx.session.identity.id,
          },
        );
      }
      throw error;
    },
  });

  return sequencer({
    name,
    inputSchema: taskWorkerInputSchema,
    outputSchema: managerOutputSchema,
    stateSchema: managerStateSchema,
  })
    .tap(openRun)
    .step(prepare)
    .step(
      claudeCodeAgent({
        ...agent,
        // The board-construction shim: a detached board refuses a worker whose
        // block authors a session-state schema.
        detached: true,
        recordWork: true,
        // The framework's one addition, and the reason this lab needs it: the
        // run edits ITS checkout, and the record of what it touched is keyed
        // there too.
        cwd: (_input, ctx) => managerState(ctx).workspacePath!,
      }),
      {
        // The cancellable-under-a-deadline obligation, met by a primitive core
        // already has: this composes into the block's own signal, which the SDK
        // path forwards into the query's abort controller.
        abortSignal: () => AbortSignal.timeout(runTimeoutMs),
        // Fires on every exit from the dispatch — returned, threw, or
        // suspended. The tree is only written by the agent, so releasing the
        // moment it stops is tighter than holding through the verdict.
        onSettled: (ctx) => releaseLease(ctx),
      },
    )
    .step(decide)
    .rescue([{ block: recordFailure }]) as unknown as TaskWorker;
}

/**
 * Live checkout leases, keyed by the request holding them.
 *
 * Module-level because `onSettled` must be synchronous and gets only a context:
 * there is nowhere else to put a value that `prepare` created and the harness
 * step's exit has to release. Keyed by request so two managers in one process
 * — the whole point of a board — never release each other's.
 */
const leases = new Map<string, CheckoutLease>();

function leaseKey(ctx: BlockContext): string {
  return ctx.request.identity.id;
}

/**
 * Release this request's lease and forget it.
 *
 * Deleting matters as much as releasing: the entry is what keeps the lease
 * reachable, and a map that only ever grows would hold one object per run for
 * the process's life.
 */
function releaseLease(ctx: BlockContext): void {
  const key = leaseKey(ctx);
  leases.get(key)?.release();
  leases.delete(key);
}

export { RUNS };
