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
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { artifactSnapshotPath, readScoreboard } from "../../../labs/trading-desk/eval/scoreboard";
import { blindBundle } from "../../../labs/trading-desk/eval/blinding";
import { RUBRICS } from "../../../labs/trading-desk/eval/rubrics";
import { runArtifactsStateSchema } from "../../../labs/trading-desk/flows/analysis/run-artifacts";
import { TRADING_DESK, goalTmpDir, runGoal } from "../../lib/index.mts";

const OUT = goalTmpDir("desk-eval");
const MANIFEST = join(OUT, "manifest.json");
const REQUESTED_K = 3;

writeFileSync(
  MANIFEST,
  JSON.stringify([
    { ticker: "NVDA", costPreset: "fast", dataSource: "fixture" },
    { ticker: "AAPL", costPreset: "fast", dataSource: "fixture" },
  ]),
);

/** Run the desk's own eval CLI; return its exit code (non-zero is data here). */
function evalCli(args: string[]): number {
  try {
    execFileSync("pnpm", ["eval", ...args], { stdio: "inherit", cwd: TRADING_DESK });
    return 0;
  } catch (err) {
    const status = (err as { status?: number }).status;
    return typeof status === "number" ? status : 1;
  }
}

/** Deep-strip run-identity keys (ticker/date) so the anti-stub comparison keys
 *  on SUBSTANTIVE artifact content only. `blindBundle` deliberately keeps the
 *  ticker/date (the judge needs them), but the manifest's two tuples already
 *  differ on ticker — so a stub that hardcodes identical memos while echoing the
 *  session ticker would still produce two distinct blinded bundles. Removing the
 *  identity keys everywhere they appear closes that loophole: two REAL runs still
 *  differ on memo bodies/numbers, a content-echoing stub collapses to one. */
function stripRunIdentity(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripRunIdentity);
  if (value != null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === "ticker" || k === "date" || k === "asOfDate") continue;
      out[k] = stripRunIdentity(v);
    }
    return out;
  }
  return value;
}

await runGoal(() => {
  const failures: string[] = [];

  // 1. Sweep the two-tuple manifest (k=3 to bound cost). A non-zero exit means a
  //    run errored or a hard invariant failed — the scoreboard still records, and
  //    the assertions below re-derive the verdict, so don't bail on the code alone.
  evalCli(["sweep", "--manifest", MANIFEST, "--out", OUT, "--k", String(REQUESTED_K)]);

  const scoreboardPath = join(OUT, "scoreboard.jsonl");
  let sessionIds: string[] = [];
  try {
    // Read via the suite's own torn-line-tolerant reader (not a weaker inline copy).
    const records = readScoreboard(scoreboardPath);

    if (records.length !== 2) failures.push(`expected 2 scoreboard lines, got ${records.length}`);
    sessionIds = records.map((r) => r.sessionId);

    // Anti-stub: compare the PROVENANCE-STRIPPED bundles, not raw snapshot bytes
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
      const judgeKeys = rec.judges.map((dim) => dim.dimension);
      if (
        judgeKeys.length !== RUBRICS.length ||
        new Set(judgeKeys).size !== RUBRICS.length ||
        RUBRICS.some((rubric) => !judgeKeys.includes(rubric.key))
      ) {
        failures.push(`${rec.ticker}: scoreboard judge dimensions do not match the declared rubrics`);
      }
      for (const dim of rec.judges) {
        if (dim.status !== "scored") {
          failures.push(`${rec.ticker}/${dim.dimension}: ${dim.status} (${dim.skipReason ?? ""})`);
          continue;
        }
        if (dim.k !== REQUESTED_K || dim.scores.length !== REQUESTED_K) {
          failures.push(
            `${rec.ticker}/${dim.dimension}: expected k=${REQUESTED_K} and ${REQUESTED_K} scores, got k=${dim.k} and ${dim.scores.length} scores`,
          );
        }
        if (dim.scores.some((s) => s < 0 || s > 1)) {
          failures.push(`${rec.ticker}/${dim.dimension}: a score is outside [0,1]`);
        }
      }

      // Anti-game: read the SIDECAR — non-empty per-criterion reasoning AND evidence.
      const detail = JSON.parse(readFileSync(rec.detailPath, "utf8")) as {
        judges?: Array<{
          key: string;
          status: string;
          repeats: Array<{
            findings: Array<{ criterion: string; assessment: string; evidence?: string }>;
          }>;
        }>;
      };
      for (const rubric of RUBRICS) {
        const dim = detail.judges?.find((candidate) => candidate.key === rubric.key);
        if (dim == null || dim.status !== "scored") {
          failures.push(`${rec.ticker}/${rubric.key}: missing scored judge detail`);
          continue;
        }
        if (dim.repeats.length !== REQUESTED_K) {
          failures.push(
            `${rec.ticker}/${dim.key}: expected ${REQUESTED_K} sidecar repeats, got ${dim.repeats.length}`,
          );
        }
        for (const [repeatIndex, repeat] of dim.repeats.entries()) {
          const criteria = repeat.findings.map((finding) => finding.criterion);
          const exactCriteria =
            criteria.length === rubric.criteria.length &&
            new Set(criteria).size === rubric.criteria.length &&
            rubric.criteria.every((criterion) => criteria.includes(criterion));
          if (!exactCriteria) {
            failures.push(
              `${rec.ticker}/${dim.key}/repeat-${repeatIndex + 1}: findings do not match the declared criteria exactly once`,
            );
          }
          const allReasoned = repeat.findings.every(
            (finding) =>
              finding.assessment.trim().length > 0 && (finding.evidence?.trim().length ?? 0) > 0,
          );
          if (!allReasoned) {
            failures.push(
              `${rec.ticker}/${dim.key}/repeat-${repeatIndex + 1}: empty judge reasoning or evidence in the sidecar`,
            );
          }
        }
      }

      // The stored bundle must differ between the two runs — compared blinded AND
      // with run identity (ticker/date) stripped, so a stub that hardcodes identical
      // artifacts while merely echoing the session ticker is still caught (the
      // sessionId always differs, and blindBundle keeps ticker/date, so neither can
      // carry the comparison on its own).
      const snapshot = JSON.parse(readFileSync(artifactSnapshotPath(OUT, rec.sessionId), "utf8"));
      blindedBundles.add(
        JSON.stringify(stripRunIdentity(blindBundle(runArtifactsStateSchema.parse(snapshot)))),
      );
    }
    if (records.length === 2 && blindedBundles.size < 2) {
      failures.push("the two runs produced identical content bundles (stubbed read path?)");
    }
  } catch (err) {
    failures.push(`scoreboard read/parse failed: ${(err as Error).message}`);
  }

  // 2. Variance across both sessions (k=3). Alpha requires ≥2 sessions.
  if (sessionIds.length === 2 && failures.length === 0) {
    evalCli([
      "variance",
      "--session",
      sessionIds[0],
      "--session",
      sessionIds[1],
      "--out",
      OUT,
      "--data-dir",
      join(OUT, "data"),
      "--k",
      String(REQUESTED_K),
    ]);
    try {
      const varianceFile = readdirSync(OUT)
        .filter((f) => f.startsWith("variance."))
        .sort()
        .pop();
      if (!varianceFile) throw new Error("no variance report written");
      const report = JSON.parse(readFileSync(join(OUT, varianceFile), "utf8")) as {
        dimensions: Array<{ dimension: string; alpha: number | null; bySession: Array<{ std: number }> }>;
      };
      // Every DECLARED rubric must carry a noise measurement (goal.md). Looping the
      // report's own dimensions would pass vacuously if aggregation dropped one —
      // cross-check the report's keys against RUBRICS, as the scoreboard check above does.
      const varianceKeys = report.dimensions.map((dim) => dim.dimension);
      if (
        varianceKeys.length !== RUBRICS.length ||
        new Set(varianceKeys).size !== RUBRICS.length ||
        RUBRICS.some((rubric) => !varianceKeys.includes(rubric.key))
      ) {
        failures.push("variance report dimensions do not match the declared rubrics");
      }
      for (const dim of report.dimensions) {
        if (dim.bySession.length === 0) failures.push(`variance/${dim.dimension}: no per-session std recorded`);
        if (dim.alpha === null) failures.push(`variance/${dim.dimension}: alpha not computed across 2 sessions`);
      }
    } catch (err) {
      failures.push(`variance read/parse failed: ${(err as Error).message}`);
    }
  }

  return {
    failures,
    evidence: `2 runs scored (deterministic + judged), variance + alpha recorded. Scoreboard: ${join(OUT, "scoreboard.jsonl")}`,
  };
});
