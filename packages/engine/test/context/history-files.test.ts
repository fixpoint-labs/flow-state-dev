/**
 * The files a person sent, as a model call sees them (spec FIX-2517 D1).
 *
 * A user line's `file` parts reach the model as image and file parts with the
 * bytes inline, read through the one resolver. Counting back from the newest
 * turn, a call carries up to one message's limits (10 images, 5 documents);
 * an older file is named on its turn as one line of text, so a long chat's
 * call can't grow without bound and a question two turns later still sees
 * the newest screenshots.
 */
import { describe, expect, it } from "vitest";
import { estimateTokenCounter } from "@flow-state-dev/core";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent, MessageItem, OutputItem } from "@flow-state-dev/core/items";
import type { LLMMessage } from "@flow-state-dev/core/types";
import { resolveAttachment, sessionBlobOwner } from "../../src/blobs/attachments";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { newBlobId } from "../../src/blobs/shared";
import { createSessionItemViews, itemToLLMMessages } from "../../src/context/history";
import type { RequestRecord } from "../../src/stores/types";

const ALICE = { userId: "alice", orgId: "acme" };
const OWNER = sessionBlobOwner("s1");

/** A blob store holding files claimed into session `s1`, and a reader of them as the resolver serves them. */
function filesFixture() {
  const blobs = createMemoryBlobStore();
  let n = 0;
  const add = async (mediaType: string, filename: string): Promise<FileContent> => {
    const id = newBlobId();
    n += 1;
    await blobs.put({ id, bytes: new Uint8Array([n, n + 1]), mediaType, filename, uploader: ALICE });
    await blobs.claim(id, { uploader: ALICE, owner: OWNER, send: `send-${n}` });
    return { type: "file", mediaType, data: toBlobRef(id), filename };
  };
  const readAttachment = (file: FileContent) => resolveAttachment(blobs, file, { owner: OWNER, user: ALICE });
  return { blobs, add, readAttachment };
}

function userLine(requestId: string, text: string, files: FileContent[], ts: number): MessageItem {
  return {
    id: `${requestId}_user`,
    type: "message",
    role: "user",
    content: [{ type: "output_text", text }, ...files],
    status: "completed",
    requestId,
    itemIndex: 0,
    provenance: { blockName: "runtime", blockInstanceId: "runtime", phase: "main" },
    ts
  };
}

function turn(id: string, items: OutputItem[], startedAtMs: number): RequestRecord {
  return {
    id,
    flowKind: "chat",
    actionName: "send",
    userId: "alice",
    sessionId: "s1",
    source: "http",
    status: "completed",
    startedAtMs,
    version: 1,
    createdAt: startedAtMs,
    updatedAt: startedAtMs,
    state: {},
    items
  };
}

function history(
  prior: RequestRecord[],
  live: OutputItem[],
  readAttachment?: (file: FileContent) => ReturnType<typeof resolveAttachment>
): Promise<LLMMessage[]> {
  return createSessionItemViews([], prior, {
    tokenCounter: estimateTokenCounter,
    resolveModelId: () => "test-model",
    readLiveItems: () => live,
    ...(readAttachment !== undefined ? { readAttachment } : {})
  }).history();
}

type Part = { type: string; text?: string; image?: unknown; data?: unknown; mediaType?: string; filename?: string };
const parts = (message: LLMMessage | undefined): Part[] => (Array.isArray(message?.content) ? (message!.content as Part[]) : []);
const base64Of = (bytes: number[]) => Buffer.from(bytes).toString("base64");

describe("a user line's files in the history", () => {
  it("keeps a user line with no files as plain text", () => {
    const [message] = itemToLLMMessages(userLine("r1", "hello", [], 1) as unknown as OutputItem, []);
    expect(message).toEqual({ role: "user", content: "hello" });
  });

  it("sends the text first, then each file in the order attached, with its bytes inline", async () => {
    const { add, readAttachment } = filesFixture();
    const shot = await add("image/png", "shot.png");
    const report = await add("application/pdf", "report.pdf");
    const messages = await history([], [userLine("r1", "what is in these?", [shot, report], 1) as unknown as OutputItem], readAttachment);

    expect(messages).toHaveLength(1);
    expect(messages[0]!.role).toBe("user");
    expect(parts(messages[0])).toEqual([
      { type: "text", text: "what is in these?" },
      { type: "image", image: base64Of([1, 2]), mediaType: "image/png" },
      { type: "file", data: base64Of([2, 3]), mediaType: "application/pdf", filename: "report.pdf" }
    ]);
  });

  // The stored type wins over the one the line names: what the provider is
  // told must match the bytes it gets.
  it("types each part by the stored file, not by what the line claims", async () => {
    const { add, readAttachment } = filesFixture();
    const shot = await add("image/png", "shot.png");
    const messages = await history([], [userLine("r1", "look", [{ ...shot, mediaType: "image/gif" }], 1) as unknown as OutputItem], readAttachment);
    expect(parts(messages[0])[1]).toMatchObject({ type: "image", mediaType: "image/png" });
  });

  it("still asks about an image sent two turns ago", async () => {
    const { add, readAttachment } = filesFixture();
    const shot = await add("image/png", "error.png");
    const prior = [
      turn("r1", [userLine("r1", "here is the error", [shot], 100) as unknown as OutputItem], 100),
      turn("r2", [userLine("r2", "and the logs say nothing", [], 200) as unknown as OutputItem], 200)
    ];
    const messages = await history(prior, [userLine("r3", "what was in that screenshot?", [], 300) as unknown as OutputItem], readAttachment);
    expect(parts(messages[0])[1]).toMatchObject({ type: "image", mediaType: "image/png" });
  });

  it("carries the newest ten images and five documents, and names older ones on their turn", async () => {
    const { add, readAttachment } = filesFixture();
    const images = async (k: number, prefix: string) => {
      const out: FileContent[] = [];
      for (let i = 1; i <= k; i += 1) out.push(await add("image/png", `${prefix}-${i}.png`));
      return out;
    };
    const oldest = await images(6, "a");
    const middle = await images(6, "b");
    const docs: FileContent[] = [];
    for (let i = 1; i <= 6; i += 1) docs.push(await add("application/pdf", `doc-${i}.pdf`));
    const newest = await images(6, "c");
    const prior = [
      turn("r1", [userLine("r1", "first", oldest, 100) as unknown as OutputItem], 100),
      turn("r2", [userLine("r2", "second", [...middle, ...docs.slice(0, 1)], 200) as unknown as OutputItem], 200),
      turn("r3", [userLine("r3", "third", docs.slice(1), 300) as unknown as OutputItem], 300)
    ];
    const messages = await history(prior, [userLine("r4", "now", newest, 400) as unknown as OutputItem], readAttachment);

    const sent = (m: LLMMessage | undefined, type: string) => parts(m).filter((p) => p.type === type).length;
    const named = (m: LLMMessage | undefined) => parts(m).filter((p) => p.type === "text" && /not re-sent/.test(p.text ?? "")).map((p) => p.text);

    // Newest turn: all six images. Second turn: the four images left of ten.
    expect(sent(messages[3], "image")).toBe(6);
    expect(sent(messages[1], "image")).toBe(4);
    expect(sent(messages[0], "image")).toBe(0);
    // Documents count apart from images: the five newest go, the oldest is named.
    expect(sent(messages[2], "file")).toBe(5);
    expect(sent(messages[1], "file")).toBe(0);
    expect(named(messages[1])).toEqual(["[image: b-5.png, not re-sent]", "[image: b-6.png, not re-sent]", "[document: doc-1.pdf, not re-sent]"]);
    expect(named(messages[0])).toHaveLength(6);
    // The turn's own text stays first.
    expect(parts(messages[0])[0]).toEqual({ type: "text", text: "first" });
  });

  it("names a file that can no longer be read instead of failing the call", async () => {
    const { blobs, add, readAttachment } = filesFixture();
    const shot = await add("image/png", "gone.png");
    await blobs.deleteOwner(OWNER);
    const messages = await history([], [userLine("r1", "look", [shot], 1) as unknown as OutputItem], readAttachment);
    expect(parts(messages[0])).toEqual([
      { type: "text", text: "look" },
      { type: "text", text: "[image: gone.png, no longer available]" }
    ]);
  });

  it("never hands a reference to the model when there is no way to read it", async () => {
    const { add } = filesFixture();
    const shot = await add("image/png", "shot.png");
    const messages = await history([], [userLine("r1", "look", [shot], 1) as unknown as OutputItem]);
    expect(JSON.stringify(messages)).not.toContain(shot.data);
  });
});
