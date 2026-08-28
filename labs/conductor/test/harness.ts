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
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { ModelResolver } from "@flow-state-dev/core/types";
import type {
  ResolveClaudeAgent,
  SdkMessageLike,
} from "@flow-state-dev/claude-code/sdk";
import { conductorFlow, CONDUCTOR_FLOW_KIND } from "../src/flow";
import { implementPhase } from "../src/implement";
import { ASK_MARKER_IGNORE_RULE } from "../src/ask";
import { CHECKOUT_CLEANUP_TIMEOUT_MS } from "../src/exec";
import type { PhaseSpec, PromptRunContext } from "../src/manager";

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

/**
 * A `query` that WRITES A QUESTION into the run's own checkout, then returns
 * the given verdict.
 *
 * The whole ask path in one stub: the marker lands at the attempt's derived
 * path inside `cwd`, exactly where a real coding run is told to put it, and the
 * verdict is separate so a marker can be paired with a FAILED result — the
 * combination arm 1's verdict half exists to exclude.
 *
 * The target path is parsed back out of the PROMPT rather than derived here, so
 * a prompt that stopped naming the marker makes this stub write nowhere — which
 * is exactly what a real coding agent would do with the same prompt.
 */
export function askingAgent(
  question: string | (() => string | undefined),
  subtype: string,
  seen: { prompts: string[]; cwds: (string | undefined)[] },
): ResolveClaudeAgent {
  return () => ({
    query: async function* (args) {
      const prompt = String(args.prompt);
      seen.prompts.push(prompt);
      const cwd = args.options?.cwd;
      seen.cwds.push(cwd);
      const text = typeof question === "function" ? question() : question;
      if (cwd !== undefined && text !== undefined) {
        // The path the PROMPT named, parsed back out of it — so a prompt that
        // stopped naming the marker makes this stub write nowhere, which is the
        // failure a real coding agent would produce.
        const named = /^\s{2}(\S*[/\\]\.fsdev[/\\]ask[/\\]\d+\.md)\s*$/m.exec(prompt);
        if (named !== null) {
          const target = named[1]!;
          mkdirSync(dirname(target), { recursive: true });
          writeFileSync(target, text);
        }
      }
      yield sdkResult(subtype);
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
  call<T = unknown>(
    action: string,
    input: unknown,
    asSession?: string,
    asTenant?: string,
  ): Promise<T>;
  /**
   * The same call, with the request's ITEMS as well as its output.
   *
   * The board's completion item is where `terminationReason` lives, and the
   * drain's exit verdict is not on any action's output — so a check that the
   * drain returned BECAUSE a row was parked has to read the stream, not the
   * return value.
   */
  callWithItems<T = unknown>(
    action: string,
    input: unknown,
    asSession?: string,
    asTenant?: string,
  ): Promise<{ output: T; items: readonly unknown[] }>;
  dispose(): void;
}

export interface HarnessOptions {
  resolveClaudeAgent: ResolveClaudeAgent;
  /** Overrides the implement phase's done-condition. Default: satisfied. */
  isDone?: PhaseSpec["isDone"];
  /**
   * Called with each attempt's prompt context, before its run.
   *
   * A spy on the real builder rather than a replacement — the prompt is
   * unchanged. It exists because `ctx.resources` is otherwise unreachable from
   * a test, and `buildPrompt` is the one phase hook that runs on EVERY attempt:
   * the done-condition runs only where its answer can decide something, so an
   * attempt that parks on a question never reaches it.
   *
   * Distinct from {@link buildPrompt} below, which REPLACES the builder: a spy
   * that also replaced it could not observe the real prompt, and a replacement
   * that also spied would report on itself.
   */
  onPrompt?: (run: PromptRunContext) => void;
  /**
   * Overrides the implement phase's construction-time validation. Lets a test
   * observe what `conductorFlow` does with the value `validate` returns.
   */
  validate?: PhaseSpec["validate"];
  /**
   * Overrides the prompt builder. The other half of what `conductorFlow` binds
   * — `validated` reaches this hook and the done-condition through two
   * separately-built contexts, so observing one says nothing about the other.
   */
  buildPrompt?: PhaseSpec["buildPrompt"];
  /**
   * Overrides the configured phase NAME. Lets a test restart a conductor over
   * durable rows with the phase spelled differently — which is how a casing
   * mismatch between config and stored row actually arises.
   */
  phaseName?: string;
  maxAttempts?: number;
  epic?: string;
  /** Build the conductor for this tenant. The request still resolves untenanted. */
  tenant?: string;
  ownership?: { waitMs?: number; pollMs?: number; staleAfterMs?: number };
  runTimeoutMs?: number;
  /** The bound on ALL of provisioning, which the stale window must clear. */
  provisionTimeoutMs?: number;
  /** The relay seam. Called after the park; a no-op by default. */
  announce?: NonNullable<Parameters<typeof conductorFlow>[0]["announce"]>;
}

/** A real git repository with one commit, so `worktree add` has something to cut. */
export function seedRepo(dir: string): void {
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: dir, stdio: "pipe", encoding: "utf8" });
  git("init", "--initial-branch=main", ".");
  git("config", "user.email", "conductor@example.test");
  git("config", "user.name", "Conductor Test");
  // **A stand-in repository has tracked content, because a real one does.**
  // These fixtures committed nothing, so every worktree cut from them had zero
  // tracked files — which makes a half-populated checkout indistinguishable from
  // a complete one (`git ls-files --deleted` is empty either way), and that
  // distinction is what the provisioning marker is now corroborated against.
  // Another fixture that had drifted from the thing it stands for.
  writeFileSync(join(dir, "tracked.txt"), "content the checkout should carry\n");
  // **A stand-in source repository ignores the ask marker, because a real one
  // has to.** The marker lands in the product checkout, so the rule that keeps
  // it out of a commit belongs to THAT repository — and provisioning now
  // refuses a checkout whose repository does not carry it, before the agent
  // runs. Third fixture in this file that had drifted from the thing it stands
  // for, and the same tell each time: the specs passed because nothing asked.
  writeFileSync(join(dir, ".gitignore"), `${ASK_MARKER_IGNORE_RULE}\n`);
  git("add", "tracked.txt", ".gitignore");
  git("commit", "-m", "root");
  // **A stand-in source repository has an `origin`, because a real one does.**
  // The implement phase's completion probe reads it, and `conductorFlow` now
  // refuses a source repo without one — a guard that exists because the failure
  // otherwise lands after a paid agent run, once per retry. These fixtures had
  // no remote at all, so every flow built here was one the probe could not have
  // run against; the specs passed only because the probe is stubbed. Nothing
  // resolves this URL: the phase's `gh` call is replaced in every test that
  // reaches it.
  git("remote", "add", "origin", "https://github.com/fixpoint-labs/conductor-fixture.git");
}

export function createConductorHarness(options: HarnessOptions): ConductorHarness {
  const dir = mkdtempSync(join(tmpdir(), "conductor-"));
  const sourceRepo = join(dir, "repo");
  const workspaceRoot = join(dir, "checkouts");
  execFileSync("mkdir", ["-p", sourceRepo]);
  seedRepo(sourceRepo);

  const base = implementPhase({ prExists: () => true });

  // **The spy wraps whatever builder is in effect, not always the base one.**
  // One option REPLACES the builder and the other OBSERVES it, so they compose;
  // applied as competing spreads, whichever came last won and a test setting
  // both got a spy reporting on a builder that was not the one running.
  const builder = options.buildPrompt ?? base.buildPrompt;
  const phase: PhaseSpec = {
    ...base,
    ...(options.isDone !== undefined ? { isDone: options.isDone } : {}),
    ...(options.validate !== undefined ? { validate: options.validate } : {}),
    ...(options.phaseName !== undefined ? { phase: options.phaseName } : {}),
    buildPrompt:
      options.onPrompt === undefined
        ? builder
        : (run: PromptRunContext) => {
            options.onPrompt!(run);
            return builder(run);
          },
  };

  // Derived, not spelled out. The manager enforces
  // `waitMs >= staleAfterMs > runTimeoutMs + provisionTimeoutMs + cleanup`, and independent constants
  // here let a test set one of them and get a construction error that has
  // nothing to do with what it was testing. Deriving keeps every harness
  // instance valid by construction, whichever knob a test turns.
  const runTimeoutMs = options.runTimeoutMs ?? 30_000;
  // The manager's own arithmetic, not a guess at it: the lock is held across
  // provisioning AND the run, so the stale window must clear both. Shrinking
  // the git budget is what keeps the suite's numbers small while the inequality
  // stays the real one.
  const provisionTimeoutMs = options.provisionTimeoutMs ?? 10_000;
  // Derived the SAME way the manager derives it, not from two of its terms.
  // `maxLockHeldMs` counts the cleanup allowance — a refusal late in
  // provisioning discards the checkout it just made, under the lock — against
  // `runTimeoutMs` rather than alongside it, because a refusal throws before any
  // run. A fixture adding only `runTimeoutMs + provisionTimeoutMs` derived a
  // stale window the manager refuses at construction.
  const staleAfterMs =
    options.ownership?.staleAfterMs ??
    provisionTimeoutMs + Math.max(runTimeoutMs, CHECKOUT_CLEANUP_TIMEOUT_MS) + 1_000;
  const pollMs = options.ownership?.pollMs ?? 25;
  const ownership = {
    // **Strictly past the stale window, by one poll.** The manager requires it,
    // and it derived `staleAfterMs` exactly — which is the configuration the
    // manager now refuses, because a wait that ENDS when the lock becomes
    // eligible times out instead of taking over. The fixture had the same defect
    // the production default did.
    waitMs: options.ownership?.waitMs ?? staleAfterMs + pollMs,
    pollMs,
    staleAfterMs,
  };

  const built = conductorFlow({
    epic: options.epic ?? "harness-manager",
    ...(options.tenant !== undefined ? { tenant: options.tenant } : {}),
    workspace: { root: workspaceRoot, sourceRepo, baseRef: "main", provisionTimeoutMs },
    maxAttempts: options.maxAttempts ?? 3,
    runTimeoutMs,
    phase,
    agent: {
      resolveClaudeAgent: options.resolveClaudeAgent,
      includePartialMessages: false,
    },
    ownership,
    ...(options.announce !== undefined ? { announce: options.announce } : {}),
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

  /**
   * Run one action, returning both its output and the request's items.
   *
   * `asTenant` is the request's RESOLVED tenant — it goes to `runAction`,
   * which puts it on `ctx.user.identity`, exactly where a real deployment's
   * authentication would. Never passed in the input body: the whole point of
   * the guard under test is that it reads a trusted source (BP-031), so a
   * test that supplied the tenant through the payload would be exercising the
   * wrong path.
   */
  async function callWithItems<T>(
    action: string,
    input: unknown,
    asSession?: string,
    asTenant?: string,
  ): Promise<{ output: T; items: readonly unknown[] }> {
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
        ...(asTenant !== undefined ? { tenantId: asTenant } : {}),
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
    return {
      output: outcome.output as T,
      items: (result as { items?: readonly unknown[] }).items ?? [],
    };
  }

  return {
    state,
    flow: built.flow,
    built,
    workspaceRoot,
    sourceRepo,
    sessionId,
    call: async <T>(
      action: string,
      input: unknown,
      asSession?: string,
      asTenant?: string,
    ): Promise<T> => (await callWithItems<T>(action, input, asSession, asTenant)).output,
    callWithItems,
    dispose() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
