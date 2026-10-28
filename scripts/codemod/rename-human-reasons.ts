/**
 * Codemod: FIX-2151, the suspension reasons say *user*.
 *
 * `"human_approval"` → `"user_approval"` and `"human_input"` → `"user_input"`,
 * the framework's one word for the person on the other end (`userId`,
 * `waitForUser`). The head names are the contract in
 * `specs/epics/FIX-2071/renames.md`.
 *
 * Both strings are unique, so a word-bounded replace over every tracked file
 * under `ROOTS` below is the whole rename; no type checker is needed. It has
 * to be total under `ROOTS`: `SuspensionReason`'s open `string & {}` arm means
 * a missed call site still compiles and silently becomes a custom reason.
 *
 * History is left alone: `CHANGELOG.md` files, dated blog posts,
 * `docs/internal/`, a goal's dated verdict rows (`| 2026-10-06 | …`), and
 * this rename's own release note, which names the old values on purpose.
 * `specs/` is retained design history and is not a root.
 *
 * Usage: `pnpm tsx scripts/codemod/rename-human-reasons.ts`. Re-run on a fresh
 * `main` to regenerate a conflicting PR (FIX-2071 ER-2).
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..", "..");

const RENAMES: Record<string, string> = {
  human_approval: "user_approval",
  human_input: "user_input",
};

const ROOTS = ["packages", "apps", "goals", "docs", ".changeset"];

const HISTORY = /(^|\/)CHANGELOG\.md$|^apps\/docs\/blog\/|^docs\/internal\/|^\.changeset\/user-suspension-reasons\.md$/;

/** A goal's dated verdict row records a past run under the names it ran with. */
const VERDICT_ROW = /^\| \d{4}-\d{2}-\d{2} \|/;

const PATTERN = new RegExp(`\\b(${Object.keys(RENAMES).join("|")})\\b`, "g");

const files = execFileSync("git", ["ls-files", "--", ...ROOTS], { cwd: repoRoot, encoding: "utf8" })
  .split("\n")
  .filter((path) => path && !HISTORY.test(path));

let changedFiles = 0;
let changedLines = 0;
for (const path of files) {
  const abs = resolve(repoRoot, path);
  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    continue; // a tracked path deleted in the working tree
  }
  if (!PATTERN.test(text)) continue;
  PATTERN.lastIndex = 0;
  const lines = text.split("\n");
  let touched = false;
  for (let i = 0; i < lines.length; i++) {
    if (VERDICT_ROW.test(lines[i])) continue;
    const next = lines[i].replace(PATTERN, (word) => RENAMES[word]);
    if (next !== lines[i]) {
      lines[i] = next;
      touched = true;
      changedLines++;
    }
  }
  if (touched) {
    writeFileSync(abs, lines.join("\n"));
    changedFiles++;
  }
}

console.log(`rename-human-reasons: ${changedLines} lines in ${changedFiles} files`);
