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
import { runCandidate } from "./harness/probes.mts";
import { variantA } from "./variants/a-skill-md.mts";
import { variantB } from "./variants/b-seat-folder.mts";
import { variantC } from "./variants/c-new-file.mts";
import { variantD } from "./variants/d-dont-collapse.mts";
import { FIXTURES } from "./fixtures/index.mts";

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
  console.log(
    bad === 0
      ? "\nV1 PASS — every probe has a red state, and only its own fixture produces it."
      : `\nV1 FAIL — ${bad} fixture(s) did not isolate their probe.`,
  );
  process.exit(bad === 0 ? 0 : 1);
}

const candidates = [variantA, variantB, variantC, variantD];
printMatrix(candidates, await runAll(candidates));
