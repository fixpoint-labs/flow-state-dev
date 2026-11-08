#!/usr/bin/env node
/**
 * The collision assertion's strict run, for the adopter goal's `surface.collisions` cell.
 *
 * The assertion itself lives in the export check (`check-root-exports.mjs` → `collisions`),
 * which runs it as a ratchet on every PR. This entry runs it with no base: every name two
 * entries in scope export from different declarations is a violation, in the protocol the
 * goal judge reads (`runRatchet` in `packed-install/goal.mjs`):
 *
 *   node scripts/check-collisions.mjs --strict --json --root <tree>
 *
 * prints, as its last stdout line, `{ "violations": [{ "package", "name", "detail" }] }`, one
 * violation per entry that exports a colliding name. Without `--json` it prints one line per
 * collision. It exits 1 while any collision exists. `--root` defaults to this repository.
 */
import { resolve } from "node:path";
import { ROOT, collisions, describeCollision } from "./check-root-exports.mjs";
import { fsReader } from "./mechanism-exports.mjs";

const args = process.argv.slice(2);
const at = args.indexOf("--root");
const tree = at >= 0 ? resolve(args[at + 1]) : ROOT;
const found = collisions(fsReader(tree));

if (args.includes("--json")) {
  const violations = [...found].flatMap(([name, entries]) =>
    entries.map((e) => ({ package: e.entry.replace(/^(@[^/]+\/[^/]+).*$/, "$1"), name, detail: describeCollision(name, entries) })),
  );
  console.log(JSON.stringify({ violations }));
} else {
  for (const [name, entries] of found) console.log(describeCollision(name, entries));
  console.log(found.size ? `FAIL: ${found.size} collision(s)` : "PASS: no collisions");
}
process.exit(found.size ? 1 : 0);
