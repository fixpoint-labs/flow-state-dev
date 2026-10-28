/**
 * Codex mode: the session flow with the Codex block, and the mode's own check
 * of whether this host can run it.
 *
 * Server only. Kitchen Sink passes the Codex block options and nothing else:
 * the thread lifecycle, the item stream and the classification of a refused
 * thread are the Codex package's. Codex declares no plan record, so the plan
 * panel says "Codex reports no plan": the pinned Codex gives its model no
 * to-do tool in the headless mode the package drives.
 *
 * **Kitchen Sink confines no run.** Codex runs without approval prompts and
 * with its sandbox off (`danger-full-access`), so it writes, commits and runs
 * commands wherever the server's OS user can — this checkout included, not
 * just the session's worktree. Kitchen Sink is a showcase meant to run on a
 * machine where that is fine. Run the server as a separate OS user, or in a
 * container, when it is not.
 *
 * Its process still starts with an allowlisted environment (`client.env`);
 * left unset, the SDK would hand it the server's whole environment. That
 * filters what the run is handed and nothing more: a command the run starts as
 * the server's OS user can still read the server's environment (on Linux, from
 * `/proc`).
 *
 * Codex mode takes nothing from your own Codex settings (`config.toml`) that
 * changes what a run is: not its model, not its service tier, not its MCP
 * servers, the way Claude Code mode loads no settings files. A model set there
 * may be one the signed-in account can't use, a tier like Fast (`priority`)
 * spends more of the account's usage, and a server signed in for your own use
 * fails to start inside the sandbox. Codex reads the file either way; the run
 * overrides each of those (`codexClientOptions`). Sign-in, history and every
 * other setting still come from Codex's home.
 *
 * Under `KITCHEN_SINK_TEST_MODE=1` the SDK is replaced by the scripted Codex
 * (`lib/scripted-codex.ts`) and the check passes, unless
 * `KITCHEN_SINK_REAL_HARNESS=1` asks for the real one, which the goal check
 * does so its controls apply to a real run.
 */
import { execFile, spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { delimiter } from "node:path";
import { harnessEnv } from "@flow-state-dev/core";
import {
  assertTestedSdkVersion,
  CodexAgentAbortedError,
  codexAgent,
  createDefaultResolveCodexClient,
  findCodexProgram,
  readInstalledCodexSdkVersion,
  TESTED_SDK_VERSION,
  type CodexAgentOptions,
  type CodexClientOptions,
  type CodexThreadOptions,
  type InstalledSdkVersionReader,
  type ResolveCodexClient,
} from "@flow-state-dev/codex";

import { harnessSessionFlow, type HarnessBlock, type HarnessFeeds } from "./harness-session-flow";
import { worktreeRoot } from "./harness-worktree";
import type { ModeAvailability, ModeCheck } from "./harness-gate";
import type { HarnessModel, ModelChoices } from "./harness-models";
import { flowKindOf, modeById } from "./modes";
import { scriptedCodex } from "./scripted-codex";

/** Codex mode's flow kind, from the mode list: the rail lists its sessions by it. */
export const CODEX_SESSION = flowKindOf(modeById("codex"));

/**
 * The models Codex mode offers in New session, its default first. Kept by
 * hand, because Codex's SDK can't list models (FIX-1952 D3; FIX-1975 removes
 * this list once it can). Updated from Codex 0.164.0's catalog and OpenAI's
 * model availability docs. Availability still depends on the signed-in account.
 * When Codex ships or retires a model, edit this list.
 */
export const CODEX_MODELS: readonly HarnessModel[] = [
  { id: "gpt-6.1-sol", label: "GPT-6.1-Sol" },
  { id: "gpt-6-sol", label: "GPT-6-Sol" },
  { id: "gpt-6-luna", label: "GPT-6-Luna" },
  { id: "gpt-6-astra", label: "GPT-6-Astra" },
  { id: "gpt-5.6-sol", label: "GPT-5.6-Sol" },
  { id: "gpt-5.6-terra", label: "GPT-5.6-Terra" },
  { id: "gpt-5.6-luna", label: "GPT-5.6-Luna" },
];

/**
 * Models Codex refuses when it is signed in with a ChatGPT account. Measured,
 * not guessed: Codex answers a turn on `gpt-6.1-sol` with a 400, "The
 * 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT
 * account." Add a model here only on the same evidence.
 */
const CHATGPT_REFUSED: ReadonlySet<string> = new Set(["gpt-6.1-sol"]);

/**
 * The model a Codex mode session runs when it names none: the list's first
 * that every sign-in can run. A session from before models could be picked
 * runs on it rather than on whatever model your own Codex settings name,
 * which may be one this account can't use.
 */
export const CODEX_DEFAULT_MODEL = CODEX_MODELS.find((model) => !CHATGPT_REFUSED.has(model.id))!.id;

/** How Codex is signed in for a run: an API key, a ChatGPT account, or not known. */
export type CodexSignIn = "api-key" | "chatgpt" | "unknown";

/**
 * What Codex mode's New session offers: the list above, its first entry
 * preselected. Signed in with a ChatGPT account, the models it refuses are
 * left out, the reason says which and why, and the first one left is
 * preselected. `signIn` is a seam for tests.
 */
export async function codexModelChoices(signIn: () => Promise<CodexSignIn> = () => codexSignIn(codexEnv())): Promise<ModelChoices> {
  if (codexIsScripted() || (await signIn()) !== "chatgpt") {
    return { models: CODEX_MODELS, defaultId: CODEX_MODELS[0]!.id, reason: null, fallbackId: CODEX_DEFAULT_MODEL };
  }
  const models = CODEX_MODELS.filter((model) => !CHATGPT_REFUSED.has(model.id));
  const refused = CODEX_MODELS.filter((model) => CHATGPT_REFUSED.has(model.id)).map((model) => model.label);
  return {
    models,
    defaultId: models[0]!.id,
    reason: `Unavailable: ${refused.join(", ")}. Codex here is signed in with a ChatGPT account, which can't use ${refused.length === 1 ? "it" : "them"}; an API key can.`,
    fallbackId: CODEX_DEFAULT_MODEL,
  };
}

/**
 * The only variables of the server's environment Codex's process is handed
 * (what its commands start with, not what they could read: see the header).
 * `PATH` (its shell finds commands through it), `HOME` and `CODEX_HOME` (Codex
 * keeps its sign-in and its threads there, so a thread is found again only
 * under the same home), `USER`, `SHELL` and `TMPDIR` (its shell),
 * `CODEX_API_KEY`, and the proxy and CA settings a proxied network needs. Add
 * a name here, never a spread of `process.env`.
 */
export const CODEX_PASS = [
  "PATH",
  "HOME",
  "CODEX_HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "CODEX_API_KEY",
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
  "NO_PROXY",
  "no_proxy",
  "CODEX_CA_CERTIFICATE",
  "SSL_CERT_FILE",
] as const;

/** The environment Codex's process gets, and the one its sign-in and sandbox are checked over. */
export function codexEnv(env: Record<string, string | undefined> = process.env): Record<string, string> {
  return harnessEnv({ pass: CODEX_PASS, env });
}

/** Whether this server runs the scripted Codex instead of the SDK. */
export function codexIsScripted(env: Record<string, string | undefined> = process.env): boolean {
  return env.KITCHEN_SINK_TEST_MODE === "1" && env.KITCHEN_SINK_REAL_HARNESS !== "1";
}

/** The SDK's thread options Codex mode runs with. The model is the session's, through the block's `model`. */
export function codexThreadOptions(): CodexThreadOptions {
  return {
    // No approval prompts: nobody is there to answer one, and nothing fences
    // the run either — Kitchen Sink confines no run (see the header).
    approvalPolicy: "never",
    sandboxMode: "danger-full-access",
  };
}

/** A listed MCP server and the transport needed to keep a disabled override valid. */
export interface CodexMcpServer {
  readonly name: string;
  readonly transport: { readonly command: string } | { readonly url: string };
}

/**
 * The SDK's client options Codex mode runs with: the allowlisted environment,
 * the standard service tier, every MCP server in `mcpServers` turned off, and
 * the sandbox's writable list narrowed to the run's own directory.
 *
 * Codex's overrides add to its settings rather than replace them (an empty
 * `mcp_servers` leaves every configured server on), so each server is turned
 * off by name, and the tier is set to `default`, which sends none. Codex's
 * `workspace-write` also lets a run write in `/tmp` and `$TMPDIR` by default,
 * where a repository or another session's files may sit.
 *
 * @param mcpServers The MCP servers Codex's settings name (`userMcpServers`).
 */
export function codexClientOptions(
  env: Record<string, string | undefined> = process.env,
  mcpServers: readonly CodexMcpServer[] = [],
): CodexClientOptions {
  return {
    env: codexEnv(env),
    config: { service_tier: "default" },
    // The inventory can contain plugin/runtime servers absent from config.toml.
    // Even a disabled entry needs a transport; quote names so dots remain literal.
    ...(mcpServers.length > 0 ? {
      configOverrides: [`mcp_servers={${mcpServers.map(({ name, transport }) => {
        const [field, value] = "command" in transport ? ["command", transport.command] : ["url", transport.url];
        return `${JSON.stringify(name)}={${field}=${JSON.stringify(value)},enabled=false}`;
      }).join(",")}}`],
    } : {}),
  };
}

/**
 * The SDK's own client, built with {@link codexClientOptions} once Codex has
 * said which MCP servers its settings name. Asked once per server process, on
 * the first run: a server added to your settings later stays on until restart.
 * A run stopped while the list is still coming stops then; the list goes on
 * for the next run.
 */
export function codexClient(
  listMcpServers: (env: Record<string, string>) => Promise<readonly CodexMcpServer[]> = userMcpServers,
): ResolveCodexClient {
  let resolver: Promise<ResolveCodexClient> | undefined;
  return async (ctx) => {
    resolver ??= listMcpServers(codexEnv()).then(
      (names) => createDefaultResolveCodexClient(codexClientOptions(process.env, names)),
      (error: unknown) => {
        // Not kept: the next run asks again. This one starts with whatever
        // servers Codex has, and the session says so, so it is never silent.
        resolver = undefined;
        ctx.emit.status(
          `Codex's MCP servers could not be listed, so this run may start the ones your Codex settings name: ${error instanceof Error ? error.message : String(error)}`,
          { transient: false },
        );
        return createDefaultResolveCodexClient(codexClientOptions(process.env));
      },
    );
    const stopped = ctx.signal;
    if (stopped === undefined) return (await resolver)(ctx);
    let onAbort: (() => void) | undefined;
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(new CodexAgentAbortedError(null));
      if (stopped.aborted) onAbort();
      else stopped.addEventListener("abort", onAbort, { once: true });
    });
    try {
      return (await Promise.race([resolver, aborted]))(ctx);
    } finally {
      stopped.removeEventListener("abort", onAbort!);
    }
  };
}

/** Test seams for the block: a stand-in for the Codex SDK. */
export interface CodexSeams {
  /** Replaces the SDK (and the scripted one test mode picks). */
  readonly resolveCodexClient?: ResolveCodexClient;
}

/** The Codex block's options, built from the session flow's feeds. */
export function codexBlockOptions(feeds: HarnessFeeds, seams: CodexSeams = {}): CodexAgentOptions {
  return {
    cwd: feeds.cwd,
    resume: feeds.resume,
    onSession: feeds.onSession,
    model: feeds.model,
    thread: codexThreadOptions(),
    resolveCodexClient: seams.resolveCodexClient ?? (codexIsScripted() ? scriptedCodex() : codexClient()),
    name: "codex",
  };
}

/**
 * The Codex block, built from the session flow's feeds.
 *
 * Codex's handle is core's plus its own fields, and a block's hooks take its
 * output as a parameter, so the extended block isn't assignable to core's
 * neutral `HarnessBlock` (core's own note on that type). The other modes cast
 * the same way.
 */
export function codexBlock(feeds: HarnessFeeds, seams: CodexSeams = {}): HarnessBlock {
  return codexAgent(codexBlockOptions(feeds, seams)) as unknown as HarnessBlock;
}

/** Codex mode's session flow. `seams` is for tests. */
export function codexSessionFlow(seams: CodexSeams = {}) {
  return harnessSessionFlow({
    kind: CODEX_SESSION,
    defaultModel: CODEX_DEFAULT_MODEL,
    agent: (feeds) => codexBlock(feeds, seams),
  });
}

/** What the mode's check asks of the host. Each a seam for tests. */
export interface CodexHostChecks {
  /** Which `@openai/codex-sdk` is installed beside the Codex package. */
  readonly sdk: InstalledSdkVersionReader;
  /** Make the worktree root and return it, or throw why it can't be made. */
  readonly makeRoot: (repository: string) => string;
  /** Whether Codex's own `codex login status` succeeds over `env`. No run. */
  readonly loggedIn: (env: Record<string, string>) => Promise<boolean>;
}

/** Run the Codex program with `args` over `env`, the way the SDK would start it. */
async function runCodex(args: readonly string[], env: Record<string, string>, cwd?: string) {
  const program = await findCodexProgram(env);
  const PATH = [...program.pathDirs, env.PATH ?? ""].filter((dir) => dir !== "").join(delimiter);
  return spawnSync(program.path, args, {
    // Next types `NODE_ENV` as always set; this process deliberately gets only `env`.
    env: { ...env, PATH } as Record<string, string> as NodeJS.ProcessEnv,
    ...(cwd !== undefined ? { cwd } : {}),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
}

/** The last line of what a failed Codex command said, or how it ended. */
function failureOf(result: ReturnType<typeof spawnSync>): string {
  if (result.error !== undefined) return result.error.message;
  const said = `${String(result.stderr ?? "")}\n${String(result.stdout ?? "")}`
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("WARNING:"));
  if (said.length > 0) return said.at(-1)!;
  return result.signal !== null ? `it was ended by ${result.signal}` : `it exited with code ${String(result.status)}`;
}

/**
 * The MCP servers Codex's settings name, as Codex itself lists them
 * (`codex mcp list --json`) over `env`. Throws when Codex can't say.
 */
export async function userMcpServers(env: Record<string, string>): Promise<readonly CodexMcpServer[]> {
  // Not `runCodex`: listing asks each server how it signs in, and this runs
  // on a turn, where a blocking wait would stall every other request.
  const program = await findCodexProgram(env);
  const PATH = [...program.pathDirs, env.PATH ?? ""].filter((dir) => dir !== "").join(delimiter);
  const stdout = await new Promise<string>((resolve, reject) =>
    execFile(
      program.path,
      ["mcp", "list", "--json"],
      { env: { ...env, PATH } as Record<string, string> as NodeJS.ProcessEnv, encoding: "utf8", timeout: 30_000 },
      (error, out) => (error ? reject(error) : resolve(out)),
    ),
  );
  const listed = JSON.parse(stdout) as unknown;
  if (!Array.isArray(listed)) throw new Error("`codex mcp list --json` did not print a list");
  return listed.map((server: { name?: unknown; transport?: { type?: unknown; command?: unknown; url?: unknown } }) => {
    if (typeof server?.name !== "string") throw new Error("`codex mcp list --json` returned a server without a name");
    if (server.transport?.type === "stdio" && typeof server.transport.command === "string") {
      return { name: server.name, transport: { command: server.transport.command } };
    }
    if (server.transport?.type === "streamable_http" && typeof server.transport.url === "string") {
      return { name: server.name, transport: { url: server.transport.url } };
    }
    throw new Error(`Codex did not list a supported transport for MCP server ${server.name}`);
  });
}

/**
 * How Codex is signed in over `env`: a `CODEX_API_KEY` there signs a run in
 * with that key; otherwise Codex's own `codex login status` says which.
 */
export async function codexSignIn(env: Record<string, string>): Promise<CodexSignIn> {
  if ((env.CODEX_API_KEY ?? "") !== "") return "api-key";
  const result = await runCodex(["login", "status"], env);
  if (result.status !== 0) return "unknown";
  const said = `${String(result.stdout ?? "")}\n${String(result.stderr ?? "")}`;
  if (/using ChatGPT/i.test(said)) return "chatgpt";
  if (/API key/i.test(said)) return "api-key";
  return "unknown";
}

/** The host's own answers. */
export const HOST_CHECKS: CodexHostChecks = {
  sdk: readInstalledCodexSdkVersion,
  makeRoot: (repository) => {
    const root = worktreeRoot(repository);
    mkdirSync(root, { recursive: true });
    return root;
  },
  loggedIn: async (env) => (await runCodex(["login", "status"], env)).status === 0,
};

/**
 * Codex mode's own check, for the gate's mode-check slot: the pinned Codex SDK
 * is installed (the Codex package's own version refusal is the reason
 * otherwise), the worktree root can be made, and Codex is signed in over the
 * run's environment. The first that fails is the reason. Nothing is asked
 * about a sandbox: Kitchen Sink runs Codex with its sandbox off (see the
 * header).
 *
 * The block itself is built only once the mode is available, so another SDK
 * version is a reason here and never a crash at server start.
 */
export function codexModeCheck(checks: CodexHostChecks = HOST_CHECKS): ModeCheck {
  return async ({ repository }): Promise<ModeAvailability> => {
    if (codexIsScripted()) return { available: true };
    if (checks.sdk().kind === "absent") {
      return { available: false, reason: `The Codex SDK is not installed. Install @openai/codex-sdk ${TESTED_SDK_VERSION}, then restart.` };
    }
    try {
      // The gate `codexAgent` runs when it is built: it names both versions.
      assertTestedSdkVersion(checks.sdk);
    } catch (error) {
      return { available: false, reason: error instanceof Error ? error.message : String(error) };
    }
    let root: string;
    try {
      root = checks.makeRoot(repository);
    } catch (error) {
      return {
        available: false,
        reason: `The folder for session worktrees can't be made: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const env = codexEnv();
    // A key in the run's environment signs a run in, though `login status` says otherwise.
    if ((env.CODEX_API_KEY ?? "") === "" && !(await checks.loggedIn(env))) {
      return {
        available: false,
        reason: "Codex is not signed in on this host (`codex login status` fails and there is no CODEX_API_KEY in the run's environment). Sign in with `codex login`, then restart.",
      };
    }
    return { available: true };
  };
}
