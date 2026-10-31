// @vitest-environment happy-dom
/**
 * The composer's *Coder* chip. What it proves: the choice reaches the main session as the one
 * `Coder:` line its `WORKER.md` routes on, and *Auto* sends your words untouched, so a session
 * that never touches the chip routes exactly as it did before the chip.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Composer, withCoder } from "../src/components/Composer";

afterEach(cleanup);

function composer() {
  const sent: string[] = [];
  render(<Composer running={false} onSend={(text) => sent.push(text)} onStop={() => undefined} />);
  const type = (text: string) => {
    const box = screen.getByLabelText("Message the main session");
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
  };
  const pick = (choice: string) => fireEvent.change(screen.getByLabelText("Coder"), { target: { value: choice } });
  return { sent, type, pick };
}

describe("the Coder chip", () => {
  it("sends your words untouched on Auto, its default", () => {
    const { sent, type } = composer();
    type("Fix the typo in README.md");
    expect(sent).toEqual(["Fix the typo in README.md"]);
  });

  it("adds the choice as the Coder: line the routing text reads", () => {
    const { sent, type, pick } = composer();
    pick("Codex");
    type("Fix the typo in README.md");
    expect(sent).toEqual(["Fix the typo in README.md\n\nCoder: Codex"]);
  });

  it("keeps the choice for the next line, until you change it back", () => {
    const { sent, type, pick } = composer();
    pick("Plan first");
    type("one");
    type("two");
    pick("Auto");
    type("three");
    expect(sent).toEqual(["one\n\nCoder: Plan first", "two\n\nCoder: Plan first", "three"]);
  });

  it("writes the exact words the main and lead files name", () => {
    // The routing text in desk.main and desk.lead names these lines; change one, change both.
    expect(["Plan first", "Codex", "Cursor"].map((c) => withCoder("x", c as never).split("\n").at(-1))).toEqual([
      "Coder: Plan first",
      "Coder: Codex",
      "Coder: Cursor",
    ]);
  });
});
