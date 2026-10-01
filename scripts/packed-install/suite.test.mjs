/**
 * Pins the judgement rules of the installed-release suite runner
 * (`suite.mjs`): which lockfile versions it pins, which case files it counts
 * and how it splits them into legs, and which results it calls a pass. The
 * runner itself runs in CI against real tarballs; these rules are where it
 * could go quietly lenient, so they are fixed here against fixtures.
 *
 * Run with `node --test scripts/packed-install/suite.test.mjs`. Plain
 * `node:test`, so it lives beside the script and changes nothing under
 * `packages/`.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { judgeFiles, pinnedVersions, suiteCases, SUITE_DIR } from "./suite.mjs";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

/** A pnpm-lock.yaml importers slice: two importers that pin different versions. */
const LOCK = `lockfileVersion: '9.0'

importers:

  packages/core:
    devDependencies:
      vitest:
        specifier: ^3.0.0
        version: 3.0.0(@types/node@22.0.0)
      zod:
        specifier: ^3.0.0
        version: 3.0.0

  packages/integration-tests:
    dependencies:
      zod:
        specifier: ^3.24.1
        version: 3.25.76
    devDependencies:
      vitest:
        specifier: ^3.2.4
        version: 3.2.4(@types/debug@4.1.12)(@types/node@22.19.13)

  packages/workspace:
    dependencies:
      zod:
        specifier: ^3.0.0
        version: 3.9.9

packages:
`;

describe("pinnedVersions", () => {
  it("reads the importer's own resolved versions, without peer suffixes", () => {
    assert.deepEqual(pinnedVersions(LOCK, "packages/integration-tests", ["vitest", "zod"]), {
      vitest: "3.2.4",
      zod: "3.25.76",
    });
  });

  it("never takes a neighbouring importer's version", () => {
    assert.equal(pinnedVersions(LOCK, "packages/core", ["zod"]).zod, "3.0.0");
    assert.equal(pinnedVersions(LOCK, "packages/workspace", ["zod"]).zod, "3.9.9");
  });

  it("throws when the importer is missing", () => {
    assert.throws(() => pinnedVersions(LOCK, "packages/nope", ["zod"]), /has no importer packages\/nope/);
  });

  it("throws when the importer does not pin the dependency", () => {
    assert.throws(() => pinnedVersions(LOCK, "packages/workspace", ["vitest"]), /pins no vitest/);
    // Even when a later importer does pin it.
    const noZod = LOCK.replace("      zod:\n        specifier: ^3.24.1\n        version: 3.25.76\n", "");
    assert.notEqual(noZod, LOCK);
    assert.throws(() => pinnedVersions(noZod, "packages/integration-tests", ["zod"]), /pins no zod/);
  });

  it("throws, rather than guessing, when the layout drifts", () => {
    // `version` before `specifier`, and inline: not the shape it reads.
    const drifted = LOCK.replace(
      "      vitest:\n        specifier: ^3.2.4\n        version: 3.2.4(@types/debug@4.1.12)(@types/node@22.19.13)",
      "      vitest:\n        version: 3.2.4\n        specifier: ^3.2.4",
    );
    assert.notEqual(drifted, LOCK);
    assert.throws(() => pinnedVersions(drifted, "packages/integration-tests", ["vitest"]), /pins no vitest/);
    // Indentation changed: the importer heading no longer matches.
    const reindented = LOCK.replaceAll("\n  packages/", "\n    packages/");
    assert.throws(() => pinnedVersions(reindented, "packages/integration-tests", ["zod"]), /has no importer/);
  });

  it("agrees with what pnpm installed for packages/integration-tests in this checkout", () => {
    const pins = pinnedVersions(readFileSync(join(ROOT, "pnpm-lock.yaml"), "utf8"), "packages/integration-tests", [
      "vitest",
      "zod",
    ]);
    const req = createRequire(join(ROOT, "packages/integration-tests/package.json"));
    for (const name of ["vitest", "zod"]) {
      assert.equal(pins[name], req(`${name}/package.json`).version, name);
    }
  });
});

describe("suiteCases", () => {
  const dir = mkdtempSync(join(tmpdir(), "fsd-suite-cases-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "harness.ts"), "export async function startQueueDeployment() {}\n");
  writeFileSync(join(dir, "b-plain.test.ts"), 'import { startTwoUserServer } from "./harness";\n');
  writeFileSync(join(dir, "a-queue.test.ts"), 'import { startQueueDeployment } from "./harness";\n');
  writeFileSync(join(dir, "notes.md"), "startQueueDeployment\n");

  it("counts only case files, sorted, and splits by whether a case starts a queue deployment", () => {
    assert.deepEqual(suiteCases(dir), {
      files: ["a-queue.test.ts", "b-plain.test.ts"],
      legB: ["b-plain.test.ts"],
      legC: ["a-queue.test.ts"],
    });
  });

  it("counts the real suite at runtime: the queue case is leg c, and every case is in a leg", () => {
    const { files, legB, legC } = suiteCases(SUITE_DIR);
    assert.ok(files.length > 0);
    assert.ok(legC.includes("queue-delivery.test.ts"));
    assert.deepEqual([...legB, ...legC].sort(), files);
  });
});

describe("judgeFiles", () => {
  const passed = (title) => ({ title, status: "passed" });
  const quiet = (results) => {
    const log = console.log;
    console.log = () => {};
    try {
      return judgeFiles(results);
    } finally {
      console.log = log;
    }
  };

  it("passes only files whose every test passed", () => {
    assert.deepEqual(quiet([{ file: "a.test.ts", ran: true, tests: [passed("x"), passed("y")], message: "" }]), []);
  });

  for (const status of ["skipped", "pending", "todo", "failed"]) {
    it(`fails a ${status} test`, () => {
      const failures = quiet([{ file: "a.test.ts", ran: true, tests: [passed("x"), { title: "y", status }], message: "" }]);
      assert.equal(failures.length, 1);
      assert.match(failures[0], new RegExp(`a\\.test\\.ts › y: ${status}`));
    });
  }

  it("fails a file that never ran", () => {
    assert.match(quiet([{ file: "a.test.ts", ran: false, tests: [], message: "boom" }])[0], /never ran: boom/);
  });

  it("fails a file that ran no test (an import that threw)", () => {
    const failures = quiet([{ file: "a.test.ts", ran: true, tests: [], message: "resolution guard: …" }]);
    assert.match(failures[0], /ran no test: resolution guard/);
  });
});
