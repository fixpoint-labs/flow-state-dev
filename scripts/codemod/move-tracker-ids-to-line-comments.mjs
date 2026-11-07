#!/usr/bin/env node
/**
 * One-shot codemod: move tracker and process ids out of JSDoc blocks into a
 * `//` pointer line above the block, so the hover reads what the code does and
 * the pointer stays for us (BP-006). It handles only the shapes a rewrite
 * cannot get wrong, leaves every other block for a hand edit and lists it;
 * `pnpm lint` (`fsd/no-tracker-ids`) is the check that none is left.
 *
 * An id goes with the smallest piece of text that is only a pointer: a
 * parenthetical (`(FIX-2133 D2, the epic FIX-2058's ER-8)`), a segment of one
 * (`(a dispatched wait, FIX-2082)`), an `@see FIX-123` line, a sentence
 * (`See FIX-663.`) or a sentence's leading or trailing segment (`Per BP-030,
 * dual-read` reads `Dual-read`). "Only a pointer" means nothing is left once
 * ids and pointer words (`the epic`, `D2`, `see`, `per`) are taken out. An id
 * inside prose (`stored before FIX-2078`) is left: its sentence needs a
 * rewrite, not a cut. A block is rewritten only when every id in it moved, and
 * never when it would be left empty.
 *
 *   node scripts/codemod/move-tracker-ids-to-line-comments.mjs [--write] <file>... | --files-from <list>
 */
import { readFileSync, writeFileSync } from "node:fs";
import tseslint from "typescript-eslint";
import { TRACKER_ID } from "../eslint-rules/no-tracker-ids.mjs";

const IDS = new RegExp(TRACKER_ID.source, "g");

/** Words a pointer is made of, beside the ids. */
const POINTER_WORDS = new RegExp(
  "\\b(?:" +
    [
      "the", "epic", "epics", "spec", "specs", "issue", "issues", "see", "per", "and", "or", "of", "in", "its",
      "from", "as", "for", "PR", "PRs", "follow-?up", "D\\d+[a-z]?", "ER-\\d+", "E\\d+", "Q\\d+", "R\\d+", "S\\d+",
      "AC\\d*", "V\\d+", "BUSINESS-RULES(?:\\.md)?", "DECISIONS(?:\\.md)?", "SPEC(?:\\.md)?", "PLAN(?:\\.md)?",
      "rule", "rules", "decision", "decisions", "row", "step", "phase", "part", "wave", "slice", "fix", "review",
      "round", "finding", "amendment", "goal", "cell", "scope", "by", "with", "on", "a", "an", "s", "e\\.g", "i\\.e",
      "cf", "tracked", "tracking", "contract", "narrowed", "widened", "extended", "folded", "superseded", "also",
      "see also", "original", "follow", "plan", "model", "census", "audit", "pr\\d*", "\\d+[A-Za-z]{0,2}", "waves?",
    ].join("|") +
    ")\\b",
  "gi",
);

/** Collapse a JSDoc fragment that may span lines to one line of text. */
const oneLine = (s) => s.replace(/\s*\n\s*\*\s?/g, " ").replace(/\s+/g, " ").trim();

/** True when what is left, ids and pointer words gone, is no prose. */
function pointerOnly(text) {
  IDS.lastIndex = 0;
  if (!IDS.test(text)) return false;
  const rest = oneLine(text).replace(IDS, " ").replace(/§\s*[\d.]+/g, " ").replace(POINTER_WORDS, " ");
  return rest.replace(/[^A-Za-z]+/g, " ").trim() === "";
}

/** Mask backtick spans so a separator or paren inside code is not read as one. */
const masked = (s) => s.replace(/`[^`\n]*`/g, (m) => "`" + "x".repeat(m.length - 2) + "`");

/** Index of the `(` that encloses `at`, or -1. */
function openParen(text, at) {
  let depth = 0;
  for (let i = at; i >= 0; i--) {
    if (text[i] === ")") depth++;
    else if (text[i] === "(") {
      if (depth === 0) return i;
      depth--;
    }
  }
  return -1;
}

/** Index of the `)` that closes the `(` at `open`, or -1. */
function closeParen(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "(") depth++;
    else if (text[i] === ")") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Separators between a pointer and the prose beside it. */
const SEPARATOR = /\s*(?:[,;:]|\s[—–]|\s--?)(?:[ \t]*\n[ \t]*\*)?[ \t]+/g;

/**
 * Within `[from, to)` of `text`, the range to cut so the segment holding the id
 * at `at` goes with one separator, or null when that segment is prose.
 */
function segmentCut(text, from, to, at) {
  const inner = masked(text.slice(from, to));
  const seps = [...inner.matchAll(SEPARATOR)].map((m) => ({ start: from + m.index, end: from + m.index + m[0].length }));
  const bounds = [{ start: from, end: from }, ...seps, { start: to, end: to }];
  for (let k = 0; k + 1 < bounds.length; k++) {
    const segStart = bounds[k].end;
    const segEnd = bounds[k + 1].start;
    if (at < segStart || at >= segEnd) continue;
    const segment = text.slice(segStart, segEnd);
    if (!pointerOnly(segment)) return null;
    if (bounds.length === 2) return { start: from, end: to, segment, whole: true };
    // Drop the separator before it, or, for the first segment, the one after.
    if (k > 0) return { start: bounds[k].start, end: segEnd, segment };
    return { start: segStart, end: bounds[k + 1].end, segment, first: true };
  }
  return null;
}

/** Remove `[start, end)` from `text`, closing up the junction it leaves. */
function cut(text, start, end, capitalise = false) {
  let head = text.slice(0, start);
  let tail = text.slice(end);
  // A cut that opens its comment line hands its punctuation to the line above;
  // the rest of the line stays where it was.
  const prefix = /\n[ \t]*\*[ \t]*$/.exec(head);
  const punct = /^([.,;:!?])[ \t]*/.exec(tail);
  if (prefix && punct) {
    head = head.slice(0, prefix.index).replace(/[ \t]+$/, "") + punct[1];
    tail = /^\s*(\n|\*\/|$)/.test(tail.slice(punct[0].length)) ? tail.slice(punct[0].length) : prefix[0] + tail.slice(punct[0].length);
  }
  if (/^[.,;:)!?]/.test(tail) || /^[ \t]*(\n|$)/.test(tail)) head = head.replace(/[ \t]+$/, "");
  if (/[ \t]$/.test(head) && /^[ \t]/.test(tail)) tail = tail.replace(/^[ \t]+/, "");
  if (/[.,;:]$/.test(head) && /^[.,;:]/.test(tail)) tail = tail.slice(1);
  if (capitalise) tail = tail.replace(/^([ \t]*)([a-z])/, (_, ws, c) => ws + c.toUpperCase());
  return { text: head + tail, at: head.length };
}

/** True when the comment line starting at `i` (after its `\n`) is blank or starts a tag or list item. */
const breakLine = (m, i) => /^[ \t]*\*?[ \t]*(?:$|\n|\*\/|@|- |\d+\. |#)/.test(m.slice(i, i + 16));

/** The sentence holding `at`: from the previous stop, blank line or opener to the next stop. */
function sentenceAround(text, at) {
  const m = masked(text);
  let start = at;
  for (; start > 0; start--) {
    if (/[.!?]\s/.test(m.slice(start - 2, start)) && !/\b(?:e\.g|i\.e|cf)\.\s$/.test(m.slice(start - 6, start))) break;
    if (m.slice(start - 3, start) === "/**") break;
    if (m[start - 1] === "\n" && (breakLine(m, start) || breakLine(m, m.lastIndexOf("\n", start - 2) + 1))) break;
  }
  while (start < at && /[\s*]/.test(m[start])) start++;
  let end = at;
  for (; end < m.length; end++) {
    if (/[.!?]/.test(m[end]) && /\s/.test(m[end + 1] ?? " ")) {
      end++;
      break;
    }
    if (m.slice(end, end + 2) === "*/") break;
    if (m[end] === "\n" && breakLine(m, end + 1)) break;
  }
  while (end > at && /\s/.test(m[end - 1])) end--;
  return { start, end };
}

/** Remove the comment line holding `at` (the last character before a cut) when the cut left it empty. */
function dropEmptiedLine(text, at) {
  const lineStart = text.lastIndexOf("\n", at) + 1;
  const lineEnd = text.indexOf("\n", lineStart);
  if (lineEnd < 0) return text;
  if (!/^[ \t]*\*[ \t]*$/.test(text.slice(lineStart, lineEnd))) return text;
  return text.slice(0, lineStart) + text.slice(lineEnd + 1);
}

/**
 * Rewrite one JSDoc block's text. Returns `{ text, pointers }` when every id
 * moved, or `{ left }` naming the line it could not move.
 */
export function rewriteBlock(block) {
  let text = block;
  const pointers = [];
  for (let guard = 0; guard < 50; guard++) {
    IDS.lastIndex = 0;
    const m = IDS.exec(text);
    if (!m) break;
    const at = m.index;
    const lineStart = text.lastIndexOf("\n", at) + 1;
    let lineEnd = text.indexOf("\n", at);
    if (lineEnd < 0) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd);
    const see = /^\s*\*\s*@see\s+(.*)$/.exec(line);
    if (see && !line.includes("*/") && pointerOnly(see[1])) {
      pointers.push(oneLine(see[1]));
      text = text.slice(0, lineStart) + text.slice(lineEnd + 1);
      continue;
    }
    const mask = masked(text);
    const open = openParen(mask, at);
    const close = open >= 0 ? closeParen(mask, open) : -1;
    if (open >= 0 && close > at) {
      const c = pointerOnly(text.slice(open + 1, close))
        ? { whole: true, segment: text.slice(open + 1, close) }
        : segmentCut(text, open + 1, close, at);
      if (!c) return { left: oneLine(line).slice(0, 160) };
      pointers.push(oneLine(c.segment));
      const done = c.whole ? cut(text, open, close + 1) : cut(text, c.start, c.end);
      text = dropEmptiedLine(done.text, done.at - 1);
      continue;
    }
    const s = sentenceAround(text, at);
    const c = segmentCut(text, s.start, s.end, at);
    if (!c) return { left: oneLine(line).slice(0, 160) };
    pointers.push(oneLine(c.segment).replace(/[.!?]$/, ""));
    if (c.whole) {
      let end = c.end;
      while (end < text.length && text[end] === " ") end++;
      const rest = text.slice(end);
      const head = /^[ \t]*(\n|\*\/|$)/.test(rest) ? text.slice(0, c.start).replace(/[ \t]+$/, "") : text.slice(0, c.start);
      // The sentence was the whole line: the line goes.
      text = dropEmptiedLine(head + rest, head.length - 1);
    } else {
      const done = cut(text, c.start, c.end, c.first);
      text = dropEmptiedLine(done.text, done.at - 1);
    }
  }
  const body = text.replace(/^\/\*\*|\*\/$/g, "").replace(/^\s*\*/gm, "").trim();
  if (!/[A-Za-z]/.test(body)) return { left: `the block would be empty: ${oneLine(block).slice(0, 120)}` };
  return { text, pointers };
}

/** Rewrite one file's source. Returns `{ source, moved, left }`. */
export function rewriteSource(source, filePath) {
  const jsx = /\.[jt]sx$/.test(filePath);
  const { ast } = tseslint.parser.parseForESLint(source, { comment: true, range: true, loc: true, jsx, filePath });
  const edits = [];
  const left = [];
  let moved = 0;
  for (const c of ast.comments) {
    if (c.type !== "Block" || !/^[*!]/.test(c.value)) continue;
    const block = source.slice(c.range[0], c.range[1]);
    IDS.lastIndex = 0;
    if (!IDS.test(block)) continue;
    const lineStart = source.lastIndexOf("\n", c.range[0] - 1) + 1;
    const lead = source.slice(lineStart, c.range[0]);
    // A block inside a JSX expression or after code on its line: hand edit.
    if (!/^\s*$/.test(lead)) {
      left.push(`${filePath}:${c.loc.start.line}  block does not start its line`);
      continue;
    }
    const result = rewriteBlock(block);
    if (result.left) {
      left.push(`${filePath}:${c.loc.start.line}  ${result.left}`);
      continue;
    }
    const pointers = [...new Set(result.pointers.map((p) => p.replace(/[.;,\s]+$/, "")))];
    const pointer = `${lead}// ${pointers.join("; ")}.\n`;
    edits.push({ from: lineStart, to: c.range[1], text: pointer + lead + result.text });
    moved++;
  }
  let out = source;
  for (const e of edits.sort((a, b) => b.from - a.from)) out = out.slice(0, e.from) + e.text + out.slice(e.to);
  return { source: out, moved, left };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const list = args.indexOf("--files-from");
  const files =
    list >= 0 ? readFileSync(args[list + 1], "utf8").split("\n").filter(Boolean) : args.filter((a) => !a.startsWith("--"));
  let moved = 0;
  const left = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    const r = rewriteSource(source, file);
    moved += r.moved;
    left.push(...r.left);
    if (write && r.source !== source) writeFileSync(file, r.source);
  }
  for (const l of left) console.log(l);
  console.error(`${moved} block(s) rewritten, ${left.length} left for a hand edit`);
}
