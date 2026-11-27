/**
 * Which turns a history summary stands for (`foldedRequestIds`), as the
 * engine's history read leaves them out after the summary's mark: every turn
 * up to the mark by start time then id, pending ones included, and every
 * loaded turn when the mark is newer than all of them. A flow that matches its
 * history back to the session's items leaves these items out, so a reading
 * that disagrees with the history's own pairs a message with the wrong item.
 * The fold keeps its pending turns: it still folds them.
 */
import { describe, expect, it } from "vitest";
import type { BlockContext } from "@flow-state-dev/core/types";
import { foldedRequestIds } from "../src/worker-default-layer";

type Turn = { requestId: string; startedAtMs: number };

/** A context whose summary's mark is `through`, holding `pending`, over the loaded `turns`; `others` are readable by id only. */
function ctxOf(options: { through: string | null; pending?: string[]; turns: Turn[]; others?: Turn[] }): BlockContext {
  const known = [...options.turns, ...(options.others ?? [])];
  return {
    resources: { historySummary: { state: { throughRequestId: options.through, pending: options.pending ?? [] } } },
    session: {
      items: {
        turns: async (query?: { requestIds?: string[] }) =>
          (query?.requestIds === undefined ? options.turns : known.filter((t) => query.requestIds!.includes(t.requestId))).map(
            (t) => ({ ...t, settled: true, messages: [] })
          )
      }
    }
  } as unknown as BlockContext;
}

const turns = [
  { requestId: "r1", startedAtMs: 10 },
  { requestId: "r2", startedAtMs: 20 },
  { requestId: "r3", startedAtMs: 30 }
];

describe("foldedRequestIds", () => {
  it("is every turn up to the mark, a pending one included, as the history leaves them out", async () => {
    const ids = await foldedRequestIds(ctxOf({ through: "r2", pending: ["r1"], turns }));
    expect([...ids].sort()).toEqual(["r1", "r2"]);
  });

  it("keeps a pending turn out of the set for the fold, which still folds it", async () => {
    const ids = await foldedRequestIds(ctxOf({ through: "r2", pending: ["r1"], turns }), { keepPending: true });
    expect([...ids]).toEqual(["r2"]);
  });

  it("is every loaded turn when the mark is newer than all of them", async () => {
    const ids = await foldedRequestIds(ctxOf({ through: "r9", turns, others: [{ requestId: "r9", startedAtMs: 99 }] }));
    expect([...ids].sort()).toEqual(["r1", "r2", "r3"]);
  });

  it("is none when the mark is older than every loaded turn, or cannot be read", async () => {
    expect([...(await foldedRequestIds(ctxOf({ through: "r0", turns, others: [{ requestId: "r0", startedAtMs: 1 }] })))]).toEqual([]);
    expect([...(await foldedRequestIds(ctxOf({ through: "gone", turns })))]).toEqual([]);
  });

  it("is none with nothing folded", async () => {
    expect([...(await foldedRequestIds(ctxOf({ through: null, turns })))]).toEqual([]);
  });
});
