/**
 * Tests for the deprecation/dev warning helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetDeprecationWarningsForTests,
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
