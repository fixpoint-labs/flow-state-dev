/**
 * Model-free check of `runGoal`'s verdict when a goal body throws or reads
 * no evidence — `pnpm check:run-goal-verdict`.
 *
 * A goal grades its legs in order. When an early leg fails and a later leg's
 * setup throws (often because of that earlier failure), the verdict must still
 * name the early leg: it is the real reason, and the throw is a consequence.
 * `runGoal` used to report only the throw, so whoever debugged the run started
 * on the wrong leg.
 *
 * An assertion whose `tell.over` read nothing must say CAN'T TELL, on its own
 * exit code, never PASS; one whose empty result is the claim (`emptyIs`) passes
 * and prints the reason; a real failure beside a can't-tell is a FAIL.
 *
 * `runGoal` exits the process, so each case runs a tiny goal body in its own
 * `tsx` child and grades the exit code and the PASS/FAIL text it printed.
 * No flow, no model, no API key.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const VERDICT = fileURLToPath(new URL("../lib/verdict.mts", import.meta.url));

interface Case {
  /** The goal body: the source of the function handed to `runGoal`. */
  body: string;
  /** Expected exit code. */
  exit: 0 | 1 | 3;
  /** Each must appear in the output, in this order. */
  inOrder: string[];
  /** None may appear in the output. */
  absent?: string[];
}

const CASES: Record<string, Case> = {
  // The bug: leg 1 graded red, leg 2 threw in setup. Leg 1 is the real reason.
  "a later leg throws after an earlier leg failed": {
    body: `async (failures) => {
      failures.push("leg 1: the hire did not survive the restart");
      throw new Error("leg 2 setup: expected one stored roster row, found 0");
    }`,
    exit: 1,
    inOrder: [
      "FAIL —",
      "leg 1: the hire did not survive the restart",
      "then threw: leg 2 setup: expected one stored roster row, found 0",
    ],
  },
  // Nothing graded yet: the throw is the whole story, reported as before.
  "a throw before any leg graded": {
    body: `async () => { throw new Error("setup broke"); }`,
    exit: 1,
    inOrder: ["FAIL —\n  - setup broke"],
    absent: ["then threw"],
  },
  // Synchronous bodies and non-Error throws keep the leg too.
  "a synchronous body throwing a string": {
    body: `(failures) => {
      failures.push("leg 1: wrong answer");
      throw "leg 2 exploded";
    }`,
    exit: 1,
    inOrder: ["leg 1: wrong answer", "then threw: leg 2 exploded"],
  },
  // Goals return copies like [...failures, extra]; each failure prints once.
  "a returned copy of the list is not double-counted": {
    body: `async (failures) => {
      failures.push("leg 1: wrong answer");
      return { failures: [...failures, "leg 2: no row"], evidence: "" };
    }`,
    exit: 1,
    inOrder: ["leg 1: wrong answer", "leg 2: no row"],
  },
  // On a normal return the returned list decides: a goal that filters notes
  // out of what it grades must not have them re-added behind its back.
  "the returned list decides a normal return": {
    body: `async (failures) => {
      failures.push("(note) informational only");
      return { failures: [], evidence: "all legs green" };
    }`,
    exit: 0,
    inOrder: ["PASS — all legs green"],
    absent: ["FAIL", "informational only"],
  },
  // The bug the third verdict exists for: a renamed field filters to [], and
  // [].every() is true. The assertion read nothing, so the run can't tell.
  "an assertion that read nothing is CAN'T TELL, not PASS": {
    body: `async (failures, tell) => {
      const seqs = tell.over("ordering · items' seq", [{ sequence: 1 }].map((i) => i.seq).filter((v) => typeof v === "number"));
      if (!seqs.every((v, i) => i === 0 || seqs[i - 1] <= v)) failures.push("ordering: not non-decreasing");
      return { failures, evidence: "sequence non-decreasing" };
    }`,
    exit: 3,
    inOrder: ["CAN'T TELL —\n  - ordering · items' seq: read 0"],
    absent: ["PASS", "FAIL"],
  },
  "a PASS names what each assertion read": {
    body: `async (failures, tell) => {
      tell.over("ordering · items' seq", [1, 2, 3]);
      return { failures, evidence: "sequence non-decreasing" };
    }`,
    exit: 0,
    inOrder: ["PASS — sequence non-decreasing · read: ordering · items' seq: 3"],
  },
  "an empty read declared the claim passes with its reason": {
    body: `async (failures, tell) => {
      tell.over("leaks · sessions seen", ["s1", "s2"]);
      tell.over("leaks · other users' sessions", [], { emptyIs: "the claim: no session leaks" });
      return { failures, evidence: "no session leaks" };
    }`,
    exit: 0,
    inOrder: ["PASS — no session leaks", "leaks · sessions seen: 2", "leaks · other users' sessions: 0, empty is the claim: no session leaks"],
    absent: ["CAN'T TELL"],
  },
  "one empty read among several of the same name is CAN'T TELL": {
    body: `async (failures, tell) => {
      for (const rows of [[1], [], [2]]) tell.over("b4 · task rows", rows);
      return { failures, evidence: "rows graded" };
    }`,
    exit: 3,
    inOrder: ["b4 · task rows: read 0 in 1 of 3 reads"],
    absent: ["PASS"],
  },
  // emptyIs exempts the call that set it, not every read of the same name.
  "an emptyIs on one read does not excuse another read of the name": {
    body: `async (failures, tell) => {
      tell.over("rows", []);
      tell.over("rows", [], { emptyIs: "no matches expected here" });
      return { failures, evidence: "rows graded" };
    }`,
    exit: 3,
    inOrder: ["CAN'T TELL —\n  - rows: read 0 in 1 of 2 reads"],
    absent: ["PASS"],
  },
  "a failure beside a can't-tell is FAIL and prints both": {
    body: `async (failures, tell) => {
      tell.over("leg a · rows", []);
      failures.push("leg b: wrong answer");
      return { failures, evidence: "" };
    }`,
    exit: 1,
    inOrder: ["FAIL —", "leg b: wrong answer", "CAN'T TELL: leg a · rows: read 0"],
    absent: ["PASS"],
  },
  // A throw is a failure too: the can't-tell recorded before it still prints.
  "a throw after a can't-tell is FAIL and prints both": {
    body: `async (failures, tell) => {
      tell.over("leg a · rows", []);
      throw new Error("leg b setup broke");
    }`,
    exit: 1,
    inOrder: ["FAIL —", "- leg b setup broke", "CAN'T TELL: leg a · rows: read 0"],
    absent: ["PASS"],
  },
};

const dir = mkdtempSync(join(tmpdir(), "run-goal-verdict-"));
const problems: string[] = [];
try {
  for (const [name, c] of Object.entries(CASES)) {
    const file = join(dir, `${Object.keys(CASES).indexOf(name)}.mts`);
    writeFileSync(
      file,
      `import { runGoal } from ${JSON.stringify(VERDICT)};\nawait runGoal(${c.body});\n`,
    );
    const run = spawnSync("pnpm", ["exec", "tsx", file], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      encoding: "utf8",
    });
    const output = `${run.stdout}${run.stderr}`;
    const where: string[] = [];
    if (run.status !== c.exit) where.push(`exit ${run.status}, expected ${c.exit}`);
    let from = 0;
    for (const needle of c.inOrder) {
      const at = output.indexOf(needle, from);
      if (at < 0) {
        where.push(`missing (or out of order): ${JSON.stringify(needle)}`);
      } else {
        from = at + needle.length;
      }
    }
    for (const needle of c.absent ?? []) {
      if (output.includes(needle)) where.push(`should not print ${JSON.stringify(needle)}`);
    }
    for (const needle of c.inOrder) {
      if (output.split(needle).length > 2) where.push(`printed more than once: ${JSON.stringify(needle)}`);
    }
    if (where.length > 0) {
      problems.push(`${name}: ${where.join("; ")}\n      output: ${JSON.stringify(output.slice(0, 400))}`);
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (problems.length > 0) {
  console.error("FAIL —\n  - " + problems.join("\n  - "));
  process.exit(1);
}
console.log(`PASS — ${Object.keys(CASES).length} runGoal verdict cases`);
