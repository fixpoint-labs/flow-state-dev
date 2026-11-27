import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_LIMITS,
  AttachmentTextTooLargeError,
  attachmentKind,
  attachmentMediaType,
  attachmentSentAs,
  formatAttachmentText,
  formatKilobytes,
  attachmentLimitRefusal,
  isAttachmentMediaType,
  parseBlobRef,
  toBlobRef
} from "../src/attachments";

const ID = "b_0123456789abcdef0123456789abcdef";

describe("blob references", () => {
  it("round-trips an id through its reference", () => {
    expect(parseBlobRef(toBlobRef(ID))).toBe(ID);
  });

  it("reads base64, a data URL, and a reference with a path in it as no reference", () => {
    // `data` that is not a reference must never be taken for one: a reader
    // that did would look up bytes by whatever the caller wrote.
    expect(parseBlobRef("iVBORw0KGgoAAAANSUhEUg==")).toBeUndefined();
    expect(parseBlobRef("data:image/png;base64,AAAA")).toBeUndefined();
    expect(parseBlobRef("fsd-blob:../../etc/passwd")).toBeUndefined();
    expect(parseBlobRef("fsd-blob:")).toBeUndefined();
  });

  it("refuses to build a reference to something that is not a blob id", () => {
    expect(() => toBlobRef("../x")).toThrow(TypeError);
  });
});

describe("the limits set", () => {
  it("takes the v1 images, PDF and text-like files, and refuses HEIC, Word and anything unlisted", () => {
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("IMAGE/JPEG; q=1")).toBe("image");
    expect(attachmentKind("application/pdf")).toBe("document");
    // A text-like file counts against the documents in a message, as a PDF does.
    for (const type of ["text/plain", "text/markdown", "text/csv", "application/json", "application/yaml", "text/html", "application/xml"]) {
      expect(attachmentKind(type)).toBe("document");
    }
    expect(isAttachmentMediaType("image/heic")).toBe(false);
    // Word, Excel and PowerPoint are the epic's cut.
    expect(isAttachmentMediaType("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe(false);
    expect(isAttachmentMediaType("application/msword")).toBe(false);
  });

  it("holds the numbers the composer and the server both enforce", () => {
    expect(ATTACHMENT_LIMITS).toMatchObject({
      imagesPerMessage: 10,
      documentsPerMessage: 5,
      maxFileBytes: 20 * 1024 * 1024,
      maxPdfPages: 100,
      maxTextBytes: 200 * 1024
    });
    // At least a day before an unclaimed upload may be swept.
    expect(ATTACHMENT_LIMITS.unclaimedTtlMs).toBeGreaterThanOrEqual(24 * 60 * 60 * 1000);
  });
});

describe("attachmentLimitRefusal", () => {
  const png = { mediaType: "image/png" };
  const pdf = { mediaType: "application/pdf" };

  it("takes a message at the limits: ten images and five documents", () => {
    expect(attachmentLimitRefusal([...Array(10).fill(png), ...Array(5).fill(pdf)])).toBeUndefined();
    expect(attachmentLimitRefusal([])).toBeUndefined();
  });

  // The server and the composer refuse by name; a message one over must not
  // slip through because the other kind still has room.
  it("names the kind a message is over, and the file that tipped it", () => {
    expect(attachmentLimitRefusal(Array(11).fill(png))).toEqual({ reason: "too-many-images", index: 10, limit: 10 });
    expect(attachmentLimitRefusal([png, ...Array(6).fill(pdf)])).toEqual({
      reason: "too-many-documents",
      index: 6,
      limit: 5
    });
  });

  it("refuses a type off the list by its position", () => {
    expect(attachmentLimitRefusal([png, { mediaType: "image/heic" }])).toEqual({ reason: "type", index: 1 });
  });
});

describe("attachmentMediaType", () => {
  // A browser types a `.ts` file as video, a `.md` or `.yaml` often as
  // nothing: the composer and a hand-built upload agree only if the type
  // comes from the name for text-like files.
  it("types a text-like file by its extension, whatever the browser said", () => {
    expect(attachmentMediaType({ name: "notes.md", type: "" })).toBe("text/markdown");
    expect(attachmentMediaType({ name: "agent.ts", type: "video/mp2t" })).toBe("text/plain");
    expect(attachmentMediaType({ name: "deploy.YML", type: "application/x-yaml" })).toBe("application/yaml");
    expect(attachmentMediaType({ name: "errors.csv", type: "text/csv" })).toBe("text/csv");
    expect(attachmentMediaType({ name: "main.py", type: "text/x-python" })).toBe("text/plain");
  });

  it("keeps an image's and a PDF's own type, and leaves anything else to be refused", () => {
    expect(attachmentMediaType({ name: "shot.png", type: "image/png" })).toBe("image/png");
    expect(attachmentMediaType({ name: "spec.pdf", type: "application/pdf" })).toBe("application/pdf");
    const docx = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    expect(attachmentMediaType({ name: "report.docx", type: docx })).toBe(docx);
    expect(isAttachmentMediaType(attachmentMediaType({ name: "photo.heic", type: "image/heic" }))).toBe(false);
  });

  it("offers the picker every type and text extension the list takes", () => {
    const accept = ATTACHMENT_ACCEPT.split(",");
    expect(accept).toEqual(expect.arrayContaining(["image/png", "application/pdf", "text/markdown", ".md", ".ts", ".csv"]));
    expect(accept).not.toContain(".docx");
  });
});

describe("how a target gets a file", () => {
  const reads = ["image/png", "application/pdf"] as const;

  it("sends a text-like file as text to every target, even one that lists its type", () => {
    expect(attachmentSentAs("text/csv", reads)).toBe("text");
    expect(attachmentSentAs("text/plain", ["text/plain"])).toBe("text");
  });

  it("sends a PDF as a file where the target reads PDFs, and as its text everywhere else", () => {
    expect(attachmentSentAs("application/pdf", reads)).toBe("file");
    expect(attachmentSentAs("APPLICATION/PDF", ["image/png"])).toBe("text");
  });

  // Epic ER-5: an image is never replaced by text.
  it("sends an image only as a file, and refuses it where the target doesn't read it", () => {
    expect(attachmentSentAs("image/png", reads)).toBe("file");
    expect(attachmentSentAs("image/webp", reads)).toBeUndefined();
    expect(attachmentSentAs("image/heic", reads)).toBeUndefined();
  });

  it("heads a file's text with its name", () => {
    expect(formatAttachmentText("errors.csv", "ts,level\n1,error")).toBe("### errors.csv\nts,level\n1,error");
    expect(formatAttachmentText(undefined, "x")).toBe("### attachment\nx");
  });

  // The composer and the server name a size the same way, rounded up, so a
  // file one byte over the cap never reads as the cap itself.
  it("names a size in KB, rounded up", () => {
    expect(formatKilobytes(ATTACHMENT_LIMITS.maxTextBytes)).toBe("200 KB");
    expect(formatKilobytes(ATTACHMENT_LIMITS.maxTextBytes + 1)).toBe("201 KB");
    expect(formatKilobytes(250 * 1024)).toBe("250 KB");
  });

  it("names a PDF whose text is over the cap, with its size and the cap", () => {
    const error = new AttachmentTextTooLargeError("dense.pdf", 300 * 1024);
    expect(error.code).toBe("pdf_text_too_large");
    expect(error.message).toContain("dense.pdf");
    expect(error.message).toContain("300 KB");
    expect(error.message).toContain("200 KB");
  });

  it("names a text file over the cap as a file, not a PDF", () => {
    const error = new AttachmentTextTooLargeError("huge.log", 300 * 1024, "text");
    expect(error.code).toBe("text_too_large");
    expect(error.message).toContain("huge.log");
    expect(error.message).not.toContain("PDF");
  });
});
