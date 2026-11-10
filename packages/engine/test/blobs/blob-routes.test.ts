/**
 * FIX-824: a file goes up the upload route once and comes back as a
 * reference; the action that names it claims it into its session after the
 * session check; and the read route serves the bytes only to a caller who can
 * read that session. Another user's read is a 404, as for an id nobody used.
 */
import { describe, expect, it, vi } from "vitest";
import { defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "../../src";
import { createInMemoryStores, declareEphemeralDisk } from "../../src/host";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { ATTACHMENT_LIMITS, parseBlobRef } from "@flow-state-dev/core/attachments";
import { pdfTextBlobId } from "../../src/blobs/pdf-text";
import { makePdf } from "./pdf-fixture";
import { AttachmentUnavailableError, resolveAttachment, sessionBlobOwner } from "../../src/blobs/attachments";

/** Let an accepted send finish writing its session. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

/** Who is asking: the `x-user` header, in organization `acme`. */
const byHeader = (context: { request?: Request }) => {
  const user = context.request?.headers.get("x-user");
  return user === null || user === undefined ? null : { userId: user, orgId: "acme" };
};

function chatFlow(authenticated = false) {
  return defineFlow({
    kind: "chat",
    ...(authenticated ? { authentication: { resolvePrincipal: byHeader } } : {}),
    actions: {
      send: {
        inputSchema: z.object({ message: z.string() }),
        // Files ride on the user line, so an action that takes them writes one.
        userMessage: (input: { message: string }) => input.message,
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

/**
 * `flowAuth`: the flow authenticates its own callers and the host resolver is
 * left at its default, so only a route governed by the flow knows who asks.
 */
function setup(options: { blobs?: boolean; flowAuth?: boolean } = {}) {
  const registry = createFlowRegistry();
  registry.register(chatFlow(options.flowAuth === true));
  const stores: StoreRegistry = {
    ...createInMemoryStores(),
    ...(options.blobs === false ? {} : { blobs: createMemoryBlobStore() })
  };
  const router = createFlowApiRouter({
    registry,
    stores,
    ...(options.flowAuth === true ? {} : { resolvePrincipal: byHeader })
  });
  const call = (method: "GET" | "POST" | "DELETE", path: string, user: string | undefined, init: RequestInit = {}) => {
    const headers = new Headers(init.headers);
    if (user !== undefined) headers.set("x-user", user);
    const url = new URL(`http://localhost/api/flows/${path}`);
    return router[method](new Request(url, { ...init, method, headers }), {
      params: { path: url.pathname.replace(/^\/api\/flows\//, "").split("/").map(decodeURIComponent) }
    });
  };
  const upload = async (user: string, bytes = PNG, mediaType = "image/png", filename = "shot.png", flow?: string) =>
    call("POST", `${flow === undefined ? "" : `${flow}/`}blobs?filename=${encodeURIComponent(filename)}`, user, {
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

// FIX-2520: what a document must be to be stored at all, refused by name at
// upload so nothing over a limit ever reaches a send.
describe("documents at upload", () => {
  const text = (s: string) => new TextEncoder().encode(s);

  it("takes a text-like file whole up to 200 KB, and refuses one byte over with its size, never cut", async () => {
    const { upload } = setup();
    const atCap = await upload("alice", new Uint8Array(ATTACHMENT_LIMITS.maxTextBytes).fill(0x61), "text/plain", "a.txt");
    expect(atCap.status).toBe(201);
    const over = await upload("alice", new Uint8Array(250 * 1024).fill(0x61), "text/plain", "big.txt");
    expect(over.status).toBe(413);
    const body = (await over.json()) as { error: string; message: string };
    expect(body.error).toBe("attachment_text_too_large");
    expect(body.message).toContain("250 KB");
    expect(body.message).toContain("200 KB");
  });

  it("refuses a text-like file that is not UTF-8 text", async () => {
    const { upload } = setup();
    const nul = await upload("alice", text("a\u0000b"), "text/csv", "x.csv");
    expect(nul.status).toBe(415);
    expect(await nul.json()).toMatchObject({ error: "attachment_not_text" });
    const latin1 = await upload("alice", new Uint8Array([0x63, 0x61, 0x66, 0xe9]), "text/plain", "x.txt");
    expect(latin1.status).toBe(415);
  });

  it("refuses Word, Excel and PowerPoint by type", async () => {
    const { upload } = setup();
    const docx = await upload("alice", text("PK"), "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "r.docx");
    expect(docx.status).toBe(415);
    expect(await docx.json()).toMatchObject({ error: "attachment_type_refused" });
  });

  it("stores a PDF's text beside it, page by page, and claims it with the PDF into the same session", async () => {
    const { stores, upload, send } = setup();
    const pdf = await attachmentOf(await upload("alice", makePdf(["intro", "code word TANGERINE"]), "application/pdf", "spec.pdf"));
    const id = parseBlobRef(pdf.data)!;
    const stored = await stores.blobs!.read(pdfTextBlobId(id));
    expect(new TextDecoder().decode(stored!.bytes)).toBe("[page 1]\nintro\n\n[page 2]\ncode word TANGERINE");
    expect(stored!.record.owner).toBeUndefined();

    await send("alice", "s_pdf", [pdf]);
    await settle();
    expect((await stores.blobs!.head(pdfTextBlobId(id)))?.owner).toBe(sessionBlobOwner("s_pdf"));
  });

  it("refuses a PDF over 100 pages, and bytes that are no PDF, storing nothing", async () => {
    const { stores, upload } = setup();
    const put = vi.spyOn(stores.blobs!, "put");
    const long = await upload("alice", makePdf(Array.from({ length: 101 }, (_, i) => `p${i}`)), "application/pdf", "long.pdf");
    expect(long.status).toBe(413);
    const body = (await long.json()) as { error: string; message: string };
    expect(body.error).toBe("pdf_too_many_pages");
    expect(body.message).toContain("101");
    const junk = await upload("alice", text("%PDF-1.7\n"), "application/pdf", "junk.pdf");
    expect(junk.status).toBe(415);
    expect(await junk.json()).toMatchObject({ error: "pdf_unreadable" });
    expect(put).not.toHaveBeenCalled();
  });

  // The text kept beside a PDF is the server's, not an upload: named as a
  // text file of its own it would go whole to a model, past the text cap.
  it("refuses a PDF's stored text named as an attachment of its own, and claims nothing", async () => {
    const { stores, upload, send } = setup();
    const pdf = await attachmentOf(await upload("alice", makePdf(["x"]), "application/pdf", "r.pdf"));
    const textId = pdfTextBlobId(parseBlobRef(pdf.data)!);
    const refused = await send("alice", "s_side", [{ type: "file", mediaType: "text/plain", data: `fsd-blob:${textId}` }]);
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ error: "attachment_invalid", index: 0 });
    expect((await stores.blobs!.head(textId))?.owner).toBeUndefined();
  });

  it("deletes a PDF's text with its session", async () => {
    const { stores, call, upload, send } = setup();
    const pdf = await attachmentOf(await upload("alice", makePdf(["x"]), "application/pdf", "r.pdf"));
    await send("alice", "s_gone", [pdf]);
    await settle();
    const textId = pdfTextBlobId(parseBlobRef(pdf.data)!);
    expect((await stores.blobs!.head(textId))?.owner).toBe(sessionBlobOwner("s_gone"));
    expect((await call("DELETE", "sessions/s_gone", "alice")).status).toBe(204);
    expect(await stores.blobs!.head(textId)).toBeUndefined();
  });
});

describe("claiming and reading", () => {
  it("serves a claimed file to its session's reader, and 404s everyone else", async () => {
    const { stores, call, upload, send } = setup();
    const attachment = await attachmentOf(await upload("alice"));
    const id = parseBlobRef(attachment.data)!;

    // Held, not yet sent: no session owns it, so the read route serves no one.
    expect((await call("GET", `blobs/${id}`, "alice")).status).toBe(404);

    expect((await send("alice", "s_alice", [attachment])).status).toBe(202);
    await settle();
    // Admitted, so no later refused send naming it can hand it back.
    expect((await stores.blobs!.head(id))?.admitted).toBe(true);

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
    const pdf = await attachmentOf(await upload("alice", makePdf(["r"]), "application/pdf", "r.pdf"));
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

  // Confirming is bookkeeping after the request already runs. A 500 there would
  // tell the client its send failed, and a retry would start a second run.
  it("answers an admitted send as accepted even when confirming its files fails", async () => {
    const { stores, upload, send } = setup();
    const attachment = await attachmentOf(await upload("alice"));
    stores.blobs!.confirm = () => Promise.reject(new Error("disk full"));
    expect((await send("alice", "s_alice", [attachment])).status).toBe(202);
    await settle();
    // Still pending, so no refused send can hand it back: it stays in the session.
    expect((await stores.blobs!.head(parseBlobRef(attachment.data)!))?.owner).toBe(sessionBlobOwner("s_alice"));
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

describe("a claim racing a session's rebirth", () => {
  it("never serves a file to a session owner who did not upload it", async () => {
    const { stores, call, upload, send } = setup();
    const attachment = await attachmentOf(await upload("alice"));
    const id = parseBlobRef(attachment.data)!;
    // Alice's straggling send claims her file into `s_taken` after the purge of
    // Bob's create has run and before his session is written: the one window
    // the purge cannot see.
    const set = stores.session.set.bind(stores.session);
    let raced = false;
    stores.session.set = (async (...args: Parameters<typeof set>) => {
      if (!raced) {
        raced = true;
        const claim = { uploader: { userId: "alice", orgId: "acme" }, owner: sessionBlobOwner("s_taken"), send: "late-send" };
        expect(await stores.blobs!.claim(id, claim)).toBe("claimed");
      }
      return set(...args);
    }) as typeof set;
    expect((await send("bob", "s_taken", [])).status).toBe(202);
    await settle();
    expect(raced).toBe(true);
    expect((await stores.blobs!.head(id))?.owner).toBe(sessionBlobOwner("s_taken"));

    expect((await call("GET", `blobs/${id}`, "bob")).status).toBe(404);
    // Nor can a block of Bob's session resolve it.
    const bobs = { owner: sessionBlobOwner("s_taken"), user: { userId: "bob", orgId: "acme" } };
    await expect(resolveAttachment(stores.blobs!, attachment, bobs)).rejects.toBeInstanceOf(AttachmentUnavailableError);
  });
});

describe("an upload for a flow that authenticates its own callers", () => {
  it("records the uploader the flow's resolver names, so the flow's send can claim it", async () => {
    const { call, upload, send } = setup({ flowAuth: true });
    const attachment = await attachmentOf(await upload("alice", PNG, "image/png", "shot.png", "chat"));
    expect((await send("alice", "s_flow", [attachment])).status).toBe(202);
    await settle();
    const id = parseBlobRef(attachment.data)!;
    expect((await call("GET", `blobs/${id}`, "alice")).status).toBe(200);
    expect((await call("GET", `blobs/${id}`, "bob")).status).toBe(404);
  });

  it("refuses an anonymous upload through the flow, and an upload to a flow that is not here", async () => {
    const { call, upload } = setup({ flowAuth: true });
    const response = await call("POST", "chat/blobs", undefined, { headers: { "content-type": "image/png" }, body: PNG });
    expect(response.status).toBe(401);
    expect((await upload("alice", PNG, "image/png", "shot.png", "nope")).status).toBe(404);
  });
});

describe("a long file name", () => {
  it("keeps whole characters when it cuts a name to 255, so the file still downloads", async () => {
    const { call, upload, send } = setup();
    const name = `${"a".repeat(254)}\u{1F600}`;
    const attachment = await attachmentOf(await upload("alice", PNG, "image/png", name));
    expect(attachment.filename).toBe(name);
    await send("alice", "s_name", [attachment]);
    await settle();
    const read = await call("GET", `blobs/${parseBlobRef(attachment.data)!}`, "alice");
    expect(read.status).toBe(200);
    expect(read.headers.get("content-disposition")).toContain(encodeURIComponent(name));
  });
});
