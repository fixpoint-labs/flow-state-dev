/**
 * FIX-1358 — the atlas tree teach, checked against the shipped readers.
 *
 * The factual base this spec rests on is a counted one: *which* slots the
 * workforce tree actually has, and which of them the atlas draws. A hand-derived
 * list of those does not converge — each review round corrects one row and
 * leaves the ones nobody looked at. So it is derived here instead, from the two
 * sources, and compared.
 *
 * TOTALITY. It does not check the slots it knows about; it asserts that EVERY
 * slot on each side is accounted for on the other, or is named in EXCEPTIONS
 * with a reason. A slot nobody listed still fails the run.
 *
 * NEGATIVE CONTROL. Run with `--plant` and it inserts a slot into the atlas
 * text that no reader backs. The run must go red. A green check nobody has
 * watched fail is not evidence (tenet 7).
 *
 * Run:
 *   node spec-poc/FIX-1358-atlas-honesty/tree-teach-check.mjs
 *   node spec-poc/FIX-1358-atlas-honesty/tree-teach-check.mjs --plant
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ATLAS = path.join(repo, "docs/atlas/workforce.html");
const LOADER = path.join(repo, "packages/workforce/src/loader");

/**
 * Slots that are deliberately on one side only. Every entry needs a reason, and
 * an entry whose reason has expired is the thing this table exists to surface.
 */
const EXCEPTIONS = {
  "org/channels": "Locked open by FIX-1351 D3, no reader walks it. The epic's own set table claims it ships; scope-reach.mjs refutes that. The atlas teaches it as a named gap, so it is taught without being reader-backed.",
  "teams/<id>/workers/<name>/resources": "FIX-1368, backlog. Drawn in the tree today with no reader; must carry a proposed tag.",
  "teams/<id>/TEAM.md": "FIX-1377, backlog. Owner + Architect stamp 2026-09-12 asks for the tree teach; proposed tag.",
  "org/workers": "D7 — locked open, unowned, UNTAUGHT until a reader exists (ER-13). Must appear on neither side.",
};

const args = new Set(process.argv.slice(2));
const failures = [];
function check(label, ok, detail) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `\n        ${detail}` : ""}`);
  if (!ok) failures.push(label);
}

// ---------------------------------------------------------------------------
// 1. What the shipped readers walk, derived from their source.
// ---------------------------------------------------------------------------

/**
 * The path expressions a reader actually opens, read off its source and written
 * in the tree notation the atlas draws.
 *
 * Derived rather than listed: a hand-kept list is exactly the artefact that goes
 * stale between the reader moving and anyone noticing. `teams/` and `org/` are
 * dropped on the way out — they are structure the slots hang off, not slots.
 */
async function readerSlots() {
  const found = new Set();
  const files = [
    "read-channels-directory.ts",
    "read-resources-directory.ts",
    "read-seat-skills.ts",
    "read-workforce-directory.ts",
  ];
  for (const file of files) {
    const src = await readFile(path.join(LOADER, file), "utf8");
    const slot = src.match(/const\s+[A-Z_]+_SLOT\s*=\s*"([^"]+)"/)?.[1];
    const manifest = src.match(/const\s+[A-Z_]+_MD\s*=\s*"([^"]+\.md)"/i)?.[1];

    // `path.join(root, "org", X_SLOT)` — the org door.
    if (slot && /path\.join\(root,\s*"org",\s*[A-Z_]+_SLOT\)/.test(src)) {
      found.add(`org/${slot}`);
    }
    // `path.join(teamDir, X_SLOT)` — the team door.
    if (slot && /path\.join\(teamDir,\s*[A-Z_]+_SLOT\)/.test(src)) {
      found.add(`teams/<id>/${slot}`);
      if (manifest) found.add(`teams/<id>/${slot}/<name>/${manifest}`);
    }
    // `path.join(teamDir, "workers")` — the seat door.
    if (/path\.join\(teamDir,\s*"workers"\)/.test(src)) {
      found.add("teams/<id>/workers/<name>");
      if (manifest) found.add(`teams/<id>/workers/<name>/${manifest}`);
    }
    // An explicit level array, as read-seat-skills keeps: the levels it walks
    // are written out in one place, so read them from there.
    const levels = src.match(/for \(const level of \[([\s\S]*?)\]\)/)?.[1];
    if (levels) {
      for (const m of levels.matchAll(/["`]([^"`]+)["`]/g)) {
        found.add(
          m[1]
            .replace(/\$\{team\}/g, "<id>")
            .replace(/\$\{worker\}/g, "<name>"),
        );
      }
    }
  }
  found.delete("org");
  found.delete("teams");
  return found;
}

// ---------------------------------------------------------------------------
// 2. What the atlas §06 tree figure draws.
// ---------------------------------------------------------------------------

/**
 * The slots the §06 tree figure draws, read off the figure itself.
 *
 * The figure is positioned text, so nesting lives in the `x` coordinate rather
 * than in any markup: a label indented further is a child of the last label
 * drawn to its left. That is read as a stack, which is why a slot moved under a
 * different parent changes the derived path instead of going unnoticed.
 */
async function atlasSlots(html) {
  // Pinned by aria-label rather than by line number, so an edit anywhere above
  // it does not silently move the window this reads.
  const svg = html.match(/<svg[^>]*aria-label="[^"]*[Ff]ile tree[^"]*"[\s\S]*?<\/svg>/);
  if (!svg) return { slots: null, reason: "no §06 tree figure found by its aria-label" };

  const entries = [...svg[0].matchAll(/<text[^>]*\sx="(\d+)"[^>]*>([^<]*)<\/text>/g)].map((m) => ({
    x: Number(m[1]),
    label: m[2].replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#183;/g, "·").trim(),
  }));

  const PATHISH = /^([a-z]+\/|[a-z]+\/<[a-zA-Z]+>\/|(WORKER|CHANNEL|TEAM|SKILL)\.md|teams\/<teamId>\/)$/;
  const slots = new Set();
  /** @type {{x: number, path: string}[]} */
  const stack = [];

  for (const { x, label } of entries) {
    if (!PATHISH.test(label)) continue;
    // A right column of the same figure is annotation, not tree.
    if (x > 500) continue;

    while (stack.length && x <= stack[stack.length - 1].x) stack.pop();
    const parent = stack.length ? `${stack[stack.length - 1].path}/` : "";
    const segment = label.replace(/^teams\/<teamId>\/$/, "teams/<id>").replace(/\/$/, "");
    const full = `${parent}${segment}`;
    slots.add(full);
    if (!label.endsWith(".md")) stack.push({ x, path: full });
  }

  slots.delete("org");
  slots.delete("teams/<id>");
  return { slots, reason: null };
}

// ---------------------------------------------------------------------------
// 3. The two claims.
// ---------------------------------------------------------------------------

let html = await readFile(ATLAS, "utf8");

if (args.has("--plant")) {
  // The negative control: a slot no reader backs and no exception covers,
  // inserted into the tree figure exactly as a real one would be drawn.
  html = html.replace(
    '<text class="t-xs" x="58" y="102">skills/</text>',
    '<text class="t-xs" x="58" y="102">skills/</text>\n        <text class="t-xs" x="58" y="120">playbooks/</text>',
  );
  console.log("PLANTED  org/playbooks — the run below must go red.\n");
}

// Claim A — the issue's own base, re-derived. It was written against a commit
// where ten W3-facing restatements listed rooms and L2 channels as two declared
// things. Nine of those lines have since been rewritten on main.
const dual = [...html.matchAll(/^.*(rooms?[^<>\n]{0,40}L2 channels?|L2 channels?[^<>\n]{0,40}rooms?).*$/gim)];
check(
  "no W3-facing line presents rooms and L2 channels as two declared things",
  dual.length === 0,
  dual.length ? dual.map((m) => `  ${m[0].slice(0, 120)}`).join("\n") : "the issue's ten restatements are down to zero",
);

// Claim B — totality, both directions.
const readers = await readerSlots();
const { slots: drawn, reason } = await atlasSlots(html);

console.log("\nreader-backed slots :", [...readers].sort().join("  "));
console.log("atlas-drawn slots   :", drawn ? [...drawn].sort().join("  ") : `(${reason})`);
console.log();

if (!drawn) {
  check("the §06 tree figure is findable", false, reason);
} else {
  const unbacked = [...drawn].filter((s) => !readers.has(s) && !EXCEPTIONS[s]);
  check(
    "every slot the atlas draws is reader-backed or a declared exception",
    unbacked.length === 0,
    unbacked.length ? `drawn with nothing behind it: ${unbacked.join(", ")}` : undefined,
  );

  const untaught = [...readers].filter((s) => !drawn.has(s) && !EXCEPTIONS[s]);
  check(
    "every slot a shipped reader walks is drawn in the atlas",
    untaught.length === 0,
    untaught.length ? `ships but is not taught: ${untaught.join(", ")}` : undefined,
  );

  check(
    "org/workers is taught nowhere (D7 · ER-13)",
    !drawn.has("org/workers"),
  );
}

console.log(`\n${failures.length === 0 ? "ALL CHECKS HELD" : `${failures.length} CHECK(S) FAILED`}`);
process.exit(failures.length === 0 ? 0 : 1);
