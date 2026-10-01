#!/usr/bin/env node
/**
 * FIX-1701 spec evidence: re-derives the factual base the spec rests on.
 *
 * Claim 1 (totality): outside `packages/core` and `packages/engine`, every
 * tracked non-test source file that reads `ctx._blockIdentity` is classified
 * below, either as one of the three harness emitters this issue changes or as
 * deliberately out of scope with a reason. An unclassified reader fails.
 *
 * Claim 2 (what each emitter stamps today): Claude Code reads only `taskId`
 * off the identity; Codex and Cursor read `taskId` and `ownedBy`.
 *
 * `AFTER=1` checks the post-extract state instead: none of the three emitters
 * reads `taskId` or `ownedBy` off the identity itself (they call the reader).
 *
 * Negative control: `PLANT=1` adds a synthetic unclassified reader to the
 * listing; the check must then exit non-zero.
 *
 * Run from the repo root: `node specs/issues/FIX-1701/poc/scope-readers/check.mjs`
 * Retained spec evidence, not production code; nothing discovers or runs it.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const IN_SCOPE = {
  "packages/claude-code/src/sdk/emit.ts": { reads: ["taskId"] },
  "packages/codex/src/emit.ts": { reads: ["taskId", "ownedBy"] },
  "packages/cursor/src/emit.ts": { reads: ["taskId", "ownedBy"] },
};
const OUT_OF_SCOPE = {
  "packages/claude-code/src/sdk/agent.ts": "reads blockPath and attempt, not item scope",
  "packages/orchestration/src/task-board/index.ts": "reads blockInstanceId for a worker name",
  "goals/shift-manager/it-shows-and-stops-a-task-run/lab/lab.mts":
    "a goal fixture's stand-in harness, not a shipped emitter",
};

const files = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mts)$/.test(f))
  .filter((f) => !/(^|\/)(test|tests|__tests__)\/|\.test\.|\.spec\.|^specs\/|^docs\//.test(f))
  .filter((f) => !/^packages\/(core|engine)\//.test(f));

const contents = new Map();
for (const f of files) {
  const text = readFileSync(f, "utf8");
  if (text.includes("_blockIdentity")) contents.set(f, text);
}
if (process.env.PLANT === "1") {
  contents.set("packages/planted/src/emit.ts", "const t = ctx._blockIdentity?.taskId;");
}

const failures = [];
for (const f of contents.keys()) {
  if (!(f in IN_SCOPE) && !(f in OUT_OF_SCOPE)) failures.push(`unclassified reader: ${f}`);
}
for (const f of [...Object.keys(IN_SCOPE), ...Object.keys(OUT_OF_SCOPE)]) {
  if (!contents.has(f)) failures.push(`classified file no longer reads _blockIdentity: ${f}`);
}
// What each emitter reads off the identity's scope, from its own casts.
for (const [f, { reads }] of Object.entries(IN_SCOPE)) {
  const text = contents.get(f) ?? "";
  const casts = text.match(/_blockIdentity\?:\s*\{[^}]*\}/g) ?? [];
  // A cast that names the field, or a direct property access off the identity.
  const seen = ["taskId", "ownedBy"].filter(
    (k) =>
      casts.some((c) => c.includes(`${k}?:`)) ||
      new RegExp(`(_blockIdentity|identity)\\??\\.${k}\\b`).test(text),
  );
  const want = process.env.AFTER === "1" ? [] : reads;
  if (seen.join() !== want.join()) failures.push(`${f}: reads [${seen}] want [${want}]`);
}

console.log(`readers outside core/engine: ${contents.size}`);
for (const f of contents.keys()) {
  const cls = f in IN_SCOPE ? `IN  reads ${IN_SCOPE[f].reads.join("+")}` : f in OUT_OF_SCOPE ? `OUT ${OUT_OF_SCOPE[f]}` : "??";
  console.log(`  ${cls}  ${f}`);
}
if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("PASS");
