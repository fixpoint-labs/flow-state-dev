/**
 * `projectMcpTools()`: the MCP servers a coding run on a project gets, as
 * tools relayed through FSD's own connection.
 *
 * Three parties each decide one thing. The host decides which servers exist
 * and where they live (`servers`: a name, an HTTP address, and optionally the
 * environment variable that seeds the operator's key). A project names some
 * of them (`mcpServers` on its row). Each user sets their own key
 * (`mcp-credentials/*`, at user scope), and a run uses its owner's.
 *
 * Per run, the resolver finds the run's project and owner with the same
 * reader `projectWorkspace()` uses (`run-project.ts`), so the servers and the
 * checkout always come from one read of stored, server-written data, never a
 * task's payload or a prompt (BP-031). It then connects to each named server
 * with the owner's key through one `createMcpManager` (FSD's only MCP client),
 * and answers each connected server as its tools: a name, a description, the
 * input JSON Schema and a `call` that goes through that connection. The shape
 * is `claudeCodeAgent`'s `mcpTools` answer, matched structurally.
 *
 * **The key is never handed to the run.** It goes into the connection's
 * headers and nowhere else: not in the answer, not in a notice, not in a log,
 * not in a failed call's message (the server's address is taken out of it too).
 *
 * **A server it can't have is skipped and said.** A name the host no longer
 * offers, an owner with no key, or a connection that fails each leaves that
 * server out, and the run's session gets a status line naming the server and
 * why, never its address or a header. A refused lookup answers no servers and
 * says nothing: the run source refuses the same run, before anything runs.
 *
 * Read fresh on every call, so a list or a key changed between two attempts
 * applies to the second.
 */

import type { LooseBlockContext } from "@flow-state-dev/core";
import type { HarnessCallbackContext } from "@flow-state-dev/core/types";
import { createMcpManager, redactSecrets, type MCPClient, type MCPServerConfig } from "@flow-state-dev/tools/mcp";
import { isMcpServerName } from "./mcp-server-name";
import { MCP_CREDENTIALS_RESOURCE, type McpCredential } from "./mcp-credentials";
import { collectionAt } from "./project-address";
import { runProjectOf } from "./run-project";

/** One MCP server a host offers: its HTTP address, and the variable that seeds the operator's key. */
export interface ProjectMcpServerConfig {
  /** The server's Streamable HTTP address, `https://…` (or `http://…`). */
  url: string;
  /**
   * An environment variable holding a key for the host's operator identity,
   * read only for that user and only while they have no stored key. For runs
   * nobody is at the keyboard for (a goal check, CI).
   */
  seedEnv?: string;
}

/** The servers a host offers, by name. */
export type ProjectMcpServers = Readonly<Record<string, ProjectMcpServerConfig>>;

/** One tool relayed to a run: what an in-process MCP server lists and calls. */
export interface RelayedMcpTool {
  /** The tool's name on its server, unprefixed (`get_issue`). */
  name: string;
  description: string;
  /** The tool's input JSON Schema, as the server published it. */
  inputSchema: Record<string, unknown>;
  /** Call it through FSD's connection; resolves to the server's answer. */
  call(args: Record<string, unknown>, options: { signal?: AbortSignal }): Promise<unknown>;
}

/** One relayed server: its tools, and how to close its connection when the run ends. */
export interface RelayedMcpServer {
  tools: RelayedMcpTool[];
  close(): Promise<void>;
}

/** Options for {@link projectMcpTools}. */
export interface ProjectMcpToolsOptions {
  /** The host's operator user id: the one user a server's `seedEnv` stands in for. */
  operator?: string;
  /** Where `seedEnv` is read from, on each call. Default `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /** Test-only: how a server's client is made. Default: the tools manager's own. */
  _createClient?: (config: MCPServerConfig) => Promise<MCPClient>;
}

/**
 * The resolver a coding harness calls once per run, with that run's context
 * only, and what a harness that takes no relayed tools asks instead.
 */
export interface ProjectMcpToolsResolver {
  (ctx: HarnessCallbackContext): Promise<Record<string, RelayedMcpServer>>;
  /**
   * The servers the run's project names, without reading a key or
   * connecting: for a harness that can't take relayed tools, to say in the
   * run's session which it runs without. `[]` when the lookup refuses.
   */
  named(ctx: HarnessCallbackContext): Promise<string[]>;
}

/** An environment variable's name: upper-case letters, digits and underscores. */
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/;

/**
 * Build the resolver for a coding harness's per-run MCP tools.
 *
 * The block that calls it must hold `projectWorkspaceCapability` and
 * `mcpCredentialsCapability`: the project read and the keys.
 *
 * @param servers The servers the host offers, by name.
 * @param options `operator`, the user `seedEnv` stands in for.
 * @returns A resolver answering `{ [name]: { tools, close } }` for one run,
 *   and its `named`, the servers a run's project names.
 * @throws When built, for a name that isn't a bare name, an address that
 *   isn't an HTTP(S) URL, or a `seedEnv` that isn't a variable name. The
 *   message names the entry, never the address.
 * @example
 *   claudeCodeAgent({
 *     uses: [projectWorkspaceCapability, mcpCredentialsCapability],
 *     mcpTools: projectMcpTools({ linear: { url: "https://mcp.linear.app/mcp" } }, { operator: "u_ops" }),
 *   });
 */
export function projectMcpTools(servers: ProjectMcpServers, options: ProjectMcpToolsOptions = {}): ProjectMcpToolsResolver {
  checkProjectMcpServers(servers);
  const env = () => options.env ?? process.env;
  const resolve = async (ctx: HarnessCallbackContext): Promise<Record<string, RelayedMcpServer>> => {
    const found = await runProjectOf(ctx as unknown as LooseBlockContext);
    if (found.kind === "refused") return {};
    const named = found.project.mcpServers ?? [];
    if (named.length === 0) return {};

    const say = (message: string) => ctx.emit.status(message, { transient: false });
    const keys = collectionAt<McpCredential>(ctx, MCP_CREDENTIALS_RESOURCE, missingKeys);
    const configs: MCPServerConfig[] = [];
    const secrets: string[] = [];
    for (const name of named) {
      const entry = Object.hasOwn(servers, name) ? servers[name] : undefined;
      if (entry === undefined) {
        say(`This run goes without MCP server "${name}": the project names it, and this server no longer offers it.`);
        continue;
      }
      const stored = (await keys.getOptional(name))?.state.value;
      const seeded = found.owner === options.operator && entry.seedEnv !== undefined ? env()[entry.seedEnv] : undefined;
      const key = stored !== undefined && stored !== "" ? stored : seeded !== undefined && seeded !== "" ? seeded : undefined;
      if (key === undefined) {
        say(
          `This run goes without MCP server "${name}": ${found.owner}'s key for it isn't set. ` +
            `Set it in Settings, and the next run gets it.`
        );
        continue;
      }
      secrets.push(key);
      configs.push({ name, transport: { type: "http", url: entry.url, headers: { Authorization: `Bearer ${key}` } } });
    }
    if (configs.length === 0) return {};

    const manager = createMcpManager({
      servers: configs,
      ...(options._createClient === undefined ? {} : { _createClient: options._createClient })
    });
    await manager.getTools();
    const close = () => manager.close();
    const answer: Record<string, RelayedMcpServer> = {};
    for (const server of manager.getCatalog().servers) {
      if (server.status !== "connected") {
        const url = servers[server.name]?.url;
        say(`This run goes without MCP server "${server.name}": FSD couldn't connect to it (${scrub(server.error, [url, ...secrets])}).`);
        continue;
      }
      const hidden = [servers[server.name]?.url, ...secrets];
      answer[server.name] = {
        tools: server.tools.map((tool) => ({
          name: tool.originalName,
          description: tool.description,
          inputSchema: tool.jsonSchema,
          // A failed call's message reaches the run and its session: the address and keys are taken out first.
          call: (args, { signal }) =>
            manager.callTool(tool.name, args, signal === undefined ? {} : { signal }).catch((error: unknown) => {
              throw new Error(scrub(error instanceof Error ? error.message : String(error), hidden));
            })
        })),
        close
      };
    }
    if (Object.keys(answer).length === 0) await close();
    return answer;
  };
  return Object.assign(resolve, {
    named: async (ctx: HarnessCallbackContext) => {
      const found = await runProjectOf(ctx as unknown as LooseBlockContext);
      return found.kind === "refused" ? [] : [...(found.project.mcpServers ?? [])];
    }
  });
}

/** Refuse a host's server config that no run could use, naming the entry, never the address. */
function checkProjectMcpServers(servers: ProjectMcpServers): void {
  for (const [name, entry] of Object.entries(servers)) {
    const at = `projectMcpTools: server "${isMcpServerName(name) ? name : "(invalid name)"}"`;
    if (!isMcpServerName(name)) {
      throw new Error(`${at}: a server is named by lowercase letters, digits and hyphens, such as "linear".`);
    }
    let url: URL | undefined;
    try {
      url = new URL(entry.url);
    } catch {
      url = undefined;
    }
    if (url === undefined || (url.protocol !== "https:" && url.protocol !== "http:") || url.username !== "" || url.password !== "") {
      throw new Error(`${at}: its url must be an http(s) address with no user or password in it.`);
    }
    if (entry.seedEnv !== undefined && !ENV_NAME.test(entry.seedEnv)) {
      throw new Error(`${at}: its seedEnv must be an environment variable's name, such as LINEAR_MCP_API_KEY.`);
    }
  }
}

/** A failure's reason, connecting or calling, with the address and any key taken out. */
function scrub(reason: string | undefined, secrets: readonly (string | undefined)[]): string {
  return redactSecrets(reason ?? "no reason given", secrets);
}

/** The block resolving a run's tools lacks the keys: name the capability that installs them. */
const missingKeys = (accessor: string) =>
  `projectMcpTools: the block resolving a run's MCP tools does not hold "${accessor}". ` +
  `Pass mcpCredentialsCapability (and projectWorkspaceCapability) on its \`uses\`.`;
