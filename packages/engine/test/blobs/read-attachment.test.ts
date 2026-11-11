// FIX-2636 D1.
/**
 * The model reads an earlier file on request.
 *
 * A tool's recorded output holds a file's reference and name, never its text.
 * The model call resolves that reference to the file's text on each step
 * of a tool loop, through the one resolver, so the text exists only in the
 * call to the provider.
 *
 * The model here records what it was sent. That the full path works across
 * turns and a restart is the goal check's (`goals/attachments/read-on-request`).
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { attachmentsCapability, recordAttachments } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import type { GeneratorModel, ItemQuery, LLMMessage } from "@flow-state-dev/core/types";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "../../src";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { createInMemoryStores } from "../../src/host";
import { makePdf } from "./pdf-fixture";

const byHeader = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  return user === null || user === undefined ? null : { userId: user, orgId: "acme" };
};

type ToolCall = { toolName: string; args: Record<string, unknown> };

/**
 * A step-capable model that records what each step was sent and plays a
 * script: one tool call per step, then an answer. One script per turn.
 */
function scriptedResolver(calls: LLMMessage[][], turns: ToolCall[][]) {
  let turn = -1;
  let step = 0;
  const resolver = ((modelId: string) =>
    ({
      modelId,
      async generate() {
        throw new Error("the owned loop calls generateStep");
      },
      async generateStep(options: { messages: LLMMessage[] }) {
        if (step === 0) turn += 1;
        calls.push(options.messages);
        const script = turns[turn] ?? [];
        const next = script[step];
        step += 1;
        if (next === undefined) {
          step = 0;
          return { text: "done", finishReason: "stop" };
        }
        return { toolCalls: [{ toolCallId: `c${turn}-${step}`, toolName: next.toolName, args: next.args }], finishReason: "tool-calls" };
      }
    }) as unknown as GeneratorModel) as ((modelId: string) => GeneratorModel) & { resolveId: (id: string) => string };
  resolver.resolveId = (id) => id;
  return resolver;
}

const input = z.object({ message: z.string() });

/** `tools`: the generator's own tools. `capability`: the attachments capability and its block instead. */
function setup(turns: ToolCall[][], options: { tools?: Array<ReturnType<typeof handler>>; capability?: boolean; history?: ItemQuery }) {
  const calls: LLMMessage[][] = [];
  const answer = generator({
    name: "answer",
    model: "anthropic/claude-test",
    prompt: "You answer.",
    history: options.history ?? true,
    ...(options.tools !== undefined ? { tools: options.tools } : {}),
    ...(options.capability === true ? { uses: [attachmentsCapability] } : {}),
    user: (value: { message: string }) => value.message
  });
  const chat = options.capability === true
    ? sequencer({ name: "chat", inputSchema: input }).tap(recordAttachments).step(answer)
    : sequencer({ name: "chat", inputSchema: input }).step(answer);
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: "chat",
      actions: { send: { inputSchema: input, block: chat, userMessage: (i) => i.message } }
    })()
  );
  const stores: StoreRegistry = { ...createInMemoryStores(), blobs: createMemoryBlobStore() };
  const router = createFlowApiRouter({ registry, stores, resolvePrincipal: byHeader, modelResolver: scriptedResolver(calls, turns) });
  const call = (method: "GET" | "POST", path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("x-user", "alice");
    const url = new URL(`http://localhost/api/flows/${path}`);
    return router[method](new Request(url, { ...init, method, headers }), {
      params: { path: url.pathname.replace(/^\/api\/flows\//, "").split("/").map(decodeURIComponent) }
    });
  };
  const upload = async (content: string | Uint8Array, mediaType: string, filename: string): Promise<FileContent> => {
    const response = await call("POST", `blobs?filename=${encodeURIComponent(filename)}`, {
      headers: { "content-type": mediaType },
      body: (typeof content === "string" ? new TextEncoder().encode(content) : content) as Uint8Array<ArrayBuffer>
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { attachment: FileContent }).attachment;
  };
  const send = async (session: string, message: string, attachments: FileContent[] = []) => {
    const response = await call("POST", `chat/${session}/actions/send`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { message }, attachments })
    });
    expect(response.status).toBe(202);
    const id = ((await response.json()) as { request: { id: string } }).request.id;
    for (let i = 0; i < 200; i += 1) {
      const record = await stores.request.get(id);
      if (record !== undefined && record.status !== "in_progress") return record;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`request ${id} never finished`);
  };
  return { calls, stores, upload, send };
}

/** The tool-result parts a step's messages carry, in order. */
const toolResults = (messages: LLMMessage[]) =>
  messages
    .filter((m) => m.role === "tool")
    .flatMap((m) => (Array.isArray(m.content) ? m.content : []))
    .filter((part): part is { type: "tool-result"; output: unknown } => (part as { type?: string }).type === "tool-result");

describe("a tool result that holds a file's reference", () => {
  // The premise D1 rests on: every step of a tool loop passes its messages
  // through the run's prepareMessages, so a reference a tool returned can
  // become the file's text there, and only there.
  it("reaches the model as the file's text on every later step of the loop, and is recorded as the reference", async () => {
    let held: FileContent | undefined;
    const hand = handler({
      name: "hand",
      inputSchema: z.object({}),
      outputSchema: z.unknown(),
      execute: () => held
    });
    const other = handler({ name: "other", inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }), execute: () => ({ ok: true }) });
    const { calls, upload, send } = setup(
      [
        [],
        [
          { toolName: "hand", args: {} },
          { toolName: "other", args: {} }
        ]
      ],
      { tools: [hand, other] }
    );
    held = await upload("the code word is MARIGOLD", "text/markdown", "notes.md");
    expect((await send("s1", "keep this", [held])).status).toBe("completed");
    calls.length = 0;
    const record = await send("s1", "what was the code word?");
    expect(record.status).toBe("completed");

    // Steps 2 and 3 of the loop each carry the text in the tool result.
    expect(calls).toHaveLength(3);
    for (const step of calls.slice(1)) {
      const [result] = toolResults(step);
      expect(JSON.stringify(result!.output)).toContain("MARIGOLD");
      expect(JSON.stringify(result!.output)).not.toContain(held.data);
    }
    // What the turn recorded holds the reference, never the text.
    const stored = JSON.stringify(record.items);
    expect(stored).toContain(held.data);
    expect(stored).not.toContain("MARIGOLD");
  });
});

/** Every text the model was shown in one call, as one string. */
const shown = (messages: LLMMessage[]) => JSON.stringify(messages);

/** The id the model reads a file by: its blob id. */
const idOf = (file: FileContent) => file.data.slice("fsd-blob:".length);

describe("the attachments capability", () => {
  // D2 and D1 together: an earlier document is one line with its id; the
  // model reads it by that id, and the text reaches that turn's loop only.
  it("names an earlier document with its id, reads it by that id, and names it again on the next turn", async () => {
    const turns: ToolCall[][] = [[], [], [{ toolName: "readAttachment", args: {} }], []];
    const { calls, upload, send } = setup(turns, { capability: true });
    const doc = await upload("the code word is MARIGOLD", "text/markdown", "plan.md");
    expect((await send("s1", "here is the plan", [doc])).status).toBe("completed");
    // The turn that sent it carries it in full.
    expect(shown(calls.at(-1)!)).toContain("MARIGOLD");

    calls.length = 0;
    expect((await send("s1", "thanks")).status).toBe("completed");
    // The next turn names it, with the id the model reads it by.
    expect(shown(calls[0]!)).not.toContain("MARIGOLD");
    expect(shown(calls[0]!)).toContain(`[document: plan.md, id ${idOf(doc)}, not re-sent; read it with readAttachment]`);

    turns[2]![0]!.args = { id: idOf(doc) };
    calls.length = 0;
    const read = await send("s1", "what was the code word?");
    expect(read.status).toBe("completed");
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(toolResults(calls[1]!)[0]!.output)).toContain("MARIGOLD");
    expect(JSON.stringify(read.items)).not.toContain("MARIGOLD");

    calls.length = 0;
    expect((await send("s1", "and now?")).status).toBe("completed");
    expect(shown(calls[0]!)).not.toContain("MARIGOLD");
  });

  it("lists the session's newest documents in context, and reads one off the list by its name", async () => {
    const turns: ToolCall[][] = [[], [], [], [{ toolName: "readAttachment", args: { name: "OLDEST.md" } }]];
    const { calls, upload, send } = setup(turns, { capability: true, history: { limit: { turns: 2 } } });
    const oldest = await upload("the code word is MARIGOLD", "text/markdown", "oldest.md");
    expect((await send("s1", "first", [oldest])).status).toBe("completed");
    for (const batch of [0, 1]) {
      const files: FileContent[] = [];
      for (let i = 0; i < 5; i += 1) files.push(await upload(`filler ${batch}-${i}`, "text/plain", `filler-${batch}-${i}.txt`));
      expect((await send("s1", `more ${batch}`, files)).status).toBe("completed");
    }

    calls.length = 0;
    const record = await send("s1", "what was in the first one?");
    expect(record.status).toBe("completed");
    // Ten newer documents push it off the list of eight, which says how to read it.
    const context = shown(calls[0]!);
    expect(context).toContain("filler-1-4.txt");
    expect(context).not.toContain("oldest.md");
    expect(context).toContain("3 older documents not listed: read one with readAttachment by its name.");
    expect(JSON.stringify(toolResults(calls[1]!)[0]!.output)).toContain("MARIGOLD");
  });

  it("answers a name that matches several documents with their ids, and no text", async () => {
    const turns: ToolCall[][] = [[], [], [{ toolName: "readAttachment", args: { name: "notes.md" } }]];
    const { calls, upload, send } = setup(turns, { capability: true });
    expect((await send("s1", "one", [await upload("first MARIGOLD", "text/markdown", "notes.md")])).status).toBe("completed");
    expect((await send("s1", "two", [await upload("second TULIP", "text/markdown", "notes.md")])).status).toBe("completed");
    calls.length = 0;
    expect((await send("s1", "which notes?")).status).toBe("completed");
    const output = JSON.stringify(toolResults(calls[1]!)[0]!.output);
    expect(output).toContain('2 documents are named \\"notes.md\\"');
    expect(output).not.toMatch(/MARIGOLD|TULIP/);
  });

  // ER-3 / BP-031: the id is never a key. The read goes through the
  // resolver bound to this session, so another session's file is not read.
  it("does not read another session's file, whatever id the model passes", async () => {
    const turns: ToolCall[][] = [[], [{ toolName: "readAttachment", args: {} }]];
    const { calls, upload, send } = setup(turns, { capability: true });
    const theirs = await upload("their code word is MARIGOLD", "text/markdown", "theirs.md");
    expect((await send("other", "mine", [theirs])).status).toBe("completed");
    turns[1]![0]!.args = { id: idOf(theirs) };
    calls.length = 0;
    expect((await send("s1", "read theirs")).status).toBe("completed");
    const output = JSON.stringify(toolResults(calls[1]!)[0]!.output);
    expect(output).toContain(`${idOf(theirs)} is not in this conversation.`);
    expect(output).not.toContain("MARIGOLD");
  });

  it("does not read an image on request", async () => {
    const turns: ToolCall[][] = [[], [{ toolName: "readAttachment", args: {} }]];
    const { calls, upload, send } = setup(turns, { capability: true });
    const shot = await upload(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]), "image/png", "shot.png");
    expect((await send("s1", "look", [shot])).status).toBe("completed");
    turns[1]![0]!.args = { id: idOf(shot) };
    calls.length = 0;
    expect((await send("s1", "read the image")).status).toBe("completed");
    expect(JSON.stringify(toolResults(calls[1]!)[0]!.output)).toContain("images are not read on request");
  });

  it("makes a document whose text is over the cap the tool's error, not a failed turn", async () => {
    const turns: ToolCall[][] = [[], [{ toolName: "readAttachment", args: { name: "dense.pdf" } }]];
    const { calls, upload, send } = setup(turns, { capability: true });
    // A page holds 50 lines of text; 60 pages of 80-character lines is over 200 KB.
    const page = Array.from({ length: 50 }, () => "x".repeat(80)).join("\n");
    const dense = await upload(makePdf(Array.from({ length: 60 }, () => page)), "application/pdf", "dense.pdf");
    expect((await send("s1", "the dense one", [dense])).status).toBe("completed");
    calls.length = 0;
    const record = await send("s1", "read it");
    expect(record.status).toBe("completed");
    expect(toolResults(calls[1]!)[0]!.output).toMatchObject({ type: "error-text" });
    expect(JSON.stringify(toolResults(calls[1]!)[0]!.output)).toMatch(/200 KB/);
    // The read itself failed: the record says so, rather than holding a read the call could not send.
    expect(record.items?.find((item) => item.type === "tool_output")).toMatchObject({ status: "failed" });
  });
});
