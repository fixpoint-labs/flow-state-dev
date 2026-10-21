#!/usr/bin/env node
/**
 * Guard: no goal hides an empty list behind a length guard.
 *
 * `if (xs.length > 0 && !ok(xs)) failures.push(...)` skips its own check when
 * `xs` is empty, so a renamed field or a missing row passes as if it were
 * graded. Goals floor the list instead: `tell.over(name, xs)` from
 * `goals/lib/verdict.mts` turns an empty read into CAN'T TELL, and the guard
 * comes out.
 *
 * ## The one shape it refuses
 *
 * An `if` (or `else if`) whose condition holds `.length > 0 &&`,
 * `.length !== 0 &&` or `.length >= 1 &&`, and whose body begins with a
 * failure: `failures.push(...)` or `fail(...)` (a goal's own `fail` helpers
 * included). Nothing else. Two shapes look close and are left alone on
 * purpose:
 *
 *   - a polling loop, `if (rows.length > 0 && rows.every(settled)) { ... }`,
 *     whose body waits or breaks rather than failing;
 *   - a sameness check, `if (answers.length > 1 && new Set(answers).size === 1)`,
 *     where two are needed before "all the same" means anything.
 *
 * The guard does not judge every `every`, `continue` or loop over observed data:
 * those shapes are too noisy to gate on, and `tell.over` carries the rule for
 * them at run time.
 *
 * Plain Node with no dependencies, so the CI process-guards job runs it
 * without an install.
 *
 * Run: node goals/scripts/check-tell-suppress.mjs [--root <dir>] [--control]
 *   --root     scan another goals tree (default: this one)
 *   --control  plant files that must be refused, and two that must not be,
 *              into the tree (in memory); exits 1 if any is misread
 * Exits 1 on any refused line.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const GOALS_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The files a goal is written in. */
const SOURCE = /\.(mts|mjs|ts|tsx|js)$/;

/** The guard in the condition: a length floor of zero, ANDed with the real check. */
const GUARD = /\.length\s*(?:>\s*0|!==\s*0|>=\s*1)(?![\d.])\s*&&/;

/** A body that begins with a failure: `failures.push(` or a `fail(` helper. */
const FAILURE = /^(?:[\w$]*[Ff]ailures\.push|(?:[\w$]+\.)?fail)\s*\(/;

/** Every `if (` that is not part of a longer identifier. */
const IF = /(?<![\w$.])if\s*\(/g;

/**
 * The text with every comment, string and regex literal blanked to spaces,
 * newlines kept, so line numbers hold and neither prose nor a quoted example is
 * read as code. A regex literal is read before quotes, so a quote inside one
 * starts no string; a `'` or `"` string still ends at its line's end at the
 * latest. A template literal's `${...}` stays code.
 */
export function mask(text) {
  const out = text.split("");
  const blank = (from, to) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  /** The brace depth at which each open template's `${` began. */
  const templates = [];
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/") {
      const end = text.indexOf("\n", i);
      const to = end < 0 ? text.length : end;
      blank(i, to);
      i = to - 1;
    } else if (c === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      const to = end < 0 ? text.length : end + 2;
      blank(i, to);
      i = to - 1;
    } else if (c === "/" && regexMayStart(out, i)) {
      const end = regexEnd(text, i);
      if (end !== undefined) {
        blank(i + 1, end);
        i = end;
      }
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== "\n") j += text[j] === "\\" ? 2 : 1;
      blank(i + 1, Math.min(j, text.length));
      i = j;
    } else if (c === "`" || (c === "}" && templates.length > 0 && templates[templates.length - 1] === depth)) {
      if (c === "}") templates.pop();
      let j = i + 1;
      while (j < text.length && text[j] !== "`" && !(text[j] === "$" && text[j + 1] === "{")) j += text[j] === "\\" ? 2 : 1;
      blank(i + 1, Math.min(j, text.length));
      if (text[j] === "$") {
        templates.push(depth);
        i = j + 1; // past `${`: that brace is the template's, not a block's
      } else {
        i = j;
      }
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
    }
  }
  return out.join("");
}

/** Words after which a `/` begins a regex literal rather than a division. */
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);

/**
 * Whether the `/` at `at` can begin a regex literal, judged by the characters
 * before it (already masked, so a closed string reads as its quote): a regex follows an
 * operator, an opening bracket, a statement end or a keyword; a division
 * follows a value.
 */
function regexMayStart(code, at) {
  let k = at - 1;
  while (k >= 0 && /\s/.test(code[k])) k--;
  if (k < 0) return true;
  const p = code[k];
  if (/[\w$]/.test(p)) {
    let w = k;
    while (w > 0 && /[\w$]/.test(code[w - 1])) w--;
    return REGEX_AFTER_WORD.has(code.slice(w, k + 1).join(""));
  }
  return !/[)\]"'`.]/.test(p);
}

/** The index of the `/` closing the regex literal opened at `at`, or undefined if its line ends first. */
function regexEnd(text, at) {
  let inClass = false;
  for (let j = at + 1; j < text.length && text[j] !== "\n"; j++) {
    const c = text[j];
    if (c === "\\") j++;
    else if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    else if (c === "/" && !inClass) return j;
  }
  return undefined;
}

/** The index just past the `)` that closes the `(` at `open`, or undefined. */
function closeOf(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "(") depth++;
    else if (code[i] === ")" && --depth === 0) return i + 1;
  }
  return undefined;
}

/** The body's first statement, past an optional `{` and whitespace. */
function bodyStart(code, from) {
  return code.slice(from).replace(/^\s*\{?\s*/, "");
}

/**
 * Every refused `if` in one file.
 * @param {string} path
 * @param {string} text
 * @returns {{ path: string; line: number; text: string }[]}
 */
export function scanFile(path, text) {
  const hits = [];
  const code = mask(text);
  for (const m of code.matchAll(IF)) {
    const open = m.index + m[0].length - 1;
    const close = closeOf(code, open);
    if (close === undefined) continue;
    if (!GUARD.test(code.slice(open, close))) continue;
    if (!FAILURE.test(bodyStart(code, close))) continue;
    const line = text.slice(0, m.index).split("\n").length;
    hits.push({ path, line, text: text.split("\n")[line - 1].trim() });
  }
  return hits;
}

/**
 * Every refused `if` in a tree.
 * @param {Map<string, string>} files path → text
 */
export function scan(files) {
  return [...files].flatMap(([path, text]) => scanFile(path, text));
}

/** Read every goal source file under `root`, skipping installed packages. */
export function readTree(root) {
  const files = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === "node_modules") continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (SOURCE.test(entry.name)) files.set(relative(root, full), readFileSync(full, "utf8"));
    }
  };
  walk(root);
  return files;
}

/**
 * Files planted into a tree. `refuse: true` must be flagged at `line`;
 * `refuse: false` must not be flagged at all.
 */
export const PLANTS = [
  {
    path: "zz-planted/blind/run.mts",
    refuse: true,
    line: 2,
    text: 'const seqs = items.map((i) => i.seq);\nif (seqs.length > 0 && !nonDecreasing(seqs)) failures.push("ordering: not non-decreasing");\n',
  },
  {
    path: "zz-planted/blind-block/run.mts",
    refuse: true,
    line: 1,
    text: 'if (rows.length !== 0 &&\n    rows.some((r) => r.owner !== who)) {\n  // one of them belongs to someone else\n  fail(leg, "an open answered another owner\'s entry");\n}\n',
  },
  {
    path: "zz-planted/blind-else/run.mts",
    refuse: true,
    line: 2,
    text: 'if (missing) note("x");\nelse if (done.length >= 1 && made !== 1) failures.push(`${made} made it`);\n',
  },
  {
    path: "zz-planted/polling/run.mts",
    refuse: false,
    text: "while (Date.now() < deadline) {\n  if (opened.length > 0 && opened.every((e) => e.sessionId !== null)) {\n    if (opened.length > 1) fail(leg, \"two opened\");\n    return opened[0];\n  }\n}\n",
  },
  {
    path: "zz-planted/sameness/run.mts",
    refuse: false,
    text: 'if (answers.length > 1 && new Set(answers).size === 1) {\n  failures.push("every seat gave the same answer");\n}\n',
  },
];

/**
 * Plant {@link PLANTS} into a tree and report, for each, whether the scan
 * read it as it must.
 * @param {Map<string, string>} tree
 */
export function control(tree) {
  const files = new Map(tree);
  for (const plant of PLANTS) files.set(plant.path, plant.text);
  const hits = scan(files);
  const results = PLANTS.map((p) => {
    const flagged = hits.filter((h) => h.path === p.path);
    const right = p.refuse ? flagged.length === 1 && flagged[0].line === p.line : flagged.length === 0;
    return { what: `${p.path}${p.refuse ? `:${p.line}` : ""} (${p.refuse ? "must refuse" : "must leave alone"})`, right, flagged };
  });
  return { results, ok: results.every((r) => r.right) };
}

function main() {
  const at = process.argv.indexOf("--root");
  const root = at >= 0 ? process.argv[at + 1] : GOALS_ROOT;
  const tree = readTree(root);
  if (process.argv.includes("--control")) {
    const { results, ok } = control(tree);
    for (const r of results) {
      const read = r.flagged.length === 0 ? "not flagged" : `flagged at ${r.flagged.map((h) => h.line).join(", ")}`;
      console.log(`plant ${r.what}: ${read}${r.right ? "" : " · WRONG"}`);
    }
    console.log(ok ? "CONTROL PASS · every plant was read as it must be" : "CONTROL FAIL");
    process.exitCode = ok ? 0 : 1;
    return;
  }
  const hits = scan(tree);
  for (const h of hits) console.error(`${h.path}:${h.line}  ${h.text}`);
  if (hits.length > 0) {
    console.error(
      `FAIL · ${hits.length} length guard(s) skip a failure on an empty list. ` +
        "Floor the list with tell.over (goals/lib/verdict.mts) and drop the guard; see goals/README.md → Script techniques #5.",
    );
    process.exitCode = 1;
    return;
  }
  console.log(`check-tell-suppress: PASS · ${tree.size} goal source files, no length guard ahead of a failure`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) main();
