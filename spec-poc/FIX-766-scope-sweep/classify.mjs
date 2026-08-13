#!/usr/bin/env node
/**
 * Classify every textual `.work(` / `.workIf(` / `.waitForWork(` /
 * `.forEachBackground(` occurrence in tracked .ts/.tsx as one of:
 *   code    — a real call/declaration site (a codemod can rewrite it)
 *   comment — prose inside a line/block/JSDoc comment (needs a prose sweep)
 *   string  — inside a string/template literal
 * Proves the AST count and the textual count are measuring different things.
 */
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const require_ = createRequire("/home/user/flow-state-dev/package.json");
const ts = require_("/home/user/flow-state-dev/node_modules/.pnpm/typescript@5.7.3/node_modules/typescript/lib/typescript.js");

const ROOT = "/home/user/flow-state-dev";
const RE = /\.(work|workIf|waitForWork|forEachBackground)\(/g;

const files = execSync("git ls-files '*.ts' '*.tsx'", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
  .split("\n").filter(Boolean);

const tally = { code: 0, comment: 0, string: 0 };
const byMethod = {};
const commentFiles = new Set();
const codeFiles = new Set();

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  let text;
  try { text = fs.readFileSync(abs, "utf8"); } catch { continue; }
  if (!/\.(work|workIf|waitForWork|forEachBackground)\(/.test(text)) continue;

  const sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, rel.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);

  // Collect comment ranges and string-literal ranges.
  const commentRanges = [];
  const stringRanges = [];
  const walk = (node) => {
    const full = node.getFullStart();
    for (const r of ts.getLeadingCommentRanges(text, full) ?? []) commentRanges.push([r.pos, r.end]);
    for (const r of ts.getTrailingCommentRanges(text, node.getEnd()) ?? []) commentRanges.push([r.pos, r.end]);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateLiteral(node)) {
      stringRanges.push([node.getStart(sf), node.getEnd()]);
    }
    ts.forEachChild(node, walk);
  };
  walk(sf);

  const inRange = (pos, ranges) => ranges.some(([a, b]) => pos >= a && pos < b);

  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(text)) !== null) {
    const pos = m.index;
    const method = m[1];
    let kind;
    if (inRange(pos, commentRanges)) kind = "comment";
    else if (inRange(pos, stringRanges)) kind = "string";
    else kind = "code";
    tally[kind]++;
    byMethod[method] ??= { code: 0, comment: 0, string: 0 };
    byMethod[method][kind]++;
    if (kind === "comment") commentFiles.add(rel);
    if (kind === "code") codeFiles.add(rel);
  }
}

console.log("textual occurrences of the four verbs, classified by lexical context:\n");
console.log(`  code     ${String(tally.code).padStart(4)}  (${codeFiles.size} files)  <- codemod rewrites these`);
console.log(`  comment  ${String(tally.comment).padStart(4)}  (${commentFiles.size} files)  <- prose sweep, codemod will MISS these`);
console.log(`  string   ${String(tally.string).padStart(4)}`);
console.log(`  TOTAL    ${String(tally.code + tally.comment + tally.string).padStart(4)}`);
console.log("\nby method (code / comment / string):");
for (const [k, v] of Object.entries(byMethod)) {
  console.log(`  ${k.padEnd(20)} ${String(v.code).padStart(4)} ${String(v.comment).padStart(5)} ${String(v.string).padStart(5)}`);
}
