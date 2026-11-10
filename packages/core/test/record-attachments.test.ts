/**
 * The attachments block's own contract (spec FIX-2634): it declares the
 * session's `attachments` list itself, so including it is the only wiring; the
 * list is the app's to read and nobody's to rewrite; and it writes one entry
 * per referenced file, references and metadata only.
 *
 * Driven through a hand-built context. The real path (resources bubbling into
 * the flow, the read-only refusals, a retry, the session delete) is the
 * engine's `test/blobs/record-attachments.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { ATTACHMENTS, attachmentsCollection, recordAttachments, toBlobRef } from "../src/attachments";
import type { FileContent } from "../src/items/content";

function memoryList() {
  const entries = new Map<string, Record<string, unknown>>();
  return {
    entries,
    async getOptional(key: string) {
      const state = entries.get(key);
      return state === undefined ? undefined : { state };
    },
    async create(key: string, initial: Record<string, unknown>) {
      if (entries.has(key)) throw new Error(`${key} exists`);
      entries.set(key, initial);
    },
  };
}

const ctxWith = (attachments: FileContent[], list = memoryList()) => ({
  list,
  ctx: { request: { identity: { id: "req_1" }, attachments }, resources: { [ATTACHMENTS]: list } } as never,
});

const ID_A = "b_aaaaaaaaaaaa";
const ID_B = "b_bbbbbbbbbbbb";

describe("recordAttachments", () => {
  it("declares the session's list itself, so a flow that includes it needs no other wiring", () => {
    expect(recordAttachments.declaredResources?.[ATTACHMENTS]).toBe(attachmentsCollection);
    expect(attachmentsCollection).toMatchObject({ pattern: `${ATTACHMENTS}/*`, scope: "session", writable: false });
  });

  // The app reads the list; the model gets no reason to until FIX-2636.
  it("lets the app read the list, and keeps it from the model", () => {
    expect(attachmentsCollection.client?.state?.read).toBe(true);
    expect(attachmentsCollection.llmReadable).not.toBe(true);
  });

  it("writes one entry per file, keyed by blob id, holding the reference and metadata only", async () => {
    const shot: FileContent = { type: "file", mediaType: "image/png", data: toBlobRef(ID_A), filename: "shot.png" };
    const doc: FileContent = { type: "file", mediaType: "application/pdf", data: toBlobRef(ID_B) };
    const { list, ctx } = ctxWith([shot, doc]);
    await recordAttachments.config.execute?.(undefined, ctx);

    expect([...list.entries.keys()]).toEqual([ID_A, ID_B]);
    expect(list.entries.get(ID_A)).toEqual({ ref: shot.data, filename: "shot.png", mediaType: "image/png", requestId: "req_1", recordedAt: expect.any(Number) });
    expect(list.entries.get(ID_B)).toMatchObject({ ref: doc.data, filename: null, mediaType: "application/pdf" });
  });

  it("leaves an entry already listed as it was", async () => {
    const list = memoryList();
    list.entries.set(ID_A, { ref: toBlobRef(ID_A), requestId: "req_0" });
    const { ctx } = ctxWith([{ type: "file", mediaType: "image/png", data: toBlobRef(ID_A) }], list);
    await recordAttachments.config.execute?.(undefined, ctx);
    expect(list.entries.get(ID_A)).toEqual({ ref: toBlobRef(ID_A), requestId: "req_0" });
  });

  // Only a stored file is listed: inline data is never copied into a resource (epic ER-2).
  it("skips a file part that is not a reference", async () => {
    const { list, ctx } = ctxWith([{ type: "file", mediaType: "image/png", data: "aGk=" }]);
    await recordAttachments.config.execute?.(undefined, ctx);
    expect(list.entries.size).toBe(0);
  });
});
