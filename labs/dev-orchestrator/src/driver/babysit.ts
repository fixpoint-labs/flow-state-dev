/**
 * The babysit driver: a long-lived loop that drives one Linear issue through its
 * lifecycle by dispatching stages and resuming durable suspensions.
 *
 * Each tick: read the board → if a suspension is parked for this issue, poll the
 * matching signal (Linear/GitHub for an agent wait, the human gate for an
 * approval) and, when satisfied, acquire the resume lease, mark the suspension
 * resolved, and re-enter the SAME request via `continueRequest`; otherwise ask
 * the stage machine what to do next and `runAction` the matching stage. A
 * parked suspension always takes precedence over the stage machine, which is
 * what makes a restart resume the wait instead of re-dispatching.
 *
 * The loop is wrapped in a per-tick error boundary: a transient I/O failure
 * (a Linear/GitHub blip, a malformed record) is logged and retried next tick
 * rather than crashing the process, and only a run of consecutive failures
 * escalates. The driver owns all I/O and all timing; every external dependency
 * — the signal clients, the `claude` resolver (baked into the flow), the clock,
 * and `sleep` — is injectable so the whole loop is unit-testable with no live
 * calls.
 */
import { continueRequest, createFlowRegistry, runAction } from "@flow-state-dev/server";
import type { DurabilityProvider, StoreRegistry } from "@flow-state-dev/server";
import type { FlowInstance, SuspensionRecord } from "@flow-state-dev/core/types";
import { nextAction, type OrchestrationAction } from "../stage-machine";
import { evaluateCompletion, type CompletionClients } from "../signals/completion";
import { orchestratorRuntimeConfig } from "../flow/runtime-config";
import { watchSpecSchema } from "../types";
import type { LinearStatusClient } from "../signals/linear";
import type { GitHubSignalClient } from "../signals/github";
import { createLinearHumanGate, type HumanGate } from "./human-gate";

/** Synthetic caller identity for the orchestrator's runs. */
export const ORCHESTRATOR_USER = "dev-orchestrator";

const DEFAULT_POLL_INTERVAL_MS = 15_000;
const DEFAULT_AGENT_WATCHDOG_MS = 30 * 60_000; // 30 min for a delegated stage
const DEFAULT_HUMAN_WATCHDOG_MS = 24 * 60 * 60_000; // 24 h at a human gate
const DEFAULT_MAX_CONSECUTIVE_ERRORS = 5;
const RESUME_LEASE_MS = 60_000; // matches the HTTP resume route's lease duration

/** Everything the driver needs; all I/O dependencies are injectable. */
export interface BabysitOptions {
  issueId: string;
  /** The dev-orchestrator flow instance (with its dispatch deps baked in). */
  flow: FlowInstance;
  stores: StoreRegistry;
  provider: DurabilityProvider;
  linear: LinearStatusClient;
  github: GitHubSignalClient;
  /** Human-gate implementation. Defaults to the poll-Linear gate. */
  humanGate?: HumanGate;
  /** Permit starting from Todo/Backlog. */
  fromBacklog?: boolean;
  pollIntervalMs?: number;
  agentWatchdogMs?: number;
  humanWatchdogMs?: number;
  /** Consecutive transient errors tolerated before escalating. */
  maxConsecutiveErrors?: number;
  /** Injected clock (tests advance it); defaults to `Date.now`. */
  now?: () => number;
  /** Injected sleep between ticks (tests pass a no-op); defaults to a real timer. */
  sleep?: (ms: number) => Promise<void>;
  /** Bound the loop (tests); defaults to unbounded. */
  maxTicks?: number;
  /** Structured per-tick log sink (defaults to a no-op; the bin wires stdout). */
  log?: (line: Record<string, unknown>) => void;
  /** Stable holder id for the resume lease; defaults to a per-process id. */
  processId?: string;
}

/** Why the driver stopped, plus the terminal board state. */
export interface BabysitResult {
  finalState: string | null;
  reason: string;
  stagesCompleted: number;
  ticks: number;
}

const realSleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Map a stage-machine action to a built flow action + its dispatch behavior. */
function stageActionFor(
  action: OrchestrationAction,
): { name: string; skipDispatch: boolean } | null {
  // This slice implements the spec stage only. Implement/review stages return
  // null so the driver stops gracefully at their boundary.
  if (action.kind === "dispatch" && action.stage === "spec") {
    return { name: "spec", skipDispatch: false };
  }
  if (action.kind === "await-agent" && action.stage === "spec") {
    return { name: "spec", skipDispatch: true };
  }
  if (action.kind === "await-human" && action.gate === "spec-approval") {
    return { name: "spec", skipDispatch: true };
  }
  return null;
}

function describeAction(action: OrchestrationAction): string {
  switch (action.kind) {
    case "dispatch":
      return `dispatch:${action.stage}`;
    case "await-agent":
      return `await-agent:${action.stage}`;
    case "await-human":
      return `await-human:${action.gate}`;
    default:
      return action.kind;
  }
}

function describeWait(parked: SuspensionRecord): string {
  return parked.reason === "human_approval"
    ? `human approval (${parked.message ?? "gate"})`
    : `agent completion (${parked.message ?? "external event"})`;
}

/** True when a completed stage's output is a rejected gate result. */
function isRejectedGate(output: unknown): boolean {
  return (
    typeof output === "object" &&
    output !== null &&
    (output as { gate?: unknown }).gate === "rejected"
  );
}

/**
 * Drive `issueId` until it reaches a terminal state, stops at an unimplemented
 * stage boundary, hits a watchdog timeout, is rejected at a gate, exhausts
 * `maxTicks`, or fails repeatedly. Returns a summary; side effects (dispatches,
 * transitions, comments) happen along the way.
 */
export async function babysit(options: BabysitOptions): Promise<BabysitResult> {
  const { issueId, flow, stores, provider, linear, github } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? realSleep;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const agentWatchdogMs = options.agentWatchdogMs ?? DEFAULT_AGENT_WATCHDOG_MS;
  const humanWatchdogMs = options.humanWatchdogMs ?? DEFAULT_HUMAN_WATCHDOG_MS;
  const maxConsecutiveErrors = options.maxConsecutiveErrors ?? DEFAULT_MAX_CONSECUTIVE_ERRORS;
  const maxTicks = options.maxTicks ?? Number.POSITIVE_INFINITY;
  const humanGate = options.humanGate ?? createLinearHumanGate();
  const processId = options.processId ?? `babysit:${process.pid}`;
  const log = options.log ?? (() => {});
  const clients: CompletionClients = { linear, github };

  const sessionId = `orchestrator:${issueId}`;
  const flowRegistry = createFlowRegistry();
  flowRegistry.register(flow as never);

  // Announce each new park/gate once so the timeline isn't spammed every tick.
  // Seed from suspensions already parked at startup (e.g. after a restart) so a
  // prior run's "⏸ waiting…" comments aren't duplicated on the Linear timeline.
  const announced = new Set<string>(
    (await provider.listSuspended({ status: "pending", sessionId })).map((r) => r.suspensionId),
  );
  let stagesCompleted = 0;
  let ticks = 0;
  let consecutiveErrors = 0;

  const stop = async (reason: string, comment?: string): Promise<BabysitResult> => {
    if (comment !== undefined) await linear.comment(issueId, comment).catch(() => {});
    const finalState = await linear.getState(issueId).catch(() => null);
    return { finalState, reason, stagesCompleted, ticks };
  };

  while (ticks < maxTicks) {
    ticks += 1;
    try {
      const result = await tickOnce();
      consecutiveErrors = 0;
      if (result !== null) return result;
    } catch (err) {
      consecutiveErrors += 1;
      const message = err instanceof Error ? err.message : String(err);
      log({ issueId, error: message, consecutiveErrors, tick: ticks });
      if (consecutiveErrors >= maxConsecutiveErrors) {
        return stop(
          "repeated errors",
          `⚠️ Orchestrator stopping after ${consecutiveErrors} consecutive errors. Last: ${message}`,
        );
      }
      await sleep(pollIntervalMs);
    }
  }

  return stop("max ticks reached");

  /** One driver tick. Returns a BabysitResult to stop, or null to continue. */
  async function tickOnce(): Promise<BabysitResult | null> {
    const state = await linear.getState(issueId);
    const pending = await provider.listSuspended({ status: "pending", sessionId });
    if (pending.length > 1) {
      // Single-sequencer-per-issue should never produce >1 pending; surface the
      // anomaly. The most recent is polled below; the others linger until swept.
      log({ issueId, warning: "multiple pending suspensions", count: pending.length, tick: ticks });
    }
    // Poll the most recent pending suspension (the current gate). Selected by
    // createdAt so it doesn't depend on the store's list ordering.
    const parked = pending.reduce<SuspensionRecord | undefined>(
      (newest, record) => (newest === undefined || record.createdAt > newest.createdAt ? record : newest),
      undefined,
    );

    if (parked !== undefined) {
      if (!announced.has(parked.suspensionId)) {
        announced.add(parked.suspensionId);
        await linear.comment(issueId, `⏸ ${describeWait(parked)}.`);
      }

      const decision = await pollParked(parked);
      log({ issueId, linearState: state, waitingOn: describeWait(parked), ready: decision.ready, tick: ticks });

      if (decision.fatal !== undefined) {
        // A non-retryable defect in the suspension record (e.g. a malformed
        // watch spec). Stop immediately rather than burning error-budget ticks.
        return stop(decision.fatal, `⚠️ ${decision.fatal}. Stopping for human attention.`);
      }
      if (decision.timedOut) {
        return stop(
          "watchdog timeout",
          `⏱ Orchestrator timed out waiting on ${describeWait(parked)}. Stopping for human attention.`,
        );
      }
      if (!decision.ready) {
        await sleep(pollIntervalMs);
        return null;
      }

      const resumed = await resumeParked(parked, decision);
      if (resumed.outcome === "conflict") {
        await sleep(pollIntervalMs);
        return null;
      }
      if (resumed.error !== undefined) {
        return stop(
          "stage run failed",
          `⚠️ Stage run failed: ${resumed.error.message}. Stopping for human attention.`,
        );
      }
      if (resumed.outcome === "completed") {
        stagesCompleted += 1;
        if (isRejectedGate(resumed.output)) {
          // The stage already bounced the board + commented; stop rather than
          // re-park forever waiting for a spec move that won't come on its own.
          return stop(
            "rejected at gate",
            "⏹ Stopping after a gate rejection. Revise and re-run babysit to continue.",
          );
        }
      }
      return null;
    }

    // No parked suspension — consult the stage machine.
    const action = nextAction(state ?? "", { fromBacklog: options.fromBacklog ?? false });
    log({ issueId, linearState: state, action: describeAction(action), tick: ticks });

    if (action.kind === "done") return stop("issue reached Done");
    if (action.kind === "noop") {
      return stop(action.reason, `⏹ Orchestrator stopping: ${action.reason}`);
    }

    const stageAction = stageActionFor(action);
    if (stageAction === null) {
      const reason = `${describeAction(action)} is beyond this POC slice (spec stage only)`;
      return stop(reason, `⏹ Reached ${state}; ${reason}.`);
    }

    const result = await runAction({
      flow,
      actionName: stageAction.name,
      input: { issueId, skipDispatch: stageAction.skipDispatch },
      userId: ORCHESTRATOR_USER,
      sessionId,
      stores,
      runtimeConfig: orchestratorRuntimeConfig(provider),
    });
    if (result.error !== undefined) {
      return stop(
        "stage run failed",
        `⚠️ Stage run failed: ${result.error.message}. Stopping for human attention.`,
      );
    }
    if (result.output !== undefined) stagesCompleted += 1;
    // Else the run suspended; the next tick finds the parked record and polls it.
    return null;
  }

  /**
   * Poll a parked suspension's signal (agent completion or human gate). A
   * non-retryable defect in the record (e.g. a malformed watch spec) is returned
   * as `fatal` so the caller stops immediately instead of retrying it every tick.
   */
  async function pollParked(
    parked: SuspensionRecord,
  ): Promise<{ ready: boolean; reject: boolean; timedOut: boolean; data: unknown; fatal?: string }> {
    if (parked.reason === "human_approval") {
      const decision = await humanGate.poll(parked, {
        issueId,
        linear,
        now: now(),
        watchdogMs: humanWatchdogMs,
      });
      return {
        ready: decision.ready,
        reject: decision.reject,
        timedOut: decision.timedOut,
        data: { note: decision.note },
      };
    }

    const parsedWatch = watchSpecSchema.safeParse((parked.data as { watch?: unknown } | undefined)?.watch);
    if (!parsedWatch.success) {
      return {
        ready: false,
        reject: false,
        timedOut: false,
        data: null,
        fatal: "malformed watch spec on the suspension record",
      };
    }
    const completion = await evaluateCompletion(parsedWatch.data, clients, {
      issueId,
      createdAt: parked.createdAt,
      now: now(),
      watchdogMs: agentWatchdogMs,
    });
    return {
      ready: completion.ready,
      reject: false,
      timedOut: completion.timedOut,
      data: completion.signal,
    };
  }

  /**
   * Resume a satisfied suspension: acquire the resume lease (mirrors the HTTP
   * resume route's concurrency guard), mark the suspension resolved, then
   * re-enter the same request via `continueRequest`. If the continuation setup
   * fails (or rejects), the suspension is restored to `pending` so a later tick
   * re-attempts the resume rather than finding no pending record and re-running
   * the stage from scratch — mirroring the HTTP resume route's revert-on-failure.
   * The framework releases the lease on settle; the `finally` is a defensive
   * (idempotent) no-op. Returns the settled outcome, the final output, and any
   * in-flow error.
   */
  async function resumeParked(
    parked: SuspensionRecord,
    decision: { reject: boolean; data: unknown },
  ): Promise<{ outcome: "completed" | "suspended" | "conflict"; output: unknown; error?: Error }> {
    const lease = await provider.acquireLease(parked.requestId, { holder: processId, durationMs: RESUME_LEASE_MS });
    if (lease === null) return { outcome: "conflict", output: undefined };

    let markedResolved = false;
    try {
      await provider.suspend({
        ...parked,
        status: decision.reject ? "rejected" : "approved",
        resolvedAt: now(),
        resolvedBy: ORCHESTRATOR_USER,
        resumeData: decision.data,
      });
      markedResolved = true;
      const { finished } = await continueRequest({
        requestId: parked.requestId,
        stores,
        flowRegistry,
        resumeContext: {
          suspensionId: parked.suspensionId,
          action: decision.reject ? "reject" : "approve",
          data: decision.data,
          resumedBy: ORCHESTRATOR_USER,
        },
        runtimeConfig: orchestratorRuntimeConfig(provider),
      });
      const settled = await finished;
      return {
        outcome: settled.output !== undefined ? "completed" : "suspended",
        output: settled.output,
        error: settled.error,
      };
    } catch (err) {
      // Continuation failed before/while re-entering. Restore the original
      // pending record so the resume is re-attempted, not lost. (runAction's own
      // recovery also reverts on a post-transition failure; this restore is
      // idempotent with it.)
      if (markedResolved) {
        await provider.suspend({ ...parked, status: "pending" }).catch(() => {});
      }
      throw err;
    } finally {
      await provider.releaseLease(parked.requestId, lease.leaseId).catch(() => {});
    }
  }
}
