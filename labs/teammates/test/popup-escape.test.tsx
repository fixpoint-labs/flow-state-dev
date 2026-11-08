// @vitest-environment happy-dom
/**
 * Esc closes a popup over a running conversation and does nothing else: the
 * conversation's stop keys (Esc Esc) listen on the document from before the
 * popup opened, and must never count the Esc that closed it.
 */
import { useInterruptKeys } from "@flow-state-dev/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { SessionPopup } from "../src/components/SessionPopup";

afterEach(cleanup);

function Running({ onInterrupt }: { onInterrupt: () => void }) {
  // Mounted first, as the conversation is: its document listener comes before the popup's.
  useInterruptKeys({ enabled: true, onInterrupt, target: "document" });
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>open</button>
      {open ? (
        <SessionPopup label="Task" title="Task" onClose={() => setOpen(false)}>
          body
        </SessionPopup>
      ) : null}
    </>
  );
}

it("an Esc that closes a popup never counts toward stopping the turn", () => {
  let stops = 0;
  const view = render(<Running onInterrupt={() => (stops += 1)} />);
  for (let i = 0; i < 2; i++) {
    fireEvent.click(view.getByText("open"));
    expect(document.querySelector("[role=dialog]")).not.toBeNull();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    expect(document.querySelector("[role=dialog]")).toBeNull();
  }
  expect(stops).toBe(0);
});
