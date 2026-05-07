/**
 * Tests for the internal dev-warn helper.
 *
 * Internal-only — deep-imported from `../../src/models/dev-warn.js` since the
 * helper is intentionally not exposed via the package barrel.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  _resetDevWarnsForTesting,
  devWarnOnce,
} from "../../src/models/dev-warn.js";

describe("devWarnOnce", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;
  const origNodeEnv = process.env.NODE_ENV;
  const origQuiet = process.env.FSD_QUIET_WARNINGS;

  beforeEach(() => {
    _resetDevWarnsForTesting();
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    delete process.env.FSD_QUIET_WARNINGS;
    process.env.NODE_ENV = "development";
  });

  afterEach(() => {
    warnSpy.mockRestore();
    process.env.NODE_ENV = origNodeEnv;
    if (origQuiet === undefined) {
      delete process.env.FSD_QUIET_WARNINGS;
    } else {
      process.env.FSD_QUIET_WARNINGS = origQuiet;
    }
  });

  it("warns once per key", () => {
    devWarnOnce("k1", "first");
    devWarnOnce("k1", "first");
    devWarnOnce("k1", "first");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("first");
  });

  it("warns separately for different keys", () => {
    devWarnOnce("k1", "first");
    devWarnOnce("k2", "second");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("respects FSD_QUIET_WARNINGS=1", () => {
    process.env.FSD_QUIET_WARNINGS = "1";
    devWarnOnce("k1", "msg");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("respects NODE_ENV=production", () => {
    process.env.NODE_ENV = "production";
    devWarnOnce("k1", "msg");
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("_resetDevWarnsForTesting clears state", () => {
    devWarnOnce("k1", "msg");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    devWarnOnce("k1", "msg");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    _resetDevWarnsForTesting();
    devWarnOnce("k1", "msg");
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });
});
