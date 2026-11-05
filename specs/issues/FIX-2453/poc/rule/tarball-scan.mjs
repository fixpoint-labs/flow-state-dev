#!/usr/bin/env node
/**
 * POC, throwaway: what an adopter reads in an unpacked tarball. Counts the
 * rule's pattern in .d.ts JSDoc (the hovers) and in .js string and template
 * literals (runtime text), and, for contrast, in .js `//` comments, which D1
 * keeps. A reference for this issue's tarball-scan goal check, not that check.
 *
 *   node specs/issues/FIX-2453/poc/rule/tarball-scan.mjs <unpacked-package-dir>...
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { TRACKER_ID } from "./no-tracker-ids.mjs";

const ts = createRequire(import.meta.url)("typescript");
const RE = new RegExp(TRACKER_ID.source, "g");
const walk = (d, out = []) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(d\.ts|js)$/.test(p)) out.push(p);
  }
  return out;
};
for (const dir of process.argv.slice(2)) {
  const n = { hover: 0, runtimeText: 0, lineComment: 0 };
  for (const f of walk(dir)) {
    const dts = f.endsWith(".d.ts");
    const sc = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, fs.readFileSync(f, "utf8"));
    const stack = [];
    for (let k = sc.scan(); k !== ts.SyntaxKind.EndOfFileToken; k = sc.scan()) {
      let bucket = null;
      let tok = sc.getTokenText();
      if (k === ts.SyntaxKind.MultiLineCommentTrivia && tok.startsWith("/**")) bucket = dts ? "hover" : null;
      else if (k === ts.SyntaxKind.SingleLineCommentTrivia) bucket = dts ? null : "lineComment";
      else if (k === ts.SyntaxKind.StringLiteral || k === ts.SyntaxKind.NoSubstitutionTemplateLiteral) bucket = "runtimeText";
      else if (k === ts.SyntaxKind.TemplateHead) { bucket = "runtimeText"; stack.push("t"); }
      else if (k === ts.SyntaxKind.OpenBraceToken) stack.push("b");
      else if (k === ts.SyntaxKind.CloseBraceToken && stack.pop() === "t") {
        if (sc.reScanTemplateToken(false) === ts.SyntaxKind.TemplateMiddle) stack.push("t");
        bucket = "runtimeText";
        tok = sc.getTokenText();
      }
      if (bucket && !(dts && bucket === "runtimeText")) n[bucket] += (tok.match(RE) ?? []).length;
    }
  }
  console.log(JSON.stringify({ package: path.basename(path.dirname(dir)), ...n }));
}
