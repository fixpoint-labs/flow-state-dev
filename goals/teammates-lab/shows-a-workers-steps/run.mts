/**
 * Goal check: in the Teammates lab, a worker's tool steps show in its
 * conversation during its turn, and fold once the turn is done (FIX-2393).
 * On a real model, against `fsdev dev --app @flow-state-dev/teammates`, graded
 * on the lab's own conversation entries: its adapter's `watchConversation`,
 * which reads the session through the client's `sessionFeed`, the surface
 * the conversation draws.
 *
 * Signals, per run:
 *   - steps during the turn: a view the conversation showed before the answer
 *     landed holds a step line naming one of the working folder's files.
 *   - folded after: once the answer lands and the turn ends, every run of
 *     steps in the turn reads done (or failed) and closed, and none is running.
 *
 * Control (`GOAL_CONTROL=popup-only`, same command): the adapter draws no
 * steps in the conversation, as before; *steps during the turn* must FAIL.
 *
 * Run: pnpm tsx goals/teammates-lab/shows-a-workers-steps/run.mts
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import {
  assertPatched,
  describePatches,
  goalTmpDir,
  loadFixture,
  modulePatchEnv,
  REPO_ROOT,
  RUN_STAMP,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";
import { createLabAdapter, type ConversationEntry, type ConversationView } from "../../../labs/teammates/src/adapter.ts";
import { sleep, startTeammates } from "../lab.mts";

const fixture = loadFixture<{ worker: string; path: string; line: string; decoys: Record<string, string>; asks: string[] }>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const RUNS = Number(process.env.GOAL_RUNS ?? 3);
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("shows-a-workers-steps");
const USER = "u_goal";
/** How long a turn may take, and how long the conversation must stay still once it ends. */
const TURN_MS = 5 * 60_000;
const SETTLE_MS = 3_000;

/** The `popup-only` control: the conversation draws no tool steps, as before FIX-2393; the popup still does. */
const POPUP_ONLY: ModulePatch[] = [
  {
    module: "labs/teammates/src/adapter.ts",
    from: String.raw`const step = toolStep\(item\);`,
    to: "continue;",
  },
];
if (!["", "popup-only"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);

// The adapter runs in this process, so the control re-runs this file with the patch applied as it loads.
if (CONTROL === "popup-only" && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  mkdirSync(SCRATCH, { recursive: true });
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(POPUP_ONLY, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(POPUP_ONLY, REPO_ROOT, mark) },
  });
  assertPatched(POPUP_ONLY, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

/** The working folder: a git checkout with the decoys, and the one file whose body holds the value. */
function seedWorkdir(dir: string, value: string): string {
  const files = { ...fixture.decoys, [fixture.path]: `${fixture.line.replace("{value}", value)}\n` };
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args]);
  execFileSync("git", ["init", "-q", dir]);
  git("add", "-A");
  git("commit", "-q", "-m", "start");
  return dir;
}

type Steps = Extract<ConversationEntry, { kind: "steps" }>;
/** One view the conversation showed, and when. */
type Seen = { at: number; view: ConversationView };

/** What came after the question in a view: its runs of steps, and whether the answer naming the value is there. */
function afterAsk(view: ConversationView, ask: string, value: string) {
  const from = view.entries.findIndex((e) => e.kind === "user" && e.text === ask);
  const turn = from < 0 ? [] : view.entries.slice(from + 1);
  return {
    asked: from >= 0,
    runs: turn.filter((e): e is Steps => e.kind === "steps"),
    answered: turn.some((e) => e.kind === "assistant" && e.text.includes(value)),
  };
}

/** The working folder's files by name: a long path is drawn clipped from the front ("Read …/next/plan.md"). */
const FILES = [fixture.path, ...Object.keys(fixture.decoys)].map((path) => path.slice(path.lastIndexOf("/") + 1));
/** A run's step that names one of the working folder's files. */
const namesAFile = (run: Steps) => run.steps.find((s) => FILES.some((file) => s.text.includes(file)));

await runGoal(async (failures, tell) => {
  const notes: string[] = [];
  const graded: number[] = [];
  for (let n = 1; n <= RUNS; n += 1) {
    const fail = (what: string) => failures.push(`run ${n} · ${what}`);
    const dir = join(SCRATCH, `run-${n}`);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const value = `ORCHID-${randomInt(1000, 9999)}`;
    const lab = await startTeammates(dir, USER, {}, seedWorkdir(join(dir, "workdir"), value));
    try {
      const adapter = createLabAdapter(createClient({ userId: USER, baseUrl: lab.origin }));
      const sessionId = await adapter.openConversation(fixture.worker);
      const seen: Seen[] = [];
      const stop = adapter.watchConversation(sessionId, (view) => seen.push({ at: Date.now(), view }));
      const ask = fixture.asks[randomInt(0, fixture.asks.length)]!;
      try {
        await adapter.send(sessionId, ask);
        // The turn is over once the conversation says it isn't answering and has held still a while.
        const until = Date.now() + TURN_MS;
        while (Date.now() < until) {
          const last = seen[seen.length - 1];
          if (last !== undefined && !last.view.running && afterAsk(last.view, ask, value).asked && Date.now() - last.at > SETTLE_MS) break;
          await sleep(500);
        }
      } finally {
        stop();
      }
      const final = seen[seen.length - 1]?.view;
      if (final === undefined || !afterAsk(final, ask, value).asked) throw new Error(`run ${n}: the conversation never showed the question`);
      if (final.running) throw new Error(`run ${n}: the turn did not end within ${TURN_MS / 1000}s`);
      const end = afterAsk(final, ask, value);
      if (!end.answered) throw new Error(`run ${n}: the answer never named ${value}, nothing to grade: ${JSON.stringify(final.entries.slice(-2)).slice(0, 400)}`);

      // ── Steps during the turn: before the answer landed, a step line named a file.
      const during = seen.map((s) => afterAsk(s.view, ask, value)).filter((a) => a.asked && !a.answered);
      const early = during.flatMap((a) => a.runs).map(namesAFile).find((step) => step !== undefined);
      if (early === undefined) {
        const runs = during.flatMap((a) => a.runs.map((r) => r.label));
        fail(`steps during the turn: no view before the answer held a step naming a file (${during.length} views; runs [${[...new Set(runs)].join(" | ")}])`);
      }

      // ── Folded after: the turn's runs read done and closed once it ended.
      if (end.runs.length === 0) fail("folded after: the ended turn shows no run of steps");
      for (const run of end.runs) {
        if (run.open || run.state === "running" || run.state === "waiting") fail(`folded after: "${run.label}" reads ${run.state}, ${run.open ? "open" : "closed"}`);
      }
      notes.push(`run ${n}: ${during.length} views before the answer, first step "${early?.text ?? "none"}"; after: [${end.runs.map((r) => `${r.label} (${r.state})`).join(" | ")}]`);
    } finally {
      stopProcessGroup(lab.child);
    }
    graded.push(n);
  }
  tell.over("runs graded", graded);
  return { failures, evidence: `${RUNS} of ${RUNS} runs: ${notes.join("; ")}` };
});
