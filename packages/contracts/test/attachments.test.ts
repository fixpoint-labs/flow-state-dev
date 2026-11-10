import { describe, expect, it } from "vitest";
import {
  ATTACHMENT_LIMITS,
  attachmentKind,
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
