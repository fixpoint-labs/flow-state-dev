/**
 * The lab's inventory: every rule (L1 to L4, H, own sessions), no adapter and
 * no fake app, graded by the shared module (`labs/test-support/inventory.mts`)
 * with the lab's settings (`inventory-settings.ts`). What the lab doesn't
 * meet yet is on `inventory-allowlist.json`, one entry per finding, keyed by
 * file, symbol and kind: each job of the epic deletes its own entries. The
 * test fails on a finding not on the list, an entry whose finding is gone,
 * an entry the merge-base's list doesn't have, a type moved to the
 * screen-type list with no reason, and a file in `src/app/` (or the
 * configuration, while over its cap) past its merge-base length.
 *
 * The rules' own controls run on a fixed fixture app
 * (`labs/claude-code-style/test/inventory-module.test.ts`). The ones here
 * check only the lab's settings, and plant only new files, so deleting the
 * lab's debt never means rewriting them.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkInventory, copyOf, type AppInventory } from "../../test-support/inventory.mts";
import { teammates } from "./inventory-settings.ts";

const copies: string[] = [];
afterEach(() => {
  for (const root of copies.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A copy of the lab with `files` planted in it. */
function planted(files: Record<string, string>): AppInventory {
  const app = copyOf(teammates);
  copies.push(app.root!);
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(app.root!, rel)), { recursive: true });
    writeFileSync(join(app.root!, rel), text);
  }
  return app;
}

describe("the lab's inventory", () => {
  it("meets every rule but for its allowlist, which only shrinks, and its read model doesn't grow", () => {
    expect(checkInventory(teammates)).toEqual([]);
  });

  describe("its settings", () => {
    it("hold it to own sessions", () => {
      // Built at run time: the vocabulary sweep and the closure's grep read this file too.
      const helper = ["openReader", "Session"].join("");
      expect(checkInventory(planted({ "src/lib/inventory-plant.ts": `export const ${helper} = () => undefined;\n` }))).toEqual([
        `src/lib/inventory-plant.ts:1: ${helper}, an own-session helper (own sessions: not on the allowlist)`,
      ]);
    });

    it("count every file in src/app/ as the read model: a new one fails", () => {
      expect(checkInventory(planted({ "src/app/inventory-plant.ts": "export const plant = 1;\n" }))).toEqual([expect.stringMatching(/^src\/app\/inventory-plant\.ts: a new file in the read model \(src\/app\/\)/)]);
    });

    it("name the adapter as a file that must go", () => {
      expect(checkInventory(planted({ "src/adapter.ts": "export const adapter = 1;\n" }))).toEqual(["src/adapter.ts: still there (gone: not on the allowlist)"]);
    });
  });
});
