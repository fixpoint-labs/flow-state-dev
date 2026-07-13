/**
 * Shared memo read for the zero-model read actions (`runSummary`, `runArtifacts`).
 *
 * Both actions project the current session's memo collection into the same
 * `RunSummaryMemoInput[]` shape: every registered memo by its known key, with a
 * never-created scaffold reported as a `null` body. Extracted here once a second
 * consumer appeared (BP-024/BP-038) so the loop lives in one place.
 */
import { ALL_MEMO_KEYS } from "../registry";
import type { MemoState } from "../resources";
import type { RunSummaryMemoInput } from "../run-summary";

/** The subset of the memos collection ref these read actions use. */
type MemoReader = {
  getOptional: (key: string) => Promise<{ state?: unknown } | undefined>;
};

/** Read every registered memo by its known key. `getOptional` returns
 *  `undefined` for a scaffold that was never created (a phase that never ran) →
 *  reported as a `null` body. */
export async function readAllMemos(memos: MemoReader): Promise<RunSummaryMemoInput[]> {
  return Promise.all(
    Object.values(ALL_MEMO_KEYS).map(async (entry) => {
      const ref = await memos.getOptional(entry.collectionKey);
      return {
        key: entry.collectionKey,
        agentName: entry.agentName,
        state: (ref?.state as MemoState | undefined) ?? null,
      };
    }),
  );
}
