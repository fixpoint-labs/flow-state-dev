#!/usr/bin/env node
/**
 * The tracker-id lint's strict run, for the adopter goal's `leakage.tracker-ids` cell.
 *
 * `pnpm lint` runs `fsd/no-tracker-ids` (`eslint-rules/no-tracker-ids.mjs`) on every PR. This
 * entry runs the same config over another tree, with only that rule and with no suppressions,
 * in the protocol the goal judge reads (`runRatchet` in `packed-install/goal.mjs`):
 *
 *   node scripts/check-tracker-ids.mjs --strict --json --root <tree>
 *
 * prints, as its last stdout line, `{ "violations": [{ "package", "name", "detail" }] }`: one
 * violation per site, `package` being the nearest `package.json`'s name and `name` the site's
 * `file:line`. Without `--json` it prints one line per site. It exits 1 while any site exists.
 * It is always strict: suppressions are `pnpm lint`'s, never this script's. `--root` defaults to
 * this repository.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RULE = "fsd/no-tracker-ids";

/** The name in the nearest `package.json` at or above `file`, inside `tree`. */
function packageOf(tree, file) {
  for (let dir = dirname(file); dir.startsWith(tree) && dir !== dirname(tree); dir = dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, "utf8")).name ?? relative(tree, dir);
  }
  return relative(tree, dirname(file));
}

const args = process.argv.slice(2);
const at = args.indexOf("--root");
const tree = resolve(at >= 0 ? args[at + 1] : ROOT);

const eslint = new ESLint({
  cwd: tree,
  overrideConfigFile: join(ROOT, "eslint.config.mjs"),
  ruleFilter: ({ ruleId }) => ruleId === RULE,
  cache: false,
  errorOnUnmatchedPattern: false,
});
const results = await eslint.lintFiles(["."]);

const violations = results.flatMap((result) =>
  result.messages
    .filter((m) => m.ruleId === RULE)
    .map((m) => ({
      package: packageOf(tree, result.filePath),
      name: `${relative(tree, result.filePath)}:${m.line}`,
      detail: m.message,
    })),
);

if (args.includes("--json")) console.log(JSON.stringify({ violations }));
else {
  for (const v of violations) console.log(`${v.name}  ${v.detail}`);
  console.log(violations.length ? `FAIL: ${violations.length} tracker id(s)` : "PASS: no tracker ids");
}
process.exit(violations.length ? 1 : 0);
