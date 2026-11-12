/**
 * Mechanical checks for one docs-revamp page: its word count against the budget
 * for its `type`, the words the writing standard bans, em-dashes, long tables, and
 * TypeScript examples that do not name their file.
 *
 *   node scripts/check-docs-page.mjs <page.md> [more.md ...]
 *
 * Exits 1 when any page fails. Frontmatter, code blocks and figure descriptions
 * are not counted as words.
 */
import { readFileSync } from "node:fs";

const BUDGET = { start: 800, concept: 1500, catalog: 1500, tutorial: 2500, recipe: 800 };
const BANNED = [
  "now", "no longer", "still", "anymore", "deliberate", "deliberately", "simply", "just",
  "powerful", "seamless", "frictionless", "robust", "first-class", "load-bearing", "by construction",
];

/** Checks one page and returns its problems as printable lines. */
function check(path) {
  const raw = readFileSync(path, "utf8");
  const front = raw.match(/^---\n([\s\S]*?)\n---\n/);
  const type = front?.[1].match(/^type:\s*["']?([\w-]+)["']?\s*$/m)?.[1];
  const prose = raw
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^\*.*Description for the site's `?Figure`?:.*\*$/gm, "");
  const words = prose.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;
  const problems = [];
  if (!type) problems.push("no `type` in frontmatter");
  else if (type !== "reference" && !BUDGET[type]) problems.push(`unknown \`type\` "${type}"`);
  else if (BUDGET[type] && words > BUDGET[type]) problems.push(`${words} words, budget ${BUDGET[type]}`);
  const untitled = (raw.match(/^```tsx?(?![^\n]*title=)[^\n]*$/gm) ?? []).length;
  if (untitled) problems.push(`${untitled} ts code block(s) with no title="path"`);
  const codeBlocks = (raw.match(/^```[a-z]+/gm) ?? []).filter((fence) => !/^```(bash|text)$/.test(fence)).length;
  if (type === "concept" && codeBlocks > 4) problems.push(`${codeBlocks} code blocks (limit 4 on a concept page)`);
  const text = prose.replace(/`[^`]*`/g, "");
  for (const word of BANNED) {
    const hits = text.match(new RegExp(`\\b${word}\\b`, "gi"));
    if (hits) problems.push(`"${word}" ×${hits.length}`);
  }
  const dashes = (text.match(/—/g) ?? []).length;
  if (dashes > 2) problems.push(`${dashes} em-dashes (limit 2)`);
  for (const table of prose.match(/(^\|.*\|\n)+/gm) ?? []) {
    const count = table.trim().split("\n").length - 2;
    if (type !== "reference" && count > 6) problems.push(`a table with ${count} body lines (limit 6)`);
  }
  console.log(`${problems.length ? "FAIL" : "ok  "} ${path} (${type ?? "?"}, ${words} words)`);
  for (const problem of problems) console.log(`     ${problem}`);
  return problems.length === 0;
}

const results = process.argv.slice(2).map(check);
process.exit(results.every(Boolean) ? 0 : 1);
