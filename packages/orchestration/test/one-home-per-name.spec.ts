/**
 * Guard: every task-substrate name has one home, `@flow-state-dev/orchestration/tasks`.
 *
 * The package root is Node-only (it reaches `node:fs` through skills), and `./tasks` is
 * the browser-safe entry the guard beside this file holds. When the root re-exported
 * every `./tasks` name, the docs mixed the two paths, and a root import copied into a
 * UI component broke that app's bundle in their build, not ours. So the root carries
 * skills and the Node-only seams, and no name the root exports is also on `./tasks`.
 *
 * Exports are read by the repo's one per-entry export index (`scripts/mechanism-exports.mjs`,
 * the same walk the export check reads), not by a second walker here.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fsReader, packageEntryExports, type Reader } from "../../../scripts/mechanism-exports.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../..");
const PKG = "@flow-state-dev/orchestration";
const ROOT_ENTRY = "packages/orchestration/src/index.ts";

/** Names exported from both `.` and `./tasks`, reading the tree through `read`. */
function sharedNames(read: Reader): string[] {
  const entries = packageEntryExports(read).get(PKG);
  if (!entries) throw new Error(`${PKG} not found in the export index`);
  const root = entries.get(".");
  const tasks = entries.get("./tasks");
  if (!root || !tasks) throw new Error(`${PKG} lost its "." or "./tasks" entry`);
  return [...root.keys()].filter((name) => tasks.has(name)).sort();
}

/** Names `entry` exports that one of `others` exports too, reading the tree through `read`. */
function namesOnBoth(read: Reader, entry: string, others: string[]): string[] {
  const entries = packageEntryExports(read).get(PKG);
  const mine = entries?.get(entry);
  if (!entries || !mine) throw new Error(`${PKG} has no "${entry}" entry`);
  return [...mine.keys()]
    .flatMap((name) => others.filter((o) => entries.get(o)?.has(name)).map((o) => `${name} (also on ${o})`))
    .sort();
}

/** The working tree, with `extra` appended to the root entry's source. */
function readerWithRootLine(extra: string): Reader {
  const base = fsReader(repoRoot);
  const read = ((p: string) => {
    const text = base(p);
    return p === ROOT_ENTRY && text != null ? `${text}\n${extra}\n` : text;
  }) as Reader;
  return Object.assign(read, { packageDirs: base.packageDirs, list: base.list, tracked: base.tracked, grep: base.grep });
}

describe("one home per name", () => {
  it("the root shares no name with ./tasks", () => {
    const shared = sharedNames(fsReader(repoRoot));
    expect(
      shared,
      `These names are exported from both the root and ./tasks:\n${shared.join("\n")}\n\n` +
        `A task-substrate name lives on ./tasks only. Export it from src/tasks/index.ts and ` +
        `import it from "${PKG}/tasks"; don't re-export it from src/index.ts.`
    ).toEqual([]);
  });

  it("the root and ./tasks share no name with ./task-board", () => {
    // `taskToolActions` lives on ./task-board; the task-turn test on the root.
    const shared = namesOnBoth(fsReader(repoRoot), "./task-board", [".", "./tasks"]);
    expect(shared, `Exported from ./task-board and another entry:\n${shared.join("\n")}`).toEqual([]);
  });

  it("./internal shares no name with a public entry", () => {
    // A name only our own packages read moves to ./internal; it does not stay public beside it.
    const shared = namesOnBoth(fsReader(repoRoot), "./internal", [".", "./tasks", "./task-board", "./inbox"]);
    expect(shared, `Exported from ./internal and a public entry:\n${shared.join("\n")}`).toEqual([]);
  });

  it("./internal is published, so a sibling's installed tarball resolves it", () => {
    // Workforce, harness-manager and patterns import it at runtime. An entry left out of
    // `publishConfig.exports` passes every workspace test and fails on first install.
    const manifest = JSON.parse(readFileSync(path.join(repoRoot, "packages/orchestration/package.json"), "utf8"));
    expect(Object.keys(manifest.exports)).toContain("./internal");
    expect(manifest.publishConfig.exports["./internal"]).toEqual({
      types: "./dist/internal.d.ts",
      default: "./dist/internal.js",
    });
  });

  it("would see a ./tasks name the root re-exports", () => {
    // Proves the check above can fail: the root's old `export * from "./tasks"`, put
    // back in memory, must show up as shared names. An index that stopped following
    // the root's re-exports would report nothing and pass above for free.
    expect(sharedNames(readerWithRootLine(`export * from "./tasks";`))).toContain("defineTaskCollection");
    expect(sharedNames(readerWithRootLine(`export { taskSchema } from "./tasks";`))).toEqual(["taskSchema"]);
  });
});
