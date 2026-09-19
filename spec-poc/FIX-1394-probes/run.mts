/**
 * Run the matrix.
 *
 *   tsx --tsconfig spec-poc/FIX-1394-probes/tsconfig.json spec-poc/FIX-1394-probes/run.mts
 *   ... --fixtures    run V1 instead: six violating fixtures, one per probe
 *
 * Prints one column per candidate and one row per probe, plus every cell's
 * evidence line. A blank cell is impossible by construction: `runCandidate`
 * returns six cells or throws.
 */
import { PROBES, PROBE_QUESTIONS, type Candidate, type Cell } from "./harness/contract.mts";
import { runCandidate, scratchRoot } from "./harness/probes.mts";
import { variantA } from "./variants/a-skill-md.mts";
import { variantB } from "./variants/b-seat-folder.mts";
import { variantC } from "./variants/c-new-file.mts";
import { variantD } from "./variants/d-dont-collapse.mts";
import { EMPTY_PACKAGE, FIXTURES, malformedPackageThrows } from "./fixtures/index.mts";

const MARK = { pass: "PASS", fail: "FAIL", "n/a": "n/a " } as const;

function printMatrix(candidates: Candidate[], columns: Map<string, Cell[]>): void {
  const width = Math.max(...candidates.map((c) => c.id.length + c.title.length + 3), 10);
  const header = candidates.map((c) => `${c.id} · ${c.title}`.padEnd(width)).join(" | ");
  console.log(`\n${"probe".padEnd(6)}| ${header}`);
  console.log("-".repeat(6 + 2 + header.length));
  for (const probe of PROBES) {
    const row = candidates
      .map((c) => {
        const found = columns.get(c.id)!.find((cell) => cell.probe === probe)!;
        return MARK[found.verdict].padEnd(width);
      })
      .join(" | ");
    console.log(`${probe.padEnd(6)}| ${row}`);
  }

  console.log("\nWhat each probe asks");
  for (const probe of PROBES) console.log(`  ${probe}  ${PROBE_QUESTIONS[probe]}`);

  console.log("\nEvidence");
  for (const candidate of candidates) {
    console.log(`\n  ${candidate.id} · ${candidate.title}`);
    console.log(`     authoring: ${candidate.authoring}`);
    for (const cell of columns.get(candidate.id)!) {
      console.log(`     ${cell.probe} ${MARK[cell.verdict]}  ${cell.evidence}`);
    }
  }
}

async function runAll(candidates: Candidate[]): Promise<Map<string, Cell[]>> {
  const columns = new Map<string, Cell[]>();
  for (const candidate of candidates) {
    columns.set(candidate.id, await runCandidate(candidate));
  }
  return columns;
}

if (process.argv.includes("--fixtures")) {
  // V1. Each fixture is a package tree built to fail exactly ONE probe and
  // satisfy the other five. A harness that always said `fail` would look
  // correct against an empty tree; it cannot look correct against these.
  console.log("V1 — the harness can say no, one probe at a time\n");
  let bad = 0;
  for (const fixture of FIXTURES) {
    const cells = await runCandidate(fixture.candidate);
    const failed = cells.filter((c) => c.verdict === "fail").map((c) => c.probe);
    const ok = failed.length === 1 && failed[0] === fixture.violates;
    if (!ok) bad += 1;
    console.log(
      `  ${ok ? "PASS" : "FAIL"}  ${fixture.candidate.id} should fail only ${fixture.violates} — failed [${failed.join(", ") || "nothing"}]`,
    );
    if (!ok) {
      for (const cell of cells) console.log(`          ${cell.probe} ${cell.verdict}  ${cell.evidence}`);
    }
  }
  // The reader control. Not one of the six, because it is not about a probe: it
  // asks whether the authored file reaches the compile at all, which is the
  // defect review round 2 found in round 1's harness.
  console.log("\n  the reader control — is the authored file actually on the path?");
  const empty = await runCandidate(EMPTY_PACKAGE);
  const red = empty.filter((c) => c.verdict === "fail").map((c) => c.probe);
  const emptyOk = ["P1", "P2", "P3"].every((p) => red.includes(p as never));
  if (!emptyOk) bad += 1;
  console.log(
    `  ${emptyOk ? "PASS" : "FAIL"}  an empty \`PACKAGE.md\` fails P1, P2 and P3 — failed [${red.join(", ") || "nothing"}]`,
  );

  const thrown = await malformedPackageThrows(scratchRoot("malformed"));
  const malformedOk = thrown !== null;
  if (!malformedOk) bad += 1;
  console.log(
    `  ${malformedOk ? "PASS" : "FAIL"}  a \`PACKAGE.md\` the parser cannot read is refused: ${thrown ?? "it compiled anyway"}`,
  );

  console.log(
    bad === 0
      ? "\nV1 PASS — every probe has a red state, only its own fixture produces it, and the authored file is on the path."
      : `\nV1 FAIL — ${bad} check(s) did not hold.`,
  );
  process.exit(bad === 0 ? 0 : 1);
}

/**
 * The matrix the ratify records, as an assertion rather than a transcription.
 *
 * V2 used to be "run it and read the output", so a regression could change a
 * cell while the documented command still exited zero and the ratify's table
 * quietly stopped describing the code. These are the recorded verdicts; the run
 * fails loudly on any drift and prints both sides. They are checked, never
 * consulted — no probe can see this table.
 */
const RECORDED: Record<string, Record<string, Cell["verdict"]>> = {
  A: { P1: "fail", P2: "fail", P3: "fail", P4: "pass", P5: "pass", P6: "pass" },
  B: { P1: "pass", P2: "pass", P3: "pass", P4: "pass", P5: "pass", P6: "pass" },
  C: { P1: "pass", P2: "pass", P3: "pass", P4: "pass", P5: "pass", P6: "pass" },
  D: { P1: "n/a", P2: "n/a", P3: "n/a", P4: "n/a", P5: "pass", P6: "pass" },
};

const candidates = [variantA, variantB, variantC, variantD];
const columns = await runAll(candidates);
printMatrix(candidates, columns);

const drift: string[] = [];
const tally: Record<Cell["verdict"], number> = { pass: 0, fail: 0, "n/a": 0 };
for (const candidate of candidates) {
  for (const cell of columns.get(candidate.id)!) {
    tally[cell.verdict] += 1;
    const expected = RECORDED[candidate.id]?.[cell.probe];
    if (expected !== cell.verdict)
      drift.push(`${candidate.id}/${cell.probe}: recorded ${expected ?? "nothing"}, ran ${cell.verdict} — ${cell.evidence}`);
  }
}

console.log(
  `\nV2 tally: ${tally.pass} PASS, ${tally.fail} FAIL, ${tally["n/a"]} n/a across ${tally.pass + tally.fail + tally["n/a"]} cells.`,
);
if (drift.length > 0) {
  console.log(`\nV2 FAIL — the matrix no longer matches what the ratify records:\n  ${drift.join("\n  ")}`);
  process.exit(1);
}
console.log("V2 PASS — every cell matches the verdict recorded in spec/FIX-1394/RATIFY.md.");
