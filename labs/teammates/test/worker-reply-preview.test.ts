import { describe, expect, it } from "vitest";
import {
  WORKER_REPLY_PREVIEW_MAX_CHARS,
  WORKER_REPLY_PREVIEW_TWO_LINE_MAX_CHARS,
  fitsWorkerReplyPreview,
  workerReplyTextOf,
} from "../src/components/worker-reply-body";

describe("workerReplyTextOf", () => {
  it("reads a string body and treats legacy non-strings as empty", () => {
    expect(workerReplyTextOf("hello")).toBe("hello");
    expect(workerReplyTextOf(undefined)).toBe("");
    expect(workerReplyTextOf(42)).toBe("");
  });
});

describe("fitsWorkerReplyPreview", () => {
  it("treats a short reply as fitting the preview", () => {
    expect(fitsWorkerReplyPreview("Nov 12")).toBe(true);
  });

  it("treats a multi-paragraph reply as needing collapse", () => {
    expect(
      fitsWorkerReplyPreview("Line one.\n\nLine two is longer and names the launch timeline and relay.\n\nLine three."),
    ).toBe(false);
  });

  it("treats markdown blocks as not fitting even when short", () => {
    expect(fitsWorkerReplyPreview("- one\n- two")).toBe(false);
    expect(fitsWorkerReplyPreview("```\nok\n```")).toBe(false);
  });

  it("pins the character thresholds", () => {
    expect(fitsWorkerReplyPreview("x".repeat(WORKER_REPLY_PREVIEW_MAX_CHARS))).toBe(true);
    expect(fitsWorkerReplyPreview("x".repeat(WORKER_REPLY_PREVIEW_MAX_CHARS + 1))).toBe(false);
  });

  it("pins the two-line character threshold", () => {
    const twoLines = `${"a".repeat(39)}\n${"b".repeat(40)}`;
    expect(fitsWorkerReplyPreview(twoLines)).toBe(true);
    expect(fitsWorkerReplyPreview(`${twoLines}x`)).toBe(false);
  });

  it("trims surrounding whitespace before measuring", () => {
    expect(fitsWorkerReplyPreview("  Nov 12 \n")).toBe(true);
  });
});