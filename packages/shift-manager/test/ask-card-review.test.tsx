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
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client: lab.client }) }));
// The card reads the stop's data from the page's feed for the ask's session; its first read is the session's state.
vi.mock("../src/lib/session-feeds", async () => (await import("./helpers/fake-feed")).fakeFeeds([], () => lab.client.sessions.state()));
const { AskCard } = await import("../src/components/AskCard");

afterEach(() => {
  cleanup();
  lab.answers.splice(0);
});

describe("Inbox draws a coding run's review with the review card", () => {
  it("Accept answers the ask with submit and { verdict: accepted }", async () => {
    render(<AskCard hold={reviewHold(true)} />);
    expect(await screen.findByText("Ready for review")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    await waitFor(() => expect(lab.answers).toHaveLength(1));
    expect(lab.answers).toEqual([{ suspensionId: "susp-1", action: "submit", data: { verdict: "accepted" } }]);
  });

  it("Ask for changes sends the words as a revision", async () => {
    render(<AskCard hold={reviewHold(true)} titled />);
    fireEvent.change(await screen.findByLabelText("What to change"), { target: { value: " Keep the old line. " } });
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
