/**
 * The goal check both labs run for a task's time and stall signal (the
 * registry's `task-signals`): a person tells a task that is working from one
 * whose run has stopped, and sees how long each running task has worked on
 * this attempt, from the page alone. Each lab's `run.mts` hands this module
 * how to serve it, open its page, file on its board and read a row's words;
 * the legs, the controls and the grading are one copy here.
 *
 * Every coding task runs on harness-manager's scripted coder with a pause of
 * {@link STEP_MS} before each step, so a run sits in one step for four
 * minutes. No model is called: the server gets no model credential.
 *
 * - **clock**: a task is cancelled after its first attempt has run a while,
 *   then retried. Its row reads `working · …` within {@link CLOCK_SLACK_MS} of
 *   now − the retried run's `run.startedAt` (as `listTasks` reads it), and the
 *   clock moves on.
 * - **alive**: a run in one four-minute step, whose lease its request keeps
 *   renewing, reads `working` on every read of the page for those four
 *   minutes, and never `quiet`.
 * - **quiet**: the host is killed mid-run (SIGKILL to its process group),
 *   kept down {@link DOWN_MS}, and served again on the same store and port,
 *   so the page left open reads it again as a person's would; a page whose
 *   feed gave up on the server while it was down is reloaded once. Reading
 *   starts while the server starts, since the board takes a lapsed row back
 *   soon after. Before it does (the row's `attempts` changes, or its lease is
 *   no longer lapsed), the row reads `quiet for` at least four minutes. A
 *   read of a row the page marks stale says nothing of the run and isn't
 *   counted; a row taken back before the page showed it fresh is CAN'T TELL,
 *   not PASS.
 *
 * Controls (`GOAL_CONTROL=<name>`), planted in the lab's copy of `taskSignal`
 * for the run and put back; each re-runs only the leg it must fail:
 *   - `task-clock`: the clock reads the task's own `startedAt` (the first
 *     attempt's start, absent from rows until FIX-2395). Must FAIL clock.
 *   - `quiet-from-age`: quiet once `updatedAt` is 10 s old. Must FAIL alive.
 *   - `never-quiet`: quiet is never shown. Must FAIL quiet.
 */
import type { ChildProcess } from "node:child_process";
import type { Page } from "playwright";
import { leaseLapsed } from "@flow-state-dev/orchestration/tasks";
import { plant, type Plant } from "./plant.mts";
import { crashAndRestart, stopProcessGroup } from "./server.mts";
import { goalTmpDir } from "./paths.mts";
import { launchChromium } from "./playwright.mts";
import { sleep } from "./time.mts";
import { runGoal } from "./verdict.mts";

/** The pause before each of the scripted coder's steps: one step is the four minutes the alive leg watches. */
export const STEP_MS = 240_000;
/** How long the quiet leg keeps the host down. */
export const DOWN_MS = 240_000;
/** How far the page's clock may be from now − the run's start. */
export const CLOCK_SLACK_MS = 5_000;
/** How long the page has to show what the board's row reads. */
const PAGE_BOUND_MS = 20_000;
/** How long a filed or retried task has to start running. */
const START_BOUND_MS = 120_000;
/** How long the first attempt runs before it is cancelled, so the task's first start is well before the retry's. */
const FIRST_ATTEMPT_MS = 30_000;

/** One lab's board, through the public client, and its page's reading of a row. */
export interface LabBoard {
  /** The board's rows, as its `listTasks` action answers. */
  rows(): Promise<any[]>;
  /** File a coding task on the board, as the lab's screen or main worker files one; its id. */
  file(title: string, goal: string): Promise<string>;
  /** One board action (`updateTask`, `retryTask`), and its output. */
  act(tool: "updateTask" | "retryTask", input: Record<string, unknown>): Promise<unknown>;
  /** The words the page shows on the row titled `title`, or undefined when it shows no such row. */
  words(title: string): Promise<string | undefined>;
  /** Whether the page marks the row titled `title` stale (its feed lost the server): its words then say nothing of the run. */
  stale(title: string): Promise<boolean>;
}

/** What a lab hands this module. */
export interface SignalsLab {
  /** The lab's name, for notes and the scratch folder. */
  name: string;
  /** The lab's installed copy of the registry's `task-signals`: every control is planted here. */
  itemFile: string;
  /** Build the lab's pages from its source as it stands. */
  build(): void;
  /**
   * Serve the lab on the store under `data` (kept across a restart), every coding task on the
   * scripted coder; on `port` when given (a restart serves where the open page looks).
   */
  serve(data: string, port?: number): Promise<{ origin: string; child: ChildProcess }>;
  /** Open the page where the board's rows show, on `origin`. */
  open(page: Page, origin: string): Promise<LabBoard>;
}

/** The model credentials the server is kept from: no model turn runs. */
export const NO_MODEL = { AI_GATEWAY_API_KEY: "", OPENAI_API_KEY: "", ANTHROPIC_API_KEY: "", OPENROUTER_API_KEY: "" };

type Leg = "clock" | "alive" | "quiet";

/** The leg each control must fail, and the only one it runs. */
const LEG_OF: Record<string, Leg> = { "task-clock": "clock", "quiet-from-age": "alive", "never-quiet": "quiet" };

/** The item's lines each control replaces. */
const RUN_CLOCK = "return run?.startedAt == null ? null : { kind: \"working\", text: `working · ${durationText(now - run.startedAt)}` };";
const QUIET_RULE = "if (lapsed && options.stale !== true)";

function controls(itemFile: string): Record<string, Plant[]> {
  return {
    "task-clock": [
      {
        file: itemFile,
        from: RUN_CLOCK,
        to: "const first = (view.times as { startedAt?: number | null }).startedAt; return first == null ? null : { kind: \"working\", text: `working · ${durationText(now - first)}` };",
      },
    ],
    "quiet-from-age": [{ file: itemFile, from: QUIET_RULE, to: "if (updatedAt != null && now - updatedAt >= 10_000 && options.stale !== true)" }],
    "never-quiet": [{ file: itemFile, from: QUIET_RULE, to: "if (false)" }],
  };
}

/** "42s", "4m 12s", "1h 3m" (the item's `durationText`) in ms; undefined for anything else. */
export function durationMs(text: string): number | undefined {
  const m = /^(?:(\d+)h )?(?:(\d+)m)?\s?(?:(\d+)s)?$/.exec(text.trim());
  if (m === null || (m[1] ?? m[2] ?? m[3]) === undefined) return undefined;
  return ((Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0)) * 1000;
}

/** The clock a row's words show, in ms, or undefined when they show none. */
const clockOf = (words: string | undefined) => {
  const m = /working · (\d+h \d+m|\d+m \d+s|\d+s)/.exec(words ?? "");
  return m === null ? undefined : durationMs(m[1]!);
};
/** The minutes a quiet row's words show, or undefined when they don't say quiet. */
const quietMinutesOf = (words: string | undefined) => {
  const m = /quiet for (?:(\d+)h )?(\d+)m/.exec(words ?? "");
  return m === null ? undefined : Number(m[1] ?? 0) * 60 + Number(m[2]);
};

/** Poll `check` every `everyMs` until it answers, or `forMs` passes. */
async function until<T>(check: () => Promise<T | undefined>, forMs: number, everyMs = 1_000): Promise<T | undefined> {
  for (const end = Date.now() + forMs; Date.now() < end; await sleep(everyMs)) {
    const value = await check().catch(() => undefined);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** Run the goal on `lab`, with the control `GOAL_CONTROL` names, if any. */
export async function runTaskSignals(lab: SignalsLab): Promise<void> {
  const control = process.env.GOAL_CONTROL ?? "";
  const plants = controls(lab.itemFile);
  if (control !== "" && plants[control] === undefined) throw new Error(`unknown GOAL_CONTROL "${control}"; known: ${Object.keys(plants).join(", ")}`);
  const legs: Leg[] = control === "" ? ["clock", "alive", "quiet"] : [LEG_OF[control]!];
  const say = (s: string) => console.error(`[${lab.name} task-signals ${new Date().toISOString().slice(11, 19)}] ${s}`);

  await runGoal(async (failures, tell) => {
    const notes: string[] = [];
    const scratch = goalTmpDir(`${lab.name}-task-signals${control === "" ? "" : `-${control}`}`);
    const data = `${scratch}/data`;
    const unplant = plant(plants, control);
    let served: { origin: string; child: ChildProcess } | undefined;
    /** The restarted server while it starts, so it is stopped however the run ends. */
    let serving: Promise<{ origin: string; child: ChildProcess }> | undefined;
    const browser = await launchChromium();
    try {
      try {
        lab.build();
      } finally {
        // The pages are built: the checkout goes back as it was, and the built pages keep the control.
        unplant();
      }
      served = await lab.serve(data);
      const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
      page.setDefaultTimeout(30_000);
      const board = await lab.open(page, served.origin);
      const row = async (id: string) => (await board.rows()).find((t) => t.id === id);
      const runningRow = (id: string, after?: number) =>
        until(async () => {
          const r = await row(id);
          return r?.status === "in_progress" && typeof r.run?.startedAt === "number" && (after === undefined || r.run.startedAt > after) ? r : undefined;
        }, START_BOUND_MS);

      // ── clock: a retried task's clock counts this attempt only, and moves on.
      if (legs.includes("clock")) {
        const title = "Clock: a retried task";
        const id = await board.file(title, "Write SCRIPTED-RUN.md in the checkout and commit it.");
        const first = await runningRow(id);
        if (first === undefined) throw new Error(`setup: the clock task never ran: ${JSON.stringify(await row(id))}`);
        await sleep(Math.max(0, first.run.startedAt + FIRST_ATTEMPT_MS - Date.now()));
        await board.act("updateTask", { id, status: "cancelled" });
        if ((await until(async () => ((await row(id))?.status === "cancelled" ? true : undefined), 30_000)) === undefined) throw new Error("setup: the clock task never read cancelled");
        await board.act("retryTask", { id });
        const again = await runningRow(id, first.run.startedAt);
        if (again === undefined) throw new Error(`setup: the retried task never ran again: ${JSON.stringify(await row(id))}`);
        say(`clock: first attempt started ${new Date(first.run.startedAt).toISOString()}, retry ${new Date(again.run.startedAt).toISOString()}`);
        let last: string | undefined;
        const read = await until(async () => {
          last = await board.words(title);
          const shown = clockOf(last);
          return shown === undefined ? undefined : { shown, expected: Date.now() - again.run.startedAt };
        }, PAGE_BOUND_MS);
        tell.over("clock · the retried row's clock on the page", read === undefined ? [] : [read]);
        if (read === undefined) failures.push(`clock: the retried task's row shows no working clock within ${PAGE_BOUND_MS / 1000}s; it reads ${JSON.stringify(last)}`);
        else if (Math.abs(read.shown - read.expected) > CLOCK_SLACK_MS) {
          failures.push(`clock: the row reads ${read.shown / 1000}s, but this attempt's run started ${Math.round(read.expected / 1000)}s ago (the task first started ${Math.round((Date.now() - first.run.startedAt) / 1000)}s ago)`);
        } else {
          await sleep(4_000);
          const later = clockOf(await board.words(title));
          if (later === undefined || later <= read.shown) failures.push(`clock: the clock didn't move on: ${read.shown / 1000}s, then ${later === undefined ? "none" : `${later / 1000}s`} 4s later`);
          else notes.push(`clock: ${read.shown / 1000}s against ${Math.round(read.expected / 1000)}s since the retry's run started, then ${later / 1000}s`);
        }
        // Free the coder for the next leg.
        await board.act("updateTask", { id, status: "cancelled" });
      }

      // ── alive: a live run in one four-minute step never reads quiet.
      let aliveTask: { id: string; title: string; attempts: number } | undefined;
      if (legs.includes("alive") || legs.includes("quiet")) {
        const title = "Alive: one long step";
        const id = await board.file(title, "Write SCRIPTED-RUN.md in the checkout and commit it.");
        const running = await runningRow(id);
        if (running === undefined) throw new Error(`setup: the long-step task never ran: ${JSON.stringify(await row(id))}`);
        aliveTask = { id, title, attempts: running.attempts };
        if (legs.includes("alive")) {
          const reads: { at: number; words: string }[] = [];
          const watchUntil = running.run.startedAt + STEP_MS;
          say(`alive: watching ${title} until ${new Date(watchUntil).toISOString()}`);
          let renewals = new Set<number>();
          while (Date.now() < watchUntil) {
            const words = await board.words(title);
            const r = await row(id);
            if (r?.status !== "in_progress" || r.attempts !== running.attempts) throw new Error(`setup: the long-step run didn't stay in one attempt: ${JSON.stringify(r)}`);
            if (typeof r.leaseUntil === "number") renewals.add(r.leaseUntil);
            if (words !== undefined) reads.push({ at: Date.now() - running.run.startedAt, words });
            await sleep(3_000);
          }
          tell.over("alive · reads of the row over its one step", reads);
          const quiet = reads.find((r) => /quiet/.test(r.words));
          const notWorking = reads.filter((r) => clockOf(r.words) === undefined);
          if (quiet !== undefined) failures.push(`alive: a live run read quiet ${Math.round(quiet.at / 1000)}s into its one step: ${JSON.stringify(quiet.words)} (its lease was renewed ${renewals.size} times)`);
          else if (notWorking.length > 0) failures.push(`alive: ${notWorking.length} of ${reads.length} reads showed no working clock, first ${JSON.stringify(notWorking[0]!.words)}`);
          else notes.push(`alive: ${reads.length} reads over ${Math.round((reads.at(-1)?.at ?? 0) / 1000)}s of one step, all working, ${renewals.size} lease deadlines seen`);
        }
      }

      // ── quiet: a run whose host died reads quiet once the server is back, until the board takes the row back.
      if (legs.includes("quiet") && aliveTask !== undefined) {
        const { id, title, attempts } = aliveTask;
        const before = await row(id);
        say(`quiet: killing the host mid-run (${title}, attempt ${attempts}), down ${DOWN_MS / 1000}s`);
        const killedAt = Date.now();
        const port = Number(new URL(served.origin).port);
        await crashAndRestart(served.child, async () => {
          await sleep(DOWN_MS);
          // The killed server's port can take a moment to free: one more try on it, a little later.
          serving = lab.serve(data, port).catch(async (cause) => {
            say(`quiet: the restart on port ${port} failed (${String(cause).split("\n")[0]}); trying again`);
            await sleep(5_000);
            return lab.serve(data, port);
          });
        });
        // The server is starting: read from the moment it answers, while `serving` waits for it to settle.
        const reads: { words: string; lapsedForS: number }[] = [];
        let verdict: "quiet" | "taken" | undefined;
        let lastWords: string | undefined;
        let reloaded = false;
        let staleReads = 0;
        let answeredAt: number | undefined;
        for (const end = Date.now() + 150_000; Date.now() < end && verdict === undefined; await sleep(250)) {
          const r = await row(id).catch(() => null);
          if (r === null) continue; // not answering yet
          if (answeredAt === undefined) {
            answeredAt = Date.now();
            say(`quiet: the server answers ${Math.round((answeredAt - killedAt) / 1000)}s after the kill`);
          }
          const words = await board.words(title);
          const stale = await board.stale(title);
          const now = Date.now();
          // Read the page only against a row the board still holds as this attempt's, with its lease lapsed.
          if (r === undefined || r.status !== "in_progress" || r.attempts !== attempts || !leaseLapsed(r, now)) {
            verdict = "taken";
            const taken = `the board took the row back ${((now - answeredAt) / 1000).toFixed(1)}s after the server answered (${r?.status}, attempt ${r?.attempts}, lease ${r?.leaseUntil === undefined ? "none" : new Date(r.leaseUntil).toISOString()}), after ${reads.length} fresh read(s) and ${staleReads} stale`;
            say(`quiet: ${taken}`);
            notes.push(`quiet: ${taken}`);
            break;
          }
          // A page that doesn't show the row yet, or shows it stale, has read nothing of the run.
          if (words === undefined) continue;
          if (stale) {
            staleReads += 1;
            // A feed that gave up while the server was down: reload once, as a person would.
            if (!reloaded) {
              reloaded = true;
              say(`quiet: the page marks the row stale ${((now - answeredAt) / 1000).toFixed(1)}s after the server answered; reloading`);
              await page.reload().catch(() => undefined);
            }
            continue;
          }
          lastWords = words;
          reads.push({ words, lapsedForS: Math.round((now - r.leaseUntil) / 1000) });
          say(`quiet: fresh read ${((now - answeredAt) / 1000).toFixed(1)}s after the server answered: ${JSON.stringify(words)}`);
          const minutes = quietMinutesOf(words);
          if (minutes !== undefined) {
            verdict = "quiet";
            if (minutes < DOWN_MS / 60_000) failures.push(`quiet: the row reads ${JSON.stringify(words)}, under the ${DOWN_MS / 60_000}m the host was down`);
            else notes.push(`quiet: ${JSON.stringify(words)} ${Math.round((now - killedAt) / 1000)}s after the kill, the board's lease lapsed ${reads.at(-1)!.lapsedForS}s before`);
          }
        }
        served = await serving!;
        tell.over("quiet · fresh reads of the row while the board still held it lapsed", reads);
        if (verdict !== "quiet" && reads.length > 0) failures.push(`quiet: over ${reads.length} read(s) of a row whose lease had lapsed (by ${reads.at(-1)!.lapsedForS}s), the page never read quiet; last ${JSON.stringify(lastWords)} (before the kill: updatedAt ${before?.updatedAt}, leaseUntil ${before?.leaseUntil})`);
      }

      return {
        failures: control === "" ? failures : failures.map((f) => `[control ${control}] ${f}`),
        evidence: notes.join("; "),
      };
    } finally {
      await browser.close().catch(() => {});
      if (served !== undefined) stopProcessGroup(served.child, "SIGKILL");
      const restarted = await serving?.catch(() => undefined);
      if (restarted !== undefined) stopProcessGroup(restarted.child, "SIGKILL");
      // A control's pages go: the lab's built pages are its source's again.
      if (control !== "") lab.build();
    }
  });
}
