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
  DefinedResourceCollection,
} from "@flow-state-dev/core/types";
import { claudeCodeAgent } from "@flow-state-dev/claude-code/sdk";
import { taskWorkerInputSchema } from "@flow-state-dev/orchestration/task-board";
import type { TaskWorker } from "@flow-state-dev/orchestration/tasks";
import { z } from "zod";
import { GIT_TIMEOUT_MS, NETWORK_CALL_TIMEOUT_MS } from "./exec";
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
import {
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
   * Why the LAST attempt stopped, as the board captured it when `fail()`
   * re-pended the row. This — not the run record — is the carry-forward:
   * without it a deterministic failure replays and the retry budget burns for
   * nothing.
   */
  feedback?: string;
  /** The block context, so a builder can read its phase's collections. */
  ctx: BlockContext;
}

/** Everything that makes one phase a phase. Three values, passed in. */
export interface PhaseSpec {
  /** The phase segment of the run record's topic. */
  phase: string;
  /** Rebuilt on every wake from current state, never computed when the row was filed. */
  buildPrompt(run: PhaseRunContext): string | Promise<string>;
  /**
   * Has the job actually been done? Re-evaluated now, and consulted ONLY after
   * a successful verdict — never as an alternative route to completion.
   */
  isDone(run: PhaseRunContext): boolean | Promise<boolean>;
  /**
   * Collections this phase's prompt builder may read, keyed by the accessor it
   * reads them under. The manager declares them so `ctx.resources` resolves.
   */
  readable: Record<string, DeclaredResourceEntry>;
}

/** How the manager is wired to its board and its host. */
export interface ManagerOptions {
  /** The board's ledger collection id — the fence reads the live claim from it. */
  boardCollectionId: string;
  /** The board's ledger declaration, so the manager can read a claim. */
  boardCollection: DefinedResourceCollection;
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
  name?: string;
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
export function conductorDrainBudgetMs(options: {
  runTimeoutMs: number;
  provisionTimeoutMs?: number | undefined;
  ownershipWaitMs: number;
}): number {
  const work =
    options.ownershipWaitMs +
    (options.provisionTimeoutMs ?? GIT_TIMEOUT_MS) +
    options.runTimeoutMs +
    NETWORK_CALL_TIMEOUT_MS;

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
  const provisionBudget = options.provisionTimeoutMs ?? GIT_TIMEOUT_MS;
  const maxLockHeldMs = runTimeoutMs + provisionBudget;

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
    waitMs: options.ownership?.waitMs ?? maxLockHeldMs + 300_000,
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
  if (ownership.waitMs < ownership.staleAfterMs) {
    throw new Error(
      `[conductor] ownership.waitMs (${ownership.waitMs}ms) must be at least ` +
        `ownership.staleAfterMs (${ownership.staleAfterMs}ms): a shorter wait gives up on a ` +
        `dead holder's lock before it is stale-eligible, and spends a retry doing it.`,
    );
  }

  if (ownership.staleAfterMs <= maxLockHeldMs) {
    throw new Error(
      `[conductor] ownership.staleAfterMs (${ownership.staleAfterMs}ms) must exceed the ` +
        `longest a live attempt can hold the lock (${maxLockHeldMs}ms = runTimeoutMs ` +
        `${runTimeoutMs}ms + the provisioning budget ${provisionBudget}ms): the lock is ` +
        `taken before the checkout is provisioned, so a window sized against the run's ` +
        `deadline alone can elapse while the holder is still inside git. Raise the stale ` +
        `window, lower the deadline, or lower options.provisionTimeoutMs.`,
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
  const RESERVED_ACCESSORS = new Set([RUNS, boardCollectionId]);
  const claimed = Object.keys(phase.readable).filter((key) =>
    RESERVED_ACCESSORS.has(key),
  );
  if (claimed.length > 0) {
    throw new Error(
      `[conductor] the "${phase.phase}" phase declares readable collection(s) ` +
        `${claimed.map((k) => `"${k}"`).join(", ")}, which the manager owns — ` +
        `"${RUNS}" is the run record and "${boardCollectionId}" is the board ledger ` +
        `the attempt fence reads. Both are already available to the phase; declaring ` +
        `them again would replace the manager's own.`,
    );
  }

  const resources: Record<string, DeclaredResourceEntry> = {
    ...phase.readable,
    [RUNS]: runRecordCollection,
    // Declared so the fence can read the LIVE claim off the board row. The
    // board declares the same definition object, so this is one registration
    // rather than a second storage slot that looks like the first.
    [boardCollectionId]: boardCollection as unknown as DeclaredResourceEntry,
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
      if (phaseName !== phase.phase) {
        throw new ConductorAttemptFailed(
          `[conductor] task ${input.taskId} is a "${phaseName}" row on a manager ` +
            `configured for "${phase.phase}". Refusing rather than running ` +
            `${phase.phase}'s prompt and completion check against it.`,
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
          { workspacePath, branch },
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
  const prepare = handler({
    name: "conductor-prepare",
    inputSchema: taskWorkerInputSchema,
    outputSchema: z.object({ prompt: z.string() }),
    resources,
    execute: async (input, ctx) => {
      const state = managerState(ctx as BlockContext);
      const run: PhaseRunContext = {
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
      };

      const prompt = await phase.buildPrompt(run);

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
      await provisionCheckout(workspace, {
        principal: runPrincipal(ctx as BlockContext),
        epic: boardCollectionId,
        issue: state.issue!,
        phase: state.phase!,
      });
      return { prompt };
    },
  });

  /**
   * Read the verdict, then decide. **Completion is a conjunction.**
   *
   * A run can open the pull request and THEN exhaust its turn budget — the SDK
   * reports that as an errored handle rather than a throw, which is this whole
   * lab's premise. So a done-condition consulted alone would complete the row
   * for a run that failed, reintroducing the silent success through the door
   * meant to close it. A successful verdict whose done-condition does not hold
   * is a failed attempt too: the run finished cleanly and did not do the job.
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

      if (!succeeded) {
        throw new ConductorAttemptFailed(
          `the run stopped without finishing: ${handle.resultSubtype ?? "no result reported"}`,
        );
      }

      const done = await phase.isDone({
        epic: boardCollectionId,
        issue: state.issue!,
        phase: state.phase!,
        attempt: identity.attempt,
        workspacePath: state.workspacePath!,
        branch: state.branch!,
        ctx: ctx as BlockContext,
      });
      if (!done) {
        throw new ConductorAttemptFailed(
          `the run finished cleanly and the ${state.phase} phase is still not done`,
        );
      }

      await fenced(
        writeRunRow(ctx as BlockContext, identity, { outcome: "succeeded", reason: null }),
        "the row was completed",
      );
      return {
        issue: state.issue!,
        phase: state.phase!,
        sessionId: handle.sessionId,
      };
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
          { outcome: "failed", reason },
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
