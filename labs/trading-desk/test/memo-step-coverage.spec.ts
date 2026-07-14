/**
 * Coverage guard for the `defineMemoStep` convention. Importing the stages
 * module for its side effect builds every participant step, and each
 * `defineMemoStep(...)` call records its key in `placedMemoKeys()`. This test
 * asserts that the set of placed keys is exactly the set of registered memo
 * keys in `ALL_MEMO_KEYS` — so a participant that was registered but never
 * placed (or placed under a stale key) fails loudly here. This is the
 * non-brittleness backstop from the design (§3): a typed key + typed registry
 * catch typos at compile time; this guard catches a forgotten placement.
 */
import { describe, it, expect } from "vitest";
import "../flows/analysis/orchestration/stages"; // import for side effect: builds every step → records placements
import { placedMemoKeys } from "../flows/analysis/agents/_recipe/memo-writer";
import { ALL_MEMO_KEYS } from "../flows/analysis/registry";

describe("defineMemoStep coverage", () => {
  it("places exactly the registry's memo keys — no orphan registered, none placed under a stale key", () => {
    const placed = [...placedMemoKeys()].sort();
    const registered = Object.keys(ALL_MEMO_KEYS).sort();
    expect(placed).toEqual(registered);
  });
});
