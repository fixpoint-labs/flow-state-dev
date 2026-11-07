/**
 * Pins the export check (`check-root-exports.mjs`, FIX-2448) against the real tree.
 *
 * The check must pass this commit against itself, and must name every planted violation:
 * a root name nobody imports, one only a sibling package imports, one only a goal imports,
 * one the README names only as a bare word in prose, one on a root outside `src/`, one an
 * app imports only inside a comment,
 * a name whose last app import is removed, and adopter imports of `/internal` paths in each
 * import form. It must let through what the rules say counts as use (an app import, a README
 * or changeset line, a type met through a used signature) and list the README and changeset
 * lines for the reviewer. Every plant goes through an overlay reader over the real packages,
 * so the walk that runs in CI is the walk under test.
 *
 * Run with `node --test scripts/root-exports.test.mjs`.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fsReader, overlayReader, packageEntryExports } from "./mechanism-exports.mjs";
import { ROOT, collisions, compare, render, rootReport, violations } from "./check-root-exports.mjs";
import { importCensus, importsIn, importsInCode } from "./import-census.mjs";

const real = fsReader(ROOT);

/** The real tree, with some files' text replaced or added. */
const overlay = (files) => overlayReader(real, files);

const CORE = "packages/core/src/index.ts";
const ENGINE = "packages/engine/src/index.ts";
const CORE_README = "packages/core/README.md";
const SHIFT = "packages/shift-manager/cli/index.ts";

const plants = {
  [CORE]: real(CORE) + `
export const zzNobody = 1;
export const zzGoalOnly = 1;
export const zzAppUsed = 1;
export const zzReadmeDump = 1;
export const zzProseOnly = 1;
export const zzTicked = 1;
export const zzCalled = 1;
export const zzImported = 1;
export const zzCommentedOut = 1;
export const zzBlockCommented = 1;
export const zzAfterComment = 1;
export const zzChangesetDoc = 1;
export const zzChangesetElsewhere = 1;
export const zzWasUsed = 1;
export const zzTemplateTail = 1;
export const zzInStringLiteral = 1;
export const zzAfterRegex = 1;
export const zzAfterTemplate = 1;
export const zzDestructured = 1;
export const zzRequired = 1;
export const zzDynamicNs = 1;
export const zzThen = 1;
export const zzComputed = 1;
export { impl as used, type Options as UsedOptions } from "./zz-plant/impl";
export type { Options } from "./zz-plant/other";
export { zzViaImport } from "./zz-plant/uses-import";
export type { ZzImportedOpts as ZzRootOpts } from "./zz-plant/types";
export interface ZzOptions { a: number }
export interface ZzBodyOnly { b: number }
export function zzSigned(options: ZzOptions): void { const x: ZzBodyOnly = { b: options.a }; void x; }
`,
  [ENGINE]: real(ENGINE) + "\nexport const zzSiblingOnly = 1;\n",
  // shift-manager's root is `./cli/index.ts`, outside any `src/`: still a published root.
  [SHIFT]: real(SHIFT) + "\nexport const zzShiftRoot = 1;\n",
  "packages/testing/src/zz-plant.ts": `import { zzSiblingOnly } from "@flow-state-dev/engine";\nvoid zzSiblingOnly;\n`,
  "goals/zz-plant/check.mts": `import { zzGoalOnly } from "@flow-state-dev/core";\nimport type { X } from "@flow-state-dev/core/internal";\n`,
  "apps/kitchen-sink/zz-plant.ts": `import { zzAppUsed, zzSigned } from "@flow-state-dev/core";\nimport type { Seam } from "@flow-state-dev/core/internal";\n`,
  // A commented-out import is not a use, and a comment inside a brace list doesn't hide the name after it.
  "apps/kitchen-sink/zz-comments.ts": `// import { zzCommentedOut } from "@flow-state-dev/core";\n/* import { zzBlockCommented } from "@flow-state-dev/core"; */\nimport {\n  // a note\n  zzAfterComment,\n} from "@flow-state-dev/core";\nconst url = "https://example.com"; // import { zzInString } from "@flow-state-dev/core"\n`,
  // Comments are found in parser context: a template's tail or a regex literal is not a comment,
  // so a `/*` or `//` inside one must not blank the code after it, and a comment after a
  // template is still a comment. Text inside a string literal is never an import.
  "labs/zz-plant/template.ts": "const glob = `${dir}/*.ts`;\nconst o = require(\"@flow-state-dev/core/internal\");\n",
  "examples/zz-plant/regex.js": `const re = /https?:\\/\\//; const s = require("@flow-state-dev/react/internal");\nconst re2 = /^\\/*$/;\nimport { zzAfterRegex } from "@flow-state-dev/core";\n`,
  "apps/kitchen-sink/zz-template.ts":
    "const u = `${base}//x`; import { zzAfterTemplate } from \"@flow-state-dev/core\";\n" +
    "const m = `hi ${name}`;\n// import { zzTemplateTail } from \"@flow-state-dev/core\";\n" +
    "const said = \"import { zzInStringLiteral } from '@flow-state-dev/core'\";\n",
  // The two reviewer repros, verbatim.
  "apps/kitchen-sink/zz-probe.ts":
    "const m = `hi ${name}`;\n// import { zzUnused } from \"@flow-state-dev/probe\";\n" +
    "const message = \"import { zzUnused } from '@flow-state-dev/probe'\";\n",
  // Aliased re-exports: the adopter imports `used`, and `impl`'s signature names impl.ts's
  // `Options`, which the root publishes as `UsedOptions`. The root's own `Options` is another
  // declaration nothing reaches, so the shared bare name must not clear it.
  "packages/core/src/zz-plant/impl.ts": "export interface Options { a: number }\nexport function impl(o: Options): void { void o; }\n",
  "packages/core/src/zz-plant/other.ts": "export interface Options { z: string }\n",
  // A signature type imported from a sibling file, published at the root under another name:
  // the mention resolves through the import to its declaration.
  "packages/core/src/zz-plant/types.ts": "export interface ZzImportedOpts { a: number }\n",
  "packages/core/src/zz-plant/uses-import.ts": `import type { ZzImportedOpts } from "./types";\nexport function zzViaImport(o: ZzImportedOpts): void { void o; }\n`,
  "apps/kitchen-sink/zz-via-import.ts": `import { zzViaImport } from "@flow-state-dev/core";\nzzViaImport({ a: 1 });\n`,
  "apps/kitchen-sink/zz-alias.ts": `import { used } from "@flow-state-dev/core";\nused({ a: 1 });\n`,
  // Names taken through import() and require(): destructured, read off the module, or via .then.
  // A computed read (`m[k]`) names nothing the census can know, so zzComputed stays failing.
  "apps/kitchen-sink/zz-dynamic.ts":
    `const { zzUsed } = await import("@flow-state-dev/probe");\n` +
    `const { zzDestructured } = await import("@flow-state-dev/core");\n` +
    `const { zzRequired } = require("@flow-state-dev/core");\n` +
    `const m = await import("@flow-state-dev/core");\nm.zzDynamicNs();\nconst k = "zzComputed";\nm[k];\n` +
    `import("@flow-state-dev/core").then(({ zzThen }) => zzThen);\n`,
  "labs/zz-plant/dynamic.ts": `const seams = await import("@flow-state-dev/engine/internal");\n`,
  "examples/zz-plant/require.js": `const o = require("@flow-state-dev/orchestration/internal");\n`,
  // Only a code-form mention names an export: a bare word in prose (zzProseOnly, zzReadmeDump)
  // is how a common name like `run` or `state` would clear on text that was never about it.
  [CORE_README]: real(CORE_README) +
    "\nzzReadmeDump\n\nThe zzProseOnly word in a sentence.\n\nCall \`zzTicked\` or zzCalled(opts).\n\n" +
    "```ts\nimport { createFlow, zzImported } from \"@flow-state-dev/core\";\n```\n",
  ".changeset/zz-plant.md": `---\n"@flow-state-dev/core": minor\n---\n\nAdds \`zzChangesetDoc\` (FIX-2448).\n\nDocs: packages/core/README.md\n`,
  ".changeset/zz-elsewhere.md": `---\n"@flow-state-dev/core": minor\n---\n\nAdds \`zzChangesetElsewhere\` (FIX-2448).\n\nDocs: apps/docs/docs/api/core.md\n`,
};

let base;
let planted;
let result;
before(() => {
  base = rootReport(real);
  planted = rootReport(overlay(plants));
  result = compare(base, planted);
});

const failingNames = () => result.newFailing.map((f) => `${f.pkg} ${f.name}`).sort();

describe("the export check", () => {
  it("passes this commit against itself, through the CLI CI runs", () => {
    assert.deepEqual(compare(base, base), { newFailing: [], newInternal: [], readmeCleared: [], newCollisions: [] });
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("./check-root-exports.mjs", import.meta.url)), "HEAD"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr + run.stdout);
  });

  it("fails each root name nobody outside the framework uses, and only those", () => {
    assert.deepEqual(failingNames(), [
      "@flow-state-dev/core Options", // shares a bare name with what `used` reaches, but is another declaration
      "@flow-state-dev/core ZzBodyOnly", // named only inside a function body, not by its signature
      "@flow-state-dev/core zzBlockCommented", // an import inside a comment is not a use
      "@flow-state-dev/core zzChangesetElsewhere", // its changeset's Docs: line doesn't list the README
      "@flow-state-dev/core zzCommentedOut",
      "@flow-state-dev/core zzComputed", // read only as m[k]: no name the census can know
      "@flow-state-dev/core zzGoalOnly", // goals are ours
      "@flow-state-dev/core zzInStringLiteral", // an import's text inside a string literal is not an import
      "@flow-state-dev/core zzNobody",
      "@flow-state-dev/core zzProseOnly", // a bare word in README prose is not the README naming it
      "@flow-state-dev/core zzReadmeDump",
      "@flow-state-dev/core zzTemplateTail", // a comment after a template literal is still a comment
      "@flow-state-dev/core zzWasUsed",
      "@flow-state-dev/engine zzSiblingOnly", // a sibling package's import is not a use
      "@flow-state-dev/shift-manager zzShiftRoot", // a root outside src/ is read too
    ]);
    assert.equal(render(result).ok, false);
  });

  it("lets through an app import, a type a used signature names, and a README or changeset line", () => {
    const core = planted.roots.get("@flow-state-dev/core");
    assert.equal(core.get("zzAppUsed").why, "adopter");
    assert.equal(core.get("zzAfterComment").why, "adopter");
    // A regex literal or a template holding `/*` or `//` does not hide the import after it.
    assert.equal(core.get("zzAfterRegex").why, "adopter");
    assert.equal(core.get("zzAfterTemplate").why, "adopter");
    // Names taken through import() and require() are uses too.
    for (const n of ["zzDestructured", "zzRequired", "zzDynamicNs", "zzThen"]) assert.equal(core.get(n).why, "adopter", n);
    // An aliased re-export is reached through the declaration it names, not its alias.
    assert.equal(core.get("used").why, "adopter");
    assert.equal(core.get("UsedOptions").why, "reached");
    // A mention imported from another file is reached through that import, under its root name.
    assert.equal(core.get("ZzRootOpts").why, "reached");
    assert.equal(core.get("ZzOptions").why, "reached");
    for (const n of ["zzTicked", "zzCalled", "zzImported", "zzChangesetDoc"]) assert.equal(core.get(n).why, "readme", n);
  });

  it("lists the names only a new README or changeset line clears, for the reviewer", () => {
    const cleared = result.readmeCleared.map((c) => c.name).sort();
    assert.deepEqual(cleared, ["zzCalled", "zzChangesetDoc", "zzImported", "zzTicked"]);
    const text = render(result).lines.join("\n");
    assert.match(text, /for the reviewer, not a failure/);
    // The mention may predate the change (a new export the README already named), so the
    // message must not claim the change added it.
    assert.doesNotMatch(text, /this change adds/);
  });

  it("fails a name whose last app import is removed", () => {
    const used = rootReport(overlay({ ...plants, "apps/kitchen-sink/zz-was.ts": `import { zzWasUsed } from "@flow-state-dev/core";\n` }));
    assert.equal(used.roots.get("@flow-state-dev/core").get("zzWasUsed").why, "adopter");
    assert.deepEqual(compare(used, planted).newFailing.map((f) => f.name), ["zzWasUsed"]);
  });

  it("names every new adopter import of an /internal path, in each form, and not a goal's", () => {
    assert.deepEqual(result.newInternal.map((i) => `${i.file} ${i.form} ${i.spec}`).sort(), [
      "apps/kitchen-sink/zz-plant.ts import type @flow-state-dev/core/internal",
      "examples/zz-plant/regex.js require() @flow-state-dev/react/internal",
      "examples/zz-plant/require.js require() @flow-state-dev/orchestration/internal",
      "labs/zz-plant/dynamic.ts import() @flow-state-dev/engine/internal",
      "labs/zz-plant/template.ts require() @flow-state-dev/core/internal",
    ]);
  });
});

/**
 * The collision assertion: no two entries in scope export one name from different declarations.
 * Scope is every published root plus every public entry of the six foundation packages;
 * `/internal` entries and other packages' subpaths are out of it.
 */
const collisionPlants = {
  // One name, two roots, two declarations: the planted collision.
  "packages/react/src/index.ts": real("packages/react/src/index.ts") + "\nexport type ZzTwoRoots = { a: 1 };\nexport type ZzOutOfScope = 1;\n",
  "packages/client/src/index.ts": real("packages/client/src/index.ts") + "\nexport type ZzTwoRoots = { b: 1 };\nexport type ZzInternalOnly = 1;\n",
  // Two subpaths of one foundation package, two declarations: an adopter importing both sees two.
  "packages/core/src/models/index.ts": real("packages/core/src/models/index.ts") + "\nexport type ZzTwoSubpaths = { a: 1 };\n",
  "packages/core/src/types/index.ts": real("packages/core/src/types/index.ts") +
    "\nexport type ZzTwoSubpaths = { b: 1 };\nexport type { ZzShared } from \"./zz-shared\";\n",
  // One declaration on two entries is a shared re-export, not a collision.
  "packages/core/src/types/zz-shared.ts": "export type ZzShared = { a: 1 };\n",
  "packages/core/src/index.ts": real("packages/core/src/index.ts") + "\nexport type { ZzShared } from \"./types/zz-shared\";\n",
  // A type alias of the shared type is its own declaration: a second meaning under one name.
  "packages/engine/src/zz-alias.ts": `import type { ZzShared as Base } from "@flow-state-dev/core/types";\nexport type ZzShared = Base;\n`,
  "packages/engine/src/index.ts": real("packages/engine/src/index.ts") + "\nexport type { ZzShared } from \"./zz-alias\";\n",
  // Out of scope: an /internal entry, and a subpath of a package outside the six.
  "packages/client/src/internal.ts": real("packages/client/src/internal.ts") + "\nexport type ZzInternalOnly = 2;\n",
  "packages/patterns/src/supervisor/index.ts": real("packages/patterns/src/supervisor/index.ts") + "\nexport type ZzOutOfScope = 2;\n",
};

describe("the collision assertion", () => {
  let found;
  let verdict;
  before(() => {
    found = collisions(overlay(collisionPlants));
    verdict = compare(base, { ...rootReport(overlay(collisionPlants)) });
  });

  it("names a name two entries in scope export from different declarations, with each entry", () => {
    assert.deepEqual(found.get("ZzTwoRoots")?.map((e) => e.entry).sort(), ["@flow-state-dev/client", "@flow-state-dev/react"]);
    assert.deepEqual(found.get("ZzTwoSubpaths")?.map((e) => e.entry).sort(), ["@flow-state-dev/core/models", "@flow-state-dev/core/types"]);
  });

  it("fails a type alias of a shared type, and not the shared re-export itself", () => {
    // core's root and core/types re-export one declaration; engine's alias is a second one.
    assert.deepEqual(found.get("ZzShared")?.map((e) => `${e.entry} ${e.file}`).sort(), [
      "@flow-state-dev/core packages/core/src/types/zz-shared.ts",
      "@flow-state-dev/core/types packages/core/src/types/zz-shared.ts",
      "@flow-state-dev/engine packages/engine/src/zz-alias.ts",
    ]);
  });

  it("leaves /internal entries and other packages' subpaths out of scope", () => {
    assert.equal(found.has("ZzInternalOnly"), false);
    assert.equal(found.has("ZzOutOfScope"), false);
  });

  it("fails on a collision the base lacks, naming both sides, and only on those", () => {
    assert.deepEqual(verdict.newCollisions.map((c) => c.name).sort(), ["ZzShared", "ZzTwoRoots", "ZzTwoSubpaths"]);
    const { ok, lines } = render(verdict);
    assert.equal(ok, false);
    assert.ok(lines.includes("`ZzShared` means different things: packages/core/src/types/zz-shared.ts (on @flow-state-dev/core, @flow-state-dev/core/types) and packages/engine/src/zz-alias.ts (on @flow-state-dev/engine)."), lines.join("\n"));
  });

  it("strict run: prints every collision as a violation, in the goal judge's protocol", () => {
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("./check-collisions.mjs", import.meta.url)), "--strict", "--json", "--root", ROOT], { encoding: "utf8" });
    const { violations } = JSON.parse(run.stdout.trim().split("\n").pop());
    const names = new Set(violations.map((v) => v.name));
    assert.deepEqual([...names].sort(), [...collisions(real).keys()].sort());
    for (const v of violations) assert.match(v.package, /^@flow-state-dev\//);
  });
});

describe("the export check's strict run, for the adopter goal", () => {
  it("lists every failing root name and every adopter /internal import, base set aside", () => {
    const got = violations(planted);
    const names = new Set(got.map((v) => `${v.package} ${v.name}`));
    // A name that already fails on this commit is a violation too: the strict run has no base.
    const already = [...base.roots.get("@flow-state-dev/core")].find(([, v]) => v.why === "failing");
    assert.ok(already, "core has a failing root name to set the base aside on");
    for (const n of [`@flow-state-dev/core ${already[0]}`, "@flow-state-dev/core zzNobody", "@flow-state-dev/engine zzSiblingOnly"]) assert.ok(names.has(n), n);
    for (const n of ["zzAppUsed", "zzChangesetDoc", "UsedOptions"]) assert.ok(!names.has(`@flow-state-dev/core ${n}`), n);
    // An adopter import of `<pkg>/internal` is the imported package's violation.
    assert.ok(names.has("@flow-state-dev/engine @flow-state-dev/engine/internal"));
    assert.ok(got.every((v) => v.package && v.name && v.detail));
  });

  it("prints the whole verdict through a pipe, however long, as the goal judge reads it", () => {
    // A verdict far over a pipe's 64 KiB buffer: exiting before stdout drains cuts it short.
    const tree = mkdtempSync(join(tmpdir(), "root-exports-long-"));
    try {
      const names = Array.from({ length: 3000 }, (_, i) => `zzUnusedName${i}`);
      mkdirSync(join(tree, "packages/zz/src"), { recursive: true });
      writeFileSync(join(tree, "packages/zz/package.json"), JSON.stringify({ name: "@flow-state-dev/zz", exports: { ".": "./src/index.ts" } }));
      writeFileSync(join(tree, "packages/zz/src/index.ts"), names.map((n) => `export const ${n} = 1;\n`).join(""));
      const run = spawnSync(process.execPath, [fileURLToPath(new URL("./check-root-exports.mjs", import.meta.url)), "--strict", "--json", "--root", tree], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      assert.ok(run.stdout.length > 64 * 1024, `verdict is ${run.stdout.length} bytes`);
      assert.equal(JSON.parse(run.stdout.trim().split("\n").pop()).violations.length, names.length);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });

  it("reads a tree that is not a git checkout, and prints its verdict as the last line", () => {
    const tree = mkdtempSync(join(tmpdir(), "root-exports-strict-"));
    try {
      const put = (path, text) => { mkdirSync(dirname(join(tree, path)), { recursive: true }); writeFileSync(join(tree, path), text); };
      put("packages/zz/package.json", JSON.stringify({ name: "@flow-state-dev/zz", exports: { ".": "./src/index.ts" } }));
      put("packages/zz/src/index.ts", "export const zzUsed = 1;\nexport const zzUnused = 1;\n");
      put("apps/app/main.ts", `import { zzUsed } from "@flow-state-dev/zz";\nimport type { X } from "@flow-state-dev/zz/internal";\n`);
      // A published package with no "." entry has no root an adopter can import: a violation, not a vacuous pass.
      put("packages/zznoroot/package.json", JSON.stringify({ name: "@flow-state-dev/zznoroot", exports: { "./sdk": "./src/sdk.ts" } }));
      put("packages/zznoroot/src/sdk.ts", "export const zzSdk = 1;\n");
      // A private package is not published, so its missing root is no one's concern.
      put("packages/zzprivate/package.json", JSON.stringify({ name: "@flow-state-dev/zzprivate", private: true, exports: { "./x": "./src/x.ts" } }));
      const run = spawnSync(process.execPath, [fileURLToPath(new URL("./check-root-exports.mjs", import.meta.url)), "--strict", "--json", "--root", tree], { encoding: "utf8" });
      const verdict = JSON.parse(run.stdout.trim().split("\n").pop());
      assert.deepEqual(verdict.violations.map((v) => `${v.package} ${v.name}`).sort(), [
        "@flow-state-dev/zz @flow-state-dev/zz/internal",
        "@flow-state-dev/zz zzUnused",
        "@flow-state-dev/zznoroot (root)",
      ]);
      assert.match(verdict.violations.find((v) => v.package === "@flow-state-dev/zznoroot").detail, /root entry missing/);
    } finally {
      rmSync(tree, { recursive: true, force: true });
    }
  });
});

describe("engine's entries", () => {
  it("re-export no name another package declares, and each name sits on one entry", () => {
    // Core's and contracts' names are imported from core, so an engine import never shadows them.
    const engine = packageEntryExports(real).get("@flow-state-dev/engine");
    const entries = [".", "./host", "./internal"].map((k) => [k, engine.get(k)]);
    const foreign = entries.flatMap(([k, m]) => [...m].filter(([, e]) => !e.file.startsWith("packages/engine/")).map(([n]) => `${k} ${n}`));
    assert.deepEqual(foreign, []);
    const seen = new Map();
    for (const [k, m] of entries) for (const n of m.keys()) seen.set(n, [...(seen.get(n) ?? []), k]);
    assert.deepEqual([...seen].filter(([, ks]) => ks.length > 1), []);
  });
});

describe("the import census", () => {
  it("counts neither a commented import after a template nor an import's text in a string", () => {
    const { uses } = importCensus(overlay(plants));
    assert.equal(uses.get("@flow-state-dev/probe")?.has("zzUnused"), false);
  });

  it("counts a name destructured from an import() call", () => {
    const { uses } = importCensus(overlay(plants));
    assert.deepEqual([...uses.get("@flow-state-dev/probe").get("zzUsed")], ["adopter"]);
  });

  it("reads every import form and the names each takes", () => {
    const text = [
      `import def, { a, type B, c as d } from "@flow-state-dev/core";`,
      `import type { E } from "@flow-state-dev/core/types";`,
      `export { f } from "@flow-state-dev/react";`,
      `import * as ns from "@flow-state-dev/client"; ns.g(); ns.h;`,
      `import "@flow-state-dev/react/internal";`,
      `type T = typeof import("@flow-state-dev/engine/internal");`,
      `const m = require("@flow-state-dev/memory");`,
    ].join("\n");
    const show = (imports) => imports.map((i) => `${i.form} ${i.pkg}${i.sub} [${i.names.join(",")}]`);
    // A code file is read from its syntax tree, Markdown as text: both must read every form alike.
    assert.deepEqual(show(importsInCode(text, "x.ts")), show(importsIn(text)));
    assert.deepEqual(show(importsIn(text)), [
      "import @flow-state-dev/core [a,B,c,default]",
      "import type @flow-state-dev/core/types [E]",
      "export from @flow-state-dev/react [f]",
      "import @flow-state-dev/client [g,h]",
      "import @flow-state-dev/react/internal []",
      "import() @flow-state-dev/engine/internal []",
      "require() @flow-state-dev/memory []",
    ]);
  });

  it("reads the names in a brace list that carries comments", () => {
    // Docs code blocks annotate their imports. A comment after an item must not swallow the
    // name on the next line, or a docs-imported name reads as unused.
    const text = [
      "import {",
      "  a,          // a line comment",
      "  b,",
      "  /* a block comment */ c,",
      "  d, // the last item's comment",
      `} from "@flow-state-dev/core";`,
    ].join("\n");
    const show = (imports) => imports.map((i) => `${i.form} ${i.pkg}${i.sub} [${i.names.join(",")}]`);
    assert.deepEqual(show(importsInCode(text, "x.ts")), show(importsIn(text)));
    assert.deepEqual(show(importsIn(text)), ["import @flow-state-dev/core [a,b,c,d]"]);
  });
});
