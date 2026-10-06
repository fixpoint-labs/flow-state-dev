/**
 * Splits the workspace's test tasks into CI shards that run on separate runners.
 *
 * Each package's vitest already uses every core of its runner, so running two
 * packages at once on one runner oversubscribes it, and tests that cold-import
 * a module graph under a 5s timeout start failing. Separate runners add the
 * cores instead. Each shard runs its packages one at a time, as `pnpm test` does.
 *
 * The named shards hold the slowest packages, balanced by a serial run's time
 * (seconds noted beside each). The last shard is every other package, so a new
 * package is always tested somewhere without being listed here.
 *
 * Usage: `node scripts/test-shards.mjs <shard>` prints the `turbo --filter`
 * arguments for shard 1..N, one per line.
 */
import { globSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const NAMED_SHARDS = [
  [
    "@flow-state-dev/fsdev", // 101
    "@flow-state-dev/shift-manager", // 69
    "@flow-state-dev/kitchen-sink", // 36
    "@flow-state-dev/conductor", // 26
  ],
  [
    "@flow-state-dev/store-postgres", // 71
    "@flow-state-dev/workforce", // 61
    "@flow-state-dev/engine", // 38
    "@flow-state-dev/devtool", // 20
    "@flow-state-dev/orchestration", // 18
    "@flow-state-dev/store-sqlite", // 18
  ],
];

/** Every workspace member's package name, from the globs in pnpm-workspace.yaml. */
function workspaceNames(root) {
  const globs = readFileSync(resolve(root, "pnpm-workspace.yaml"), "utf8")
    .split("\n")
    .map((line) => /^\s*-\s*["']?([^"'#\s]+)/.exec(line)?.[1])
    .filter(Boolean);
  return globs.flatMap((glob) =>
    globSync(`${glob}/package.json`, { cwd: root }).map(
      (file) => JSON.parse(readFileSync(resolve(root, file), "utf8")).name
    )
  );
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const shard = Number(process.argv[2]);
const count = NAMED_SHARDS.length + 1;
if (!Number.isInteger(shard) || shard < 1 || shard > count) {
  console.error(`usage: test-shards.mjs <1..${count}>`);
  process.exit(2);
}

// A renamed or removed package would otherwise drop out of its shard silently
// and land in the last one, which unbalances the split without failing it.
const known = new Set(workspaceNames(root));
const unknown = NAMED_SHARDS.flat().filter((name) => !known.has(name));
if (unknown.length > 0) {
  console.error(`test-shards.mjs names packages the workspace does not have: ${unknown.join(", ")}`);
  process.exit(1);
}

const filters =
  shard <= NAMED_SHARDS.length
    ? NAMED_SHARDS[shard - 1].map((name) => `--filter=${name}`)
    : NAMED_SHARDS.flat().map((name) => `--filter=!${name}`);
console.log(filters.join("\n"));
