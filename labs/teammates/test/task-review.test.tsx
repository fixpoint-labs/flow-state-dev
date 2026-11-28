// @vitest-environment happy-dom
/**
 * A coding task's review, as the popup draws it from the run's report: the
 * verdict says where the gap before shipping is, each check shows how it
 * ended and offers the next step, what is worth knowing beyond the change
 * can become a follow-up, and the foot lands the work or sends it back.
 *
 * Red states this guards: a *done* verdict that hides a not-done check under
 * "Done" (the reason the headline reads the checks); a check's next step that
 * sends on its own rather than filling the compose box; a landing that drops
 * the note; Open pull request's menu that lands anyway when asked not to.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReviewDetail } from "@flow-state-dev/harness-manager/browser";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { checkLines, detailParts, landHint, ReviewBody, ReviewFooter, RunAnswer, verdictOf, wholeReport } from "../src/components/TaskReview";
import type { ReviewAnswer } from "../src/components/flow-state/review-hold";

afterEach(cleanup);

const ANSWER = [
  "## What changed",
  "Adds day dividers to the conversation.",
  "",
  "## Checks",
  "- passed: `pnpm typecheck` — no errors",
  "- pre-existing: vitest packages/shift-manager — 21 failures, same without the change",
  "- not done: visual check — neither app was opened in a browser",
  "",
  "## Worth knowing",
  "- days.ts is duplicated in both apps.",
].join("\n");

const review = (over: Partial<ReviewDetail> = {}): ReviewDetail => ({
  branch: "teammates/t1/add-conversation-day-dividers-f39edc",
  commits: 1,
  subjects: ["feat: day dividers"],
  judge: { verdict: "done", confidence: 0.66, reason: "The answer does what the goal asks." },
  checks: [{ command: "pnpm test", exitCode: 0, timedOut: false, skipped: false, durationMs: 4200, tail: "ok" }],
  lands: ["pull-request", "merge"],
  landFailed: null,
  landAttempts: [],
  goal: "Add a day break to the conversation lists.",
  answer: ANSWER,
  pullRequests: [],
  round: null,
  files: [{ path: "labs/teammates/src/lib/days.ts", added: 40, removed: 0 }],
  fileCount: 1,
  added: 40,
  removed: 0,
  ...over,
});

describe("the review's body", () => {
  it("leads with a verdict that names the gap: done, but not everything was checked", () => {
    render(<ReviewBody review={review()} />);
    const verdict = screen.getByRole("region", { name: "Verdict" });
    expect(verdict.textContent).toContain("66%");
    expect(verdict.textContent).toContain("Done, but not everything was checked");
    expect(verdict.textContent).toContain("The answer does what the goal asks, with medium confidence. Checks: 2 passed, 1 failing before this change too, 1 not done.");
    expect(screen.getByRole("region", { name: "What changed" }).textContent).toContain("Adds day dividers to the conversation.");
    // The report's own headings aren't drawn again as text.
    expect(screen.getByRole("region", { name: "What changed" }).textContent).not.toContain("## Checks");
  });

  it("lists the project's checks, marked as the project's, then the run's, each with how it ended", () => {
    render(<ReviewBody review={review()} onDraft={() => {}} />);
    const checks = screen.getByRole("region", { name: "Checks" });
    const lines = [...checks.querySelectorAll("[data-check]")];
    expect(lines.map((l) => l.getAttribute("data-check"))).toEqual(["passed", "passed", "pre-existing", "not done"]);
    expect(lines[0]!.getAttribute("data-project")).toBe("true");
    expect(lines[0]!.textContent).toMatch(/Project check · exit 0 · 4\.2s/);
    expect(lines[2]!.textContent).toMatch(/Pre-existing$/);
  });

  it("puts a not-done check's request in the compose box rather than sending it", () => {
    const onDraft = vi.fn();
    render(<ReviewBody review={review()} onDraft={onDraft} />);
    fireEvent.click(screen.getByRole("button", { name: "Request check" }));
    expect(onDraft).toHaveBeenCalledWith("Do this check: visual check (neither app was opened in a browser)");
  });

  it("offers a follow-up for each thing worth knowing, only where someone can take it", () => {
    const onFollowUp = vi.fn();
    const { rerender } = render(<ReviewBody review={review()} onFollowUp={onFollowUp} />);
    const notes = screen.getByRole("region", { name: "Worth knowing" });
    fireEvent.click(within(notes).getByRole("button", { name: "Create follow-up" }));
    expect(onFollowUp).toHaveBeenCalledWith("days.ts is duplicated in both apps.");
    rerender(<ReviewBody review={review()} />);
    expect(screen.queryByRole("button", { name: "Create follow-up" })).toBeNull();
  });

  it("shows an answer without the report's headings whole, as What changed, and no run checks", () => {
    render(<ReviewBody review={review({ answer: "Fixed the typo in README.md." })} />);
    expect(screen.getByRole("region", { name: "What changed" }).textContent).toContain("Fixed the typo in README.md.");
    expect(screen.queryByRole("region", { name: "Worth knowing" })).toBeNull();
    expect(checkLines(review({ answer: "Fixed the typo." }), null)).toHaveLength(1);
  });
});

describe("the verdict", () => {
  const line = (state: "passed" | "failed" | "not done") => ({ state, title: "x", detail: null, project: false });
  it("is plain Done only when nothing failed and nothing was left unchecked", () => {
    const judge = { verdict: "done", confidence: 0.9, reason: "Meets the goal." };
    expect(verdictOf({ judge }, [line("passed")])).toMatchObject({ headline: "Done", tone: "success" });
    expect(verdictOf({ judge }, [line("passed"), line("failed")])).toMatchObject({ headline: "Done, but 1 check failed", tone: "warning" });
    expect(verdictOf({ judge }, [line("not done")])).toMatchObject({ headline: "Done, but not everything was checked", tone: "warning" });
    expect(verdictOf({ judge: { ...judge, verdict: "not-done" } }, [])).toMatchObject({ headline: "Not done", tone: "destructive" });
    expect(verdictOf({ judge: null }, [])).toMatchObject({ headline: "No judge read this run", confidence: null });
  });
});

/** The footer with its compose box's words held, as the popup holds them. */
function Footer({ detail, answer }: { detail: ReviewDetail; answer: (a: ReviewAnswer) => Promise<void> }) {
  const [words, setWords] = useState("");
  return <ReviewFooter review={detail} words={words} setWords={setWords} answer={answer} unanswerable={null} holdId="stop-1" />;
}

describe("the review's foot", () => {
  it("lands the work with the note as its words, and its menu accepts without landing", async () => {
    const answer = vi.fn(async () => {});
    const { unmount } = render(<Footer detail={review()} answer={answer} />);
    const foot = screen.getByRole("region", { name: "Your review" });
    expect(within(foot).getByRole("button", { name: "Request changes" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(within(foot).getByLabelText("Note for the run"), { target: { value: "Squash first." } });
    fireEvent.click(within(foot).getByRole("button", { name: "Open pull request" }));
    await screen.findByRole("status");
    expect(answer).toHaveBeenLastCalledWith({ verdict: "accepted", land: "pull-request", words: "Squash first." });
    unmount();

    render(<Footer detail={review()} answer={answer} />);
    fireEvent.click(screen.getByRole("button", { name: "More ways to accept" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Accept without landing/ }));
    await screen.findByRole("status");
    expect(answer).toHaveBeenLastCalledWith({ verdict: "accepted" });
  });

  it("sends Request changes with the box's words", async () => {
    const answer = vi.fn(async () => {});
    render(<Footer detail={review({ lands: [] })} answer={answer} />);
    fireEvent.change(screen.getByLabelText("Note for the run"), { target: { value: "Open it in a browser." } });
    fireEvent.click(screen.getByRole("button", { name: "Request changes" }));
    await screen.findByRole("status");
    expect(answer).toHaveBeenCalledWith({ verdict: "revise", words: "Open it in a browser." });
  });

  // FIX-2920: a run that opened its own pull request (#5661) was still offered "Open pull request", beside a header
  // linking #5661. Its land goes onto that pull request, so the footer says so and links it, and never offers a second.
  it("offers the pull request already open from the branch, not a new one, and lands onto it", async () => {
    const answer = vi.fn(async () => {});
    const pr = { number: 5661, url: "https://github.com/acme/widgets/pull/5661" };
    render(<Footer detail={review({ pullRequests: [pr], openPullRequest: pr })} answer={answer} />);
    const foot = screen.getByRole("region", { name: "Your review" });
    expect(within(foot).queryByRole("button", { name: /Open pull request/ })).toBeNull();
    expect(within(foot).getByRole("link", { name: "View PR #5661" }).getAttribute("href")).toBe(pr.url);
    expect(foot.querySelector("[data-land-hint]")?.textContent).not.toContain("Opens a PR");
    fireEvent.click(within(foot).getByRole("button", { name: "Push to PR #5661" }));
    await screen.findByRole("status");
    expect(answer).toHaveBeenLastCalledWith({ verdict: "accepted", land: "pull-request" });
  });

  // The run pushed its branch to #5809 itself, and the foot still offered "Push to PR #5809" and "Merge locally":
  // a push that would do nothing, with nothing saying the work was already there.
  it("offers no push when the work is already on the open pull request: says so, links it, and settles with Accept", async () => {
    const answer = vi.fn(async () => {});
    const pr = { number: 5809, url: "https://github.com/acme/widgets/pull/5809" };
    render(<Footer detail={review({ lands: [], pullRequests: [pr], openPullRequest: pr, openPullRequestTip: "pushed" })} answer={answer} />);
    const foot = screen.getByRole("region", { name: "Your review" });
    expect(within(foot).queryByRole("button", { name: /Push to PR/ })).toBeNull();
    expect(within(foot).queryByRole("button", { name: /Merge locally/ })).toBeNull();
    expect(foot.querySelector("[data-land-hint]")?.textContent).toContain("already on PR #5809");
    expect(within(foot).getByRole("link", { name: "View PR #5809" }).getAttribute("href")).toBe(pr.url);
    expect(within(foot).getByRole("button", { name: "Request changes" })).toBeTruthy();
    fireEvent.click(within(foot).getByRole("button", { name: "Accept" }));
    await screen.findByRole("status");
    expect(answer).toHaveBeenLastCalledWith({ verdict: "accepted" });
  });

  it("says the open pull request has commits the branch lacks, rather than offer a blind push", () => {
    const pr = { number: 5809, url: "https://github.com/acme/widgets/pull/5809" };
    render(<Footer detail={review({ lands: [], openPullRequest: pr, openPullRequestTip: "diverged" })} answer={vi.fn(async () => {})} />);
    const foot = screen.getByRole("region", { name: "Your review" });
    expect(within(foot).queryByRole("button", { name: /Push to PR/ })).toBeNull();
    expect(foot.querySelector("[data-land-hint]")?.textContent).toContain("PR #5809 has commits");
  });

  it("says what the primary button does, and what is still open", () => {
    expect(landHint("pull-request", { branch: "a/b" }, 1)).toBe("Opens a PR from …/b, with the goal, commits, checks and the judge's verdict as its description. 1 check is still open.");
    expect(landHint(null, { branch: null }, 0)).toBe("Completes the task; the branch stays as it is.");
  });
});

describe("an answer drawn as report sections", () => {
  it("only when the report is all of it, so no text outside its sections is lost", () => {
    expect(wholeReport("## What changed\nFixed it.\n\n## Checks\n- passed: pnpm test")?.changed).toBe("Fixed it.");
    // Another heading, prose before the first one, or no heading: the answer shows whole instead.
    expect(wholeReport("## Checks\n- passed: tests\n## Next steps\nRestart the server")).toBeNull();
    expect(wholeReport("Opened the PR.\n\n## Checks\n- passed: tests")).toBeNull();
    expect(wholeReport("Fixed the typo in README.md, line 1.")).toBeNull();
    expect(wholeReport(null)).toBeNull();
    expect(wholeReport("## Checks ##\n- passed: tests")?.checks).toHaveLength(1);
    // A long line that is nearly a heading reads in linear time.
    const started = performance.now();
    expect(wholeReport(`## ${" ".repeat(50_000)}x${" ".repeat(50_000)}#`)).toBeNull();
    expect(wholeReport(`## ${"#".repeat(100_000)}x`)).toBeNull();
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe("a check's detail", () => {
  it("sets its leading \"·\" facts apart from the prose, without splitting at a dot inside a fact", () => {
    expect(detailParts("vitest · labs/x · 4.2s. Extra sentence.")).toEqual({ facts: "vitest · labs/x · 4.2s", prose: "Extra sentence." });
    expect(detailParts("pnpm · v1.2.3 · no errors")).toEqual({ facts: "pnpm · v1.2.3 · no errors", prose: null });
    expect(detailParts("Not done. The tests cover grouping only.")).toEqual({ facts: null, prose: "Not done. The tests cover grouping only." });
  });
});

describe("a task's answer outside a review", () => {
  const REPORT = "## What changed\nFixed it.\n\n## Checks\n- passed: pnpm test";
  it("is a coding run's report, in sections, only for a coding task", () => {
    const { container, unmount } = render(<RunAnswer answer={REPORT} report />);
    expect(container.querySelector('[aria-label="Checks"]')).not.toBeNull();
    unmount();
    // A teammate's answer with the same headings is its own Markdown: drawn whole, nothing read as a check.
    const teammate = render(<RunAnswer answer={REPORT} report={false} />);
    expect(teammate.container.querySelector('[aria-label="Checks"]')).toBeNull();
    expect(teammate.container.textContent).toContain("passed: pnpm test");
  });
});
