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
 * overrides each of those (the session's model, or Codex's own default for a
 * session stored before models could be picked, and `codexClientOptions`).
 * Sign-in, history and every other setting still come from Codex's home.
 *
 * When the operator trusts the repository (`lib/harness-trust.ts`), the MCP
 * servers your Codex settings name stay on, and the run is handed the keys the
 * operator named. Codex reads the repository's `AGENTS.md` either way.
 *
 * Under `KITCHEN_SINK_TEST_MODE=1` the SDK is replaced by the scripted Codex
 * (`lib/scripted-codex.ts`) and the check passes, unless
 * `KITCHEN_SINK_REAL_HARNESS=1` asks for the real one, which the goal check
 * does so its controls apply to a real run.
 */
import { execFile } from "node:child_process";
import { mkdirSync } from "node:fs";
import { delimiter } from "node:path";
import { harnessEnv } from "@flow-state-dev/core";
import {
  assertTestedSdkVersion,
  CODEX_PASS,
  CodexAgentAbortedError,
  codexAgent,
  createDefaultResolveCodexClient,
  findCodexProgram,
  listCodexModels,
  probeCodexAccount,
  readInstalledCodexSdkVersion,
  TESTED_SDK_VERSION,
  type CodexAccountProbe,
  type CodexAgentOptions,
  type CodexClientOptions,
  type CodexModelList,
  type CodexThreadOptions,
  type InstalledSdkVersionReader,
  type ResolveCodexClient,
} from "@flow-state-dev/codex";

import { goalControl } from "./goal-control";
import { harnessTrust, type RepoLine } from "./harness-trust";
import type { HarnessTrust } from "./harness-workspace";
import type { HarnessSessionFeeds } from "@flow-state-dev/harness-manager";
import type { HarnessBlock } from "@flow-state-dev/core/types";
import { kitchenSinkHarnessFlow } from "./harness-session-flow";
import { worktreeRoot } from "./harness-worktree";
import type { ModeAvailability, ModeCheck } from "./harness-gate";
import type { ModelChoices } from "./harness-models";
import { flowKindOf, modeById } from "./modes";
import { scriptedCodex } from "./scripted-codex";

/** Codex mode's flow kind, from the mode list: the rail lists its sessions by it. */
export const CODEX_SESSION = flowKindOf(modeById("codex"));

/** The model the scripted Codex offers. It runs no model; the id only travels. */
const SCRIPTED_CODEX_MODEL = "scripted-codex";

/**
 * Codex's own list: the models its picker shows for the sign-in a run gets,
 * its default preselected. A model the account can't run is one Codex leaves
 * out. When the list can't be read, nothing is offered and New session can't
 * start, as in Claude Code mode: Kitchen Sink keeps no Codex model name of its
 * own. The next load asks again. `list` is a seam for tests.
 */
export async function codexModelChoices(
  list: (env: Record<string, string>) => Promise<CodexModelList> = (env) => listCodexModels({ env }),
): Promise<ModelChoices> {
  if (codexIsScripted()) {
    return { models: [{ id: SCRIPTED_CODEX_MODEL, label: "Scripted Codex" }], defaultId: SCRIPTED_CODEX_MODEL, reason: null, fallbackId: null };
  }
  const found = await list(codexEnv());
  if (found.status === "failed") {
    return {
      models: [],
      defaultId: null,
      reason: `Codex's model list can't be read (${found.reason}), so a new session can't name its model. Reload to try again.`,
      fallbackId: null,
    };
  }
  const preselected = found.models.find((model) => model.isDefault) ?? found.models[0]!;
  return { models: found.models.map(({ id, label }) => ({ id, label })), defaultId: preselected.id, reason: null, fallbackId: null };
}

/**
 * The environment Codex's process gets, and the one its sign-in and sandbox are
 * checked over: the Codex package's own pass-list, and the keys a trusting
 * operator named.
 */
export function codexEnv(
  env: Record<string, string | undefined> = process.env,
  trust: HarnessTrust = harnessTrust(),
): Record<string, string> {
  return harnessEnv({ pass: [...CODEX_PASS, ...trust.pass], env });
}

/** The header's line for a Codex session: `AGENTS.md` always, and whether your MCP servers stay on. */
export function codexRepoLine(trust: HarnessTrust = harnessTrust()): RepoLine {
  return {
    conventions: trust.trusted ? "AGENTS.md, with your Codex MCP servers on" : "AGENTS.md only, your Codex MCP servers off",
    keys: trust.pass,
  };
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
 * Trusted, no server is turned off: `mcpServers` is not read.
 *
 * @param mcpServers The MCP servers Codex's settings name (`userMcpServers`).
 */
export function codexClientOptions(
  env: Record<string, string | undefined> = process.env,
  mcpServers: readonly CodexMcpServer[] = [],
  trust: HarnessTrust = harnessTrust(),
): CodexClientOptions {
  if (trust.trusted) mcpServers = [];
  return {
    env: codexEnv(env, trust),
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
 * for the next run. Trusted, nothing is listed: no server is turned off.
 */
export function codexClient(
  listMcpServers: (env: Record<string, string>) => Promise<readonly CodexMcpServer[]> = userMcpServers,
  trust: HarnessTrust = harnessTrust(),
): ResolveCodexClient {
  let resolver: Promise<ResolveCodexClient> | undefined;
  return async (ctx) => {
    if (trust.trusted) resolver ??= Promise.resolve(createDefaultResolveCodexClient(codexClientOptions(process.env, [], trust)));
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
  /** Replaces Codex's model list, read for a session that names no model. */
  readonly listCodexModels?: (env: Record<string, string>) => Promise<CodexModelList>;
}

/** The Codex block's options, built from the session flow's feeds. */
export function codexBlockOptions(feeds: HarnessSessionFeeds, seams: CodexSeams = {}): CodexAgentOptions {
  return {
    cwd: feeds.cwd,
    resume: feeds.resume,
    onSession: feeds.onSession,
    // A session stored before models could be picked names none; it runs
    // Codex's own default, never the model your Codex settings name.
    model: async (ctx) => (await feeds.model(ctx)) ?? (await codexDefaultModel(seams)),
    thread: codexThreadOptions(),
    resolveCodexClient: seams.resolveCodexClient ?? (codexIsScripted() ? scriptedCodex() : codexClient()),
    // Records no pull request in the turn, so goal leg **r1** can be seen to fail.
    recordPullRequests: goalControl() !== "no-pr-record",
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
export function codexBlock(feeds: HarnessSessionFeeds, seams: CodexSeams = {}): HarnessBlock {
  return codexAgent(codexBlockOptions(feeds, seams)) as unknown as HarnessBlock;
}

/**
 * The model Codex runs when none is named, from its own list.
 *
 * @throws When the list can't be read: the run stops before it starts, since
 *   a run that names no model would take the one your Codex settings name.
 */
async function codexDefaultModel(seams: CodexSeams): Promise<string> {
  if (codexIsScripted() && seams.listCodexModels === undefined) return SCRIPTED_CODEX_MODEL;
  const list = seams.listCodexModels ?? ((env) => listCodexModels({ env }));
  const found = await list(codexEnv());
  if (found.status === "failed") {
    throw new Error(`Codex's model list can't be read (${found.reason}), so this session can't name the model it runs. Try the turn again.`);
  }
  return (found.models.find((model) => model.isDefault) ?? found.models[0]!).id;
}

/** Codex mode's session flow. `seams` is for tests. */
export function codexSessionFlow(seams: CodexSeams = {}) {
  // No `defaultModel`: the block fills in Codex's own default (`codexBlockOptions`).
  return kitchenSinkHarnessFlow({ kind: CODEX_SESSION, agent: (feeds) => codexBlock(feeds, seams) });
}

/** What the mode's check asks of the host. Each a seam for tests. */
export interface CodexHostChecks {
  /** Which `@openai/codex-sdk` is installed beside the Codex package. */
  readonly sdk: InstalledSdkVersionReader;
  /** Make the worktree root and return it, or throw why it can't be made. */
  readonly makeRoot: (repository: string) => string;
  /** The Codex package's answer about its sign-in, over the run's own environment. No run. */
  readonly probe: (env: Record<string, string>) => Promise<CodexAccountProbe>;
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

/** The host's own answers. */
export const HOST_CHECKS: CodexHostChecks = {
  sdk: readInstalledCodexSdkVersion,
  makeRoot: (repository) => {
    const root = worktreeRoot(repository);
    mkdirSync(root, { recursive: true });
    return root;
  },
  // A loaded host can take a while to start Codex: give it longer than the package's default.
  // Deliberate: 30 s keeps the limit this check had before it moved, for cold hosts, so it is longer than Claude Code mode's 10 s probe.
  probe: (env) => probeCodexAccount({ env, timeoutMs: 30_000 }),
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
    // A key in the run's environment counts, though `codex login status` says otherwise.
    const account = await checks.probe(codexEnv());
    if (account.status === "sdk-missing") return { available: false, reason: `The Codex SDK is not installed. ${account.reason}` };
    if (account.status === "none") {
      return {
        available: false,
        reason:
          account.unanswered === true
            ? `${account.reason}, so its sign-in is unknown. Restart the server to ask again.`
            : `Codex is not signed in on this host (\`codex login status\`: ${account.reason}, and there is no CODEX_API_KEY in the run's environment). Sign in with \`codex login\`, then restart.`,
      };
    }
    return { available: true };
  };
}
