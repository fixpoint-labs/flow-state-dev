/**
 * Files kept in a person's own scope (FIX-2522; epic FIX-2516 ER-7). A record
 * that outlives the turn its files came with (a task's brief on a
 * conversation's board, at the user scope) keeps copies through core's
 * `keepAttachmentsForUser`. The copies matter because the brief must reach
 * every run of the task, and each run is a request in another session than
 * the turn that filed it: a session-only reader would hand the re-run
 * nothing. So a kept copy reads in any of the person's sessions, through the
 * read route and on a line a flow hands it (`userMessage`'s `attachments`),
 * outlives the turn's session, and reads for nobody else.
 */
import { defineFlow, handler } from "@flow-state-dev/core";
import { parseBlobRef } from "@flow-state-dev/core/attachments";
import { readHarnessAttachments } from "@flow-state-dev/core/harness";
import { discardAttachmentsForUser, keepAttachmentsForUser, UserAttachmentsUnavailableError } from "@flow-state-dev/core/internal";
import type { FileContent } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "../../src";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { createInMemoryStores } from "../../src/host";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 8, 7, 6]);

const byHeader = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  return user === null || user === undefined ? null : { userId: user, orgId: "acme" };
};

const message = z.object({ message: z.string() });

/**
 * `auth: "host"` authenticates every route through the host's resolver;
 * `"flow"` only through the flow's own (`authentication.resolvePrincipal`),
 * the host keeping the framework default, so a route that addresses no flow
 * has no resolver of its own to pick. `"open"` authenticates nothing: the
 * caller names themselves, in the default organization.
 */
function setup(withBlobs = true, auth: "host" | "flow" | "open" = "host") {
  /** What `keep` kept last, as a server-held record would (a task). */
  const kept: { files: FileContent[]; error?: unknown } = { files: [] };
  /** What `run` read of the kept files, as a harness adapter reads them. */
  const read: { base64?: string[]; error?: unknown } = {};
  const keep = handler({
    name: "keep",
    inputSchema: message,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (_value, ctx) => {
      try {
        kept.files = await keepAttachmentsForUser(ctx, ctx.request.attachments);
      } catch (error) {
        kept.error = error;
      }
      return { ok: true };
    },
  });
  /** What `drop` is handed: the kept files, and any other reference a test adds. */
  const dropping: { files: FileContent[] } = { files: [] };
  const drop = handler({
    name: "drop",
    inputSchema: message,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (_value, ctx) => {
      await discardAttachmentsForUser(ctx, dropping.files);
      return { ok: true };
    },
  });
  const run = handler({
    name: "run",
    inputSchema: message,
    outputSchema: z.object({ ok: z.boolean() }),
    execute: async (_value, ctx) => {
      try {
        read.base64 = (await readHarnessAttachments(ctx, kept.files)).map((file) => file.base64());
      } catch (error) {
        read.error = error;
      }
      return { ok: true };
    },
  });
  const registry = createFlowRegistry();
  registry.register(
    defineFlow({
      kind: "board",
      ...(auth === "flow" ? { authentication: { resolvePrincipal: byHeader } } : {}),
      actions: {
        keep: { inputSchema: message, block: keep, userMessage: (i) => i.message },
        // The line a run opens with carries the kept files, read off server-held state, never the input.
        run: { inputSchema: message, block: run, userMessage: (i) => ({ text: i.message, attachments: kept.files }) },
        drop: { inputSchema: message, block: drop, userMessage: (i) => i.message },
      },
    })(),
  );
  const stores: StoreRegistry = { ...createInMemoryStores(), ...(withBlobs ? { blobs: createMemoryBlobStore() } : {}) };
  const router = createFlowApiRouter({ registry, stores, ...(auth === "host" ? { resolvePrincipal: byHeader } : {}) });
  /** `user` `null` sends no credential: an anonymous caller. */
  const call = (method: "GET" | "POST" | "DELETE", path: string, user: string | null, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (user !== null) headers.set("x-user", user);
    const url = new URL(`http://localhost/api/flows/${path}`);
    return router[method](new Request(url, { ...init, method, headers }), {
      params: { path: url.pathname.replace(/^\/api\/flows\//, "").split("/").map(decodeURIComponent) },
    });
  };
  const upload = async (user: string): Promise<FileContent> => {
    const who = auth === "open" ? `&userId=${user}` : "";
    const response = await call("POST", `${auth === "flow" ? "board/" : ""}blobs?filename=shot.png${who}`, user, { headers: { "content-type": "image/png" }, body: PNG as Uint8Array<ArrayBuffer> });
    expect(response.status).toBe(201);
    return ((await response.json()) as { attachment: FileContent }).attachment;
  };
  const send = async (user: string, session: string, action: "keep" | "run" | "drop", attachments?: FileContent[]) => {
    const response = await call("POST", `board/${session}/actions/${action}`, user, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        input: { message: action },
        ...(auth === "open" ? { userId: user } : {}),
        ...(attachments !== undefined ? { attachments } : {}),
      }),
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
  return { kept, read, dropping, stores, call, upload, send };
}

describe("files kept in a person's own scope", () => {
  it("are copies, under ids of their own, readable in another of that person's sessions", async () => {
    const { kept, read, upload, send } = setup();
    const shot = await upload("alice");
    await send("alice", "s_chat", "keep", [shot]);
    expect(kept.error).toBeUndefined();
    expect(kept.files).toHaveLength(1);
    expect(kept.files[0]).toMatchObject({ type: "file", mediaType: "image/png", filename: "shot.png" });
    expect(parseBlobRef(kept.files[0]!.data)).not.toBe(parseBlobRef(shot.data));
    // A run in a session of its own reads them: what a task's every run needs.
    await send("alice", "s_run_1", "run");
    await send("alice", "s_run_2", "run");
    expect(read.error).toBeUndefined();
    expect(read.base64).toEqual([Buffer.from(PNG).toString("base64")]);
  });

  it("ride the line a flow hands them to, after the person's own", async () => {
    const { kept, call, upload, send } = setup();
    await send("alice", "s_chat", "keep", [await upload("alice")]);
    const own = await upload("alice");
    await send("alice", "s_run", "run", [own]);
    const state = (await (await call("GET", "sessions/s_run/state?include_items=true", "alice")).json()) as {
      items: Array<{ type: string; role?: string; content?: Array<{ type: string; data?: string }> }>;
    };
    const line = state.items.find((item) => item.type === "message" && item.role === "user");
    expect(line?.content?.filter((part) => part.type === "file").map((part) => part.data)).toEqual([own.data, kept.files[0]!.data]);
  });

  it("serve through the read route to their person, and to nobody else", async () => {
    const { kept, call, upload, send } = setup();
    await send("alice", "s_chat", "keep", [await upload("alice")]);
    const id = parseBlobRef(kept.files[0]!.data)!;
    const mine = await call("GET", `blobs/${id}`, "alice");
    expect(mine.status).toBe(200);
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PNG);
    expect((await call("GET", `blobs/${id}`, "bob")).status).toBe(404);
  });

  it("outlive the turn's session, whose own file goes with it", async () => {
    const { kept, read, call, upload, send } = setup();
    const shot = await upload("alice");
    await send("alice", "s_chat", "keep", [shot]);
    expect((await call("DELETE", "sessions/s_chat", "alice")).status).toBe(204);
    expect((await call("GET", `blobs/${parseBlobRef(shot.data)!}`, "alice")).status).toBe(404);
    expect((await call("GET", `blobs/${parseBlobRef(kept.files[0]!.data)!}`, "alice")).status).toBe(200);
    await send("alice", "s_run", "run");
    expect(read.base64).toHaveLength(1);
  });

  it("read nothing in another person's run", async () => {
    const { read, upload, send } = setup();
    await send("alice", "s_chat", "keep", [await upload("alice")]);
    await send("bob", "s_bob", "run");
    expect(read.base64).toBeUndefined();
    expect((read.error as Error).name).toBe("HarnessAttachmentUnavailableError");
  });

  it("are dropped again by their user's run, which can drop no other file", async () => {
    const { kept, dropping, call, upload, send } = setup();
    const shot = await upload("alice");
    await send("alice", "s_chat", "keep", [shot]);
    // Bob's own kept copy, and Alice's turn file: neither is a copy of Alice's to drop.
    const theirs = { ...kept };
    await send("bob", "s_bob", "keep", [await upload("bob")]);
    const bobs = kept.files;
    dropping.files = [...theirs.files, ...bobs, shot];
    await send("alice", "s_drop", "drop");
    expect((await call("GET", `blobs/${parseBlobRef(theirs.files[0]!.data)!}`, "alice")).status).toBe(404);
    expect((await call("GET", `blobs/${parseBlobRef(bobs[0]!.data)!}`, "bob")).status).toBe(200);
    expect((await call("GET", `blobs/${parseBlobRef(shot.data)!}`, "alice")).status).toBe(200);
  });

  it("can't be kept on a server with no blob store, and say so", async () => {
    const { kept, send } = setup(false);
    await send("alice", "s_chat", "keep");
    // No files: nothing to keep, and no refusal.
    expect(kept.error).toBeUndefined();
    expect(kept.files).toEqual([]);
    await expect(keepAttachmentsForUser({}, [{ type: "file", mediaType: "image/png", data: "fsd" }])).rejects.toBeInstanceOf(
      UserAttachmentsUnavailableError,
    );
  });
});

// The read route has no flow in its address, so a kept file must be read
// under the sign-in of the flow that kept it: with authentication only on the
// flow, the host's default resolver verifies nobody.
describe("a kept file's read, where only the flow authenticates", () => {
  it("serves its person, in their organization", async () => {
    const { kept, call, upload, send } = setup(true, "flow");
    await send("alice", "s_chat", "keep", [await upload("alice")]);
    expect(kept.error).toBeUndefined();
    const mine = await call("GET", `blobs/${parseBlobRef(kept.files[0]!.data)!}`, "alice");
    expect(mine.status).toBe(200);
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PNG);
  });

  it("is no file at all to another user, or to a caller with no credential", async () => {
    const { kept, call, upload, send } = setup(true, "flow");
    await send("alice", "s_chat", "keep", [await upload("alice")]);
    const id = parseBlobRef(kept.files[0]!.data)!;
    const unknown = await call("GET", "blobs/b_nobodyuploadedthis", null);
    for (const caller of ["bob", null]) {
      const response = await call("GET", `blobs/${id}`, caller);
      expect(response.status).toBe(404);
      // The same answer as an id nobody has used: nothing says the file exists.
      expect(await response.json()).toEqual(await unknown.clone().json());
    }
  });
});

describe("a kept file's read, where the host authenticates", () => {
  it("is no file at all to a caller with no credential", async () => {
    const { kept, call, upload, send } = setup();
    await send("alice", "s_chat", "keep", [await upload("alice")]);
    expect((await call("GET", `blobs/${parseBlobRef(kept.files[0]!.data)!}`, null)).status).toBe(404);
  });
});

// The flow that kept a file names the sign-in its read is checked under. An
// app that no longer runs that flow, while another flow authenticates, has
// nobody it can show is the file's user: its default resolver would let any
// caller through, so the file is answered as no file at all.
describe("a kept file whose keeping flow is gone", () => {
  it("is no file at all, where another flow authenticates", async () => {
    const { kept, stores, upload, send } = setup(true, "open");
    await send("alice", "s_chat", "keep", [await upload("alice")]);
    expect(kept.error).toBeUndefined();
    const registry = createFlowRegistry();
    registry.register(
      defineFlow({
        kind: "desk",
        authentication: { resolvePrincipal: byHeader },
        actions: { noop: { inputSchema: message, block: handler({ name: "noop", inputSchema: message, outputSchema: message, execute: (value) => value }) } },
      })(),
    );
    const router = createFlowApiRouter({ registry, stores });
    const read = (blobId: string, user: string | null) =>
      router.GET(
        new Request(`http://localhost/api/flows/blobs/${blobId}`, { headers: user === null ? {} : { "x-user": user } }),
        { params: { path: ["blobs", blobId] } },
      );
    const unknown = await (await read("b_nobodyuploadedthis", null)).json();
    for (const caller of ["alice", null]) {
      const response = await read(parseBlobRef(kept.files[0]!.data)!, caller);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual(unknown);
    }
  });
});
