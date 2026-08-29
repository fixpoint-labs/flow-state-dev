import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { lastFocusPath, readLastFocus, writeLastFocus } from "../src/conductor/last-focus";

describe("lastFocusPath", () => {
  it("puts the sidecar next to the config's .fsdev store", () => {
    expect(lastFocusPath("/lab/fsdev.config.ts", "conductor-operator")).toBe(
      "/lab/.fsdev/tui-focus-conductor-operator",
    );
  });
});

describe("readLastFocus / writeLastFocus", () => {
  it("returns undefined when the sidecar is missing", () => {
    expect(readLastFocus(join(tmpdir(), "conductor-no-such-focus"))).toBeUndefined();
  });

  it("round-trips an issue id", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-focus-"));
    const path = join(dir, ".fsdev", "tui-focus-conductor-operator");
    writeLastFocus(path, "LIVE-2");
    expect(readLastFocus(path)).toBe("LIVE-2");
    expect(readFileSync(path, "utf8")).toBe("LIVE-2\n");
  });

  it("does not write an empty id", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-focus-"));
    const path = join(dir, "tui-focus");
    writeLastFocus(path, "");
    expect(readLastFocus(path)).toBeUndefined();
  });
});
