/**
 * Tests for `fsd/no-tracker-ids`: the lint that keeps tracker and process ids
 * out of what an adopter reads. Each case plants an id where an adopter would
 * read it (a hover, runtime text, a copied file) and expects a report, or
 * plants one where only we read it (a `//` pointer in shipped source) and
 * expects none.
 *
 * Run with `node --test scripts/eslint-rules/no-tracker-ids.test.mjs`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import { neverPublish } from "../validate-publish-set.mjs";
import plugin from "./no-tracker-ids.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** Lint `code` with only this rule on, as shipped source or (`comments: "all"`) a copied file. */
function lint(code, options) {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(
    code,
    [
      {
        files: ["**/*.tsx"],
        languageOptions: { parser: tseslint.parser, parserOptions: { ecmaFeatures: { jsx: true } } },
        plugins: { fsd: plugin },
        rules: { "fsd/no-tracker-ids": options ? ["error", options] : "error" },
      },
    ],
    { filename: "plant.tsx" },
  );
}

/** The ids reported, in source order. */
const reported = (code, options) => lint(code, options).map((m) => /\b[A-Z]+-\d+\b/.exec(m.message)?.[0]);

describe("fsd/no-tracker-ids in shipped source", () => {
  it("reports an id in a JSDoc block, which becomes the editor hover", () => {
    assert.deepEqual(reported("/** Holds the slot (FIX-2133 D2). */\nexport const a = 1;\n"), ["FIX-2133"]);
  });

  it("reports an id in a string literal, which an adopter reads as an error message", () => {
    assert.deepEqual(reported('throw new Error("which was removed (FIX-918)");\n'), ["FIX-918"]);
  });

  it("reports an id in a template literal, as in a conformance suite's it() title", () => {
    assert.deepEqual(reported("it(`resumes ${kind} (FIX-2426)`, () => {});\n"), ["FIX-2426"]);
  });

  it("reports an id in JSX text, which an adopter reads as UI copy", () => {
    assert.deepEqual(reported("export const Gap = () => <p>Not built yet (FIX-2418)</p>;\n"), ["FIX-2418"]);
  });

  it("reports an id in a /*! block, which tsc keeps in a .d.ts like JSDoc", () => {
    assert.deepEqual(reported("/*! Licence note (LAB-7). */\nexport const a = 1;\n"), ["LAB-7"]);
  });

  it("reads a JSDoc block that follows an interpolated template-literal type", () => {
    assert.deepEqual(reported("export type Key = `prefix${string}`;\n/** FIX-123 */\nexport const a = 1;\n"), ["FIX-123"]);
  });

  it("reports an id on an exported interface member's JSDoc", () => {
    assert.deepEqual(reported("export interface Row {\n  /** Per BP-030, dual-read. */\n  owner?: string;\n}\n"), ["BP-030"]);
  });

  it("reports every family the pattern names: FIX, LAB, FLC, TL, BP, BR", () => {
    const code = ["FIX-1", "LAB-2", "FLC-3", "TL-4", "BP-5", "BR-6"].map((id, i) => `export const s${i} = "see ${id}";`).join("\n");
    assert.deepEqual(reported(code), ["FIX-1", "LAB-2", "FLC-3", "TL-4", "BP-5", "BR-6"]);
  });

  it("keeps a // pointer and a /* */ pointer, which no adopter reads (BP-006)", () => {
    assert.deepEqual(reported("// FIX-2133 D2; FIX-2058 ER-8.\n/* Pointer: FIX-103. */\nexport const a = 1;\n"), []);
  });

  it("ignores an adopter's own key and an id-like word that is not one of ours", () => {
    assert.deepEqual(reported('/** Keys look like ENG-142. */\nexport const k = "ENG-106 PREFIX-12 BPX-3";\n'), []);
  });
});

describe("fsd/no-tracker-ids in a file an adopter copies whole", () => {
  it("with comments: \"all\", reports a // and a /* */ pointer too", () => {
    assert.deepEqual(reported("// FIX-102\n/* FIX-103 */\nexport const a = 1;\n", { comments: "all" }), ["FIX-102", "FIX-103"]);
  });
});

describe("fsd/no-tracker-ids has no allow-list", () => {
  it("refuses any option but comments", () => {
    assert.throws(() => lint("export const a = 1;\n", { allow: ["FIX-1"] }), /should NOT have additional properties/);
  });
});

describe("the repo's eslint.config.mjs", () => {
  const eslint = new ESLint({ cwd: ROOT });
  const level = async (file) => (await eslint.calculateConfigForFile(join(ROOT, file)))?.rules?.["fsd/no-tracker-ids"];

  it("turns the rule on for every published package's src, a new package's included", async () => {
    for (const file of ["packages/core/src/a.ts", "packages/engine/src/x/b.tsx", "packages/some-new-package/src/c.mts"]) {
      assert.deepEqual(await level(file), [2], file);
    }
  });

  it("covers the three roots that ship from outside src", async () => {
    for (const file of ["packages/shift-manager/cli/bin.ts", "packages/cursor/runtime/child.mjs", "apps/devtool/src/App.tsx"]) {
      assert.deepEqual(await level(file), [2], file);
    }
  });

  it("reads every comment in the files an adopter copies whole", async () => {
    for (const file of ["packages/ui/registry/chat/message.tsx", "examples/hello-chat/src/flow.ts"]) {
      assert.deepEqual(await level(file), [2, { comments: "all" }], file);
    }
  });

  it("leaves out what never publishes, tests outside src, and unpublished apps", async () => {
    for (const file of [...neverPublish.map((dir) => `packages/${dir}/src/a.ts`), "packages/core/test/a.test.ts", "apps/kitchen-sink/app/page.tsx"]) {
      assert.equal(await level(file), undefined, file);
    }
  });
});
