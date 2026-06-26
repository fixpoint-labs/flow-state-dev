/**
 * The `runSummary` read action — a zero-model handler that projects a finished
 * (or stopped) `analyze` run into the machine-readable `RunSummary`.
 *
 * It reads the desk's own durable records for the current session — the
 * decision-of-record snapshot, the memo collection, and the session stop-state
 * — and returns the projection as its OUTPUT. Run headlessly as
 * `fsdev run analysis runSummary --session <id> --capture <file>`, the output
 * lands in the capture file at `result.output`, which the caller reads back.
 *
 * Why a separate read action (rather than scraping the analyze capture): the
 * CLI's NDJSON stream drops resource VALUES (it emits only change
 * notifications), and `analyze`'s own output is the audit/PM tail, not the
 * decision. Reading the resources here — via the blessed `ctx.resources` API —
 * is the only way to recover the decision + memo statuses after the fact.
 *
 * Returning the output works on the CLI / `runAction` path (`result.output` is
 * the action's return value). This is distinct from the HTTP `sendAction`
 * envelope path that makes `getQuotes` write to a resource instead — headless
 * verification drives `fsdev run`, so reading the return value is correct here.
 */
import { handler } from "@flow-state-dev/core";
import { z } from "zod";
import { decisionSnapshotResource } from "../decision-snapshot-resource";
import type { DecisionSnapshotState } from "../decision-snapshot-resource";
import { ALL_MEMO_KEYS } from "../registry";
import { memosCollection, type MemoState } from "../resources";
import {
  buildRunSummary,
  runSummaryStateSchema,
  type RunSummaryMemoInput,
} from "../run-summary";
import { sessionStateSchema } from "../state";

export const runSummaryAction = handler({
  name: "run-summary",
  // No caller input — the action reads the current session's stored records.
  inputSchema: z.object({}),
  outputSchema: runSummaryStateSchema,
  sessionStateSchema,
  resources: {
    decisionSnapshot: decisionSnapshotResource,
    memos: memosCollection,
  },
  execute: async (_input, ctx) => {
    // An unwritten single resource (a stopped / in-progress run has no decision)
    // can surface as `{}` rather than null; `buildRunSummary` guards on
    // `finalRating`, so pass whatever is there.
    const decisionSnapshot =
      (ctx.resources.decisionSnapshot.state as DecisionSnapshotState | null) ??
      null;

    // Read every registered memo by its known key. `getOptional` returns
    // `undefined` for a scaffold that was never created (a phase that never
    // ran) → reported as `pending`.
    const memos: RunSummaryMemoInput[] = await Promise.all(
      Object.values(ALL_MEMO_KEYS).map(async (entry) => {
        const ref = await ctx.resources.memos.getOptional(entry.collectionKey);
        return {
          key: entry.collectionKey,
          agentName: entry.agentName,
          // `ref.state` is `Readonly<MemoState>`; the projection only reads it.
          state: (ref?.state as MemoState | undefined) ?? null,
        };
      }),
    );

    return buildRunSummary({
      sessionState: ctx.session.state,
      decisionSnapshot,
      memos,
      sessionId: ctx.session.identity.id,
      ranAt: new Date().toISOString(),
    });
  },
});
