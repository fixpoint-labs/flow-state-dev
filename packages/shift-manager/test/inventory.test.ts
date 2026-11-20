/**
 * Shift Manager's inventory: the content rules (L3, L4 over all of `src/`,
 * own sessions), none of the snapshot's modules and no snapshot type, graded
 * by the shared module (`labs/test-support/inventory.mts`) with Shift
 * Manager's settings (`inventory-settings.ts`). Its allowlist
 * (`inventory-allowlist.json`, one entry per finding, keyed by file, symbol
 * and the finding's type) is empty. The test fails on a finding not on the list, an entry
 * whose finding is gone, an entry the merge-base's list doesn't have, and a
 * type moved to the screen-type list with no reason.
 *
 * The rules' own controls run on a fixed fixture app
 * (`labs/claude-code-style/test/inventory-module.test.ts`). The ones here
 * check only Shift Manager's settings, and plant only new files, so deleting
 * its debt never means rewriting them.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkInventory, copyOf, type AppInventory } from "../../../labs/test-support/inventory.mts";
import { shiftManager } from "./inventory-settings.ts";

const copies: string[] = [];
afterEach(() => {
  for (const root of copies.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A copy of Shift Manager with `files` planted in it. */
function planted(files: Record<string, string>): AppInventory {
  const app = copyOf(shiftManager);
  copies.push(app.root!);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(app.root!, rel)), { recursive: true });
    writeFileSync(join(app.root!, rel), text);
  }
  return app;
}

describe("Shift Manager's inventory", () => {
  it("meets the content rules, with nothing on its allowlist", () => {
    expect(checkInventory(shiftManager)).toEqual([]);
  });

  describe("its settings", () => {
    it("read row types in src/components/ too", () => {
      expect(checkInventory(planted({ "src/components/InventoryPlant.tsx": "export interface PlantRow {\n  id: string;\n}\n" }))).toEqual([
        expect.stringMatching(/^src\/components\/InventoryPlant\.tsx: PlantRow, a hand-written type .* \(L4/),
      ]);
    });

    it("never take a snapshot type as a screen type, reason or not", () => {
      const app = planted({ "src/lib/inventory-plant.ts": "export interface PlantSnapshot {\n  rows: string[];\n}\n" });
      const listed: AppInventory = { ...app, screenTypes: { ...app.screenTypes, "src/lib/inventory-plant.ts": [{ name: "PlantSnapshot", reason: "it is loaded" }] } };
      expect(checkInventory(listed)).toEqual([
        expect.stringMatching(/^src\/lib\/inventory-plant\.ts: PlantSnapshot, a hand-written type .* \(L4: not on the allowlist\)$/),
        "src/lib/inventory-plant.ts: PlantSnapshot can never be a screen type",
      ]);
    });

    it("don't hold it to the path classes: a file no class names passes", () => {
      expect(checkInventory(planted({ "inventory-plant.txt": "not configuration, UI or a flow\n" }))).toEqual([]);
    });
  });
});
