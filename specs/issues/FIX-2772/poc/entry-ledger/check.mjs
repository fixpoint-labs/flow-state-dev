// Retained spec evidence for FIX-2772, not production code: never imported, never run by `pnpm test`.
/**
 * Re-derives the spec's counted facts from Teammates' real allowlist: every
 * entry has exactly one owner in `owners.json`, no owner names an entry the
 * allowlist doesn't have, and this issue owns 22 entries, with three more
 * owned by whichever child moves the last `watchFeed` caller off
 * `session-feed.ts` (the coordinator's boundary rulings, 2026-11-17).
 *
 * Run from the repository root:
 *   node specs/issues/FIX-2772/poc/entry-ledger/check.mjs
 * Negative control (must exit 1, naming the planted entry):
 *   PLANT=1 node specs/issues/FIX-2772/poc/entry-ledger/check.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const allowlist = JSON.parse(readFileSync(here("../../../../../labs/teammates/test/inventory-allowlist.json"), "utf8"));
if (process.env.PLANT === "1") allowlist.push({ file: "src/app/planted.ts", symbol: "Planted", kind: "type" });
const owners = JSON.parse(readFileSync(here("./owners.json"), "utf8"));

const key = (file, symbol, kind) => `${file} · ${symbol} · ${kind}`;
const ownerOf = new Map();
const problems = [];
for (const [owner, entries] of Object.entries(owners)) {
  for (const [file, symbol, kind] of entries) {
    const k = key(file, symbol, kind);
    if (ownerOf.has(k)) problems.push(`${k}: owned twice (${ownerOf.get(k)} and ${owner})`);
    ownerOf.set(k, owner);
  }
}
const listed = new Set(allowlist.map((e) => key(e.file, e.symbol, e.kind)));
if (listed.size !== allowlist.length) problems.push("the allowlist has a duplicate entry");
// Totality: every allowlist entry has an owner.
for (const k of listed) if (!ownerOf.has(k)) problems.push(`${k}: on the allowlist, owned by nobody`);
// No stale owner rows.
for (const k of ownerOf.keys()) if (!listed.has(k)) problems.push(`${k}: owned, but not on the allowlist`);

const count = (owner) => (owners[owner] ?? []).length;
const t2 = count("t2");
const feedLast = count("the last child off watchFeed (session-feed.ts goes)");
if (t2 !== 22) problems.push(`t2 owns ${t2} entries, the spec says 22`);
if (feedLast !== 3) problems.push(`the last child off watchFeed owns ${feedLast} entries, the spec says 3`);

if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`OK · ${listed.size} entries, each owned once · t2 ${t2}`);
for (const owner of Object.keys(owners)) console.log(`  ${count(owner)} · ${owner}`);
