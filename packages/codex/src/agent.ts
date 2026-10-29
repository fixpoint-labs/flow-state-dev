/**
 * `codexAgent` — handler block running OpenAI's Codex agent through the Codex
 * SDK, which spawns `codex exec --experimental-json` and streams its JSONL back.
 *
 * The block starts (or resumes) a thread in a directory the HOST resolved, runs
 * one turn, mirrors what the run says and does into the item stream, and
 * returns the framework's neutral harness handle plus Codex's own extras.
 *
 * Two things are configuration and never block input — the directory a run
 * writes in and the conversation it continues — because this block is exposed
 * to models as a tool through its capability, and a field on the input is a
 * field a model can set (BP-031). Both arrive through resolvers the host writes.
 * The write side of the second one is `onSession`: the moment the stream names
 * the thread, the id goes to the host's durable state, BEFORE anything that
 * could throw. A cancelled run returns no handle, so the hook is the only
 * carrier that survives exactly the deadline it exists for.
 *
 * By default the block also records each pull request the run opens in core's
 * pull-request record (`recordPullRequests`): it declares the collection and
 * starts core's recorder, which reads Codex's command and MCP calls as they
 * settle. It is a session resource, not session state, so a task board still
 * dispatches the block.
 */
import {
  OBSERVED_PULL_REQUESTS,
  formatRunDuration,
  handler,
  harnessRunInputSchema,
  observedPullRequestsCollection,
  recordPullRequests as startPullRequestRecorder,
  reportHarnessActivity,
} from "@flow-state-dev/core";
import { reportHarnessSpend } from "@flow-state-dev/core/types";
import type {
  HarnessActivityHook,
  HarnessBilling,
  HarnessCallbackContext,
  HarnessResolver,
  HarnessRunOutcome,
  HarnessSessionHook,
} from "@flow-state-dev/core/types";
import type { UsesSlot } from "@flow-state-dev/core";
import {
  assertTestedSdkVersion,
  createDefaultResolveCodexClient,
  readInstalledCodexSdkVersion,
} from "./codex-client";
import { createEmitState, emitTranslatedEvent, finalizeOpenItems } from "./emit";
import { readableFailure, translateCodexEvent } from "./translate";
import { estimateCodexCost } from "./cost";
import {
  CodexAgentAbortedError,
  CodexAgentConfigError,
  CodexAgentRunError,
  CodexSdkNotInstalledError,
  isUnknownThreadFailure,
} from "./errors";
import {
  CODEX_SOURCE,
  codexAgentHandleSchema,
  type CodexAgentHandle,
  type CodexClientOptions,
  type CodexRunUsage,
  type CodexThreadEvent,
  type CodexThreadLike,
  type CodexThreadOptions,
  type InstalledSdkVersionReader,
  type ResolveCodexClient,
} from "./types";

/**
 * The block context an option callback receives — the contract's own alias.
 *
 * This package declared a local copy of this shape until core exported one.
 * Using the contract's is the point of the contract: a resolver a host writes
 * against `HarnessResolver` is handed exactly this, so a harness that narrowed
 * or widened it locally would be the one place a host's callback stopped
 * type-checking for reasons that had nothing to do with the host.
 */
type AgentCallbackContext = HarnessCallbackContext;

/** The name Codex's usage is kept under, as its usage reader's record is. */
const CODEX_HARNESS = "codex";

/** Options for {@link codexAgent}. */
export interface CodexAgentOptions {
  /**
   * Where the run works. Called once per invocation, before anything is
   * spawned, and its answer becomes the thread's `workingDirectory`.
   *
   * **A resolver, never a field on the block's input** — a correctness
   * constraint, not a style preference. The same block is a model-facing tool
   * through the capability, so a directory reachable from the input is one the
   * model could choose (BP-031). Omit it and the run works in the host
   * process's own directory, which is almost never what a host wants.
   */
  cwd?: HarnessResolver<string>;
  /**
   * Which conversation to continue. Called once per invocation; `null`, `""`
   * and `undefined` all mean "start a fresh thread".
   *
   * Same fence as `cwd`, and the same reason: a session id on the input is a
   * model resuming any conversation it has seen into the current checkout.
   */
  resume?: HarnessResolver<string | null | undefined>;
  /**
   * The write side of {@link resume}: called once, with the thread id, the
   * moment the stream names it — and before any turn work is consumed.
   *
   * This is the only carrier that survives a cancelled run. A throw returns no
   * handle (LAB-152 §9) and a status item is transient by contract, so a host
   * whose deadline fired would otherwise have nothing to resume from. The hook
   * fires on an actual `thread.started` event and on nothing else, which is why
   * a REFUSED resume never reaches it: the CLI names no thread in that case, so
   * no dead id is ever written back over a good one.
   */
  onSession?: HarnessSessionHook;
  /**
   * Called with each assistant message and each tool call the run starts
   * (FIX-2290), so a host can say how the run is doing. Not awaited, and a
   * throw is logged and swallowed.
   */
  onActivity?: HarnessActivityHook;
  /**
   * Which model the run uses: a fixed id, or a resolver called once per
   * invocation, like `cwd` and `resume`, so one block can run a different
   * model for each run. It becomes the thread's `model` on a fresh thread and a
   * resumed one alike, and it is what the cost estimate is priced against.
   *
   * `null`, `""` and `undefined` from the resolver all mean "no model named":
   * Codex runs its own default. Setting this and `thread.model` together is
   * refused when the block is built: one owner per value.
   */
  model?: string | HarnessResolver<string | null | undefined>;
  /**
   * The SDK's thread options, forwarded verbatim (model, sandbox mode, approval
   * policy, reasoning effort, network and web-search settings, the git-repo
   * check, additional directories).
   *
   * The model the run used (this group's `model`, or the block's own
   * {@link CodexAgentOptions.model}) is also what the cost estimate is priced
   * against — Codex's wire never names the model that ran, so a run left on
   * Codex's default reports no cost at all.
   *
   * A `workingDirectory` or a `signal` in this bag is refused when the block is
   * built: each has exactly one owner (`cwd`, and the block's own `ctx.signal`).
   */
  thread?: CodexThreadOptions;
  /**
   * The SDK's client options, forwarded verbatim (API key, environment, config
   * overrides, a binary path override). Refused for the same two keys as
   * {@link thread}.
   */
  client?: CodexClientOptions;
  /** Host hook resolving the Codex client. Default: lazy SDK import. */
  resolveCodexClient?: ResolveCodexClient;
  /**
   * Record each pull request the run opens in core's pull-request record
   * (`observed-pull-requests`). Default `true`: a `gh pr create` or a
   * create-pull-request tool whose result names a pull request is a row; a
   * `gh pr view` is not. `false` declares nothing and records nothing.
   */
  recordPullRequests?: boolean;
  /** Capabilities forwarded to the underlying handler. */
  uses?: UsesSlot;
  /** Block name. Default `"codex-agent"`. */
  name?: string;
}

/**
 * The version gate's test seam, keyed by a symbol this module does not export
 * from the package root.
 *
 * It is deliberately not a field on {@link CodexAgentOptions}. A host able to
 * substitute its own version reader could answer with the tested version and run
 * an unvalidated wire — which would make the exact-version refusal, one of the
 * three things this package promises, a claim rather than a guarantee. The specs
 * import this symbol from the module directly; a consumer of the package cannot
 * name it, so the only reachable behaviour is the real gate.
 */
export const INTERNAL_SDK_VERSION_READER = Symbol("codex.internal.readInstalledSdkVersion");

/** The shape the specs pass through the symbol above. */
interface InternalTestSeams {
  [INTERNAL_SDK_VERSION_READER]?: InstalledSdkVersionReader;
}

/** Option-group keys the block owns and therefore refuses to forward. */
const REFUSED_THREAD_KEYS = ["workingDirectory", "signal"] as const;
const REFUSED_CLIENT_KEYS = ["signal"] as const;

/**
 * Refuse a forwarded option group carrying something the block owns.
 *
 * A runtime check rather than a type-level one because the types this package
 * declares for the two groups already omit these keys — so the only way one
 * arrives is a caller spreading an untyped bag, which is exactly the case a
 * type cannot catch and the case that matters (BP-031).
 */
function assertNoOwnedKeys(
  group: Record<string, unknown> | undefined,
  keys: readonly string[],
  groupName: string,
  owner: Record<string, string>,
): void {
  if (group === undefined) return;
  for (const key of keys) {
    if (key in group) {
      throw new CodexAgentConfigError(
        `codexAgent: \`${groupName}.${key}\` is not forwarded — ${owner[key]}. Remove it from \`${groupName}\`.`,
      );
    }
  }
}

/**
 * Build the Codex harness block.
 *
 * Refuses to build against an installed `@openai/codex-sdk` that is not the
 * tested version, and against an option group carrying a working directory or a
 * turn signal. Both are configuration errors a host sees at wiring time.
 */
export function codexAgent(options: CodexAgentOptions = {}) {
  const {
    cwd: resolveCwd,
    resume: resolveResume,
    onSession,
    onActivity,
    model,
    thread: threadOptions,
    client: clientOptions,
    resolveCodexClient = createDefaultResolveCodexClient(clientOptions ?? {}),
    recordPullRequests = true,
    uses,
    name = "codex-agent",
  } = options;

  assertTestedSdkVersion(
    (options as InternalTestSeams)[INTERNAL_SDK_VERSION_READER] ?? readInstalledCodexSdkVersion,
  );
  assertNoOwnedKeys(
    threadOptions as Record<string, unknown> | undefined,
    REFUSED_THREAD_KEYS,
    "thread",
    {
      workingDirectory: "the `cwd` resolver owns where a run works",
      signal: "the block's own `ctx.signal` owns cancellation",
    },
  );
  if (model !== undefined && threadOptions?.model !== undefined) {
    throw new CodexAgentConfigError(
      "codexAgent: `model` and `thread.model` cannot be set together — each names the model a run uses. Drop one.",
    );
  }
  assertNoOwnedKeys(
    clientOptions as Record<string, unknown> | undefined,
    REFUSED_CLIENT_KEYS,
    "client",
    { signal: "the block's own `ctx.signal` owns cancellation" },
  );

  // How a run is paid for (FIX-2145): a key handed to the client bills per
  // token; anything else (a ChatGPT sign-in, a key the CLI finds itself) is
  // not this block's to know.
  const billing: HarnessBilling | null = clientOptions?.apiKey ? "api-key" : null;

  return handler({
    name,
    description:
      "Run OpenAI's Codex agent through the Codex SDK, mirroring its streamed items into FSD items.",
    // The contract's own schema, not a local copy: a hand-rolled duplicate
    // would sit in the type-level conformance assertion's blind spot
    // (parameter bivariance accepts extra required input fields) and stay
    // silent if the contract's input ever grew.
    inputSchema: harnessRunInputSchema,
    outputSchema: codexAgentHandleSchema,
    ...(recordPullRequests ? { resources: { [OBSERVED_PULL_REQUESTS]: observedPullRequestsCollection } } : {}),
    ...(uses !== undefined ? { uses } : {}),
    execute: async (input, ctx: AgentCallbackContext): Promise<CodexAgentHandle> => {
      const prompt = input.prompt?.trim();
      if (!prompt) {
        throw new CodexAgentRunError("codexAgent requires a non-empty prompt.");
      }
      // A deadline that has already fired must not spawn a process it will
      // immediately have to kill.
      if (ctx.signal?.aborted) throw new CodexAgentAbortedError(null);
      if (recordPullRequests) startPullRequestRecorder(ctx);

      // Both resolved once per invocation, before anything is spawned, so the
      // directory the SDK is handed and the thread it continues cannot be two
      // different answers from one resolver.
      //
      // Neither is handed the run's input, and that is the contract's guarantee
      // rather than an omission here: the prompt is the one thing a model
      // controls, so a directory or a session id derived from it is a decision
      // made from caller-controllable input (BP-031). The resolver signature
      // takes the context alone, which makes that unavailable rather than
      // merely discouraged.
      const workingDirectory = resolveCwd === undefined ? undefined : await resolveCwd(ctx);
      const resumeIdRaw = resolveResume === undefined ? null : await resolveResume(ctx);
      // `""` is treated as `null`: a host reading an unset field out of its own
      // state should get a fresh thread, not a resume of the empty id.
      const resumeId = resumeIdRaw === undefined || resumeIdRaw === "" ? null : resumeIdRaw;
      // The model, resolved once beside them. Unset, `thread.model` (or Codex's default) stands.
      const runModel = (typeof model === "function" ? await model(ctx) : model) || threadOptions?.model;

      const client = await resolveCodexClient(ctx);
      const dispatchedAt = Date.now();
      const threadArgs = {
        ...threadOptions,
        ...(runModel !== undefined ? { model: runModel } : {}),
        ...(workingDirectory !== undefined ? { workingDirectory } : {}),
      };
      const thread =
        resumeId === null
          ? client.startThread(threadArgs)
          : client.resumeThread(resumeId, threadArgs);

      const emitState = createEmitState();
      let sessionId: string | null = resumeId;
      let hookFired = false;
      let usage: CodexRunUsage | null = null;
      let failureMessage: string | null = null;
      // The stream's last own `error`: the failure when no terminal turn event follows.
      let streamError: string | null = null;
      // Whether an error item already told the person why the run failed.
      let failureShown = false;
      // Tracked beside the outcome, never derived from it: a terminal turn
      // event that ARRIVED and one this version does not recognise are
      // different facts, and only `null` may mean "nothing terminal arrived".
      // A manager settles runs on that difference (LAB-152's contract).
      let outcome: HarnessRunOutcome | null = null;

      // What the run spent, into the request, however it ends (FIX-2145): the
      // tokens Codex reported by then, never a cost (Codex reports none, and an
      // estimate is not a reported cost).
      try {
        try {
          const stream = await runStreamed(thread, prompt, ctx.signal);
          const iterator = stream[Symbol.asyncIterator]();
          // The block's own signal, raced against the stream rather than merely
          // forwarded into it. The SDK's abort rejects only once the CLI's stdout
          // closes (POC finding, §9), and a subprocess the CLI spawned can hold
          // that open long past the caller's deadline — at which point the
          // deadline no longer bounds what it promised to.
          const deadline = abortRace(ctx.signal);
          try {
            for (;;) {
              const pending = iterator.next();
              // The losing side of a race still settles, and nothing is awaiting
              // it any more. When the deadline wins, the CLI is killed moments
              // later and this rejects — unhandled, which can take a host's
              // process down over a cancel that worked. Claiming the rejection
              // here does not hide it from the `await` below: a promise may have
              // any number of reactions, and the one that matters still sees it.
              pending.catch(() => {});
              const next = await Promise.race([pending, deadline.promise]);
              if (next.done === true) break;
              for (const event of translateCodexEvent(next.value)) {
                if (event.kind === "thread_started") {
                  sessionId = event.threadId;
                  // BEFORE any turn work is consumed, and before anything below
                  // can throw: a cancelled or crashed run returns no handle, and
                  // a status item is transient by contract, so this hook is the
                  // only carrier that reaches the host's durable state in exactly
                  // the case the resume resolver exists for.
                  if (!hookFired) {
                    hookFired = true;
                    await onSession?.(event.threadId, ctx);
                  }
                  ctx.emit.status(`Codex thread ${event.threadId}`);
                  continue;
                }
                if (event.kind === "turn_completed") {
                  outcome = "finished";
                  usage = event.usage;
                }
                if (event.kind === "turn_failed") {
                  outcome = "failed";
                  failureMessage = event.message;
                }
                if (event.kind === "stream_error") streamError = event.message;
                reportHarnessActivity(onActivity, event, ctx);
                await emitTranslatedEvent(event, ctx, emitState, name);
              }
            }
          } finally {
            deadline.dispose();
            // Tell the stream nobody is reading it any more. On the normal path
            // the generator is already done and this is a no-op; on the abort and
            // throw paths it is what lets the SDK release the reader instead of
            // holding it for a consumer that has gone.
            void iterator.return?.().catch(() => {});
          }
        } catch (err) {
          await finalizeOpenItems(ctx, emitState, name);
          const failure = toRunFailure(
            err,
            sessionId,
            hookFired ? null : resumeId,
            failureMessage ?? (streamError === null ? null : readableFailure(streamError)),
          );
          // One line; what the CLI said on its way out rides along as details.
          const said = failure instanceof CodexAgentRunError ? failure.detail?.cause : undefined;
          await emitTranslatedEvent(
            {
              kind: "error",
              message: failure.message,
              code: failure.code,
              ...(said !== undefined && !failure.message.includes(said) ? { details: { output: said } } : {}),
            },
            ctx,
            emitState,
            name,
          );
          // Codex already reported the turn failed; the CLI's exit after it says
          // nothing new. Settle it as the `turn.failed` it is, an outcome like
          // the one with no exit after it, so the run's failure is shown once
          // (a throw would have the runtime add its own copy of the same line).
          if (outcome !== "failed" || failure instanceof CodexAgentAbortedError) throw failure;
          failureShown = true;
        }

        await finalizeOpenItems(ctx, emitState, name);

        // A stream that errored and then ended with no terminal turn event: its
        // error is what happened, kept as the run's one failure line.
        if (outcome === null && streamError !== null) {
          failureMessage = readableFailure(streamError);
          await emitTranslatedEvent({ kind: "error", message: failureMessage }, ctx, emitState, name);
          failureShown = true;
        }

        const handle: CodexAgentHandle = {
          source: CODEX_SOURCE,
          // `outcome` is the fact; `status` follows it. A run that produced no
          // terminal turn event did not complete, so it reads `errored` with
          // `outcome: null` — "we do not know how it ended", not "it failed".
          status: outcome === "finished" ? "completed" : "errored",
          sessionId,
          url: null,
          dispatchedAt,
          outcome,
          finalMessage: emitState.finalMessage,
          usage:
            usage === null ? null : { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
          cost: estimateCodexCost(usage, runModel),
          codexUsage: usage,
          failureMessage,
        };

        // An error item already says why the run failed; the closing note would say it again.
        if (!failureShown) {
          ctx.emit.status(
            outcome === "finished"
              ? `Codex run completed in ${formatRunDuration(Date.now() - dispatchedAt)}.`
              : `Codex run errored (${failureMessage ?? "no terminal turn event"}).`,
            { transient: false },
          );
        }

        return handle;
      } finally {
        reportHarnessSpend(ctx, {
          harness: CODEX_HARNESS,
          inputTokens: usage?.inputTokens ?? null,
          outputTokens: usage?.outputTokens ?? null,
          costUsd: null,
          billing,
        });
      }
    },
  });
}

/**
 * The error a failed run should throw, given whatever the stream threw.
 *
 * Re-wrapping everything loses two things that matter. A caller branches on the
 * error CLASS — an abort is a deadline the caller set, a missing SDK is a
 * configuration mistake, and neither is "the run failed" — and `(err as Error)
 * .message` on a value that is not an `Error` is `undefined`, so a string throw
 * from the vendor produced the message "Codex run failed: undefined" at exactly
 * the moment an operator needed it to say something.
 *
 * So: our own classes pass through, and a foreign throw is wrapped with its
 * original kept on the native `cause` chain rather than flattened to a string.
 *
 * `unnamedResume` is the thread the run asked to resume when the stream never
 * named one, else `null`: only then can the failure be Codex refusing it.
 *
 * `turnFailure` is the message of a `turn.failed` the stream already carried
 * (else of its last own `error`).
 * The CLI exits non-zero after one, and the SDK's throw then holds the whole
 * of the CLI's stderr (every log line of the run), so the turn's own message
 * is the failure and the throw's is kept on `detail.cause`.
 */
function toRunFailure(
  err: unknown,
  sessionId: string | null,
  unnamedResume: string | null,
  turnFailure: string | null = null,
): CodexAgentError {
  // Re-minted rather than passed through: the abort raised inside the race
  // knows no thread id, and the id is the whole point of the error — it is what
  // lets a manager resume the run its own deadline killed.
  if (err instanceof CodexAgentAbortedError) return new CodexAgentAbortedError(sessionId);
  // Already ours. Wrapping again buries the class under a second
  // "Codex run failed:" prefix and tells a caller nothing new.
  if (err instanceof CodexSdkNotInstalledError) return err;
  if (err instanceof CodexAgentRunError) return err;
  const reason = err instanceof Error ? err.message : String(err);
  // Codex refusing the thread this run asked for, before naming any thread, is
  // the one failure classified in core's vocabulary: a host shows it refused
  // and keeps the id. Every other failure, early or late, is an ordinary error.
  if (unnamedResume !== null && isUnknownThreadFailure(reason, unnamedResume)) {
    return new CodexAgentRunError(
      `Codex did not continue thread ${unnamedResume}: ${reason}`,
      { cause: reason },
      err,
      "unknown-conversation",
    );
  }
  if (turnFailure !== null) {
    return new CodexAgentRunError(`Codex run failed: ${turnFailure}`, { cause: reason }, err);
  }
  return new CodexAgentRunError(`Codex run failed: ${reason}`, { cause: reason }, err);
}

/** Any of this package's errors that a failed run can end as. */
type CodexAgentError = CodexAgentAbortedError | CodexAgentRunError | CodexSdkNotInstalledError;

/**
 * Start the turn, forwarding the block's own signal into it.
 *
 * The SDK is still told about the signal — that is what kills the CLI process —
 * even though the block does not rely on the SDK's rejection to stop waiting.
 * Both halves are needed: forwarding without racing leaves the block hanging on
 * a stream the deadline already gave up on, and racing without forwarding
 * leaves the CLI running after the block has walked away.
 */
async function runStreamed(
  thread: CodexThreadLike,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<AsyncIterable<CodexThreadEvent>> {
  const { events } = await thread.runStreamed(
    prompt,
    signal === undefined ? undefined : { signal },
  );
  return events;
}

/**
 * A promise that rejects with {@link CodexAgentAbortedError} the moment `signal`
 * fires, and a `dispose` that removes the listener.
 *
 * `dispose` is not tidiness. A request-scoped signal outlives every block under
 * it, so a listener left behind accumulates one per run; and the losing side of
 * the race stays pending forever, which Node reports as an unhandled rejection
 * once nothing is awaiting it.
 */
function abortRace(signal: AbortSignal | undefined): {
  promise: Promise<never>;
  dispose: () => void;
} {
  if (signal === undefined) {
    return { promise: new Promise<never>(() => {}), dispose: () => {} };
  }
  // An AbortSignal that is ALREADY aborted never fires `abort` again, so a
  // listener on its own would wait forever. That is not a hypothetical window:
  // the two resolvers, the SDK import, the thread start and `runStreamed` all
  // await before this is armed, and a deadline landing anywhere in there would
  // leave the block waiting on the vendor's stream — the exact hang the race
  // exists to prevent, arrived at by the one path the race did not cover.
  if (signal.aborted) {
    const rejected = Promise.reject(new CodexAgentAbortedError(null));
    rejected.catch(() => {});
    return { promise: rejected, dispose: () => {} };
  }
  let onAbort: () => void = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new CodexAgentAbortedError(null));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  // Claimed here so the loser of the race is never an unhandled rejection. The
  // real handling is at the `await`, which sees the same rejection.
  promise.catch(() => {});
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}
