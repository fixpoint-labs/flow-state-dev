// @vitest-environment happy-dom
/** The Shift Coordinator opens on its latest turn; a feed with a lead above it still opens at the top. */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Conversation } from "../src/components/Conversation";
import { toWorker } from "../src/lib/reads";

vi.mock("../src/lib/lab-data", () => ({
  useLab: () => ({ clients: { userId: "alice" }, refresh: async () => undefined, answered: undefined }),
}));
vi.mock("../src/lib/conversation", () => ({
  delegateOf: () => undefined,
  openConversation: async () => undefined,
  useWorkerConversation: () => ({
    sessionId: "s1",
    opened: "s1",
    read: { items: [], truncated: false },
    failure: undefined,
    reread: () => undefined,
  }),
}));

afterEach(cleanup);

const VIEW = 100;
const CONTENT = 1_000;
/** A feed sized as a browser would: a 1000px column in a 100px view. */
function sizeFeeds() {
  const tops = new WeakMap<object, number>();
  Object.defineProperties(HTMLElement.prototype, {
    clientHeight: { configurable: true, get: () => VIEW },
    scrollHeight: { configurable: true, get: () => CONTENT },
    scrollTop: {
      configurable: true,
      get() {
        return tops.get(this) ?? 0;
      },
      set(value: number) {
        tops.set(this, Math.max(0, Math.min(value, CONTENT - VIEW)));
      },
    },
  });
}

const cos = toWorker({ id: "chief-of-staff", kind: "coordinator", door: "run" })!;
const gaps = {} as never;
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

describe("where a conversation opens", () => {
  it("opens on the latest turn when it asks to start at the end", async () => {
    sizeFeeds();
    render(<Conversation worker={cos} sessions={[]} gaps={gaps} name="Shift Coordinator" testId="cos" startAtEnd />);
    await settle();
    expect(screen.getByTestId("cos-feed").scrollTop).toBe(CONTENT - VIEW);
  });

  it("opens where it starts otherwise, so a lead above the feed is what you land on", async () => {
    sizeFeeds();
    render(<Conversation worker={cos} sessions={[]} gaps={gaps} name="Shift Coordinator" testId="cos" />);
    await settle();
    expect(screen.getByTestId("cos-feed").scrollTop).toBe(0);
  });
});
