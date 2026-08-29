import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  lastFocusPath,
  legacyLastFocusPath,
  readLastFocus,
  safeEpic,
  writeLastFocus,
} from "../src/conductor/last-focus";

describe("lastFocusPath", () => {
  it("puts the sidecar next to the config's .fsdev store", () => {
    expect(lastFocusPath("/lab/fsdev.config.ts", "conductor-operator")).toBe(
      "/lab/.fsdev/tui-focus-conductor-operator",
    );
  });

  it("scopes the sidecar to the epic so two boards do not share a row", () => {
    expect(lastFocusPath("/lab/fsdev.config.ts", "conductor-operator", "harness-manager")).toBe(
      "/lab/.fsdev/tui-focus-conductor-operator__harness-manager",
    );
    expect(safeEpic("atlas/leave prove")).toBe("atlas-leave-prove");
    expect(
      legacyLastFocusPath("/lab/.fsdev/tui-focus-conductor-operator__harness-manager"),
    ).toBe("/lab/.fsdev/tui-focus-conductor-operator");
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

  it("reads the session-only sidecar when the epic file is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-focus-"));
    const legacy = join(dir, ".fsdev", "tui-focus-conductor-operator");
    const epic = `${legacy}__harness-manager`;
    writeLastFocus(legacy, "LIVE-2");
    expect(readLastFocus(epic)).toBe("LIVE-2");
  });

  it("does not write an empty id", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-focus-"));
    const path = join(dir, "tui-focus");
    writeLastFocus(path, "");
    expect(readLastFocus(path)).toBeUndefined();
  });
});
