#!/usr/bin/env node
/**
 * FIX-1790 key-shape check: can the per-(user, org) keys ever name a cell an
 * older release wrote, or each other's?
 *
 * Two premises the plan rests on:
 *
 *   1. Disjoint from the past. No new key equals a key an older release wrote
 *      (the one-part cross-org key, the two-part flow-isolated key). If that
 *      holds, an old cell is unreachable by construction: the runtime needs no
 *      guard, no fallback and no refusal to keep it from reading in two orgs.
 *   2. Injective. Two different (user, org) or (user, org, flow) tuples never
 *      share a key, including ids carrying `:`, `\` or the literal `~org`.
 *
 * And one convenience it confirms: the shared key is byte-identical to the
 * owner-pinned cell FIX-1538 already writes, so a hired worker's shared data does not
 * move.
 *
 * The encoder below mirrors `encodeScopeKeyComponent` in
 * `packages/engine/src/stores/scope-keys.ts` (escape `\` and `:` with `\`). It
 * is a sketch of the proposed shapes, not the implementation.
 *
 * Exhaustive over every id of length 0–3 from a small alphabet that includes
 * the delimiter, the escape and the marker's characters, plus the marker itself
 * as a whole id.
 *
 * Negative control: `--plant` joins the flow-isolated key without the marker
 * (`<user>:<org>:<flow>`). That form must collide with the shared form for an
 * org id of `~org`, and the check must FAIL.
 *
 * Retained design evidence. Not wired into CI or any default discovery. Run
 * from the repo root:
 *
 *   node specs/issues/FIX-1790/poc/key-shape/check.mjs
 *   node specs/issues/FIX-1790/poc/key-shape/check.mjs --plant   # must exit 1
 */

const enc = (value) => value.replace(/[\\:]/g, "\\$&");

/** Today's forms, which stay on disk until an operator moves them. */
const legacyShared = (user) => enc(user);
const legacyIsolated = (user, flow) => `${enc(user)}:${enc(flow)}`;
/** FIX-1538's owner-pinned cell, written today for hired workers. */
const pinnedShared = (user, org) => `${enc(user)}:~org:${enc(org)}`;

/** The proposed forms. */
const plant = process.argv.includes("--plant");
const nextShared = (user, org) => `${enc(user)}:~org:${enc(org)}`;
const nextIsolated = plant
  ? (user, org, flow) => `${enc(user)}:${enc(org)}:${enc(flow)}`
  : (user, org, flow) => `${enc(user)}:~org:${enc(org)}:${enc(flow)}`;

const ALPHABET = ["a", ":", "\\", "~", "o"];
const ids = new Set(["", "~org", "~org:a", "a:~org"]);
const grow = (prefix, depth) => {
  ids.add(prefix);
  if (depth === 0) return;
  for (const ch of ALPHABET) grow(prefix + ch, depth - 1);
};
grow("", 3);
const nonEmpty = [...ids].filter((id) => id.length > 0);

const problems = [];
const owner = new Map();
const claim = (key, who) => {
  const prior = owner.get(key);
  if (prior !== undefined && prior !== who) {
    if (problems.length < 5) problems.push(`COLLISION ${JSON.stringify(key)}: ${prior} vs ${who}`);
    else problems.push(null);
  }
  owner.set(key, who);
};

// Every key an older release could have written.
for (const u of nonEmpty) {
  claim(legacyShared(u), `legacy-shared(${JSON.stringify(u)})`);
  for (const f of nonEmpty) claim(legacyIsolated(u, f), `legacy-isolated(${JSON.stringify(u)},${JSON.stringify(f)})`);
}
const legacyCount = owner.size;

// Every key the proposed forms write. A collision with a legacy key or with
// another tuple is a failure.
let pinnedSame = 0;
let pinnedChecked = 0;
for (const u of nonEmpty) {
  for (const o of nonEmpty) {
    const shared = nextShared(u, o);
    claim(shared, `shared(${JSON.stringify(u)},${JSON.stringify(o)})`);
    pinnedChecked += 1;
    if (pinnedShared(u, o) === shared) pinnedSame += 1;
    for (const f of nonEmpty) {
      claim(nextIsolated(u, o, f), `isolated(${JSON.stringify(u)},${JSON.stringify(o)},${JSON.stringify(f)})`);
    }
  }
}

console.log(`ids per component: ${nonEmpty.length}`);
console.log(`legacy keys: ${legacyCount}; proposed keys: ${owner.size - legacyCount}`);
console.log(`shared key equals FIX-1538's pinned cell: ${pinnedSame}/${pinnedChecked}`);

if (pinnedSame !== pinnedChecked) problems.push("the shared key differs from the pinned cell for some (user, org)");
if (problems.length > 0) {
  const shown = problems.filter((p) => p !== null);
  console.log(`\nFAIL — ${problems.length} problem(s):`);
  for (const p of shown) console.log(`  ${p}`);
  process.exit(1);
}
console.log("\nPASS — no proposed key names a legacy cell or another tuple's cell.");
