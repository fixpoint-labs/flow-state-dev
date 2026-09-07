/**
 * Type contracts for `@flow-state-dev/cursor`.
 *
 * Three groups live here:
 *
 * - The **handle** this package returns — the framework's neutral
 *   {@link HarnessRunHandle} plus the two things only Cursor reports (its full
 *   token breakdown, and the message of a run that failed).
 * - A **local declaration of the SDK's wire** — the `SDKMessage` union
 *   `run.stream()` yields and the `RunResult` `run.wait()` resolves to.
 *   Declared here rather than imported so this package never type-depends on
 *   the optional peer, exactly as `codex/types.ts` does for the Codex SDK and
 *   `claude-code/sdk/types.ts` for the Agent SDK. The declarations mirror
 *   `@cursor/sdk` {@link TESTED_SDK_VERSION}; the version gate is what keeps
 *   them true (see `./cursor-client`).
 * - The **seam types** the block calls the SDK through, so a scripted client
 *   satisfies them in tests with no runtime and no network.
 *
 * Nothing Cursor-specific leaves this package: the manager reads the neutral
 * fields (tenet 4).
 */
import { z } from "zod";
import { harnessRunHandleSchema } from "@flow-state-dev/core";
import type { BlockContext, HarnessRunHandle } from "@flow-state-dev/core/types";

/**
 * This harness's `<package>/<door>` name — the convention every writer of a
 * harness handle's `source` owes (LAB-152). The suffix names the door we drive
 * Cursor through, and this package has exactly one: Cursor's own SDK, on its
 * local runtime.
 */
export const CURSOR_SOURCE = "cursor/sdk" as const;

/**
 * The one `@cursor/sdk` version this package has been tested against.
 *
 * The SDK ships its local runtime as a platform-specific native binary and
 * moves fast — a `SDKMessage` variant or a `Run` method can change between
 * patch releases — so a Cursor upgrade is a deliberate, tested bump of ours
 * rather than something a host can take on its own. `cursorAgent` refuses to
 * build against any other installed version, and the escape is a release of
 * this package; there is no override option.
 */
export const TESTED_SDK_VERSION = "1.0.31" as const;

/**
 * Cursor's full token breakdown for a run.
 *
 * The neutral handle carries only `inputTokens`/`outputTokens`, which is what
 * every harness can fill honestly. The rest rides here so a consumer that wants
 * to price a run differently — or read what the cache actually saved — has the
 * raw numbers rather than our derivation of them.
 *
 * `reasoningTokens` is a SUBSET of `outputTokens`, and `totalTokens` already
 * excludes it, as the SDK's own `TokenUsage` documents. Adding them would
 * double-count the reasoning.
 */
export interface CursorRunUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reasoningTokens: number;
}

/**
 * Handle for a single Cursor run.
 *
 * The neutral harness handle plus Cursor's own extras. `status` never reaches
 * `"dispatched"`/`"running"`: this door observes its run to completion or
 * throws, so a returned handle is always terminal.
 *
 * `outcome` is `"finished"` on a run the SDK reports as finished and `"failed"`
 * on one it reports as errored or cancelled. Cursor reports no turn or budget
 * cap, so `"stopped-at-limit"` is never produced here — and a run stopped by the
 * CALLER's deadline is a throw, not a handle (LAB-152's abort contract).
 *
 * `sessionId` is the agent id, not the run id. That is the thing `resume` takes:
 * a Cursor agent is the durable conversation, and each `send` is one run inside
 * it.
 */
export interface CursorAgentHandle extends HarnessRunHandle {
  source: typeof CURSOR_SOURCE;
  status: "completed" | "errored";
  /** Cursor's own usage breakdown, or `null` when the run reported none. */
  cursorUsage: CursorRunUsage | null;
  /** The message from a failed or cancelled run, or `null` when it neither failed nor was cancelled. */
  failureMessage: string | null;
}

/**
 * Runtime validator for {@link CursorAgentHandle}.
 *
 * The extension's own two fields default to `null` for the same reason the
 * neutral schema's four do: a handle persisted before they existed still parses
 * (BP-030).
 */
export const cursorAgentHandleSchema = harnessRunHandleSchema.extend({
  source: z.literal(CURSOR_SOURCE),
  status: z.enum(["completed", "errored"]),
  cursorUsage: z
    .object({
      inputTokens: z.number(),
      outputTokens: z.number(),
      cacheReadTokens: z.number(),
      cacheWriteTokens: z.number(),
      totalTokens: z.number(),
      reasoningTokens: z.number(),
    })
    .nullable()
    .default(null),
  failureMessage: z.string().nullable().default(null),
});

// ---------------------------------------------------------------------------
// The SDK's wire, declared locally
// ---------------------------------------------------------------------------

/** Cursor's model selection: an id plus whatever parameters that model exposes. */
export interface CursorModelSelection {
  id: string;
  params?: Array<{ id: string; value: string }>;
}

/** Cursor's per-run token report, in the SDK's own spelling. */
export interface CursorWireUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  reasoningTokens?: number;
}

/** A block inside an assistant message: prose, or the model calling a tool. */
export type CursorContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  // Anything the tested wire gains that this package does not know.
  | { type: string };

/**
 * One message from `run.stream()`.
 *
 * Nine kinds on the tested wire. Every field this package READS is optional or
 * guarded at the point of use even inside a kind we recognise: the version gate
 * holds the boundary, but a vendor moving a field WITHIN a message it still
 * calls `assistant` would otherwise crash translation on a wire the gate had
 * already approved.
 */
export type CursorSdkMessage =
  | { type: "system"; subtype?: string; model?: CursorModelSelection; tools?: string[] }
  | { type: "assistant"; message: { role: "assistant"; content: CursorContentBlock[] } }
  | { type: "user"; message: { role: "user"; content: Array<{ type: "text"; text: string }> } }
  | {
      type: "tool_call";
      call_id: string;
      name: string;
      status: "running" | "completed" | "error";
      args?: unknown;
      result?: unknown;
    }
  | { type: "thinking"; text: string; thinking_duration_ms?: number }
  | {
      type: "status";
      status: "CREATING" | "RUNNING" | "FINISHED" | "ERROR" | "CANCELLED" | "EXPIRED";
      message?: string;
    }
  | { type: "request"; request_id: string }
  | { type: "task"; status?: string; text?: string }
  | { type: "usage"; usage: CursorWireUsage }
  // Same reason as the content-block union's open branch: translation needs a
  // branch to fall into rather than a cast (BP-030).
  | { type: string };

/** What the SDK says a run's failure was. */
export interface CursorRunError {
  message: string;
  code?: string;
}

/**
 * What `run.wait()` resolves to — the run's terminal record.
 *
 * `status` is the SDK's own three-way terminal enum. `result` is the run's final
 * answer text; `usage` is cumulative across the turns that reported it.
 */
export interface CursorRunResult {
  id?: string;
  status: string;
  result?: string;
  error?: CursorRunError;
  model?: CursorModelSelection;
  durationMs?: number;
  usage?: CursorWireUsage;
}

// ---------------------------------------------------------------------------
// Forwarded option groups
// ---------------------------------------------------------------------------

/**
 * The SDK's `AgentOptions`, forwarded verbatim to `Agent.create` /
 * `Agent.resume` and typed locally.
 *
 * Three things are deliberately ABSENT, and each is refused at build time
 * rather than merged, because each has exactly one owner (BP-031):
 *
 * - `agentId` — the `resume` resolver decides which conversation continues.
 * - `local.cwd` — the `cwd` resolver decides where a run works. The rest of
 *   `local` is forwarded.
 * - `cloud` — v1 drives Cursor's LOCAL runtime only, so a cloud bag would be
 *   silently ignored by a code path that assumes a local checkout.
 *
 * `apiKey` is where Cursor's credential goes. Leave it unset and the SDK reads
 * `CURSOR_API_KEY` from the environment itself.
 */
export interface CursorCreateOptions {
  /**
   * Which model runs. **Required** by the SDK for a local agent; `Agent.create`
   * throws a typed configuration error without it.
   *
   * This is also what the cost estimate is priced against when the run's own
   * messages do not name a model.
   */
  model?: CursorModelSelection;
  apiKey?: string;
  name?: string;
  mode?: "agent" | "plan";
  tools?: string[];
  disallowedTools?: string[];
  systemPrompt?: string;
  mcpServers?: Record<string, unknown>;
  agents?: Record<string, unknown>;
  idempotencyKey?: string;
  /** The SDK's local-runtime bag, minus `cwd`. */
  local?: {
    dirs?: string[];
    autoReview?: boolean;
    settingSources?: string[];
    sandboxOptions?: { enabled: boolean };
    customTools?: Record<string, unknown>;
    enableAgentRetries?: boolean;
    store?: unknown;
  };
}

/**
 * The SDK's `SendOptions`, forwarded verbatim to `agent.send`.
 *
 * `cloud` is absent for the same reason it is absent from
 * {@link CursorCreateOptions}. `onStep` and `onDelta` are forwarded: they are
 * the host's own observers, and this package's item mirror is built from
 * `run.stream()` rather than from them, so a host taking both sees the same run
 * twice rather than a partial one.
 */
export interface CursorSendOptions {
  model?: CursorModelSelection;
  mode?: "agent" | "plan";
  mcpServers?: Record<string, unknown>;
  idempotencyKey?: string;
  onStep?: (args: { step: unknown }) => void | Promise<void>;
  onDelta?: (args: { update: unknown }) => void | Promise<void>;
  local?: { force?: boolean; customTools?: Record<string, unknown> };
}

// ---------------------------------------------------------------------------
// The resolver seam
// ---------------------------------------------------------------------------

/** The subset of the SDK's `Run` this package drives. */
export interface CursorRunLike {
  readonly id: string;
  stream(): AsyncIterable<CursorSdkMessage>;
  wait(): Promise<CursorRunResult>;
  cancel(): Promise<void>;
  /** The SDK's own capability probe. Absent on a scripted double, and then every operation is assumed supported. */
  supports?(operation: string): boolean;
}

/** The subset of the SDK's `SDKAgent` this package drives. */
export interface CursorAgentLike {
  readonly agentId: string;
  send(prompt: string, options?: CursorSendOptions): Promise<CursorRunLike>;
  /** Releases the local runtime. Called in a `finally`, so a run never leaks one. */
  close?(): void;
}

/** The subset of the SDK's `Agent` class this package drives. */
export interface ResolvedCursorClient {
  create(options: CursorCreateOptions & { local?: { cwd?: string } }): Promise<CursorAgentLike>;
  resume(
    agentId: string,
    options: CursorCreateOptions & { local?: { cwd?: string } },
  ): Promise<CursorAgentLike>;
}

/**
 * Host hook resolving the Cursor client for a block invocation.
 *
 * Accepts the block context loosely so a fully parameterized `execute` context
 * passes without a cast — the same reason `ResolveCodexClient` does.
 */
export type ResolveCursorClient = (
  ctx: BlockContext<any, any, any, any, any, any, any, any, any>,
) => ResolvedCursorClient | Promise<ResolvedCursorClient>;

/**
 * What the version gate could learn about the installed SDK.
 *
 * Three answers, not two, and the third is the one that matters. A layout the
 * manifest walk cannot see (Yarn PnP, a custom loader) is not the same fact as
 * "there is nothing installed", and treating it as such would let an
 * unvalidated SDK through the very gate that exists to refuse one, while the
 * dynamic import went on resolving and running it. A safety gate must fail
 * closed: "there is nothing installed" is safe, "I cannot tell" is not.
 */
export type InstalledSdkVersion =
  | { kind: "absent" }
  | { kind: "version"; version: string }
  | { kind: "unreadable"; reason: string };

/**
 * How the version gate learns which SDK is installed.
 *
 * A seam only so the refusal is testable against versions other than the one on
 * this disk. It is deliberately NOT reachable from `CursorAgentOptions`: a host
 * that could substitute its own reader could answer with the tested version and
 * run an unvalidated wire, which would make the package's exact-version refusal
 * a claim rather than a guarantee.
 */
export type InstalledSdkVersionReader = () => InstalledSdkVersion;

// ---------------------------------------------------------------------------
// The pure translation layer's output
// ---------------------------------------------------------------------------

/**
 * What `translate` turns one wire message into: a description of what to emit,
 * with no side effects and no vendor vocabulary past this point.
 *
 * `run_usage` is not an emission — it carries the token report to the handle —
 * but it rides the same union so the block's loop has one shape to walk.
 */
export type TranslatedEvent =
  | { kind: "message"; text: string }
  | { kind: "reasoning"; text: string }
  | { kind: "tool_call"; callId: string; name: string; arguments: string }
  | {
      kind: "tool_result";
      callId: string;
      name: string;
      arguments: string;
      output: unknown;
      isError: boolean;
    }
  | { kind: "status"; message: string }
  | { kind: "error"; message: string; code?: string }
  | { kind: "run_usage"; usage: CursorRunUsage }
  | { kind: "model"; model: string };
