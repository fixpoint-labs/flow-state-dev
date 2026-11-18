// @vitest-environment happy-dom
/**
 * A coding run's review in Inbox. Shift Manager's profiles turn
 * harness-manager's `reviewChanges` on, so a run that committed waits there
 * for the user, and the review takes only `{ verdict: "accepted" }` or
 * `{ verdict: "revise", words }`: anything else is refused and the task waits
 * on. So the ask card must draw a review with the registry's review card and
 * send exactly that through the Lab's answer route, never the free-text
 * question card its union answer schema would otherwise fall to. The ask is
 * the inbox view's hold, answered through orchestration's one answer call.
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeLabClient, reviewHold } from "./helpers/ask-hold";

const lab = fakeLabClient(undefined);
const noteAnswered = vi.fn();
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client: lab.client, noteAnswered }) }));
const { AskCard } = await import("../src/components/AskCard");

afterEach(() => {
  cleanup();
  lab.answers.splice(0);
  noteAnswered.mockClear();
});

describe("Inbox draws a coding run's review with the review card", () => {
  it("Accept answers the ask with submit and { verdict: accepted }, and marks its session answered once", async () => {
    render(<AskCard hold={reviewHold(true)} />);
    expect(screen.getByText("Ready for review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(lab.answers).toHaveLength(1));
    expect(lab.answers).toEqual([{ suspensionId: "susp-1", action: "submit", data: { verdict: "accepted" } }]);
    expect(noteAnswered.mock.calls).toEqual([["sess-run"]]);
  });

  it("Ask for changes sends the words as a revision", async () => {
    render(<AskCard hold={reviewHold(true)} titled />);
    fireEvent.change(screen.getByLabelText("What to change"), { target: { value: " Keep the old line. " } });
    fireEvent.click(screen.getByRole("button", { name: "Ask for changes" }));
    await waitFor(() => expect(lab.answers).toHaveLength(1));
    expect(lab.answers).toEqual([{ suspensionId: "susp-1", action: "submit", data: { verdict: "revise", words: "Keep the old line." } }]);
  });

  it("control: the same stop, not marked as a review, draws no review card", () => {
    render(<AskCard hold={reviewHold(false)} />);
    expect(screen.queryByText("Ready for review")).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
  });
});
