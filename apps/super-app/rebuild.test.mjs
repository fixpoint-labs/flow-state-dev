/**
 * `rebuildOnChange` keeps a page current with one ordinary build per change,
 * and nothing running between changes: a build is only ever started by a
 * change to a file the last build recorded, or by a stale build at start.
 */
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";
import { createHash } from "node:crypto";
import { rebuildOnChange } from "./rebuild.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const hash = (text) => createHash("sha256").update(text).digest("hex");

let repo;
let outDir;
let watcher;

/** A build that records `src/a.ts` as `build-inputs.json` does, counting its runs. */
function fakeBuild({ durationMs = 0 } = {}) {
  const build = async () => {
    build.runs += 1;
    await sleep(durationMs);
    writeFileSync(join(outDir, "build-inputs.json"), JSON.stringify({ inputs: { "src/a.ts": hash(readA()) } }));
  };
  build.runs = 0;
  return build;
}
let a = "one";
const readA = () => a;
const editA = (text) => {
  a = text;
  writeFileSync(join(repo, "src/a.ts"), text);
};

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "rebuild-"));
  outDir = join(repo, "dist");
  mkdirSync(join(repo, "src"));
  mkdirSync(outDir);
  a = "one";
  writeFileSync(join(repo, "src/a.ts"), a);
  writeFileSync(join(repo, "src/unrelated.ts"), "x");
  writeFileSync(join(outDir, "build-inputs.json"), JSON.stringify({ inputs: { "src/a.ts": hash(a) } }));
});
afterEach(() => {
  watcher?.close();
  rmSync(repo, { recursive: true, force: true });
});

describe("rebuildOnChange", () => {
  it("doesn't build a current page, and builds once for a burst of saves to a recorded file", async () => {
    const build = fakeBuild();
    watcher = rebuildOnChange({ outDir, repoRoot: repo, build, debounceMs: 50 });
    await sleep(150);
    assert.equal(build.runs, 0, "a build that matches its source is left alone");

    editA("two");
    editA("three");
    editA("four");
    await sleep(300);
    assert.equal(build.runs, 1);
  });

  it("ignores files the build wasn't made from", async () => {
    const build = fakeBuild();
    watcher = rebuildOnChange({ outDir, repoRoot: repo, build, debounceMs: 50 });
    writeFileSync(join(repo, "src/unrelated.ts"), "y");
    await sleep(300);
    assert.equal(build.runs, 0);
  });

  it("builds at start when the page is stale", async () => {
    editA("changed while nothing was running");
    const build = fakeBuild();
    watcher = rebuildOnChange({ outDir, repoRoot: repo, build, debounceMs: 50 });
    await sleep(150);
    assert.equal(build.runs, 1);
  });

  it("runs one more build after a change made during a build, never two at once", async () => {
    const build = fakeBuild({ durationMs: 300 });
    let running = 0;
    let overlapped = false;
    const guarded = async () => {
      running += 1;
      if (running > 1) overlapped = true;
      await build();
      running -= 1;
    };
    watcher = rebuildOnChange({ outDir, repoRoot: repo, build: guarded, debounceMs: 20 });
    editA("two");
    await sleep(100); // the first build is running
    editA("three");
    await sleep(900);
    assert.equal(build.runs, 2);
    assert.equal(overlapped, false);
  });

  it("still rebuilds after a failed build left no record", async () => {
    let fail = true;
    const build = fakeBuild();
    const flaky = async () => {
      if (fail) {
        build.runs += 1;
        rmSync(join(outDir, "build-inputs.json"), { force: true });
        return;
      }
      await build();
    };
    watcher = rebuildOnChange({ outDir, repoRoot: repo, build: flaky, debounceMs: 20 });
    editA("broken");
    await sleep(200);
    assert.equal(build.runs, 1);
    fail = false;
    editA("fixed");
    await sleep(200);
    assert.equal(build.runs, 2);
  });

  it("builds on a source save when the page has never built successfully", async () => {
    // No record at start and a first build that fails: nothing recorded says what to watch.
    rmSync(join(outDir, "build-inputs.json"));
    let fail = true;
    const build = fakeBuild();
    const flaky = async () => {
      if (fail) {
        build.runs += 1;
        return;
      }
      await build();
    };
    watcher = rebuildOnChange({ outDir, repoRoot: repo, build: flaky, debounceMs: 20 });
    await sleep(150);
    assert.equal(build.runs, 1, "the missing page is built at start");
    fail = false;
    editA("fixed");
    await sleep(200);
    assert.equal(build.runs, 2);
    // Recorded now: only recorded files rebuild it.
    writeFileSync(join(repo, "src/unrelated.ts"), "z");
    await sleep(200);
    assert.equal(build.runs, 2);
  });

  it("rebuilds when a failed build's fix is in a file no record names yet", async () => {
    // An edit imports a new module with an error: the build fails before recording it.
    // It sits beside a recorded file in another package's folder, outside the page's own src/.
    mkdirSync(join(repo, "lib"));
    writeFileSync(join(repo, "lib/b.ts"), "b");
    writeFileSync(join(outDir, "build-inputs.json"), JSON.stringify({ inputs: { "src/a.ts": hash(a), "lib/b.ts": hash("b") } }));
    let fail = false;
    const build = fakeBuild();
    const flaky = async () => {
      if (fail) {
        build.runs += 1;
        rmSync(join(outDir, "build-inputs.json"), { force: true });
        return;
      }
      await build();
    };
    watcher = rebuildOnChange({ outDir, repoRoot: repo, build: flaky, debounceMs: 20 });
    fail = true;
    editA("imports ./new");
    await sleep(200);
    assert.equal(build.runs, 1);
    fail = false;
    writeFileSync(join(repo, "lib/new.ts"), "fixed");
    await sleep(200);
    assert.equal(build.runs, 2);
  });
});
