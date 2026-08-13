#!/usr/bin/env node
/**
 * FIX-766 scope sweep — AST-based, not textual.
 *
 * Counts every site the `work` -> `sideChain` rename must touch, using the
 * TypeScript AST so that unrelated identifiers that merely share a name
 * (three distinct `phase` fields exist in this repo) are not conflated.
 *
 * Usage:
 *   node sweep.mjs                 # sweep the repo (tracked .ts/.tsx only)
 *   node sweep.mjs --files a.ts b  # sweep an explicit file list (control mode)
 *   node sweep.mjs --json          # machine-readable output
 */
import { createRequire } from "node:module";
const require_ = createRequire("/home/user/flow-state-dev/package.json");
const { Project, Node } = require_(
  "/home/user/flow-state-dev/node_modules/.pnpm/ts-morph@28.0.0/node_modules/ts-morph/dist/ts-morph.js"
);
import { execSync } from "node:child_process";
import path from "node:path";

const ROOT = "/home/user/flow-state-dev";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const fileFlag = argv.indexOf("--files");
const explicitFiles = fileFlag >= 0 ? argv.slice(fileFlag + 1).filter((a) => !a.startsWith("--")) : null;

/** The four DSL methods being renamed. */
const METHODS = new Set(["work", "workIf", "waitForWork", "forEachBackground"]);

/** The six public core exports carrying the old word. */
const EXPORTS = new Set([
  "RequestWorkPool",
  "RequestWorkPoolResult",
  "RequestWorkPoolDrainOptions",
  "RequestWorkPoolDrainAllOptions",
  "RequestWorkTaskMeta",
  "getRequestWorkPool",
]);

function listFiles() {
  if (explicitFiles) return explicitFiles.map((f) => path.resolve(f));
  const out = execSync("git ls-files '*.ts' '*.tsx'", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out.split("\n").filter(Boolean).map((f) => path.join(ROOT, f));
}

const project = new Project({
  skipAddingFilesFromTsConfig: true,
  skipFileDependencyResolution: true,
  compilerOptions: { allowJs: false, jsx: 4 },
});
const files = listFiles();
for (const f of files) {
  try { project.addSourceFileAtPath(f); } catch { /* unreadable, skip */ }
}

/** rule id -> array of {file, line, text} */
const hits = { R1_methods: [], R2_phase_work: [], R3_exports: [], R4_workGroupId: [], R5_backgroundTasks: [] };

const rel = (sf) => path.relative(ROOT, sf.getFilePath());
const record = (bucket, node, note) => {
  const sf = node.getSourceFile();
  hits[bucket].push({
    file: rel(sf),
    line: sf.getLineAndColumnAtPos(node.getStart()).line,
    text: node.getText().slice(0, 90).replace(/\s+/g, " "),
    note,
  });
};

/**
 * R2 helper: is this string literal "work" bound to the *provenance* `phase`
 * field, as opposed to one of the other two unrelated `phase` fields?
 * We accept it only when the literal is (a) the value of a property named
 * `phase`, (b) a member of a union type on a member named `phase`, or
 * (c) compared/assigned against something named `phase`.
 */
function isProvenancePhaseWork(lit) {
  if (lit.getLiteralValue() !== "work") return false;
  const p = lit.getParent();
  if (!p) return false;

  // (a) { phase: "work" }
  if (Node.isPropertyAssignment(p) && p.getName() === "phase") return true;

  // (b) phase: "main" | "work"  (union member on a `phase` member/param/type alias)
  if (Node.isLiteralTypeNode(p)) {
    const anc = p.getFirstAncestor(
      (a) =>
        Node.isPropertySignature(a) ||
        Node.isParameterDeclaration(a) ||
        Node.isTypeAliasDeclaration(a) ||
        Node.isPropertyDeclaration(a)
    );
    if (anc && typeof anc.getName === "function" && anc.getName() === "phase") return true;
  }

  // (c) x.phase === "work"  /  phase === "work"
  if (Node.isBinaryExpression(p)) {
    const other = p.getLeft() === lit ? p.getRight() : p.getLeft();
    const t = other.getText();
    if (/(^|\.)phase$/.test(t)) return true;
  }

  // (d) ternary/conditional on a `scope`/`phase` discriminator that FEEDS a phase
  //     property, e.g. `phase: cond ? "work" : "main"`
  const pa = lit.getFirstAncestor((a) => Node.isPropertyAssignment(a));
  if (pa && pa.getName() === "phase") return true;

  return false;
}

for (const sf of project.getSourceFiles()) {
  sf.forEachDescendant((node) => {
    // R1: method call sites  obj.work(...) / obj.workIf(...) / ...
    if (Node.isCallExpression(node)) {
      const expr = node.getExpression();
      if (Node.isPropertyAccessExpression(expr) && METHODS.has(expr.getName())) {
        record("R1_methods", expr.getNameNode(), expr.getName());
      }
    }
    // R1b: declaration sites — method signatures / properties named for the DSL verbs
    if (
      (Node.isMethodSignature(node) || Node.isMethodDeclaration(node) || Node.isPropertySignature(node)) &&
      typeof node.getName === "function" &&
      METHODS.has(node.getName())
    ) {
      record("R1_methods", node.getNameNode(), `decl:${node.getName()}`);
    }

    // R2: provenance phase literal "work"
    if (Node.isStringLiteral(node) && isProvenancePhaseWork(node)) {
      record("R2_phase_work", node, "phase-work");
    }

    // R3: the six public exports
    if (Node.isIdentifier(node) && EXPORTS.has(node.getText())) {
      record("R3_exports", node, node.getText());
    }

    // R4 / R5: contract field names
    if (Node.isIdentifier(node) || Node.isPropertySignature(node) || Node.isPropertyAssignment(node)) {
      const n = typeof node.getName === "function" ? node.getName() : node.getText();
      if (n === "workGroupId") record("R4_workGroupId", node, "workGroupId");
      if (n === "backgroundTasks") record("R5_backgroundTasks", node, "backgroundTasks");
    }
  });
}

// dedupe (a PropertySignature and its Identifier can both match R4/R5)
for (const k of Object.keys(hits)) {
  const seen = new Set();
  hits[k] = hits[k].filter((h) => {
    const key = `${h.file}:${h.line}:${h.note}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const summary = {};
for (const [k, v] of Object.entries(hits)) {
  summary[k] = { sites: v.length, files: new Set(v.map((h) => h.file)).size };
}

if (asJson) {
  console.log(JSON.stringify({ scannedFiles: files.length, summary, hits }, null, 2));
} else {
  console.log(`scanned ${files.length} tracked .ts/.tsx files\n`);
  for (const [k, s] of Object.entries(summary)) {
    console.log(`${k.padEnd(20)} ${String(s.sites).padStart(4)} sites  ${String(s.files).padStart(3)} files`);
  }
  console.log("\n-- R1 by method --");
  const byMethod = {};
  for (const h of hits.R1_methods) {
    const m = h.note.replace(/^decl:/, "");
    byMethod[m] = (byMethod[m] || 0) + 1;
  }
  for (const [m, c] of Object.entries(byMethod).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${m.padEnd(22)} ${String(c).padStart(4)}`);
  }
  console.log("\n-- R2 sites (provenance phase === work) --");
  for (const h of hits.R2_phase_work) console.log(`  ${h.file}:${h.line}  ${h.text}`);
}
