/**
 * The JSONL quality scoreboard (FIX-790).
 *
 * One `QualityRecord` line per evaluated run — deterministic tally + per-dimension
 * judge `{mean, std, k}` kept SEPARABLE (no composite) — appended with a
 * single-line `O_APPEND` write so concurrent appenders never interleave. The
 * bulky detail (full `CheckResult[]` + every judge repeat's raw findings/evidence)
 * lands in a per-run SIDECAR whose filename carries the evaluatedAt timestamp, so
 * re-evaluating a session (different judge model, k, or rubric) never overwrites
 * the sidecar an earlier line points to. The scoreboard line stays grep-able.
 *
 * Assembly (`assembleQualityRecord`, `buildDetail`) is pure; the three IO helpers
 * are the only side-effecting surface. Readers skip torn lines (a JSON.parse
 * failure), so a partial write from a killed process never breaks the corpus.
 */
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { RunArtifactsBundle } from "../flows/analysis/run-artifacts";
import type { JudgeReport } from "./judge";
import {
  qualityRecordSchema,
  type InvariantReport,
  type QualityRecord,
} from "./types";

/** A collision-safe filename component for a session id. Readable ids already
 *  limited to ASCII filename characters are preserved; every other id is
 *  base64url-encoded behind a prefix that readable ids cannot use. */
export function sessionFileStem(sessionId: string): string {
  if (/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(sessionId)) return sessionId;
  return `~${Buffer.from(sessionId, "utf8").toString("base64url")}`;
}

/** The per-run artifact snapshot path: `<outDir>/artifacts/<safeSessionId>.json`. */
export function artifactSnapshotPath(outDir: string, sessionId: string): string {
  return join(outDir, "artifacts", `${sessionFileStem(sessionId)}.json`);
}

/** The per-run detail sidecar path:
 *  `<outDir>/details/<safeSessionId>.<evaluatedAt>.json`.
 *  The timestamp is filesystem-sanitized (`:`/`.` → `-`). */
export function detailSidecarPath(
  outDir: string,
  sessionId: string,
  evaluatedAt: string,
): string {
  const safeTs = evaluatedAt.replace(/[:.]/g, "-");
  return join(outDir, "details", `${sessionFileStem(sessionId)}.${safeTs}.json`);
}

/** Build one scoreboard line from the evaluated pieces. Pure. */
export function assembleQualityRecord(args: {
  bundle: RunArtifactsBundle;
  invariants: InvariantReport;
  judges: JudgeReport | null;
  evaluatedAt: string;
  /** When ANALYZE ran (decisionSnapshot.decidedAt / analyze capture) — never the
   *  read action's own invocation time. Null when unknown. */
  ranAt: string | null;
  detailPath: string;
  extraWarnings?: string[];
}): QualityRecord {
  const { bundle, invariants, judges, evaluatedAt, ranAt, detailPath } = args;
  const s = bundle.summary;

  return {
    evalVersion: 1,
    sessionId: s.sessionId,
    ticker: s.ticker,
    date: s.date,
    costPreset: s.costPreset,
    dataSource: s.dataSource,
    mandateId: s.mandateId,
    runStatus: s.status,
    ranAt,
    evaluatedAt,
    finalRating: s.finalRating,
    decisionConfidence: s.decisionConfidence,
    targetWeightPct: s.targetWeightPct,
    invariants: {
      hardPassed: invariants.hard.passed,
      hardFailed: invariants.hard.failed,
      softPassed: invariants.soft.passed,
      softFlagged: invariants.soft.flagged,
      skipped: invariants.skipped,
      failures: invariants.checks
        .filter((r) => r.severity === "hard" && r.status === "fail")
        .map((r) => ({ id: r.id, detail: r.detail })),
    },
    judges:
      judges === null
        ? null
        : judges.dimensions.map((d) => ({
            dimension: d.key,
            kind: d.kind,
            status: d.status,
            skipReason: d.skipReason,
            mean: d.mean,
            std: d.std,
            k: d.k,
            scores: d.scores,
            costUsd: d.costUsd,
          })),
    judgeModel: judges?.judgeModel ?? null,
    warnings: [...(judges?.warnings ?? []), ...(args.extraWarnings ?? [])],
    detailPath,
  };
}

/** An `error`-status line for a run whose `runArtifacts` read itself failed —
 *  identity fields are null (no bundle to fill them from). */
export function buildErrorRecord(args: {
  sessionId: string;
  evaluatedAt: string;
  detail: string;
  detailPath: string;
  ticker?: string | null;
  date?: string | null;
}): QualityRecord {
  return {
    evalVersion: 1,
    sessionId: args.sessionId,
    ticker: args.ticker ?? null,
    date: args.date ?? null,
    costPreset: null,
    dataSource: null,
    mandateId: null,
    runStatus: "error",
    ranAt: null,
    evaluatedAt: args.evaluatedAt,
    finalRating: null,
    decisionConfidence: null,
    targetWeightPct: null,
    invariants: { hardPassed: 0, hardFailed: 0, softPassed: 0, softFlagged: 0, skipped: 0, failures: [] },
    judges: null,
    judgeModel: null,
    warnings: [args.detail],
    detailPath: args.detailPath,
  };
}

/** The full detail sidecar payload — every check + every judge repeat's raw
 *  findings/evidence. */
export function buildDetail(args: {
  bundle: RunArtifactsBundle;
  invariants: InvariantReport;
  judges: JudgeReport | null;
  evaluatedAt: string;
}): unknown {
  return {
    sessionId: args.bundle.summary.sessionId,
    evaluatedAt: args.evaluatedAt,
    checks: args.invariants.checks,
    judges: args.judges?.dimensions ?? null,
  };
}

/** Append one record as a single JSON line (`O_APPEND`, so concurrent appenders
 *  never interleave). If a killed writer left an unterminated fragment, prefix
 *  a newline so that fragment cannot consume this otherwise-valid record. */
export function appendScoreboardLine(scoreboardPath: string, record: QualityRecord): void {
  mkdirSync(dirname(scoreboardPath), { recursive: true });
  const fd = openSync(scoreboardPath, "a+");
  try {
    const { size } = fstatSync(fd);
    let separator = "";
    if (size > 0) {
      const lastByte = Buffer.allocUnsafe(1);
      readSync(fd, lastByte, 0, 1, size - 1);
      if (lastByte[0] !== 0x0a) separator = "\n";
    }
    appendFileSync(fd, `${separator}${JSON.stringify(record)}\n`, "utf8");
  } finally {
    closeSync(fd);
  }
}

/** Write a run's detail sidecar. */
export function writeDetailSidecar(detailPath: string, detail: unknown): void {
  mkdirSync(dirname(detailPath), { recursive: true });
  writeFileSync(detailPath, JSON.stringify(detail, null, 2), "utf8");
}

/** Read every valid record from a scoreboard, skipping torn / malformed lines
 *  (a killed process's partial write never breaks the corpus). */
export function readScoreboard(scoreboardPath: string): QualityRecord[] {
  if (!existsSync(scoreboardPath)) return [];
  const lines = readFileSync(scoreboardPath, "utf8").split("\n").filter((l) => l.trim().length > 0);
  const records: QualityRecord[] = [];
  for (const line of lines) {
    try {
      records.push(qualityRecordSchema.parse(JSON.parse(line)));
    } catch {
      // Torn or malformed line — skip it (spec §6).
    }
  }
  return records;
}
