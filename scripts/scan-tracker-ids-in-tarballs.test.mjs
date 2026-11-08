/**
 * Tests for the tarball scan (`scan-tracker-ids-in-tarballs.mjs`): what an
 * adopter reads once a package is installed. Each case plants an id in an
 * unpacked package and expects the scan to report it where an adopter reads it
 * (a `.d.ts` JSDoc block, a `.js` string or template) and not where only we do
 * (a `//` comment in compiled `.js`), and to fail a file the tarball ships from
 * outside the lint's file set.
 *
 * Run with `node --test scripts/scan-tracker-ids-in-tarballs.test.mjs`.
 */

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";
import { scanPackage } from "./scan-tracker-ids-in-tarballs.mjs";

/** Write an unpacked package (path → text) under a new directory and return it. */
function unpacked(root, name, files) {
  const dir = join(root, name);
  for (const [path, text] of Object.entries({ "package.json": JSON.stringify({ name: `@flow-state-dev/${name}` }), ...files })) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  return dir;
}

describe("scanPackage", () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), "tarball-scan-"));
  });
  after(() => rmSync(root, { recursive: true, force: true }));

  it("reports a .d.ts JSDoc id, a .js string id and a .js template id, and keeps a .js // pointer", () => {
    const dir = unpacked(root, "core", {
      "dist/index.d.ts": "/** Holds the slot (FIX-2133). */\nexport declare const a = 1;\n",
      "dist/index.js": [
        "// FIX-2133: a pointer, kept.",
        'export const a = () => { throw new Error("which was removed (FIX-918)"); };',
        "export const t = (k) => `resumes ${k} (LAB-12) ${k}`;",
      ].join("\n"),
    });
    const { hovers, runtimeText, outside } = scanPackage(dir, "core");
    assert.deepEqual(hovers.map((h) => h.id), ["FIX-2133"]);
    assert.deepEqual(runtimeText.map((h) => h.id).sort(), ["FIX-918", "LAB-12"]);
    assert.deepEqual(outside, []);
  });

  it("still reads a JSDoc block that follows an interpolated template-literal type", () => {
    const dir = unpacked(root, "react", {
      "dist/index.d.ts": "export type Key = `prefix${string}`;\n/** FIX-123 */\nexport declare const a: Key;\n",
    });
    assert.deepEqual(scanPackage(dir, "react").hovers.map((h) => h.id), ["FIX-123"]);
  });

  it("reads a .js template's text as an adopter sees it, an id right after an escape included", () => {
    const dir = unpacked(root, "client", { "dist/index.js": "export const e = () => new Error(`Details:\\nFIX-123`);\n" });
    assert.deepEqual(scanPackage(dir, "client").runtimeText.map((h) => h.id), ["FIX-123"]);
  });

  it("passes a package with no ids where an adopter reads them", () => {
    const dir = unpacked(root, "engine", {
      "dist/index.d.ts": "/** Holds the slot. */\nexport declare const a = 1;\n",
      "dist/index.js": "// FIX-2133: a pointer, kept.\nexport const a = 1;\n",
    });
    const { hovers, runtimeText, outside } = scanPackage(dir, "engine");
    assert.deepEqual([...hovers, ...runtimeText, ...outside], []);
  });

  it("fails code a tarball ships from outside the lint's file set, and accepts cursor's runtime/", () => {
    const stray = unpacked(root, "client", { "extra/helper.js": "export const a = 1;\n" });
    assert.deepEqual(scanPackage(stray, "client").outside, ["extra/helper.js"]);
    const cursor = unpacked(root, "cursor", { "runtime/child.mjs": "export const a = 1;\n" });
    assert.deepEqual(scanPackage(cursor, "cursor").outside, []);
  });
});
