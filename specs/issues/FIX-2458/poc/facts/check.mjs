#!/usr/bin/env node
// Retained spec evidence, not production code. Re-derives the counted facts
// the harness-contract spec rests on, from the source on the current checkout.
//
//   node --experimental-transform-types specs/issues/FIX-2458/poc/facts/check.mjs            # print the facts, assert today's shape
//   node --experimental-transform-types specs/issues/FIX-2458/poc/facts/check.mjs --control  # plant an unclassified name, expect exit 1
//
// Exit 0: every assertion below holds. Exit 1: one failed, named.
// Needs only Node 22 (its TypeScript transform, for the error classes); no install.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execSync } from "node:child_process";

const ROOT = execSync("git rev-parse --show-toplevel", { cwd: dirname(fileURLToPath(import.meta.url)) })
  .toString()
  .trim();
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const CONTROL = process.argv.includes("--control");
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};

// ── 1 · public entries and the names they export ─────────────────────────────
const ENTRIES = {
  "claude-code/sdk": "packages/claude-code/src/sdk/index.ts",
  "claude-code/cli": "packages/claude-code/src/cli/index.ts",
  codex: "packages/codex/src/index.ts",
  cursor: "packages/cursor/src/index.ts",
};
/** Names exported from an entry file: `export { a, type B } from` and `export type { … }`. */
function exportedNames(src) {
  const names = [];
  for (const m of src.matchAll(/export\s+(?:type\s+)?\{([^}]*)\}/g)) {
    for (const raw of m[1].split(",")) {
      const n = raw.replace(/\/\/.*$/gm, "").trim().replace(/^type\s+/, "").split(/\s+as\s+/).pop().trim();
      if (n) names.push(n);
    }
  }
  return names;
}
const exportsOf = Object.fromEntries(Object.entries(ENTRIES).map(([k, p]) => [k, exportedNames(read(p))]));
if (CONTROL) exportsOf["claude-code/sdk"].push("plantedUnclassifiedName");

const cc = [...exportsOf["claude-code/sdk"], ...exportsOf["claude-code/cli"]];
console.log("exported names:", Object.fromEntries(Object.entries(exportsOf).map(([k, v]) => [k, v.length])));
console.log("claude-code total:", cc.length);
check(cc.length >= 75 && cc.length <= 90, `claude-code exports ~80 names (got ${cc.length})`);

// ── 2 · claude-code's naming: every name is classified (totality) ────────────
// Classes are the spellings in use; each name falls into exactly one.
const CLASSES = [
  ["ClaudeCode / claudeCode / CLAUDE_CODE_", /^(ClaudeCode|claudeCode|CLAUDE_CODE_|createClaudeCode|checkClaudeCode)/],
  ["ClaudeAgent / claudeAgent", /^(ClaudeAgent|claudeAgent|createClaudeAgent|defaultResolveClaudeAgent|createDefaultResolveClaudeAgent|ResolveClaudeAgent|ResolvedClaudeAgent)/],
  ["Claude / CLAUDE_ (bare)", /^(Claude|CLAUDE_|listClaude|probeClaude|readClaude|ListClaude|ProbeClaude|ReadClaude|defaultResolveClaudeCli|defaultClaudeCliExec|ResolveClaudeCli|ResolvedClaudeCli)/],
  ["Sdk / SDK_ / sdk", /^(Sdk|SDK_|sdk)/],
  ["generic (no harness prefix)", /^(run|create(Translate|Emit|WorkRecorder|WorkspaceAgent)|drain|translate|emit|close|finalize|Translate|Emit|Translated|ToolApproval|OBSERVED_|observed|Observed|workRecorder|WorkRecorder|canonical|Upsertable|usageWindowOf|WORKSPACE_|workspace|Workspace|containment|SandboxSettings)/],
];
const classified = {};
const unclassified = [];
for (const n of cc) {
  const hit = CLASSES.find(([, re]) => re.test(n));
  if (!hit) unclassified.push(n);
  else (classified[hit[0]] ??= []).push(n);
}
console.log("claude-code naming classes:", Object.fromEntries(Object.entries(classified).map(([k, v]) => [k, v.length])));
check(unclassified.length === 0, `every claude-code export is classified (unclassified: ${unclassified.join(", ")})`);
const prefixed = ["ClaudeCode / claudeCode / CLAUDE_CODE_", "ClaudeAgent / claudeAgent", "Claude / CLAUDE_ (bare)", "Sdk / SDK_ / sdk"].filter(
  (k) => (classified[k] ?? []).length > 0,
);
check(prefixed.length >= 3, `claude-code mixes at least three harness prefixes (got ${prefixed.length})`);

// ── 3 · names shared by two or more harness entries (installed-name collisions) ─
const owners = new Map();
for (const [entry, names] of Object.entries(exportsOf)) {
  const pkg = entry.split("/")[0];
  for (const n of names) owners.set(n, new Set([...(owners.get(n) ?? []), pkg]));
}
const shared = [...owners].filter(([, s]) => s.size > 1).map(([n, s]) => `${n} (${[...s].join(", ")})`);
console.log("names in two or more harness packages:", shared.length, shared);
check(shared.length >= 8, `at least 8 names are exported by two or more harness packages (got ${shared.length})`);

// ── 4 · error classes per package ────────────────────────────────────────────
const ERRORS = {
  "claude-code": "packages/claude-code/src/sdk/errors.ts",
  codex: "packages/codex/src/errors.ts",
  cursor: "packages/cursor/src/errors.ts",
};
const classesOf = Object.fromEntries(
  Object.entries(ERRORS).map(([k, p]) => [k, [...read(p).matchAll(/export class (\w+) extends Error/g)].map((m) => m[1])]),
);
console.log("error classes:", classesOf);
check(classesOf.codex.length === 5 && classesOf.cursor.length === 5 && classesOf["claude-code"].length === 2, "error classes are 5 / 5 / 2");

// ── 5 · the failure-kind union in core ───────────────────────────────────────
const kindSrc = read("packages/core/src/types/harness.ts").match(/export type HarnessFailureKind =([^;]*);/)[1];
const kinds = [...kindSrc.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
console.log("HarnessFailureKind:", kinds);
check(kinds.length === 1 && kinds[0] === "unknown-conversation", "HarnessFailureKind has one member");

// ── 6 · is each harness's abort recognised by core's isAbortLike? ────────────
const { isAbortLike } = await import(pathToFileURL(join(ROOT, "packages/core/src/errors/abort.ts")).href);
const codexErr = await import(pathToFileURL(join(ROOT, ERRORS.codex)).href);
const cursorErr = await import(pathToFileURL(join(ROOT, ERRORS.cursor)).href);
const ctl = new AbortController();
ctl.abort();
const aborts = {
  codex: isAbortLike(new codexErr.CodexAgentAbortedError(null)),
  cursor: isAbortLike(new cursorErr.CursorAgentAbortedError(null)),
  // claude-code rejects with the signal's own reason (agent.ts rejectOnAbort).
  "claude-code": isAbortLike(ctl.signal.reason ?? new DOMException("x", "AbortError")),
};
console.log("isAbortLike(the harness's abort):", aborts);
check(aborts.codex === false && aborts.cursor === false && aborts["claude-code"] === true, "abort is abort-like for claude-code only");

// ── 7 · environment pass lists ───────────────────────────────────────────────
const passOf = (p, name) => {
  const m = read(p).match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`));
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
};
const pass = {
  "claude-code": passOf("packages/claude-code/src/sdk/env-pass.ts", "CLAUDE_CODE_PASS"),
  codex: passOf("packages/codex/src/env-pass.ts", "CODEX_PASS"),
  cursor: passOf("packages/cursor/src/env-pass.ts", "CURSOR_PASS"),
};
const common = pass.codex.filter((n) => pass.cursor.includes(n) && pass["claude-code"].includes(n));
console.log("pass-list sizes:", Object.fromEntries(Object.entries(pass).map(([k, v]) => [k, v.length])), "common to all three:", common.length, common);
check(common.length === 13, `13 names are common to the three pass lists (got ${common.length})`);

// ── 8 · SDK version policy ───────────────────────────────────────────────────
const peer = (p) => JSON.parse(read(`packages/${p}/package.json`)).peerDependencies;
const peers = { "claude-code": peer("claude-code"), codex: peer("codex"), cursor: peer("cursor") };
console.log("peer ranges:", peers);
check(peers["claude-code"]["@anthropic-ai/claude-agent-sdk"] === "*", "claude-code peers the SDK at *");
check(/^\d+\.\d+\.\d+$/.test(peers.codex["@openai/codex-sdk"]) && /^\d+\.\d+\.\d+$/.test(peers.cursor["@cursor/sdk"]), "codex and cursor exact-pin");

// ── 9 · model lists ──────────────────────────────────────────────────────────
check(existsSync(join(ROOT, "packages/codex/src/model-list.ts")) && existsSync(join(ROOT, "packages/claude-code/src/sdk/model-list.ts")), "codex and claude-code list models");
check(!existsSync(join(ROOT, "packages/cursor/src/model-list.ts")), "cursor has no model list");
check(/const CURSOR_MODELS/.test(read("apps/kitchen-sink/lib/cursor-mode.ts")), "kitchen-sink keeps Cursor's list by hand");
check(/can't list models/.test(read("packages/codex/README.md")), "the codex README says the SDK can't list models");

// ── 10 · the ./cli subpath has no consumer outside its own directory and test ─
const cliHits = execSync(
  "git grep -l -E 'defaultResolveClaudeCli|defaultClaudeCliExec|claude-code/cli\\b' -- packages apps examples goals labs ':!*CHANGELOG.md' || true",
  { cwd: ROOT },
)
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean)
  .filter((f) => !f.startsWith("packages/claude-code/src/cli/") && f !== "packages/claude-code/test/resolve-cli.spec.ts" && f !== "packages/claude-code/README.md");
console.log("./cli consumers outside itself:", cliHits);
check(cliHits.length === 0, "./cli has no outside consumer");

if (failures.length) {
  console.error("\nFAIL:\n  " + failures.join("\n  "));
  process.exit(1);
}
console.log("\nPASS: every fact holds on this checkout.");
