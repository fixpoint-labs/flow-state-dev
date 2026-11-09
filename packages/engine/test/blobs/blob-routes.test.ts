/**
 * FIX-824: a file goes up the upload route once and comes back as a
 * reference; the action that names it claims it into its session after the
 * session check; and the read route serves the bytes only to a caller who can
 * read that session. Another user's read is a 404, as for an id nobody used.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "../../src";
import { createInMemoryStores, declareEphemeralDisk } from "../../src/host";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { parseBlobRef } from "@flow-state-dev/core/attachments";

/** Let an accepted send finish writing its session. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

function chatFlow() {
  return defineFlow({
    kind: "chat",
    actions: {
      send: {
        inputSchema: z.object({ message: z.string() }),
        block: handler({
          name: "chat-send",
          inputSchema: z.object({ message: z.string() }),
          outputSchema: z.object({ ok: z.boolean() }),
          execute: () => ({ ok: true })
        })
      }
    }
  })();
}

function setup(options: { blobs?: boolean } = {}) {
  const registry = createFlowRegistry();
  registry.register(chatFlow());
  const stores: StoreRegistry = {
    ...createInMemoryStores(),
    ...(options.blobs === false ? {} : { blobs: createMemoryBlobStore() })
  };
  const router = createFlowApiRouter({
    registry,
    stores,
    resolvePrincipal: (context) => {
      const user = context.request?.headers.get("x-user");
      return user === null || user === undefined ? null : { userId: user, orgId: "acme" };
    }
  });
  const call = (method: "GET" | "POST" | "DELETE", path: string, user: string | undefined, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (user !== undefined) headers.set("x-user", user);
    const url = new URL(`http://localhost/api/flows/${path}`);
    return router[method](new Request(url, { ...init, method, headers }), {
      params: { path: url.pathname.replace(/^\/api\/flows\//, "").split("/").map(decodeURIComponent) }
    });
  };
  const upload = async (user: string, bytes = PNG, mediaType = "image/png", filename = "shot.png") =>
    call("POST", `blobs?filename=${encodeURIComponent(filename)}`, user, {
      headers: { "content-type": mediaType },
      body: bytes as Uint8Array<ArrayBuffer>
    });
  const send = (user: string, sessionId: string | undefined, attachments: unknown) =>
    call("POST", sessionId === undefined ? "chat/actions/send" : `chat/${sessionId}/actions/send`, user, {
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { message: "look" }, attachments })
    });
  return { router, stores, call, upload, send };
}

async function attachmentOf(response: Response) {
  expect(response.status).toBe(201);
  return ((await response.json()) as { attachment: { type: "file"; mediaType: string; filename?: string; data: string } })
    .attachment;
}

describe("upload route", () => {
  it("stores the bytes once and answers with a reference, not the bytes", async () => {
    const { upload } = setup();
    const attachment = await attachmentOf(await upload("alice"));
    expect(attachment).toMatchObject({ type: "file", mediaType: "image/png", filename: "shot.png" });
    expect(parseBlobRef(attachment.data)).toBeDefined();
  });

  it("refuses a type off the list, an empty body and a file over 20 MB, by name", async () => {
    const { upload } = setup();
    const heic = await upload("alice", PNG, "image/heic", "a.heic");
    expect(heic.status).toBe(415);
    expect(await heic.json()).toMatchObject({ error: "attachment_type_refused" });
    const empty = await upload("alice", new Uint8Array(0));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toMatchObject({ error: "attachment_empty" });
    const big = await upload("alice", new Uint8Array(20 * 1024 * 1024 + 1));
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: "attachment_too_large" });
  });

  it("refuses an anonymous upload where the app authenticates", async () => {
    const { call } = setup();
    const response = await call("POST", "blobs", undefined, { headers: { "content-type": "image/png" }, body: PNG });
    expect(response.status).toBe(401);
  });

  it("refuses by name when the host's disk does not last and the store keeps bytes on it", async () => {
    const { router, upload } = setup();
    declareEphemeralDisk(router);
    const response = await upload("alice");
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: "attachments_unavailable" });
  });

  it("answers attachments_not_configured when the stores have no blob store", async () => {
    const { upload } = setup({ blobs: false });
    const response = await upload("alice");
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: "attachments_not_configured" });
  });
});

describe("claiming and reading", () => {
  it("serves a claimed file to its session's reader, and 404s everyone else", async () => {
    const { call, upload, send } = setup();
    const attachment = await attachmentOf(await upload("alice"));
    const id = parseBlobRef(attachment.data)!;

    // Held, not yet sent: no session owns it, so the read route serves no one.
    expect((await call("GET", `blobs/${id}`, "alice")).status).toBe(404);

    expect((await send("alice", "s_alice", [attachment])).status).toBe(202);
    await settle();

    const mine = await call("GET", `blobs/${id}`, "alice");
    expect(mine.status).toBe(200);
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PNG);
    expect(mine.headers.get("content-type")).toBe("image/png");
    expect(mine.headers.get("x-content-type-options")).toBe("nosniff");
    expect(mine.headers.get("content-disposition")).toMatch(/^inline/);

    const theirs = await call("GET", `blobs/${id}`, "bob");
    expect(theirs.status).toBe(404);
    // The 404 names neither the session nor the owner.
    expect(await theirs.text()).not.toContain("s_alice");
    expect((await call("GET", `blobs/${id}`, undefined)).status).toBe(401);
  });

  it("serves a document as a download, never inline", async () => {
    const { call, upload, send } = setup();
    const pdf = await attachmentOf(await upload("alice", new TextEncoder().encode("%PDF-1.7\n"), "application/pdf", "r.pdf"));
    await send("alice", "s_doc", [pdf]);
    await settle();
    const read = await call("GET", `blobs/${parseBlobRef(pdf.data)!}`, "alice");
    expect(read.headers.get("content-disposition")).toMatch(/^attachment/);
  });

  it("refuses another user's reference as an unknown attachment, and claims nothing", async () => {
    const { stores, upload, send } = setup();
    const attachment = await attachmentOf(await upload("alice"));
    const refused = await send("bob", "s_bob", [attachment]);
    expect(refused.status).toBe(404);
    expect(await refused.json()).toMatchObject({ error: "attachment_not_found", index: 0 });
    expect((await stores.blobs!.head(parseBlobRef(attachment.data)!))?.owner).toBeUndefined();
    expect(await stores.request.list({ sessionId: "s_bob" } as never)).toEqual([]);
  });

  it("refuses a file already sent with another conversation", async () => {
    const { upload, send } = setup();
    const attachment = await attachmentOf(await upload("alice"));
    expect((await send("alice", "s_one", [attachment])).status).toBe(202);
    const again = await send("alice", "s_two", [attachment]);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "attachment_already_sent", index: 0 });
  });

  it("refuses data that is not a stored file's reference, and attachments with no session", async () => {
    const { upload, send } = setup();
    const inline = await send("alice", "s_x", [{ type: "file", mediaType: "image/png", data: "iVBORw0KGgo=" }]);
    expect(inline.status).toBe(400);
    expect(await inline.json()).toMatchObject({ error: "attachment_invalid", index: 0 });
    const attachment = await attachmentOf(await upload("alice"));
    const sessionless = await send("alice", undefined, [attachment]);
    expect(sessionless.status).toBe(400);
    expect(await sessionless.json()).toMatchObject({ error: "attachments_need_session" });
  });

  it("hands the files back when the session check refuses the send", async () => {
    const { stores, upload, send } = setup();
    // Bob's session, which Alice's send is refused into.
    expect((await send("bob", "s_bob", [])).status).toBe(202);
    const attachment = await attachmentOf(await upload("alice"));
    expect((await send("alice", "s_bob", [attachment])).status).toBe(404);
    const id = parseBlobRef(attachment.data)!;
    expect((await stores.blobs!.head(id))?.owner).toBeUndefined();
    expect((await send("alice", "s_alice", [attachment])).status).toBe(202);
  });

  it("deletes a session's files with the session", async () => {
    const { stores, call, upload, send } = setup();
    const attachment = await attachmentOf(await upload("alice"));
    await send("alice", "s_gone", [attachment]);
    await settle();
    expect((await call("DELETE", "sessions/s_gone", "alice")).status).toBe(204);
    const id = parseBlobRef(attachment.data)!;
    expect(await stores.blobs!.head(id)).toBeUndefined();
    expect((await call("GET", `blobs/${id}`, "alice")).status).toBe(404);
  });
});
