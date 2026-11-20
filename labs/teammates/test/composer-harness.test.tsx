// @vitest-environment happy-dom
/**
 * A coding task asked for on a harness that can't run here fails minutes later,
 * after the teammate has filed it. So the composer says so before you send, and
 * offers the harnesses that can: picking one names it on the line you send, which
 * is how the teammate learns it. Each case fails if the warning stops showing for a
 * harness that can't run, shows for one that can (or whose check got no answer),
 * or if a pick stops reaching the line that is sent.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Composer } from "../src/components/Composer";
import { harnessWarning, withHarness } from "../src/lib/harness";
import type { HarnessReadinessChipRow } from "../src/components/flow-state/harness-readiness";

afterEach(cleanup);

const row = (harness: string, label: string, state: "ready" | "no" | "unanswered"): HarnessReadinessChipRow => ({
  harness,
  label,
  ready: state === "ready",
  reason: state === "no" ? "not signed in" : null,
  remedy: state === "no" ? "Set CURSOR_API_KEY" : null,
  unanswered: state === "unanswered",
});

const ROWS = [row("claude-code", "Claude Code", "ready"), row("codex", "Codex", "ready"), row("cursor", "Cursor", "no")];

describe("harnessWarning", () => {
  it("warns about a harness that can't run, naming the fix and the ones that can", () => {
    const warning = harnessWarning(ROWS, "cursor");
    expect(warning?.why).toBe("Set CURSOR_API_KEY");
    expect(warning?.ready.map((r) => r.harness)).toEqual(["claude-code", "codex"]);
  });

  it("stays quiet for a ready harness, an unanswered check, and before the rows arrive", () => {
    expect(harnessWarning(ROWS, "claude-code")).toBeUndefined();
    expect(harnessWarning([row("cursor", "Cursor", "unanswered")], "cursor")).toBeUndefined();
    expect(harnessWarning(undefined, "cursor")).toBeUndefined();
  });
});

describe("withHarness", () => {
  it("names a picked harness on the line, and adds nothing for the default or no pick", () => {
    expect(withHarness("fix it", "claude-code", "cursor")).toBe("fix it\n\nCoding harness: Claude Code");
    expect(withHarness("fix it", "cursor", "cursor")).toBe("fix it");
    expect(withHarness("fix it", undefined, "cursor")).toBe("fix it");
  });
});

describe("the composer", () => {
  const open = (onSend = vi.fn(async () => {})) => {
    render(
      <Composer sessionId="s1" workerName="Lead" running={false} onStop={() => {}} onSend={onSend} harnesses={ROWS} defaultHarness="cursor" />,
    );
    return onSend;
  };

  // The picker reads like a choice of what the teammate answers on unless it says otherwise; it only picks where coding tasks start.
  it("says the picker chooses where coding tasks start, not the model the teammate replies on", () => {
    render(
      <Composer sessionId="s1" workerName="Lead" running={false} onStop={() => {}} onSend={vi.fn(async () => {})} harnesses={ROWS} defaultHarness="claude-code" replyModel="openai/gpt-6-luna" />,
    );
    const picker = screen.getByRole("button", { name: "Code with Claude Code, ready" });
    expect(picker.title).toBe("Coding tasks start on this harness. Lead's replies use gpt-6-luna.");
    fireEvent.click(picker);
    expect(screen.getByRole("menu", { name: "Start coding tasks on" })).toBeTruthy();
  });

  it("warns before send when the default harness can't run, and a pick from the warning reaches the sent line", async () => {
    const onSend = open();
    const warning = screen.getByTestId("harness-warning");
    expect(warning.textContent).toContain("Cursor can't run coding tasks here: Set CURSOR_API_KEY");
    fireEvent.click(within(warning).getByRole("button", { name: "Claude Code" }));
    expect(screen.queryByTestId("harness-warning")).toBeNull();
    fireEvent.change(screen.getByLabelText("Message Lead"), { target: { value: "add day dividers" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(onSend).toHaveBeenCalledWith("add day dividers\n\nCoding harness: Claude Code", []);
  });

  it("sends a line as typed when the default harness is kept", async () => {
    const onSend = open();
    fireEvent.change(screen.getByLabelText("Message Lead"), { target: { value: "how is it going?" } });
    await act(async () => void fireEvent.click(screen.getByRole("button", { name: "Send" })));
    expect(onSend).toHaveBeenCalledWith("how is it going?", []);
  });
});
