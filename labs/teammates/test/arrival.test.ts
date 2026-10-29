/**
 * Pieces of new content settling in place (FIX-2338): an entry that didn't
 * change keeps its object, so a memoized row skips its render, and the
 * "answering" line follows the conversation's items rather than a list read
 * on a timer.
 */
import { describe, expect, it } from "vitest";
import { answeringOf } from "../src/adapter";
import { reuseById } from "../src/lib/stable";

const message = (requestId: string, status: string) => ({ id: `m-${requestId}`, type: "message", role: "assistant", status, requestId });

describe("reusing unchanged entries", () => {
  it("hands back the old object for an entry that is equal, and the new one for an entry that changed", () => {
    const a = { id: "a", text: "hello" };
    const b = { id: "b", text: "wor" };
    const next = reuseById([a, b], [{ id: "a", text: "hello" }, { id: "b", text: "world" }, { id: "c", text: "!" }]);
    expect(next[0]).toBe(a);
    expect(next[1]).not.toBe(b);
    expect(next[1]).toEqual({ id: "b", text: "world" });
    expect(next).toHaveLength(3);
  });
});

describe("whether the worker is answering", () => {
  it("is answering while the newest request is still being written, before the timed list says so", () => {
    expect(answeringOf([message("r1", "in_progress")], [])).toBe(true);
  });

  it("is done the moment the items show the answer finished, though the timed list still names the request", () => {
    expect(answeringOf([message("r1", "completed")], ["r1"])).toBe(false);
  });

  it("is answering for a request the list names that has no finished answer yet", () => {
    expect(answeringOf([message("r1", "completed")], ["r2"])).toBe(true);
  });

  it("ignores an old item a crashed turn left half-written", () => {
    expect(answeringOf([message("r1", "in_progress"), message("r2", "completed")], [])).toBe(false);
  });
});
