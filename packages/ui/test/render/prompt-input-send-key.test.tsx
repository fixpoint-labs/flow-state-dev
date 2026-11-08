// @vitest-environment happy-dom
/**
 * The registry composer sends by the one send rule, `isSendKey`: Enter sends,
 * Shift+Enter is a new line, and the Enter that confirms an input method's
 * word never sends. Safari fires that Enter after `compositionend`, with
 * `isComposing` false and `keyCode` 229, so a composer reading only
 * `isComposing` sends the half-typed message.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PromptInput, PromptInputSubmit, PromptInputTextarea } from "../../registry/components/prompt-input";

afterEach(cleanup);

function composer() {
  const onSubmit = vi.fn();
  render(
    <PromptInput onSubmit={onSubmit}>
      <PromptInputTextarea defaultValue="こんにち" />
      <PromptInputSubmit />
    </PromptInput>,
  );
  return { onSubmit, box: screen.getByTestId("message-input") };
}

describe("the registry composer's Enter", () => {
  it("sends on Enter", async () => {
    const { onSubmit, box } = composer();
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it("is a new line with Shift", async () => {
    const { onSubmit, box } = composer();
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("does not send the Enter that confirms a word on Safari (keyCode 229, not composing)", async () => {
    const { onSubmit, box } = composer();
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter", keyCode: 229 });
    });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
