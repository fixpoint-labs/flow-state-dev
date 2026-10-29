/**
 * The request-end seam (FIX-2077): a framework package asks the runtime to
 * call it back once a request's work is over.
 *
 * "Over" is later than the action's return and later than `onFinished`. The
 * runtime drains the request's background work, runs `onFinished`, and then
 * drains what `onFinished` and `onErrored` started. A hook registered here runs
 * after that last drain, on every way a request can end: completed,
 * incomplete, failed, aborted, interrupted, and suspended. It is the one place
 * that can say "nothing this request started is still writing".
 *
 * Framework-facing, not a flow-author hook. A flow author's `onFinished` keeps
 * running where it does, and a throw from it cannot skip a hook registered
 * here. The slot is a symbol key, as the dispatch seam's is, so no handler body
 * reaches it by name.
 */

import type { ModelUsageEntry } from "./flow";
import type { HarnessBilling, HarnessRunSpend } from "./harness";

/** How a request ended, as a request-end hook is told. */
export type RequestEndStatus = "completed" | "incomplete" | "failed" | "aborted" | "interrupted" | "suspended";

/** One step of a request's background work that failed (FIX-2088). */
export interface BackgroundFailure {
  /** The step's name, as `.sideChain()` recorded it. */
  readonly step: string;
  /** Its error's message. */
  readonly message: string;
}

/** What a request-end hook is handed. */
export interface RequestEnding {
  /** How the request ended. */
  readonly status: RequestEndStatus;
  /**
   * On `suspended`: the suspension it parked on. `reason` is why
   * (`user_approval`, `user_input`, `external_event`, or a flow's own); the
   * rest is what a reader of a task waiting on it shows (FIX-2129): its id,
   * its kind when `waitForUser` set one, what it asks (`title`, `message`),
   * and its deadline (`expiresAt`), absent when it has none.
   */
  readonly suspension?: {
    readonly reason: string;
    readonly suspensionId?: string;
    readonly kind?: import("./suspension").WaitForUserKind;
    readonly title?: string;
    readonly message?: string;
    readonly expiresAt?: number;
  };
  /** On `failed`: the request's error message, as its record carries it. */
  readonly error?: { readonly message: string };
  /**
   * The steps of the request's background work that failed, gathered across
   * every drain, in the order they were drained: work the action started,
   * work its end hooks started, and work a default `.waitForSideChain()`
   * drained. Absent when none failed.
   *
   * Never handed on for a request whose cancel fired (the explicit abort),
   * whatever its steps did after it; a dropped connection is not a cancel.
   * Never handed on at `suspended` either: the resume reruns a step that has
   * no completed trace, and the rerun's outcome is the one handed on.
   *
   * The request's own status never depends on these: the runtime only hands
   * them on. A hook that must fail something on them (the claim gate fails a
   * task's attempt) does so itself.
   */
  readonly backgroundFailures?: readonly BackgroundFailure[];
  /**
   * What the request spent since its last ending (FIX-2145): its model calls
   * by model and its harness runs, as the request's spend ledger counted them.
   * Counted per ending, so a request that suspends and resumes hands each
   * part on once: a harness run reported again after an ending is handed on
   * as its change since. Always present; both parts are empty for a request
   * that spent nothing.
   */
  readonly spend: RequestSpend;
}

/**
 * What a request spent, counted where it was spent (FIX-2145). One ledger per
 * request: every model result a generator or evaluator reports is added to
 * `byModel`, and every run a harness settles through `reportHarnessSpend` is
 * appended to `harnessRuns`. `ctx.request.tokenUsage` reads `byModel` (an
 * action's token budget counts model calls only); a request-end hook is
 * handed both.
 */
export interface RequestSpend {
  /**
   * Model calls, by model id: the same entries `ctx.request.tokenUsage.byModel`
   * reads. Keyed in the order each model was last called (FIX-2288).
   */
  readonly byModel: Readonly<Record<string, ModelUsageEntry>>;
  /**
   * Harness runs, one entry per run, as each was last reported, in the order
   * they were last reported (FIX-2288: a run reported again moves to the end).
   */
  readonly harnessRuns: readonly HarnessRunSpend[];
}

/**
 * What a request-end hook may hand back: a failure that is the request's own.
 * On a request that completed, the runtime then records the request as failed
 * with this error (the record it already wrote is patched), so its status
 * never reads as success for work a framework package could not record.
 *
 * A request with a hook still owed holds back its terminal status event until
 * its hooks have run, and then emits the status they leave it with, so a
 * stream client is told once: `failed` here, never `completed` first.
 * `onFinished` and the lifecycle seams run before the hooks (the hooks wait
 * for what `onFinished` starts), so they report the request's own end; the
 * recorded status may then be failed by a request-end hook.
 */
export interface RequestEndVerdict {
  readonly fail: Error;
}

/**
 * A request-end hook. Runs once per request end, after the last drain. A
 * rejection is logged by the runtime and does not change how the request
 * ended; a hook that must fail the request returns a {@link RequestEndVerdict}.
 */
export type RequestEndHook = (ending: RequestEnding) => void | RequestEndVerdict | Promise<void | RequestEndVerdict>;

/** The per-request registry the runtime attaches under {@link REQUEST_END_SEAM}. */
export interface RequestEndSeam {
  /** Add a hook for the running request. Hooks run in the order they were added. */
  add(hook: RequestEndHook): void;
}

/** The context slot the runtime attaches its request-end registry under. */
export const REQUEST_END_SEAM: unique symbol = Symbol.for("@flow-state-dev/request-end-seam");

/**
 * Ask to be called once the running request's work is over (see the module
 * header for what "over" means).
 *
 * @returns `false` when the context carries no seam: a hand-built test
 *   context, or a block run outside a request. The caller decides what that
 *   means for it.
 */
export function onRequestEnded(ctx: { readonly [REQUEST_END_SEAM]?: RequestEndSeam }, hook: RequestEndHook): boolean {
  const seam = ctx[REQUEST_END_SEAM];
  if (seam == null) return false;
  seam.add(hook);
  return true;
}

/**
 * The session-config slot a framework package puts a request-end hook in
 * (FIX-2145), so every request of a flow gets the hook without a block having
 * to call {@link onRequestEnded}.
 *
 * Framework-facing, like {@link REQUEST_END_SEAM}: a symbol key, set by the
 * package that builds the session config, never written by a flow author. When a request
 * starts, the runtime calls the function with the request's context and adds
 * what it returns to the request's registry, exactly as `onRequestEnded(ctx,
 * hook)` would: same list, same order, same shutdown drain. Returning
 * `undefined` adds nothing.
 */
export const SESSION_REQUEST_END_HOOK: unique symbol = Symbol.for("@flow-state-dev/session-request-end-hook");

/** What sits under {@link SESSION_REQUEST_END_HOOK}: called once per request start. */
export type SessionRequestEndHook = (ctx: import("./block").BlockContext) => RequestEndHook | undefined;

/**
 * The context slot the runtime attaches the request's spend ledger under
 * (FIX-2145). Reached through {@link reportHarnessSpend} in `./harness` and
 * {@link readRequestSpend}, never by name from a handler body.
 */
export const REQUEST_SPEND_SEAM: unique symbol = Symbol.for("@flow-state-dev/request-spend-seam");

/** The request's spend ledger, as a harness and {@link readRequestSpend} reach it. */
export interface RequestSpendSeam {
  /**
   * Add one harness report to the request's spend. A report with a `runId`
   * replaces that run's earlier report; one without is one settled run.
   */
  reportHarnessRun(run: HarnessRunSpend): void;
  /**
   * What the request has spent since its last ending: the part its next
   * ending hands on (FIX-2288). Reads, never takes: the ending still hands it
   * on. Optional, so a seam built before it keeps compiling (BP-030).
   */
  pending?(): RequestSpend;
}

/**
 * What the running request has spent since its last ending (FIX-2288): its
 * model calls by model and its harness runs as last reported, the part its
 * next ending hands on in `RequestEnding.spend`. A request that suspended and
 * resumed reads only what it spent since it resumed, as its ending hands on.
 *
 * Framework-facing, like {@link reportHarnessSpend}: a framework package that
 * shows a request's spend while it runs (a task's run, which writes it onto
 * its task) reads it here. A flow author reads `ctx.request.tokenUsage`.
 *
 * @returns `undefined` when the context carries no spend ledger: a hand-built
 *   test context, or a block run outside a request.
 */
export function readRequestSpend(ctx: object): RequestSpend | undefined {
  const seam = (ctx as { readonly [REQUEST_SPEND_SEAM]?: RequestSpendSeam })[REQUEST_SPEND_SEAM];
  return seam?.pending?.();
}

/**
 * One source of a request's spend (FIX-2145, shared by FIX-2288): a model, or
 * a harness billed one way. What {@link requestSpendSources} turns a
 * {@link RequestSpend} into, so a worker's usage and a task's tokens count
 * the same way.
 */
export interface RequestSpendSource {
  /** The model id, or the harness name. */
  source: string;
  kind: "model" | "harness";
  /** How a harness run was paid for; `null` for a model and when the harness can't tell. */
  billing: HarnessBilling | null;
  /** The model's prompt tokens, or what the harness reported as input. */
  inputTokens: number;
  /** The model's completion tokens, or what the harness reported as output. */
  outputTokens: number;
  /** The cost a harness reported on an `api-key` run, summed; `null` when none was. */
  costUsd: number | null;
  /** Harness runs, or request endings that called the model. */
  runs: number;
  /** Harness runs that reported no tokens. */
  unreported: number;
}

/**
 * Add one source into a list of sources, matched on source, kind and billing.
 * Returns a new list; neither input is changed.
 */
export function addRequestSpendSource(sources: readonly RequestSpendSource[], add: RequestSpendSource): RequestSpendSource[] {
  const at = sources.findIndex((s) => s.source === add.source && s.kind === add.kind && s.billing === add.billing);
  if (at < 0) return [...sources, add];
  const was = sources[at]!;
  const merged: RequestSpendSource = {
    ...was,
    inputTokens: was.inputTokens + add.inputTokens,
    outputTokens: was.outputTokens + add.outputTokens,
    costUsd: was.costUsd === null && add.costUsd === null ? null : (was.costUsd ?? 0) + (add.costUsd ?? 0),
    runs: was.runs + add.runs,
    unreported: was.unreported + add.unreported
  };
  return sources.map((s, i) => (i === at ? merged : s));
}

/**
 * What a request spent, as tokens per source (FIX-2145; one conversion, so a
 * task's count and a worker's agree, FIX-2288). Input is the model's prompt
 * tokens or what the harness reported as input; output likewise. A harness
 * run that reported no tokens counts as a run, with `unreported: 1` and no
 * tokens. A dollar figure only where a harness reported one on an `api-key`
 * run. Empty when the request spent nothing.
 */
export function requestSpendSources(spend: RequestSpend): RequestSpendSource[] {
  let sources: RequestSpendSource[] = [];
  for (const [model, entry] of Object.entries(spend.byModel)) {
    sources = addRequestSpendSource(sources, {
      source: model,
      kind: "model",
      billing: null,
      inputTokens: entry.prompt,
      outputTokens: entry.completion,
      costUsd: null,
      runs: 1,
      unreported: 0
    });
  }
  for (const run of spend.harnessRuns) {
    const reported = run.inputTokens !== null || run.outputTokens !== null;
    sources = addRequestSpendSource(sources, {
      source: run.harness,
      kind: "harness",
      billing: run.billing,
      inputTokens: run.inputTokens ?? 0,
      outputTokens: run.outputTokens ?? 0,
      costUsd: run.billing === "api-key" && run.costUsd !== null ? run.costUsd : null,
      runs: 1,
      unreported: reported ? 0 : 1
    });
  }
  return sources;
}
