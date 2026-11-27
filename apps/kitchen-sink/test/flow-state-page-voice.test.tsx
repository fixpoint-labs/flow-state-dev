// @vitest-environment happy-dom
/**
 * The Flow State page draws its chat panel twice, once per responsive tree,
 * both mounted (one hidden by CSS). Voice playback must run from one place:
 * one `useVoice` with auto-play on means one subscription to the session's
 * streamed audio and one audio player, so a reply is spoken once. Two would
 * speak every reply twice, through two AudioContexts.
 *
 * And a voice line lands in the conversation like a typed one: its send tells
 * every drawing of the conversation that the user sent.
 *
 * The page is mounted with the data hooks and the panels around the
 * conversation stubbed; `useVoice` and the chat panel are the page's own.
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

/** Each subscription to the session's streamed TTS audio. */
const audioSubscriptions = vi.fn();
const sendAction = vi.fn(async () => ({}) as never);
const sent = vi.fn();

const session = {
  sessionId: "s1",
  flowKind: "chat-agent",
  userId: "u",
  snapshot: { sessionId: "s1", clientData: {} },
  items: [],
  isLoading: false,
  isStreaming: false,
  isFinishing: false,
  isStuck: false,
  canSendAction: true,
  statusMessage: "",
  error: null,
  latestRequest: null,
  followedRequest: null,
  childSessions: [],
  childSessionsStale: false,
  sendAction,
  abortRequest: vi.fn(),
  dismissRequest: vi.fn(),
  continueRequest: vi.fn(),
  resumeLatestRequest: vi.fn(async () => undefined),
  resumeSuspension: vi.fn(),
  refresh: vi.fn(async () => undefined),
  getItemsByAgent: () => [],
  getItemsByVisibility: () => [],
  subscribeAudioDelta: (handler: unknown) => {
    audioSubscriptions(handler);
    return () => undefined;
  },
};

/** The page's address query: `session=<id>` opens that session, as a rail pick does. */
let query = "";
/** The session `session=<id>` names, as the server describes it. */
let named: Record<string, unknown> = {};
/** Each feed the page made, by the order it was made, and the elements each was attached to. */
const attached = new Map<number, HTMLElement[]>();
let feeds = 0;

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams(query) }));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => children }));

vi.mock("@flow-state-dev/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("@flow-state-dev/react")>();
  const { useRef } = await import("react");
  /** A feed of its own per hook call site, recording what it is attached to and when it is told the user sent. */
  const makeFeed = () => {
    const id = ++feeds;
    attached.set(id, []);
    return {
      ref: (node: HTMLElement | null) => {
        if (node !== null) attached.get(id)!.push(node);
      },
      atEnd: true,
      jump: () => undefined,
      sent: () => sent(id),
      mine: (key: string) => ({ "data-sent-line": key }),
    };
  };
  return {
    ...real,
    FlowProvider: ({ children }: { children: ReactNode }) => children,
    FlowNavigator: () => null,
    useFlow: () => ({
      activeSessionId: "s1",
      sessions: [{ id: "s1", flowKind: "chat-agent" }],
      isLoading: false,
      selectSession: () => undefined,
      createSession: async () => undefined,
    }),
    useSession: () => session,
    useView: () => ({ value: undefined, stale: false }),
    useResourceCollectionList: () => ({ items: [], error: undefined }),
    // The page's feeds, recorded. `useVoice` stays the real one.
    useJumpToLatest: () => useRef(makeFeed()).current,
  };
});
vi.mock("@flow-state-dev/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/client")>()),
  // `sessions.get` names the session the address opens; any other read answers with nothing.
  createClient: () => {
    const nothing: unknown = new Proxy(() => undefined, {
      get: (_, key) => (key === "then" ? undefined : nothing),
      apply: () => nothing,
    });
    return new Proxy({}, { get: (_, key) => (key === "sessions" ? { get: async () => named, requests: async () => [] } : nothing) });
  },
}));
vi.mock("@flow-state-dev/workforce/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/workforce/browser")>()),
  createWorkforceClient: () => ({}),
}));
// The panels around the conversation: not what this checks.
for (const path of [
  "@/components/team-panel",
  "@/components/artifact-panel",
  "@/components/artifact-dialog",
  "@/components/client-data-bar",
  "@/components/pull-requests-panel",
  "@/components/background-work-panel",
  "@/components/flow-state/stuck-request-banner",
  "@/components/agent-response-card",
  "@/components/theme-toggle",
  "@/components/mode-rail-header",
  "@/components/resize-handle",
]) {
  vi.doMock(path, async (importOriginal) => {
    const real = await importOriginal<Record<string, unknown>>();
    return Object.fromEntries(Object.keys(real).map((name) => [name, typeof real[name] === "function" ? () => null : real[name]]));
  });
}

const { default: Page } = await import("@/app/flow-state/page");

afterEach(() => {
  cleanup();
  audioSubscriptions.mockClear();
  sendAction.mockClear();
  sent.mockClear();
  attached.clear();
  query = "";
  named = {};
});

/** Which feed each drawn conversation is attached to. */
function feedOfEachConversation(): (number | undefined)[] {
  return screen.getAllByTestId("conversation").map((el) => [...attached].find(([, nodes]) => nodes.includes(el))?.[0]);
}

// The voice controls show only where the browser can record.
Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => ({}) } });
(globalThis as { MediaRecorder?: unknown }).MediaRecorder = class {};

/** Turn voice responses on, from whichever drawing of the panel comes first. */
async function enableVoiceResponses() {
  await act(async () => {
    screen.getAllByTitle("Enable voice responses")[0]!.click();
  });
}

describe("voice on the Flow State page", () => {
  it("plays from one place, though the chat panel is drawn in both trees", async () => {
    render(<Page />);
    await act(async () => undefined);
    expect(screen.getAllByTestId("conversation").length).toBeGreaterThanOrEqual(2);
    await enableVoiceResponses();
    expect(audioSubscriptions).toHaveBeenCalledTimes(1);
  });

  // A feed scrolls one element. Each drawing of the conversation is its own
  // scrolling element, so each has its own feed; one feed shared by both would
  // follow whichever attached last, the hidden one at some widths.
  it("gives each drawing of the assistant's conversation its own feed", async () => {
    render(<Page />);
    await act(async () => undefined);
    const owners = feedOfEachConversation();
    expect(owners.length).toBeGreaterThanOrEqual(2);
    expect(owners.every((id) => id !== undefined)).toBe(true);
    expect(new Set(owners).size).toBe(owners.length);
  });

  // Both drawings are one conversation: the one shown at the window's width
  // now and the one shown if it changes. A line sent from either is told to both.
  it("tells every drawing of the conversation when a line is sent", async () => {
    render(<Page />);
    await act(async () => undefined);
    const owners = feedOfEachConversation();
    const box = screen.getAllByTestId("message-input")[0] as HTMLTextAreaElement;
    await act(async () => {
      fireEvent.change(box, { target: { value: "hello" } });
      fireEvent.submit(box.closest("form")!);
    });
    expect(new Set(sent.mock.calls.map(([id]) => id))).toEqual(new Set(owners));
  });

  it("gives each drawing of a picked worker's conversation its own feed", async () => {
    query = "session=w1";
    named = { id: "w1", flowKind: "agent", flowId: "agent" };
    render(<Page />);
    await act(async () => undefined);
    await act(async () => undefined);
    const owners = feedOfEachConversation();
    expect(owners.length).toBeGreaterThanOrEqual(2);
    expect(owners.every((id) => id !== undefined)).toBe(true);
    expect(new Set(owners).size).toBe(owners.length);
  });
});
