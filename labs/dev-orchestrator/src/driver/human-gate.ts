/**
 * Human-gate polling for the driver.
 *
 * A `human_approval` suspension waits for a person. Per decision Q3 the default
 * is to poll Linear for the signal (the human moves the board), which survives
 * the driver detaching or restarting; an interactive stdin gate is available for
 * attended runs. Per decision Q4 the human signals approval by advancing the
 * board (e.g. to Spec Approved) and the orchestrator records it — so the
 * Linear gate reads the board rather than writing the approved state itself.
 * Both implementations sit behind one `HumanGate` seam.
 */
import { createInterface } from "node:readline";
import type { SuspensionRecord } from "@flow-state-dev/core/types";
import type { LinearStatusClient } from "../signals/linear";
import { isAtOrPast, type LinearStateName } from "../types";

/** The decision a gate poll returns. `reject` is only meaningful when `ready`. */
export interface HumanGateDecision {
  ready: boolean;
  reject: boolean;
  note: string | null;
  timedOut: boolean;
}

/** Context for a single gate poll. */
export interface HumanGateContext {
  issueId: string;
  linear: LinearStatusClient;
  now: number;
  watchdogMs: number;
}

/** Pluggable human-gate seam: poll-Linear (default) or stdin (attended). */
export interface HumanGate {
  poll(parked: SuspensionRecord, ctx: HumanGateContext): Promise<HumanGateDecision>;
}

/** Board thresholds per gate: approve at/past `approve`, reject below `rejectBelow`. */
const GATE_THRESHOLDS: Record<string, { approve: LinearStateName; rejectBelow: LinearStateName }> = {
  "spec-approval": { approve: "Spec Approved", rejectBelow: "In Spec Review" },
  "pr-approval": { approve: "Done", rejectBelow: "In Review" },
};

function gateKindOf(parked: SuspensionRecord): string {
  return (parked.data as { gate?: string } | undefined)?.gate ?? "spec-approval";
}

/**
 * Default gate: the human advances the Linear board to signal a decision. Ready
 * + approve once the board reaches the gate's approve state; ready + reject if
 * the human sent it back below the gate's threshold; otherwise wait until the
 * (long) watchdog elapses.
 */
export function createLinearHumanGate(): HumanGate {
  return {
    async poll(parked, ctx) {
      const thresholds = GATE_THRESHOLDS[gateKindOf(parked)] ?? GATE_THRESHOLDS["spec-approval"];
      const state = await ctx.linear.getState(ctx.issueId);
      if (state !== null && isAtOrPast(state, thresholds.approve)) {
        return { ready: true, reject: false, note: null, timedOut: false };
      }
      if (state !== null && !isAtOrPast(state, thresholds.rejectBelow)) {
        return {
          ready: true,
          reject: true,
          note: `sent back below ${thresholds.rejectBelow}`,
          timedOut: false,
        };
      }
      const expired = ctx.now - parked.createdAt >= ctx.watchdogMs;
      return { ready: false, reject: false, note: null, timedOut: expired };
    },
  };
}

/**
 * Attended gate: prompt the operator on stdin once per poll. Returns approve /
 * reject on `y`/`n`, and "not ready" on anything else so the driver loops. I/O
 * only — exercised in attended `babysit --attended` runs, not in CI.
 */
export function createStdinHumanGate(): HumanGate {
  return {
    async poll(parked, ctx) {
      const answer = await prompt(
        `\n[orchestrator] ${parked.message ?? "Approval required"} for ${ctx.issueId} — approve? (y/n/wait): `,
      );
      const normalized = answer.trim().toLowerCase();
      if (normalized === "y" || normalized === "yes" || normalized === "approve") {
        return { ready: true, reject: false, note: "approved at stdin", timedOut: false };
      }
      if (normalized === "n" || normalized === "no" || normalized === "reject") {
        return { ready: true, reject: true, note: "rejected at stdin", timedOut: false };
      }
      return { ready: false, reject: false, note: null, timedOut: false };
    },
  };
}

function prompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
