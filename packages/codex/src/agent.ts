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
 */
import { handler, harnessRunInputSchema } from "@flow-state-dev/core";
import type {
  AnyResourceRef,
  BlockContext,
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
import { translateCodexEvent } from "./translate";
import { estimateCodexCost } from "./cost";
import {
  CodexAgentAbortedError,
  CodexAgentConfigError,
  CodexAgentRunError,
  CodexSdkNotInstalledError,
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
 * The block context as an option callback receives it.
 *
 * Loose in the two slots this factory's own configuration fills in (`uses`
 * decides the capability namespaces and the state targets), for the reason
 * `claude-code`'s equivalent alias records: a callback that stops type-checking
 * because of an option set beside it is not a signal a caller can act on.
 * Everything else stays checked.
 */
type AgentCallbackContext = BlockContext<
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, unknown>,
  Record<string, AnyResourceRef>,
  Record<string, unknown>,
  unknown,
  any,
  any
>;

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
   * The SDK's thread options, forwarded verbatim (model, sandbox mode, approval
   * policy, reasoning effort, network and web-search settings, the git-repo
   * check, additional directories).
   *
   * `model` here is also what the cost estimate is priced against — Codex's
   * wire never names the model that ran, so a run left on Codex's default
   * reports no cost at all.
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
    thread: threadOptions,
    client: clientOptions,
    resolveCodexClient = createDefaultResolveCodexClient(clientOptions ?? {}),
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
  assertNoOwnedKeys(
    clientOptions as Record<string, unknown> | undefined,
    REFUSED_CLIENT_KEYS,
    "client",
    { signal: "the block's own `ctx.signal` owns cancellation" },
  );

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
    ...(uses !== undefined ? { uses } : {}),
    execute: async (input, ctx: AgentCallbackContext): Promise<CodexAgentHandle> => {
      const prompt = input.prompt?.trim();
      if (!prompt) {
        throw new CodexAgentRunError("codexAgent requires a non-empty prompt.");
      }
      // A deadline that has already fired must not spawn a process it will
      // immediately have to kill.
      if (ctx.signal?.aborted) throw new CodexAgentAbortedError(null);

      // ONE input for every resolver on this block, and it is the input the
      // block validated — not a second object built beside it. Resolvers that
      // coordinate (a directory derived from the same prompt a sandbox is) must
      // be told the same thing.
      const resolverInput = { prompt };

      // Both resolved once per invocation, before anything is spawned, so the
      // directory the SDK is handed and the thread it continues cannot be two
      // different answers from one resolver.
      const workingDirectory = resolveCwd === undefined ? undefined : await resolveCwd(resolverInput, ctx);
      const resumeIdRaw = resolveResume === undefined ? null : await resolveResume(resolverInput, ctx);
      // `""` is treated as `null`: a host reading an unset field out of its own
      // state should get a fresh thread, not a resume of the empty id.
      const resumeId = resumeIdRaw === undefined || resumeIdRaw === "" ? null : resumeIdRaw;

      const client = await resolveCodexClient(ctx);
      const dispatchedAt = Date.now();
      const threadArgs = {
        ...threadOptions,
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
      // Tracked beside the outcome, never derived from it: a terminal turn
      // event that ARRIVED and one this version does not recognise are
      // different facts, and only `null` may mean "nothing terminal arrived".
      // A manager settles runs on that difference (LAB-152's contract).
      let outcome: HarnessRunOutcome | null = null;

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
                ctx.emit.status(`Codex thread ${event.threadId}.`);
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
        const failure = toRunFailure(err, sessionId);
        await emitTranslatedEvent(
          { kind: "error", message: failure.message, code: failure.code },
          ctx,
          emitState,
          name,
        );
        throw failure;
      }

      await finalizeOpenItems(ctx, emitState, name);

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
        cost: estimateCodexCost(usage, threadOptions?.model),
        codexUsage: usage,
        failureMessage,
      };

      ctx.emit.status(
        outcome === "finished"
          ? "Codex run completed."
          : `Codex run errored (${failureMessage ?? "no terminal turn event"}).`,
        { transient: false },
      );

      return handle;
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
 */
function toRunFailure(err: unknown, sessionId: string | null): CodexAgentError {
  // Re-minted rather than passed through: the abort raised inside the race
  // knows no thread id, and the id is the whole point of the error — it is what
  // lets a manager resume the run its own deadline killed.
  if (err instanceof CodexAgentAbortedError) return new CodexAgentAbortedError(sessionId);
  // Already ours. Wrapping again buries the class under a second
  // "Codex run failed:" prefix and tells a caller nothing new.
  if (err instanceof CodexSdkNotInstalledError) return err;
  if (err instanceof CodexAgentRunError) return err;
  const reason = err instanceof Error ? err.message : String(err);
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
