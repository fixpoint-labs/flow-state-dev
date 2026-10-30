/**
 * The coding-harness contract (LAB-152).
 *
 * A *harness* is a coding agent driven as a block: you hand it a prompt, it
 * runs to completion in its own agentic loop, and it hands back a handle
 * describing the run. `@flow-state-dev/claude-code` ships one; a second lives
 * in its own package. This module is the neutral shape they agree on, so a
 * harness author — and a manager that drives any harness — programs against a
 * contract rather than against one vendor's internals.
 *
 * It lives in core because every harness package already depends on core, and
 * because a block declares a *runtime* schema for its output, which the
 * zero-dependency `contracts` layer cannot carry.
 *
 * This file owns:
 *
 * - {@link HarnessRunInput} / {@link harnessRunInputSchema} — what a caller
 *   hands a harness per run. The prompt, and nothing else: everything that
 *   decides *where* a run writes or *which* conversation it continues is
 *   harness configuration fed through a trusted channel, never a field on a
 *   schema a model tool can see (BP-031).
 * - {@link HarnessRunEnvelope} / {@link harnessRunEnvelopeSchema} — the
 *   identity-and-status core every dispatch produces, including one-way doors
 *   that never report a result.
 * - {@link HarnessRunHandle} / {@link harnessRunHandleSchema} — the envelope
 *   plus what a run that observes itself to completion reports back.
 * - {@link HarnessBlock} — the conformance alias.
 * - {@link HarnessResolver} and {@link HarnessSessionHook} — the signatures a
 *   host feeds per-run configuration through.
 * - {@link HarnessFailureKind} / {@link harnessFailureKind} — the neutral
 *   classification a harness puts on the error it fails with.
 * - {@link HarnessUsageWindow} / {@link harnessUsageWindowSchema},
 *   {@link HarnessUsageReading}, {@link HarnessUsageReader},
 *   {@link HarnessUsageReport} and {@link HarnessUsageHook} — a
 *   subscription's usage windows as a vendor reports them, and the on-demand
 *   read a host registers per harness.
 * - {@link HarnessRunSpend}, {@link HarnessBilling} and
 *   {@link reportHarnessSpend} — what one run spent, reported into the
 *   running request as the run goes and when it ends (FIX-2145, FIX-2288).
 * - {@link HarnessSteer} and {@link HarnessSteerHook} — how a run that can take
 *   a line into its turn in flight offers that to the host.
 *
 * Nothing in core imports a harness package, and nothing here names a vendor
 * notion. A harness's own extras (an SDK's result enum, the tools it observed)
 * belong on that harness's extension of these shapes, never here.
 *
 * **Abort is not a field.** A conforming harness forwards the block's own
 * `ctx.signal` into whatever cancels its run, and a cancelled run surfaces as a
 * throw — not as a handle status. No code here enforces that. Whether that
 * abort waits for the run's process is the harness's to declare, on the block
 * ({@link HarnessBlock}'s `stopsOnAbort`).
 */
import { z } from "zod";
import type { BlockContext, BlockDefinition } from "./block";
import type { AnyResourceRef } from "./resource";
import { REQUEST_SPEND_SEAM, type RequestSpendSeam } from "./request-end";

/**
 * Which harness, and which of its doors, produced a handle.
 *
 * A plain string so a harness we do not ship can name itself — but every writer
 * of the field owes the `<package>/<door>` convention (`claude-code/sdk`,
 * `codex/sdk`). The rule, not the type, is what keeps the values comparable
 * when something later checks that a run came from the harness it dispatched. Nothing branches on the value today.
 */
export type HarnessSource = string;

/**
 * Lifecycle status of a run.
 *
 * A fire-and-forget door only ever reports `"dispatched"`; a harness that
 * observes its run reaches `"completed"` or `"errored"`.
 */
export type HarnessRunStatus = "dispatched" | "running" | "completed" | "errored";

/**
 * How a run ended, in framework vocabulary — `null` until known.
 *
 * Three ways and no more: it finished, it was stopped by a limit (turns,
 * budget, time), or it failed. A vendor's own richer reason stays on the
 * vendor's extension, so no framework code ever branches on a vendor string.
 */
export type HarnessRunOutcome = "finished" | "stopped-at-limit" | "failed";

/** Token usage a harness reported, or `null` when it reported none. */
export interface HarnessRunUsage {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Whether a cost came from the harness or from us.
 *
 * `"reported"` — the harness gave the number. `"estimated"` — we derived it,
 * because the harness reports no cost at all. Carried so a report can never
 * show a precision the harness never gave.
 */
export type HarnessCostBasis = "reported" | "estimated";

/** What a run cost, and where the number came from. */
export interface HarnessRunCost {
  usd: number;
  basis: HarnessCostBasis;
}

/** What a caller hands a harness for one run. */
export interface HarnessRunInput {
  /** The instruction to run. */
  prompt: string;
}

/**
 * Runtime validator for {@link HarnessRunInput}.
 *
 * Strips unknown keys rather than rejecting them, deliberately: a smuggled
 * field (`resumeSessionId`, a `cwd`) is dropped instead of honoured, which is
 * all BP-031 asks for here — resume and working directory reach a harness
 * through the caller-fed {@link HarnessResolver}, never through block input.
 * `.strict()` would fail louder, at the cost of breaking callers that pass
 * framework metadata through the same object.
 */
export const harnessRunInputSchema = z.object({
  prompt: z.string(),
});

/**
 * The identity and status of a run — what *every* dispatch can report, whether
 * or not it ever observes a result.
 *
 * A one-way door (dispatch into a cloud queue and return) stops here; a harness
 * that runs to completion returns the fuller {@link HarnessRunHandle}.
 */
export interface HarnessRunEnvelope {
  /** Which harness and door produced this — see {@link HarnessSource}. */
  source: HarnessSource;
  status: HarnessRunStatus;
  /** The harness's own session/run id, when one could be determined. */
  sessionId: string | null;
  /** Human-openable URL for the run, when the harness exposes one. */
  url: string | null;
  /** Epoch millis when the handle was created. */
  dispatchedAt: number;
}

/** Runtime validator for {@link HarnessRunEnvelope}. */
export const harnessRunEnvelopeSchema = z.object({
  source: z.string(),
  status: z.enum(["dispatched", "running", "completed", "errored"]),
  sessionId: z.string().nullable(),
  url: z.string().nullable(),
  dispatchedAt: z.number(),
});

/**
 * What a harness hands back after a run it observed to completion.
 *
 * Every field is one any harness can fill honestly — that is the bar for
 * belonging here. The four beyond the envelope are `null` when the harness
 * reported nothing; values are never invented.
 */
export interface HarnessRunHandle extends HarnessRunEnvelope {
  /** How the run ended, or `null` while it is unknown. */
  outcome: HarnessRunOutcome | null;
  /** The run's last assistant text, or `null` if it produced none. */
  finalMessage: string | null;
  /** Token usage, or `null` when the harness reported none. */
  usage: HarnessRunUsage | null;
  /** What the run cost and how that was arrived at, or `null` when neither is known. */
  cost: HarnessRunCost | null;
}

/**
 * Runtime validator for {@link HarnessRunHandle}.
 *
 * The four post-envelope fields default to `null` so a handle persisted before
 * a harness reported them still parses (BP-030). The declared shape carries no
 * vendor field; a harness's extended handle still parses against it, because
 * the contract's job is to say what any reader may rely on — not to reject what
 * a vendor added beside it.
 */
export const harnessRunHandleSchema = harnessRunEnvelopeSchema.extend({
  outcome: z.enum(["finished", "stopped-at-limit", "failed"]).nullable().default(null),
  finalMessage: z.string().nullable().default(null),
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number() })
    .nullable()
    .default(null),
  cost: z
    .object({ usd: z.number(), basis: z.enum(["reported", "estimated"]) })
    .nullable()
    .default(null),
});

/**
 * A block that conforms to the harness contract.
 *
 * Deliberately typed over the input and output *types*, not their schemas: a
 * real harness returns the neutral handle **plus** its own extension, and the
 * schema-typed spelling rejects every one of them. This is the same shape
 * `TaskWorker` uses, and for the same reason.
 *
 * An alias over `any, any` proves less than it looks like it does. The real
 * conformance proof is a runtime one — the handle a harness returns parsing
 * against {@link harnessRunHandleSchema}; asserting assignability here is the
 * cheap half. This is a type, not an installation point: nothing in the
 * framework asks for a `HarnessBlock` slot.
 */
export type HarnessBlock = BlockDefinition<any, any, HarnessRunInput, HarnessRunHandle> & {
  /**
   * The harness's own word that when its abort signal fires, the block
   * returns only after its process has exited, so a host may stop a run and
   * start the next one in the same working directory (FIX-2312). A host that
   * drives harnesses, such as harness-manager, reads it unless it was told
   * otherwise. Absent means no. Stamped on the block the harness factory
   * returns, so a block rebuilt from it (`connectInput`, a wrapping sequencer)
   * doesn't carry it.
   */
  readonly stopsOnAbort?: boolean;
};

/**
 * The block context a harness feed is handed — **loose in three slots and
 * checked in every other one.**
 *
 * A feed's body is ordinary code a host writes against a context, so the
 * context is the only thing keeping it honest. Declaring the whole thing `any`
 * makes every read off it `any` too: `ctx.user.state.typo.deeper` type-checks
 * as whatever the reader asked for, and so does a scope-state field nobody ever
 * declared. That is not a small loss, because the one caller these exist for —
 * a manager resolving a checkout path and a session id per attempt — reads
 * exactly those slots.
 *
 * The three that stay open are the three a HARNESS's own configuration decides,
 * so pinning them would break a feed because of an option set beside it:
 *
 * - **session state**, present or absent depending on whether the harness runs
 *   detached;
 * - **targets** and **capability namespaces**, both derived from the harness
 *   block's `uses`.
 *
 * Everything else takes its default, so scope state reads `unknown` and has to
 * be narrowed deliberately. Contravariance is what makes the rest safe to pin:
 * a harness calls a feed with its OWN, narrower context, and the three open
 * slots are precisely the ones a harness narrows.
 *
 * This is the same reasoning `@flow-state-dev/claude-code` already reached for
 * its own option callbacks; the two are one alias now rather than two copies
 * that have to stay identical for a harness to be able to call a feed at all.
 */
export type HarnessCallbackContext = BlockContext<
  Record<string, unknown>,
  any,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, AnyResourceRef>,
  Record<string, unknown>,
  unknown,
  any,
  any
>;

/**
 * How a host feeds a harness one piece of per-run configuration.
 *
 * The working directory a run writes in, and the session it resumes, arrive
 * this way rather than on {@link HarnessRunInput} — the input schema is
 * model-facing through a block's capability tool preset, so a field there is a
 * field a model could set (BP-031). A resolver's answer is trusted.
 *
 * **It is handed the context and NOTHING ELSE, and that is the guarantee rather
 * than a convenience.** An earlier shape passed the run's input alongside the
 * context, which quietly undid the whole argument above: the prompt is the one
 * value a caller — or a tool-using model holding the block — controls, and a
 * resolver that can see it can be written, in ordinary-looking code, to pick the
 * directory a run writes in or the conversation it continues *from what the
 * caller sent*. That is the BP-031 defect the resolver exists to prevent,
 * reintroduced through the resolver.
 *
 * Documentation could not close it. A guarantee a caller violates by writing
 * plain code is not a guarantee, so the parameter is gone: a host cannot derive
 * a session id from the prompt because it does not have the prompt. Everything a
 * resolver legitimately needs — who this run belongs to, which attempt it is,
 * where its state lives — is a fact about the RUN and reaches it through `ctx`.
 *
 * Declared here, with the contract, because a harness package and a manager
 * package both name this signature and land independently.
 *
 * **A manager's own state is not reachable from the type**, deliberately: the
 * harness block carries the framework's default sequencer state, so a resolver
 * that reads the manager's shape casts to it. The manager owns that shape and
 * the harness never learns it, which is the whole point of the channel — the
 * cast is the honest spelling of that split rather than a hole in it.
 */
export type HarnessResolver<T> = (ctx: HarnessCallbackContext) => T | Promise<T>;

/**
 * Called by a harness the moment its vendor names a session, so the host can
 * persist the id it will later resume through a {@link HarnessResolver}.
 *
 * Fires during the run, not after it: a run that dies mid-flight has still
 * named its session, and a host that only learned the id from the returned
 * handle would have nothing to resume.
 */
export type HarnessSessionHook = (
  sessionId: string,
  ctx: HarnessCallbackContext,
) => void | Promise<void>;

/**
 * Why a harness run failed, in framework vocabulary, for the failures a host
 * has to tell apart. One kind today:
 *
 * - `"unknown-conversation"`: the harness was asked to continue a
 *   conversation (`resume`) and reported that it does not know it.
 *
 * Carried on the **error** a harness block fails with, as its
 * `harnessFailure` field, never on the handle: a refused continuation ends the
 * run before there is a handle to return. Each harness package sets it for its
 * own vendor's failure, so a host reads the classification and never a
 * vendor's message. A failure a harness has not classified reads as `null`,
 * which a host treats as an ordinary error.
 */
export type HarnessFailureKind = "unknown-conversation";

/** An error a harness block fails with, carrying its {@link HarnessFailureKind}. */
export interface ClassifiedHarnessError extends Error {
  readonly harnessFailure: HarnessFailureKind | null;
}

const HARNESS_FAILURE_KINDS: ReadonlySet<string> = new Set<HarnessFailureKind>([
  "unknown-conversation",
]);

/** How deep {@link harnessFailureKind} follows `cause`. Bounds a cyclic chain. */
const MAX_CAUSE_DEPTH = 8;

/**
 * The {@link HarnessFailureKind} a harness classified an error as, or `null`.
 *
 * Follows `cause`, so the classification still reads after the framework or a
 * host wraps the harness's error. A value that is not a known kind reads as
 * `null`, so a host's branch on the result stays exhaustive.
 *
 * ```ts
 * catch (err) {
 *   if (harnessFailureKind(err) === "unknown-conversation") showRefused();
 *   else showError(err);
 * }
 * ```
 */
export function harnessFailureKind(error: unknown): HarnessFailureKind | null {
  let current: unknown = error;
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== "object" || current === null) return null;
    const kind = (current as { harnessFailure?: unknown }).harnessFailure;
    if (typeof kind === "string" && HARNESS_FAILURE_KINDS.has(kind)) {
      return kind as HarnessFailureKind;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * One window of a harness's subscription limit, as its vendor reported it: how
 * much of it is used, how close to its limit it is, and when it resets.
 *
 * A vendor names a window by its length (Codex: 300 minutes, 10 080 minutes),
 * by its own word for it (Claude Code: `five_hour`), or both. `minutes` and
 * `id` carry what was said. `usedPercent` is 0 to 100; a vendor that sends a
 * fraction has it scaled by 100, and nothing else is derived. A vendor that
 * sends no percent leaves it `null`, never 0, and says how close the window
 * is through `level` instead.
 */
export interface HarnessUsageWindow {
  /** The vendor's id for this window, unique within one reading. */
  id: string;
  /** The vendor's name for the limit this window belongs to, or `null` when it gave none. */
  label: string | null;
  /** The window's length in minutes, or `null` when the vendor didn't say. */
  minutes: number | null;
  /** How much of the window is used, 0 to 100, or `null` when the vendor sent no percent. */
  usedPercent: number | null;
  /**
   * How close the window is to its limit, as the vendor said: `ok` (under its
   * warning line), `warning` (near the limit) or `reached`. `null` when the
   * vendor sends a percent and no level (Codex).
   */
  level: HarnessUsageLevel | null;
  /** When the window resets, in epoch ms, or `null` when the vendor didn't say. */
  resetsAt: number | null;
}

/** How close a {@link HarnessUsageWindow} is to its limit. */
export type HarnessUsageLevel = "ok" | "warning" | "reached";

/** Runtime validator for {@link HarnessUsageWindow}. `level` defaults to `null`, so a window stored before it existed still parses. */
export const harnessUsageWindowSchema = z.object({
  id: z.string(),
  label: z.string().nullable().default(null),
  minutes: z.number().nullable().default(null),
  usedPercent: z.number().finite().min(0).max(100).nullable(),
  level: z.enum(["ok", "warning", "reached"]).nullable().default(null),
  resetsAt: z.number().nullable().default(null),
});

/**
 * What one read of a harness's subscription usage found.
 *
 * Only `windows` carries a number. The other three say why there is none, in
 * words a person can be shown: the harness runs on an API key (no
 * subscription limit), nobody is signed in, or the read could not be made.
 * None of them is ever read as zero.
 */
export type HarnessUsageReading =
  | {
      status: "windows";
      /** The vendor's account id, when it named one. Never shown; a store keeps a hash of it. */
      accountId: string | null;
      /** The subscription plan, as the vendor names it, or `null`. */
      plan: string | null;
      windows: HarnessUsageWindow[];
    }
  | { status: "api-key"; reason: string }
  | { status: "signed-out"; reason: string }
  | { status: "unavailable"; reason: string };

/**
 * Read one harness's subscription usage on demand, with no run.
 *
 * A host hands one per harness to whatever holds the usage record, which
 * calls it when someone asks for a fresh number. A reader never throws for an
 * expected no-number state; it returns that state with its reason. `signal`
 * aborts a read the caller stopped waiting for.
 */
export type HarnessUsageReader = (options?: { signal?: AbortSignal }) => Promise<HarnessUsageReading>;

/**
 * One window a harness heard about during a run: what a {@link HarnessUsageHook}
 * is handed.
 *
 * A run reports the pool it draws from, not its own share, and only the
 * window its vendor named. The account and the run's start let a host keep
 * one account's windows apart from another's: a run that started before a
 * look found no subscription belongs to the old sign-in.
 */
export interface HarnessUsageReport {
  /** The harness that heard it, by the name a usage record is kept under (`claude-code`). */
  harness: string;
  window: HarnessUsageWindow;
  /** When the vendor said it, in epoch ms. */
  observedAt: number;
  /** When the run started, in epoch ms. */
  runStartedAt: number;
  /** The vendor's id for the account the run is signed in as, or `null` when it named none. Never shown. */
  accountId: string | null;
}

/**
 * Called by a harness when its vendor reports a usage window during a run, so
 * the host can record it. The twin of {@link HarnessSessionHook}.
 *
 * A harness awaits it, so a write can't land after the run ends, but a throw
 * never fails the run: usage is a reading, not part of the work.
 */
export type HarnessUsageHook = (report: HarnessUsageReport, ctx: HarnessCallbackContext) => void | Promise<void>;

/**
 * How a harness run was paid for, as the harness knows it from its own
 * sign-in (FIX-2145): `api-key`, billed per token; `subscription`, drawn from
 * a plan's windows. `null` when the harness can't tell.
 */
export type HarnessBilling = "api-key" | "subscription";

/**
 * What one harness run has spent, as its harness reports it (FIX-2145): at
 * the run's start, on each usage event its vendor sends, and when the run
 * ends, however it ends (FIX-2288). Only what the vendor reported: a token
 * count or a cost the vendor never sent is `null`, never 0 and never an
 * estimate.
 */
export interface HarnessRunSpend {
  /**
   * The harness's own id for this run (FIX-2288). A later report with the same
   * id replaces the earlier one, so a harness reports its running total, never
   * an increment. Absent: the report is one settled run of its own.
   */
  runId?: string;
  /** The harness, by the name a usage record is kept under (`claude-code`, `codex`, `cursor`). */
  harness: string;
  /**
   * The model the run uses, as the harness knows it (FIX-2288): the one its
   * vendor named, else the one the run was started with. `null` when neither
   * is known (the vendor picked its default and never said which). Absent on
   * a report made before it existed (BP-030).
   */
  model?: string | null;
  /** Input tokens the vendor reported, or `null` when it reported none (a run killed before its usage arrived). */
  inputTokens: number | null;
  /** Output tokens the vendor reported, or `null` when it reported none. */
  outputTokens: number | null;
  /** The cost the vendor reported, in US dollars, or `null` when it reported none. Never a price-table estimate. */
  costUsd: number | null;
  /** How the run was paid for, or `null` when the harness can't tell. */
  billing: HarnessBilling | null;
}

/**
 * Report a harness run's spend to the running request (FIX-2145). It is
 * counted in the request's spend, which request-end hooks are handed and
 * `readRequestSpend` reads; it is not a model call, so `ctx.request.tokenUsage`
 * and an action's token budget never see it.
 *
 * **A later report for the same run replaces the earlier one** (FIX-2288).
 * With a `runId`, a harness reports as its run goes: at its start (its model,
 * tokens `null`), on each usage event its vendor sends (the run's total so
 * far), and from its `finally` when the run ends however it ends (the final
 * total). Each report carries the whole run so far, never an increment, and
 * the run counts once. Without a `runId`, each call is one settled run.
 *
 * @returns `false` when the context carries no spend ledger: a hand-built
 *   test context, or a block run outside a request. Nothing is counted then.
 */
export function reportHarnessSpend(ctx: object, spend: HarnessRunSpend): boolean {
  const seam = (ctx as { readonly [REQUEST_SPEND_SEAM]?: RequestSpendSeam })[REQUEST_SPEND_SEAM];
  if (seam == null) return false;
  seam.reportHarnessRun(spend);
  return true;
}

/**
 * Hands one line to a run's turn in flight. Resolves `"delivered"` only when
 * the turn has the words; anything less (the run refused, the turn ended, the
 * call threw) is `"refused"`, and the caller sends the line some other way.
 *
 * It never rejects. It waits for the vendor's own answer rather than a timer:
 * a timeout cannot tell a refusal from a delivery, and guessing would send the
 * line twice.
 */
export type HarnessSteer = (text: string) => Promise<"delivered" | "refused">;

/**
 * Called by a harness while its run can take a line in flight, with the
 * {@link HarnessSteer} that does it, and again with `null` once it no longer
 * can, before the block returns, on every exit.
 *
 * A fact about one run, not about the harness: a harness that can steer still
 * has runs that can't (a cloud run, a turn not yet started). A harness that
 * never steers simply never calls it. The twin of {@link HarnessSessionHook}.
 */
export type HarnessSteerHook = (steer: HarnessSteer | null, ctx: HarnessCallbackContext) => void;

/**
 * One thing a run did, as a {@link HarnessActivityHook} is handed it
 * (FIX-2290): a completed assistant message, or a tool call it started, in the
 * shapes a harness's translator already produces. Reasoning is never one.
 */
export type HarnessActivity =
  | { kind: "message"; text: string }
  | { kind: "tool"; name: string; /** The call's arguments, as the JSON text the vendor sent. */ arguments: string };

/**
 * Called by a harness with each {@link HarnessActivity} of its run, so the host
 * can say how the run is doing (harness-manager keeps the task's status note
 * from it). Not awaited, and a throw or a rejection never fails the run: like
 * usage, it is a reading, not part of the work. A harness that reports none
 * never calls it.
 */
export type HarnessActivityHook = (activity: HarnessActivity, ctx: HarnessCallbackContext) => void;
