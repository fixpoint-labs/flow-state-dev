// @vitest-environment happy-dom
/**
 * A page-wide printable shortcut (`/`, `?`, `[`) must never steal a key the
 * person is typing: in a field it is text. Anything else on the page, a
 * button or a list, is free to take it.
 */
import { describe, expect, it } from "vitest";
import { isTypingTarget } from "../src/send-key";

describe("isTypingTarget", () => {
  it("counts every place a person types", () => {
    for (const tag of ["input", "textarea", "select"]) expect(isTypingTarget(document.createElement(tag))).toBe(true);
    const editable = document.createElement("div");
    editable.contentEditable = "true";
    document.body.append(editable);
    expect(isTypingTarget(editable)).toBe(true);
  });

  it("leaves a button, a list item and no target free for a shortcut", () => {
    expect(isTypingTarget(document.createElement("button"))).toBe(false);
    expect(isTypingTarget(document.createElement("li"))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
    expect(isTypingTarget(window)).toBe(false);
  });
});
