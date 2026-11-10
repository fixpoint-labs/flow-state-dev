/**
 * A turn's files, read for a harness (FIX-2519). A harness adapter gets the
 * files in reference form on its run input and reads their bytes through
 * core's `readHarnessAttachments`, which the engine answers with its one
 * resolver, bound to the request's conversation and person. A reference
 * another conversation owns reads nothing here, so a crafted one can't hand a
 * harness someone else's file.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import { HarnessAttachmentUnavailableError, readHarnessAttachments } from "@flow-state-dev/core/harness";
import type { FileContent } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "../../src";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { createInMemoryStores } from "../../src/host";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

const byHeader = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  return user === null || user === undefined ? null : { userId: user, orgId: "acme" };
};

const input = z.object({ message: z.string(), files: z.array(z.unknown()).optional() });

/** What the block read: each file's type, name and bytes, or the error it got. */
type Read = { files?: Array<{ mediaType: string; filename?: string; base64: string }>; error?: unknown };

function setup(withBlobs = true) {
  const read: Read = {};
  // Reads the files it is handed the way a harness adapter does: the request's
  // own, unless the input names others (a crafted reference).
  const turn = handler({
    name: "turn",
    inputSchema: input,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (value, ctx) => {
      try {
        const files = await readHarnessAttachments(ctx, (value.files as FileContent[] | undefined) ?? ctx.request.attachments);
        read.files = files.map((file) => ({
          mediaType: file.mediaType,
          ...(file.filename !== undefined ? { filename: file.filename } : {}),
          base64: file.base64(),
        }));
      } catch (error) {
        read.error = error;
      }
      return { ok: true };
    },
  });
  const registry = createFlowRegistry();
  registry.register(defineFlow({ kind: "harness", actions: { turn: { inputSchema: input, block: turn, userMessage: (i) => i.message } } })());
  const blobs = createMemoryBlobStore();
  const stores: StoreRegistry = { ...createInMemoryStores(), ...(withBlobs ? { blobs } : {}) };
  const router = createFlowApiRouter({ registry, stores, resolvePrincipal: byHeader });
  const call = (method: "GET" | "POST", path: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    headers.set("x-user", "alice");
    const url = new URL(`http://localhost/api/flows/${path}`);
    return router[method](new Request(url, { ...init, method, headers }), {
      params: { path: url.pathname.replace(/^\/api\/flows\//, "").split("/").map(decodeURIComponent) },
    });
  };
  const upload = async (bytes: Uint8Array, mediaType: string, filename: string): Promise<FileContent> => {
    const response = await call("POST", `blobs?filename=${encodeURIComponent(filename)}`, {
      headers: { "content-type": mediaType },
      body: bytes as Uint8Array<ArrayBuffer>,
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { attachment: FileContent }).attachment;
  };
  const send = async (session: string, body: Record<string, unknown>) => {
    const response = await call("POST", `harness/${session}/actions/turn`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(202);
    const id = ((await response.json()) as { request: { id: string } }).request.id;
    for (let i = 0; i < 100; i += 1) {
      const record = await stores.request.get(id);
      if (record !== undefined && record.status !== "in_progress") return record;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`request ${id} never finished`);
  };
  return { read, upload, send };
}

describe("a turn's files, read for a harness", () => {
  it("reads each of the request's files through the one resolver, typed as stored", async () => {
    const { read, upload, send } = setup();
    const shot = await upload(PNG, "image/png", "shot.png");
    const record = await send("s1", { input: { message: "what is this?" }, attachments: [shot] });
    expect(record.status).toBe("completed");
    expect(read.error).toBeUndefined();
    expect(read.files).toEqual([{ mediaType: "image/png", filename: "shot.png", base64: Buffer.from(PNG).toString("base64") }]);
  });

  it("refuses a reference another conversation owns, by name", async () => {
    const { read, upload, send } = setup();
    const shot = await upload(PNG, "image/png", "shot.png");
    await send("s1", { input: { message: "mine" }, attachments: [shot] });
    expect(read.files).toHaveLength(1);
    delete read.files;
    // The same reference, crafted into another conversation's turn input.
    await send("s2", { input: { message: "theirs", files: [shot] } });
    expect(read.files).toBeUndefined();
    expect(read.error).toBeInstanceOf(HarnessAttachmentUnavailableError);
    expect((read.error as Error).message).toContain("shot.png");
  });

  it("reads nothing, and says so, on a server with no blob store", async () => {
    const { read, send } = setup(false);
    const file: FileContent = { type: "file", mediaType: "image/png", data: toBlobRef("b_abcdefgh12") };
    await send("s1", { input: { message: "no store", files: [file] } });
    expect(read.error).toBeInstanceOf(HarnessAttachmentUnavailableError);
  });
});
