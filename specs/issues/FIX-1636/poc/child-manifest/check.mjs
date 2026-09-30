#!/usr/bin/env node
/**
 * FIX-1636 spec evidence: re-derive the closure plan's factual base instead of
 * trusting the hand-written tables in PLAN.md.
 *
 * Throwaway, retained with the spec. Not production code, not in any test root,
 * no dependencies beyond git and Node. It asserts four things:
 *
 *   1. Every merged child's change is on the ref under test (default
 *      `origin/main`): each commit in CHILDREN is an ancestor of it.
 *   2. Totality of the shared HTTP suite, both ways: every `*.test.ts` in
 *      `packages/integration-tests/src/two-users-one-tenant/` is owned by
 *      exactly one child, and every owned case exists.
 *   3. Totality of the epic's child set (only with LINEAR_API_KEY): every child
 *      of FIX-1635 in Linear is either a merged child here (and Done) or on the
 *      NOT_LEGS list, and every merged child here is a child in Linear.
 *   4. It prints, per child, the test files its change added or modified. That
 *      is the part-3 manifest the plan points at.
 *
 * Negative controls (each must exit non-zero):
 *   --control=unowned-case   plants a suite case nobody owns
 *   --control=bad-sha        plants a child commit that is not on the ref
 *   --control=unlisted-child plants a Linear child that is neither merged nor listed
 *
 * Usage: node specs/issues/FIX-1636/poc/child-manifest/check.mjs [--ref=<ref>] [--control=<name>]
 */
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../../../../..", import.meta.url).pathname.replace(/\/$/, "");
const SUITE = "packages/integration-tests/src/two-users-one-tenant";
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")).map(([k, v]) => [k, v ?? true])
);
const REF = args.ref ?? "origin/main";
const CONTROL = args.control;

/**
 * Each merged child: its PRs and the commit ranges that carried its change
 * onto main (`[base, tip]`; a merge commit is `[<sha>^1, <sha>]`), and the
 * shared-suite case it owns, if the epic's ER-16 asks it for one.
 */
const CHILDREN = {
  "FIX-1256": { prs: [1469], ranges: [["47869f9ca^1", "47869f9ca"]] },
  "FIX-1261": { prs: [1470], ranges: [["3b9dd528f^1", "3b9dd528f"]] },
  "FIX-1510": { prs: [2047], ranges: [["e2efa7168^1", "e2efa7168"]] },
  "FIX-1018": { prs: [2377], ranges: [["5886ca846", "71f036a03"]], case: "request-id.test.ts" },
  "FIX-1022": { prs: [2384], ranges: [["71f036a03", "df771cda9"]], case: "session-id.test.ts" },
  "FIX-1021": { prs: [2387], ranges: [["c63ee231c^1", "c63ee231c"]], case: "re-entry.test.ts" },
  "FIX-1046": { prs: [2389], ranges: [["1114d9cfc^1", "1114d9cfc"]], case: "sibling-flow.test.ts" },
  "FIX-1328": { prs: [2383], ranges: [["b1b7ad071^1", "b1b7ad071"]], case: "cross-flow-admission.test.ts" },
  "FIX-1286": { prs: [2400], ranges: [["70f777def^1", "70f777def"]], case: "run-workspace.test.ts" },
  "FIX-1628": { prs: [2381], ranges: [["07df7f9d0^1", "07df7f9d0"]], case: "non-streaming-text.test.ts" },
  "FIX-1634": {
    prs: [2405, 2507],
    ranges: [["9861ecb4c^1", "9861ecb4c"], ["17c7e727a^1", "17c7e727a"]],
    case: "queue-delivery.test.ts"
  },
  "FIX-1431": { prs: [2376], ranges: [["3a834d837^1", "3a834d837"]] },
  "FIX-1334": { prs: [2378], ranges: [["12d8cff9a^1", "12d8cff9a"]] },
  "FIX-1647": { prs: [2393], ranges: [["e3c98be8d^1", "e3c98be8d"]] },
  "FIX-1648": { prs: [2416], ranges: [["d6ea93183^1", "d6ea93183"]] },
  "FIX-1654": { prs: [2430], ranges: [["d74745770^1", "d74745770"]] }
};

/** Children of FIX-1635 that are deliberately not legs of this plan. */
const NOT_LEGS = {
  "FIX-1636": "this issue",
  "FIX-1658": "open follow-up of FIX-1634 PR-A; not a closure leg",
  "FIX-1665": "open follow-up; the owner's question is open, recommendation is to close the epic without it"
};

if (CONTROL === "bad-sha") CHILDREN["FIX-PLANT"] = { prs: [], ranges: [["0000000^1", "0000000"]] };

const git = (...a) =>
  execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
const failures = [];

// 1. Every child's change is on the ref.
for (const [id, c] of Object.entries(CHILDREN)) {
  for (const [, tip] of c.ranges) {
    try {
      execFileSync("git", ["-C", ROOT, "merge-base", "--is-ancestor", tip, REF], { stdio: "ignore" });
    } catch {
      failures.push(`${id}: ${tip} is not on ${REF}`);
    }
  }
}

// 2. Suite totality, both ways.
const onDisk = readdirSync(join(ROOT, SUITE)).filter((f) => f.endsWith(".test.ts"));
if (CONTROL === "unowned-case") onDisk.push("planted-nobody-owns.test.ts");
const owners = {};
for (const [id, c] of Object.entries(CHILDREN)) if (c.case) (owners[c.case] ??= []).push(id);
for (const f of onDisk) {
  const o = owners[f] ?? [];
  if (o.length !== 1) failures.push(`suite case ${f}: owned by ${o.length === 0 ? "nobody" : o.join(", ")}`);
}
for (const f of Object.keys(owners)) if (!onDisk.includes(f)) failures.push(`suite case ${f}: owned but missing`);

// 3. Linear totality (optional).
let linearNote = "skipped: LINEAR_API_KEY not set";
if (process.env.LINEAR_API_KEY) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: { Authorization: process.env.LINEAR_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      query:
        '{ issue(id:"FIX-1635"){ children(first:100){ nodes{ identifier state{name} children{ nodes{ identifier state{name} } } } } } }'
    })
  });
  if (!res.ok) {
    console.log(`✗ Linear answered ${res.status}`);
    process.exit(1);
  }
  const payload = await res.json();
  if (payload.errors?.length) {
    console.log(`✗ Linear: ${payload.errors.map((e) => e.message).join("; ")}`);
    process.exit(1);
  }
  const nodes = payload.data.issue.children.nodes;
  const linear = new Map();
  for (const n of nodes) {
    linear.set(n.identifier, n.state.name);
    for (const s of n.children.nodes) linear.set(s.identifier, s.state.name);
  }
  if (CONTROL === "unlisted-child") linear.set("FIX-PLANT", "Backlog");
  for (const [id, state] of linear) {
    if (NOT_LEGS[id]) continue;
    if (!CHILDREN[id]) failures.push(`Linear child ${id} (${state}) is neither a merged child nor on NOT_LEGS`);
    else if (state !== "Done") failures.push(`${id} is ${state} in Linear, not Done`);
  }
  for (const id of Object.keys(CHILDREN)) if (!linear.has(id)) failures.push(`${id} is not a child of FIX-1635 in Linear`);
  linearNote = `${linear.size} Linear children and sub-issues classified`;
}

// 4. The part-3 manifest: test files each child's change touched, still present on the ref.
const TEST = /(\/test\/|\.test\.|\.spec\.|\/testing\/|scripts\/packed-install\/)/;
if (failures.length === 0) {
  for (const [id, c] of Object.entries(CHILDREN)) {
    const files = new Set();
    for (const [base, tip] of c.ranges) {
      for (const f of git("diff", "--name-only", base, tip).split("\n")) {
        if (TEST.test(f) && !f.startsWith("specs/")) files.add(f);
      }
    }
    const present = [...files].filter((f) => {
      try {
        git("cat-file", "-e", `${REF}:${f}`);
        return true;
      } catch {
        return false;
      }
    });
    const inSuite = present.filter((f) => f.startsWith(SUITE));
    const gone = files.size - present.length;
    console.log(
      `${id} (#${c.prs.join(", #")}): ${present.length} test file(s), ${inSuite.length} in the shared suite` +
        (gone > 0 ? `, ${gone} since removed from the ref` : "")
    );
    for (const f of present) console.log(`    ${f}`);
  }
}

console.log(`\nsuite cases: ${onDisk.length} · children: ${Object.keys(CHILDREN).length} · ${linearNote} · ref ${git("rev-parse", "--short", REF)}`);
if (failures.length > 0) {
  console.log(`\n✗ ${failures.length} failure(s)${CONTROL ? ` under --control=${CONTROL}` : ""}:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log("\n✓ every child is on the ref, every suite case has one owner, the child set is classified");
