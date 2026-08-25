/**
 * A conductor running end to end, in process, with the model stubbed.
 *
 * The seams the suite drives are the real ones — a real `createFlowState`
 * (which is what installs the detached start operation; a bare `runAction` has
 * no request host and the first dispatch throws by name), the real task board
 * and its detached runner, the real `user`-scoped ledger, and the real
 * fenced settlement. Only two things are substituted: the SDK `query`, so a
 * verdict can be staged, and the done-condition, so the conjunction's two arms
 * can be staged independently.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core/types";
import type {
  ResolveClaudeAgent,
  SdkMessageLike,
} from "@flow-state-dev/claude-code/sdk";
import { conductorFlow, CONDUCTOR_FLOW_KIND } from "../src/flow";
import { implementPhase } from "../src/implement";
import type { PhaseSpec } from "../src/manager";

export const USER_ID = "conductor-test-user";

/** A terminal SDK result. `subtype: "success"` is the only non-errored one. */
export function sdkResult(
  subtype: string,
  extra: Record<string, unknown> = {},
): SdkMessageLike {
  return {
    type: "result",
    subtype,
    result: "done",
    session_id: "sess_stub",
    usage: { input_tokens: 10, output_tokens: 2 },
    total_cost_usd: 0.02,
    ...extra,
  } as SdkMessageLike;
}

/** A `query` that yields a fixed script, recording the prompt and options it saw. */
export function scriptedAgent(
  script: SdkMessageLike[] | (() => SdkMessageLike[]),
  seen: { prompts: string[]; cwds: (string | undefined)[] },
): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      seen.prompts.push(String(args.prompt));
      seen.cwds.push(args.options?.cwd);
      for (const message of typeof script === "function" ? script() : script) {
        yield message;
      }
    },
  });
}

/** A `query` that throws mid-stream, before any handle is constructed. */
export function throwingAgent(
  message: string,
  seen: { prompts: string[]; cwds: (string | undefined)[] },
): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      seen.prompts.push(String(args.prompt));
      seen.cwds.push(args.options?.cwd);
      throw new Error(message);
      // eslint-disable-next-line no-unreachable
      yield undefined as never;
    },
  });
}

/**
 * A `query` that never finishes on its own, and throws when aborted.
 *
 * This is what the real SDK does under a fired abort controller: the iteration
 * rejects mid-stream, before any handle exists. Observing `options.abortController`
 * is the point — a stub that merely slept would time the test out instead of
 * proving the signal reached the query.
 */
export function hangingAgent(seen: {
  prompts: string[];
  cwds: (string | undefined)[];
}): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      seen.prompts.push(String(args.prompt));
      seen.cwds.push(args.options?.cwd);
      const signal = args.options?.abortController?.signal;
      await new Promise<never>((_resolve, reject) => {
        if (signal?.aborted === true) {
          reject(new Error("the run was aborted"));
          return;
        }
        signal?.addEventListener(
          "abort",
          () => reject(new Error("the run was aborted")),
          { once: true },
        );
      });
      yield undefined as never;
    },
  });
}

function neverResolvesAModel(): never {
  throw new Error("conductor declares no generator actions; it never resolves a model.");
}

export interface ConductorHarness {
  state: ReturnType<typeof createFlowState>;
  flow: ReturnType<typeof conductorFlow>["flow"];
  built: ReturnType<typeof conductorFlow>;
  workspaceRoot: string;
  sourceRepo: string;
  sessionId: string;
  /** `asSession` drives the action from a DIFFERENT coordinator session. */
  call<T = unknown>(action: string, input: unknown, asSession?: string): Promise<T>;
  dispose(): void;
}

export interface HarnessOptions {
  resolveClaudeAgent: ResolveClaudeAgent;
  /** Overrides the implement phase's done-condition. Default: satisfied. */
  isDone?: PhaseSpec["isDone"];
  maxAttempts?: number;
  epic?: string;
  /** Build the conductor for this tenant. The request still resolves untenanted. */
  tenant?: string;
  ownership?: { waitMs?: number; pollMs?: number; staleAfterMs?: number };
  runTimeoutMs?: number;
}

/** A real git repository with one commit, so `worktree add` has something to cut. */
export function seedRepo(dir: string): void {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" });
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "conductor@example.test");
  git("config", "user.name", "Conductor Test");
  git("commit", "--allow-empty", "-m", "root");
}

export function createConductorHarness(options: HarnessOptions): ConductorHarness {
  const dir = mkdtempSync(join(tmpdir(), "conductor-"));
  const sourceRepo = join(dir, "repo");
  const workspaceRoot = join(dir, "checkouts");
  execFileSync("mkdir", ["-p", sourceRepo]);
  seedRepo(sourceRepo);

  const base = implementPhase({ prExists: () => true });
  const phase: PhaseSpec = {
    ...base,
    ...(options.isDone !== undefined ? { isDone: options.isDone } : {}),
  };

  // Derived, not spelled out. The manager enforces
  // `waitMs >= staleAfterMs > runTimeoutMs`, and three independent constants
  // here let a test set one of them and get a construction error that has
  // nothing to do with what it was testing. Deriving keeps every harness
  // instance valid by construction, whichever knob a test turns.
  const runTimeoutMs = options.runTimeoutMs ?? 30_000;
  const staleAfterMs = options.ownership?.staleAfterMs ?? runTimeoutMs + 1_000;
  const ownership = {
    waitMs: options.ownership?.waitMs ?? staleAfterMs,
    pollMs: options.ownership?.pollMs ?? 25,
    staleAfterMs,
  };

  const built = conductorFlow({
    epic: options.epic ?? "harness-manager",
    ...(options.tenant !== undefined ? { tenant: options.tenant } : {}),
    workspace: { root: workspaceRoot, sourceRepo, baseRef: "main" },
    maxAttempts: options.maxAttempts ?? 3,
    runTimeoutMs,
    phase,
    agent: {
      resolveClaudeAgent: options.resolveClaudeAgent,
      includePartialMessages: false,
    },
    ownership,
  });

  const state = createFlowState({
    flows: { [CONDUCTOR_FLOW_KIND]: built.flow },
    stores: { test: { primary: inMemoryStores() } },
    defaultProfile: "test",
    modelResolver: Object.assign(neverResolvesAModel, {
      resolveId: neverResolvesAModel,
    }) as unknown as ModelResolver,
    // The default is a serverless SIGTERM window, far shorter than a coding
    // run. An in-process host must raise it or a shutdown truncates one.
    detachedDrainTimeoutMs: 60_000,
  } as never);

  const sessionId = `sess_conductor_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  return {
    state,
    flow: built.flow,
    built,
    workspaceRoot,
    sourceRepo,
    sessionId,
    async call<T>(action: string, input: unknown, asSession?: string): Promise<T> {
      // The RESOLVED runtime, not the FlowState handle: `stores` on the handle
      // is the unresolved slot config, and `runAction` reaches straight for
      // `stores.activeRequests`.
      const runtime = await (state as { getRuntime(): Promise<{
        stores: unknown;
        runtimeConfig: object;
      }> }).getRuntime();
      const result = await runAction({
        flow: built.flow as never,
        actionName: action as never,
        input: input as never,
        userId: USER_ID,
        sessionId: asSession ?? sessionId,
        stores: runtime.stores as never,
        // Spread, as `fsdev run` does: the detached start operation reaches a
        // request only because a spread copies the `requestHost` REFERENCE.
        runtimeConfig: { ...runtime.runtimeConfig } as never,
      });
      const outcome = result as { output?: unknown; status?: string; error?: unknown };
      if (outcome.error !== undefined && outcome.error !== null) {
        // Surface the real failure rather than a downstream "undefined.rows".
        //
        // `message` is read explicitly: it is a non-enumerable own property on
        // an Error, so `JSON.stringify` drops it and the envelope renders as
        // `{"code":"execution_error","cause":{}}` — every failure looking
        // identical, which is the opposite of what this exists for.
        const err = outcome.error as { message?: unknown; cause?: { message?: unknown } };
        const detail =
          (typeof err.message === "string" && err.message) ||
          (typeof err.cause?.message === "string" && err.cause.message) ||
          JSON.stringify(outcome.error);
        throw new Error(`conductor action "${action}" failed: ${detail}`);
      }
      return outcome.output as T;
    },
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
