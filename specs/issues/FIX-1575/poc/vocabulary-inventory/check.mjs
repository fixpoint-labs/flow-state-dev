#!/usr/bin/env node
// FIX-1575 vocabulary inventory — the spec's factual base, re-derived.
//
//   node check.mjs [root]            before: every hit in scope is claimed by exactly one
//                                    ledger entry, every entry claims exactly its count.
//   node check.mjs [root] --after    after implementation: every F entry claims nothing,
//                                    every R/K entry still claims its count (no public
//                                    rename slipped in), and any other hit carries the
//                                    vocabulary only as a retained public name inside a
//                                    `code span` (BR-3). A span holding any other Workforce
//                                    word is not exempt. Residual: a bare `seat` span is the
//                                    kept field spelled exactly; whether the prose around it
//                                    uses it as the field or as a concept is review's call.
//   node check.mjs [root] --self-test [--after]  negative controls: planted defects must
//                                    fail; the clean tree is checked in the mode --after picks.
//
// Retained spec evidence, not production code; nothing imports it and no CI job runs it.
import path from "node:path";
import { scan } from "./scan.mjs";
import { LEDGER } from "./ledger.mjs";
import { VOCAB } from "./scan.mjs";

/** The public names Layer 1 keeps (D2, KC), the only vocabulary a code span may carry. */
const RETAINED = /"seats"|\b(?:seat|listSeats|resolveToolSeats|toolSeatFence)\b/g;
const isRetainedSpan = (span) => !VOCAB.some((re) => re.test(span.replace(RETAINED, "")));
const stripCode = (text) => text.replace(/`[^`]*`/g, (span) => (isRetainedSpan(span) ? "" : span));

export function check(hits, ledger, { after = false } = {}) {
  const problems = [];
  const claims = new Map(ledger.map((e) => [e, 0]));
  for (const hit of hits) {
    const owners = ledger.filter((e) => e.file === hit.file && hit.text.includes(e.has));
    if (owners.length > 1) problems.push(`claimed twice: ${hit.file}:${hit.line}`);
    if (owners.length === 1) { claims.set(owners[0], claims.get(owners[0]) + 1); continue; }
    if (owners.length === 0) {
      if (after && !VOCAB.some((re) => re.test(stripCode(hit.text)))) continue;
      problems.push(`unclassified: ${hit.file}:${hit.line}: ${hit.text.trim().slice(0, 100)}`);
    }
  }
  for (const [e, count] of claims) {
    const want = after && e.c === "F" ? 0 : (e.n ?? 1);
    if (count !== want) problems.push(`${e.c} "${e.has}" in ${e.file}: claims ${count}, expected ${want}`);
  }
  return problems;
}

function tally(ledger) {
  const t = {};
  for (const e of ledger) t[e.c] = (t[e.c] ?? 0) + (e.n ?? 1);
  return t;
}

function selfTest(root, after) {
  const hits = scan(root);
  const mode = { after };
  const base = check(hits, LEDGER, mode);
  const lingering = { file: "packages/engine/src/execution/runAction.ts", line: 999, text: " * so a seat another board holds would claim a row" };
  const results = [
    [`clean tree passes (${mode.after ? "--after" : "before"})`, base.length === 0],
    ["planted unclassified hit fails", check([...hits, { file: "packages/core/src/x.ts", line: 1, text: "// the roster of hired seats" }], LEDGER, mode).some((p) => p.startsWith("unclassified"))],
    ["planted hit inside a kept file fails", check([...hits, { file: "packages/engine/src/stores/filesystem/trace-store.ts", line: 999, text: "// a hired seat" }], LEDGER, mode).length > 0],
    ["a dropped hit fails its entry's count", check(hits.slice(1), LEDGER, mode).length > 0],
    ["--after fails while an F line remains", check([...hits, lingering], LEDGER, { after: true }).some((p) => p.startsWith("F "))],
    ["--after fails if a kept public name is renamed", check(hits.filter((h) => !h.text.includes("seat: z.string()")), LEDGER, { after: true }).some((p) => p.startsWith("R1"))],
    ["--after accepts a reworded line whose only hit is a retained name in a code span", check([{ file: "packages/core/src/types/dispatch.ts", line: 1, text: "* `seat` names the assignee" }], [], { after: true }).length === 0],
    ["--after fails an unwanted word hidden in a code span", check([{ file: "packages/core/src/types/dispatch.ts", line: 1, text: "* the board's `hired seat` or `roster` sends" }], [], { after: true }).some((p) => p.startsWith("unclassified"))],
  ];
  for (const [name, ok] of results) console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (base.length) console.log(base.join("\n"));
  process.exit(results.every(([, ok]) => ok) ? 0 : 1);
}

const args = process.argv.slice(2);
const root = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".");
if (args.includes("--self-test")) selfTest(root, args.includes("--after"));
else {
  const after = args.includes("--after");
  const hits = scan(root);
  const problems = check(hits, LEDGER, { after });
  console.log(`${hits.length} hit lines in scope; ledger: ${JSON.stringify(tally(LEDGER))}`);
  if (problems.length) { console.log(problems.join("\n")); process.exit(1); }
  console.log(after ? "after: every F line is gone; every kept line is intact" : "before: every hit is classified exactly once");
}
