// @vitest-environment happy-dom
/**
 * The work-place chip: where a coding run's work went, and the commands that
 * take a person there. A count nobody could read says so instead of showing
 * 0, which would read as "the run changed nothing".
 *
 * Renders registry source through the vitest config's `@/` alias, as the other
 * render tests here do.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkPlace, commitsLabel, shortBranch } from "../../registry/components/work-place";

afterEach(cleanup);

const place = {
  branch: "harness/conv-a/t-7f3c--code",
  commits: 3,
  commands: { switch: "git switch harness/conv-a/t-7f3c--code", cd: "cd '/state home/t-7f3c'", log: "git log abc..harness/conv-a/t-7f3c--code" },
};

describe("the work-place chip", () => {
  it("names the count and the branch's last segments, and copies each command whole", async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<WorkPlace place={place} />);
    expect(screen.getByTestId("work-place").textContent).toContain("3 commits on …/conv-a/t-7f3c--code");
    fireEvent.click(screen.getByRole("button", { name: `Copy ${place.commands.cd}` }));
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledWith("cd '/state home/t-7f3c'"));
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("says the count is unknown and offers no log when no base was recorded", () => {
    render(<WorkPlace place={{ ...place, commits: null, commands: { ...place.commands, log: null, cd: null } }} />);
    expect(screen.getByTestId("work-place").textContent).toContain("commits unknown");
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("names the worktree, says when it is not ready, and whose it is for an attached session", () => {
    render(<WorkPlace place={{ ...place, name: "review-notes-a1b2c3", state: "removed", attachedTo: "s-owner" }} />);
    const text = screen.getByTestId("work-place").textContent;
    expect(text).toContain("review-notes-a1b2c3");
    expect(text).toContain("removed");
    expect(text).toContain("attached to s-owner");
  });

  it("says nothing of a ready worktree's state", () => {
    render(<WorkPlace place={{ ...place, state: "ready" }} />);
    expect(screen.getByTestId("work-place").textContent).not.toContain("ready");
  });

  it("is nothing for a run with no branch", () => {
    const { container } = render(<WorkPlace place={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("counts one commit in the singular, and keeps a short branch whole", () => {
    expect(commitsLabel(1)).toBe("1 commit");
    expect(commitsLabel(0)).toBe("0 commits");
    expect(shortBranch("main")).toBe("main");
  });
});
