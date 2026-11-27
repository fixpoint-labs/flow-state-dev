/**
 * The shared inventory module's controls (`labs/test-support/inventory.mts`),
 * on its fixed fixture app (`labs/test-support/fixtures/app/`), not on any
 * real app: the epic's children delete the real apps' debt, and that must
 * never mean rewriting these. Each control plants into a copy of the fixture
 * and must fail, naming its file.
 *
 * The ratchet reads the base at `HEAD`, where the fixture and its allowlist
 * are checked in: a real git read, against the fixture as committed. Each app's
 * own test holds the real tree to the ratchet against the real merge-base.
 */
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { atBase, checkInventory, copyOf, type AppInventory, type Key } from "../../test-support/inventory.mts";

const fixture: AppInventory = {
  path: "labs/test-support/fixtures/app",
  entry: "src/main.tsx",
  rules: ["L1", "L2", "L3", "L4", "H", "own sessions"],
  gone: ["test/fake.ts"],
  typesSkip: ["src/components/"],
  neverScreen: /Snapshot$/,
  readModel: ["src/app/"],
  screenTypes: { "src/lib/look.ts": ["Look"] },
};
const AT_HEAD = { base: "HEAD" };
const ALLOWLIST = "test/inventory-allowlist.json";

const copies: string[] = [];
afterEach(() => {
  for (const root of copies.splice(0)) rmSync(root, { recursive: true, force: true });
});
function copy(): AppInventory {
  const app = copyOf(fixture);
  copies.push(app.root!);
  return app;
}
const at = (app: AppInventory, rel: string) => join(app.root!, rel);
function plant(app: AppInventory, rel: string, text: string): void {
  mkdirSync(dirname(at(app, rel)), { recursive: true });
  writeFileSync(at(app, rel), text);
}
const allowlistOf = (app: AppInventory): Key[] => JSON.parse(readFileSync(at(app, ALLOWLIST), "utf8"));
const writeAllowlist = (app: AppInventory, keys: Key[]) => writeFileSync(at(app, ALLOWLIST), JSON.stringify(keys));

/** An adapter like the ones the epic removes: a client import, a `.subscribe(` and a hand-written row type. */
const GLUE = 'import { createClient } from "@flow-state-dev/client";\nexport interface GlueRow { id: string }\nexport const glue = (c: any) => c.subscribe([], {});\n';

describe("the inventory module, on its fixture app", () => {
  it("passes the fixture as committed: every finding on its allowlist", () => {
    expect(checkInventory(fixture, AT_HEAD)).toEqual([]);
  });

  describe("fails, naming the file, on", () => {
    it("an adapter planted in the read model: its client import, its .subscribe(, its row type, and a new read-model file", () => {
      const app = copy();
      plant(app, "src/app/glue.ts", GLUE);
      expect(checkInventory(app, AT_HEAD)).toEqual([
        expect.stringMatching(/^src\/app\/glue\.ts: imports createClient from the client \(L3/),
        expect.stringMatching(/^src\/app\/glue\.ts:3: a \.subscribe\( call in glue \(L3/),
        expect.stringMatching(/^src\/app\/glue\.ts: GlueRow, a hand-written type .* \(L4/),
        expect.stringMatching(/^src\/app\/glue\.ts: a new file in the read model/),
      ]);
    });

    it("one more .flow( call in a function the allowlist already names: the list is a multiset", () => {
      const app = copy();
      const file = at(app, "src/app/reads.ts");
      writeFileSync(file, readFileSync(file, "utf8").replace('client.flow("b")', 'client.flow("b"), client.flow("c")'));
      expect(checkInventory(app, AT_HEAD)).toEqual([expect.stringMatching(/^src\/app\/reads\.ts:\d+: a \.flow\( call in load \(L3: not on the allowlist\)$/)]);
    });

    // A call keyed to the wrong holder can take the entry of one it replaced: each plant drops
    // the `.subscribe(` in `watch` and adds one after the file's last function, so the counts
    // still match. Each is keyed by its innermost holder, `(module)` outside them all. The
    // read model is planted into, so it also grows past its base.
    for (const [where, outside, holder] of [
      ["at module level, after the function", "void (globalThis as any).subscribe([], {});\n", "(module)"],
      ["in an abstract class's method", "export abstract class Planted {\n  go(c: any) {\n    return c.subscribe([], {});\n  }\n}\n", "go"],
      ["in a string-heavy class that a line scanner misreads", "export abstract class Quoted {\n  note = 'it\\'s {';\n  go(c: any) {\n    return c.subscribe([`}`], {});\n  }\n}\n", "go"],
    ] as const) {
      it(`a call moved out of an allowlisted function, ${where}: it is keyed by its own scope`, () => {
        const app = copy();
        const file = at(app, "src/app/reads.ts");
        writeFileSync(file, `${readFileSync(file, "utf8").replace("client.subscribe(", "client.subscribeDropped(")}\n${outside}`);
        expect(checkInventory(app, AT_HEAD)).toEqual([
          expect.stringMatching(new RegExp(`^src/app/reads\\.ts:\\d+: a \\.subscribe\\( call in ${holder.replace(/[()]/g, "\\$&")} \\(L3: not on the allowlist\\)$`)),
          "src/app/reads.ts · watch · subscribe call: on the allowlist, but the finding is gone: delete the entry",
          expect.stringMatching(/^src\/app\/reads\.ts: \d+ lines, past its merge-base length/),
        ]);
      });
    }

    it("an own-session helper", () => {
      // Built at run time: the vocabulary sweep and the closure's grep read this file too.
      const helper = ["openReader", "Session"].join("");
      const app = copy();
      plant(app, "src/lib/glue.ts", `export const ${helper} = () => undefined;\n`);
      expect(checkInventory(app, AT_HEAD)).toEqual([`src/lib/glue.ts:1: ${helper}, an own-session helper (own sessions: not on the allowlist)`]);
    });

    it("an entry added to the allowlist, even with its finding: the base's list doesn't have it", () => {
      const app = copy();
      plant(app, "src/lib/glue.ts", 'import { topic } from "@flow-state-dev/client";\nexport const t = topic;\n');
      writeAllowlist(app, [...allowlistOf(app), { file: "src/lib/glue.ts", symbol: "topic", kind: "client import" }]);
      expect(checkInventory(app, AT_HEAD)).toEqual(["src/lib/glue.ts · topic · client import: not on the merge-base's allowlist, which may only shrink"]);
    });

    it("an entry whose finding is gone: the file that must go deleted, its entry left", () => {
      const app = copy();
      rmSync(at(app, "test/fake.ts"));
      expect(checkInventory(app, AT_HEAD)).toEqual(["test/fake.ts · (file) · gone: on the allowlist, but the finding is gone: delete the entry"]);
    });

    it("a line appended to a read-model file, past its base length", () => {
      const app = copy();
      appendFileSync(at(app, "src/app/reads.ts"), "// one more line\n");
      expect(checkInventory(app, AT_HEAD)).toEqual([expect.stringMatching(/^src\/app\/reads\.ts: \d+ lines, past its merge-base length of \d+$/)]);
    });

    it("the configuration grown past its base total while over its cap", () => {
      const app = copy();
      appendFileSync(at(app, "host.mts"), "// configuration\n".repeat(400));
      expect(checkInventory(app, AT_HEAD)).toEqual([
        expect.stringMatching(/^configuration \d+ lines, cap 310 .* \(L2: not on the allowlist\)$/),
        expect.stringMatching(/^configuration: \d+ lines, past its merge-base total of \d+, while over its cap of 310$/),
      ]);
    });

    it("a type moved from the allowlist to the screen-type list with no reason, an empty one, or a blank one; with one, it passes", () => {
      const app = copy();
      writeAllowlist(app, allowlistOf(app).filter((k) => k.symbol !== "BoardTask"));
      const moved = (entry: AppInventory["screenTypes"][string][number]): AppInventory => ({ ...app, screenTypes: { ...app.screenTypes, "src/app/reads.ts": [entry] } });
      for (const entry of ["BoardTask", { name: "BoardTask", reason: "" }, { name: "BoardTask", reason: "   " }]) {
        expect(checkInventory(moved(entry), AT_HEAD)).toEqual(["src/app/reads.ts: BoardTask moved from the merge-base's allowlist to the screen-type list with no reason"]);
      }
      expect(checkInventory(moved({ name: "BoardTask", reason: "the screen adds its own fields to the view's row" }), AT_HEAD)).toEqual([]);
    });

    it("a type moved with its file to another folder, then to the screen-type list with no reason; with one, it passes", () => {
      // The base's entry is keyed by the old file, so a check on the new file alone misses it.
      const app = copy();
      const reads = at(app, "src/app/reads.ts");
      const declaration = "/** A row typed by hand. */\nexport interface BoardTask {\n  id: string;\n}\n";
      writeFileSync(reads, readFileSync(reads, "utf8").replace(declaration, ""));
      plant(app, "src/lib/board.ts", declaration);
      writeAllowlist(app, allowlistOf(app).filter((k) => k.symbol !== "BoardTask"));
      const moved = (entry: AppInventory["screenTypes"][string][number]): AppInventory => ({ ...app, screenTypes: { ...app.screenTypes, "src/lib/board.ts": [entry] } });
      expect(checkInventory(moved("BoardTask"), AT_HEAD)).toEqual(["src/lib/board.ts: BoardTask moved from the merge-base's allowlist to the screen-type list with no reason"]);
      expect(checkInventory(moved({ name: "BoardTask", reason: "the screen adds its own fields to the view's row" }), AT_HEAD)).toEqual([]);
    });

    it("but not on a screen type the base already had, when an allowlisted type of the same name goes", () => {
      // `src/lib/look.ts`'s `Look` was a screen type at the base: deleting the read model's `Look` moves nothing to it.
      const app = copy();
      const reads = at(app, "src/app/reads.ts");
      writeFileSync(reads, readFileSync(reads, "utf8").replace(/\n\/\*\* A row typed by hand, named like[^]*?\n}\n/, "\n"));
      writeAllowlist(app, allowlistOf(app).filter((k) => !(k.file === "src/app/reads.ts" && k.symbol === "Look")));
      expect(checkInventory(app, AT_HEAD)).toEqual([]);
    });

    it("a snapshot type on the screen-type list, reason or not: it stays a finding", () => {
      const app = copy();
      plant(app, "src/lib/state.ts", "export interface FixtureSnapshot {\n  rows: string[];\n}\n");
      const listed: AppInventory = { ...app, screenTypes: { ...app.screenTypes, "src/lib/state.ts": [{ name: "FixtureSnapshot", reason: "it is loaded" }] } };
      expect(checkInventory(listed, AT_HEAD)).toEqual([
        expect.stringMatching(/^src\/lib\/state\.ts: FixtureSnapshot, a hand-written type .* \(L4: not on the allowlist\)$/),
        "src/lib/state.ts: FixtureSnapshot can never be a screen type",
      ]);
    });

    it("an emptied allowlist: L3, L4 and the file that must go each fail", () => {
      const app = copy();
      writeAllowlist(app, []);
      const failures = checkInventory(app, AT_HEAD).join("\n");
      for (const rule of ["L3", "L4"]) expect(failures).toMatch(new RegExp(`\\(${rule}: not on the allowlist\\)`));
      expect(failures).toMatch(/^test\/fake\.ts: still there \(gone: not on the allowlist\)$/m);
    });
  });

  describe("fails closed when no base resolves", () => {
    it("on a base that names no commit", () => {
      expect(checkInventory(fixture, { base: "no-such-commit" })).toEqual(["labs/test-support/fixtures/app: no merge-base: no-such-commit names no commit here"]);
    });

    it("in CI, with no base passed: it never guesses one", () => {
      const saved = { CI: process.env.CI, INVENTORY_BASE: process.env.INVENTORY_BASE };
      process.env.CI = "true";
      delete process.env.INVENTORY_BASE;
      try {
        expect(checkInventory(fixture)).toEqual(["labs/test-support/fixtures/app: no merge-base: CI passes INVENTORY_BASE for its event, and none was passed"]);
      } finally {
        for (const [name, value] of Object.entries(saved)) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    });
  });

  describe("reads the base", () => {
    it("as absent only when the commit doesn't have the path", () => {
      expect(atBase("HEAD", "labs/test-support/fixtures/app/no-such-file.ts")).toBeUndefined();
      expect(atBase("HEAD", "labs/test-support/fixtures/app/host.mts")).toContain("export const host");
    });

    it("and throws on any other git failure, rather than reading it as absent", () => {
      expect(() => atBase("no-such-revision", "labs/test-support/fixtures/app/host.mts")).toThrow();
    });
  });
});
