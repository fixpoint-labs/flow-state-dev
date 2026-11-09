import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_LIMITS,
  attachmentKind,
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
  it("takes the v1 images and PDF, and refuses HEIC and anything unlisted", () => {
    expect(attachmentKind("image/png")).toBe("image");
    expect(attachmentKind("IMAGE/JPEG; q=1")).toBe("image");
    expect(attachmentKind("application/pdf")).toBe("document");
    expect(isAttachmentMediaType("image/heic")).toBe(false);
    expect(isAttachmentMediaType("text/html")).toBe(false);
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
