import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { Readable, Writable } from "node:stream";
import { createInMemoryStores, type StoreRegistry } from "@flow-state-dev/engine";
import { createMockModelResolver, mockGenerator } from "@flow-state-dev/testing";
import type { ModelResolver } from "@flow-state-dev/core/types";
import { executeChatCommand } from "../src/commands/chat";
import { CliError } from "../src/resolve-block";
import { EXIT_INVALID_ARGS, EXIT_DISCOVERY_ERROR } from "../src/exit-codes";

const chatDir = resolve(import.meta.dirname, "fixtures-chat");
const emptyDir = resolve(import.meta.dirname, "fixtures-chat", "empty");
const soloDir = resolve(import.meta.dirname, "fixtures-chat-solo");

function mockResolver(): ModelResolver {
  const gen1 = mockGenerator({ name: "chat-generator", script: Array.from({ length: 12 }, () => ({ text: "bot reply" })) });
  const gen2 = mockGenerator({ name: "chat-generator-2", script: Array.from({ length: 12 }, () => ({ text: "bot two reply" })) });
  return createMockModelResolver({
    generators: { "chat-generator": gen1, "chat-generator-2": gen2 },
    models: { "openai/gpt-5.4-mini": gen1 },
  });
}

/** Run the chat command with a scripted stdin; capture the transcript. */
async function runChat(
  flow: string | undefined,
  action: string | undefined,
  script: string,
  opts: { stores?: StoreRegistry; user?: string; session?: string; cwd?: string } = {},
): Promise<{ text: string; exitCode: number | undefined }> {
  const stores = opts.stores ?? createInMemoryStores();
  let buf = "";
  const output = new Writable({
    write(chunk, _enc, cb) {
      buf += chunk.toString();
      cb();
    },
  });
  const input = Readable.from([script]) as Readable & { isTTY?: boolean };
  await executeChatCommand(flow, action, {
    cwd: opts.cwd ?? chatDir,
    stores,
    modelResolver: mockResolver(),
    input,
    output: output as unknown as NodeJS.WritableStream,
    user: opts.user,
    session: opts.session,
  });
  return { text: buf, exitCode: process.exitCode as number | undefined };
}

beforeEach(() => {
  process.exitCode = undefined;
});
afterEach(() => {
  process.exitCode = undefined;
});

describe("fsdev chat — piped stdin", () => {
  it("binds a positional target, holds a turn, and reports status, exiting 0", async () => {
    const { text, exitCode } = await runChat("chatbot", "chat", "hi\n/status\n/exit\n");
    expect(text).toContain("Chatting with chatbot · chat");
    expect(text).toContain("bot reply");
    expect(text).toContain("Target:  chatbot · chat");
    expect(text).toContain("Turns:   1");
    expect(exitCode ?? 0).toBe(0);
  });

  it("starts unbound when several targets exist, hints on free text, and exits non-zero", async () => {
    const { text, exitCode } = await runChat(undefined, undefined, "hi\n/exit\n");
    expect(text).toContain("No default target bound");
    expect(text).toContain("No default target — pick one with /use");
    // Free text sent nowhere is a tracked failure in piped mode (§4.6).
    expect(exitCode).toBe(1);
  });

  it("is fatal when zero flows are discovered", async () => {
    const err = await executeChatCommand(undefined, undefined, {
      cwd: emptyDir,
      stores: createInMemoryStores(),
      modelResolver: mockResolver(),
      input: Readable.from(["/exit\n"]) as unknown as NodeJS.ReadableStream,
      output: new Writable({ write: (_c, _e, cb) => cb() }) as unknown as NodeJS.WritableStream,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_DISCOVERY_ERROR);
  });

  it("keeps each flow's session independent across /use switches", async () => {
    const stores = createInMemoryStores();
    // Two turns on chatbot, one on chatbot2, then back to chatbot.
    await runChat(undefined, undefined,
      "/use chatbot chat\nhi\n/use chatbot2 chat\nyo\n/use chatbot chat\nhi again\n/exit\n",
      { stores });

    const sessions = await stores.session.list();
    const chatbotSessions = sessions.filter((s) => s.flowKind === "chatbot");
    const chatbot2Sessions = sessions.filter((s) => s.flowKind === "chatbot2");
    expect(chatbotSessions).toHaveLength(1);
    expect(chatbot2Sessions).toHaveLength(1);
    // chatbot's single session threaded BOTH its turns; chatbot2's threaded one.
    expect(chatbotSessions[0]?.state.messageCount).toBe(2);
    expect(chatbot2Sessions[0]?.state.messageCount).toBe(1);
  });

  it("auto-binds when the project has exactly one flow and one action", async () => {
    const { text, exitCode } = await runChat(undefined, undefined, "/exit\n", { cwd: soloDir });
    expect(text).toContain("Chatting with solo · chat");
    expect(exitCode ?? 0).toBe(0);
  });

  it("errors on an ambiguous positional flow with several actions", async () => {
    const err = await executeChatCommand("multi", undefined, {
      cwd: chatDir,
      stores: createInMemoryStores(),
      modelResolver: mockResolver(),
      input: Readable.from(["/exit\n"]) as unknown as NodeJS.ReadableStream,
      output: new Writable({ write: (_c, _e, cb) => cb() }) as unknown as NodeJS.WritableStream,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
    expect(err.message).toContain("multiple actions");
  });

  it("threads --user through to the request and session records, under a stable sess_ id", async () => {
    const stores = createInMemoryStores();
    await runChat("chatbot", "chat", "hi\n/exit\n", { stores, user: "devuser" });
    const requests = await stores.request.list();
    expect(requests[0]?.userId).toBe("devuser");
    const sessions = await stores.session.list();
    expect(sessions[0]?.userId).toBe("devuser");
    // The turn ran under the stable id seeded at bind time — never an engine-minted
    // ephemeral_ id (which would not persist history across turns).
    expect(sessions[0]?.id).toMatch(/^sess_/);
    expect(sessions.some((s) => s.id.startsWith("ephemeral_"))).toBe(false);
    expect(requests[0]?.sessionId).toMatch(/^sess_/);
  });

  it("rejects --session whose completed request history belongs to another flow", async () => {
    const stores = createInMemoryStores();
    // No session record — only a completed request from a different flow under the id.
    await stores.request.set(
      "req_seed",
      {
        id: "req_seed",
        flowKind: "chatbot2",
        actionName: "chat",
        userId: "cli-user",
        sessionId: "sess_shared",
        source: "cli",
        status: "completed",
        startedAtMs: Date.now(),
        state: {},
        version: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      "any",
    );
    const err = await executeChatCommand("chatbot", "chat", {
      cwd: chatDir,
      stores,
      modelResolver: mockResolver(),
      session: "sess_shared",
      input: Readable.from(["/exit\n"]) as unknown as NodeJS.ReadableStream,
      output: new Writable({ write: (_c, _e, cb) => cb() }) as unknown as NodeJS.WritableStream,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
    expect(err.message).toContain("history from flow \"chatbot2\"");
  });

  it("exits with an execution error when a built-in fails, even with zero turns", async () => {
    const { exitCode } = await runChat("chatbot", "chat", "/use nope\n/exit\n");
    expect(exitCode).toBe(1);
  });

  it("keeps processing after a failed turn and exits non-zero at EOF", async () => {
    // `strict.run` rejects { message }, so the turn errors — but /status still
    // runs, and EOF exits non-zero.
    const { text, exitCode } = await runChat("strict", "run", "hi\n/status\n/exit\n");
    expect(text).toContain("isn't chat-shaped");
    expect(text).toContain("Turns:   1");
    expect(exitCode).toBe(1);
  });

  it("rejects --session when startup is unbound", async () => {
    const err = await executeChatCommand(undefined, undefined, {
      cwd: chatDir,
      stores: createInMemoryStores(),
      modelResolver: mockResolver(),
      session: "sess_x",
      input: Readable.from(["/exit\n"]) as unknown as NodeJS.ReadableStream,
      output: new Writable({ write: (_c, _e, cb) => cb() }) as unknown as NodeJS.WritableStream,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
  });

  it("rejects --session that names an existing session of a different flow", async () => {
    const stores = createInMemoryStores();
    await stores.session.set(
      "sess_foreign",
      {
        id: "sess_foreign",
        flowKind: "chatbot2",
        userId: "cli-user",
        state: {},
        version: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        journal: [],
      },
      "any",
    );
    const err = await executeChatCommand("chatbot", "chat", {
      cwd: chatDir,
      stores,
      modelResolver: mockResolver(),
      session: "sess_foreign",
      input: Readable.from(["/exit\n"]) as unknown as NodeJS.ReadableStream,
      output: new Writable({ write: (_c, _e, cb) => cb() }) as unknown as NodeJS.WritableStream,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(CliError);
    expect(err.exitCode).toBe(EXIT_INVALID_ARGS);
    expect(err.message).toContain("belongs to flow \"chatbot2\"");
  });
});
