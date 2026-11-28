// @vitest-environment happy-dom
// FIX-2796.
/**
 * A coding run's review card opens a changed file's diff in place. Most runs
 * up for review have no pull request, so without this the user can't read the
 * change without leaving Shift Manager. The card reads the patch from the run's
 * session through harness-manager's `changes` view on the coding worker flow,
 * when the file is opened. A stop another flow raised has no such view to call,
 * so its files list their lines and don't open.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeLabClient, reviewHold } from "./helpers/ask-hold";

const data = {
  branch: "eng/attach-files-left",
  commits: 1,
  subjects: ["Move the attach-files button left"],
  judge: null,
  files: [{ path: "src/composer.tsx", added: 1, removed: 1 }],
  fileCount: 1,
  added: 1,
  removed: 1,
};
const PATCH = "@@ -1 +1 @@\n-<Attach side=\"right\" />\n+<Attach side=\"left\" />";

let lab = fakeLabClient(data);
const views: Array<{ ref: unknown; input: unknown; options: unknown }> = [];
const client = () => ({
  ...lab.client,
  view: async (ref: unknown, input: unknown, options: unknown) => {
    views.push({ ref, input, options });
    return { value: { taskId: "t-1", diff: null, patch: { path: "src/composer.tsx", patch: PATCH, truncated: false, verified: true } }, topics: [] };
  },
});
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client: client() }) }));
vi.mock("../src/lib/session-feeds", async () => (await import("./helpers/fake-feed")).fakeFeeds([], () => lab.client.sessions.state()));
const { AskCard } = await import("../src/components/AskCard");

/** The same review, raised by the harness kit's coding worker flow. */
function coderHold() {
  const hold = reviewHold(true);
  return { ...hold, detail: { ...hold.detail!, flowKind: "coder", flowId: "coder" } } as typeof hold;
}

afterEach(() => {
  cleanup();
  views.splice(0);
});

describe("a coding run's review opens a changed file's diff in place", () => {
  it("reads the file's patch from the run's session when the file is opened", async () => {
    lab = fakeLabClient(data);
    render(<AskCard hold={coderHold()} />);
    fireEvent.click(await screen.findByRole("button", { name: /1 file changed/ }));
    // Nothing is read until a file is opened.
    expect(views).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /src\/composer\.tsx/ }));
    expect(await screen.findByText('+<Attach side="left" />')).toBeTruthy();
    expect(views).toEqual([{ ref: { flow: "coder", view: "changes" }, input: { path: "src/composer.tsx" }, options: { sessionId: "sess-run" } }]);
  });

  it("control: a review another flow raised lists its files, which don't open", async () => {
    lab = fakeLabClient(data);
    render(<AskCard hold={reviewHold(true)} />);
    fireEvent.click(await screen.findByRole("button", { name: /1 file changed/ }));
    const file = screen.getByRole("button", { name: /src\/composer\.tsx/ }) as HTMLButtonElement;
    expect(file.disabled).toBe(true);
    expect(views).toHaveLength(0);
  });
});
