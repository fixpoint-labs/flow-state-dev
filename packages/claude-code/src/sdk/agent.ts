/**
 * `claudeCodeAgent` — handler block running the Claude Code Agent SDK in-process.
 *
 * This is the FIX-671 "Level 2 agent adapter": the SDK owns its own agentic
 * loop and built-in tools; FSD observes, translates, and persists. The block
 * resumes a prior SDK session (via the session provider + persisted
 * `sdkSessionId`), runs `query()` to completion, pipes each streamed message
 * through `translate` → `emit` to produce canonical FSD items, records the new
 * session id, appends the run handle to session state, and returns the handle.
 *
 * HITL degrades to the SDK's own `permissionMode` / `canUseTool`; an optional
 * `onToolApproval` seam adapts onto `canUseTool` and notes its decision via a
 * status item. Sub-agents surface as container items (see `emit.ts`).
 *
 * `detached: true` turns the conversation-state half off — see the option.
 */
import { realpathSync } from "node:fs";
import { handler } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { z } from "zod";
import {
  closeStreamingItems,
  createEmitState,
  emitTranslatedEvent,
  finalizeOpenItems,
} from "./emit";
import {
  createTranslateState,
  drainUnsettledObservations,
  translateSdkMessage,
} from "./translate";
import {
  createWorkRecorder,
  type UpsertableCollection,
  type WorkRecorder,
} from "./work-recorder";
import {
  OBSERVED_FILE_OPS,
  OBSERVED_GAPS,
  OBSERVED_PLAN,
  workRecorderResources,
} from "./work-collections";
import { defaultResolveClaudeAgent } from "./sdk-client";
import {
  createClaudeAgentSessionProvider,
  type ClaudeAgentSession,
} from "./session";
import { ClaudeAgentRunError } from "./errors";
import {
  sdkAgentHandleSchema,
  type ClaudeAgentQueryOptions,
  type ResolveClaudeAgent,
  type SdkAgentHandle,
  type SdkCanUseTool,
  type SdkResultSubtype,
  type ToolApprovalDecision,
  type ToolApprovalRequest,
} from "./types";
import type { BindingProvider } from "@flow-state-dev/core/types";

/** Session-state key holding the SDK session id to resume across requests. */
export const SDK_SESSION_ID_KEY = "sdkSessionId" as const;
/** Session-state key under which run handles accumulate. */
export const SDK_AGENT_RUNS_KEY = "sdkAgentRuns" as const;

/** Session-state schema the agent block declares, reads, and appends to. */
export const claudeAgentSessionStateSchema = z.object({
  [SDK_SESSION_ID_KEY]: z.string().nullable().default(null),
  [SDK_AGENT_RUNS_KEY]: z.array(sdkAgentHandleSchema).default([]),
});

const inputSchema = z.object({
  /** The instruction prompt to run through the agent loop. */
  prompt: z.string(),
});

/** Options for {@link claudeCodeAgent}. */
export interface ClaudeCodeAgentOptions {
  /** Host hook resolving the SDK `query`. Default: lazy SDK import. */
  resolveClaudeAgent?: ResolveClaudeAgent;
  /** Session-continuity provider. Default: resume-by-id provider. */
  sessionProvider?: BindingProvider<ClaudeAgentSession>;
  /** Derive the prompt from input/ctx. Default: `input.prompt`. */
  prompt?: (input: { prompt: string }, ctx: BlockContext) => string;
  /** Model id forwarded to the SDK. */
  model?: string;
  /** System prompt forwarded to the SDK. */
  systemPrompt?: string;
  /** Allowed tool names forwarded to the SDK. */
  allowedTools?: string[];
  /** Disallowed tool names forwarded to the SDK. */
  disallowedTools?: string[];
  /** Permission mode forwarded to the SDK (HITL default behavior). */
  permissionMode?: string;
  /** Sub-agent definitions forwarded to the SDK `agents` option. */
  agents?: unknown;
  /** Max turns forwarded to the SDK. */
  maxTurns?: number;
  /** Whether to request partial-message deltas. Default: true. */
  includePartialMessages?: boolean;
  /**
   * Optional approval seam. When set, it is adapted onto the SDK `canUseTool`
   * callback: each tool call routes through it, and the decision is noted via a
   * status item. When unset, HITL degrades to the SDK's own `permissionMode`.
   */
  onToolApproval?: (
    req: ToolApprovalRequest,
    ctx: BlockContext,
  ) => ToolApprovalDecision | Promise<ToolApprovalDecision>;
  /**
   * Run the agent as **detached background work** — a task board worker
   * dispatched into a Workstream. Default `false`: an in-session agent that
   * keeps conversation state — the `sdkSessionId` resume handle and the
   * `sdkAgentRuns` log — which is the behaviour every existing caller has.
   *
   * **This is the canonical explanation; everywhere else links here.**
   *
   * The board refuses a detached worker whose block authors a
   * `sessionStateSchema`, because every detached worker in a flow becomes a
   * route on one shared Workstream flow, where two routes choosing the same key
   * with different shapes corrupt each other silently.
   *
   * A background job is one run in one workstream, so nothing on that path
   * reads the resume handle back and the run log's job belongs to the
   * workstream's own item stream. `true` therefore suppresses three things
   * together, and they are one decision rather than three: the **declaration**,
   * the **reads and writes** that go with it (a value written under an
   * undeclared key is not a smaller version of the same behaviour), and the
   * SDK **`resume`** — the session provider is not consulted at all, so a
   * custom provider cannot hand back a saved id that silently resumes a prior
   * conversation.
   *
   * Everything else is identical: the items the run emits, the handle it
   * returns, and how failures surface. The one deliberate consequence is that a
   * second task addressed to the same workstream starts the agent fresh, while
   * the workstream's own item history continues as normal.
   */
  detached?: boolean;
  /**
   * Record what the run DID, alongside the items that record what it said.
   * Default `false`, which is byte-identical to the behaviour every existing
   * caller has: nothing recorded, no resources declared.
   *
   * **This is the canonical explanation; everywhere else links here.**
   *
   * Set `true` and the block declares three session-scoped resource collections
   * and writes into them as the run goes:
   *
   * - `observed-file-ops` — one entry per path the run's file-writing and
   *   file-editing tools touched: how, when, and how the attempt settled. Not
   *   the contents.
   * - `observed-plan` — one entry per item on the run's own to-do list,
   *   carrying its wording and its current and previous status. Deliberately
   *   NOT the work queue that dispatched the run, so a run that decides to do
   *   five more things cannot start five more jobs by writing a to-do list.
   * - `observed-gaps` — one entry per mutation the recorder recognised and
   *   could not record, so a missing row is never confused with a mutation that
   *   never happened.
   *
   * All three are readable over the resource route that already ships, keyed
   * under the run's own request id so a workstream reused across runs answers
   * "what did this run do" rather than "what has this workstream ever done".
   *
   * **What the file record is, precisely.** It is a log of the file operations
   * the run's file TOOLS performed, not an index of everything that changed on
   * disk. A run that edits a file through the shell — a `sed -i`, a redirect, a
   * `mv`, a formatter — performs no file-tool call, so nothing is recorded and
   * the file does not appear.
   *
   * Recording never fails the run: anything the recorder cannot handle is
   * skipped, written to `observed-gaps`, and noted as a status item. The gap
   * ROW is the durable half — a status note dedupes on its own message and
   * renders into a latest-wins slot, so two identical skips collapse to one.
   */
  recordWork?: boolean;
  /**
   * The directory this run works in. Default: unset, which is the directory the
   * server process itself is running in — byte for byte what every existing
   * caller has today (BP-030).
   *
   * **This is the canonical explanation; everywhere else links here.**
   *
   * Set it and the run's file tools address paths inside that directory, and
   * `recordWork`'s index of what the run touched is keyed there too. Those are
   * **two halves of one thing, and doing only the first is the trap**: forward
   * the directory to the SDK without threading it into the record and the index
   * describes a checkout the run never touched — nothing throws, nothing is
   * empty, the rows are simply keyed somewhere else. See
   * `canonicalFilePathKey`, which is where the second half lands.
   *
   * **A resolver, not a constant**, because one flow build serves many runs:
   * the same shape {@link ClaudeCodeAgentOptions.prompt} already has. It is
   * called once per invocation, before `query`.
   *
   * ```ts
   * import { mkdtemp } from "node:fs/promises";
   * import { join } from "node:path";
   *
   * const CHECKOUT_ROOT = "/var/agent-checkouts";
   *
   * claudeCodeAgent({
   *   // A fresh directory per run, created by the server. No caller input
   *   // reaches the path.
   *   cwd: () => mkdtemp(join(CHECKOUT_ROOT, "run-")),
   * })
   * ```
   *
   * **Reusing a directory across runs is the harder case**, and it is where the
   * sharp edges are. Deriving the path from something stable means deriving it
   * from a value, and the rule is **encode, never validate**:
   *
   * ```ts
   * import { isAbsolute, join, relative } from "node:path";
   *
   * function segment(value: string | undefined): string {
   *   return value === undefined
   *     ? "0"
   *     : `1${Buffer.from(value, "utf8").toString("hex")}`;
   * }
   *
   * function checkoutFor(tenantId: string | undefined, key: string): string {
   *   const dir = join(CHECKOUT_ROOT, segment(tenantId), segment(key));
   *   const rel = relative(CHECKOUT_ROOT, dir);
   *   if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) {
   *     throw new Error(`refusing a checkout outside ${CHECKOUT_ROOT}`);
   *   }
   *   return dir;
   * }
   * ```
   *
   * - **Encode each part rather than validating it.** A validating grammar has
   *   to enumerate every way a string can misbehave as a path — separators and
   *   `..` are the obvious two, but Windows also strips trailing dots (so
   *   `acme` and `acme.` are one directory), reserves `CON`, `PRN`, `AUX`,
   *   `NUL`, `COM1`…`LPT9` as device names that cannot be directories at all,
   *   and folds case — and that list is never finished. Hex is **injective**,
   *   so two distinct ids can never share a checkout, and its output alphabet
   *   contains nothing any filesystem treats specially. Rejecting beats
   *   stripping, but encoding beats both.
   * - **Tag presence; never substitute a stand-in value.** `segment(undefined)`
   *   is `0` and every present value encodes to `1…`, so an un-tenanted host
   *   and a tenant whose id is literally `"default"` stay different
   *   directories. A `?? "default"` fallback merges them, and the two then
   *   share a working tree. The tag also keeps every segment non-empty: hex of
   *   `""` is `""`, which `join` silently discards, shortening the path by a
   *   level and collapsing distinct tuples onto one directory.
   * - **Include the tenant when there is one**, in its own segment. Two tenants
   *   can hold the same session id — the framework namespaces its own session
   *   storage by tenant for exactly that reason, and deliberately leaves
   *   `ctx.session.identity.id` bare. The authenticated tenant is on
   *   `ctx.session.identity.tenantId`. Never concatenate the two into one
   *   segment; that brings back the ambiguity the tenant is there to remove.
   * - **Confirm the result is inside the root** with `path.relative`, not a
   *   string prefix — `join` uses the platform separator, so a literal `"/"`
   *   comparison rejects every valid value on Windows.
   *
   * Prefer a key the server assigned over one that arrived with the request —
   * session and request ids both reach the server from the caller, so the
   * encoding is what makes an untrusted one safe to build a path from
   * (BP-031). The package README carries the worked version.
   *
   * The resolver may be async, for a directory that has to be looked up or
   * provisioned first.
   *
   * **An option, never a field on the block's input** — a correctness
   * constraint rather than a style preference. The same block is exposed as a
   * model-facing tool through the agent capability, so a working directory
   * reachable from the input is one the model can choose (BP-031). The block's
   * input stays the prompt.
   *
   * It is a working directory, not a boundary: the run can still address paths
   * outside it, and the file record is a log of what its tools did rather than
   * a fence around where they may go.
   */
  cwd?: (
    input: { prompt: string },
    ctx: BlockContext,
  ) => string | Promise<string>;
  /** Block name. Default `"claude-code-agent"`. */
  name?: string;
}

/**
 * A terminal subtype counts as an errored outcome unless it is exactly
 * `"success"`. `null` here means the SDK reported a subtype this version does
 * not recognize (`normalizeSubtype` only nulls unknown values — `"success"` is
 * always recognized), so it is a failure, not a silent success.
 */
function isErroredSubtype(subtype: SdkResultSubtype | null): boolean {
  return subtype !== "success";
}

/**
 * Reduce a resolver's answer to the ONE value both halves use, or `undefined`.
 *
 * Two normalizations, and each closes a way the two halves could disagree while
 * both looked correct.
 *
 * **Empty string means unset.** `""` is not nullish, so it survives the SDK's
 * own `cwd ?? default` and reaches the child-process spawner — where Node
 * silently falls back to the process directory rather than failing. The
 * recorder already read `""` as unset, so on that path the two agree by a
 * coincidence of two different fallbacks rather than by construction, and
 * anything consuming `cwd` without spawning (a session key, a project root) has
 * no such coincidence to lean on. Collapsing it here makes the agreement
 * structural.
 *
 * **Symlinks resolve to the physical path.** `path.resolve` is purely lexical,
 * so the recorder would key `/link/src/a.ts` while the spawned SDK process —
 * whose `process.cwd()` is the physical directory — reports `/real/src/a.ts`.
 * The recorder's divergence check compares the two, sees a mismatch, and writes
 * a gap instead of settling the row, leaving an ordinary write permanently
 * `pending`. Measured against a real symlinked directory, not assumed.
 *
 * A path that cannot be resolved is handed back as written: the invariant still
 * holds (both halves see one value), and an unusable directory is left to fail
 * where it should, in the SDK.
 */
export function normalizeWorkingDirectory(
  cwd: string | undefined,
): string | undefined {
  if (cwd === undefined || cwd === "") return undefined;
  try {
    return realpathSync(cwd);
  } catch {
    return cwd;
  }
}

/**
 * Create an {@link AbortController} that mirrors the block's `ctx.signal`, so an
 * aborted request stops the in-process SDK run. Tolerates an absent signal
 * (returns a live, un-aborted controller). Forwards an already-aborted signal
 * synchronously, and a later abort via a one-shot listener.
 */
export function forwardSignalToController(
  signal: AbortSignal | undefined,
): AbortController {
  const controller = new AbortController();
  if (signal?.aborted) {
    controller.abort();
  } else {
    signal?.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller;
}

/**
 * Open a {@link WorkRecorder} against the three collections the block declared,
 * or return `null` with a status note when the two records are not on the
 * context.
 *
 * The absent case is real rather than defensive: the declaration and the run
 * are wired at different layers, and a flow that reaches this block without the
 * refs registered would otherwise throw here — killing a coding run over
 * bookkeeping, which is the one thing this feature must never do. A note makes
 * the gap visible; the run continues unrecorded.
 *
 * `observed-gaps` is the one that may be absent without stopping recording: a
 * run whose file and plan records still land is worth having, and the skips
 * degrade to status notes alone. The two records are not optional that way —
 * without them there is nothing to record into.
 *
 * Every entry is keyed under {@link runNamespace}, which is what keeps a reused
 * workstream's runs apart.
 */
/**
 * Percent-escape the characters that stop a value being ONE resource-path
 * segment: `/`, `\`, control characters, and a segment of exactly `..` — the
 * four `normalizeResourcePath` rejects or splits on. The request id reaches
 * here straight from the caller (`sendOptions.requestId` rides the action
 * request body into `ctx.request.identity.id`), so all four are reachable
 * input, not hypotheticals.
 *
 * **The escaping is injective, and that is the point.** Stripping the offending
 * characters would satisfy the normalizer just as well and be a worse bug: two
 * distinct request ids would collapse onto ONE namespace and merge two runs'
 * rows under one key — trading a silent empty recorder for silent cross-run
 * mixing, which looks healthy.
 *
 * **What this costs:** injectivity requires escaping `%` first, so an id that
 * already contains one moves (`a%b` keys under `a%25b`). That is the whole
 * exception — every other already-valid id, `[`, `]`, `.` and `...` included,
 * is unchanged byte for byte, so existing rows keep their keys.
 *
 * One boundary, for whoever reads this next: injectivity holds among ids
 * encoded by THIS function, not across rows written before it existed. An id
 * that was literally `a%2Fb` keyed itself raw back then, and `a/b` encodes to
 * that same string now. Segregating the two would need a version segment,
 * which would orphan every row rather than the one shape at risk — so the
 * boundary is documented instead. It is safe to leave documented only while
 * no released version wrote these rows; check before assuming that still holds.
 */
function encodePathSegment(value: string): string {
  const escaped = value
    .replace(/%/g, "%25")
    .replace(/\//g, "%2F")
    .replace(/\\/g, "%5C")
    .replace(
      /[\x00-\x1f]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`,
    );
  // Dots survive the escaping above untouched, so `..` — the one segment the
  // normalizer rejects outright — is still reachable and needs its own branch.
  // Exactly `..`, not any run of dots: `.` and `...` are accepted keys today,
  // and widening this would move rows that are keyed fine. A literal `%2E%2E`
  // escapes to `%252E%252E` above, so it cannot collide with what this emits.
  return escaped === ".." ? "%2E%2E" : escaped;
}

/**
 * The key namespace for ONE run: `<requestId>/<invocation>`.
 *
 * **The request id alone is not the run's identity, and using it as one is a
 * silent data-merging bug.** A generator holding this agent as a tool can call
 * it several times inside a single request — the framework's own tool executor
 * disambiguates each call by `stepNumber:toolCallId` precisely because that
 * happens. Every such call is a separate coding run: its own files, its own
 * to-do ids (the harness numbers those per agent session, so two runs both
 * having a task `5` is ordinary), and its own gap ordinals, which restart at 1
 * per recorder and would therefore overwrite each other outright.
 *
 * `blockPath` is the framework's per-invocation identity — derived from the
 * block tree and the model step, so it is unique per call AND stable across a
 * replay, which a minted id would not be. Slashes are flattened so one
 * invocation stays one key segment.
 *
 * Two segments rather than one, deliberately: the request id stays the leading
 * segment, so `topicPrefix=<collection>/<requestId>/` still selects everything
 * one request did, while `<collection>/<requestId>/<invocation>/` narrows to a
 * single run. Replacing the request id outright would have made a row
 * impossible to correlate back to the request that caused it.
 *
 * Both parts are escaped into a single segment each — see
 * {@link encodePathSegment} for why that escaping must not be lossy.
 */
export function runNamespace(ctx: BlockContext): string {
  const identity = (
    ctx as { _blockIdentity?: { blockPath?: string; attempt?: number } }
  )._blockIdentity;
  const path = identity?.blockPath;
  // A context without a block identity (a direct `execute`, a mock) has exactly
  // one invocation by construction, so a constant is the honest discriminator.
  //
  // The path is escaped too, and for the same reason the request id is: its
  // user-controlled parts (a router branch name, a model-supplied tool name or
  // call id) are escaped on the way in by the blockInstanceId grammar's own
  // rules, which cover `%/[]:` — but not a backslash and not a control
  // character, both of which this grammar cares about.
  const step =
    typeof path === "string" && path.length > 0
      ? encodePathSegment(path.replace(/\//g, "."))
      : "0";
  // …and the ATTEMPT, because a retried block re-enters at the SAME path.
  // `executeBlock`'s retry loop increments an attempt counter and rebuilds the
  // instance id from `(request, path, attempt)` while leaving the path
  // untouched — so the framework's own invocation identity has three parts and
  // this had two. Two attempts of one retried run would otherwise share a
  // namespace: paths overwritten, and gap ordinals (which restart at 1 per
  // recorder) clobbering the earlier attempt's outright.
  const attempt = identity?.attempt ?? (ctx as { attempt?: number }).attempt ?? 0;
  return `${encodePathSegment(ctx.request.identity.id)}/${step}#${attempt}`;
}

function openWorkRecorder(ctx: BlockContext, cwd?: string): WorkRecorder | null {
  const resources = (ctx as { resources?: Record<string, unknown> }).resources;
  const upsertable = (accessor: string): UpsertableCollection | undefined => {
    const ref = resources?.[accessor] as UpsertableCollection | undefined;
    return typeof ref?.upsert === "function" ? ref : undefined;
  };
  const files = upsertable(OBSERVED_FILE_OPS);
  const plan = upsertable(OBSERVED_PLAN);
  const gaps = upsertable(OBSERVED_GAPS);
  if (files === undefined || plan === undefined) {
    ctx.emit.status(
      `Claude Code agent is not recording this run's work: the "${OBSERVED_FILE_OPS}" and ` +
        `"${OBSERVED_PLAN}" collections are not registered on this flow.`,
      { transient: false },
    );
    return null;
  }
  return createWorkRecorder({
    runId: runNamespace(ctx),
    files,
    plan,
    ...(gaps !== undefined ? { gaps } : {}),
    // The second half of the working directory. Absent when no resolver is
    // configured, which keys against this process's directory exactly as before.
    ...(cwd !== undefined ? { cwd } : {}),
    // Non-transient so the note survives into the request record. It is still
    // only a note: `emit.status` dedupes on the message and renders into a
    // latest-wins slot, so the durable record of a skip is the gap ROW.
    onSkipped: (message) => ctx.emit.status(message, { transient: false }),
  });
}

/**
 * Create the in-process Agent SDK handler block.
 *
 * On success it appends an {@link SdkAgentHandle} to
 * `ctx.session.state.sdkAgentRuns`, persists the new `sdkSessionId`, emits a
 * final status item, and returns the handle. An empty prompt throws before
 * `query` is called. A terminal SDK error subtype is an outcome (handle with
 * `status:"errored"` + an error item), not a throw; an SDK throw mid-stream is
 * wrapped in {@link ClaudeAgentRunError}, surfaced as an error item, and
 * rethrown.
 *
 * See {@link ClaudeCodeAgentOptions.detached} for the background-work mode.
 */
export function claudeCodeAgent(options: ClaudeCodeAgentOptions = {}) {
  const {
    resolveClaudeAgent = defaultResolveClaudeAgent,
    sessionProvider = createClaudeAgentSessionProvider(),
    prompt: pickPrompt,
    model,
    systemPrompt,
    allowedTools,
    disallowedTools,
    permissionMode,
    agents,
    maxTurns,
    includePartialMessages = true,
    onToolApproval,
    detached = false,
    recordWork = false,
    cwd: resolveCwd,
    name = "claude-code-agent",
  } = options;

  return handler({
    name,
    description:
      "Run the Claude Code Agent SDK in-process, translating its streamed messages into FSD items.",
    inputSchema,
    outputSchema: sdkAgentHandleSchema,
    // Decided HERE rather than at run time, and that is forced: the task board
    // inspects this static definition (`assertDetachedBoardSupported`) and
    // rejects the board before any `execute` callback receives a context.
    ...(detached ? {} : { sessionStateSchema: claudeAgentSessionStateSchema }),
    // Also static, and for a related reason: `defineFlow` collects declared
    // resources off block definitions at build time. A collection nobody
    // declared is not registered on the flow, so `findResourceConfig` misses and
    // the read route answers 404 — at read time, on a build that succeeded.
    ...(recordWork ? { resources: workRecorderResources } : {}),
    execute: async (input, ctx): Promise<SdkAgentHandle> => {
      const promptText = (
        pickPrompt ? pickPrompt(input, ctx) : input.prompt
      )?.trim();
      if (!promptText) {
        throw new ClaudeAgentRunError(
          "claudeCodeAgent requires a non-empty prompt.",
        );
      }

      // With conversation state off, the provider is NOT CONSULTED AT ALL —
      // not merely handed an empty key. Resolving anyway is the hole that
      // hides: a provider whose `resolve("")` returns a saved session would
      // become the SDK's `resume` below, so the run would resume a prior
      // conversation while every declared-schema assertion still passed. The
      // shipped default provider returns nothing for an empty key, which is
      // exactly why nothing would have caught it.
      //
      // Resolve, but intentionally do NOT release per run: the session must
      // survive across requests for resume-by-id to work, so its lifecycle is
      // the host's (cache TTL/eviction or session end), not this block's. The
      // default provider's `release` is a no-op for exactly this reason.
      let session: ClaudeAgentSession = { sdkSessionId: null };
      if (!detached) {
        const priorSessionId = (ctx.session.state as Record<string, unknown>)[
          SDK_SESSION_ID_KEY
        ];
        session = await sessionProvider.resolve(
          typeof priorSessionId === "string" ? priorSessionId : "",
        );
      }

      // Resolved ONCE per invocation, before the query and before the recorder
      // is opened, so the directory the SDK is handed and the directory the
      // record is keyed against cannot be two different answers from one
      // resolver (§7's invariant is about them staying the same value, not
      // merely about both being threaded).
      const workingDirectory = normalizeWorkingDirectory(
        resolveCwd === undefined ? undefined : await resolveCwd(input, ctx),
      );

      const resolved = await resolveClaudeAgent(ctx);
      const dispatchedAt = Date.now();
      const abortController = forwardSignalToController(ctx.signal);

      const queryOptions: ClaudeAgentQueryOptions = {
        model,
        systemPrompt,
        allowedTools,
        disallowedTools,
        permissionMode,
        agents,
        maxTurns,
        includePartialMessages,
        abortController,
        ...(workingDirectory !== undefined ? { cwd: workingDirectory } : {}),
        ...(session.sdkSessionId ? { resume: session.sdkSessionId } : {}),
        ...(onToolApproval
          ? { canUseTool: buildCanUseTool(onToolApproval, ctx) }
          : {}),
      };

      const translateState = createTranslateState({
        partialMessages: includePartialMessages,
        // Only this seam can hand the SDK an input other than the one the
        // `tool_use` block showed, so it is the only reason a call-time value
        // might not be what actually executed.
        inputsMayBeRevised: onToolApproval !== undefined,
      });
      const emitState = createEmitState();
      const recorder = recordWork ? openWorkRecorder(ctx, workingDirectory) : null;

      let resultSubtype: SdkResultSubtype | null = null;
      let finalMessage: string | null = null;
      let newSessionId: string | null = session.sdkSessionId;
      let usage: SdkAgentHandle["usage"] = null;
      let costUsd: number | null = null;

      // Recorder shutdown is STRUCTURAL, not per-path. It used to be written out
      // on the success path and again on the throw path, which made it one more
      // step that anything running before it could skip — and three separate
      // review findings were exactly that: a throwing report hook, an
      // unanswered plan create, and `finalizeOpenItems` rejecting while
      // persisting an incomplete item. Each was a different upstream step
      // preventing the same shutdown from running.
      //
      // One `finally` retires the whole class. It runs on the success path, the
      // SDK-throw path, an abort, and a throw from anything between the loop and
      // the return — and it cannot drift out of sync with a sibling copy,
      // because there isn't one.
      try {
        try {
          for await (const message of resolved.query({
            prompt: promptText,
            options: queryOptions,
          })) {
            // Capture the SDK session id from any message that carries it (the
            // `system` init message does, well before the terminal result), so an
            // aborted or failed run is still resumable.
            const sid = (message as { session_id?: string }).session_id;
            if (typeof sid === "string" && sid !== "") newSessionId = sid;

            const events = translateSdkMessage(message, translateState);
            // DELIVERY IS STRUCTURAL, like shutdown. Translation consumed this
            // whole message and cleared its correlation maps for every call in
            // it, so the events are now the only remaining record of what those
            // calls did. Interleaving delivery with the emission `await` below
            // made every event after the first one conditional on item
            // persistence succeeding: one rejection and the rest were lost with
            // nothing left to reconstruct them from — a settled `TaskCreate`
            // would vanish from `observed-plan` AND `observed-gaps`, because the
            // end-of-run drain finds no open create either.
            //
            // `observe` is synchronous and never throws, so handing it the whole
            // batch first closes the window rather than guarding it.
            for (const event of events) recorder?.observe(event);
            for (const event of events) {
              await emitTranslatedEvent(event, ctx, emitState, name);
              if (event.kind === "result") {
                resultSubtype = event.subtype;
                if (event.sessionId !== null) newSessionId = event.sessionId;
                if (event.finalMessage !== null)
                  finalMessage = event.finalMessage;
                if (event.usage !== null) usage = event.usage;
                if (event.costUsd !== null) costUsd = event.costUsd;
              }
            }
            // Partials path: the whole `assistant` message is the turn's close
            // boundary. translate skips its text/thinking (already streamed), so
            // close the open streaming items here before the next turn's deltas.
            if (includePartialMessages && message.type === "assistant") {
              await closeStreamingItems(ctx, emitState, name);
            }
          }
        } catch (err) {
          await finalizeOpenItems(ctx, emitState, name);
          // Persist the session id even on failure so the next request can resume
          // the conversation the SDK actually created.
          if (!detached && newSessionId !== null) {
            await ctx.session.patchState(
              SDK_SESSION_ID_KEY,
              () => newSessionId,
            );
          }
          const wrapped = new ClaudeAgentRunError(
            `Claude Code agent run failed: ${(err as Error).message}`,
            { cause: (err as Error).message },
          );
          await emitTranslatedEvent(
            { kind: "error", message: wrapped.message, code: wrapped.code },
            ctx,
            emitState,
            name,
          );
          throw wrapped;
        }

        await finalizeOpenItems(ctx, emitState, name);

        // Prefer the coalesced/whole assistant text the emitter tracked; fall
        // back to the SDK result's text.
        finalMessage = emitState.finalMessage ?? finalMessage;

        const errored = isErroredSubtype(resultSubtype);
        const handle: SdkAgentHandle = {
          source: "sdk",
          status: errored ? "errored" : "completed",
          sessionId: newSessionId,
          url: null,
          dispatchedAt,
          resultSubtype,
          finalMessage,
          toolsObserved: emitState.toolsObserved,
          usage,
          costUsd,
        };

        // Skipped wholesale when conversation state is off — a value written
        // under an undeclared key is a silent corruption. The handle is still
        // RETURNED; that is this block's output, not persisted state.
        if (!detached) {
          if (newSessionId !== null) {
            await ctx.session.patchState(
              SDK_SESSION_ID_KEY,
              () => newSessionId,
            );
          }
          await ctx.session.patchState(SDK_AGENT_RUNS_KEY, (prev) => [
            ...((prev as SdkAgentHandle[] | undefined) ?? []),
            handle,
          ]);
        }

        ctx.emit.status(
          errored
            ? `Claude Code agent run errored (${resultSubtype ?? "unknown subtype"}).`
            : "Claude Code agent run completed.",
          { transient: false },
        );

        return handle;
      } finally {
        // The last recording window, and anything still in flight. A clean run
        // can still end with a plan create unanswered (`error_max_turns` ends
        // the stream mid-exchange), so this is not a failure-path concern.
        //
        // Wrapped, because a throw HERE would replace the run's real outcome
        // with a bookkeeping error — the precise inversion this feature exists
        // to prevent, and the one place where "watching the work must never
        // break the work" would be violated by the code that enforces it.
        // Neither call is expected to throw; both are proved not to.
        try {
          for (const event of drainUnsettledObservations(translateState)) {
            recorder?.observe(event);
          }
          await recorder?.stop();
        } catch {
          // Deliberately empty: see above.
        }
      }
    },
  });
}

/**
 * Adapt an {@link ClaudeCodeAgentOptions.onToolApproval} seam onto the SDK's
 * `canUseTool` callback. The SDK invokes `canUseTool(toolName, input, extra)`
 * where `extra = { signal, suggestions }`; the `extra.signal` is forwarded to
 * the approval request so a host UI can cancel a pending prompt. Each decision
 * is recorded as a DURABLE, non-colliding status item (auditable: it replays on
 * history reload, and a per-decision sequence number defeats `ctx.emit.status`'s
 * same-string dedupe so repeated approvals of one tool aren't swallowed). A deny
 * continues the run (the SDK surfaces the denial to the model).
 */
function buildCanUseTool(
  onToolApproval: NonNullable<ClaudeCodeAgentOptions["onToolApproval"]>,
  ctx: BlockContext,
): SdkCanUseTool {
  let decisionSeq = 0;
  return async (toolName, toolInput, extra) => {
    const decision = await onToolApproval(
      { toolName, input: toolInput, signal: extra?.signal },
      ctx,
    );
    const seq = ++decisionSeq;
    if (decision.decision === "allow") {
      ctx.emit.status(`Approved tool: ${toolName} (#${seq}).`, {
        transient: false,
      });
      return {
        behavior: "allow",
        updatedInput: decision.updatedInput ?? toolInput,
      };
    }
    ctx.emit.status(`Denied tool: ${toolName} (#${seq}).`, {
      transient: false,
    });
    return {
      behavior: "deny",
      message: decision.message ?? `Tool ${toolName} was denied.`,
    };
  };
}
