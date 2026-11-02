// @vitest-environment happy-dom
/**
 * The composer's *Coder* chip. What it proves: the choice reaches the main session as the one
 * `Coder:` line its `WORKER.md` routes on, and *Auto* sends your words untouched, so a session
 * that never touches the chip routes exactly as it did before the chip.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Composer, withCoder } from "../src/components/Composer";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function composer() {
  const sent: string[] = [];
  render(<Composer sessionId="coder-test" running={false} onSend={async (text) => { sent.push(text); }} onStop={() => undefined} />);
  const type = async (text: string) => {
    const box = screen.getByLabelText("Message the main session");
    fireEvent.change(box, { target: { value: text } });
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Send" })).toBeTruthy());
  };
  const pick = (choice: string) => fireEvent.change(screen.getByLabelText("Coder"), { target: { value: choice } });
  return { sent, type, pick };
}

describe("the Coder chip", () => {
  it("sends your words untouched on Auto, its default", async () => {
    const { sent, type } = composer();
    await type("Fix the typo in README.md");
    expect(sent).toEqual(["Fix the typo in README.md"]);
  });

  it("adds the choice as the Coder: line the routing text reads", async () => {
    const { sent, type, pick } = composer();
    pick("Codex");
    await type("Fix the typo in README.md");
    expect(sent).toEqual(["Fix the typo in README.md\n\nCoder: Codex"]);
  });

  it("keeps the choice for the next line, until you change it back", async () => {
    const { sent, type, pick } = composer();
    pick("Plan first");
    await type("one");
    await type("two");
    pick("Auto");
    await type("three");
    expect(sent).toEqual(["one\n\nCoder: Plan first", "two\n\nCoder: Plan first", "three"]);
  });

  it("keeps a failed draft and retries it with the selected coder", async () => {
    const sent: string[] = [];
    render(
      <Composer
        sessionId="coder-retry"
        running={false}
        onSend={async (line) => {
          sent.push(line);
          if (sent.length === 1) throw new Error("offline");
        }}
        onStop={() => undefined}
      />,
    );
    fireEvent.change(screen.getByLabelText("Coder"), { target: { value: "Cursor" } });
    const box = screen.getByLabelText("Message the main session") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "Fix the typo" } });
    fireEvent.keyDown(box, { key: "Enter" });
    await screen.findByRole("alert");
    expect(box.value).toBe("Fix the typo");
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(box.value).toBe(""));
    expect(sent).toEqual(["Fix the typo\n\nCoder: Cursor", "Fix the typo\n\nCoder: Cursor"]);
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
