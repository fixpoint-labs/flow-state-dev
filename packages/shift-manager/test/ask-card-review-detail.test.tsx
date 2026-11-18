// @vitest-environment happy-dom
/**
 * A coding run's review in Inbox names what the run committed and what the
 * judge said, so the user can decide without opening the branch. The inbox
 * view's projection never carries a stop's data, so the card reads it from
 * the ask's session feed, with harness-manager's browser reader; a stop whose
 * session holds no review data says neither.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeLabClient, reviewHold } from "./helpers/ask-hold";

let lab = fakeLabClient(undefined);
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client: lab.client, noteAnswered: () => {} }) }));
const { AskCard } = await import("../src/components/AskCard");

afterEach(cleanup);

describe("Inbox's review names the run's commits and the judge's verdict", () => {
  it("reads them from the stop's data in its session", async () => {
    lab = fakeLabClient({
      branch: "fix-1/implement",
      commits: 2,
      subjects: ["Add the line", "Add the test"],
      judge: { verdict: "done", confidence: 0.82, reason: "" },
    });
    render(<AskCard hold={reviewHold(true)} />);
    expect(await screen.findByText(/2 commits/)).toBeTruthy();
    expect(screen.getByText(/Add the test/)).toBeTruthy();
    expect(screen.getByText(/Judge: done, 0\.82/)).toBeTruthy();
  });

  it("control: a stop with no review data names neither", async () => {
    lab = fakeLabClient(undefined);
    render(<AskCard hold={reviewHold(true)} />);
    expect(await screen.findByRole("button", { name: "Accept" })).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(/commit/)).toBeNull();
    expect(screen.queryByText(/Judge:/)).toBeNull();
  });
});
