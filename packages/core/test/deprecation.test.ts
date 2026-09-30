/**
 * Tests for the deprecation/dev warning helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDeprecationWarningsForTests,
  firstInProcess,
  warnOnceDev,
} from "../src/helpers/deprecation";

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

  it("stays once per process when the module is evaluated again", async () => {
    // `next dev` re-evaluates every transpiled workspace package on a hot
    // reload. A key claimed by the previous generation of this module must stay
    // claimed, or "once per process" quietly becomes "once per edit".
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnOnceDev("dk", "first");

    vi.resetModules();
    const reloaded = await import("../src/helpers/deprecation");
    expect(reloaded.warnOnceDev).not.toBe(warnOnceDev);
    reloaded.warnOnceDev("dk", "first");

    expect(spy).toHaveBeenCalledTimes(1);
    expect(reloaded.firstInProcess("reloaded/key")).toBe(true);
    expect(firstInProcess("reloaded/key")).toBe(false);
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
