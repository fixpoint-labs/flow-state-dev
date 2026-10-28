/**
 * Read how much of a Codex subscription is used, with no run:
 * `readCodexUsage()`.
 *
 * Codex's app-server answers two documented requests that need no turn:
 * `account/read` (who is signed in, and how) and `account/rateLimits/read`
 * (every window of the sign-in's limit, as a percent used and a reset time).
 * This starts a short-lived `codex app-server`, the program the SDK runs, asks
 * both over its stdio JSON-RPC, and stops it. Nothing reads a token file and
 * nothing calls an endpoint the CLI doesn't document.
 *
 * Runs go through `@openai/codex-sdk`, which starts `codex exec`, so they never
 * reach an app-server a listener could hear. Reading on demand sees the whole
 * pool, whatever used it.
 *
 * **Local only.** OpenAI permits the app-server's ChatGPT sign-in on a
 * person's own machine, not in a hosted service. A host opts in by passing
 * this as its Codex usage reader.
 *
 * The shape follows `probeClaudeAccount` in `@flow-state-dev/claude-code`: a
 * discriminated result, a timeout, and no throw for the states that have no
 * number. Signed out and API key are told apart by `account/read`, never by
 * an error's wording.
 */
import { spawn } from "node:child_process";
import { delimiter } from "node:path";
import type { HarnessUsageReading, HarnessUsageWindow } from "@flow-state-dev/core/types";
import { createDefaultResolveCodexClient, type CodexSdkImporter } from "./codex-client";

/** The Codex program the SDK runs, and the directories it puts on that program's `PATH`. */
export interface CodexProgram {
  readonly path: string;
  readonly pathDirs: readonly string[];
}

/**
 * Find the Codex program the SDK would start, the way the SDK finds it.
 *
 * The SDK resolves its platform binary (from `@openai/codex`, pinned beside
 * it) when its client is constructed, which starts nothing. So a usage read
 * and a run start the same program and read the same sign-in.
 *
 * @throws When the SDK can't be loaded, or doesn't say where its program is.
 */
export async function findCodexProgram(
  env: Record<string, string>,
  options: { importSdk?: CodexSdkImporter } = {},
): Promise<CodexProgram> {
  // The default resolver reads nothing off the block context; there is no block here.
  const client = (await createDefaultResolveCodexClient({ env }, options.importSdk)(undefined as never)) as {
    exec?: { executablePath?: unknown; pathDirs?: unknown };
  };
  const exec = client.exec;
  if (typeof exec?.executablePath !== "string") throw new Error("the Codex SDK did not say where its program is");
  const pathDirs = Array.isArray(exec.pathDirs) ? exec.pathDirs.filter((d): d is string => typeof d === "string") : [];
  return { path: exec.executablePath, pathDirs };
}

/** Options for {@link readCodexUsage}. */
export interface ReadCodexUsageOptions {
  /**
   * The environment Codex is started with. Pass the one a run gets (for
   * example `harnessEnv({ pass: ["PATH", "HOME", "CODEX_HOME"] })`), so the
   * read and the run see one sign-in.
   */
  env: Record<string, string>;
  /** How long to wait for Codex's answers before reading `unavailable`. Default 10 000 ms. */
  timeoutMs?: number;
  /** Stops the read early; it then reads `unavailable`. */
  signal?: AbortSignal;
  /**
   * The program to start as `<path> app-server`. A seam for tests and
   * scripted checks; the default is {@link findCodexProgram}'s answer.
   */
  program?: CodexProgram;
}

/** {@link ReadCodexUsageOptions.timeoutMs}'s default. */
const DEFAULT_TIMEOUT_MS = 10_000;

/** The JSON-RPC answers this reads, as the pinned CLI's `generate-ts` publishes them. */
interface RateLimitWindow {
  usedPercent?: unknown;
  windowDurationMins?: unknown;
  resetsAt?: unknown;
}
interface RateLimitSnapshot {
  limitId?: unknown;
  limitName?: unknown;
  primary?: RateLimitWindow | null;
  secondary?: RateLimitWindow | null;
  planType?: unknown;
}
interface RateLimitsResponse {
  rateLimits?: RateLimitSnapshot | null;
  rateLimitsByLimitId?: Record<string, RateLimitSnapshot | null | undefined> | null;
  accountId?: unknown;
}

/**
 * Read Codex's subscription usage, with no run.
 *
 * @returns `windows` with every window Codex reports; `api-key` or
 *   `signed-out` when there is no subscription number to read; `unavailable`
 *   with a plain reason when the read could not be made. Never throws.
 */
export async function readCodexUsage(options: ReadCodexUsageOptions): Promise<HarnessUsageReading> {
  // Runs given CODEX_API_KEY use it whatever account is saved, and app-server
  // reports the saved one, so the key decides before anything is asked.
  if ((options.env.CODEX_API_KEY ?? "") !== "") {
    return { status: "api-key", reason: "Codex uses an API key: no subscription limit" };
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let program: CodexProgram;
  try {
    program = options.program ?? (await findCodexProgram(options.env));
  } catch {
    return { status: "unavailable", reason: "The Codex CLI could not be found: is @openai/codex-sdk installed?" };
  }

  const session = startAppServer(program, options.env);
  const timer = setTimeout(() => session.stop(`Codex did not answer within ${timeoutMs / 1000} s`), timeoutMs);
  const onAbort = () => session.stop("The read was stopped before Codex answered");
  options.signal?.addEventListener("abort", onAbort, { once: true });
  if (options.signal?.aborted === true) onAbort();
  try {
    await session.request("initialize", { clientInfo: { name: "flow-state-dev", title: null, version: "0" }, capabilities: null });
    session.notify("initialized");
    const account = (await session.request("account/read", {})) as { account?: { type?: unknown; planType?: unknown } | null };
    if (account.account === null || account.account === undefined) {
      return { status: "signed-out", reason: "Codex is not signed in: not available automatically" };
    }
    if (account.account.type === "apiKey") {
      return { status: "api-key", reason: "Codex uses an API key: no subscription limit" };
    }
    if (account.account.type !== "chatgpt") {
      return { status: "unavailable", reason: "Codex is signed in a way that reports no subscription limit" };
    }
    const limits = (await session.request("account/rateLimits/read", undefined)) as RateLimitsResponse;
    const plan = text(account.account.planType) ?? text(limits.rateLimits?.planType);
    return { status: "windows", accountId: text(limits.accountId), plan, windows: windowsOf(limits) };
  } catch (error) {
    return { status: "unavailable", reason: error instanceof ReadStopped ? error.message : "Codex could not read its limits" };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onAbort);
    session.stop("done");
  }
}

/**
 * Every window in a read: each limit id's primary and secondary, or the single
 * view when Codex sent no map. Ids are `<limit>:<slot>`, so a limit's two
 * windows never collide.
 */
function windowsOf(limits: RateLimitsResponse): HarnessUsageWindow[] {
  const byId =
    limits.rateLimitsByLimitId !== null && limits.rateLimitsByLimitId !== undefined
      ? Object.entries(limits.rateLimitsByLimitId)
      : limits.rateLimits === null || limits.rateLimits === undefined
        ? []
        : [[text(limits.rateLimits.limitId) ?? "codex", limits.rateLimits] as const];
  const windows: HarnessUsageWindow[] = [];
  for (const [key, snapshot] of byId) {
    if (snapshot === null || snapshot === undefined) continue;
    const limit = text(snapshot.limitId) ?? key;
    for (const slot of ["primary", "secondary"] as const) {
      const window = snapshot[slot];
      if (window === null || window === undefined || !Number.isFinite(window.usedPercent)) continue;
      windows.push({
        id: `${limit}:${slot}`,
        label: text(snapshot.limitName),
        minutes: typeof window.windowDurationMins === "number" ? window.windowDurationMins : null,
        // The contract is 0 to 100; past a limit Codex can report more.
        usedPercent: Math.min(100, Math.max(0, window.usedPercent as number)),
        // Codex always sends a percent, and no level.
        level: null,
        // Codex sends seconds since the epoch.
        resetsAt: typeof window.resetsAt === "number" ? window.resetsAt * 1000 : null,
      });
    }
  }
  return windows;
}

/** A read that ended before Codex answered: a timeout, an abort, or the program gone. Its message is the reason shown. */
class ReadStopped extends Error {}

/** One `codex app-server` child, spoken to over newline-delimited JSON-RPC on stdio. */
function startAppServer(program: CodexProgram, env: Record<string, string>) {
  const PATH = [...program.pathDirs, env.PATH ?? ""].filter((dir) => dir !== "").join(delimiter);
  // stderr is dropped: what a person is shown is a plain reason, never the CLI's own output.
  // Cast because a host's types (Next's) may make `NODE_ENV` required; this child gets `env` alone.
  const child = spawn(program.path, ["app-server"], {
    env: { ...env, PATH } as Record<string, string> as NodeJS.ProcessEnv,
    stdio: ["pipe", "pipe", "ignore"],
  });
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let nextId = 1;
  let stopped: ReadStopped | undefined;
  let buffer = "";

  const fail = (error: ReadStopped) => {
    stopped ??= error;
    for (const waiter of pending.values()) waiter.reject(stopped);
    pending.clear();
  };
  child.on("error", () => fail(new ReadStopped("The Codex CLI could not be started")));
  child.on("exit", () => fail(new ReadStopped("Codex stopped before it answered")));
  child.stdin.on("error", () => fail(new ReadStopped("Codex stopped before it answered")));
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    buffer += chunk;
    for (let nl = buffer.indexOf("\n"); nl >= 0; nl = buffer.indexOf("\n")) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line === "") continue;
      let message: { id?: unknown; result?: unknown; error?: unknown };
      try {
        message = JSON.parse(line) as typeof message;
      } catch {
        continue;
      }
      // Notifications and server requests carry no id of ours; only answers are read.
      if (typeof message.id !== "number") continue;
      const waiter = pending.get(message.id);
      if (waiter === undefined) continue;
      pending.delete(message.id);
      if (message.error !== undefined) waiter.reject(new Error("Codex refused the request"));
      else waiter.resolve(message.result);
    }
  });

  const send = (message: Record<string, unknown>) => {
    if (stopped === undefined) child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  };
  return {
    request(method: string, params: unknown): Promise<unknown> {
      if (stopped !== undefined) return Promise.reject(stopped);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ id, method, ...(params === undefined ? {} : { params }) });
      });
    },
    notify(method: string): void {
      send({ method });
    },
    stop(reason: string): void {
      fail(new ReadStopped(reason));
      if (child.exitCode === null && child.signalCode === null) child.kill();
    },
  };
}

/** A non-empty string, or `null`. */
function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}
