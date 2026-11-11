#!/usr/bin/env node
// FIX-2627 spec POC. Retained design evidence, not production code. Throwaway.
/**
 * The claim census: every file in every workforce folder in the repository,
 * classified against the claim set workforce will publish once FIX-2627 turns
 * on FIX-2626's claim pass. It answers one question before that PR is built:
 * which files would stop an app or a goal from starting, and so must move first.
 *
 * Totality: every file under every root gets exactly one class (a named claim
 * rule, an ignored name, or UNCLAIMED), and every WORKER.md in the repository
 * sits under a root the census walked. A negative control plants strays and
 * fails unless each is reported.
 *
 *   node specs/issues/FIX-2627/poc/claim-census/census.mjs            # the census
 *   CENSUS_CONTROL=1 node specs/issues/FIX-2627/poc/claim-census/census.mjs   # the control
 *
 * Exit 0 prints the table. The census never edits the tree.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.resolve(import.meta.dirname, "../../../../..");
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", ".next", ".turbo"]);
const SKIP_TOP = new Set(["specs"]); // retained spec evidence, never loaded by an app
const IGNORED = new Set([".DS_Store", "Thumbs.db"]); // workforce's IGNORED_ENTRIES

// A level is where workers, resources, references, skills, packages may sit.
const LEVEL = String.raw`(?:org|teams/[^/]+|org/workers/[^/]+|teams/[^/]+/workers/[^/]+)`;
const CODE = String.raw`\.(?:ts|tsx|mts|cts)`;
/** Workforce's claim set, read off the published shapes (packages/workforce/test/published-tree-surface.test.ts). */
const RULES = [
  ["generated module", /^workforce\.gen\.ts$/],
  ["worker flow", new RegExp(`^flows/workers/[^/]+${CODE}$`)],
  ["root block", new RegExp(`^blocks/[^/]+${CODE}$`)],
  ["TEAM.md", /^teams\/[^/]+\/TEAM\.md$/],
  ["WORKER.md", /^(?:org|teams\/[^/]+)\/workers\/[^/]+\/WORKER\.md$/],
  ["resource", new RegExp(`^${LEVEL}/resources/[^/]+(?:\\.md|${CODE})$`)],
  ["reference", new RegExp(`^${LEVEL}/references/[^/]+\\.md$`)],
  ["skill", new RegExp(`^${LEVEL}/skills/[^/]+/.+$`)],
  ["package", new RegExp(`^${LEVEL}/packages/[^/]+/(?:PACKAGE\\.md|blocks/[^/]+${CODE})$`)],
  ["team or worker block", new RegExp(`^(?:teams/[^/]+|teams/[^/]+/workers/[^/]+)/blocks/[^/]+${CODE}$`)],
];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

function repoFiles() {
  const files = [];
  for (const top of fs.readdirSync(REPO, { withFileTypes: true })) {
    if (!top.isDirectory() || SKIP_DIRS.has(top.name) || SKIP_TOP.has(top.name) || top.name.startsWith(".")) continue;
    walk(path.join(REPO, top.name), files);
  }
  return files;
}

/** Roots: a folder named `workforce` holding `teams/` or `org/`, and the root above every WORKER.md. */
function findRoots(files) {
  const roots = new Set();
  for (const file of files) {
    const rel = path.relative(REPO, file).split(path.sep).join("/");
    const m = rel.match(/^(.*?)\/(?:org|teams\/[^/]+)\/workers\/[^/]+\/WORKER\.md$/);
    if (m) roots.add(m[1]);
    const w = rel.match(/^(.*\/workforce)\/(?:teams|org)\//);
    if (w) roots.add(w[1]);
  }
  // A root nested in another root is the same tree (a worker's own folder is not a root).
  return [...roots].sort().filter((r, _, all) => !all.some((o) => o !== r && r.startsWith(`${o}/`)));
}

function classify(rel) {
  const name = rel.split("/").at(-1);
  if (IGNORED.has(name)) return "ignored";
  for (const [label, re] of RULES) if (re.test(rel)) return label;
  return "UNCLAIMED";
}

export function census(files) {
  const roots = findRoots(files);
  const rows = [];
  const inRoot = new Set();
  for (const root of roots) {
    const abs = path.join(REPO, root);
    for (const file of files) {
      if (!file.startsWith(`${abs}${path.sep}`)) continue;
      inRoot.add(file);
      const rel = path.relative(abs, file).split(path.sep).join("/");
      rows.push({ root, rel, cls: classify(rel) });
    }
  }
  // Totality: every WORKER.md sits under a walked root.
  const orphans = files.filter((f) => f.endsWith(`${path.sep}WORKER.md`) && !inRoot.has(f));
  if (orphans.length > 0) throw new Error(`WORKER.md outside every root: ${orphans.join(", ")}`);
  // Totality: each row has exactly one class (classify returns one), and no file is counted twice.
  const keys = rows.map((r) => `${r.root}/${r.rel}`);
  if (new Set(keys).size !== keys.length) throw new Error("a file was classified twice");
  return { roots, rows };
}

function report({ roots, rows }) {
  const unclaimed = rows.filter((r) => r.cls === "UNCLAIMED");
  const byClass = {};
  for (const r of rows) byClass[r.cls] = (byClass[r.cls] ?? 0) + 1;
  console.log(`roots walked: ${roots.length} · files classified: ${rows.length}`);
  for (const [cls, n] of Object.entries(byClass).sort()) console.log(`  ${cls.padEnd(22)} ${n}`);
  console.log(`\nUNCLAIMED (${unclaimed.length}) — each stops its app or goal starting once the claim pass is on:`);
  for (const r of unclaimed) console.log(`  ${r.root}/${r.rel}`);
  return unclaimed;
}

if (process.env.CENSUS_CONTROL === "1") {
  // Plant strays in a scratch copy of one real root and require each one reported.
  const files = repoFiles();
  const { roots } = census(files);
  const source = path.join(REPO, roots.find((r) => r === "labs/teammates/workforce") ?? roots[0]);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fix2627-census-"));
  const copy = path.join(tmp, "workforce");
  fs.cpSync(source, copy, { recursive: true });
  const planted = ["notes.txt", "flows/helper.mts", "teams/x/notes.md", "flows/workers/nested/deep.ts"];
  for (const p of planted) {
    fs.mkdirSync(path.dirname(path.join(copy, p)), { recursive: true });
    fs.writeFileSync(path.join(copy, p), "// planted\n");
  }
  const rows = walk(copy).map((f) => ({ rel: path.relative(copy, f).split(path.sep).join("/") }));
  const reported = rows.filter((r) => classify(r.rel) === "UNCLAIMED").map((r) => r.rel);
  fs.rmSync(tmp, { recursive: true, force: true });
  const missed = planted.filter((p) => !reported.includes(p));
  console.log(`control: planted ${planted.length}, reported ${reported.length}: ${reported.join(", ")}`);
  if (missed.length > 0 || reported.length !== planted.length) {
    console.log(`CONTROL FAILED: missed ${missed.join(", ") || "none"}`);
    process.exit(1);
  }
  console.log("control ok: every planted stray reported, nothing else");
} else {
  report(census(repoFiles()));
}
