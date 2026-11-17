/**
 * Shift Manager's inventory: the content rules (L3, L4 over all of `src/`,
 * own sessions), no `reads.ts` and no snapshot type, graded by the shared
 * module (`labs/test-support/inventory.mts`) with Shift Manager's settings
 * (`inventory-settings.ts`). What it doesn't meet yet is on
 * `inventory-allowlist.json`, one entry per finding, keyed by file, symbol
 * and kind: each job of the epic deletes its own entries. The test fails on
 * a finding not on the list, an entry whose finding is gone, an entry the
 * merge-base's list doesn't have, a type moved to the screen-type list with
 * no reason, and `src/lib/reads.ts` past its merge-base length.
 *
 * The controls plant into a copy of Shift Manager's own folder and read the
 * real merge-base: each must fail, naming its file. The ones that need an
 * allowlist at the base read it at `HEAD`, whose list is the checked-in one.
 */
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkInventory, copyOf, type AppInventory, type Key } from "../../../labs/test-support/inventory.mts";
import { shiftManager } from "./inventory-settings.ts";

const ALLOWLIST = "test/inventory-allowlist.json";
const copies: string[] = [];
afterEach(() => {
  for (const root of copies.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A copy of Shift Manager to plant into. */
function copy(): AppInventory {
  const app = copyOf(shiftManager);
  copies.push(app.root!);
  return app;
}
const at = (app: AppInventory, rel: string) => join(app.root!, rel);
const allowlistOf = (app: AppInventory): Key[] => JSON.parse(readFileSync(at(app, ALLOWLIST), "utf8"));
const writeAllowlist = (app: AppInventory, keys: Key[]) => writeFileSync(at(app, ALLOWLIST), JSON.stringify(keys));

/** An adapter of the kind the epic removes: a client import, a `.subscribe(` and a hand-written row type. */
const GLUE = 'import { createClient } from "@flow-state-dev/client";\nexport interface BoardRow { id: string; status: string }\nexport const watch = (c: any) => c.subscribe([], {});\n';

describe("Shift Manager's inventory", () => {
  it("meets the content rules but for its allowlist, which only shrinks, and reads.ts doesn't grow", () => {
    expect(checkInventory(shiftManager)).toEqual([]);
  });

  describe("fails, naming the file, on", () => {
    it("an adapter planted in src/lib/: its client import, its .subscribe( and its row type", () => {
      const app = copy();
      writeFileSync(at(app, "src/lib/glue.ts"), GLUE);
      expect(checkInventory(app)).toEqual([
        expect.stringMatching(/^src\/lib\/glue\.ts: imports createClient from the client \(L3/),
        expect.stringMatching(/^src\/lib\/glue\.ts:3: a \.subscribe\( call in watch \(L3/),
        expect.stringMatching(/^src\/lib\/glue\.ts: BoardRow, a hand-written type .* \(L4/),
      ]);
    });

    it("a row type in a component: L4 reads src/components/ too", () => {
      const app = copy();
      writeFileSync(at(app, "src/components/Glue.tsx"), "export interface BoardRow { id: string }\n");
      expect(checkInventory(app)).toEqual([expect.stringMatching(/^src\/components\/Glue\.tsx: BoardRow, a hand-written type .* \(L4/)]);
    });

    it("an entry added to the allowlist, even with its finding: the merge-base's list doesn't have it", () => {
      const app = copy();
      writeFileSync(at(app, "src/lib/glue.ts"), 'import { topic } from "@flow-state-dev/client";\nexport const t = topic;\n');
      writeAllowlist(app, [...allowlistOf(app), { file: "src/lib/glue.ts", symbol: "topic", kind: "client import" }]);
      expect(checkInventory(app, { base: "HEAD" })).toEqual(["src/lib/glue.ts · topic · client import: not on the merge-base's allowlist, which may only shrink"]);
    });

    it("an entry whose finding is gone: a type renamed, its entry left", () => {
      const app = copy();
      const file = at(app, "src/lib/usage.ts");
      writeFileSync(file, readFileSync(file, "utf8").replace("export type UsageWindow =", "type UsageWindow ="));
      expect(checkInventory(app)).toEqual(["src/lib/usage.ts · UsageWindow · type: on the allowlist, but the finding is gone: delete the entry"]);
    });

    it("a line appended to src/lib/reads.ts, past its merge-base length", () => {
      const app = copy();
      appendFileSync(at(app, "src/lib/reads.ts"), "// one more line\n");
      expect(checkInventory(app)).toEqual([expect.stringMatching(/^src\/lib\/reads\.ts: \d+ lines, past its merge-base length of \d+$/)]);
    });

    it("a type moved from the allowlist to the screen-type list with no reason; with one, it passes", () => {
      const app = copy();
      writeAllowlist(app, allowlistOf(app).filter((k) => !(k.file === "src/lib/usage.ts" && k.symbol === "UsageWindow")));
      const moved = (entry: AppInventory["screenTypes"][string][number]): AppInventory => ({ ...app, screenTypes: { ...app.screenTypes, "src/lib/usage.ts": [entry] } });
      expect(checkInventory(moved("UsageWindow"), { base: "HEAD" })).toEqual(["src/lib/usage.ts: UsageWindow moved from the merge-base's allowlist to the screen-type list with no reason"]);
      expect(checkInventory(moved({ name: "UsageWindow", reason: "the screen draws the view's window with its own label" }), { base: "HEAD" })).toEqual([]);
    });

    it("a snapshot type on the screen-type list, reason or not: it stays a finding", () => {
      const app = copy();
      writeAllowlist(app, allowlistOf(app).filter((k) => k.symbol !== "LoadedSnapshot"));
      const listed: AppInventory = { ...app, screenTypes: { ...app.screenTypes, "src/lib/derive.ts": [...app.screenTypes["src/lib/derive.ts"]!, { name: "LoadedSnapshot", reason: "it is loaded" }] } };
      expect(checkInventory(listed, { base: "HEAD" })).toEqual([
        expect.stringMatching(/^src\/lib\/derive\.ts: LoadedSnapshot, a hand-written type .* \(L4: not on the allowlist\)$/),
        "src/lib/derive.ts: LoadedSnapshot can never be a screen type",
      ]);
    });

    it("an emptied allowlist: L3, L4 and reads.ts each fail", () => {
      const app = copy();
      writeAllowlist(app, []);
      const failures = checkInventory(app).join("\n");
      for (const rule of ["L3", "L4"]) expect(failures).toMatch(new RegExp(`\\(${rule}: not on the allowlist\\)`));
      expect(failures).toMatch(/^src\/lib\/reads\.ts: still there \(gone: not on the allowlist\)$/m);
    });
  });

  it("fails closed on a base that names no commit", () => {
    expect(checkInventory(shiftManager, { base: "no-such-commit" })).toEqual(["packages/shift-manager: no merge-base: no-such-commit names no commit here"]);
  });
});
