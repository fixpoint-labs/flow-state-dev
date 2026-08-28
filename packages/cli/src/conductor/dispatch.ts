/**
 * Run one conductor action the way `fsdev chat` runs a turn and `fsdev run`
 * runs an action: `runAction` + a fresh `createResponseEmitter`.
 *
 * The TUI is presentation. This is the host. A second wrapper that only
 * looked at `result.output` would drop the stream the engine already emits
 * (status items, errors, resource changes) — the same events `fsdev run`
 * maps to NDJSON and `fsdev chat` maps to the transcript.
 */
import {
  abortRequest,
  createResponseEmitter,
  runAction,
  type RuntimeConfig,
  type StoreRegistry,
  type RequestStreamEventWithId,
} from "@flow-state-dev/engine";
import type { FlowInstance } from "@flow-state-dev/core/types";
import type { AnswerOutput, SeedOutput, StatusOutput } from "./types";

export const CONDUCTOR_FLOW_KIND = "conductor";
export const CONDUCTOR_ACTIONS = ["seed", "wake", "status", "answer"] as const;
export type ConductorAction = (typeof CONDUCTOR_ACTIONS)[number];

export const DEFAULT_USER_ID = "cli-user";
/** Stable across invocations so every drain names the same coordinator session. */
export const DEFAULT_SESSION_ID = "conductor-operator";

const ABORT_RETRY_MS = 25;
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface ConductorDispatch {
  flow: FlowInstance;
  userId: string;
  sessionId: string;
  stores: StoreRegistry;
  runtimeConfig: RuntimeConfig;
}

export interface ActionResult<T> {
  output: T | undefined;
  error?: string;
  requestId: string;
}

/** A running action: settlement plus the same true-abort path `executeTurn` uses. */
export interface RunningAction<T> {
  done: Promise<ActionResult<T>>;
  requestAbort(): void;
}

export function startConductorAction<T>(
  dispatch: ConductorDispatch,
  actionName: ConductorAction,
  input: unknown,
  onEvent: (event: RequestStreamEventWithId) => void,
): RunningAction<T> {
  const requestId = `req_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  let settled = false;
  let abortRequested = false;

  const responseEmitter = createResponseEmitter({
    requestId,
    onEvent,
  });

  async function requestAbort(): Promise<void> {
    if (abortRequested) return;
    abortRequested = true;
    while (!settled) {
      const result = await dispatch.stores.request
        .setFieldsIfStatus(requestId, { abortRequested: true }, ["in_progress"], Date.now())
        .catch(() => undefined);
      if (result?.status !== undefined) break;
      await delay(ABORT_RETRY_MS);
    }
    while (!settled) {
      if (abortRequest(requestId)) break;
      await delay(ABORT_RETRY_MS);
    }
  }

  const done = (async (): Promise<ActionResult<T>> => {
    try {
      const result = await runAction({
        flow: dispatch.flow,
        actionName,
        input: (input ?? {}) as never,
        userId: dispatch.userId,
        sessionId: dispatch.sessionId,
        requestId,
        stores: dispatch.stores,
        responseEmitter,
        runtimeConfig: { ...dispatch.runtimeConfig },
      });
      if (result.error !== undefined && result.error !== null) {
        const err = result.error as { message?: unknown };
        return {
          output: result.output as T | undefined,
          error: typeof err.message === "string" && err.message !== "" ? err.message : JSON.stringify(result.error),
          requestId,
        };
      }
      return { output: result.output as T, requestId };
    } catch (err) {
      return {
        output: undefined,
        error: err instanceof Error ? err.message : String(err),
        requestId,
      };
    } finally {
      settled = true;
    }
  })();

  return { done, requestAbort: () => void requestAbort() };
}

export async function runConductorAction<T>(
  dispatch: ConductorDispatch,
  actionName: ConductorAction,
  input: unknown,
  onEvent: (event: RequestStreamEventWithId) => void = () => {},
): Promise<ActionResult<T>> {
  return startConductorAction<T>(dispatch, actionName, input, onEvent).done;
}

export function statusInput(issue?: string): { issue?: string } {
  return issue !== undefined ? { issue } : {};
}

export function seedInput(issue: string, phase?: string): { issue: string; phase: string } {
  return { issue, phase: phase ?? "implement" };
}

export function answerInput(question: string, answer: string): { question: string; answer: string } {
  return { question, answer };
}

export async function readBoard(
  dispatch: ConductorDispatch,
  issue?: string,
  onEvent?: (event: RequestStreamEventWithId) => void,
): Promise<StatusOutput> {
  const result = await runConductorAction<StatusOutput>(
    dispatch,
    "status",
    statusInput(issue),
    onEvent ?? (() => {}),
  );
  if (result.error !== undefined) {
    throw new Error(result.error);
  }
  return result.output ?? { rows: [] };
}

export async function seedIssue(
  dispatch: ConductorDispatch,
  issue: string,
  phase: string | undefined,
  onEvent: (event: RequestStreamEventWithId) => void,
): Promise<SeedOutput> {
  const result = await runConductorAction<SeedOutput>(
    dispatch,
    "seed",
    seedInput(issue, phase),
    onEvent,
  );
  if (result.error !== undefined) throw new Error(result.error);
  if (result.output === undefined) throw new Error("conductor seed returned no task id");
  return result.output;
}

export async function wakeBoard(
  dispatch: ConductorDispatch,
  onEvent: (event: RequestStreamEventWithId) => void,
): Promise<void> {
  const result = await runConductorAction<unknown>(dispatch, "wake", {}, onEvent);
  if (result.error !== undefined) throw new Error(result.error);
}

export async function answerQuestion(
  dispatch: ConductorDispatch,
  question: string,
  text: string,
  onEvent: (event: RequestStreamEventWithId) => void,
): Promise<AnswerOutput> {
  const result = await runConductorAction<AnswerOutput>(
    dispatch,
    "answer",
    answerInput(question, text),
    onEvent,
  );
  if (result.error !== undefined) throw new Error(result.error);
  if (result.output === undefined) throw new Error("conductor answer returned nothing");
  return result.output;
}

/** The four actions this surface needs. Missing one is a config error, not a retry. */
export function assertConductorActions(flow: FlowInstance): void {
  const missing = CONDUCTOR_ACTIONS.filter((name) => flow.actions[name] === undefined);
  if (missing.length > 0) {
    const available = Object.keys(flow.actions).join(", ") || "(none)";
    throw new Error(
      `flow "${flow.kind}" is missing conductor actions: ${missing.join(", ")}. Available: ${available}`,
    );
  }
}
