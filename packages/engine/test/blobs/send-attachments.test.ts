/**
 * A sent message's files, from the action request to the model call (spec
 * FIX-2517). The request names its files in `attachments` beside the input;
 * the parse step checks them against the one limits set and that the action
 * has a user line to put them on; the user line holds a `file` part per file,
 * in reference form; the block reads them from its context; and a generator
 * gets them as image and file parts with the bytes inline.
 *
 * The model here records what it was sent. That a real model reads the files
 * is the goal check's (`goals/attachments/reach-the-model`).
 */
import { defineFlow, generator, handler, sequencer } from "@flow-state-dev/core";
import { parseBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent, MessageItem } from "@flow-state-dev/core/items";
import type { GeneratorModel, LLMMessage } from "@flow-state-dev/core/types";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "../../src";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { createInMemoryStores } from "../../src/host";
import { retryRequest } from "../../src/execution/request-recovery";
import { makePdf } from "./pdf-fixture";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const PDF = makePdf(["the report"]);

const byHeader = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  return user === null || user === undefined ? null : { userId: user, orgId: "acme" };
};

type ModelCall = { messages: LLMMessage[] };

/**
 * A model that records what it was sent. With `toolLoop`, it is step-capable
 * and calls the `lookup` tool once before answering, so the generator runs
 * its own tool loop and records its prelude.
 */
function recordingResolver(calls: ModelCall[], toolLoop: boolean) {
  const resolver = ((modelId: string) => {
    if (!toolLoop) {
      return {
        modelId,
        async generate(options: { messages: LLMMessage[] }) {
          calls.push({ messages: options.messages });
          return { text: "seen" };
        }
      } as unknown as GeneratorModel;
    }
    let step = 0;
    return {
      modelId,
      async generate() {
        throw new Error("the owned loop calls generateStep");
      },
      async generateStep(options: { messages: LLMMessage[] }) {
        calls.push({ messages: options.messages });
        step += 1;
        return step === 1
          ? { toolCalls: [{ toolCallId: "c1", toolName: "lookup", args: {} }], finishReason: "tool-calls" }
          : { text: "seen", finishReason: "stop" };
      }
    } as unknown as GeneratorModel;
  }) as ((modelId: string) => GeneratorModel) & { resolveId: (id: string) => string };
  resolver.resolveId = (id) => id;
  return resolver;
}

const input = z.object({ message: z.string() });

/** `model`: the generator's model string; its provider decides whether a PDF goes as a file or as its text. */
type Options = { toolLoop?: boolean; failFirst?: boolean; model?: string };

function chatFlow(seen: { attachments?: ReadonlyArray<FileContent> }, options: Options) {
  let failuresLeft = options.failFirst === true ? 1 : 0;
  // Records what the block's context says the request carried, then answers.
  const look = handler({
    name: "look",
    inputSchema: input,
    outputSchema: input,
    execute: (value, ctx) => {
      seen.attachments = ctx.request.attachments;
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("the first run fails");
      }
      return { message: value.message };
    }
  });
  const lookup = handler({ name: "lookup", inputSchema: z.object({}), outputSchema: z.object({ ok: z.boolean() }), execute: () => ({ ok: true }) });
  const answer = generator({
    name: "answer",
    model: options.model ?? "anthropic/claude-test",
    prompt: "You answer.",
    history: true,
    ...(options.toolLoop === true ? { tools: [lookup] } : {}),
    // The same words the user line holds: the model must still get one user turn.
    user: (value: { message: string }) => value.message
  });
  return defineFlow({
    kind: "chat",
    actions: {
      send: { block: sequencer({ name: "chat", inputSchema: input }).step(look).step(answer), userMessage: (i) => i.message },
      // No user line, so no place for files.
      note: handler({ name: "note", inputSchema: input, outputSchema: input, execute: (value) => ({ message: value.message }) })
    }
  })();
}

function setup(options: Options = {}) {
  const seen: { attachments?: ReadonlyArray<FileContent> } = {};
  const calls: ModelCall[] = [];
  const registry = createFlowRegistry();
  registry.register(chatFlow(seen, options));
  const stores: StoreRegistry = { ...createInMemoryStores(), blobs: createMemoryBlobStore() };
  const modelResolver = recordingResolver(calls, options.toolLoop === true);
  const router = createFlowApiRouter({ registry, stores, resolvePrincipal: byHeader, modelResolver });
  const call = (method: "GET" | "POST", path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("x-user", "alice");
    const url = new URL(`http://localhost/api/flows/${path}`);
    return router[method](new Request(url, { ...init, method, headers }), {
      params: { path: url.pathname.replace(/^\/api\/flows\//, "").split("/").map(decodeURIComponent) }
    });
  };
  const upload = async (bytes: Uint8Array, mediaType: string, filename: string): Promise<FileContent> => {
    const response = await call("POST", `blobs?filename=${encodeURIComponent(filename)}`, {
      headers: { "content-type": mediaType },
      body: bytes as Uint8Array<ArrayBuffer>
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { attachment: FileContent }).attachment;
  };
  const send = (session: string, attachments: unknown, action = "send", message = "what is in these?") =>
    call("POST", `chat/${session}/actions/${action}`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { message }, attachments })
    });
  /** Wait for a request to finish, and return its record. */
  const finished = async (response: Response) => {
    expect(response.status).toBe(202);
    return settled(((await response.json()) as { request: { id: string } }).request.id);
  };
  const settled = async (id: string) => {
    for (let i = 0; i < 100; i += 1) {
      const record = await stores.request.get(id);
      if (record !== undefined && record.status !== "in_progress") return record;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`request ${id} never finished`);
  };
  return { seen, calls, stores, registry, modelResolver, upload, send, finished, settled };
}

/** A file big enough that a copy of its bytes in a record can't hide: random, so it doesn't compress into a short run. */
function bigPng(): Uint8Array {
  const bytes = new Uint8Array(64 * 1024);
  for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes.set(PNG.slice(0, 4));
  return bytes;
}

/** Any run of base64 characters long enough to be a file's bytes rather than an id. */
const BASE64_RUN = /[A-Za-z0-9+/]{1024,}/;

const userLines = (items: ReadonlyArray<{ type: string; role?: string }> | undefined) =>
  (items ?? []).filter((item): item is MessageItem => item.type === "message" && item.role === "user");

describe("a message's files, from the request to the model", () => {
  it("puts the text and each file on the user line, as references, and shows the block the request's files", async () => {
    const { seen, upload, send, finished } = setup();
    const shot = await upload(PNG, "image/png", "shot.png");
    const report = await upload(PDF, "application/pdf", "report.pdf");

    const record = await finished(await send("s1", [shot, report]));
    expect(record.status).toBe("completed");

    const [line] = userLines(record.items);
    expect(line!.content).toEqual([{ type: "output_text", text: "what is in these?" }, shot, report]);
    for (const part of line!.content.slice(1)) expect(parseBlobRef((part as FileContent).data)).toBeDefined();
    expect(seen.attachments).toEqual([shot, report]);
  });

  it("sends the model one user turn with the text, then each file's bytes", async () => {
    const { calls, upload, send, finished } = setup();
    const shot = await upload(PNG, "image/png", "shot.png");
    const report = await upload(PDF, "application/pdf", "report.pdf");
    await finished(await send("s1", [shot, report]));

    const users = calls.at(-1)!.messages.filter((m) => m.role === "user");
    expect(users).toHaveLength(1);
    expect(users[0]!.content).toEqual([
      { type: "text", text: "what is in these?" },
      { type: "image", image: Buffer.from(PNG).toString("base64"), mediaType: "image/png" },
      { type: "file", data: Buffer.from(PDF).toString("base64"), mediaType: "application/pdf", filename: "report.pdf" }
    ]);
  });

  // FIX-2520: the generator's own provider decides; nothing in the flow names it.
  it("sends a provider that can't read PDFs each document as text headed by its name", async () => {
    const { calls, upload, send, finished } = setup({ model: "acme/house-model" });
    const report = await upload(makePdf(["intro", "code word TANGERINE"]), "application/pdf", "spec.pdf");
    const notes = await upload(new TextEncoder().encode("# Notes\ncode word PLUM"), "text/markdown", "notes.md");
    const record = await finished(await send("s1", [report, notes]));
    expect(record.status).toBe("completed");

    const users = calls.at(-1)!.messages.filter((m) => m.role === "user");
    expect(users[0]!.content).toEqual([
      { type: "text", text: "what is in these?" },
      { type: "text", text: "### spec.pdf\n[page 1]\nintro\n\n[page 2]\ncode word TANGERINE" },
      { type: "text", text: "### notes.md\n# Notes\ncode word PLUM" }
    ]);
  });

  it("fails the turn by name, before the model is called, when a PDF's text is over the cap for a provider that gets text", async () => {
    const { calls, upload, send, finished } = setup({ model: "acme/house-model" });
    // Sixty full pages, well under the page cap, and over 200 KB of text.
    const page = Array.from({ length: 50 }, () => "word ".repeat(18).trim()).join("\n");
    const dense = await upload(makePdf(Array.from({ length: 60 }, () => page)), "application/pdf", "dense.pdf");
    const record = await finished(await send("s1", [dense]));
    expect(record.status).toBe("failed");
    expect(JSON.stringify(record)).toContain("dense.pdf");
    expect(calls).toHaveLength(0);
  });

  it("still shows the model a file sent two turns before", async () => {
    const { calls, upload, send, finished } = setup();
    const shot = await upload(PNG, "image/png", "error.png");
    await finished(await send("s1", [shot], "send", "here is the error"));
    await finished(await send("s1", undefined, "send", "the logs say nothing"));
    await finished(await send("s1", undefined, "send", "what was in that screenshot?"));

    const first = calls.at(-1)!.messages.find((m) => m.role === "user")!;
    expect(first.content).toEqual([
      { type: "text", text: "here is the error" },
      { type: "image", image: Buffer.from(PNG).toString("base64"), mediaType: "image/png" }
    ]);
  });

  // The bytes go to the model and nowhere else: what a run records (the
  // generator's trace of its history, the tool loop's prelude) keeps the
  // reference, or every request record would carry a copy of every file.
  for (const toolLoop of [false, true]) {
    it(`keeps the bytes out of the request record${toolLoop ? " when the generator runs its own tool loop" : ""}`, async () => {
      const { calls, upload, send, finished } = setup({ toolLoop });
      const bytes = bigPng();
      const shot = await upload(bytes, "image/png", "big.png");
      const record = await finished(await send("s1", [shot]));
      expect(record.status).toBe("completed");

      // The model did get the bytes, on every call.
      const base64 = Buffer.from(bytes).toString("base64");
      expect(calls.length).toBe(toolLoop ? 2 : 1);
      for (const c of calls) expect(JSON.stringify(c.messages)).toContain(base64);
      // The record holds the reference only.
      const stored = JSON.stringify(record);
      expect(stored).toContain(shot.data);
      expect(stored).not.toMatch(BASE64_RUN);
      expect(stored.length).toBeLessThan(32 * 1024);
    });
  }

  // Each step of a tool loop sends the files again, but the store reads each
  // one once per request: a remote store would otherwise pay a round trip per
  // file per step.
  it("reads each file from the store once per request, however many steps the tool loop takes", async () => {
    const { calls, stores, upload, send, finished } = setup({ toolLoop: true });
    const shot = await upload(PNG, "image/png", "shot.png");
    const doc = await upload(PDF, "application/pdf", "doc.pdf");
    const read = vi.spyOn(stores.blobs!, "read");
    const record = await finished(await send("s1", [shot, doc]));
    expect(record.status).toBe("completed");
    expect(calls.length).toBe(2);
    expect(read).toHaveBeenCalledTimes(2);
  });

  // A retried turn is the person's turn again: the same files on its line,
  // on its record and to the model.
  it("carries the files into a retry of a failed turn", async () => {
    const { calls, stores, registry, modelResolver, upload, send, finished, settled } = setup({ failFirst: true });
    const shot = await upload(PNG, "image/png", "shot.png");
    const failed = await finished(await send("s1", [shot]));
    expect(failed.status).toBe("failed");

    const { newRequestId } = await retryRequest({ originalRequestId: failed.id, stores, flowRegistry: registry, runtimeConfig: { modelResolver } });
    const retried = await settled(newRequestId);
    expect(retried.status).toBe("completed");
    expect(retried.attachments).toEqual([shot]);
    expect(userLines(retried.items)[0]!.content).toEqual([{ type: "output_text", text: "what is in these?" }, shot]);
    const users = calls.at(-1)!.messages.filter((m) => m.role === "user");
    expect(users.at(-1)!.content).toEqual([
      { type: "text", text: "what is in these?" },
      { type: "image", image: Buffer.from(PNG).toString("base64"), mediaType: "image/png" }
    ]);
  });

  it("gives an action with no files a request with none", async () => {
    const { seen, send, finished } = setup();
    await finished(await send("s1", undefined));
    expect(seen.attachments).toEqual([]);
  });
});

describe("the parse step refuses by name, before anything runs or is claimed", () => {
  it("refuses an eleventh image, writes no request, and leaves the files the uploader's", async () => {
    const { stores, upload, send, finished } = setup();
    const shots: FileContent[] = [];
    for (let i = 0; i < 11; i += 1) shots.push(await upload(PNG, "image/png", `shot-${i}.png`));

    const refused = await send("s1", shots);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "attachment_limit", index: 10, limit: 10 });
    expect(await stores.request.list({ sessionId: "s1" } as never)).toHaveLength(0);
    // Nothing was claimed: the first ten still go with the next message.
    expect((await finished(await send("s1", shots.slice(0, 10)))).status).toBe("completed");
  });

  it("refuses a sixth document", async () => {
    const { upload, send } = setup();
    const docs: FileContent[] = [];
    for (let i = 0; i < 6; i += 1) docs.push(await upload(PDF, "application/pdf", `doc-${i}.pdf`));
    const refused = await send("s1", docs);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "attachment_limit", index: 5, limit: 5 });
  });

  it("refuses a type off the list", async () => {
    const { upload, send } = setup();
    const shot = await upload(PNG, "image/png", "shot.png");
    const refused = await send("s1", [{ ...shot, mediaType: "image/heic" }]);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "attachment_type_refused", index: 0 });
  });

  // Otherwise a request could name ten PDFs as images and carry fifteen documents.
  it("refuses a file named as a type it was not uploaded as", async () => {
    const { upload, send, finished } = setup();
    const report = await upload(PDF, "application/pdf", "report.pdf");
    const refused = await send("s1", [{ ...report, mediaType: "image/png" }]);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "attachment_invalid", index: 0 });
    expect((await finished(await send("s1", [report]))).status).toBe("completed");
  });

  it("refuses files sent to an action with no user line", async () => {
    const { upload, send } = setup();
    const shot = await upload(PNG, "image/png", "shot.png");
    const refused = await send("s1", [shot], "note");
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "attachments_not_accepted" });
  });

  it("keeps only the reference and its name from what the request sent", async () => {
    const { upload, send, finished } = setup();
    const shot = await upload(PNG, "image/png", "shot.png");
    // `ephemeral` would drop the part when the line is stored.
    const record = await finished(await send("s1", [{ ...shot, ephemeral: true, extra: "x" }]));
    expect(userLines(record.items)[0]!.content[1]).toEqual(shot);
  });
});
