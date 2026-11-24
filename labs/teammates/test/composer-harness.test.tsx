// @vitest-environment happy-dom
/**
 * A coding task asked for on a harness that can't run here fails minutes later,
 * after the teammate has filed it. So the composer says so before you send, and
 * offers the harnesses that can. The line you send goes as typed: the server
 * puts a coding task on the lab's default, so a `Coding harness:` line would
 * only be text a model reads. Each case fails if the warning stops showing for a
 * harness that can't run, shows for one that can (or whose check got no answer),
 * or if the composer adds anything to the line that is sent.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../src/components/Composer";
import { harnessWarning } from "../src/lib/harness";
import type { HarnessReadinessChipRow } from "../src/components/flow-state/harness-readiness";

afterEach(cleanup);

const chip = (harness: string, label: string, state: "ready" | "no" | "unanswered"): HarnessReadinessChipRow => ({
  harness,
  label,
  ready: state === "ready",
  reason: state === "no" ? "not signed in" : null,
  remedy: state === "no" ? "Set CURSOR_API_KEY" : null,
  unanswered: state === "unanswered",
});

const CHIPS = [chip("claude-code", "Claude Code", "ready"), chip("codex", "Codex", "ready"), chip("cursor", "Cursor", "no")];

describe("harnessWarning", () => {
  it("warns about a harness that can't run, naming the fix and the ones that can", () => {
    const warning = harnessWarning(CHIPS, "cursor");
    expect(warning?.why).toBe("Set CURSOR_API_KEY");
    expect(warning?.ready.map((r) => r.harness)).toEqual(["claude-code", "codex"]);
  });

  it("stays quiet for a ready harness, an unanswered check, and before the chips arrive", () => {
    expect(harnessWarning(CHIPS, "claude-code")).toBeUndefined();
    expect(harnessWarning([chip("cursor", "Cursor", "unanswered")], "cursor")).toBeUndefined();
    expect(harnessWarning(undefined, "cursor")).toBeUndefined();
  });
});

describe("the composer", () => {
  const open = (onSend = vi.fn(async () => {})) => {
    render(
      <Composer sessionId="s1" workerName="Lead" running={false} onStop={() => {}} onSend={onSend} harnesses={CHIPS} defaultHarness="cursor" />,
    );
    return onSend;
  };

  // The picker reads like a choice of what the teammate answers on unless it says otherwise; it only picks where coding tasks start.
  it("says the picker chooses where coding tasks start, not the model the teammate replies on", () => {
    render(
      <Composer sessionId="s1" workerName="Lead" running={false} onStop={() => {}} onSend={vi.fn(async () => {})} harnesses={CHIPS} defaultHarness="claude-code" replyModel="openai/gpt-6-luna" />,
    );
    const picker = screen.getByRole("button", { name: "Code with Claude Code, ready" });
    expect(picker.title).toBe("Coding tasks start on this harness. Lead's replies use gpt-6-luna.");
    fireEvent.click(picker);
    expect(screen.getByRole("menu", { name: "Start coding tasks on" })).toBeTruthy();
  });

  it("warns before send when the default harness can't run, and sends the line as typed, a pick or not", async () => {
    const onSend = open();
    const warning = screen.getByTestId("harness-warning");
    expect(warning.textContent).toContain("Cursor can't run coding tasks here: Set CURSOR_API_KEY");
    fireEvent.click(within(warning).getByRole("button", { name: "Claude Code" }));
    expect(screen.queryByTestId("harness-warning")).toBeNull();
    fireEvent.change(screen.getByLabelText("Message Lead"), { target: { value: "add day dividers" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(onSend).toHaveBeenCalledWith("add day dividers", []);
  });

  it("works from the keyboard: opening focuses the current choice, arrows move, Esc closes back to the trigger", () => {
    // A menu that left focus on its trigger, with no arrow keys, could only be reached by guessing at Tab.
    open();
    const trigger = screen.getByRole("button", { name: /^Code with Cursor/ });
    fireEvent.click(trigger);
    const items = within(screen.getByRole("menu", { name: "Start coding tasks on" })).getAllByRole("menuitemradio");
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items[2]);
    fireEvent.keyDown(items[2]!, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0]!, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("sends a line as typed when the default harness is kept", async () => {
    const onSend = open();
    fireEvent.change(screen.getByLabelText("Message Lead"), { target: { value: "how is it going?" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(onSend).toHaveBeenCalledWith("how is it going?", []);
  });
});
