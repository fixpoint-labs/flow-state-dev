#!/usr/bin/env node
/**
 * FIX-1812 sweep checker (retained spec evidence, not production code).
 *
 * Finds every `sequencer({...})` in tracked TS sources and in the ts/tsx code
 * fences of tracked Markdown, and classifies it:
 *   - rename   — the config has a `description` (the model reads it) and the
 *                chain is exactly one `.step(block)`: a wrapper whose only job
 *                is to present a block under another name. Replace with `.as()`.
 *   - kept     — has a `description` but its chain carries more than the one
 *                step (a tap, connector, rescue…). Real behaviour; left alone.
 *   - root     — no `description`: an action root or harness structure, never
 *                shown to a model as a tool. Out of scope; counted only.
 *
 * Totality: every `rename` and `kept` site must appear in EXPECTED below, and
 * every EXPECTED entry must still be found. Exit 1 on any mismatch.
 *
 * Usage: node specs/issues/FIX-1812/poc/sweep/sweep.mjs [repoRoot] [--control]
 *
 * --control plants an unlisted described one-step wrapper and a stale EXPECTED
 * entry, and passes only if the check reports both (prints CONTROL PASS).
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const args = process.argv.slice(2);
const control = args.includes("--control");
const root = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".");
const require = createRequire(path.join(root, "packages/core/package.json"));
const ts = require("typescript");

/**
 * file → sequencer name → [expected class, reason]. Canonical site list; PLAN → Sites mirrors it.
 * The `rename` sites were replaced with `.as()` (or, for an inline-built block, its own name) and
 * left this list; a described one-step wrapper that reappears fails as unlisted.
 */
const EXPECTED = {
  "packages/shift-manager/teams/devteam/host.mts": {
    createProject: ["kept", "approval tapIf before the write"],
    setRepository: ["kept", "approval tap before the write"],
    fire: ["kept", "approval tap before the write"],
  },
  "packages/workforce/src/mailbox-post-capability.ts": {
    "post-to-mailbox": ["kept", "signs, routes and maps the result"],
  },
  "apps/docs/docs/workforce/chief-of-staff.md": {
    fire: ["kept", "approval tap before the write"],
  },
  "packages/workforce/README.md": {
    fire: ["kept", "approval tap before the write"],
  },
  // Kept: the wrapper does more than rename.
  "apps/kitchen-sink/workforce/blocks/escalate.ts": { escalate: ["kept", "branches"] },
  "labs/fsd-coding-skill/src/flow.ts": { name: ["kept", "input connector"] },
  "packages/claude-code/src/sdk/workspace.ts": { name: ["kept", "taps around the step"] },
  "packages/integration-tests/src/scenarios/fixtures/artifact-flow.ts": { "write-artifact": ["kept", "tap"] },
  "packages/memory/src/tools/recall-tool.ts": { "memory/recall": ["kept", "steps, stepIf and rescue"] },
  "packages/orchestration/src/skills/delegation-surface.ts": { RUN_BOARD_TOOL_NAME: ["kept", "two steps"] },
  "packages/tools/src/bash/blocks.ts": {
    bash: ["kept", "cold sandbox setup"],
    "bash-read-file": ["kept", "cold sandbox setup"],
    "bash-write-file": ["kept", "cold sandbox setup"],
  },
  // Rename-shaped, but kept: these tests are about a sequencer used as a tool.
  "packages/core/test/flow-config.test.ts": {
    "nested-tool": ["kept-shape", "test subject is a sequencer tool"],
    "static-nested-tool": ["kept-shape", "test subject is a sequencer tool"],
  },
};

const files = execSync("git ls-files '*.ts' '*.mts' '*.tsx' '*.md' '*.mdx'", { cwd: root })
  .toString().trim().split("\n")
  .filter((f) => !/(^|\/)(node_modules|dist)\//.test(f) && !f.startsWith("specs/"));

const literalName = (cfg) => {
  const p = cfg.properties.find((x) => x.name?.getText() === "name");
  if (!p) return "?";
  if (ts.isShorthandPropertyAssignment(p)) return p.name.text;
  if (!ts.isPropertyAssignment(p)) return "?";
  const i = p.initializer;
  if (ts.isStringLiteral(i) || ts.isNoSubstitutionTemplateLiteral(i)) return i.text;
  return i.getText() === "POST_TO_MAILBOX_TOOL" ? "post-to-mailbox" : i.getText();
};

const found = [];
let roots = 0;
function scan(file, text, kind) {
  if (!text.includes("sequencer(")) return;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "sequencer"
        && n.arguments[0] && ts.isObjectLiteralExpression(n.arguments[0])) {
      const cfg = n.arguments[0];
      const chain = [];
      let cur = n;
      while (ts.isPropertyAccessExpression(cur.parent) && cur.parent.expression === cur
             && ts.isCallExpression(cur.parent.parent)) {
        chain.push(`${cur.parent.name.text}/${cur.parent.parent.arguments.length}`);
        cur = cur.parent.parent;
      }
      const described = cfg.properties.some((x) => x.name?.getText() === "description");
      if (!described) roots += 1;
      else found.push({ file, name: literalName(cfg), cls: chain.join(",") === "step/1" ? "rename" : "kept", chain });
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
}

for (const f of files) {
  const text = readFileSync(path.join(root, f), "utf8");
  if (/\.mdx?$/.test(f)) {
    for (const m of text.matchAll(/```(?:ts|tsx|typescript)\b[^\n]*\n([\s\S]*?)```/g)) scan(f, m[1], ts.ScriptKind.TSX);
  } else scan(f, text, f.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

if (control) {
  scan("planted.ts", 'sequencer({ name: "planted", description: "x" }).step(b);', ts.ScriptKind.TS);
  EXPECTED["stale.ts"] = { stale: ["rename", "planted stale entry"] };
}

let bad = 0;
for (const s of found) {
  const [want, why] = EXPECTED[s.file]?.[s.name] ?? [];
  // `kept-shape`: rename-shaped by the rule, kept by decision (E3).
  const ok = want === (s.cls === "rename" ? "rename" : "kept") || (want === "kept-shape" && s.cls === "rename");
  console.log(`${ok ? "ok  " : "FAIL"} ${(want ?? s.cls).padEnd(10)} ${s.file} :: ${s.name}  [${s.chain.join(" ")}]${why ? `  (${why})` : ""}`);
  if (!ok) bad += 1;
}
for (const [file, names] of Object.entries(EXPECTED)) {
  for (const name of Object.keys(names)) {
    if (!found.some((s) => s.file === file && s.name === name)) {
      console.log(`GONE ${file} :: ${name}  (expected, not found)`);
      bad += 1;
    }
  }
}
console.log(`\n${found.filter((s) => s.cls === "rename").length} rename-shaped, ${found.filter((s) => s.cls === "kept").length} kept, ${roots} undescribed roots (out of scope)`);
if (control) {
  const out = found.find((s) => s.file === "planted.ts");
  const caught = out && !(EXPECTED[out.file]?.[out.name]);
  const pass = caught && bad === 2;
  console.log(pass ? "CONTROL PASS: planted wrapper and stale entry both reported" : `CONTROL FAIL: expected exactly 2 failures, got ${bad}`);
  process.exit(pass ? 0 : 1);
}
process.exit(bad ? 1 : 0);
