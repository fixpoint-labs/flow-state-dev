/**
 * Tests for the deprecation/dev warning helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDeprecationWarningsForTests,
  warnDeprecated,
  warnOnceDev,
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

describe("warnOnceDev", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalQuiet = process.env.FSD_QUIET_WARNINGS;

  beforeEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.FSD_QUIET_WARNINGS;
    __resetDeprecationWarningsForTests();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    process.env.FSD_QUIET_WARNINGS = originalQuiet;
    vi.restoreAllMocks();
  });

  it("warns once per key", () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnOnceDev("dk", "first");
    warnOnceDev("dk", "first");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toContain("first");
  });

  it("respects FSD_QUIET_WARNINGS=1", () => {
    process.env.FSD_QUIET_WARNINGS = "1";
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnOnceDev("dk", "msg");
    expect(spy).not.toHaveBeenCalled();
  });

  it("skips when NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnOnceDev("dk", "msg");
    expect(spy).not.toHaveBeenCalled();
  });
});
