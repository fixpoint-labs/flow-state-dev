/**
 * `goalSeekLoop` — a config-driven, judge-gated loop over a task board's drain
 * (FIX-910).
 *
 * Several built-in orchestration recipes are the same underlying loop: hand out
 * work, drain it, ask a judge "are we done?", and if not hand out more and
 * repeat — bounded so it always terminates. `goalSeekLoop` names that loop once
 * as an outer `sequencer.loopBack` around `board.drain`, parameterized by a
 * single three-way `Verdict` contract that subsumes the drain-empty and
 * LLM-verdict termination dialects.
 *
 * Assembly (see the factory below):
 *
 *   [seed?] → drainPass (board.drain → noteWaiting, again while a turn is owed) →
 *   incrementDrainCount → [afterDrain?] →
 *   stashDrainProjection → judgeStep (judge + validation, judge-scoped rescue) →
 *   coerceAtCap → [replanner?] → applyReplanTasks → normalize →
 *   loopBack(drainPass, when: decision !== "done") →
 *   emitTermination → projectBoard → [finalize?]
 *
 * A task waiting on a person (FIX-2131). A plan board's drain returns
 * `blocked` while a task waits on a person's answer: nobody is working it,
 * and only the answer moves it. The loop never judges that board: the judge
 * would rule on unfinished work, and on every later pass the same open
 * question, until the cap. So a drain that leaves a task waiting on a person
 * ends the loop's pass there: no judge, no replan, no finalize, and no
 * iteration spent, with the termination reason `"waiting-on-a-user"`. The
 * answer owes the task its next turn; run the loop again once it is answered,
 * and its drain takes that turn and the loop goes on.
 *
 * An answer can land after the drain stops and before the loop reads the
 * board (FIX-2210). The question is closed then, but the task still owes the
 * turn the answer earned, and judging would rule on its partial work. So the
 * pass drains again while a task owes a turn and none waits on a person, at
 * most `maxIterations` times, and none of those drains counts as an iteration.
 * If a task still owes a turn when those drains run out, the pass ends as a
 * wait on a person does: its work is unfinished, so nothing judges it.
 * Those drains take the board as it stands, without its `initialTasks` seed,
 * so a one-pass loop over id-less initial tasks still has one row per task.
 *
 * Preconditions (rejected at construction — `goalSeekLoop()` is a new public
 * API, so misuse fails fast rather than at first execution):
 *   - `maxIterations` must be a finite positive integer.
 *   - the board must be request- or resource-backed (re-enterable). A
 *     sequencer- or factory-backed board is rejected: `projectBoard` re-reads
 *     the collection through the board capability, which a sequencer board's
 *     capability throws from a sibling, and a factory board can't declare
 *     re-enterability.
 *   - a `maxIterations > 1` board must not carry idless `initialTasks` (they
 *     re-seed on every drain).
 */
import { sequencer, handler } from "@flow-state-dev/core";
import type {
  BlockDefinition,
  SequencerDefinition,
  DefinedCapability,
} from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z, type ZodTypeAny } from "zod";
import { hasOpenHold, owesTurn, type TaskCollectionRef, type TaskInit } from "../tasks";
import type { TaskBoardHandle } from "./index";
import { createApplyReplan, type TaskContextSupply } from "./apply-replan";
import { setNextDrainUnseeded } from "./blocks/seed-collection";

// ---------------------------------------------------------------------------
// Public contract
// ---------------------------------------------------------------------------

/**
 * A judge's verdict after one drain. Three-way (mirrors P&E's evaluator),
 * because `replan` and `continue` must NOT collapse: `continue` re-drains
 * existing in-flight work with no new tasks; `replan` adds work (inline
 * `tasks`, or via the `replanner` slot when absent). Collapsing them would
 * either fire the replanner on ordinary continues or skip it on replans.
 */
export type Verdict =
  | { decision: "done"; reason: string }
  | { decision: "continue"; reason: string }
  | { decision: "replan"; reason: string; tasks?: TaskInit[] };

/**
 * Input to an inline-fn judge: the resolved collection ref plus the raw drain
 * result. Built inside the judge wrapper (never placed on the chain — a live
 * ref would not survive a structured-clone step boundary). A block or
 * sub-sequencer judge instead receives the raw drain result and reads the board
 * from `ctx` (what the built-in patterns do).
 */
export interface JudgeInput {
  collection: TaskCollectionRef;
  drainResult: unknown;
}

/**
 * The judge slot. A full block or sub-sequencer whose output maps to a
 * `Verdict` (via `mapToVerdict` or by emitting the shape directly), or an
 * inline fn returning a complete `Verdict`. Bring-your-own — `goalSeekLoop`
 * ships no per-dialect judge factories.
 */
export type JudgeSlot =
  | BlockDefinition<any, any>
  | SequencerDefinition<any, any>
  | ((input: JudgeInput, ctx: BlockContext) => Verdict | Promise<Verdict>);

export interface GoalSeekLoopConfig {
  /** Name for the loop's outer sequencer and its internal block-name prefix. */
  name: string;
  /**
   * Input schema forwarded to the OUTER sequencer verbatim, so a re-expressed
   * pattern keeps its public block metadata (and survives `GeneratorTool`
   * wrapping — FIX-918 forward-compat). Omit for `z.unknown()`.
   */
  inputSchema?: ZodTypeAny;
  /**
   * Forwarded to the OUTER sequencer so a re-expressed pattern keeps its public
   * status emission (`executeBlock` emits `activeStatusMessage` before the
   * block runs).
   */
  activeStatusMessage?: string;
  /**
   * The drain substrate. MUST be request- or resource-backed (rejected at
   * construction otherwise). `goalSeekLoop` mounts `board.drain` as the loop
   * target.
   */
  board: TaskBoardHandle<any, any, any>;
  /**
   * Extra state fields merged into the loop's own single loop-owner state
   * container (`ctx.self` ≡ `ctx.sequencer` for a sequencer). Required for P&E
   * parity so its re-expressed blocks read/patch `goal`/`status`. The loop's
   * own fields carry the `goalSeekLoop` prefix so they never collide with a
   * caller field.
   */
  stateSchema?: ZodTypeAny;
  /**
   * Produces the initial tasks (the "plan"). Writes via the board accessor
   * before the drain, so it REQUIRES request/resource backing. Accepts a
   * sub-sequencer because the patterns' seeds are multi-step. Optional when
   * tasks are pre-seeded.
   */
  seed?: BlockDefinition<any, any> | SequencerDefinition<any, any>;
  /**
   * Runs as a `.tap` immediately AFTER each drain, BEFORE the judge. (A failed
   * or cancelled row's dependents need no step here: the board cancels them on
   * that row's ending.)
   */
  afterDrain?: BlockDefinition<any, any>;
  /** Evaluated after `afterDrain` → `Verdict`. MANDATORY. */
  judge: JudgeSlot;
  /**
   * Runs on a `replan` verdict with no inline `tasks` array; its emitted
   * `{ tasks }` then flow through the add step. Its output is shape-validated
   * and rescue-wrapped like the judge.
   */
  replanner?: BlockDefinition<any, any>;
  /** Forwarded to the lifted `createApplyReplan` for replanned-task defaults. */
  maxAttemptsPerTask?: number;
  /** Forwarded to the lifted `createApplyReplan` for replanned-task context. */
  taskContext?: TaskContextSupply;
  /**
   * MANDATORY hard backstop = total drains. A finite positive integer
   * (validated with `Number.isSafeInteger(n) && n > 0`). Threaded to `loopBack`
   * as `maxIterations - 1` jumps (the drain runs once before the first jump).
   */
  maxIterations: number;
  /**
   * Synthesizer over the settled-board projection (`goalSeekLoop` projects the
   * board before invoking it). Omit to return that projection raw.
   */
  finalize?: BlockDefinition<any, any> | SequencerDefinition<any, any>;
  /**
   * Judge-error posture. `"skip"` (default): a judge throw / malformed verdict
   * lands as `{ done, "judge-error" }`. `"fail"`: it propagates as a request
   * error. Only scopes the judge (and replanner) rescue — a seed/board.drain
   * failure always propagates.
   */
  onError?: "skip" | "fail";
}

/** Component type of the loop's terminal observability signal (reason + drain
 *  count). Distinct from `task-board-meta` so it never clobbers the completed
 *  board snapshot `<TaskPlan/>` scans. No renderer consumes it: the shipped
 *  chat registry names it with `false` so it never surfaces as raw JSON. Its
 *  `itemVisibility` stamp cannot do that job — a `component` item is
 *  structural, and structural items ignore `itemVisibility`. */
export const GOAL_SEEK_LOOP_TERMINATION_COMPONENT_TYPE = "goal-seek-loop-termination";

// ---------------------------------------------------------------------------
// mapToVerdict
// ---------------------------------------------------------------------------

/**
 * Mapping from a bring-your-own decision shape to a `Verdict`. `decision` maps
 * the source to the loop's three-way decision; `reason`/`tasks` derive the rest
 * (a default reason is injected per decision when `reason` is omitted, so a
 * legacy decision-only source like `{ decision: "complete" }` is never treated
 * as malformed).
 */
export interface VerdictMapping<TSource> {
  decision: (source: TSource) => Verdict["decision"];
  reason?: (source: TSource) => string;
  tasks?: (source: TSource) => TaskInit[] | undefined;
}

const DEFAULT_REASON: Record<Verdict["decision"], string> = {
  done: "converged",
  continue: "continue",
  replan: "replan",
};

/**
 * Adapt an existing decision shape to a `Verdict`, injecting a default reason
 * when the source omits one. Pure helper — patterns bring their own judge and
 * map its output through this rather than `goalSeekLoop` shipping per-dialect
 * factories.
 */
export function mapToVerdict<TSource>(
  source: TSource,
  mapping: VerdictMapping<TSource>,
): Verdict {
  const decision = mapping.decision(source);
  const reason = mapping.reason?.(source) ?? DEFAULT_REASON[decision];
  if (decision === "replan") {
    const tasks = mapping.tasks?.(source);
    return tasks !== undefined
      ? { decision, reason, tasks }
      : { decision, reason };
  }
  return { decision, reason };
}

// ---------------------------------------------------------------------------
// State + verdict validation schemas
// ---------------------------------------------------------------------------

/** The loop's own bookkeeping — `goalSeekLoop`-prefixed to avoid caller
 *  collision when merged into the one loop-owner container. */
const goalSeekLoopStateSchema = z.object({
  goalSeekLoopDrains: z.number().default(0),
  goalSeekLoopVerdict: z.unknown().nullable().default(null),
  goalSeekLoopDrainResult: z.unknown().nullable().default(null),
  /** Whether the last drain left a task waiting on a person: the pass ends without a judge. */
  goalSeekLoopWaiting: z.boolean().default(false),
  /** Whether the last drain left a task owing a turn, and none waiting on a person: the pass drains again. */
  goalSeekLoopOwed: z.boolean().default(false),
});

/** The termination reason of a pass a task waiting on a person ended. */
const WAITING_ON_A_USER = "waiting-on-a-user";

/** Whether the loop's last drain left a task waiting on a person. */
const waitingNow = (_input: unknown, ctx: { sequencer?: { state: unknown } }): boolean =>
  (ctx.sequencer?.state as { goalSeekLoopWaiting?: boolean } | undefined)?.goalSeekLoopWaiting === true;

/** Whether the loop's last drain left a task owing a turn an answer earned, with none waiting on a person. */
const owedNow = (_input: unknown, ctx: { sequencer?: { state: unknown } }): boolean =>
  (ctx.sequencer?.state as { goalSeekLoopOwed?: boolean } | undefined)?.goalSeekLoopOwed === true;

/** Whether the pass must not judge: a task waits on a person, or still owes a turn when the owed-turn drains ran out. */
const unfinishedNow = (input: unknown, ctx: { sequencer?: { state: unknown } }): boolean =>
  waitingNow(input, ctx) || owedNow(input, ctx);

/** Verdict validation — requires `reason` (mapped sources get a default via
 *  `mapToVerdict`; an inline judge must return a complete `Verdict`). */
const verdictSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("done"), reason: z.string() }).passthrough(),
  z.object({ decision: z.literal("continue"), reason: z.string() }).passthrough(),
  z
    .object({
      decision: z.literal("replan"),
      reason: z.string(),
      tasks: z.array(z.unknown()).optional(),
    })
    .passthrough(),
]);

function mergeStateSchema(extra: ZodTypeAny | undefined, name: string): ZodTypeAny {
  if (extra === undefined) return goalSeekLoopStateSchema;
  // Only a ZodObject can merge field-wise with the loop's own container. A
  // non-object schema (intersection, lazy, refined) can't, and silently keeping
  // only the loop's fields would drop the caller's — so fail fast at
  // construction, consistent with the primitive's other guards.
  if (extra instanceof z.ZodObject) {
    return goalSeekLoopStateSchema.merge(extra);
  }
  throw new Error(
    `[goalSeekLoop] "${name}" stateSchema must be a ZodObject so its fields can merge ` +
      `into the loop-owner state (got ${(extra as { constructor?: { name?: string } }).constructor?.name ?? typeof extra}). ` +
      `Wrap your fields in z.object({ ... }).`,
  );
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build a `goalSeekLoop` sequencer. See the module doc for the assembly and
 * preconditions.
 */
export function goalSeekLoop(config: GoalSeekLoopConfig): SequencerDefinition<any, any> {
  const {
    name,
    inputSchema = z.unknown(),
    activeStatusMessage,
    board,
    stateSchema,
    seed,
    afterDrain,
    judge,
    replanner,
    maxAttemptsPerTask = 1,
    taskContext,
    maxIterations,
    finalize,
    onError = "skip",
  } = config;

  // ---- Construction-time guards (fail fast) --------------------------------

  if (!Number.isSafeInteger(maxIterations) || maxIterations <= 0) {
    throw new Error(
      `[goalSeekLoop] "${name}" maxIterations must be a finite positive integer (got ${maxIterations})`,
    );
  }
  if (board.backing === "sequencer" || board.backing === "factory") {
    throw new Error(
      `[goalSeekLoop] "${name}" requires a request- or resource-backed board; ` +
        `"${board.backing}" backing is unsupported (it cannot be re-drained/projected). ` +
        `Use the default request backing or a defineTaskCollection resource.`,
    );
  }
  // FIX-2076: the judge rules on the board as the drain left it, so every row
  // must have ended when the drain returns. A delegation board's drain can
  // return with one still running.
  if (board.mode === "delegation") {
    throw new Error(
      `[goalSeekLoop] "${name}" can't loop over "${board.capability.name}", a delegation board: ` +
        `its drain returns while the rows it handed to other sessions still run, so the judge ` +
        `would rule on unfinished work. Loop over a plan board, whose drain waits on every row.`,
    );
  }
  if (maxIterations > 1 && board.hasIdlessInitialTasks) {
    throw new Error(
      `[goalSeekLoop] "${name}" cannot loop (maxIterations > 1) over a board whose ` +
        `initialTasks carry no stable id — they re-seed on every drain. Give each ` +
        `initialTask an id, or seed via the loop's own seed slot.`,
    );
  }

  const boardCapName = board.capability.name;
  const merged = mergeStateSchema(stateSchema, name);

  // ---- Small state-touching helpers (read/patch the loop-owner container) --

  // After each drain: does a task still wait on a person's answer (the rows
  // the drain's exit check excuses, an open hold), or, with none waiting,
  // owe a turn an answer that landed after the drain stopped earned? Read
  // through the board's own accessor, as the projection below is.
  const noteWaiting = handler({
    name: `${name}-gsl-note-waiting`,
    inputSchema: z.unknown(),
    uses: [board.capability],
    sequencerStateSchema: merged,
    execute: async (_input, ctx) => {
      const ref = await resolveBoardRef(ctx, boardCapName);
      const rows = ref.list();
      const waiting = rows.some((row) => hasOpenHold(row));
      await ctx.sequencer!.patchState({ goalSeekLoopWaiting: waiting, goalSeekLoopOwed: !waiting && rows.some(owesTurn) } as any);
    },
  });

  // A pass a task waiting on a person (or owing a turn) ended judges nothing, so it spends no iteration.
  const waitingVerdict = handler({
    name: `${name}-gsl-waiting-verdict`,
    inputSchema: z.unknown(),
    execute: (): Verdict => ({ decision: "done", reason: WAITING_ON_A_USER }),
  });

  const incrementDrainCount = handler({
    name: `${name}-gsl-increment-drains`,
    inputSchema: z.unknown(),
    sequencerStateSchema: merged,
    execute: async (_input, ctx) => {
      if (unfinishedNow(undefined, ctx)) return;
      const next =
        ((ctx.sequencer!.state as { goalSeekLoopDrains?: number }).goalSeekLoopDrains ?? 0) + 1;
      await ctx.sequencer!.patchState({ goalSeekLoopDrains: next } as any);
    },
  });

  // Re-read the collection AFTER afterDrain (post-cascade) — the drain's carried
  // value is the workers' loop decisions, not a projection — and stash it for
  // `projectBoard`. Requires request/resource backing (guarded above).
  const stashDrainProjection = handler({
    name: `${name}-gsl-stash-projection`,
    inputSchema: z.unknown(),
    uses: [board.capability],
    sequencerStateSchema: merged,
    execute: async (_input, ctx) => {
      const ref = await resolveBoardRef(ctx, boardCapName);
      const projection = projectCollection(ref);
      await ctx.sequencer!.patchState({ goalSeekLoopDrainResult: projection } as any);
    },
  });

  // ---- judgeStep: run judge → validate, judge-scoped rescue
  //
  // The live `TaskCollectionRef` (a methods-bearing object) is NEVER placed on
  // the chain — a structured-clone boundary between steps would reject it. An
  // inline-fn judge gets its `JudgeInput` built INSIDE the wrapper's `execute`
  // (local, not a step output); a block/sub-sequencer judge receives the raw
  // drain result and reads the board from `ctx` (what the built-in patterns do).

  const judgeBlock: BlockDefinition<any, any> =
    typeof judge === "function"
      ? handler({
          name: `${name}-gsl-judge`,
          inputSchema: z.unknown(),
          uses: [board.capability],
          execute: async (drainResult, ctx) => {
            const collection = await resolveBoardRef(ctx, boardCapName);
            return judge({ collection, drainResult }, ctx);
          },
        })
      : (judge as BlockDefinition<any, any>);

  const validateVerdictBlock = handler({
    name: `${name}-gsl-validate-verdict`,
    inputSchema: z.unknown(),
    execute: (raw) => {
      const parsed = verdictSchema.safeParse(raw);
      if (!parsed.success) {
        throw new Error(
          `[goalSeekLoop] "${name}" judge returned a malformed verdict: ${parsed.error.message}`,
        );
      }
      const v = parsed.data as Verdict;
      // A `replan` that produces no actual work — no NON-EMPTY inline array — and
      // has no replanner to produce any would silently re-drain the settled board
      // to the cap. Treat it as a judge-error (mirrors the wrappedReplanner gate,
      // which fires the replanner on the same empty-or-absent condition when one
      // IS configured). An empty `tasks: []` is not valid inline work.
      const replanTasks = (v as { tasks?: unknown }).tasks;
      const hasInlineWork = Array.isArray(replanTasks) && replanTasks.length > 0;
      if (v.decision === "replan" && !hasInlineWork && !replanner) {
        throw new Error(
          `[goalSeekLoop] "${name}" judge returned "replan" with no tasks and no replanner configured`,
        );
      }
      return v;
    },
  });

  // Rescue block — maps a judge/validation throw to a judge-error terminal
  // verdict AND re-stamps the stashed verdict so the terminal item reports it.
  const judgeErrorRescue = handler({
    name: `${name}-gsl-judge-error`,
    inputSchema: z.unknown(),
    sequencerStateSchema: merged,
    execute: async (_error, ctx) => {
      const verdict: Verdict = { decision: "done", reason: "judge-error" };
      await ctx.sequencer!.patchState({ goalSeekLoopVerdict: verdict } as any);
      return verdict;
    },
  });

  // The judge sub-sequencer intentionally declares NO stateSchema, so its inner
  // blocks' `ctx.sequencer` resolves up to the loop-owner container. The
  // block-level `.rescue` (skip only) is scoped to the judge + validation, so a
  // seed/board.drain failure earlier in the outer chain is never swallowed.
  let judgeStep = sequencer({ name: `${name}-gsl-judge-step`, inputSchema: z.unknown() })
    .step(judgeBlock)
    .step(validateVerdictBlock);
  if (onError === "skip") {
    judgeStep = judgeStep.rescue([{ block: judgeErrorRescue }]);
  }

  // Cap coercion + verdict stash. At the last allowed drain, coerce ONLY a
  // non-done verdict → { done, "max-iterations" } (a `done` on the final drain
  // is kept → its own reason). Runs BEFORE replan/apply so a final-drain replan
  // adds no un-drainable work.
  const coerceAtCap = handler({
    name: `${name}-gsl-coerce-cap`,
    inputSchema: z.unknown(),
    sequencerStateSchema: merged,
    execute: async (input, ctx) => {
      const verdict = input as Verdict;
      const drains =
        (ctx.sequencer!.state as { goalSeekLoopDrains?: number }).goalSeekLoopDrains ?? 0;
      const coerced: Verdict =
        drains >= maxIterations && verdict.decision !== "done"
          ? { decision: "done", reason: "max-iterations" }
          : verdict;
      await ctx.sequencer!.patchState({ goalSeekLoopVerdict: coerced } as any);
      return coerced;
    },
  });

  // Configured replanner, wrapped like the judge: output shape-validated
  // ({ tasks: non-empty }), and rescue-scoped so a no-task payload lands via
  // onError instead of a silent re-drain.
  const wrappedReplanner = replanner
    ? buildWrappedReplanner({ name, replanner, onError, judgeErrorRescue })
    : undefined;

  const applyReplanTasks = createApplyReplan({
    name,
    maxAttemptsPerTask,
    ...(taskContext !== undefined ? { taskContext } : {}),
    capability: board.capability,
    sequencerStateSchema: merged,
  });

  // ---- Terminal + projection blocks ----------------------------------------

  const emitTermination = handler({
    name: `${name}-gsl-emit-termination`,
    inputSchema: z.unknown(),
    sequencerStateSchema: merged,
    execute: async (_input, ctx) => {
      const state = ctx.sequencer!.state as {
        goalSeekLoopDrains?: number;
        goalSeekLoopVerdict?: Verdict | null;
      };
      const iterations = state.goalSeekLoopDrains ?? 0;
      const reason = state.goalSeekLoopVerdict?.reason ?? "converged";
      // A typed observability signal, NOT a rendered UI element. It stays on
      // the live stream for tooling and is what the goalSeekLoop tests assert
      // on. The `itemVisibility` stamp records that intent but does not
      // enforce it (structural items ignore it); the renderer registry's
      // `false` entry for this type is what keeps it out of the thread.
      ctx.emit.component(
        GOAL_SEEK_LOOP_TERMINATION_COMPONENT_TYPE,
        { collectionId: board.collectionId, reason, iterations },
        {
          key: `${board.collectionId}:goalSeekLoop-termination`,
          itemVisibility: { client: false, history: false },
        },
      );
    },
  });

  const projectBoard = handler({
    name: `${name}-gsl-project`,
    inputSchema: z.unknown(),
    sequencerStateSchema: merged,
    execute: async (_input, ctx) =>
      (ctx.sequencer!.state as { goalSeekLoopDrainResult?: unknown }).goalSeekLoopDrainResult ??
      null,
  });

  // ---- Assemble the pipeline ----------------------------------------------

  let pipeline: any = sequencer({
    name,
    inputSchema,
    stateSchema: merged,
    uses: [board.capability],
    ...(activeStatusMessage ? { activeStatusMessage } : {}),
  });

  if (seed !== undefined) pipeline = pipeline.step(seed);

  // One pass's drain: drain, read the board, and drain again while a task owes
  // a turn and none waits on a person (see the file header). No state schema,
  // so its blocks read and write the loop's own state, as the judge step's do.
  // The drain that takes an owed turn does not seed the board again: the pass
  // already did, and an id-less initial task would be added twice. It is
  // marked for the board here, never asked for through the drain's input.
  const drainPass = sequencer({ name: `${name}-gsl-drain-pass`, inputSchema: z.unknown(), uses: [board.capability] })
    .step((input: unknown, ctx: BlockContext) => {
      if (board.hasIdlessInitialTasks) setNextDrainUnseeded(ctx, board.collectionId, owedNow(input, ctx));
      return input;
    }, board.drain)
    .tap(noteWaiting)
    .loopBack(board.drain.name, { when: owedNow, maxIterations });

  pipeline = pipeline
    .step(drainPass)
    .tap(incrementDrainCount);
  if (afterDrain !== undefined) pipeline = pipeline.tap(afterDrain);
  pipeline = pipeline
    .tap(stashDrainProjection)
    .stepIf(unfinishedNow, waitingVerdict)
    .stepIf((input: unknown, ctx: { sequencer?: { state: unknown } }) => !unfinishedNow(input, ctx), judgeStep)
    .step(coerceAtCap);
  if (wrappedReplanner !== undefined) {
    pipeline = pipeline.stepIf(
      // Fire the replanner on a `replan` verdict that carries no *actual* inline
      // work — an absent tasks array OR an empty one. An empty `tasks: []` is a
      // judge that asked to replan but produced nothing, so fall through to the
      // configured replanner (whose job is to produce work) rather than
      // no-op-adding and spinning the settled board to the cap.
      (v: Verdict) => {
        const tasks = (v as { tasks?: unknown }).tasks;
        return v.decision === "replan" && !(Array.isArray(tasks) && tasks.length > 0);
      },
      wrappedReplanner,
    );
  }
  pipeline = pipeline
    .stepIf(
      // Add tasks only on a non-`done` verdict that carries an array — inline
      // replan tasks (`decision: "replan"`) or the replanner's `{ tasks }`
      // (no `decision`). Guard on `decision !== "done"` so a `done` verdict that
      // slips a stray `tasks` array through the schema's passthrough is NOT
      // mis-applied as a replan (which would return `continue` and loop instead
      // of stopping). A cap-coerced `done` carries no tasks, so it's unaffected.
      (v: unknown) =>
        (v as { decision?: string }).decision !== "done" &&
        Array.isArray((v as { tasks?: unknown }).tasks),
      applyReplanTasks,
    )
    .map((v: unknown) => ({
      decision: (v as { decision?: string }).decision ?? "continue",
    }))
    .loopBack(drainPass.name, {
      when: (v: unknown) => (v as { decision?: string }).decision !== "done",
      maxIterations: maxIterations - 1,
    })
    .tap(emitTermination)
    .step(projectBoard);

  // Nothing is final while a task waits on a person or owes a turn.
  if (finalize !== undefined) pipeline = pipeline.stepIf((input: unknown, ctx: { sequencer?: { state: unknown } }) => !unfinishedNow(input, ctx), finalize);

  return pipeline as SequencerDefinition<any, any>;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/** Resolve the board's `TaskCollectionRef` through its own accessor. */
async function resolveBoardRef(
  ctx: BlockContext,
  boardCapName: string,
): Promise<TaskCollectionRef> {
  const cap = (ctx.cap as Record<string, { tasks: () => Promise<TaskCollectionRef> }>)[
    boardCapName
  ];
  return cap.tasks();
}

/** Build the settled-board projection `finalize`/omitted-`finalize` return. */
function projectCollection(ref: TaskCollectionRef): {
  tasks: Array<{ id: string; goal: string; status: string; output: unknown; error?: string }>;
  results: unknown[];
} {
  const tasks = ref.list();
  return {
    tasks: tasks.map((t) => ({
      id: t.id,
      goal: t.goal,
      status: t.status,
      output: t.output,
      ...(t.error !== undefined ? { error: t.error } : {}),
    })),
    results: tasks
      .filter((t) => t.status === "completed")
      .map((t) => t.output)
      .filter((o): o is unknown => o !== undefined),
  };
}

/**
 * Wrap a configured replanner so its output is shape-validated (`{ tasks }`,
 * non-empty) inside a rescue scoped like the judge's: a malformed / no-task
 * payload lands as `{ done, "judge-error" }` under `onError: "skip"` (and
 * re-stamps the stashed verdict), or propagates under `"fail"`.
 */
function buildWrappedReplanner(opts: {
  name: string;
  replanner: BlockDefinition<any, any>;
  onError: "skip" | "fail";
  judgeErrorRescue: BlockDefinition<any, any>;
}): SequencerDefinition<any, any> {
  const { name, replanner, onError, judgeErrorRescue } = opts;
  const validateReplannerOutput = handler({
    name: `${name}-gsl-validate-replan`,
    inputSchema: z.unknown(),
    execute: (raw) => {
      const parsed = z.object({ tasks: z.array(z.unknown()) }).safeParse(raw);
      if (!parsed.success || parsed.data.tasks.length === 0) {
        throw new Error(
          `[goalSeekLoop] "${name}" replanner emitted no tasks on a "replan" verdict`,
        );
      }
      return raw;
    },
  });

  let seq: any = sequencer({ name: `${name}-gsl-replanner`, inputSchema: z.unknown() })
    .step(replanner)
    .step(validateReplannerOutput);
  if (onError === "skip") {
    seq = seq.rescue([{ block: judgeErrorRescue }]);
  }
  return seq as SequencerDefinition<any, any>;
}
