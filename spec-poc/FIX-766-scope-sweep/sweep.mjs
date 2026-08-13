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
import fsSync from "node:fs";

const ROOT = "/home/user/flow-state-dev";

const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const fileFlag = argv.indexOf("--files");
const explicitFiles = fileFlag >= 0 ? argv.slice(fileFlag + 1).filter((a) => !a.startsWith("--")) : null;

/** The four DSL methods being renamed. */
const METHODS = new Set(["work", "workIf", "waitForWork", "forEachBackground"]);

/**
 * R3 is a TOKEN rule, not a name list.
 *
 * It used to hard-code the six `RequestWork*` names the issue happened to list.
 * That is the defect this whole spec exists downstream of: the export walk in
 * `surface.mjs` found `WorkConfig` and `WorkTrace`, which a six-name set does
 * not contain — so the guard would have reported green while `WorkConfig`
 * survived the rename. Two tools that must stay in sync is the same failure one
 * level up, so the token rule lives here and `surface.mjs` is now only a
 * per-package view of the same rule.
 *
 * Rule: split an identifier on camel/Pascal boundaries and flag it if any token
 * is `work`. This does NOT match `framework`, `network`, or `workstream`, which
 * tokenize to a single word that is not `work`.
 */
function identTokens(id) {
  return id
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[\s_\-]+/)
    .filter(Boolean)
    .map((t) => t.toLowerCase());
}

/**
 * Names that carry the `work` token and are CORRECT as they stand. The control
 * asserts every one of these reports zero: catching any of them is a
 * regression, not a bigger win.
 *   - priorWork / TaskPriorWork / formatPriorWork — a task's previously
 *     completed output. Different concept, same substring.
 *   - onBackgroundWork — the serverless keep-alive hook. Covers ALL work that
 *     outlives the response, so under this change it is the umbrella term and
 *     is already named correctly.
 * (`Workstream*` needs no entry — it does not carry the `work` token at all.)
 */
const ALLOWLIST = new Set(["priorWork", "TaskPriorWork", "formatPriorWork", "onBackgroundWork"]);

/**
 * `background`-token names that are CORRECT as they stand, because under this
 * change `background` becomes the UMBRELLA over all three tiers (the word the
 * guides already use that way). Only tier-2 uses are violations.
 *   - onBackgroundWork — serverless keep-alive; covers every tier.
 * Everything else carrying the token is tier-2 and must move.
 */
const BACKGROUND_ALLOWLIST = new Set(["onBackgroundWork"]);

const carriesWorkToken = (id) => !ALLOWLIST.has(id) && identTokens(id).includes("work");

function listFiles() {
  if (explicitFiles) return explicitFiles.map((f) => path.resolve(f));
  const out = execSync("git ls-files '*.ts' '*.tsx'", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return out
    .split("\n")
    .filter(Boolean)
    // Exclude this sweep's own control fixtures. They are tracked files full of
    // deliberate violations, so counting them inflates every rule by exactly the
    // Control A counts and the repo numbers stop matching the spec.
    .filter((f) => !f.startsWith("spec-poc/"))
    .map((f) => path.join(ROOT, f));
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
const hits = { R1_methods: [], R2_phase_work: [], R3_work_token: [], R4_workGroupId: [], R5_backgroundTasks: [], R7_work_union: [], R8_background_tier2: [] };

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

    // R3: any identifier carrying the `work` token (minus the allowlist).
    // Subsumes the old six-name set and catches WorkConfig / WorkTrace /
    // createRequestWorkPool without anyone having to remember to list them.
    if (Node.isIdentifier(node) && carriesWorkToken(node.getText())) {
      record("R3_work_token", node, node.getText());
    }

    // R7 (encoding 2): a `"work"` string-literal union member NOT bound to
    // `phase`. FlowErrorScope = "request" | "work" | "resource" | "block" is
    // publicly exported and `executeBlock` converts scope === "work" straight
    // into provenance.phase — so a phase-only rule lets the retired term ship.
    if (
      Node.isStringLiteral(node) &&
      node.getLiteralValue() === "work" &&
      Node.isLiteralTypeNode(node.getParent()) &&
      !isProvenancePhaseWork(node)
    ) {
      record("R7_work_union", node, "work-union-member");
    }

    // R8 (encoding 3): `background` used for the TIER-2 concept. A work-token
    // rule cannot match these by construction, which is exactly why they were
    // missed. The allowlist spares the umbrella/platform names.
    if (Node.isIdentifier(node)) {
      const t = node.getText();
      if (!BACKGROUND_ALLOWLIST.has(t) && identTokens(t).includes("background")) {
        record("R8_background_tier2", node, t);
      }
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

// R6: markdown references to the four verbs. Previously the one row in the
// spec's scope table with no script behind it — a claim one row broader than
// its evidence, which is the same shape as the R3 defect above.
const MD_RE = /\.(work|workIf|waitForWork|forEachBackground)\(/g;
const mdCounts = { total: 0, files: 0, published: 0, internal: 0, readmes: 0 };
if (!explicitFiles) {
  const mdList = execSync("git ls-files '*.md' '*.mdx'", { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n").filter(Boolean).filter((f) => !f.startsWith("spec-poc/") && !f.startsWith("spec/"));
  for (const rel of mdList) {
    let text = "";
    try { text = fsSync.readFileSync(path.join(ROOT, rel), "utf8"); } catch { continue; }
    const n = (text.match(MD_RE) || []).length;
    if (!n) continue;
    mdCounts.total += n;
    mdCounts.files += 1;
    if (rel.startsWith("apps/docs/")) mdCounts.published += n;
    else if (rel.startsWith("docs/")) mdCounts.internal += n;
    else if (rel.endsWith("README.md")) mdCounts.readmes += n;
  }
}

if (asJson) {
  console.log(JSON.stringify({ scannedFiles: files.length, summary, markdown: mdCounts, hits }, null, 2));
} else {
  console.log(`scanned ${files.length} tracked .ts/.tsx files\n`);
  for (const [k, s] of Object.entries(summary)) {
    console.log(`${k.padEnd(20)} ${String(s.sites).padStart(4)} sites  ${String(s.files).padStart(3)} files`);
  }
  if (!explicitFiles) {
    console.log(
      `R6_markdown          ${String(mdCounts.total).padStart(4)} sites  ${String(mdCounts.files).padStart(3)} files` +
        `   (published ${mdCounts.published} / internal ${mdCounts.internal} / READMEs ${mdCounts.readmes})`
    );
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
