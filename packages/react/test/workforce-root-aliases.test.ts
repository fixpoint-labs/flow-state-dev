/**
 * The deprecated root aliases for the moved workforce panels (FIX-2456, under
 * the epic's Q1 alias option).
 *
 * 0.4.0 shipped these 25 names on the root, so an adopter can import them
 * today. While Q1's alias answer stands, each stays on the root as the same
 * value, struck through in the editor with a pointer to its new home, until
 * the minor that removes every alias. Removing them is this file, the alias
 * module and its one export line in `src/index.ts`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as root from "../src";
import * as workforce from "../src/workforce";
import { rosterPropNames } from "../src/components/panels/Roster";
import { boardColumnsPropNames } from "../src/components/panels/BoardColumns";
import { boardListPropNames } from "../src/components/panels/BoardList";

const aliasSource = readFileSync(
  fileURLToPath(new URL("../src/workforce-root-aliases.ts", import.meta.url)),
  "utf8"
);

/** The 25 names 0.4.0 published on the root from the panels module. */
const MOVED = [
  "Roster", "BoardColumns", "BoardList", "WorkerDetail", "groupIntoColumns", "BOARD_STATUS_COLUMNS",
  "rosterPropNames", "boardColumnsPropNames", "boardListPropNames",
  "BoardCard", "BoardCardRow", "BoardColumn", "BoardColumnsProps", "BoardColumnsSlots",
  "BoardListProps", "BoardListSlots", "BoardStatus", "PanelRowSource", "PanelItemSource",
  "PanelLiveSource", "RosterProps", "RosterWorker", "RosterWorkerRow", "RosterSlots", "WorkerDetailProps"
];
const PROP_NAME_LISTS = ["rosterPropNames", "boardColumnsPropNames", "boardListPropNames"];

describe("deprecated root aliases for the workforce panels", () => {
  it("keep every moved runtime name working as the same value", () => {
    // Same identity, not a wrapper: a host mixing old and new imports must
    // get one component, or React would remount it across the two.
    const r = root as Record<string, unknown>;
    const w = workforce as Record<string, unknown>;
    for (const name of Object.keys(workforce)) expect(r[name], name).toBe(w[name]);
    expect(r.rosterPropNames).toBe(rosterPropNames);
    expect(r.boardColumnsPropNames).toBe(boardColumnsPropNames);
    expect(r.boardListPropNames).toBe(boardListPropNames);
  });

  it("declare all 25 names, and each one says where to go instead", () => {
    // Every export in the module, paired with the doc comment right above it.
    const exports = [...aliasSource.matchAll(/\/\*\*((?:(?!\*\/)[^])*)\*\/\s*export\s+(?:const|type)\s+(\w+)/g)].map(
      ([, doc, name]) => ({ name, doc })
    );
    expect(exports.map((e) => e.name).sort()).toEqual([...MOVED].sort());
    // No export without a doc comment slipped past the pairing above.
    expect((aliasSource.match(/^export\s/gm) ?? []).length).toBe(MOVED.length);
    for (const { name, doc } of exports) {
      expect(doc, name).toMatch(/@deprecated/);
      if (PROP_NAME_LISTS.includes(name)) expect(doc, name).toMatch(/no replacement/i);
      else expect(doc, name).toContain("@flow-state-dev/react/workforce");
    }
  });
});
