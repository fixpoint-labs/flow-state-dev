/**
 * Tests for the warnDeprecated runtime helper.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetDeprecationWarningsForTests,
  warnDeprecated
} from "../src/utils/deprecation";

describe("warnDeprecated", () => {
  afterEach(() => {
    __resetDeprecationWarningsForTests();
    vi.restoreAllMocks();
  });

  it("warns once per key per process", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnDeprecated("k1", "msg one");
    warnDeprecated("k1", "msg one");
    warnDeprecated("k1", "msg one");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain("DEPRECATED: msg one");
  });

  it("treats distinct keys independently", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnDeprecated("k1", "msg one");
    warnDeprecated("k2", "msg two");
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("collapses warnings across multiple call sites with the same key", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    function siteA() { warnDeprecated("shared", "shared msg"); }
    function siteB() { warnDeprecated("shared", "shared msg"); }
    siteA();
    siteB();
    siteA();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
