// @vitest-environment happy-dom
/**
 * The Shift Coordinator opens on its latest turn. A feed that opened at the
 * top left the user scrolling down through the whole conversation every time
 * they came back to it. A view with its own lead above the feed (a project's
 * Stream) still opens where it starts.
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Conversation } from "../src/components/Conversation";
import { toWorker } from "../src/lib/reads";

vi.mock("../src/lib/lab-data", () => ({
  useLab: () => ({ client: { userId: "alice" }, refresh: async () => undefined, answered: undefined }),
}));
vi.mock("../src/lib/conversation", () => ({
  senderOf: () => undefined,
  knownWorkers: () => new Set<string>(),
  useWorkerConversation: () => ({
    sessionId: "s1",
    opened: "s1",
    read: { items: [], truncated: false },
    failure: undefined,
    reread: () => undefined,
    resolving: false,
    ensure: async () => "s1",
  }),
}));

const SIZED = ["clientHeight", "scrollHeight", "scrollTop"] as const;
const saved = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  for (const name of SIZED) saved.set(name, Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
});
// The sizing lives on the shared prototype, so each test puts back what it found.
afterEach(() => {
  cleanup();
  for (const name of SIZED) {
    const was = saved.get(name);
    if (was === undefined) delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
    else Object.defineProperty(HTMLElement.prototype, name, was);
  }
});

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
