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
 * The controls plant into a copy of the lab's own folder and read the real
 * merge-base: each must fail, naming its file. The ones that need an
 * allowlist at the base read it at `HEAD`, whose list is the checked-in one.
 */
import { appendFileSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkInventory, copyOf, type AppInventory, type Key } from "../../test-support/inventory.mts";
import { teammates } from "./inventory-settings.ts";

const ALLOWLIST = "test/inventory-allowlist.json";
const copies: string[] = [];
afterEach(() => {
  for (const root of copies.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** A copy of the lab to plant into. */
function copy(): AppInventory {
  const app = copyOf(teammates);
  copies.push(app.root!);
  return app;
}
const at = (app: AppInventory, rel: string) => join(app.root!, rel);
const allowlistOf = (app: AppInventory): Key[] => JSON.parse(readFileSync(at(app, ALLOWLIST), "utf8"));
const writeAllowlist = (app: AppInventory, keys: Key[]) => writeFileSync(at(app, ALLOWLIST), JSON.stringify(keys));

/** An adapter like the ones the epic removes: a client import, a `.subscribe(` and a hand-written row type. */
const GLUE = 'import { createClient } from "@flow-state-dev/client";\nexport interface BoardRow { id: string; status: string }\nexport const watch = (c: any) => c.subscribe([], {});\n';

describe("the lab's inventory", () => {
  it("meets every rule but for its allowlist, which only shrinks, and its read model doesn't grow", () => {
    expect(checkInventory(teammates)).toEqual([]);
  });

  describe("fails, naming the file, on", () => {
    it("an adapter planted in src/app/: its client import, its .subscribe(, its row type, and a new read-model file", () => {
      const app = copy();
      writeFileSync(at(app, "src/app/glue.ts"), GLUE);
      const failures = checkInventory(app);
      expect(failures).toEqual([
        expect.stringMatching(/^src\/app\/glue\.ts: imports createClient from the client \(L3/),
        expect.stringMatching(/^src\/app\/glue\.ts:3: a \.subscribe\( call in watch \(L3/),
        expect.stringMatching(/^src\/app\/glue\.ts: BoardRow, a hand-written type .* \(L4/),
        expect.stringMatching(/^src\/app\/glue\.ts: a new file in the read model/),
      ]);
    });

    it("one more .flow( call in a function the allowlist already names: the list is a multiset", () => {
      const app = copy();
      const file = at(app, "src/app/conversations.ts");
      writeFileSync(file, readFileSync(file, "utf8").replace(/^(export function conversationCalls\b.*)$/m, '$1\n  void state.client.flow("planted");'));
      expect(checkInventory(app)).toEqual(
        expect.arrayContaining([expect.stringMatching(/^src\/app\/conversations\.ts:\d+: a \.flow\( call in conversationCalls \(L3: not on the allowlist\)$/)]),
      );
    });

    // A call keyed to the wrong holder can take the entry of one it replaced: each plant
    // drops the `.subscribe(` in `watch` and adds one after the file's last function, so the
    // counts still match. Each is keyed by its innermost holder, `(module)` outside them all.
    for (const [where, outside, holder] of [
      ["at module level, after the function", "void (globalThis as any).subscribe([], {});\n", "(module)"],
      ["in an abstract class's method", "export abstract class Planted {\n  go(c: any) {\n    return c.subscribe([], {});\n  }\n}\n", "go"],
      ["in a string-heavy class that a line scanner misreads", "export abstract class Quoted {\n  note = 'it\\'s {';\n  go(c: any) {\n    return c.subscribe([`}`], {});\n  }\n}\n", "go"],
    ] as const) {
      it(`a call moved out of an allowlisted function, ${where}: it is keyed by its own scope`, () => {
        const app = copy();
        const file = at(app, "src/lib/session-feed.ts");
        const text = readFileSync(file, "utf8");
        const dropped = text.replace(/^(\s*)(.*)\.subscribe\(/m, "$1$2.subscribeDropped(");
        expect(dropped).not.toBe(text);
        writeFileSync(file, `${dropped}\n${outside}`);
        expect(checkInventory(app)).toEqual([
          expect.stringMatching(new RegExp(`^src/lib/session-feed\\.ts:\\d+: a \\.subscribe\\( call in ${holder.replace(/[()]/g, "\\$&")} \\(L3: not on the allowlist\\)$`)),
          "src/lib/session-feed.ts · watch · subscribe call: on the allowlist, but the finding is gone: delete the entry",
        ]);
      });
    }

    it("an own-session helper planted in src/lib/", () => {
      // Built at run time: the vocabulary sweep and the closure's grep read this file too.
      const helper = ["openReader", "Session"].join("");
      const app = copy();
      writeFileSync(at(app, "src/lib/glue.ts"), `export const ${helper} = () => undefined;\n`);
      expect(checkInventory(app)).toEqual([`src/lib/glue.ts:1: ${helper}, an own-session helper (own sessions: not on the allowlist)`]);
    });

    it("an entry added to the allowlist, even with its finding: the merge-base's list doesn't have it", () => {
      const app = copy();
      writeFileSync(at(app, "src/lib/glue.ts"), 'import { topic } from "@flow-state-dev/client";\nexport const t = topic;\n');
      writeAllowlist(app, [...allowlistOf(app), { file: "src/lib/glue.ts", symbol: "topic", kind: "client import" }]);
      expect(checkInventory(app, { base: "HEAD" })).toEqual(["src/lib/glue.ts · topic · client import: not on the merge-base's allowlist, which may only shrink"]);
    });

    it("an entry whose finding is gone: the fake app deleted, its entry left", () => {
      const app = copy();
      rmSync(at(app, "test/fake-app.ts"));
      expect(checkInventory(app)).toEqual(["test/fake-app.ts · (file) · gone: on the allowlist, but the finding is gone: delete the entry"]);
    });

    it("a line appended to src/app/tasks.ts, past its merge-base length", () => {
      const app = copy();
      appendFileSync(at(app, "src/app/tasks.ts"), "// one more line\n");
      expect(checkInventory(app)).toEqual([expect.stringMatching(/^src\/app\/tasks\.ts: \d+ lines, past its merge-base length of \d+$/)]);
    });

    it("a line appended to the configuration while it is over its cap", () => {
      const app = copy();
      appendFileSync(at(app, "host.mts"), "// one more line\n");
      expect(checkInventory(app)).toEqual([expect.stringMatching(/^configuration: \d+ lines, past its merge-base total of \d+, while over its cap of 300$/)]);
    });

    it("a type moved from the allowlist to the screen-type list with no reason; with one, it passes", () => {
      const app = copy();
      writeAllowlist(app, allowlistOf(app).filter((k) => !(k.file === "src/app/tasks.ts" && k.symbol === "BoardTask")));
      const moved = (entry: AppInventory["screenTypes"][string][number]): AppInventory => ({ ...app, screenTypes: { ...app.screenTypes, "src/app/tasks.ts": [entry] } });
      expect(checkInventory(moved("BoardTask"), { base: "HEAD" })).toEqual(["src/app/tasks.ts: BoardTask moved from the merge-base's allowlist to the screen-type list with no reason"]);
      expect(checkInventory(moved({ name: "BoardTask", reason: "the screen joins the board's row with its own fields" }), { base: "HEAD" })).toEqual([]);
    });

    it("an emptied allowlist: L2, L3, L4 and the fake app each fail", () => {
      const app = copy();
      writeAllowlist(app, []);
      const failures = checkInventory(app).join("\n");
      for (const rule of ["L2", "L3", "L4"]) expect(failures).toMatch(new RegExp(`\\(${rule}: not on the allowlist\\)`));
      expect(failures).toMatch(/^test\/fake-app\.ts: still there \(gone: not on the allowlist\)$/m);
    });
  });

  describe("fails closed when no merge-base resolves", () => {
    it("on a base that names no commit", () => {
      expect(checkInventory(teammates, { base: "no-such-commit" })).toEqual(["labs/teammates: no merge-base: no-such-commit names no commit here"]);
    });

    it("in CI, with no base passed: it never guesses one", () => {
      const saved = { CI: process.env.CI, INVENTORY_BASE: process.env.INVENTORY_BASE };
      process.env.CI = "true";
      delete process.env.INVENTORY_BASE;
      try {
        expect(checkInventory(teammates)).toEqual(["labs/teammates: no merge-base: CI passes INVENTORY_BASE for its event, and none was passed"]);
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    });
  });
});
