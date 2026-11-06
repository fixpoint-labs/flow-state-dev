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

  it("would see a ./tasks name the root re-exports", () => {
    // Proves the check above can fail: the root's old `export * from "./tasks"`, put
    // back in memory, must show up as shared names. An index that stopped following
    // the root's re-exports would report nothing and pass above for free.
    expect(sharedNames(readerWithRootLine(`export * from "./tasks";`))).toContain("defineTaskCollection");
    expect(sharedNames(readerWithRootLine(`export { taskSchema } from "./tasks";`))).toEqual(["taskSchema"]);
  });
});
