import { describe, expect, it } from "vitest";
import { fitsWorkerReplyPreview } from "../src/components/worker-reply-body";

describe("fitsWorkerReplyPreview", () => {
  it("treats a short reply as fitting the preview", () => {
    expect(fitsWorkerReplyPreview("Nov 12")).toBe(true);
  });

  it("treats a multi-paragraph reply as needing collapse", () => {
    expect(
      fitsWorkerReplyPreview("Line one.\n\nLine two is longer and names the launch timeline and relay.\n\nLine three."),
    ).toBe(false);
  });
});