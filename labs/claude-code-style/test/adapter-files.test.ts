/**
 * The adapter's half of attachments: a line's files reach the worker's door as
 * the send's `attachments`, beside `{ message }`, which stays as it is; an
 * upload is the client's; a line's file parts come back on your line; and a
 * thumbnail's bytes are read through the page's own fetch, which carries the
 * bearer token a plain image request can't. Without the first, the composer
 * shows files the worker never gets.
 */
import type { Client } from "@flow-state-dev/client";
import type { FileContent } from "@flow-state-dev/core/items";
import { describe, expect, it } from "vitest";
import { createWiredLab, entriesOf, type Item } from "../src/adapter";

const SHOT: FileContent = { type: "file", data: "fsd-blob:b_0123456789", mediaType: "image/png", filename: "bug.png" };

function fakeClient() {
  const sends: Array<{ action: string; input: unknown; options: Record<string, unknown> }> = [];
  const uploads: unknown[] = [];
  const client = {
    sessions: { get: async (id: string) => ({ id, flowKind: "desk-main" }) },
    flow: () => ({
      send: async (action: string, input: unknown, options: Record<string, unknown>) => {
        sends.push({ action, input, options });
        return { id: "r1" };
      },
    }),
    upload: async (request: unknown) => {
      uploads.push(request);
      return SHOT;
    },
  } as unknown as Client;
  return { client, sends, uploads };
}

describe("the adapter's files", () => {
  it("sends a line's files beside its message, through the worker's door", async () => {
    const lab = fakeClient();
    await createWiredLab(lab.client).send("s1", "What does this show?", [SHOT]);
    expect(lab.sends).toEqual([{ action: "respond", input: { message: "What does this show?" }, options: { sessionId: "s1", attachments: [SHOT] } }]);
  });

  it("uploads through the client, and reads a file's bytes with the page's fetch under its base path", async () => {
    const lab = fakeClient();
    const asked: string[] = [];
    const fetcher = async (url: string) => {
      asked.push(url);
      return new Response(new Blob(["png"]), { status: 200 });
    };
    const adapter = createWiredLab(lab.client, { basePath: "/lab", fetcher });
    const blob = new Blob(["x"], { type: "image/png" });
    expect(await adapter.upload({ data: blob, mediaType: "image/png", filename: "bug.png" })).toBe(SHOT);
    expect(lab.uploads).toEqual([{ data: blob, mediaType: "image/png", filename: "bug.png" }]);
    expect(await (await adapter.readFile(SHOT)).text()).toBe("png");
    expect(asked).toEqual(["/lab/api/flows/blobs/b_0123456789"]);
  });

  it("says so when the server won't serve a file, so the line draws its chip", async () => {
    const adapter = createWiredLab(fakeClient().client, { fetcher: async () => new Response(null, { status: 404 }) });
    await expect(adapter.readFile(SHOT)).rejects.toThrow("bug.png couldn't be read (404).");
  });

  it("puts a line's file parts on your line, and none on a line without them", () => {
    const items: Item[] = [
      { id: "u1", type: "message", role: "user", requestId: "r1", content: [{ type: "text", text: "Look" }, SHOT] },
      { id: "u2", type: "message", role: "user", requestId: "r2", content: [{ type: "text", text: "Thanks" }] },
    ];
    expect(entriesOf(items)).toEqual([
      { kind: "user", id: "u1", text: "Look", requestId: "r1", files: [SHOT] },
      { kind: "user", id: "u2", text: "Thanks", requestId: "r2" },
    ]);
  });
});
