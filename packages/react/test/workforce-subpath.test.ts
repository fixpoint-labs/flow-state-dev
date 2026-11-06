/**
 * The workforce panels live on `@flow-state-dev/react/workforce`, not on the
 * root (FIX-2456 D3).
 *
 * The root is what a chat-app author autocompletes, and a chat app draws no
 * workforce records, so the panels went to a subpath named for who reads it.
 * These assertions hold that split from both sides: the subpath carries the
 * documented panel API and nothing more, the published manifest actually
 * serves it, and none of the 25 names 0.4.0 published on the root is there
 * any more (the epic's Q1 was answered "break": no deprecated aliases).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as workforce from "../src/workforce";
import * as root from "../src";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

const manifest = JSON.parse(readFileSync(here("../package.json"), "utf8")) as {
  exports: Record<string, { types: string; default: string }>;
  publishConfig: { exports: Record<string, { types: string; default: string }> };
};

/** The 25 names 0.4.0 published on the root from the panels module. */
const MOVED = [
  "Roster", "BoardColumns", "BoardList", "WorkerDetail", "groupIntoColumns", "BOARD_STATUS_COLUMNS",
  "rosterPropNames", "boardColumnsPropNames", "boardListPropNames",
  "BoardCard", "BoardCardRow", "BoardColumn", "BoardColumnsProps", "BoardColumnsSlots",
  "BoardListProps", "BoardListSlots", "BoardStatus", "PanelRowSource", "PanelItemSource",
  "PanelLiveSource", "RosterProps", "RosterWorker", "RosterWorkerRow", "RosterSlots", "WorkerDetailProps"
];

describe("@flow-state-dev/react/workforce", () => {
  it("carries exactly the panel components and their helpers", () => {
    // The *PropNames lists are deliberately absent: they have no consumer and
    // no README entry, so they leave public surface instead of moving (E6).
    expect(Object.keys(workforce).sort()).toEqual(
      ["BOARD_STATUS_COLUMNS", "BoardColumns", "BoardList", "Roster", "WorkerDetail", "groupIntoColumns"].sort()
    );
  });

  it("is served by the package in the workspace and once published", () => {
    // A subpath missing from either map works in this repo and fails for an
    // adopter (or the reverse), which no in-repo import would notice.
    expect(manifest.exports["./workforce"]).toEqual({
      types: "./dist/workforce/index.d.ts",
      default: "./src/workforce/index.ts"
    });
    expect(manifest.publishConfig.exports["./workforce"]).toEqual({
      types: "./dist/workforce/index.d.ts",
      default: "./dist/workforce/index.js"
    });
    expect(existsSync(here("../src/workforce/index.ts"))).toBe(true);
  });

  it("leaves none of the 25 old names on the root", () => {
    // A name left behind keeps the panels in every chat app's autocomplete.
    // Runtime names are checked on the module itself; type-only names leave
    // no runtime trace, so the root's source is read for every name too.
    expect(MOVED).toHaveLength(25);
    const runtime = Object.keys(root);
    expect(MOVED.filter((name) => runtime.includes(name))).toEqual([]);
    const source = readFileSync(here("../src/index.ts"), "utf8");
    expect(MOVED.filter((name) => new RegExp(`\\b${name}\\b`).test(source))).toEqual([]);
    expect(source).not.toMatch(/components\/panels|workforce/);
  });
});
