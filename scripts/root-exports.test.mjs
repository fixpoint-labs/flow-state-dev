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
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fsReader } from "./mechanism-exports.mjs";
import { ROOT, compare, render, rootReport } from "./check-root-exports.mjs";
import { importsIn } from "./import-census.mjs";

const real = fsReader(ROOT);

/** The real tree, with some files' text replaced or added. */
function overlay(files) {
  const read = (path) => (path in files ? files[path] : real(path));
  read.packageDirs = real.packageDirs;
  read.list = real.list;
  read.tracked = () => [...new Set([...real.tracked(), ...Object.keys(files)])];
  read.grep = (text, dirs) => {
    const under = (f) => dirs.some((d) => f.startsWith(`${d}/`));
    const planted = Object.keys(files).filter((f) => under(f));
    return [...new Set([...real.grep(text, dirs).filter((f) => !(f in files)), ...planted.filter((f) => files[f].includes(text))])];
  };
  return read;
}

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
    assert.deepEqual(compare(base, base), { newFailing: [], newInternal: [], readmeCleared: [] });
    const run = spawnSync(process.execPath, [fileURLToPath(new URL("./check-root-exports.mjs", import.meta.url)), "HEAD"], { encoding: "utf8" });
    assert.equal(run.status, 0, run.stderr + run.stdout);
  });

  it("fails each root name nobody outside the framework uses, and only those", () => {
    assert.deepEqual(failingNames(), [
      "@flow-state-dev/core ZzBodyOnly", // named only inside a function body, not by its signature
      "@flow-state-dev/core zzBlockCommented", // an import inside a comment is not a use
      "@flow-state-dev/core zzChangesetElsewhere", // its changeset's Docs: line doesn't list the README
      "@flow-state-dev/core zzCommentedOut",
      "@flow-state-dev/core zzGoalOnly", // goals are ours
      "@flow-state-dev/core zzNobody",
      "@flow-state-dev/core zzProseOnly", // a bare word in README prose is not the README naming it
      "@flow-state-dev/core zzReadmeDump",
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
      "examples/zz-plant/require.js require() @flow-state-dev/orchestration/internal",
      "labs/zz-plant/dynamic.ts import() @flow-state-dev/engine/internal",
    ]);
  });
});

describe("the import census", () => {
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
    assert.deepEqual(importsIn(text).map((i) => `${i.form} ${i.pkg}${i.sub} [${i.names.join(",")}]`), [
      "import @flow-state-dev/core [a,B,c,default]",
      "import type @flow-state-dev/core/types [E]",
      "export from @flow-state-dev/react [f]",
      "import @flow-state-dev/client [g,h]",
      "import @flow-state-dev/react/internal []",
      "import() @flow-state-dev/engine/internal []",
      "require() @flow-state-dev/memory []",
    ]);
  });
});
