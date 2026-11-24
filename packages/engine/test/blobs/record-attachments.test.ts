// FIX-2634.
/**
 * The attachments block on the real path: a flow that
 * includes `recordAttachments` gets the session's `attachments` list with no
 * other wiring, read through the ordinary collection routes; a retried turn
 * lists no file twice; no other block can edit or remove an entry; and the
 * session delete takes the list. A flow without the block keeps its files.
 *
 * Through the router, an in-memory store and blob store. The list surviving a
 * restart on SQLite is the goal check's (`goals/attachments/session-file-list`).
 */
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import { ATTACHMENTS, parseBlobRef, recordAttachments } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "../../src";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { createInMemoryStores } from "../../src/host";
import { retryRequest } from "../../src/execution/request-recovery";
import { makePdf } from "./pdf-fixture";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const PDF = makePdf(["the report"]);

const input = z.object({ message: z.string() });

const byHeader = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  return user === null || user === undefined ? null : { userId: user, orgId: "acme" };
};

type Options = { failFirst?: boolean };

function setup(options: Options = {}) {
  let failuresLeft = options.failFirst === true ? 1 : 0;
  const refusals: string[] = [];
  const reply = handler({
    name: "reply",
    inputSchema: input,
    outputSchema: input,
    execute: (value) => {
      if (failuresLeft > 0) {
        failuresLeft -= 1;
        throw new Error("the first run fails");
      }
      return { message: value.message };
    }
  });
  // Another block that reaches the list: what a model's resource tools would be.
  const tamper = handler({
    name: "tamper",
    inputSchema: input,
    outputSchema: input,
    resources: { [ATTACHMENTS]: recordAttachments.declaredResources![ATTACHMENTS]! } as never,
    execute: async (value, ctx) => {
      const list = (ctx.resources as Record<string, any>)[ATTACHMENTS];
      for (const entry of await list.list()) {
        const key = String(entry.path).replace(`${ATTACHMENTS}/`, "");
        for (const write of [() => entry.patchState({ filename: "changed" }), () => list.delete(key), () => list.create(key, {}, { replace: true })]) {
          try {
            await write();
          } catch (err) {
            refusals.push(err instanceof Error ? err.message : String(err));
          }
        }
      }
      return { message: value.message };
    }
  });
  const send = { inputSchema: input, userMessage: (i: { message: string }) => i.message };
  const withBlock = defineFlow({
    kind: "with-block",
    actions: {
      send: { ...send, block: sequencer({ name: "chat", inputSchema: input }).tap(recordAttachments).step(reply) },
      tamper
    }
  })();
  const without = defineFlow({
    kind: "without-block",
    actions: { send: { ...send, block: sequencer({ name: "chat", inputSchema: input }).step(reply) } }
  })();

  const registry = createFlowRegistry();
  registry.register(withBlock);
  registry.register(without);
  const stores: StoreRegistry = { ...createInMemoryStores(), blobs: createMemoryBlobStore() };
  const router = createFlowApiRouter({ registry, stores, resolvePrincipal: byHeader });
  const call = (method: "GET" | "POST" | "DELETE", path: string, init: RequestInit = {}) => {
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
  const settled = async (id: string) => {
    for (let i = 0; i < 100; i += 1) {
      const record = await stores.request.get(id);
      if (record !== undefined && record.status !== "in_progress") return record;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`request ${id} never finished`);
  };
  const run = async (flow: string, session: string, attachments?: FileContent[], action = "send") => {
    const response = await call("POST", `${flow}/${session}/actions/${action}`, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { message: "here" }, attachments })
    });
    expect(response.status).toBe(202);
    return settled(((await response.json()) as { request: { id: string } }).request.id);
  };
  /** The session's list, as an app reads it: the collection list route. */
  const listed = async (session: string) => {
    const response = await call("GET", `sessions/${session}/resources/${ATTACHMENTS}`);
    if (response.status !== 200) return { status: response.status, entries: [] as Array<Record<string, unknown>> };
    const page = (await response.json()) as { items: Array<{ topic: string; clientData?: Record<string, unknown> }> };
    return { status: 200, entries: page.items.map((item): Record<string, unknown> => ({ topic: item.topic, ...item.clientData })) };
  };
  const manifestRefs = async (session: string) => {
    const response = await call("GET", `sessions/${session}/manifest`);
    expect(response.status).toBe(200);
    return ((await response.json()) as { resources: Array<{ ref: string; pattern?: string }> }).resources;
  };
  const read = async (file: FileContent) => (await call("GET", `blobs/${parseBlobRef(file.data)}`)).status;
  return { stores, registry, refusals, upload, run, settled, listed, manifestRefs, read, call };
}

describe("recordAttachments", () => {
  it("lists every file the session's turns sent, one entry each, with no wiring but the block", async () => {
    const { upload, run, listed } = setup();
    const a = await upload(PNG, "image/png", "a.png");
    const b = await upload(PNG, "image/png", "b.png");
    const doc = await upload(PDF, "application/pdf", "report.pdf");
    const first = await run("with-block", "s1", [a, b]);
    const second = await run("with-block", "s1", [doc]);
    expect([first.status, second.status]).toEqual(["completed", "completed"]);

    const { status, entries } = await listed("s1");
    expect(status).toBe(200);
    const byRef = new Map(entries.map((entry) => [entry.ref, entry]));
    expect(byRef.size).toBe(3);
    expect(byRef.get(a.data)).toMatchObject({ topic: parseBlobRef(a.data), filename: "a.png", mediaType: "image/png", requestId: first.id });
    expect(byRef.get(b.data)).toMatchObject({ filename: "b.png", mediaType: "image/png", requestId: first.id });
    expect(byRef.get(doc.data)).toMatchObject({ filename: "report.pdf", mediaType: "application/pdf", requestId: second.id });
    for (const entry of entries) expect(typeof entry.recordedAt).toBe("number");
  });

  it("writes nothing for a turn with no files", async () => {
    const { run, listed } = setup();
    expect((await run("with-block", "s1")).status).toBe("completed");
    expect((await listed("s1")).entries).toEqual([]);
  });

  // A retry runs the turn again with the same files: the block finds each key and writes nothing.
  it("lists a retried turn's files once", async () => {
    const { stores, registry, upload, run, settled, listed } = setup({ failFirst: true });
    const shot = await upload(PNG, "image/png", "shot.png");
    const failed = await run("with-block", "s1", [shot]);
    expect(failed.status).toBe("failed");
    expect((await listed("s1")).entries).toHaveLength(1);

    const { newRequestId } = await retryRequest({ originalRequestId: failed.id, stores, flowRegistry: registry, runtimeConfig: {} });
    expect((await settled(newRequestId)).status).toBe("completed");
    const { entries } = await listed("s1");
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ ref: shot.data, requestId: failed.id });
  });

  // The block is the one writer: a model's resource tools or another block can't rewrite the record.
  it("refuses another block's edit, replace or delete of an entry", async () => {
    const { refusals, upload, run, listed } = setup();
    const shot = await upload(PNG, "image/png", "shot.png");
    await run("with-block", "s1", [shot]);
    const tampered = await run("with-block", "s1", undefined, "tamper");
    expect(tampered.status).toBe("completed");
    expect(refusals).toHaveLength(3);
    for (const refusal of refusals) expect(refusal).toMatch(/is read-only/);
    expect((await listed("s1")).entries).toMatchObject([{ ref: shot.data, filename: "shot.png" }]);
  });

  it("goes with the session: after a delete the list and the files are gone", async () => {
    const { upload, run, listed, read, call } = setup();
    const shot = await upload(PNG, "image/png", "shot.png");
    await run("with-block", "s1", [shot]);
    expect((await listed("s1")).entries).toHaveLength(1);

    expect((await call("DELETE", "sessions/s1")).status).toBeLessThan(300);
    expect((await listed("s1")).entries).toEqual([]);
    expect(await read(shot)).toBe(404);
  });

  it("leaves a flow without the block its files, and gives it no list", async () => {
    const { upload, run, manifestRefs, read } = setup();
    const shot = await upload(PNG, "image/png", "shot.png");
    const record = await run("without-block", "s2", [shot]);
    expect(record.status).toBe("completed");
    expect(record.attachments).toEqual([shot]);
    expect(await read(shot)).toBe(200);
    expect((await manifestRefs("s2")).some((r) => r.ref === ATTACHMENTS || r.pattern === `${ATTACHMENTS}/*`)).toBe(false);
  });
});
