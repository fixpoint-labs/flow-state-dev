/**
 * The scripted harness this goal puts in the DevTeam `coder` kind's slot.
 *
 * No model. Each attempt writes down what the harness manager handed it, one
 * JSON line per attempt to the file {@link RUNS_ENV} names: the prompt, the
 * resume id the manager's `resume` feed offered, and the coding session id the
 * attempt names. That file is the goal's oracle for "the next attempt
 * continued the same coding session with the person's line". The check reads
 * it from disk, never the manager's own record of it.
 *
 * Every attempt holds: it says a step about every second in the run's session
 * until it is stopped, so a turn always finds a running attempt to stop.
 *
 * Like a real coding harness, an attempt offered a resume id continues that
 * session and names it again; a cold attempt starts a session of its own.
 *
 * `TURN_GOAL_CONTROL=fresh-session` is the red state of that: the `resume`
 * feed is read and then dropped, so every attempt starts cold.
 */
import { appendFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { handler, harnessRunHandleSchema, harnessRunInputSchema } from "@flow-state-dev/core";
import type { HarnessBlock, HarnessCallbackContext } from "@flow-state-dev/core/types";
import type { HarnessFeeds } from "../../../devteam-lab/lab/harness.mts";

/** The file each attempt's record is appended to. */
export const RUNS_ENV = "TURN_GOAL_RUNS";
/** The control switch, read by the Lab (the goal's own `GOAL_CONTROL` is the driver's). */
export const CONTROL_ENV = "TURN_GOAL_CONTROL";

/** One attempt, as the harness was handed it. */
export interface RecordedAttempt {
  /** The row line of the manager's prompt, `Row <id>, …`. */
  row: string;
  prompt: string;
  /** What the manager's `resume` feed offered, before any control dropped it. */
  offeredResume: string | null;
  /** What the attempt resumed: `offeredResume`, or `null` under `fresh-session`. */
  resume: string | null;
  /** The coding session this attempt named. */
  session: string;
  at: number;
}

/** How often a held attempt says a step. */
const STEP_MS = 1_000;
/** The longest an attempt holds if nothing stops it. */
const HOLD_MS = 10 * 60_000;

/** Wait `ms`, or reject when `signal` aborts. */
function pause(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("aborted"));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new Error("aborted"));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * The slot. Throws at build time when {@link RUNS_ENV} is unset, since an
 * attempt nobody can read back proves nothing.
 */
export function recordingHarness(feeds: HarnessFeeds): HarnessBlock {
  const file = process.env[RUNS_ENV];
  if (file === undefined || file === "") throw new Error(`${RUNS_ENV} names no file to record attempts in`);
  const fresh = process.env[CONTROL_ENV] === "fresh-session";
  return handler({
    name: "turn-goal-recording-harness",
    inputSchema: harnessRunInputSchema,
    outputSchema: harnessRunHandleSchema,
    execute: async (input: { prompt: string }, ctx) => {
      const context = ctx as unknown as HarnessCallbackContext;
      await feeds.cwd(context);
      const offeredResume = await feeds.resume(context);
      const resume = fresh ? null : offeredResume;
      const session = resume ?? `sess_turn_goal_${randomUUID().slice(0, 8)}`;
      const attempt: RecordedAttempt = {
        row: input.prompt.split("\n").find((line) => line.startsWith("Row ")) ?? "",
        prompt: input.prompt,
        offeredResume,
        resume,
        session,
        at: Date.now(),
      };
      appendFileSync(file, `${JSON.stringify(attempt)}\n`);
      await feeds.onSession(session, context);

      ctx.emit.message(resume === null ? "Starting on the row." : "Continuing where I stopped.");
      const until = Date.now() + HOLD_MS;
      for (let step = 1; Date.now() < until; step += 1) {
        await pause(STEP_MS, ctx.signal);
        ctx.emit.message(`Step ${step}`);
      }
      return {
        source: "turn-goal/recording",
        status: "completed" as const,
        sessionId: session,
        url: null,
        dispatchedAt: attempt.at,
        outcome: "finished" as const,
        finalMessage: null,
        usage: null,
        cost: null,
      };
    },
  }) as unknown as HarnessBlock;
}
