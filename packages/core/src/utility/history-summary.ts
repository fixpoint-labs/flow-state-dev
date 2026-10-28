/**
 * History summary (FIX-1613): a long conversation keeps what it said before
 * its history window.
 *
 * `historySummary({ summarize })` returns two halves, the way memory's
 * `system()` does:
 *
 * - `capability`, installed on the generator that answers (`uses`). It holds
 *   the running summary in a session resource, gives it to the model as one
 *   context section, and starts that generator's history reads after the
 *   summary's mark, so no turn is read twice.
 * - `fold`, a step the flow runs before that generator (`.tap(fold)`). Once the
 *   oldest unfolded turn reaches the oldest quarter of the window, it folds up
 *   to a quarter of the window into the summary with the author's `summarize`
 *   block, before anything leaves. A turn that has not settled (running,
 *   suspended, parked) is kept by id and folded once it settles.
 *
 * The engine knows nothing about summaries: it opens the window
 * (`ctx.session.window`), the turn reads (`ctx.session.items.turns()`) and
 * `history({ afterRequestId })`, and records `historyStart` on each request.
 */
import { z } from "zod";
import { defineCapability } from "../capability";
import { handler } from "../blocks/handler";
import { sequencer } from "../blocks/sequencer";
import { defineResource } from "../types/resource";
import type { BlockContext, BlockDefinition } from "../types/block";
import type { HistoryTurn, LLMMessage } from "../types/scope";

/** What `summarize` is handed on each fold. */
export type HistorySummaryInput = {
  /** The running summary so far; null on the first fold. */
  summary: string | null;
  /** The turns being folded, oldest first, as the model would have read them. */
  turns: LLMMessage[];
};

/** The session resource a history summary keeps. */
export const historySummaryStateSchema = z.object({
  /** The running summary. */
  summary: z.string().nullable().default(null),
  /** The high-water mark: the newest turn folded, or moved past and kept pending. */
  throughRequestId: z.string().nullable().default(null),
  throughStartedAtMs: z.number().nullable().default(null),
  /** The oldest turn after the mark at the last fold. Gone unfolded later means turns were lost. */
  nextRequestId: z.string().nullable().default(null),
  /** Turns behind the mark that had not settled, by request id; folded once they do. */
  pending: z.array(z.string()).default([]),
  /** A turn left the window unsummarized. Stays set: the summary has a hole. */
  gap: z.boolean().default(false),
  /** Every turn before the mark is in the summary: no gap and nothing pending. */
  complete: z.boolean().default(true),
  /** Folds written. */
  folds: z.number().int().default(0),
  /** Folds tried, written or failed. A turn out of view with none tried: the fold step is missing. */
  attempts: z.number().int().default(0),
});

export type HistorySummaryState = z.infer<typeof historySummaryStateSchema>;

const HISTORY_SUMMARY_DEFAULT: HistorySummaryState = historySummaryStateSchema.parse({});

/** What the fold's first step decided: the turns to fold and where the mark lands. */
type FoldPlan = {
  summary: string | null;
  turns: LLMMessage[];
  /** The mark this plan read; another turn moving it first discards this plan. */
  expectedThroughStartedAtMs: number | null;
  next: Pick<
    HistorySummaryState,
    "throughRequestId" | "throughStartedAtMs" | "nextRequestId" | "pending" | "gap" | "complete"
  >;
};

export interface HistorySummaryOptions {
  /**
   * The block that writes the summary: handed the summary so far and the turns
   * to fold, returning `{ summary }`. Core's `summarizer(...)` fits as is.
   */
  summarize: BlockDefinition<any, any>;
  /** The resource's accessor name and storage key. Default `historySummary`. */
  name?: string;
}

/**
 * Build a history summary: a capability for the generator that answers and a
 * fold step the flow runs before it.
 *
 * ```ts
 * const earlier = historySummary({
 *   summarize: summarizer({ name: "earlier-turns", granularity: "detailed" }),
 * });
 *
 * sequencer({ name: "chat", inputSchema })
 *   .tap(earlier.fold)
 *   .step(generator({ name: "answer", history: true, uses: [earlier.capability], ... }));
 * ```
 */
export function historySummary(options: HistorySummaryOptions) {
  const name = options.name ?? "historySummary";

  // One per conversation, however many generators install the capability.
  // Public, so a screen can label its divider "earlier turns summarized".
  const resource = defineResource({
    ref: name,
    scope: "session",
    stateSchema: historySummaryStateSchema,
    default: HISTORY_SUMMARY_DEFAULT,
    writable: true,
    client: { expose: ["throughRequestId", "complete", "folds"] },
  });
  const resources = { [name]: resource };
  const stateOf = (ctx: BlockContext): HistorySummaryState =>
    ({ ...HISTORY_SUMMARY_DEFAULT, ...((ctx.resources as any)[name]?.state ?? {}) }) as HistorySummaryState;
  const update = (ctx: BlockContext, updater: (state: HistorySummaryState) => HistorySummaryState) =>
    (ctx.resources as any)[name].updateState((state: HistorySummaryState) =>
      updater({ ...HISTORY_SUMMARY_DEFAULT, ...state })
    ) as Promise<void>;

  const capability = defineCapability({
    name,
    resources,
    presets: {
      default: ["context", "history"],
      context: {
        context: (_input: unknown, ctx: any) => {
          const state = stateOf(ctx as BlockContext);
          const window = (ctx as BlockContext).session?.window;
          if (window?.startRequestId !== undefined && state.attempts === 0) {
            throw new Error(
              `historySummary "${name}": turns have left the history window and no fold has run. ` +
                `Run its fold step before this generator (\`.tap(${name}.fold)\`, or workforce's \`beforeAnswer\`).`
            );
          }
          return state.summary === null
            ? null
            : `<earlier-conversation>\n${state.summary}\n</earlier-conversation>`;
        },
      },
      // The summary stands for every turn up to its mark.
      history: {
        history: (ctx: BlockContext) => {
          const through = stateOf(ctx).throughRequestId;
          return through === null ? {} : { afterRequestId: through };
        },
      },
    },
  });

  const plan = handler({
    name: `${name}-plan`,
    inputSchema: z.unknown(),
    resources,
    execute: async (_input, ctx): Promise<FoldPlan | null> => {
      const window = ctx.session.window;
      if (window === undefined) return null;
      const state = stateOf(ctx as BlockContext);
      const quarter = Math.max(1, Math.floor(window.turns / 4));

      // Turns that left open earlier: fold the ones that have settled since.
      const pendingTurns = state.pending.length > 0
        ? await ctx.session.items.turns({ requestIds: state.pending })
        : [];
      const settledPending = pendingTurns.filter((t) => t.settled);
      const stillPending = pendingTurns.filter((t) => !t.settled).map((t) => t.requestId);

      const all = await ctx.session.items.turns();
      // After the mark by position while the window holds it (two turns can
      // share a start millisecond), by start time once it has left.
      const markAt = state.throughRequestId === null ? -1 : all.findIndex((t) => t.requestId === state.throughRequestId);
      const after = markAt !== -1
        ? all.slice(markAt + 1)
        : all.filter((t) => state.throughStartedAtMs === null || t.startedAtMs > state.throughStartedAtMs);

      // Turns lost: the oldest unfolded turn the last fold saw left unfolded,
      // or the summary started after turns had already left the window.
      const lost =
        (state.nextRequestId !== null && !all.some((t) => t.requestId === state.nextRequestId)) ||
        (state.attempts === 0 && window.startRequestId !== undefined);

      const due = after.length > window.turns - quarter;
      const batch: HistoryTurn[] = due ? after.slice(0, quarter) : [];
      if (batch.length === 0 && settledPending.length === 0) return null;

      const folded = [...settledPending, ...batch.filter((t) => t.settled)];
      const pending = [...stillPending, ...batch.filter((t) => !t.settled).map((t) => t.requestId)];
      const last = batch.at(-1);
      const gap = state.gap || lost;
      return {
        summary: state.summary,
        turns: folded.flatMap((t) => t.messages),
        expectedThroughStartedAtMs: state.throughStartedAtMs,
        next: {
          throughRequestId: last?.requestId ?? state.throughRequestId,
          throughStartedAtMs: last?.startedAtMs ?? state.throughStartedAtMs,
          nextRequestId: last === undefined ? state.nextRequestId : (after[batch.length]?.requestId ?? null),
          pending,
          gap,
          complete: !gap && pending.length === 0,
        },
      };
    },
  });

  const write = handler({
    name: `${name}-write`,
    inputSchema: z.object({ summary: z.string() }).passthrough(),
    resources,
    execute: async (output, ctx) => {
      const decided = ctx.getBlockOutput(plan) as FoldPlan | null | undefined;
      if (decided == null) return;
      await update(ctx as BlockContext, (state) =>
        // Another turn of this conversation folded first: keep its write.
        state.throughStartedAtMs !== decided.expectedThroughStartedAtMs
          ? state
          : {
              ...state,
              ...decided.next,
              summary: output.summary,
              folds: state.folds + 1,
              attempts: state.attempts + 1,
            }
      );
    },
  });

  const failed = handler({
    name: `${name}-failed`,
    inputSchema: z.unknown(),
    resources,
    execute: async (error, ctx) => {
      // The turn goes on with the summary it had; the next turn tries again,
      // and the fold started early enough that nothing leaves meanwhile.
      console.warn(
        `[historySummary] "${name}" fold failed; the next turn retries:`,
        error instanceof Error ? error.message : error
      );
      await update(ctx as BlockContext, (state) => ({ ...state, attempts: state.attempts + 1 }));
    },
  });

  const fold = sequencer({ name: `${name}-fold`, inputSchema: z.unknown() })
    .step(plan)
    .stepIf(
      (planned: FoldPlan | null) => planned !== null,
      (planned: FoldPlan | null) => ({ summary: planned!.summary, turns: planned!.turns }) satisfies HistorySummaryInput,
      options.summarize
    )
    // Only after a summary ran: a skipped step passes the plan (or null) on.
    .stepIf((value: unknown) => value != null && !("next" in (value as object)), write)
    .rescue([{ block: failed }]);

  return { capability, fold, resource };
}
