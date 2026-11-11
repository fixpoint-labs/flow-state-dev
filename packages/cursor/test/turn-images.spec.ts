/**
 * A turn's images reach Cursor as base64 on the message it sends, beside the
 * prompt (FIX-2519); nothing is written to disk. A type Cursor can't take
 * refuses the turn before an agent is opened.
 *
 * The client is scripted, as in `agent.spec.ts`: that the real runtime reads
 * the images is the goal check's (`goals/attachments/reach-each-harness`).
 */
import { describe, expect, it } from "vitest";
import { createTestContext } from "@flow-state-dev/testing";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import { HarnessAttachmentRefusedError } from "@flow-state-dev/core/harness";
import { ATTACHMENT_SEAM, type AttachmentSeam } from "@flow-state-dev/core/internal";
import type { FileContent } from "@flow-state-dev/core/items";
import { cursorAgent, INTERNAL_CURSOR_SDK_VERSION_READER, type CursorAgentOptions } from "../src/agent";
import {
  TESTED_CURSOR_SDK,
  type CursorAgentLike,
  type CursorRunLike,
  type CursorUserMessage,
  type ResolvedCursorClient,
} from "../src/types";

const GATE_OFF = {
  [INTERNAL_CURSOR_SDK_VERSION_READER]: () => ({ kind: "version", version: TESTED_CURSOR_SDK.range }),
} as CursorAgentOptions;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2]);
const GIF = new Uint8Array([0x47, 0x49, 0x46, 0x38, 3]);
const shot: FileContent = { type: "file", mediaType: "image/png", data: toBlobRef("b_shot0001"), filename: "shot.png" };
const loop: FileContent = { type: "file", mediaType: "image/gif", data: toBlobRef("b_loop0001"), filename: "loop.gif" };

/** A client recording what each turn sent, whose run finishes at once. */
function scripted() {
  const sent: Array<string | CursorUserMessage> = [];
  let created = 0;
  const run: CursorRunLike = {
    id: "run_1",
    stream: () =>
      (async function* () {
        yield { type: "status", status: "FINISHED" } as never;
      })(),
    wait: async () => ({ status: "finished", result: "seen" }) as never,
    cancel: async () => undefined,
  };
  const agent: CursorAgentLike = {
    agentId: "agent_1",
    async send(message) {
      sent.push(message);
      return run;
    },
  };
  const resolve = (): ResolvedCursorClient => ({
    async create() {
      created += 1;
      return agent;
    },
    async resume() {
      return agent;
    },
  });
  return { resolve, sent, created: () => created };
}

async function contextWith(files: Record<string, { mediaType: string; bytes: Uint8Array; text?: string }>) {
  const runtime = await createTestContext({});
  const read: AttachmentSeam = async (file) => {
    const found = files[file.data]!;
    return {
      mediaType: found.mediaType,
      bytes: found.bytes,
      base64: () => Buffer.from(found.bytes).toString("base64"),
      ...(found.text !== undefined ? { text: async () => found.text! } : {}),
    };
  };
  (runtime.ctx as unknown as Record<symbol, unknown>)[ATTACHMENT_SEAM] = read;
  return runtime.ctx as never;
}

describe("a turn's images, to Cursor", () => {
  it("declares the image types it takes", () => {
    expect(cursorAgent({ ...GATE_OFF, resolveCursorClient: scripted().resolve }).accepts).toEqual([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
    ]);
  });

  it("sends the prompt with each image as base64, in the order attached", async () => {
    const client = scripted();
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: client.resolve });
    const ctx = await contextWith({
      [shot.data]: { mediaType: "image/png", bytes: PNG },
      [loop.data]: { mediaType: "image/gif", bytes: GIF },
    });
    await block.config.execute?.({ prompt: "what is in these?", attachments: [shot, loop] }, ctx);
    expect(client.sent).toEqual([
      {
        text: "what is in these?",
        images: [
          { data: Buffer.from(PNG).toString("base64"), mimeType: "image/png" },
          { data: Buffer.from(GIF).toString("base64"), mimeType: "image/gif" },
        ],
      },
    ]);
  });

  it("sends the prompt alone for a turn with no files", async () => {
    const client = scripted();
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: client.resolve });
    await block.config.execute?.({ prompt: "just text" }, await contextWith({}));
    expect(client.sent).toEqual(["just text"]);
  });

  // FIX-2520 D1: the Cursor SDK takes no documents, so a PDF reaches it as
  // the text extracted on the server.
  it("sends a PDF and a text-like file as their text after the prompt, beside the images", async () => {
    const client = scripted();
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: client.resolve });
    const pdf: FileContent = { type: "file", mediaType: "application/pdf", data: toBlobRef("b_report01"), filename: "report.pdf" };
    const md: FileContent = { type: "file", mediaType: "text/markdown", data: toBlobRef("b_notes0001"), filename: "notes.md" };
    const ctx = await contextWith({
      [pdf.data]: { mediaType: "application/pdf", bytes: new Uint8Array([1]), text: "### report.pdf\n[page 1]\nTANGERINE" },
      [md.data]: { mediaType: "text/markdown", bytes: new Uint8Array([2]), text: "### notes.md\nPLUM" },
      [shot.data]: { mediaType: "image/png", bytes: PNG },
    });
    await block.config.execute?.({ prompt: "read these", attachments: [pdf, shot, md] }, ctx);
    expect(client.sent).toEqual([
      {
        text: "read these\n\n### report.pdf\n[page 1]\nTANGERINE\n\n### notes.md\nPLUM",
        images: [{ data: Buffer.from(PNG).toString("base64"), mimeType: "image/png" }],
      },
    ]);
  });

  it("sends a turn of documents only as one text prompt", async () => {
    const client = scripted();
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: client.resolve });
    const md: FileContent = { type: "file", mediaType: "text/markdown", data: toBlobRef("b_notes0001"), filename: "notes.md" };
    await block.config.execute?.(
      { prompt: "read", attachments: [md] },
      await contextWith({ [md.data]: { mediaType: "text/markdown", bytes: new Uint8Array([1]), text: "### notes.md\nPLUM" } }),
    );
    expect(client.sent).toEqual(["read\n\n### notes.md\nPLUM"]);
  });

  it("refuses a type it can't take, by name, before an agent opens", async () => {
    const client = scripted();
    const block = cursorAgent({ ...GATE_OFF, resolveCursorClient: client.resolve });
    const heic: FileContent = { type: "file", mediaType: "image/heic", data: toBlobRef("b_heic0001"), filename: "photo.heic" };
    const thrown = await Promise.resolve(
      block.config.execute?.({ prompt: "read this", attachments: [heic] }, await contextWith({})),
    ).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(HarnessAttachmentRefusedError);
    expect((thrown as Error).message).toContain('Cursor can\'t take "photo.heic"');
    expect(client.created()).toBe(0);
  });
});
