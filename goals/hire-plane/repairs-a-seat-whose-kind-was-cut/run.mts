/**
 * Goal check — after an app cuts a kind, a person sees each stored seat that no
 * longer comes back and why, clears it on their approval, and the next start
 * names no refused seat while the team list shows only hired seats.
 *
 * Four starts of one app, each its own process, over one SQLite file. See
 * goal.md for the contract and the control.
 *
 * Run: pnpm tsx goals/hire-plane/repairs-a-seat-whose-kind-was-cut/run.mts
 * Control: GOAL_CONTROL=fire-keeps-inventory pnpm tsx goals/hire-plane/repairs-a-seat-whose-kind-was-cut/run.mts
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadFixture, runGoal } from "../../lib/index.mts";
import type { Fixture } from "./app.mts";

const fixture = loadFixture<Fixture>(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const control = process.env.GOAL_CONTROL;

type Out = Record<string, any>;

/** Start the app once, as its own process, and read what it printed. */
function start(step: string, statePath: string): Out {
  const child = spawnSync(process.execPath, [...process.execArgv, join(here, "start.mts"), step, statePath], {
    encoding: "utf8",
    env: process.env,
    timeout: 120_000,
  });
  const line = child.stdout.split("\n").find((l) => l.startsWith("RESULT "));
  if (line === undefined) {
    throw new Error(`start "${step}" printed no result (exit ${child.status}): ${child.stderr.slice(-2000)}`);
  }
  return JSON.parse(line.slice("RESULT ".length)) as Out;
}

await runGoal(async () => {
  const failures: string[] = [];
  const check = (name: string, ok: boolean, detail: unknown) => {
    if (!ok) failures.push(`[${name}] ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
  };
  const dir = mkdtempSync(join(tmpdir(), "fsd-goal-repair-"));
  const statePath = join(dir, "state.json");
  writeFileSync(statePath, JSON.stringify({ fixture, dbFile: join(dir, "app.db"), ...(control ? { control } : {}) }));
  const address = (seatId: string) => `${fixture.orgId}.${seatId}`;
  const broken = [fixture.cutSeat, fixture.rehireSeat, fixture.refusedSeat];

  try {
    // ---- start 1: the release that carried the kind --------------------------
    const s1 = start("hire", statePath);
    check("1:hired", Object.values(s1.hired).every((s) => s === "completed"), s1.hired);
    check("1:fired-before-seeded", !s1.roster.includes(fixture.firedBeforeSeat) && s1.inventory.includes(address(fixture.firedBeforeSeat)), s1);

    // ---- start 2: the kind is cut ----------------------------------------------
    const s2 = start("ask", statePath);
    const named = (seatId: string, problems: string[] = s2.problems) =>
      problems.filter((p) => p.includes(`roster/${seatId}"`)).length;
    check("2:start-names-each", broken.every((seatId) => named(seatId) === 1) && s2.problems.length === broken.length, s2.problems);
    check("2:read-ok", s2.read.error === undefined, s2.read.error);
    const reasons = Object.fromEntries((s2.read.entries as Out[]).map((e) => [e.seatId, e.reason]));
    check(
      "2:read-lists-exactly",
      JSON.stringify(reasons) ===
        JSON.stringify({ [fixture.cutSeat]: "kind-gone", [fixture.rehireSeat]: "kind-gone", [fixture.refusedSeat]: "refused" }),
      reasons,
    );
    const readLines = (s2.read.entries as Out[]).map((e) => `organization "${fixture.orgId}", row "${e.key}" — ${e.detail}`).sort();
    check("2:read-agrees-with-start", JSON.stringify(readLines) === JSON.stringify([...s2.problems].sort()), { readLines, problems: s2.problems });
    check(
      "2:deny-changes-nothing",
      s2.deny.raised === "suspended" && s2.deny.answered === "completed" && s2.deny.rowUnchanged && s2.deny.stillListed,
      s2.deny,
    );
    check("2:asks-pending", Object.values(s2.raised).every((s) => s === "suspended"), s2.raised);

    // ---- start 3: a restart, then the person approves -------------------------
    const s3 = start("answer", statePath);
    check("3:still-broken-after-restart", broken.every((seatId) => named(seatId, s3.problems) === 1), s3.problems);
    check(
      "3:approved",
      ["retire", "rehire", "refused"].every((label) => s3.answered[label] === "completed"),
      s3.answered,
    );

    // ---- start 4: the next start ---------------------------------------------
    const s4 = start("verify", statePath);
    check("4:no-refused-seat", s4.problems.length === 0, s4.problems);
    check("4:read-empty", s4.read.error === undefined && s4.read.entries.length === 0, s4.read);
    check(
      "team-list:retired-row-gone",
      !s4.inventory.includes(address(fixture.cutSeat)),
      `the inventory still holds ${address(fixture.cutSeat)}: ${JSON.stringify(s4.inventory)}`,
    );
    check(
      "team-list:no-cut-seat",
      !s4.teamList.includes(address(fixture.cutSeat)) && !s4.teamList.includes(address(fixture.firedBeforeSeat)),
      s4.teamList,
    );
    check(
      "team-list:hired-seats-listed",
      [fixture.healthySeat, fixture.rehireSeat, fixture.refusedSeat].every((seatId) => s4.teamList.includes(address(seatId))),
      s4.teamList,
    );
    for (const seatId of [fixture.healthySeat, fixture.rehireSeat, fixture.refusedSeat]) {
      check(
        `4:answers:${seatId}`,
        s4.answers[seatId]?.status === "completed" && s4.answers[seatId]?.kind === fixture.keptKind,
        s4.answers[seatId],
      );
    }

    return {
      failures,
      evidence:
        `start 2 named ${s2.problems.length} rows and the read listed ${JSON.stringify(reasons)} with the same detail; ` +
        `Deny left ${fixture.cutSeat}'s row unchanged; after a restart the person approved retire + 2 re-hires; ` +
        `start 4 reported ${s4.problems.length} problems, the read listed none, the team list is ${JSON.stringify(s4.teamList)}, ` +
        `and ${Object.keys(s4.answers).join(", ")} answered on ${fixture.keptKind}`,
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
