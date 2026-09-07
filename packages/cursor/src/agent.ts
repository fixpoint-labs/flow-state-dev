/**
 * `cursorAgent` — handler block running Cursor's coding agent through the
 * Cursor SDK's local runtime.
 *
 * The block starts (or resumes) a Cursor agent in a directory the HOST
 * resolved, sends one prompt, mirrors what the run says and does into the item
 * stream, and returns the framework's neutral harness handle plus Cursor's own
 * extras.
 *
 * Two things are configuration and never block input — the directory a run
 * writes in and the conversation it continues — because this block is exposed
 * to models as a tool through its capability, and a field on the input is a
 * field a model can set (BP-031). Both arrive through resolvers the host writes.
 * The write side of the second one is `onSession`: the moment the SDK opens an
 * agent, the id goes to the host's durable state, BEFORE the prompt is sent. A
 * cancelled run returns no handle, so the hook is the only carrier that survives
 * exactly the deadline it exists for.
 *
 * The run's outcome comes from `run.wait()` and from nowhere else. Cursor
 * reports its terminal result there rather than on the stream, so a `status`
 * message saying `FINISHED` is a note and nothing more. That is the difference
 * from Codex, whose translator has to decide how a turn ended from the last
 * event that arrived.
 */
import { handler, harnessRunInputSchema } from "@flow-state-dev/core";
import type {
  HarnessCallbackContext,
  HarnessResolver,
  HarnessRunOutcome,
  HarnessSessionHook,
} from "@flow-state-dev/core/types";
import type { UsesSlot } from "@flow-state-dev/core";
import {
  assertTestedSdkVersion,
  createDefaultResolveCursorClient,
  readInstalledCursorSdkVersion,
} from "./cursor-client";
import { createEmitState, emitTranslatedEvent, finalizeOpenItems } from "./emit";
import { addUsage, normalizeUsage, translateCursorMessage } from "./translate";
import { estimateCursorCost } from "./cost";
import {
  CursorAgentAbortedError,
  CursorAgentConfigError,
  CursorAgentRunError,
  CursorSdkNotInstalledError,
} from "./errors";
import {
  CURSOR_SOURCE,
  cursorAgentHandleSchema,
  type CursorAgentHandle,
  type CursorAgentLike,
  type CursorCreateOptions,
  type CursorRunLike,
  type CursorRunResult,
  type CursorRunUsage,
  type CursorSendOptions,
  type InstalledSdkVersionReader,
  type ResolveCursorClient,
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

/** Options for {@link cursorAgent}. */
export interface CursorAgentOptions {
  /**
   * Where the run works. Called once per invocation, before anything is
   * created, and its answer becomes the agent's `local.cwd`.
   *
   * **A resolver, never a field on the block's input** — a correctness
   * constraint, not a style preference. The same block is a model-facing tool
   * through the capability, so a directory reachable from the input is one the
   * model could choose (BP-031). Omit it and the SDK picks its own default,
   * which is almost never what a host wants.
   */
  cwd?: HarnessResolver<string>;
  /**
   * Which conversation to continue. Called once per invocation; `null`, `""`
   * and `undefined` all mean "start a fresh agent".
   *
   * Same fence as `cwd`, and the same reason: a session id on the input is a
   * model resuming any conversation it has seen into the current checkout.
   */
  resume?: HarnessResolver<string | null | undefined>;
  /**
   * The write side of {@link resume}: called once, with the agent id, the
   * moment the SDK opens one — and before the prompt is sent.
   *
   * This is the only carrier that survives a cancelled run. A throw returns no
   * handle (LAB-152 §9) and a status item is transient by contract, so a host
   * whose deadline fired would otherwise have nothing to resume from. The hook
   * fires on a successful `create` / `resume` and on nothing else, which is why
   * a REFUSED resume never reaches it: the SDK throws instead of opening an
   * agent, so no dead id is ever written back over a good one.
   */
  onSession?: HarnessSessionHook;
  /**
   * The SDK's agent options, forwarded verbatim to `Agent.create` /
   * `Agent.resume` (model, api key, mode, tools, MCP servers, the rest of
   * `local` besides `cwd`).
   *
   * `model` here is also the cost-estimate fallback — used when the run's own
   * `system` message does not name the model that ran. Cursor's SDK refuses to
   * create a local agent without one, so this is not optional in practice.
   *
   * An `agentId`, a `cloud` bag, or a `local.cwd` in this group is refused when
   * the block is built: each has exactly one owner (`resume`, "this version is
   * local-only", and `cwd`).
   */
  agent?: CursorCreateOptions;
  /**
   * The SDK's send options, forwarded verbatim to `agent.send`. A `cloud` bag
   * here is refused for the same reason it is refused on {@link agent}.
   */
  send?: CursorSendOptions;
  /** Host hook resolving the Cursor client. Default: lazy SDK import. */
  resolveCursorClient?: ResolveCursorClient;
  /** Capabilities forwarded to the underlying handler. */
  uses?: UsesSlot;
  /** Block name. Default `"cursor-agent"`. */
  name?: string;
}

/**
 * The version gate's test seam, keyed by a symbol this module does not export
 * from the package root.
 *
 * It is deliberately not a field on {@link CursorAgentOptions}. A host able to
 * substitute its own version reader could answer with the tested version and run
 * an unvalidated wire — which would make the exact-version refusal, one of the
 * three things this package promises, a claim rather than a guarantee. The specs
 * import this symbol from the module directly; a consumer of the package cannot
 * name it, so the only reachable behaviour is the real gate.
 */
export const INTERNAL_SDK_VERSION_READER = Symbol("cursor.internal.readInstalledSdkVersion");

/** The shape the specs pass through the symbol above. */
interface InternalTestSeams {
  [INTERNAL_SDK_VERSION_READER]?: InstalledSdkVersionReader;
}

/**
 * Facts accumulated while the stream is being read. `wait()` later overwrites
 * whatever it is authoritative for; these are the fallbacks for a run whose
 * `wait` is unsupported or whose result carries no usage / model of its own.
 */
interface MirrorFacts {
  usage: CursorRunUsage | null;
  model: string | undefined;
}

/** What {@link settleRun} learned from the SDK's terminal record. */
interface SettledRun {
  outcome: HarnessRunOutcome | null;
  usage: CursorRunUsage | null;
  model: string | undefined;
  failureMessage: string | null;
  resultText: string | null;
}

/**
 * Refuse a forwarded option group carrying something the block owns.
 *
 * A runtime check rather than a type-level one because the types this package
 * declares for the two groups already omit these keys — so the only way one
 * arrives is a caller spreading an untyped bag, which is exactly the case a
 * type cannot catch and the case that matters (BP-031).
 *
 * `agent.local.cwd` is nested. Checking the group as a flat bag would miss it,
 * and a host that put the directory there expecting it to be forwarded would
 * silently lose to the resolver — the worse of the two bugs, because the run
 * would work in a different directory than the one they named.
 */
function assertNoOwnedKeys(agent: CursorCreateOptions | undefined, send: CursorSendOptions | undefined): void {
  if (agent !== undefined) {
    const bag = agent as Record<string, unknown>;
    if ("agentId" in bag) {
      throw new CursorAgentConfigError(
        "cursorAgent: `agent.agentId` is not forwarded — the `resume` resolver owns which conversation a run continues. Remove it from `agent`.",
      );
    }
    if ("cloud" in bag) {
      throw new CursorAgentConfigError(
        "cursorAgent: `agent.cloud` is not forwarded — this version drives Cursor's local runtime only. Remove it from `agent`.",
      );
    }
    const local = bag.local as Record<string, unknown> | undefined;
    if (local !== undefined && "cwd" in local) {
      throw new CursorAgentConfigError(
        "cursorAgent: `agent.local.cwd` is not forwarded — the `cwd` resolver owns where a run works. Remove it from `agent.local`.",
      );
    }
  }
  if (send !== undefined && "cloud" in (send as Record<string, unknown>)) {
    throw new CursorAgentConfigError(
      "cursorAgent: `send.cloud` is not forwarded — this version drives Cursor's local runtime only. Remove it from `send`.",
    );
  }
}

/**
 * Build the Cursor harness block.
 *
 * Refuses to build against an installed `@cursor/sdk` that is not the tested
 * version, and against an option group carrying an agent id, a cloud bag, or a
 * working directory. Both are configuration errors a host sees at wiring time.
 */
export function cursorAgent(options: CursorAgentOptions = {}) {
  const {
    cwd: resolveCwd,
    resume: resolveResume,
    onSession,
    agent: agentOptions,
    send: sendOptions,
    resolveCursorClient = createDefaultResolveCursorClient(),
    uses,
    name = "cursor-agent",
  } = options;

  assertTestedSdkVersion(
    (options as InternalTestSeams)[INTERNAL_SDK_VERSION_READER] ?? readInstalledCursorSdkVersion,
  );
  assertNoOwnedKeys(agentOptions, sendOptions);

  return handler({
    name,
    description:
      "Run Cursor's coding agent through the Cursor SDK, mirroring its streamed items into FSD items.",
    // The contract's own schema, not a local copy: a hand-rolled duplicate
    // would sit in the type-level conformance assertion's blind spot
    // (parameter bivariance accepts extra required input fields) and stay
    // silent if the contract's input ever grew.
    inputSchema: harnessRunInputSchema,
    outputSchema: cursorAgentHandleSchema,
    ...(uses !== undefined ? { uses } : {}),
    execute: async (input, ctx: AgentCallbackContext): Promise<CursorAgentHandle> => {
      const prompt = input.prompt?.trim();
      if (!prompt) {
        throw new CursorAgentRunError("cursorAgent requires a non-empty prompt.");
      }
      // A deadline that has already fired must not start a runtime it will
      // immediately have to kill.
      if (ctx.signal?.aborted) throw new CursorAgentAbortedError(null);

      const emitState = createEmitState();
      const dispatchedAt = Date.now();
      let agent: CursorAgentLike | null = null;
      let sessionId: string | null = null;

      try {
        agent = await openAgent({
          ctx,
          resolveCwd,
          resolveResume,
          onSession,
          agentOptions,
          resolveCursorClient,
        });
        sessionId = agent.agentId;
        // An already-fired deadline must not start a run it will immediately
        // have to cancel — the resolvers, the client, create/resume and
        // `onSession` all await before this, and a signal that is already
        // aborted never fires `abort` again.
        if (ctx.signal?.aborted) throw new CursorAgentAbortedError(agent.agentId);
        const run = await agent.send(prompt, sendOptions);
        const mirrored = await mirrorRun(run, ctx, emitState, name);
        const settled = await settleRun(run, mirrored, ctx.signal);
        // A call still `running` when the stream closed has no result coming,
        // and an `error` or `cancelled` wait is an OUTCOME this block returns
        // rather than a throw — so the `catch` below never sees it. Left open,
        // the tool item would read in_progress under a handle that says the
        // run is over.
        await finalizeOpenItems(ctx, emitState, name);
        return buildHandle({
          sessionId,
          dispatchedAt,
          settled,
          finalMessage: emitState.finalMessage,
          configuredModel: agentOptions?.model?.id,
          name,
          ctx,
        });
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
      } finally {
        closeQuietly(agent);
      }
    },
  });
}

/**
 * Open (or resume) the agent, fire {@link CursorAgentOptions.onSession}, and
 * hand the live agent back. The prompt is not sent here — the hook must run
 * first, or a cancelled send would leave the host with nothing to resume.
 *
 * Both resolvers run once, before anything is created, so the directory the
 * SDK is handed and the agent it continues cannot be two different answers
 * from one resolver.
 *
 * Neither is handed the run's input, and that is the contract's guarantee
 * rather than an omission here: the prompt is the one thing a model controls,
 * so a directory or a session id derived from it is a decision made from
 * caller-controllable input (BP-031). The resolver signature takes the
 * context alone, which makes that unavailable rather than merely discouraged.
 */
async function openAgent(args: {
  ctx: AgentCallbackContext;
  resolveCwd: HarnessResolver<string> | undefined;
  resolveResume: HarnessResolver<string | null | undefined> | undefined;
  onSession: HarnessSessionHook | undefined;
  agentOptions: CursorCreateOptions | undefined;
  resolveCursorClient: ResolveCursorClient;
}): Promise<CursorAgentLike> {
  const workingDirectory = args.resolveCwd === undefined ? undefined : await args.resolveCwd(args.ctx);
  const resumeIdRaw = args.resolveResume === undefined ? null : await args.resolveResume(args.ctx);
  // `""` is treated as `null`: a host reading an unset field out of its own
  // state should get a fresh agent, not a resume of the empty id.
  const resumeId = resumeIdRaw === undefined || resumeIdRaw === "" ? null : resumeIdRaw;

  const client = await args.resolveCursorClient(args.ctx);
  const createOptions = mergeCreateOptions(args.agentOptions, workingDirectory);
  const agent =
    resumeId === null
      ? await client.create(createOptions)
      : await client.resume(resumeId, createOptions);

  try {
    await args.onSession?.(agent.agentId, args.ctx);
  } catch (err) {
    // The hook is the host's. A throw must not leak the runtime it just opened
    // — the outer `finally` will close again, and `closeQuietly` is idempotent
    // enough for that, but closing here means a hook that throws during a
    // long-lived host does not wait for the rest of `execute` to unwind.
    closeQuietly(agent);
    throw err;
  }
  args.ctx.emit.status(`Cursor agent ${agent.agentId}.`);
  return agent;
}

/**
 * The SDK's create/resume options, with the resolved directory folded into
 * `local.cwd` and nothing else invented.
 *
 * Spreading `agentOptions` first and then replacing `local` is what keeps a
 * host's `local.dirs` (and the rest of that bag) intact while still giving
 * `cwd` exactly one owner.
 */
function mergeCreateOptions(
  agentOptions: CursorCreateOptions | undefined,
  workingDirectory: string | undefined,
): CursorCreateOptions & { local?: { cwd?: string } } {
  const local = {
    ...(agentOptions?.local ?? {}),
    ...(workingDirectory !== undefined ? { cwd: workingDirectory } : {}),
  };
  const hasLocal = workingDirectory !== undefined || agentOptions?.local !== undefined;
  return {
    ...(agentOptions ?? {}),
    ...(hasLocal ? { local } : {}),
  };
}

/**
 * Drain `run.stream()`, racing each `next()` against the block's own signal.
 *
 * The SDK is still told about cancel via {@link cancelQuietly} when the race
 * loses or the stream throws — that is what stops the local runtime — even
 * though the block does not rely on the SDK's rejection to stop waiting. Both
 * halves are needed: racing without cancelling leaves the runtime running
 * after the block has walked away, and cancelling without racing leaves the
 * block hanging on a stream the deadline already gave up on.
 *
 * Usage and the model id are collected here as facts about the RUN, not as
 * emissions. `emitTranslatedEvent` no-ops those two kinds; the handle reads
 * them off the same translated event.
 */
async function mirrorRun(
  run: CursorRunLike,
  ctx: AgentCallbackContext,
  emitState: ReturnType<typeof createEmitState>,
  blockName: string,
): Promise<MirrorFacts> {
  const stream = run.stream();
  const iterator = stream[Symbol.asyncIterator]();
  const deadline = abortRace(ctx.signal);
  let usage: CursorRunUsage | null = null;
  let model: string | undefined;
  try {
    for (;;) {
      const pending = iterator.next();
      // The losing side of a race still settles, and nothing is awaiting it
      // any more. When the deadline wins, the runtime is cancelled moments
      // later and this rejects — unhandled, which can take a host's process
      // down over a cancel that worked. Claiming the rejection here does not
      // hide it from the `await` below: a promise may have any number of
      // reactions, and the one that matters still sees it.
      pending.catch(() => {});
      const next = await Promise.race([pending, deadline.promise]);
      if (next.done === true) break;
      for (const event of translateCursorMessage(next.value)) {
        if (event.kind === "run_usage") {
          usage = addUsage(usage, event.usage);
        } else if (event.kind === "model") {
          model = event.model;
        }
        await emitTranslatedEvent(event, ctx, emitState, blockName);
      }
    }
    return { usage, model };
  } catch (err) {
    await cancelQuietly(run);
    throw err;
  } finally {
    deadline.dispose();
    // Tell the stream nobody is reading it any more. On the normal path the
    // generator is already done and this is a no-op; on the abort and throw
    // paths it is what lets the SDK release the reader instead of holding it
    // for a consumer that has gone.
    void iterator.return?.().catch(() => {});
  }
}

/**
 * Read the run's outcome from `run.wait()` — the sole authority.
 *
 * A stream `status` of `FINISHED` was already mirrored as a note and must not
 * decide this. `wait` is what the SDK documents as the terminal record, and it
 * arrives once. A second source here would let a stream that ends early
 * disagree with the SDK about how the run finished.
 *
 * `supports("wait") === false` is the scripted-double escape and the one
 * honest answer when the SDK cannot settle: `outcome` stays `null` — "we do
 * not know how it ended" — rather than `failed`. A manager settles runs on
 * that difference (LAB-152's contract). Absent `supports` means every
 * operation is assumed supported, which is what a scripted double that does
 * implement `wait` wants.
 *
 * `wait()`'s usage is cumulative and therefore replaces the stream-summed
 * figure when present; its model id is the one the run actually used, so it
 * wins over the init-message id the stream already named.
 *
 * Raced against the block's own signal for the same reason the stream is: the
 * race {@link mirrorRun} armed is disposed once the stream closes, and `wait()`
 * is a second vendor await the deadline has to bound. A terminal lookup that
 * hangs past the caller's deadline would otherwise hold the block, and its
 * cleanup, for as long as the SDK liked.
 */
async function settleRun(
  run: CursorRunLike,
  mirrored: MirrorFacts,
  signal: AbortSignal | undefined,
): Promise<SettledRun> {
  if (run.supports?.("wait") === false) {
    return {
      outcome: null,
      usage: mirrored.usage,
      model: mirrored.model,
      failureMessage: null,
      resultText: null,
    };
  }

  const deadline = abortRace(signal);
  const pending = run.wait();
  // Same as the stream race: the losing side still settles once the runtime
  // is cancelled, and nothing is awaiting it then.
  pending.catch(() => {});
  let result: CursorRunResult;
  try {
    result = await Promise.race([pending, deadline.promise]);
  } catch (err) {
    await cancelQuietly(run);
    throw err;
  } finally {
    deadline.dispose();
  }
  const status = typeof result.status === "string" ? result.status.trim().toLowerCase() : "unknown";
  const outcome: HarnessRunOutcome = status === "finished" ? "finished" : "failed";
  const waitUsage = result.usage === undefined ? null : normalizeUsage(result.usage);
  const waitModel = typeof result.model?.id === "string" && result.model.id !== "" ? result.model.id : undefined;
  const failureMessage =
    outcome === "failed" ? (typeof result.error?.message === "string" ? result.error.message : null) : null;

  return {
    outcome,
    usage: waitUsage ?? mirrored.usage,
    model: waitModel ?? mirrored.model,
    failureMessage,
    resultText: typeof result.result === "string" && result.result !== "" ? result.result : null,
  };
}

/**
 * Assemble the handle. `outcome` is the fact; `status` follows it. A run that
 * produced no terminal wait result did not complete, so it reads `errored`
 * with `outcome: null` — "we do not know how it ended", not "it failed".
 *
 * `sessionId` is the agent id. That is the thing `resume` takes: a Cursor
 * agent is the durable conversation, and each `send` is one run inside it.
 *
 * Cost is priced against the model the run actually used, falling back to the
 * one configured on `agent.model`. Cursor's own ids are mostly unpriced in
 * core's table today, so most runs report `null` — see the README.
 */
function buildHandle(args: {
  sessionId: string | null;
  dispatchedAt: number;
  settled: SettledRun;
  finalMessage: string | null;
  configuredModel: string | undefined;
  name: string;
  ctx: AgentCallbackContext;
}): CursorAgentHandle {
  const { settled } = args;
  const model = settled.model ?? args.configuredModel;
  const handle: CursorAgentHandle = {
    source: CURSOR_SOURCE,
    status: settled.outcome === "finished" ? "completed" : "errored",
    sessionId: args.sessionId,
    url: null,
    dispatchedAt: args.dispatchedAt,
    outcome: settled.outcome,
    finalMessage: args.finalMessage ?? settled.resultText,
    usage:
      settled.usage === null
        ? null
        : { inputTokens: settled.usage.inputTokens, outputTokens: settled.usage.outputTokens },
    cost: estimateCursorCost(settled.usage, model),
    cursorUsage: settled.usage,
    failureMessage: settled.failureMessage,
  };

  args.ctx.emit.status(
    settled.outcome === "finished"
      ? "Cursor run completed."
      : `Cursor run errored (${settled.failureMessage ?? "no terminal wait result"}).`,
    { transient: false },
  );

  return handle;
}

/**
 * The error a failed run should throw, given whatever the stream threw.
 *
 * Re-wrapping everything loses two things that matter. A caller branches on the
 * error CLASS — an abort is a deadline the caller set, a missing SDK is a
 * configuration mistake, and neither is "the run failed" — and `(err as Error)
 * .message` on a value that is not an `Error` is `undefined`, so a string throw
 * from the vendor produced the message "Cursor run failed: undefined" at exactly
 * the moment an operator needed it to say something.
 *
 * So: our own classes pass through, and a foreign throw is wrapped with its
 * original kept on the native `cause` chain rather than flattened to a string.
 */
function toRunFailure(err: unknown, sessionId: string | null): CursorAgentError {
  // Re-minted rather than passed through: the abort raised inside the race
  // knows no agent id, and the id is the whole point of the error — it is what
  // lets a manager resume the run its own deadline killed.
  if (err instanceof CursorAgentAbortedError) return new CursorAgentAbortedError(sessionId);
  // Already ours. Wrapping again buries the class under a second
  // "Cursor run failed:" prefix and tells a caller nothing new.
  if (err instanceof CursorSdkNotInstalledError) return err;
  if (err instanceof CursorAgentRunError) return err;
  const reason = err instanceof Error ? err.message : String(err);
  return new CursorAgentRunError(`Cursor run failed: ${reason}`, { cause: reason }, err);
}

/** Any of this package's errors that a failed run can end as. */
type CursorAgentError = CursorAgentAbortedError | CursorAgentRunError | CursorSdkNotInstalledError;

/**
 * Release the local runtime. A close that throws must not hide the run's own
 * outcome, and a missing `close` is a scripted double that has nothing to
 * release — both are quiet.
 */
function closeQuietly(agent: CursorAgentLike | null): void {
  if (agent === null) return;
  try {
    agent.close?.();
  } catch {
    // Swallow: the run's throw or handle is the thing the caller asked for.
  }
}

/**
 * Best-effort cancel so a deadline or a thrown stream does not leave the
 * local runtime running after the block has walked away.
 */
async function cancelQuietly(run: CursorRunLike): Promise<void> {
  try {
    await run.cancel();
  } catch {
    // Same: cancel is in service of the throw, not a second outcome.
  }
}

/**
 * A promise that rejects with {@link CursorAgentAbortedError} the moment
 * `signal` fires, and a `dispose` that removes the listener.
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
  // the two resolvers, the SDK import, create/resume, `onSession` and `send`
  // all await before this is armed, and a deadline landing anywhere in there
  // would leave the block waiting on the vendor's stream — the exact hang the
  // race exists to prevent, arrived at by the one path the race did not cover.
  if (signal.aborted) {
    const rejected = Promise.reject(new CursorAgentAbortedError(null));
    rejected.catch(() => {});
    return { promise: rejected, dispose: () => {} };
  }
  let onAbort: () => void = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new CursorAgentAbortedError(null));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  // Claimed here so the loser of the race is never an unhandled rejection. The
  // real handling is at the `await`, which sees the same rejection.
  promise.catch(() => {});
  return { promise, dispose: () => signal.removeEventListener("abort", onAbort) };
}
