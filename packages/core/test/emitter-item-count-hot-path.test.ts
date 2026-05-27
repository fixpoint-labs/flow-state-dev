import { describe, expect, it, vi } from "vitest";
import { getEmitterItemCount } from "../src/blocks/internal/utils";
import type { ResponseEmitterHandle } from "../src/types/block";

/**
 * `getEmitterItemCount` runs on every item emit (it assigns the next
 * `itemIndex`). Before FIX-406 6G it read `getItems().length`, which sorted
 * every prior item on each call — turning a stream of N items into O(N² log N)
 * work. The count must come from an O(1) `getItemCount()` instead, never from
 * the sortable items snapshot.
 */
describe("getEmitterItemCount hot path", () => {
  it("reads the O(1) getItemCount and never materializes getItems", () => {
    const getItems = vi.fn(() => [] as never[]);
    const getItemCount = vi.fn(() => 7);
    const handle = {
      emit: vi.fn(),
      getItems,
      getItemCount,
      subscribeToItems: vi.fn(() => () => {})
    } as unknown as ResponseEmitterHandle;

    expect(getEmitterItemCount(handle)).toBe(7);
    expect(getItemCount).toHaveBeenCalledTimes(1);
    expect(getItems).not.toHaveBeenCalled();
  });

  it("falls back to getItems().length for partial mocks lacking getItemCount", () => {
    const handle = {
      emit: vi.fn(),
      getItems: () => [{}, {}, {}],
      subscribeToItems: vi.fn(() => () => {})
    } as unknown as ResponseEmitterHandle;

    expect(getEmitterItemCount(handle)).toBe(3);
  });

  it("returns 0 for an undefined response", () => {
    expect(getEmitterItemCount(undefined)).toBe(0);
  });
});
