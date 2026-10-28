/**
 * The workspace members pnpm sees, read from the globs in pnpm-workspace.yaml.
 *
 * One parser for every script that walks the workspace, so a layout change
 * cannot reach one of them and not another.
 */
import { globSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Each workspace member's package.json path, relative to `root`. */
export function workspaceManifests(root) {
  const globs = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8")
    .split("\n")
    .map((line) => /^\s*-\s*["']?([^"'#\s]+)/.exec(line)?.[1])
    .filter(Boolean);
  return globs.flatMap((glob) => globSync(`${glob}/package.json`, { cwd: root }));
}
