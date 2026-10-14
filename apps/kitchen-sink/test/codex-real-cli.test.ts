/**
 * What a Codex mode run can see and touch, on the real Codex program
 * (`specs/issues/FIX-1916/PLAN.md` V5; BUSINESS-RULES BR-10, BR-12).
 *
 * The real session flow, the real Codex block and the real `@openai/codex-sdk`,
 * which starts the real `codex` program with Codex mode's own client options.
 * Only the model is scripted: a Responses endpoint on 127.0.0.1 that answers
 * the first request with one shell command and the next with a reply. No key,
 * no network, and the run's Codex home is a fresh temporary directory.
 *
 * The command reads a variable set on the server but left off the allowlist,
 * and tries to write in the worktree, its `.git` pointer, the repository's git
 * data, a folder beside the worktree, and `/tmp`. Only the worktree may change.
 *
 * Skipped, with Codex's own reason, on a host where Codex's sandbox can't run
 * (Codex mode is unavailable there, BR-18).
 *
 * Red states produced before this was trusted:
 *   - leave `client.env` unset: the command prints the planted value.
 *   - leave `/tmp` on the sandbox's writable list: the repository here sits under
 *     the system temp folder, so the writes to its git data and beside the worktree land.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createDefaultResolveCodexClient } from "@flow-state-dev/codex";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { testFlow } from "@flow-state-dev/testing";

import { HOST_CHECKS, codexClientOptions, codexEnv, codexSessionFlow, userMcpServers } from "@/lib/codex-mode";
import type { HarnessSessionState } from "@/lib/harness-turn";
import { worktreeRoot } from "@/lib/harness-worktree";

const PLANTED = "do-not-hand-this-over";

let scratch: string;
let repo: string;
let server: Server;
let baseUrl: string;
/** What the program answered each tool call with, as the model received it. */
const toolOutputs: string[] = [];
/** Each request the program sent the model endpoint. */
const requestsSeen: Array<{ model?: unknown; service_tier?: unknown }> = [];
/** How many requests reached the MCP server the settings name (served beside the model, at `/mcp`). */
let mcpHits = 0;
let command = "";
let sandboxFails: string | null = null;

beforeAll(async () => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "ks-codex-real-")));
  repo = join(scratch, "repo");
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  writeFileSync(join(repo, "README.md"), "hello\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "init"]);
  const home = join(scratch, "home");
  mkdirSync(home);

  vi.stubEnv("KITCHEN_SINK_HARNESS_WORKSPACE", repo);
  vi.stubEnv("XDG_STATE_HOME", join(scratch, "state"));
  vi.stubEnv("KITCHEN_SINK_TEST_MODE", "");
  vi.stubEnv("GOAL_CONTROL", "");
  vi.stubEnv("HOME", home);
  vi.stubEnv("CODEX_HOME", home);
  vi.stubEnv("KITCHEN_SINK_PLANTED_SECRET", PLANTED);

  const root = worktreeRoot(repo);
  mkdirSync(root, { recursive: true });
  sandboxFails = await HOST_CHECKS.sandboxFails(root, codexEnv());

  command = [
    "echo planted=[$KITCHEN_SINK_PLANTED_SECRET]",
    "touch inside && echo wrote-inside",
    "echo x >> .git && echo wrote-git-pointer",
    `touch ${join(repo, ".git", "probe")} && echo wrote-git-data`,
    `touch ${join(scratch, "beside")} && echo wrote-beside`,
    "touch /tmp/ks-codex-real-probe && echo wrote-tmp",
  ].join("; ");

  // The scripted model: one shell command, then a reply.
  let requests = 0;
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk: Buffer) => (body += chunk.toString()));
    req.on("end", () => {
      if ((req.url ?? "").startsWith("/mcp")) mcpHits += 1;
      // The program tries a websocket first, then falls back to HTTP: refuse the upgrade.
      if (req.method !== "POST" || !(req.url ?? "").endsWith("/responses")) {
        res.writeHead(404);
        res.end();
        return;
      }
      const request = JSON.parse(body) as { input?: Array<{ type?: string; output?: unknown }>; model?: unknown; service_tier?: unknown };
      requestsSeen.push({ model: request.model, service_tier: request.service_tier });
      for (const item of request.input ?? []) {
        if (item.type === "function_call_output") toolOutputs.push(String(item.output));
      }
      requests += 1;
      const id = `resp_${requests}`;
      const item =
        requests === 1
          ? { type: "function_call", call_id: "call_1", name: "exec_command", arguments: JSON.stringify({ cmd: command }) }
          : { type: "message", role: "assistant", id: `msg_${id}`, content: [{ type: "output_text", text: "done" }] };
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const event of [
        { type: "response.created", response: { id } },
        { type: "response.output_item.done", item },
        { type: "response.completed", response: { id, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
      ]) {
        res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
      }
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}/v1`;
}, 60_000);

afterAll(() => {
  server?.close();
  vi.unstubAllEnvs();
  rmSync(scratch, { recursive: true, force: true });
});

describe("a Codex mode run, on the real Codex program (V5)", () => {
  it("sees only the allowlisted environment, and writes only in the session's worktree (BR-10, BR-12)", async (ctx) => {
    if (sandboxFails !== null) ctx.skip(`Codex's sandbox can't run on this host: ${sandboxFails}`);
    const tmpProbe = "/tmp/ks-codex-real-probe";
    rmSync(tmpProbe, { force: true });

    const stores = createInMemoryStores();
    // The SDK's own client, with Codex mode's own client options; only the model endpoint is ours.
    const resolveCodexClient = createDefaultResolveCodexClient({ ...codexClientOptions(), baseUrl, apiKey: "sk-scripted" });
    const result = await testFlow({
      flow: codexSessionFlow({ resolveCodexClient }),
      action: "turn",
      userId: "u",
      sessionId: "s-real",
      input: { prompt: "run the command" },
      stores,
    });
    expect(result.status).toBe("completed");

    const output = toolOutputs.join("\n");
    expect(output).toContain("planted=[]");
    expect(output).not.toContain(PLANTED);
    expect(output).toContain("wrote-inside");

    const state = ((await stores.session.get("s-real"))?.state ?? {}) as HarnessSessionState;
    expect(state.binding?.confirmed).toEqual(expect.any(String));
    const worktrees = execFileSync("git", ["-C", repo, "worktree", "list", "--porcelain"], { encoding: "utf8" })
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .filter((path) => path !== repo);
    expect(worktrees).toHaveLength(1);
    const session = worktrees[0]!;
    expect(existsSync(join(session, "inside"))).toBe(true);
    expect(readFileSync(join(session, ".git"), "utf8")).toMatch(/^gitdir: [^\n]+\n$/);
    expect(existsSync(join(repo, ".git", "probe"))).toBe(false);
    expect(existsSync(join(scratch, "beside"))).toBe(false);
    expect(existsSync(tmpProbe)).toBe(false);
    expect(output).not.toMatch(/wrote-(git-pointer|git-data|beside|tmp)/);
  }, 120_000);

  it("takes neither the model, the Fast tier nor the MCP servers from your own Codex settings", async (ctx) => {
    if (sandboxFails !== null) ctx.skip(`Codex's sandbox can't run on this host: ${sandboxFails}`);
    // A home set up the way the report's was: a model this account can't use,
    // the Fast tier, and a server that can't start here.
    const config = join(process.env.CODEX_HOME!, "config.toml");
    writeFileSync(
      config,
      ['model = "gpt-6.1-sol"', 'service_tier = "priority"', "", "[mcp_servers.vercel]", `url = "${baseUrl.replace(/\/v1$/, "")}/mcp"`, ""].join("\n"),
    );
    try {
      const names = await userMcpServers(codexEnv());
      expect(names).toEqual(["vercel"]);
      // Listing asks the server how it signs in; only what the run does counts.
      mcpHits = 0;
      const resolveCodexClient = createDefaultResolveCodexClient({ ...codexClientOptions(process.env, names), baseUrl, apiKey: "sk-scripted" });
      const stores = createInMemoryStores();
      const before = requestsSeen.length;
      const result = await testFlow({
        flow: codexSessionFlow({ resolveCodexClient }),
        action: "turn",
        userId: "u",
        sessionId: "s-settings",
        input: { prompt: "say done" },
        stores,
      });
      expect(result.status).toBe("completed");
      const sent = requestsSeen.slice(before);
      expect(sent.length).toBeGreaterThan(0);
      for (const request of sent) {
        expect(request.model).not.toBe("gpt-6.1-sol");
        expect(request.service_tier).toBeUndefined();
      }
      // The server was never started, so it could neither fail nor say so.
      expect(mcpHits).toBe(0);
      expect(JSON.stringify(result.items ?? [])).not.toMatch(/service tier|"type":"error"/);
    } finally {
      rmSync(config, { force: true });
    }
  }, 120_000);
});
