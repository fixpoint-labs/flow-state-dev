// @vitest-environment happy-dom
/**
 * The harness readiness chips say, for each row harness-manager's readiness
 * action answers, ready (✓), not ready with what to run (✗), or no answer
 * (?), and Re-check reads them again; a refused Re-check keeps the chips and
 * says why. A chip drawn from anything but the row would fail these.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HarnessReadiness, type HarnessReadinessChipRow } from "../../registry/components/harness-readiness";

afterEach(cleanup);

const ROWS: HarnessReadinessChipRow[] = [
  { harness: "cursor", label: "Cursor", ready: true, reason: null, remedy: null, unanswered: false },
  { harness: "codex", label: "Codex", ready: false, reason: "Codex has no credential", remedy: "Run `codex login`", unanswered: false },
  { harness: "claude-code", label: "Claude Code", ready: false, reason: "The check did not answer within 30 s.", remedy: null, unanswered: true },
];

const chip = (harness: string) => screen.getByRole("group", { name: "Coding harnesses" }).querySelector(`[data-harness="${harness}"]`)!;

describe("harness readiness chips", () => {
  it("draws each row as ready, not ready with its remedy, or unanswered with its reason", () => {
    render(<HarnessReadiness rows={ROWS} />);
    expect(chip("cursor").getAttribute("data-ready")).toBe("true");
    expect(chip("cursor").textContent).toBe("✓Cursor");
    expect(chip("codex").getAttribute("data-ready")).toBe("false");
    expect(chip("codex").textContent).toBe("✗Codex: Run `codex login`");
    expect(chip("claude-code").getAttribute("data-ready")).toBe("unknown");
    expect(chip("claude-code").textContent).toBe("?Claude Code: The check did not answer within 30 s.");
    expect(screen.queryByRole("button", { name: "Re-check" })).toBeNull();
  });

  it("says it is checking while the first read is out, with Re-check held", () => {
    render(<HarnessReadiness rows={undefined} recheck={async () => undefined} />);
    expect(screen.getByRole("group", { name: "Coding harnesses" }).textContent).toContain("Checking the coding harnesses");
    expect((screen.getByRole("button", { name: "Re-check" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reads again on Re-check, and keeps the chips with the error when it is refused", async () => {
    let calls = 0;
    render(
      <HarnessReadiness
        rows={ROWS}
        recheck={async () => {
          calls += 1;
          throw new Error("the readiness read failed");
        }}
      />,
    );
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Re-check" })));
    expect(calls).toBe(1);
    expect(within(screen.getByRole("group", { name: "Coding harnesses" })).getByRole("alert").textContent).toBe("the readiness read failed");
    expect(chip("codex").getAttribute("data-ready")).toBe("false");
  });
});
