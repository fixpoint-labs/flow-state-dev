#!/usr/bin/env node
// FIX-2421 POC (throwaway). Re-derives the spec's factual base from the code:
// every app host that builds a harness block, what each passes for `settingSources`
// and `env`, and every copy of a Cursor pass-list outside the cursor package.
//
// Totality: every non-test TypeScript file under apps/, labs/ and packages/shift-manager that
// calls claudeCodeAgent( / codexAgent( / cursorAgent( must be in EXPECTED, and every
// EXPECTED file must still call one. A new host fails the check until it is classified.
//
// Negative control: FACTS_PLANT=1 plants an unclassified call site under labs/ and the
// check must exit non-zero.
//   node specs/issues/FIX-2421/poc/project-settings-hooks/facts.mjs
//   FACTS_PLANT=1 node specs/issues/FIX-2421/poc/project-settings-hooks/facts.mjs   # must FAIL
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const EXPECTED = {
  "apps/kitchen-sink/lib/claude-code-mode.ts": "settingSources [] · CLAUDE_CODE_PASS",
  "apps/kitchen-sink/lib/codex-mode.ts": "every MCP server disabled · CODEX_PASS",
  "apps/kitchen-sink/lib/cursor-mode.ts": "settingSources unset (Cursor: none) · own CURSOR_PASS",
  "labs/teammates/host.mts": "claude-code [project], hooks on · own CURSOR_PASS copy",
  "labs/claude-code-style/workforce/flows/harness-thread.mts": "unset (Claude Code: all) · no env",
  "labs/fsd-coding-skill/src/flow.ts": "caller's options · sandboxed",
  "packages/shift-manager/teams/devteam/harness.mts": "unset (all, hooks and user settings) · CLAUDE_CODE_PASS",
};

const plant = process.env.FACTS_PLANT === "1" ? "labs/_facts-plant/host.mts" : null;
if (plant) { mkdirSync("labs/_facts-plant", { recursive: true }); writeFileSync(plant, "claudeCodeAgent({});\n"); }
let failed = false;
try {
  const found = execFileSync("git", ["grep", "-lE", "(claudeCodeAgent|codexAgent|cursorAgent)\\(", "--", "apps/*.ts", "apps/*.tsx", "apps/*.mts", "labs/*.ts", "labs/*.mts", "packages/shift-manager/*.ts", "packages/shift-manager/*.mts"], { encoding: "utf8" })
    .split("\n").filter(Boolean).filter((f) => !/(^|\/)test\/|\.test\./.test(f));
  const untracked = plant ? [plant] : [];
  const all = [...new Set([...found, ...untracked])];
  for (const f of all) if (!(f in EXPECTED)) { console.log(`UNCLASSIFIED host: ${f}`); failed = true; }
  for (const f of Object.keys(EXPECTED)) if (!all.includes(f)) { console.log(`GONE: ${f}`); failed = true; }
  for (const f of Object.keys(EXPECTED).filter((f) => all.includes(f))) {
    const src = readFileSync(f, "utf8");
    const ss = [...src.matchAll(/settingSources:\s*(\[[^\]]*\])/g)].map((m) => m[1]).join(" ") || "unset";
    console.log(`${f}\n    settingSources: ${ss} · env: ${/env:/.test(src) ? "set" : "none"} · spec says: ${EXPECTED[f]}`);
  }
  const copies = execFileSync("git", ["grep", "-lE", "CURSOR_PASS = \\[", "--", ":!packages/cursor", ":!specs"], { encoding: "utf8" }).split("\n").filter(Boolean);
  console.log(`CURSOR_PASS lists outside the cursor package: ${copies.length} (${copies.join(", ")})`);
  if (copies.length !== 2) failed = true;
  const pkg = execFileSync("git", ["grep", "-c", "CURSOR_PASS", "--", "packages/cursor/src"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  if (pkg !== "") { console.log(`the cursor package already names CURSOR_PASS: ${pkg}`); failed = true; }
} catch (error) {
  // git grep exits 1 when it finds nothing: that is the cursor package naming no CURSOR_PASS.
  if (error.status !== 1) throw error;
} finally {
  if (plant) rmSync("labs/_facts-plant", { recursive: true, force: true });
}
console.log(failed ? "FAIL" : "PASS");
process.exit(failed ? 1 : 0);
