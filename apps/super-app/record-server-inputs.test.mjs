/**
 * The preload records each file the server loaded as it was when it loaded,
 * so an edit made right after still reads as a change.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { REPO } from "./apps.mjs";

const hash = (text) => createHash("sha256").update(text).digest("hex");

let dir;
beforeEach(() => {
  // Inside the repository: the preload records only the repository's files.
  dir = mkdtempSync(join(REPO, "apps/super-app/.record-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** Runs `main` under tsx with the preload, and returns the record it wrote. */
function run(main) {
  const inputs = join(dir, "inputs");
  writeFileSync(join(dir, "main.mts"), main);
  execFileSync(join(REPO, "node_modules/.bin/tsx"), ["--import", join(REPO, "apps/super-app/record-server-inputs.mjs"), "main.mts"], {
    cwd: dir,
    env: { ...process.env, SUPER_APP_SERVER_INPUTS: inputs },
    stdio: "ignore",
  });
  const rel = (name) => join(dir, name).slice(REPO.length).replace(/^\//, "");
  return { inputs: JSON.parse(readFileSync(join(inputs, "build-inputs.json"), "utf8")).inputs, rel };
}

describe("record-server-inputs", () => {
  it("hashes a CommonJS module as it loaded, not as it is when the record is written", () => {
    writeFileSync(join(dir, "dep.cjs"), 'module.exports = "before";');
    const { inputs, rel } = run(
      [
        'import { createRequire } from "node:module";',
        'import { writeFileSync } from "node:fs";',
        'createRequire(import.meta.url)("./dep.cjs");',
        // Edited after it loaded, before the record is written.
        'writeFileSync(new URL("./dep.cjs", import.meta.url), \'module.exports = "after";\');',
        "await new Promise((r) => setTimeout(r, 500));",
      ].join("\n"),
    );
    assert.equal(inputs[rel("dep.cjs")], hash('module.exports = "before";'));
  });

  it("records the ES modules a server imports and not the files beside them", () => {
    writeFileSync(join(dir, "flow.mts"), "export const v = 1;");
    writeFileSync(join(dir, "page.tsx"), "export const P = 1;");
    const { inputs, rel } = run('await import("./flow.mts");\nawait new Promise((r) => setTimeout(r, 500));');
    assert.equal(inputs[rel("flow.mts")], hash("export const v = 1;"));
    assert.equal(inputs[rel("page.tsx")], undefined);
  });
});
