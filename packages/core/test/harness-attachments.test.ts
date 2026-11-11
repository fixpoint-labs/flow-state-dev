/**
 * A turn's files on a harness's run input (FIX-2519). They ride as stored
 * files' references, never bytes; a harness refuses a type it doesn't take,
 * naming the file and itself, before its run starts (epic FIX-2516 ER-5); and
 * it reads the bytes only through the engine's seam, so a context with no
 * reader is a named failure rather than a turn run without its files.
 */
import { describe, expect, it } from "vitest";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import {
  HarnessAttachmentRefusedError,
  HarnessAttachmentUnavailableError,
  harnessRunInputSchema,
  readHarnessAttachments,
  readHarnessTurnFiles,
  refuseUnacceptedAttachments,
} from "@flow-state-dev/core/harness";
import { ATTACHMENT_SEAM, type AttachmentSeam } from "@flow-state-dev/core/internal";
import type { FileContent } from "@flow-state-dev/core/items";

const shot: FileContent = { type: "file", mediaType: "image/png", data: toBlobRef("b_shot0001"), filename: "shot.png" };
const spec: FileContent = { type: "file", mediaType: "application/pdf", data: toBlobRef("b_spec00001"), filename: "spec.pdf" };
const notes: FileContent = { type: "file", mediaType: "text/markdown", data: toBlobRef("b_notes0001"), filename: "notes.md" };
const photo: FileContent = { type: "file", mediaType: "image/heic", data: toBlobRef("b_photo001"), filename: "photo.heic" };

describe("a harness run's files", () => {
  it("ride on the run input as references, and bytes are refused", () => {
    expect(harnessRunInputSchema.parse({ prompt: "look", attachments: [shot] })).toEqual({ prompt: "look", attachments: [shot] });
    expect(harnessRunInputSchema.parse({ prompt: "look" })).toEqual({ prompt: "look" });
    const inline = { ...shot, data: Buffer.from([1, 2, 3]).toString("base64") };
    expect(harnessRunInputSchema.safeParse({ prompt: "look", attachments: [inline] }).success).toBe(false);
  });

  it("are refused, by file and harness, when the harness doesn't take the type", () => {
    expect(() => refuseUnacceptedAttachments("Codex", ["image/png"], [shot])).not.toThrow();
    // Types compare as the limits set normalizes them.
    expect(() => refuseUnacceptedAttachments("Codex", ["image/png"], [{ ...shot, mediaType: "IMAGE/PNG; x=1" }])).not.toThrow();
    let refusal: unknown;
    try {
      refuseUnacceptedAttachments("Codex", ["image/png"], [shot, photo]);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(HarnessAttachmentRefusedError);
    expect((refusal as HarnessAttachmentRefusedError).attachment).toBe(photo);
    expect((refusal as Error).message).toMatch(/^Codex can't take "photo\.heic" \(image\/heic\)\. The turn did not run/);
  });

  // FIX-2520: a document reaches a harness that reads images only as its text.
  it("take a PDF and a text-like file on a harness that reads only images, and still refuse an image type it lacks", () => {
    expect(() => refuseUnacceptedAttachments("Codex", ["image/png"], [spec, notes])).not.toThrow();
    expect(() => refuseUnacceptedAttachments("Codex", ["image/png"], [{ ...shot, mediaType: "image/webp" }])).toThrow(
      HarnessAttachmentRefusedError,
    );
    const docx = { ...notes, mediaType: "application/msword", filename: "r.doc" };
    expect(() => refuseUnacceptedAttachments("Codex", ["image/png"], [docx])).toThrow(HarnessAttachmentRefusedError);
  });

  it("are all refused by a harness that declares nothing it takes", () => {
    expect(() => refuseUnacceptedAttachments("This harness", undefined, [shot])).toThrow(HarnessAttachmentRefusedError);
    expect(() => refuseUnacceptedAttachments("This harness", undefined, [])).not.toThrow();
  });

  it("are read through the engine's seam, in order, and not without one", async () => {
    const asked: string[] = [];
    const read: AttachmentSeam = async (file) => {
      asked.push(file.filename ?? "");
      return { mediaType: file.mediaType, bytes: new Uint8Array([1]), base64: () => "AQ==" };
    };
    const second = { ...shot, filename: "second.png" };
    const files = await readHarnessAttachments({ [ATTACHMENT_SEAM]: read }, [shot, second]);
    expect(asked).toEqual(["shot.png", "second.png"]);
    expect(files.map((file) => file.base64())).toEqual(["AQ==", "AQ=="]);

    expect(await readHarnessAttachments({}, [])).toEqual([]);
    await expect(readHarnessAttachments({}, [shot])).rejects.toBeInstanceOf(HarnessAttachmentUnavailableError);
  });
});

describe("a turn's files, split by what the harness reads", () => {
  const seam: AttachmentSeam = async (file) => ({
    mediaType: file.mediaType,
    ...(file.filename !== undefined ? { filename: file.filename } : {}),
    bytes: new Uint8Array([1]),
    base64: () => "AQ==",
    text: async () => `### ${file.filename}\ncode word for ${file.filename}`,
  });
  const ctx = { [ATTACHMENT_SEAM]: seam };

  it("hands on the files it reads, and the rest as their text in the order attached", async () => {
    const turn = await readHarnessTurnFiles("Codex", ctx, ["image/png"], [shot, spec, notes]);
    expect(turn.files.map((file) => file.filename)).toEqual(["shot.png"]);
    expect(turn.text).toBe("### spec.pdf\ncode word for spec.pdf\n\n### notes.md\ncode word for notes.md");
  });

  it("hands a PDF on as a file to a harness that reads PDFs, and text-like files as text still", async () => {
    const turn = await readHarnessTurnFiles("Claude Code", ctx, ["image/png", "application/pdf"], [spec, notes]);
    expect(turn.files.map((file) => file.filename)).toEqual(["spec.pdf"]);
    expect(turn.text).toBe("### notes.md\ncode word for notes.md");
  });

  it("refuses before reading anything, and names a document with no way to read its text", async () => {
    const asked: string[] = [];
    const counting: AttachmentSeam = async (file) => {
      asked.push(file.filename ?? "");
      return seam(file);
    };
    await expect(
      readHarnessTurnFiles("Codex", { [ATTACHMENT_SEAM]: counting }, ["image/png"], [spec, photo]),
    ).rejects.toBeInstanceOf(HarnessAttachmentRefusedError);
    expect(asked).toEqual([]);
    const textless: AttachmentSeam = async (file) => ({ mediaType: file.mediaType, bytes: new Uint8Array([1]), base64: () => "AQ==" });
    await expect(readHarnessTurnFiles("Codex", { [ATTACHMENT_SEAM]: textless }, ["image/png"], [spec])).rejects.toBeInstanceOf(
      HarnessAttachmentUnavailableError,
    );
  });

  it("is empty for a turn with no files", async () => {
    expect(await readHarnessTurnFiles("Codex", {}, ["image/png"], undefined)).toEqual({ files: [], text: "" });
  });
});
