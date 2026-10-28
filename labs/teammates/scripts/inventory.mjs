#!/usr/bin/env node
/**
 * The lab's inventory: every file this lab adds, by kind, with line counts.
 * It is the "what this app adds" table in the README (the labs epic's rule ER-1).
 *
 * A lab has three kinds of app code: configuration, React UI, and small
 * flows (each under 200 lines). Two more kinds are allowed and are not app
 * code: checks (tests and this script), and fixtures, which stand in for the
 * package until wiring and are deleted then. Any file that fits none of them
 * is an *other* row, and the check fails.
 *
 *   node scripts/inventory.mjs           check: no other row, flows in size, README current
 *   node scripts/inventory.mjs --write   rewrite the README's table
 *   node scripts/inventory.mjs --wired   also fail while any fixture is left (the closure runs this)
 *   node scripts/inventory.mjs --control plant src/glue.ts; passes only if the check then fails
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LAB = join(dirname(fileURLToPath(import.meta.url)), "..");
const README = join(LAB, "README.md");
const START = "<!-- inventory:start -->";
const END = "<!-- inventory:end -->";
const FLOW_LIMIT = 200;

/** Kind rules, first match wins. A path is relative to the lab, with `/`. */
const RULES = [
  ["check", /^(test\/.+|scripts\/inventory\.mjs)$/],
  ["fixture", /^src\/fixtures(\.ts|\/.+)$/],
  ["flow", /^src\/flows\/[^/]+\.ts$/],
  ["config", /^(package\.json|tsconfig\.json|vite\.config\.ts|vitest\.config\.ts|components\.json|index\.html|\.gitignore|README\.md|cli\/index\.ts|fsdev\.config\.mts|host\.mts)$/],
  ["config", /^workforce\/(.+\/)?(WORKER|SKILL|TEAM)\.md$/],
  ["config", /^workforce\/(.+\/)?resources\/.+$/],
  ["ui", /^src\/(main\.tsx|App\.tsx|styles\.css|adapter\.ts)$/],
  ["ui", /^src\/(components|lib)\/.+\.(tsx|ts|css)$/],
];

/** Every file the lab holds: tracked, plus new files git doesn't ignore. */
function labFiles() {
  const out = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", "."], { cwd: LAB, encoding: "utf8" });
  return out.split("\n").filter(Boolean).sort();
}

function lines(path) {
  const text = readFileSync(join(LAB, path), "utf8");
  return text.length === 0 ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

/** Classify every file; return the rows and every problem found. */
export function inventory(files, { wired = false, linesOf = lines } = {}) {
  const rows = files.map((path) => {
    const kind = RULES.find(([, re]) => re.test(path))?.[0] ?? "other";
    return { path, kind, lines: linesOf(path) };
  });
  const problems = [];
  for (const row of rows) {
    if (row.kind === "other") problems.push(`other: ${row.path} is not config, UI, a small flow, a check or a fixture`);
    if (row.kind === "flow" && row.lines > FLOW_LIMIT) problems.push(`flow over ${FLOW_LIMIT} lines: ${row.path} (${row.lines})`);
    if (wired && row.kind === "fixture") problems.push(`fixture left after wiring: ${row.path}`);
  }
  return { rows, problems };
}

const ORDER = ["config", "ui", "flow", "fixture", "check", "other"];
const LABEL = {
  config: "Configuration",
  ui: "React UI",
  flow: "Small flows",
  fixture: "Fixtures (deleted at wiring)",
  check: "Checks (not app code)",
  other: "Other",
};

/** The README table: one row per kind, with its files and lines. */
export function table(rows) {
  const out = ["| Kind | Files | Lines |", "|---|---:|---:|"];
  for (const kind of ORDER) {
    const of = rows.filter((r) => r.kind === kind);
    if (of.length === 0 && kind !== "flow") continue;
    out.push(`| ${LABEL[kind]} | ${of.length} | ${of.reduce((n, r) => n + r.lines, 0)} |`);
  }
  return out.join("\n");
}

function readmeTable() {
  const text = readFileSync(README, "utf8");
  const a = text.indexOf(START);
  const b = text.indexOf(END);
  if (a < 0 || b < a) return { text, current: undefined };
  return { text, current: text.slice(a + START.length, b).trim(), a, b };
}

function main(argv) {
  const files = labFiles();
  if (argv.includes("--control")) {
    const { problems } = inventory([...files, "src/glue.ts"], { linesOf: (p) => (p === "src/glue.ts" ? 12 : lines(p)) });
    if (problems.some((p) => p.includes("src/glue.ts"))) {
      console.log("inventory control: FAIL as required · src/glue.ts is an other row");
      return 0;
    }
    console.error("inventory control: the planted src/glue.ts was not caught");
    return 1;
  }
  // The README counts itself, so it is written twice to settle its own line count.
  const { rows, problems } = inventory(files, { wired: argv.includes("--wired") });
  const want = table(rows);
  if (argv.includes("--write")) {
    for (let i = 0; i < 2; i++) {
      const { text, a, b } = readmeTable();
      if (a === undefined) throw new Error(`README.md has no ${START} … ${END} block`);
      writeFileSync(README, `${text.slice(0, a + START.length)}\n${table(inventory(labFiles()).rows)}\n${text.slice(b)}`);
    }
    console.log("inventory: README table written");
  } else if (readmeTable().current !== want) {
    problems.push("README.md's inventory is out of date: run node scripts/inventory.mjs --write");
  }
  if (problems.length > 0) {
    for (const p of problems) console.error(`inventory: ${p}`);
    return 1;
  }
  console.log(`inventory: PASS · ${rows.length} files, no other row`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
