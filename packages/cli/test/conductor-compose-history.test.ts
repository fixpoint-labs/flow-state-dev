import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPOSE_HISTORY_CAP,
  lastDraftsPath,
  readDrafts,
  writeDrafts,
} from "../src/conductor/compose-history";

describe("lastDraftsPath", () => {
  it("puts the sidecar next to the config's .fsdev store", () => {
    expect(lastDraftsPath("/lab/fsdev.config.ts", "conductor-operator")).toBe(
      "/lab/.fsdev/tui-drafts-conductor-operator",
    );
  });

  it("scopes the sidecar to the epic so two boards do not share a history", () => {
    expect(lastDraftsPath("/lab/fsdev.config.ts", "conductor-operator", "harness-manager")).toBe(
      "/lab/.fsdev/tui-drafts-conductor-operator__harness-manager",
    );
  });
});

describe("readDrafts / writeDrafts", () => {
  it("returns empty when the sidecar is missing", () => {
    expect(readDrafts(join(tmpdir(), "conductor-no-such-drafts"))).toEqual([]);
  });

  it("round-trips submitted lines", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-drafts-"));
    const path = join(dir, ".fsdev", "tui-drafts-conductor-operator");
    writeDrafts(path, ["seed LAB-1", "please retry the failed rows"]);
    expect(readDrafts(path)).toEqual(["seed LAB-1", "please retry the failed rows"]);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual([
      "seed LAB-1",
      "please retry the failed rows",
    ]);
  });

  it("does not write an empty history", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-drafts-"));
    const path = join(dir, "tui-drafts");
    writeDrafts(path, []);
    expect(readDrafts(path)).toEqual([]);
  });

  it("treats invalid JSON as empty", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-drafts-"));
    const path = join(dir, "tui-drafts");
    writeFileSync(path, "not-json\n");
    expect(readDrafts(path)).toEqual([]);
  });

  it("keeps only the newest cap on read and write", () => {
    const dir = mkdtempSync(join(tmpdir(), "conductor-drafts-"));
    const path = join(dir, "tui-drafts");
    const extra = Array.from({ length: COMPOSE_HISTORY_CAP + 2 }, (_, i) => `line-${i}`);
    writeDrafts(path, extra);
    const kept = readDrafts(path);
    expect(kept).toHaveLength(COMPOSE_HISTORY_CAP);
    expect(kept[0]).toBe("line-2");
    expect(kept.at(-1)).toBe(`line-${COMPOSE_HISTORY_CAP + 1}`);
  });
});
