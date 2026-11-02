/**
 * Tests for `readSessionHistory`, the client's one paging loop.
 *
 * A paged read of a live session can pass for whole while it skipped an item
 * the history moved under it, and the stream that follows never sends that
 * item. These tests pin that the read starts over when the history moved,
 * fails loudly when it moved every time, and starts part way in when asked.
 */
import { describe, expect, it, vi } from "vitest";
import type { OutputItem } from "@flow-state-dev/core/items";
import type { GetSessionStateOptions, SessionStateSnapshotResponse } from "../src";
import { readSessionHistory } from "../src/session-client/session-history";

const message = (n: number): OutputItem =>
  ({ id: `item_${n}`, type: "message", role: "assistant", status: "completed", content: [] }) as unknown as OutputItem;
const range = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => message(from + i));
const ids = (items: readonly OutputItem[] | undefined) => (items ?? []).map((item) => item.id);

/** A session sliced as the state route slices it; `beforeCall` can move its history between calls. */
function session(items: OutputItem[], beforeCall: (call: number, items: OutputItem[]) => void = () => {}) {
  const state = vi.fn(async (_id: string, options: GetSessionStateOptions = {}): Promise<SessionStateSnapshotResponse> => {
    beforeCall(state.mock.calls.length, items);
    const offset = options.offset ?? 0;
    const limit = options.limit ?? 100;
    return {
      sessionId: "s1",
      flowKind: "chat",
      clientData: {},
      items: items.slice(offset, offset + limit),
      pagination: { offset, limit, total: items.length, hasMore: offset + limit < items.length, nextOffset: Math.min(offset + limit, items.length) }
    } as SessionStateSnapshotResponse;
  });
  return { state };
}

describe("readSessionHistory", () => {
  it("starts over when an item read on an earlier page is removed, so no item is skipped", async () => {
    // Removing item_0 after the first page shifts item_3 into the overlap slot.
    const source = session(range(0, 7), (call, items) => {
      if (call === 2) items.splice(0, 1);
    });

    const read = await readSessionHistory(source, "s1", { pageLimit: 3 });

    expect(ids(read.items)).toEqual(ids(range(1, 7)));
    expect(source.state.mock.calls.length).toBeGreaterThan(3);
  });

  it("throws rather than return part of the history when it moved during every attempt", async () => {
    const source = session(range(0, 50), (call, items) => {
      if (call % 2 === 0) items.splice(0, 1);
    });

    await expect(readSessionHistory(source, "s1", { pageLimit: 3, attempts: 2 })).rejects.toThrow(/changed during each of 2 reads/);
  });

  it("reads from a non-zero offset to the end, and reports where its items start and end", async () => {
    const source = session(range(0, 10));

    const read = await readSessionHistory(source, "s1", { offset: 4, pageLimit: 3 });

    expect(ids(read.items)).toEqual(ids(range(4, 10)));
    expect(read.pagination).toMatchObject({ offset: 4, total: 10, hasMore: false });
    expect(source.state.mock.calls[0]?.[1]).toMatchObject({ offset: 4 });
  });
});
