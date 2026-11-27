// @vitest-environment happy-dom
/**
 * R reads again what the page holds (FIX-2775): the message log on Messages
 * and a project's workstreams on its page, not only the directory and the
 * Inbox. A screen's read registers while it is mounted and leaves when it
 * unmounts, so R never reads for a screen that is gone.
 *
 * The client's direct reads are the test's; the screens' hooks and the
 * registry are the app's.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Every list read made, by pattern: the message log's newest page, a project's values or its manifest. */
const lists: string[] = [];
const client = {
  userId: "u_1",
  resource: ({ scope, pattern }: { scope: string; pattern: string }) => ({
    scope,
    key: pattern,
    list: async () => {
      lists.push(pattern);
      return { items: [] };
    },
    listAll: async () => {
      lists.push(pattern);
      return [];
    },
  }),
  subscribe: () => ({ close: () => {} }),
};
vi.mock("../src/lib/lab-data", () => ({ useLab: () => ({ client }) }));

import { PageReadsProvider, useReadPageAgain } from "../src/lib/page-reads";
import { useMessages } from "../src/lib/messages";
import { useProjectWorkstreams } from "../src/lib/projects";

let readPageAgain: () => void = () => {};
function R() {
  readPageAgain = useReadPageAgain();
  return null;
}
function Messages() {
  useMessages();
  return null;
}
function Project() {
  useProjectWorkstreams({ visibility: "shared", id: "desk" });
  return null;
}

const count = (part: string) => lists.filter((pattern) => pattern.includes(part)).length;

beforeEach(() => {
  lists.splice(0);
});
afterEach(cleanup);

describe("R reads again the reads the page's screens hold", () => {
  it("reads the message log and a project's workstreams again, and stops reading a screen once it is gone", async () => {
    const page = (screens: { messages: boolean; project: boolean }) => (
      <PageReadsProvider>
        <R />
        {screens.messages ? <Messages /> : null}
        {screens.project ? <Project /> : null}
      </PageReadsProvider>
    );
    const { rerender } = render(page({ messages: true, project: true }));
    await waitFor(() => expect([count("messages"), count("workstreams")]).toEqual([1, 1]));

    act(() => readPageAgain());
    await waitFor(() => expect([count("messages"), count("workstreams")]).toEqual([2, 2]));

    rerender(page({ messages: false, project: true }));
    act(() => readPageAgain());
    await waitFor(() => expect(count("workstreams")).toBe(3));
    expect(count("messages")).toBe(2);
  });
});
