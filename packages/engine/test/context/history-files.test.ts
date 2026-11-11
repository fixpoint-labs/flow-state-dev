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
import { ATTACHMENT_LIMITS, AttachmentTextTooLargeError, toBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent, MessageItem, OutputItem } from "@flow-state-dev/core/items";
import type { LLMMessage } from "@flow-state-dev/core/types";
import { resolveAttachment, sessionBlobOwner } from "../../src/blobs/attachments";
import { createMemoryBlobStore } from "../../src/blobs/memory-blob-store";
import { pdfTextBlobId } from "../../src/blobs/pdf-text";
import { newBlobId } from "../../src/blobs/shared";
import { makePdf } from "../blobs/pdf-fixture";
import { createSessionItemViews, itemToLLMMessages } from "../../src/context/history";
import { resolveHistoryFiles } from "../../src/context/history-files";
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

/** The session's history as a block reads it: files budgeted, still references. */
function read(prior: RequestRecord[], live: OutputItem[]): Promise<LLMMessage[]> {
  return createSessionItemViews([], prior, {
    tokenCounter: estimateTokenCounter,
    resolveModelId: () => "test-model",
    readLiveItems: () => live
  }).history();
}

/** The same history as the model call gets it: read, then each reference resolved. */
async function history(
  prior: RequestRecord[],
  live: OutputItem[],
  readAttachment?: (file: FileContent) => ReturnType<typeof resolveAttachment>
): Promise<LLMMessage[]> {
  return (await resolveHistoryFiles(await read(prior, live), readAttachment, undefined, [])) as LLMMessage[];
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

  // A block's history read is recorded (a generator's trace, a tool loop's
  // prelude): it carries the reference, and only the model call reads bytes.
  it("keeps references in the history a block reads, and leaves them untouched when resolving", async () => {
    const { add, readAttachment } = filesFixture();
    const shot = await add("image/png", "shot.png");
    const read1 = await read([], [userLine("r1", "look", [shot], 1) as unknown as OutputItem]);
    expect(parts(read1[0])).toEqual([{ type: "text", text: "look" }, shot]);
    const resolved = await resolveHistoryFiles(read1, readAttachment, undefined, [shot]);
    expect(parts(resolved[0] as LLMMessage)[1]).toMatchObject({ type: "image" });
    expect(parts(read1[0])[1]).toEqual(shot);
    // A call whose files are already bytes is passed through, not read again.
    expect(await resolveHistoryFiles(resolved, readAttachment, undefined, [shot])).toBe(resolved);
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

// FIX-2520: a document reaches each model as the provider reads it. A
// text-like file is text everywhere; a PDF is a file where the provider reads
// PDFs, and its extracted text everywhere else.
describe("a user line's documents, by what the model reads", () => {
  const READS_PDF = ["image/png", "application/pdf"] as const;
  const IMAGES_ONLY = ["image/png"] as const;

  async function documentFixture() {
    const { blobs, readAttachment } = filesFixture();
    let n = 0;
    const put = async (bytes: Uint8Array, mediaType: string, filename: string, id = newBlobId()): Promise<FileContent> => {
      n += 1;
      await blobs.put({ id, bytes, mediaType, filename, uploader: ALICE });
      await blobs.claim(id, { uploader: ALICE, owner: OWNER, send: `doc-${n}` });
      return { type: "file", mediaType, data: toBlobRef(id), filename };
    };
    /** A PDF stored as the upload route stores one: its text beside it. */
    const pdf = async (filename: string, text: string) => {
      const id = newBlobId();
      await put(new TextEncoder().encode(text), "text/plain", `${filename}.txt`, pdfTextBlobId(id));
      return put(makePdf(["original bytes"]), "application/pdf", filename, id);
    };
    const line = (files: FileContent[]) => [userLine("r1", "what does it say?", files, 1) as unknown as OutputItem];
    const call = async (files: FileContent[], accepts: ReadonlyArray<string> | undefined) =>
      parts(
        ((await resolveHistoryFiles(
          await read([], line(files)),
          readAttachment,
          accepts === undefined ? undefined : { accepts: accepts as never },
          files
        )) as LLMMessage[])[0]
      );
    return { put, pdf, call, readAttachment };
  }

  it("sends a text-like file as text headed by its name, to a provider that reads PDFs and one that doesn't", async () => {
    const { put, call } = await documentFixture();
    const csv = await put(new TextEncoder().encode("ts,level\n1,error TANGERINE"), "text/csv", "errors.csv");
    for (const accepts of [READS_PDF, IMAGES_ONLY]) {
      expect((await call([csv], accepts))[1]).toEqual({ type: "text", text: "### errors.csv\nts,level\n1,error TANGERINE" });
    }
  });

  // Upload refuses a text file over the cap; one that is in the store anyway
  // (written by another path) still never goes to a model whole.
  it("fails the turn on a stored text-like file over the text cap, naming it", async () => {
    const { put, call } = await documentFixture();
    const big = await put(new Uint8Array(ATTACHMENT_LIMITS.maxTextBytes + 1).fill(97), "text/plain", "huge.log");
    await expect(call([big], IMAGES_ONLY)).rejects.toMatchObject({ code: "text_too_large", filename: "huge.log" });
  });

  it("sends a PDF as a file where the provider reads PDFs, and as its stored text where it doesn't", async () => {
    const { pdf, call } = await documentFixture();
    const spec = await pdf("spec.pdf", "[page 1]\nintro\n\n[page 3]\ncode word TANGERINE");
    expect((await call([spec], READS_PDF))[1]).toMatchObject({ type: "file", mediaType: "application/pdf", filename: "spec.pdf" });
    expect((await call([spec], IMAGES_ONLY))[1]).toEqual({
      type: "text",
      text: "### spec.pdf\n[page 1]\nintro\n\n[page 3]\ncode word TANGERINE"
    });
  });

  it("extracts a PDF's text at the call when it was stored before texts were kept", async () => {
    const { put, call } = await documentFixture();
    const old = await put(makePdf(["code word TANGERINE"]), "application/pdf", "old.pdf");
    expect((await call([old], IMAGES_ONLY))[1]).toEqual({ type: "text", text: "### old.pdf\n[page 1]\ncode word TANGERINE" });
  });

  // D2 holds for a PDF's text: refused, never cut, and only where text is sent.
  it("refuses a PDF whose text is over 200 KB where text is sent, and still sends the PDF where it is read", async () => {
    const { pdf, call } = await documentFixture();
    const dense = await pdf("dense.pdf", "x".repeat(ATTACHMENT_LIMITS.maxTextBytes + 1));
    await expect(call([dense], IMAGES_ONLY)).rejects.toBeInstanceOf(AttachmentTextTooLargeError);
    expect((await call([dense], READS_PDF))[1]).toMatchObject({ type: "file", mediaType: "application/pdf" });
  });

  // A refusal is for the turn that sent the file. An older line's PDF that
  // can't go as text names itself on its turn, or every later turn of the
  // session would fail on it (a model switched mid-session; a PDF stored
  // before texts were kept that can't be opened).
  it("names an older turn's PDF that can't go as text, and still answers the newest turn", async () => {
    const { put, pdf, readAttachment } = await documentFixture();
    const dense = await pdf("dense.pdf", "x".repeat(ATTACHMENT_LIMITS.maxTextBytes + 1));
    const broken = await put(new Uint8Array([0x25, 0x50, 0x44, 0x46, 9]), "application/pdf", "broken.pdf");
    const prior = [
      turn("r1", [userLine("r1", "here are two", [dense, broken], 100) as unknown as OutputItem], 100)
    ];
    const live = [userLine("r2", "and now?", [], 200) as unknown as OutputItem];
    const messages = (await resolveHistoryFiles(await read(prior, live), readAttachment, { accepts: IMAGES_ONLY as never }, [])) as LLMMessage[];
    expect(parts(messages[0])).toEqual([
      { type: "text", text: "here are two" },
      { type: "text", text: "[document: dense.pdf, too much text to re-send]" },
      { type: "text", text: "[document: broken.pdf, can't be read as text]" }
    ]);
    expect(messages.at(-1)).toMatchObject({ role: "user", content: "and now?" });
  });

  // A generator may add its own user line after the history (a planner's
  // "Original request: …"): the turn being answered is the one whose files
  // the request sent, not whichever user line comes last.
  it("refuses the call on the request's own PDF that can't go as text, though a prompt line follows it", async () => {
    const { pdf, readAttachment } = await documentFixture();
    const dense = await pdf("dense.pdf", "x".repeat(ATTACHMENT_LIMITS.maxTextBytes + 1));
    const messages = [
      ...(await read([], [userLine("r1", "read this", [dense], 100) as unknown as OutputItem])),
      { role: "user", content: "Original request: read this" }
    ];
    await expect(resolveHistoryFiles(messages, readAttachment, { accepts: IMAGES_ONLY as never }, [dense])).rejects.toBeInstanceOf(
      AttachmentTextTooLargeError
    );
  });

  it("sends a PDF as a file when the call names no target, as before", async () => {
    const { pdf, call } = await documentFixture();
    const spec = await pdf("spec.pdf", "text");
    expect((await call([spec], undefined))[1]).toMatchObject({ type: "file", mediaType: "application/pdf" });
  });
});

// FIX-2636 D2: with the attachments capability, the history read asks for
// earlier documents by name. Each goes in full only on the turn it was sent;
// later calls name it with the id the model reads it by, so a long chat no
// longer pays for five documents on every call.
describe("an earlier turn's documents, named for the model to read on request", () => {
  const readNamed = (prior: RequestRecord[], live: OutputItem[]) =>
    createSessionItemViews([], prior, {
      tokenCounter: estimateTokenCounter,
      resolveModelId: () => "test-model",
      readLiveItems: () => live
    }).history({ earlierDocuments: "named" });

  it("names every earlier document with its id, keeps the request's own, and leaves images in the window", async () => {
    const { add, readAttachment } = filesFixture();
    const q3 = await add("application/pdf", "q3.pdf");
    const notes = await add("text/markdown", "notes.md");
    const shot = await add("image/png", "shot.png");
    const today = await add("text/csv", "today.csv");
    const prior = [
      turn("r1", [userLine("r1", "the report", [q3, shot], 100) as unknown as OutputItem], 100),
      turn("r2", [userLine("r2", "and notes", [notes], 200) as unknown as OutputItem], 200)
    ];
    const read1 = await readNamed(prior, [userLine("r3", "and today's", [today], 300) as unknown as OutputItem]);
    const messages = (await resolveHistoryFiles(read1, readAttachment, undefined, [today])) as LLMMessage[];

    expect(parts(messages[0])).toEqual([
      { type: "text", text: "the report" },
      { type: "text", text: `[document: q3.pdf, id ${q3.data.slice("fsd-blob:".length)}, not re-sent; read it with readAttachment]` },
      { type: "image", image: base64Of([3, 4]), mediaType: "image/png" }
    ]);
    expect(parts(messages[1])[1]).toMatchObject({ type: "text", text: expect.stringMatching(/^\[document: notes\.md, id b_\w+, not re-sent; read it with readAttachment\]$/) });
    // The request's own document still goes in full.
    expect(parts(messages[2])[1]).toEqual({ type: "text", text: `### today.csv\n${String.fromCharCode(4, 5)}` });
  });

  it("keeps FIX-2517 D1's window for a read that does not ask", async () => {
    const { add } = filesFixture();
    const q3 = await add("application/pdf", "q3.pdf");
    const prior = [turn("r1", [userLine("r1", "the report", [q3], 100) as unknown as OutputItem], 100)];
    expect(parts((await read(prior, []))[0])[1]).toEqual(q3);
  });
});
