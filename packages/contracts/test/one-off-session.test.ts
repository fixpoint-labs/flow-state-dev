import { describe, expect, it } from "vitest";
import { isOneOffSessionId, oneOffSessionId } from "../src/helpers";

// The navigator folds one-off sessions by their prefix, and stored ids carry
// it, so the one helper that makes such an id must keep it — and must make a
// fresh id each call, since every one-off run lands in a session of its own.
describe("oneOffSessionId", () => {
  it("makes an id the one-off reader recognises", () => {
    expect(isOneOffSessionId(oneOffSessionId())).toBe(true);
  });

  it("makes a fresh id each call", () => {
    const ids = new Set(Array.from({ length: 50 }, () => oneOffSessionId()));
    expect(ids.size).toBe(50);
  });
});
