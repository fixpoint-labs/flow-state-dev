/**
 * Goal check — the run-quality eval suite produces a trustworthy per-run score.
 *
 * Drives the real path: `pnpm eval sweep` over a two-tuple fixture manifest
 * (NVDA + AAPL, fast), real models end-to-end including judges, then `pnpm eval
 * variance` across both sessions. Asserts the scoreboard + detail sidecars +
 * variance report against the contract in goal.md. See goal.md for the anti-game
 * rationale.
 *
 * Run: pnpm tsx goals/trading-desk-eval/fixture-batch-scored/run.mts
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readScoreboard } from "../../../labs/trading-desk/eval/scoreboard";
import { blindBundle } from "../../../labs/trading-desk/eval/blinding";
import { runArtifactsStateSchema } from "../../../labs/trading-desk/flows/analysis/run-artifacts";

const APP = fileURLToPath(new URL("../../../labs/trading-desk", import.meta.url));
const OUT = join(APP, ".fsdev", `eval-goal-${Date.now()}`);
const MANIFEST = join(OUT, "manifest.json");

mkdirSync(OUT, { recursive: true });
writeFileSync(
  MANIFEST,
  JSON.stringify([
    { ticker: "NVDA", costPreset: "fast", dataSource: "fixture" },
    { ticker: "AAPL", costPreset: "fast", dataSource: "fixture" },
  ]),
);

function evalCli(args: string[]): number {
  try {
    execFileSync("pnpm", ["eval", ...args], { stdio: "inherit", cwd: APP });
    return 0;
  } catch (err) {
    return typeof (err as { status?: number }).status === "number"
      ? (err as { status: number }).status
      : 1;
  }
}

const failures: string[] = [];

// 1. Sweep the two-tuple manifest (k=3 to bound cost). A non-zero exit means a
//    run errored or a hard invariant failed — the scoreboard still records, and
//    the assertions below re-derive the verdict, so don't bail on the code alone.
evalCli(["sweep", "--manifest", MANIFEST, "--out", OUT, "--k", "3"]);

const scoreboardPath = join(OUT, "scoreboard.jsonl");
let sessionIds: string[] = [];
try {
  // Read via the suite's own torn-line-tolerant reader (not a weaker inline copy).
  const records = readScoreboard(scoreboardPath);

  if (records.length !== 2) failures.push(`expected 2 scoreboard lines, got ${records.length}`);
  sessionIds = records.map((r) => r.sessionId);

  // Anti-stub: compare the PROVENANCE-STRIPPED bundles, not raw capture bytes
  // (which always differ by sessionId/timestamps even for a stubbed identical read).
  const blindedBundles = new Set<string>();
  for (const rec of records) {
    if (rec.runStatus !== "completed") failures.push(`${rec.ticker}: runStatus ${rec.runStatus}`);
    if (rec.invariants.hardFailed > 0) {
      failures.push(
        `${rec.ticker}: ${rec.invariants.hardFailed} hard invariant failure(s): ` +
          rec.invariants.failures.map((f) => f.id).join(", "),
      );
    }
    if (rec.judges === null) {
      failures.push(`${rec.ticker}: judge layer was skipped entirely`);
      continue;
    }
    for (const dim of rec.judges) {
      if (dim.status !== "scored") {
        failures.push(`${rec.ticker}/${dim.dimension}: ${dim.status} (${dim.skipReason ?? ""})`);
        continue;
      }
      if (dim.scores.length !== dim.k) failures.push(`${rec.ticker}/${dim.dimension}: ${dim.scores.length} scores for k=${dim.k}`);
      if (dim.scores.some((s) => s < 0 || s > 1)) failures.push(`${rec.ticker}/${dim.dimension}: a score is outside [0,1]`);
    }

    // Anti-game: read the SIDECAR — non-empty per-criterion reasoning AND evidence.
    const detail = JSON.parse(readFileSync(rec.detailPath, "utf8")) as {
      judges?: Array<{ key: string; status: string; repeats: Array<{ findings: Array<{ assessment: string; evidence?: string }> }> }>;
    };
    for (const dim of detail.judges ?? []) {
      if (dim.status !== "scored") continue;
      const anyReasoned = dim.repeats.some(
        (r) =>
          r.findings.length > 0 &&
          r.findings.every(
            (f) => f.assessment.trim().length > 0 && (f.evidence?.trim().length ?? 0) > 0,
          ),
      );
      if (!anyReasoned) failures.push(`${rec.ticker}/${dim.key}: empty judge reasoning or evidence in the sidecar`);
    }

    // The stored bundle must differ between the two runs — compared blinded, so
    // a stubbed identical read is caught even though sessionIds always differ.
    const cap = JSON.parse(readFileSync(join(OUT, "captures", `${rec.sessionId}.artifacts.json`), "utf8")) as {
      result?: { output?: unknown };
    };
    blindedBundles.add(JSON.stringify(blindBundle(runArtifactsStateSchema.parse(cap.result?.output))));
  }
  if (records.length === 2 && blindedBundles.size < 2) failures.push("the two runs produced identical blinded bundles (stubbed read path?)");
} catch (err) {
  failures.push(`scoreboard read/parse failed: ${(err as Error).message}`);
}

// 2. Variance across both sessions (k=3). Alpha requires ≥2 sessions.
if (sessionIds.length === 2 && failures.length === 0) {
  evalCli(["variance", "--session", sessionIds[0], "--session", sessionIds[1], "--out", OUT, "--k", "3"]);
  try {
    const varianceFile = readdirSync(OUT).filter((f) => f.startsWith("variance.")).sort().pop();
    if (!varianceFile) throw new Error("no variance report written");
    const report = JSON.parse(readFileSync(join(OUT, varianceFile), "utf8")) as {
      dimensions: Array<{ dimension: string; alpha: number | null; bySession: Array<{ std: number }> }>;
    };
    for (const dim of report.dimensions) {
      if (dim.bySession.length === 0) failures.push(`variance/${dim.dimension}: no per-session std recorded`);
      if (dim.alpha === null) failures.push(`variance/${dim.dimension}: alpha not computed across 2 sessions`);
    }
  } catch (err) {
    failures.push(`variance read/parse failed: ${(err as Error).message}`);
  }
}

if (failures.length === 0) {
  console.log(`PASS — 2 runs scored (deterministic + judged), variance + alpha recorded. Scoreboard: ${scoreboardPath}`);
  process.exit(0);
}
console.error("FAIL —\n" + failures.join("\n"));
process.exit(1);
