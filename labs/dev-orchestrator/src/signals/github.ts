/**
 * Deterministic GitHub signal client for the implement/review stages.
 *
 * Completion of an implementation stage is a *composite downstream signal*, not
 * a single event: a PR must exist for the expected branch, not be a draft, and
 * (when required) its checks rollup must be green. This client reads that signal
 * through the `gh` CLI behind an injectable exec seam, so tests drive canned
 * JSON and never shell out. The default exec mirrors the repo's child-process
 * pattern (`packages/claude-code/src/cli/resolve-cli.ts`): spawn, capture
 * stdout/stderr, resolve with the exit code (a non-zero exit is data, not a
 * throw). The `gh` command shape is verified by the manual smoke test.
 */
import { spawn } from "node:child_process";

/** Captured result of a `gh` invocation. */
export interface GhExecResult {
  stdout: string;
  stderr: string;
  code: number;
}

/** Runs `gh` with the given args. Resolves on any exit; rejects only if `gh` can't launch. */
export type GhExec = (args: string[]) => Promise<GhExecResult>;

/** Rolled-up state of a PR's required checks. */
export type ChecksState = "success" | "pending" | "failure" | "none";

/** The composite PR signal the completion predicate consumes. */
export interface PullRequestSignal {
  /** A matching open PR exists for the branch. */
  exists: boolean;
  /** The PR is a draft (implementation not ready for review). */
  draft: boolean;
  /** Rolled-up state of the PR's checks. */
  checks: ChecksState;
  number: number | null;
  url: string | null;
}

/** Shape of a single `statusCheckRollup` entry as `gh --json` emits it. */
interface RollupEntry {
  // Check runs use status/conclusion; legacy status contexts use state.
  status?: string | null;
  conclusion?: string | null;
  state?: string | null;
}

interface GhPrListEntry {
  number: number;
  isDraft: boolean;
  url: string;
  statusCheckRollup?: RollupEntry[] | null;
}

const FAILED_CONCLUSIONS = new Set([
  "FAILURE",
  "CANCELLED",
  "TIMED_OUT",
  "ACTION_REQUIRED",
  "STARTUP_FAILURE",
  "STALE",
]);
const PASSED_CONCLUSIONS = new Set(["SUCCESS", "NEUTRAL", "SKIPPED"]);

/**
 * Roll a PR's individual check entries up to a single state. A pending check
 * dominates a success (don't trust a partially-reported rollup); any failure
 * dominates everything. An empty rollup is `none` (no checks configured /
 * reported yet), which the completion predicate treats as not-ready when checks
 * are required.
 */
export function rollupChecks(entries: RollupEntry[] | null | undefined): ChecksState {
  if (!entries || entries.length === 0) return "none";
  let sawPending = false;
  for (const entry of entries) {
    const conclusion = (entry.conclusion ?? entry.state ?? "").toUpperCase();
    const status = (entry.status ?? "").toUpperCase();
    if (status && status !== "COMPLETED") {
      sawPending = true;
      continue;
    }
    if (conclusion === "" || conclusion === "PENDING") {
      sawPending = true;
      continue;
    }
    if (FAILED_CONCLUSIONS.has(conclusion)) return "failure";
    if (!PASSED_CONCLUSIONS.has(conclusion)) {
      // Unknown conclusion — treat conservatively as pending, not success.
      sawPending = true;
    }
  }
  return sawPending ? "pending" : "success";
}

/** Reads PR signals for a branch via the `gh` CLI behind an injectable exec. */
export class GitHubSignalClient {
  constructor(private readonly exec: GhExec) {}

  /**
   * The composite PR signal for an open PR whose head is `branch`. Returns
   * `exists: false` when no such PR is found (the `gh` call yields an empty
   * list or exits non-zero) rather than throwing, so the driver keeps polling.
   */
  async pullRequestForBranch(branch: string): Promise<PullRequestSignal> {
    const absent: PullRequestSignal = {
      exists: false,
      draft: false,
      checks: "none",
      number: null,
      url: null,
    };

    const result = await this.exec([
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "open",
      "--json",
      "number,isDraft,url,statusCheckRollup",
    ]);
    if (result.code !== 0) return absent;

    let entries: GhPrListEntry[];
    try {
      entries = JSON.parse(result.stdout) as GhPrListEntry[];
    } catch {
      return absent;
    }
    const pr = entries[0];
    if (pr === undefined) return absent;

    return {
      exists: true,
      draft: pr.isDraft === true,
      checks: rollupChecks(pr.statusCheckRollup),
      number: pr.number,
      url: pr.url,
    };
  }
}

/**
 * Default `GhExec`: spawn `gh` from PATH, capture output, resolve with the exit
 * code. Mirrors the repo's `defaultClaudeCliExec` — resolves on a non-zero exit
 * (the caller reads `code`) and rejects only when the binary can't be launched.
 */
export const defaultGhExec: GhExec = (args) =>
  new Promise<GhExecResult>((resolve, reject) => {
    const child = spawn("gh", args, { env: process.env });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ stdout, stderr, code: code ?? 1 });
    });
  });
