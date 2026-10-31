/**
 * Cmd+Enter (Mac) and Ctrl+Enter (elsewhere) send from every message box, so an
 * answer never needs the mouse. Plain Enter keeps each box's own meaning: it
 * sends a chat line, and stays a new line in a longer answer, where sending by
 * accident would cut the answer short. Shift+Enter and an IME's confirming
 * Enter never send.
 */
import { describe, expect, it } from "vitest";
import { isSendKey, type SendKeyEvent } from "../src/send-key";

const key = (over: Partial<SendKeyEvent> = {}): SendKeyEvent => ({ key: "Enter", metaKey: false, ctrlKey: false, shiftKey: false, ...over });

describe("isSendKey", () => {
  it("sends on Cmd+Enter and Ctrl+Enter in any box", () => {
    expect(isSendKey(key({ metaKey: true }))).toBe(true);
    expect(isSendKey(key({ ctrlKey: true }))).toBe(true);
    expect(isSendKey(key({ metaKey: true }), { enterSends: true })).toBe(true);
  });

  it("keeps plain Enter a new line unless the box sends on Enter", () => {
    expect(isSendKey(key())).toBe(false);
    expect(isSendKey(key(), { enterSends: true })).toBe(true);
  });

  it("never sends on Shift+Enter, another key, or an Enter that confirms a composition", () => {
    expect(isSendKey(key({ shiftKey: true }), { enterSends: true })).toBe(false);
    expect(isSendKey(key({ shiftKey: true, metaKey: true }))).toBe(false);
    expect(isSendKey(key({ key: "a", metaKey: true }))).toBe(false);
    expect(isSendKey(key({ metaKey: true, isComposing: true }))).toBe(false);
    expect(isSendKey(key({ metaKey: true, nativeEvent: { isComposing: true } }))).toBe(false);
    expect(isSendKey(key({ keyCode: 229 }), { enterSends: true })).toBe(false);
  });
});
