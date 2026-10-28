/**
 * A local MCP server that stands in for Linear: it answers the calls a run
 * files an issue with, and records every one.
 *
 * Streamable HTTP at `/mcp`, answered with plain JSON (no event stream), which
 * is what the MCP client FSD relays through accepts. It requires the bearer
 * it was started with, so a call that reached it went through the Lab's
 * connection with the owner's key.
 *
 * Tools: `create_issue`, `get_issue`, `create_comment`, `list_teams`.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";

/** One recorded tool call. */
export interface TrackerCall {
  tool: string;
  args: Record<string, unknown>;
  at: number;
}

/** One issue the tracker holds. */
export interface TrackerIssue {
  id: string;
  identifier: string;
  url: string;
  title: string;
  description: string;
  labels: string[];
  priority: number | null;
  state: "started" | "completed";
  comments: string[];
}

const TOOLS = [
  {
    name: "create_issue",
    description: "Create a new issue in the tracker. Returns its id, identifier and url.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string", description: "Markdown body" },
        team: { type: "string" },
        labels: { type: "array", items: { type: "string" }, description: "Label names" },
        priority: { type: "number", description: "0 none, 1 urgent, 2 high, 3 medium, 4 low" },
      },
      required: ["title", "description"],
    },
  },
  {
    name: "get_issue",
    description: "Read one issue by id or identifier: its title, description, labels, priority and state.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
  {
    name: "create_comment",
    description: "Add a comment to an issue.",
    inputSchema: {
      type: "object",
      properties: { issueId: { type: "string" }, body: { type: "string" } },
      required: ["issueId", "body"],
    },
  },
  {
    name: "list_teams",
    description: "List the tracker's teams.",
    inputSchema: { type: "object", properties: {} },
  },
];

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Start the tracker on a free loopback port.
 *
 * @param key The bearer every request must carry.
 */
export async function startRecordingTracker(key: string): Promise<{
  url: string;
  calls: TrackerCall[];
  issues: TrackerIssue[];
  /** Requests turned away for a missing or wrong bearer. */
  refused: () => number;
  close(): Promise<void>;
}> {
  const calls: TrackerCall[] = [];
  const issues: TrackerIssue[] = [];
  let refused = 0;

  const find = (id: unknown) => issues.find((issue) => issue.id === id || issue.identifier === id);

  const call = (tool: string, args: Record<string, unknown>): unknown => {
    calls.push({ tool, args, at: Date.now() });
    switch (tool) {
      case "create_issue": {
        const n = issues.length + 1;
        const issue: TrackerIssue = {
          id: `issue-${n}`,
          identifier: `REC-${n}`,
          url: `https://tracker.invalid/REC-${n}`,
          title: String(args.title ?? ""),
          description: String(args.description ?? ""),
          labels: Array.isArray(args.labels) ? args.labels.map(String) : [],
          priority: typeof args.priority === "number" ? args.priority : null,
          state: "started",
          comments: [],
        };
        issues.push(issue);
        return { id: issue.id, identifier: issue.identifier, url: issue.url };
      }
      case "get_issue": {
        const issue = find(args.id);
        if (issue === undefined) throw new Error(`no issue ${String(args.id)}`);
        return { ...issue, state: { type: issue.state } };
      }
      case "create_comment": {
        const issue = find(args.issueId);
        if (issue === undefined) throw new Error(`no issue ${String(args.issueId)}`);
        issue.comments.push(String(args.body ?? ""));
        return { ok: true };
      }
      case "list_teams":
        return [{ id: "team-eng", name: "Engineering", key: "REC" }];
      default:
        throw new Error(`no tool ${tool}`);
    }
  };

  const answer = (message: { id?: unknown; method?: string; params?: any }): unknown => {
    const reply = (result: unknown) => ({ jsonrpc: "2.0", id: message.id, result });
    switch (message.method) {
      case "initialize":
        return reply({
          protocolVersion: message.params?.protocolVersion ?? "2025-03-26",
          capabilities: { tools: {} },
          serverInfo: { name: "recording-tracker", version: "1.0.0" },
        });
      case "ping":
        return reply({});
      case "tools/list":
        return reply({ tools: TOOLS });
      case "tools/call":
        try {
          const result = call(String(message.params?.name), (message.params?.arguments ?? {}) as Record<string, unknown>);
          return reply({ content: [{ type: "text", text: JSON.stringify(result) }] });
        } catch (error) {
          return reply({ content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }], isError: true });
        }
      default:
        return { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: `no method ${String(message.method)}` } };
    }
  };

  const server: Server = createServer(async (request, response) => {
    if (request.headers.authorization !== `Bearer ${key}`) {
      refused += 1;
      response.writeHead(401).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(request.method === "DELETE" ? 200 : 405).end();
      return;
    }
    const parsed = JSON.parse(await bodyOf(request)) as unknown;
    const messages = (Array.isArray(parsed) ? parsed : [parsed]) as Array<{ id?: unknown; method?: string; params?: unknown }>;
    const replies = messages.filter((m) => m.id !== undefined).map(answer);
    if (replies.length === 0) {
      response.writeHead(202).end();
      return;
    }
    response.writeHead(200, { "content-type": "application/json", "mcp-session-id": "recording-tracker" });
    response.end(JSON.stringify(Array.isArray(parsed) ? replies : replies[0]));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    calls,
    issues,
    refused: () => refused,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
