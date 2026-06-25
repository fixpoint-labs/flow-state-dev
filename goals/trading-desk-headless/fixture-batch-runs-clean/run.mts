/**
 * Goal check — the trading-desk headless batch runs clean over the fixture
 * corpus. Real models, real path, out of CI. See goal.md for the contract.
 *
 * Drives the batch harness over the 3-ticker fixture manifest from
 * `labs/trading-desk` (config search is cwd-only), then asserts the scoreboard:
 * 3 lines, every run completed with a real decision and a published PM memo.
 *
 * Run: pnpm tsx goals/trading-desk-headless/fixture-batch-runs-clean/run.mts
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../../../labs/trading-desk", import.meta.url));
const SCOREBOARD = `${APP}/.fsdev/headless/scoreboard.fixture.jsonl`;

// Drive the real path: the batch shells `fsdev run` per run, against the desk's
// intent ladder + gateway. Fixture mode stubs DATA only — generators run live.
execFileSync("pnpm", ["batch", "scripts/headless/manifest.fixture.json"], {
  stdio: "inherit",
  cwd: APP,
});

const lines = readFileSync(SCOREBOARD, "utf8")
  .split("\n")
  .filter((l) => l.trim().length > 0);

const failures: string[] = [];

if (lines.length !== 3) {
  failures.push(`expected 3 scoreboard lines, got ${lines.length}`);
}

const ranModels = new Set<string>();
for (const line of lines) {
  let row: Record<string, unknown>;
  try {
    row = JSON.parse(line);
  } catch (err) {
    failures.push(`unparseable scoreboard line: ${String(err)}`);
    continue;
  }
  const ticker = String(row.ticker ?? "?");
  // Anti-game: a record alone is not enough — require a real completed decision.
  if (row.status !== "completed") {
    failures.push(`${ticker}: status ${String(row.status)} (${String(row.error ?? row.stopReason ?? "")})`);
    continue;
  }
  if (row.finalRating == null) {
    failures.push(`${ticker}: completed but finalRating is null`);
  }
  const memos = Array.isArray(row.memos) ? (row.memos as Array<Record<string, unknown>>) : [];
  const pm = memos.find((m) => m.key === "p5/portfolio-manager");
  if (pm?.status !== "published") {
    failures.push(`${ticker}: PM memo not published (${String(pm?.status)})`);
  }
  ranModels.add(String(row.finalRating ?? ""));
}

if (failures.length === 0) {
  console.log(
    `PASS — 3/3 fixture runs completed with a decision + published PM memo. ` +
      `Ratings: ${[...ranModels].join(", ")}.`,
  );
  process.exit(0);
} else {
  console.error("FAIL —\n" + failures.join("\n"));
  process.exit(1);
}
