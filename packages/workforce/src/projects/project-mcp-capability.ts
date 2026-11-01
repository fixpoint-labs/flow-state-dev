/**
 * `projectMcpCapability()`: an agent or coordinator worker gets the MCP
 * servers its conversation's project names, as tools on its model, keyed with
 * the user it is talking to.
 *
 * The coding run's relay (`projectMcpTools`) and this capability share one
 * resolution (`planProjectMcp` and `connectProjectMcp`): the project and its
 * owner come from `runProjectOf`, so from the session's server-written fields
 * and stored rows only, never from a tool argument or a prompt (BP-031); the
 * key is the owner's own (`mcp-credentials/*`), or the operator's `seedEnv`;
 * and the connection is FSD's one MCP client. A lead such as a project's
 * coordinator can then read the issue a user names ("implement FIX-2165")
 * from the tracker rather than guess at it.
 *
 * One preset, `tools`, off until a worker's own file picks it
 * (`capabilities: { projectMcp: [tools] }`). The tools are the servers' own,
 * named `mcp__<server>__<tool>`. `allow` narrows them: a read-only Linear is
 * the host's `linear` entry with its `seedEnv`, and an `allow` that keeps the
 * read tools.
 *
 * **Connections are kept, not opened per step.** A model's tools are resolved
 * before every step of every turn, so the connection for one project, owner
 * and set of keys is opened once and kept while it is used, then closed after
 * `idleMs` without a call or a resolve. A changed key or server list makes a
 * different entry, used from the next turn (the generator compiles a turn's
 * tool handlers once, so a turn already under way keeps the connection it
 * started with), and the old one closes when it goes idle. A server that failed to connect stays failed for that entry, so
 * a down server costs one attempt per idle window, not one per step.
 *
 * **A server it can't have is left out and said once per conversation**, as
 * a status naming the server and why, never its address or a key: each turn
 * resolves its tools again, and repeating the line on each would bury the
 * conversation. A conversation with no project, or a refused lookup, gets no
 * tools and hears nothing.
 *
 * **The key never reaches the model.** It is in the connection's headers
 * only; a failed call's message has the server's address and the key taken
 * out, as the coding relay's does. The keys collection is installed on the
 * worker's model block so the resolution can read it; it is not
 * `llmReadable`, so no resource tool lists or reads it.
 */

import { defineCapability, handler, type GeneratorTool, type LooseBlockContext } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { MCP_TOOL_META, type MCPClient, type MCPServerConfig, type MCPToolMeta } from "@flow-state-dev/tools/mcp";
import { z } from "zod";
import { mcpCredentialsCapability } from "./mcp-credentials";
import {
  checkProjectMcpServers,
  connectProjectMcp,
  planProjectMcp,
  type ProjectMcpConnection,
  type ProjectMcpPlan,
  type ProjectMcpServers
} from "./project-mcp-tools";
import { projectWorkspaceCapability } from "./project-workspace";

/** The capability's name, as a worker's file names it under `capabilities:`. */
export const PROJECT_MCP_CAPABILITY = "projectMcp";

/** How long a kept connection stays open without a call or a resolve, by default: five minutes. */
export const PROJECT_MCP_IDLE_MS = 5 * 60_000;

/** Options for {@link projectMcpCapability}. */
export interface ProjectMcpCapabilityOptions {
  /** The host's operator user id: the one user a server's `seedEnv` stands in for. */
  operator?: string;
  /** Where `seedEnv` is read from, on each resolve. Default `process.env`. */
  env?: Readonly<Record<string, string | undefined>>;
  /**
   * Which of a server's tools a worker gets, by server and the tool's own
   * name (`get_issue`). Default: all of them.
   *
   * @example (server, tool) => server !== "linear" || /^(get|list|search)_/.test(tool)
   */
  allow?: (server: string, tool: string) => boolean;
  /** How long a kept connection stays open without a call or a resolve. Default {@link PROJECT_MCP_IDLE_MS}. */
  idleMs?: number;
  /** Test-only: how a server's client is made. Default: the tools manager's own. */
  _createClient?: (config: MCPServerConfig) => Promise<MCPClient>;
}

/** One kept connection and the tools built over it. */
interface Kept {
  readonly connection: Promise<ProjectMcpConnection>;
  readonly tools: Promise<GeneratorTool[]>;
  /** Calls under way: a connection with one is never closed. */
  busy: number;
  timer?: ReturnType<typeof setTimeout>;
}

/** The most conversations whose notices are remembered, so each is said once. */
const TOLD_CONVERSATIONS = 1024;

/** The tools' input, before the server's own JSON Schema replaces it for the model. */
const passthrough = z.record(z.unknown());

/**
 * Build the capability that gives a worker its conversation's project MCP
 * servers as tools.
 *
 * @param servers The servers the host offers, by name: the same map
 *   `projectMcpTools` takes.
 * @param options `operator`, `allow`, `idleMs`.
 * @returns A capability named `projectMcp` with one preset, `tools`, off by
 *   default. Pass it on the worker flow's `uses` (`defineAgentWorkerFlow({ uses })`,
 *   or `defineCoordinatorFlow({ agent: { uses } })`).
 * @throws When built, for a server entry `projectMcpTools` refuses, or an
 *   `idleMs` that isn't a positive whole number.
 * @example
 *   defineCoordinatorFlow({
 *     installation,
 *     agent: { uses: [projectMcpCapability({ linear: { url: "https://mcp.linear.app/mcp", seedEnv: "LINEAR_API_KEY" } })] }
 *   });
 */
export function projectMcpCapability(servers: ProjectMcpServers, options: ProjectMcpCapabilityOptions = {}) {
  checkProjectMcpServers(servers, "projectMcpCapability");
  const idleMs = options.idleMs ?? PROJECT_MCP_IDLE_MS;
  if (!Number.isSafeInteger(idleMs) || idleMs <= 0) {
    throw new Error("projectMcpCapability: idleMs must be a positive whole number of milliseconds.");
  }
  const allow = options.allow ?? (() => true);
  const kept = new Map<string, Kept>();
  const told = new Map<string, Set<string>>();

  const idle = (key: string, entry: Kept) => {
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      if (entry.busy > 0) return idle(key, entry);
      if (kept.get(key) === entry) kept.delete(key);
      void entry.connection.then((connection) => connection.close()).catch(() => undefined);
    }, idleMs);
    // A kept connection never holds the process open on its own.
    (entry.timer as { unref?: () => void }).unref?.();
  };

  /** Say `message` in this conversation, once. */
  const say = (ctx: BlockContext, message: string) => {
    const conversation = ctx.session.identity.id;
    let heard = told.get(conversation);
    if (heard === undefined) {
      heard = new Set();
      told.set(conversation, heard);
      if (told.size > TOLD_CONVERSATIONS) told.delete(told.keys().next().value!);
    }
    if (heard.has(message)) return;
    heard.add(message);
    ctx.emit.status(message, { transient: false });
  };

  const open = (key: string, plan: ProjectMcpPlan): Kept => {
    const connection = connectProjectMcp(servers, plan, options._createClient);
    const entry: Kept = {
      connection,
      busy: 0,
      tools: connection.then((connected) =>
        connected.servers.flatMap((server) =>
          server.tools
            .filter((tool) => allow(server.name, tool.originalName))
            .map((tool) => {
              const block = handler({
                name: tool.name,
                description: tool.description,
                inputSchema: passthrough,
                execute: async (input: Record<string, unknown>, ctx) => {
                  entry.busy += 1;
                  try {
                    return await tool.call(input, { signal: ctx.signal });
                  } finally {
                    entry.busy -= 1;
                    idle(key, entry);
                  }
                }
              });
              // The server's own schema for the model, and the marker MCP filters read: as the manager's own tools.
              if (tool.inputSchema !== undefined) (block as { inputSchema: unknown }).inputSchema = tool.inputSchema;
              (block as unknown as Record<symbol, MCPToolMeta>)[MCP_TOOL_META] = {
                mcp: { server: server.name, originalName: tool.originalName }
              };
              return block as GeneratorTool;
            })
        )
      )
    };
    // A connection that failed outright is never kept: the next resolve tries again.
    connection.catch(() => {
      if (kept.get(key) === entry) kept.delete(key);
    });
    return entry;
  };

  const tools = async (given: unknown): Promise<GeneratorTool[]> => {
    const ctx = given as BlockContext;
    const plan = await planProjectMcp(servers, options, ctx as unknown as LooseBlockContext, missingKeys);
    if (plan === undefined) return [];
    for (const { name, why } of plan.skipped) {
      say(
        ctx,
        why === "not-offered"
          ? `This conversation goes without MCP server "${name}": the project names it, and this server no longer offers it.`
          : `This conversation goes without MCP server "${name}": ${plan.owner}'s key for it isn't set. ` +
              `Set it in Settings, and the next turn gets it.`
      );
    }
    if (plan.configs.length === 0) return [];

    const key = keyOf(plan);
    let entry = kept.get(key);
    if (entry === undefined) {
      entry = open(key, plan);
      kept.set(key, entry);
    }
    idle(key, entry);
    const connection = await entry.connection;
    for (const { name, reason } of connection.failed) {
      say(ctx, `This conversation goes without MCP server "${name}": FSD couldn't connect to it (${reason}).`);
    }
    return entry.tools;
  };

  return defineCapability({
    name: PROJECT_MCP_CAPABILITY,
    uses: [projectWorkspaceCapability, mcpCredentialsCapability],
    presets: {
      tools: { tools: tools as never },
      default: []
    }
  });
}

/**
 * The kept connection's key: the project, the owner and each server with its
 * `Authorization` header, so a changed key or list opens a new connection and
 * two users never share one. In memory only, beside the connection that
 * already holds the same header; never logged or emitted.
 */
function keyOf(plan: ProjectMcpPlan): string {
  const servers = plan.configs.map((config) => [config.name, (config.transport as { headers?: Record<string, string> }).headers?.Authorization ?? ""]);
  return JSON.stringify([plan.visibility, plan.project.id, plan.owner, servers]);
}

/** The worker's model block lacks the keys: name the capability that installs them. */
const missingKeys = (accessor: string) =>
  `projectMcpCapability: the worker's model block does not hold "${accessor}". ` +
  `Its own uses install it; was the capability passed on the worker flow's \`uses\`?`;
