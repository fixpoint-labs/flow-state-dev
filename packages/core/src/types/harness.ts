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
 *
 * Nothing in core imports a harness package, and nothing here names a vendor
 * notion. A harness's own extras (an SDK's result enum, the tools it observed)
 * belong on that harness's extension of these shapes, never here.
 *
 * **Abort is not a field.** A conforming harness forwards the block's own
 * `ctx.signal` into whatever cancels its run, and a cancelled run surfaces as a
 * throw — not as a handle status. No code here enforces that.
 */
import { z } from "zod";
import type { BlockContext, BlockDefinition } from "./block";
import type { AnyResourceRef } from "./resource";

/**
 * Which harness, and which of its doors, produced a handle.
 *
 * A plain string so a harness we do not ship can name itself — but every writer
 * of the field owes the `<package>/<door>` convention (`claude-code/sdk`,
 * `claude-code/cli-remote`, `codex/sdk`). The rule, not the type, is what keeps
 * the values comparable when something later checks that a run came from the
 * harness it dispatched. Nothing branches on the value today.
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
export type HarnessBlock = BlockDefinition<any, any, HarnessRunInput, HarnessRunHandle>;

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
