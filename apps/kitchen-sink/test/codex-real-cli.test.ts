/**
 * What a Codex mode run can see, on the real Codex program
 * (`specs/issues/FIX-1916/PLAN.md` V5; BUSINESS-RULES BR-10).
 *
 * The real session flow, the real Codex block and the real `@openai/codex-sdk`,
 * which starts the real `codex` program with Codex mode's own client options.
 * Only the model is scripted: a Responses endpoint on 127.0.0.1 that answers
 * the first request with one shell command and the next with a reply. No key,
 * no network, and the run's Codex home is a fresh temporary directory.
 *
 * The command reads a variable set on the server but left off the allowlist,
 * and writes a file in the worktree the run was given.
 *
 * **Confinement is NOT under test, because there is none.** Kitchen Sink runs
 * Codex with its sandbox off, so a run writes wherever the server's OS user
 * can. What is still true, and is what this holds, is that the run is HANDED
 * only the allowlisted environment and works in the session's own worktree.
 *
 * Red state produced before this was trusted:
 *   - leave `client.env` unset: the command prints the planted value.
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
import type { HarnessSessionState } from "@flow-state-dev/harness-manager";
import { worktreeRoot } from "@/lib/harness-worktree";

const PLANTED = "do-not-hand-this-over";
/** The model the endpoint refuses, and the words it refuses it with (the reported 400's). */
const REFUSED_MODEL = "model-this-account-cannot-use";
const REFUSAL = "The 'model-this-account-cannot-use' model is not supported when using Codex with a ChatGPT account.";

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

  mkdirSync(worktreeRoot(repo), { recursive: true });

  command = ['echo "planted=[$KITCHEN_SINK_PLANTED_SECRET]"', "touch inside && echo wrote-inside"].join("; ");

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
      // How the API answers a ChatGPT sign-in that asks for a model it can't use.
      if (request.model === REFUSED_MODEL) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ detail: REFUSAL }));
        return;
      }
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
  it("sees only the allowlisted environment, and works in the session's worktree (BR-10)", async () => {
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
    expect(result.status, JSON.stringify(result.items.filter((item) => item.type === "error"))).toBe("completed");

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
  }, 120_000);

  it("takes neither the model, the Fast tier nor the MCP servers from your own Codex settings", async () => {
    // A home set up the way the report's was: a model this account can't use,
    // the Fast tier, and a server that can't start here.
    const config = join(process.env.CODEX_HOME!, "config.toml");
    writeFileSync(
      config,
      ['model = "unavailable-user-model"', 'service_tier = "priority"', "", "[mcp_servers.vercel]", `url = "${baseUrl.replace(/\/v1$/, "")}/mcp"`, ""].join("\n"),
    );
    try {
      const names = await userMcpServers(codexEnv());
      expect(names).toEqual([{ name: "vercel", transport: { url: `${baseUrl.replace(/\/v1$/, "")}/mcp` } }]);
      // Runtime/plugin inventories can include a server with no transport in
      // config.toml. Disabling it must not create an invalid server entry.
      const listed = [
        ...names,
        { name: "code-review", transport: { command: "must-never-start" } },
        { name: "runtime.with.dots", transport: { url: `${baseUrl.replace(/\/v1$/, "")}/mcp` } },
      ];
      // Listing asks the server how it signs in; only what the run does counts.
      mcpHits = 0;
      const resolveCodexClient = createDefaultResolveCodexClient({ ...codexClientOptions(process.env, listed), baseUrl, apiKey: "sk-scripted" });
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
      expect(result.status, JSON.stringify(result.items.filter((item) => item.type === "error"))).toBe("completed");
      const sent = requestsSeen.slice(before);
      expect(sent.length).toBeGreaterThan(0);
      for (const request of sent) {
        expect(request.model).not.toBe("unavailable-user-model");
        expect(request.service_tier).toBeUndefined();
      }
      // The server was never started, so it could neither fail nor say so.
      expect(mcpHits).toBe(0);
      expect(JSON.stringify(result.items ?? [])).not.toMatch(/service tier|"type":"error"/);
    } finally {
      rmSync(config, { force: true });
    }
  }, 120_000);

  it("a model the account refuses fails the turn with the API's one line, the CLI's output folded into details", async () => {
    const stores = createInMemoryStores();
    const resolveCodexClient = createDefaultResolveCodexClient({ ...codexClientOptions(), baseUrl, apiKey: "sk-scripted" });
    const result = await testFlow({
      flow: codexSessionFlow({ resolveCodexClient }),
      action: "turn",
      userId: "u",
      sessionId: "s-refused",
      input: { prompt: "say done" },
      stores,
      seed: { session: { state: { model: REFUSED_MODEL } } },
    });
    const errors = result.items.filter((item) => item.type === "error") as Array<{ message?: string; details?: { output?: unknown } }>;
    // One error, its message the refusal itself on one line, not a dump of the CLI's log.
    expect(errors, JSON.stringify(errors, null, 1)).toHaveLength(1);
    expect(errors[0]!.message).toBe(`Codex run failed: ${REFUSAL}`);
    // Whatever else the CLI printed is kept, collapsed under Details, not lost.
    if (errors[0]!.details !== undefined) expect(errors[0]!.details.output).toEqual(expect.any(String));
  }, 120_000);
});
