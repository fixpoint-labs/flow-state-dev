/**
 * Tests for `fsd/one-coalescer`: the lint that keeps the live read's
 * coalescer in one file. Each case plants a queued-read flag where a second
 * coalescer would be written (a package, a lab, an app) and expects a report,
 * or plants it in the one home, or in a test, and expects none. The config
 * cases lint through the repo's own `eslint.config.mjs`, so a rule that stopped
 * reading a directory fails here, not only in a hand-built config.
 *
 * Run with `node --test scripts/eslint-rules/one-coalescer.test.mjs`.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint, Linter } from "eslint";
import tseslint from "typescript-eslint";
import plugin, { COALESCER_HOME } from "./one-coalescer.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));

/** The coalescer every copy carried, as the client's home writes it. */
const COPY = `
let running = false;
let queued = false;
export function request(read) {
  if (running) { queued = true; return; }
  running = true;
  read().finally(() => { running = false; if (queued) { queued = false; request(read); } });
}
`;

function lint(code) {
  const linter = new Linter({ configType: "flat" });
  return linter.verify(code, [
    {
      files: ["**/*.ts"],
      languageOptions: { parser: tseslint.parser },
      plugins: { fsd: plugin },
      rules: { "fsd/one-coalescer": "error" },
    },
  ], "x.ts");
}

/** What the repo's own config reports for `code` at `filePath`. */
async function lintAt(filePath, code) {
  const eslint = new ESLint({ cwd: ROOT });
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((message) => message.ruleId === "fsd/one-coalescer");
}

describe("fsd/one-coalescer", () => {
  it("reports a queued-read flag set by hand, however it is spelled", () => {
    assert.equal(lint(COPY).length, 1);
    assert.equal(lint("const s = { queued: false }; s.queued = true;").length, 1);
    assert.equal(lint("class R { q() { this.readQueued = true; } }").length, 1);
    assert.equal(lint('const s = {}; s["queued"] = true;').length, 1);
  });

  it("leaves a flag cleared, and other names, alone", () => {
    assert.equal(lint("let queued = true; queued = false;").length, 0);
    assert.equal(lint("let running = false; running = true;").length, 0);
  });

  it("through the repo's config, reports a copy in a package, a lab and an app", async () => {
    for (const at of ["packages/workforce/src/workers/copy.ts", "labs/teammates/src/copy.ts", "apps/kitchen-sink/lib/copy.ts"]) {
      assert.equal((await lintAt(at, COPY)).length, 1, at);
    }
  });

  it("through the repo's config, allows the one home and tests", async () => {
    assert.equal((await lintAt(COALESCER_HOME, COPY)).length, 0);
    assert.equal((await lintAt("packages/react/test/copy.test.ts", COPY)).length, 0);
  });
});
