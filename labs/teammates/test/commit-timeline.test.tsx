// @vitest-environment happy-dom
/**
 * A run's commits read as a timeline, newest first: what each did (a type
 * chip, not a raw `fix(scope):` prefix), its short sha that copies the full
 * one, and when. The base merged in along the way is noise: a run of merges
 * folds into one muted entry that opens to list them.
 *
 * Red states this guards: merges listed one by one between the run's own
 * commits; prefixes left as raw text; entries reordered; a sha that can't be
 * copied; the review drawing the bare subject list when a log is there.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommitTimeline, conventional, timelineEntries } from "../src/components/CommitTimeline";
import { ReviewBody } from "../src/components/TaskReview";

afterEach(cleanup);

const NOW = Date.parse("2026-11-27T12:00:00Z");
const at = (minutesAgo: number) => new Date(NOW - minutesAgo * 60_000).toISOString();
const sha = (c: string) => c.repeat(40);

/** The flat list from the owner's screenshot, newest first, as harness-manager's log reads it. */
const LOG = [
  { sha: sha("a"), subject: "fix(harness-manager): keep review PR actions accurate and trusted", author: "Coder", at: at(4), merge: false },
  { sha: sha("b"), subject: "Merge branch 'main' into teammates/fix-run-review", author: "Coder", at: at(9), merge: true },
  { sha: sha("c"), subject: "Merge remote-tracking branch 'origin/main' into HEAD", author: "Coder", at: at(20), merge: true },
  { sha: sha("d"), subject: "Merge remote-tracking branch 'origin/main' into HEAD", author: "Coder", at: at(30), merge: true },
  { sha: sha("e"), subject: "test(harness-manager): the parity snapshot carries the run's baseBranch", author: "Coder", at: at(45), merge: false },
  { sha: sha("f"), subject: "Merge remote-tracking branch 'origin/main' into HEAD", author: "Coder", at: at(60), merge: true },
  { sha: sha("1"), subject: "Review data test: an unknown state that isn't a retired word", author: "Jake", at: at(180), merge: false },
];

describe("the commit timeline", () => {
  it("keeps the commits newest first, and folds each run of merges into one entry", () => {
    expect(timelineEntries(LOG).map((entry) => (entry.kind === "commit" ? entry.commit.sha![0] : `merges:${entry.commits.length}`))).toEqual([
      "a",
      "merges:3",
      "e",
      "merges:1",
      "1",
    ]);
    render(<CommitTimeline commits={LOG} now={NOW} />);
    const items = screen.getAllByRole("listitem").filter((li) => li.parentElement?.hasAttribute("data-commit-timeline"));
    expect(items.map((li) => (li.hasAttribute("data-merges") ? "merges" : "commit"))).toEqual(["commit", "merges", "commit", "merges", "commit"]);
    expect(items[0]!.textContent).toContain("keep review PR actions accurate and trusted");
  });

  it("says where a run of merges came from, and opens it to each merge", () => {
    render(<CommitTimeline commits={LOG} now={NOW} />);
    const group = screen.getByRole("button", { name: "3 merges from main" });
    expect(group.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Merge branch 'main' into teammates/fix-run-review")).toBeNull();
    fireEvent.click(group);
    expect(screen.getByText("Merge branch 'main' into teammates/fix-run-review")).toBeTruthy();
    expect(screen.getByRole("button", { name: "1 merge from main" })).toBeTruthy();
  });

  it("shows a conventional prefix as a type chip, not as text", () => {
    expect(conventional("fix(harness-manager): keep it")).toEqual({ type: "fix", scope: "harness-manager", text: "keep it" });
    expect(conventional("feat: day dividers")).toEqual({ type: "feat", scope: null, text: "day dividers" });
    expect(conventional("Review data test: expect it")).toEqual({ type: null, scope: null, text: "Review data test: expect it" });
    render(<CommitTimeline commits={LOG} now={NOW} />);
    const chips = document.querySelectorAll("[data-commit-type]");
    expect([...chips].map((chip) => chip.textContent)).toEqual(["fix·harness-manager", "test·harness-manager"]);
    expect(screen.queryByText(/fix\(harness-manager\):/)).toBeNull();
  });

  it("copies a commit's full sha from its short one, and says when it was made", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<CommitTimeline commits={LOG} now={NOW} />);
    fireEvent.click(screen.getByRole("button", { name: "Copy aaaaaaa" }));
    expect(writeText).toHaveBeenCalledWith(sha("a"));
    expect(await screen.findByRole("button", { name: "Copied aaaaaaa" })).toBeTruthy();
    const first = screen.getAllByRole("listitem")[0]!;
    expect(within(first).getByText("4m ago").getAttribute("datetime")).toBe(at(4));
  });

  it("names an author only when it isn't the run's own", () => {
    render(<CommitTimeline commits={LOG} now={NOW} />);
    expect(screen.getByText("by Jake")).toBeTruthy();
    expect(screen.queryByText("by Coder")).toBeNull();
  });

  it("draws bare subjects from an older review the same way, a merge found by its words", () => {
    render(<CommitTimeline commits={LOG.map(({ subject }) => ({ subject }))} now={NOW} />);
    expect(screen.getByRole("button", { name: "3 merges from main" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Copy / })).toBeNull();
  });
});

describe("the review's commits", () => {
  const review: ReviewDetail = {
    branch: "b", commits: 7, subjects: LOG.map((entry) => entry.subject), log: LOG, judge: null, checks: [], lands: ["merge"], landFailed: null, landAttempts: [],
    goal: null, answer: null, pullRequests: [], round: null, files: null, fileCount: null, added: null, removed: null,
  };

  it("draws its log as the timeline under the commits fold", () => {
    render(<ReviewBody review={review} />);
    fireEvent.click(screen.getByText("7 commits"));
    expect(document.querySelector("[data-commit-timeline]")).toBeTruthy();
    expect(screen.getByRole("button", { name: "3 merges from main" })).toBeTruthy();
  });
});
