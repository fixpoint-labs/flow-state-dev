// @vitest-environment happy-dom
/**
 * A review's controls wait for its data (FIX-2774). The inbox view's hold
 * carries no review data: the card reads it from the ask's session. Drawn
 * before that read lands, the review card offers a plain Accept, and Accept
 * sends `{ verdict: "accepted" }`, which finishes the review without the
 * landing the run offered (no pull request, no merge). So until the read
 * lands the card offers no answer, and a failed read says why, with Retry.
 *
 * The session read is the first read of the page's feed for the ask's
 * session, a promise the test settles; Retry opens that feed anew.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { reviewHold } from "./helpers/ask-hold";

type Pending = { resolve(value: unknown): void; reject(error: unknown): void };
const reads: Pending[] = [];
const answers: unknown[] = [];
const client = {
  sessions: {
    state: () =>
      new Promise((resolve, reject) => {
        reads.push({ resolve, reject });
      }),
  },
  flow: () => ({ request: () => ({ answer: async (body: unknown) => void answers.push(body) }) }),
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));
// The card reads the stop's data from the page's feed for the ask's session; its first read is the session's state.
vi.mock("../src/lib/session-feeds", async () => (await import("./helpers/fake-feed")).fakeFeeds([], () => client.sessions.state()));
const { AskCard } = await import("../src/components/AskCard");

afterEach(() => {
  cleanup();
  reads.splice(0);
  answers.splice(0);
});

const stop = {
  items: [{ id: "s1", type: "suspension", status: "completed", requestId: "req-1", itemIndex: 1, provenance: {}, suspensionId: "susp-1", reason: "user_input", kind: "review", message: "Review the run's changes" }],
};

describe("a review ask whose data is still being read, or failed to read", () => {
  it("offers no Accept while the read runs, says why a failed read failed with Retry, and offers Accept once a read lands", async () => {
    render(<AskCard hold={reviewHold(true)} />);
    await waitFor(() => expect(reads).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "Accept" }), "Accept offered before the review's data was read").toBeNull();

    await act(async () => reads[0]!.reject(new Error("The session could not be read.")));
    const failed = await screen.findByTestId("ask-review-failure");
    expect(failed.textContent).toContain("The session could not be read.");
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(reads).toHaveLength(2));
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    await act(async () => reads[1]!.resolve(stop));
    expect(await screen.findByRole("button", { name: "Accept" })).toBeTruthy();
    expect(answers).toEqual([]);
  });
});
