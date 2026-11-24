// @vitest-environment happy-dom
/**
 * The user pastes an image into Flow State chat and sends: the `run` request
 * carries it, by reference, beside the line.
 *
 * The page lost it: the composer held the pasted image where no one saw it,
 * then sent only the text. So this reads what the page hands the session (the
 * request on the wire), never the composer's state.
 *
 * The page is mounted with the data hooks and the panels around the
 * conversation stubbed, as the voice test does; the chat panel, its composer
 * and `useHarnessLines` are the real ones.
 *
 * Red state produced before this was trusted: on main, where the page gives
 * its composer no uploader and sends `lines.send(text)`, the case fails (the
 * pasted image is refused as unavailable, and `run` carries no `attachments`).
 * And key the composer's session on the loaded snapshot's id, and the
 * early-file case fails: the snapshot's arrival drops the file.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

const sendAction = vi.fn(async (..._args: unknown[]) => ({}) as never);
/** Which flow kind each upload went to. */
const uploadFlows: string[] = [];

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
  subscribeAudioDelta: () => () => undefined,
};

vi.mock("next/navigation", () => ({ useSearchParams: () => new URLSearchParams("") }));
vi.mock("next/link", () => ({ default: ({ children }: { children: ReactNode }) => children }));

vi.mock("@flow-state-dev/react", async (importOriginal) => {
  const real = await importOriginal<typeof import("@flow-state-dev/react")>();
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
    useJumpToLatest: () => ({ ref: () => undefined, atEnd: true, jump: () => undefined, sent: () => undefined, mine: () => ({}) }),
  };
});
vi.mock("@flow-state-dev/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/client")>()),
  // A flow handle uploads as the server does; any other read answers with nothing.
  createClient: () => {
    const nothing: unknown = new Proxy(() => undefined, {
      get: (_, key) => (key === "then" ? undefined : nothing),
      apply: () => nothing,
    });
    const flow = (kind: string) => ({
      upload: async (request: { data: Blob; mediaType?: string; filename?: string }) => {
        uploadFlows.push(kind);
        return {
          type: "file" as const,
          mediaType: request.mediaType ?? request.data.type,
          ...(request.filename ? { filename: request.filename } : {}),
          data: "fsd-blob:b_0000000001",
        };
      },
    });
    return new Proxy(
      {},
      {
        get: (_, key) =>
          key === "flow" ? flow : key === "sessions" ? { get: async () => ({}), requests: async () => [] } : nothing,
      },
    );
  },
}));
vi.mock("@flow-state-dev/workforce/browser", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/workforce/browser")>()),
  createWorkforceClient: () => ({}),
}));
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
  sendAction.mockClear();
  uploadFlows.length = 0;
  localStorage.clear();
});

/** Mount the page, paste an image into the first drawing's box, type `text`, and submit; its form is returned. */
async function pasteAndSubmit(text: string): Promise<HTMLFormElement> {
  render(<Page />);
  await act(async () => undefined);
  const box = screen.getAllByTestId("message-input")[0] as HTMLTextAreaElement;
  const image = new File([new Uint8Array(16)], "shot.png", { type: "image/png" });
  await act(async () => {
    fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", getAsFile: () => image }], files: [image] } });
  });
  await act(async () => {
    fireEvent.change(box, { target: { value: text } });
  });
  await act(async () => {
    fireEvent.submit(box.closest("form")!);
  });
  return box.closest("form")!;
}

describe("Flow State chat sends a pasted image", () => {
  it("on the run request, beside the line, uploaded to the assistant's flow", async () => {
    render(<Page />);
    await act(async () => undefined);
    // The panel is drawn once per responsive tree; the first is as good as the other.
    const box = screen.getAllByTestId("message-input")[0] as HTMLTextAreaElement;
    const image = new File([new Uint8Array(16)], "shot.png", { type: "image/png" });
    await act(async () => {
      fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", getAsFile: () => image }], files: [image] } });
    });
    await act(async () => {
      fireEvent.change(box, { target: { value: "what is in this picture?" } });
    });
    await act(async () => {
      fireEvent.submit(box.closest("form")!);
    });
    await waitFor(() => expect(sendAction).toHaveBeenCalledOnce());
    const [action, input, options] = sendAction.mock.calls[0]!;
    expect(action).toBe("run");
    expect(input).toMatchObject({ message: "what is in this picture?" });
    expect(options).toEqual({
      userMessage: "what is in this picture?",
      attachments: [{ type: "file", mediaType: "image/png", filename: "shot.png", data: "fsd-blob:b_0000000001" }],
    });
    expect(uploadFlows).toEqual(["chat-agent"]);
  });

  // The composer clears its files when Send resolves. A page that resolves on a send it didn't
  // make loses the images while the text draft stays, so a retry goes out without them.
  it("keeps the line's image when the run's send fails", async () => {
    sendAction.mockImplementationOnce(async () => {
      throw new Error("refused");
    });
    const form = await pasteAndSubmit("what is in this picture?");
    await waitFor(() => expect(sendAction).toHaveBeenCalledOnce());
    await act(async () => undefined);
    expect(within(form).queryByRole("img", { name: "shot.png" })).not.toBeNull();
  });

  // The run takes a message: an image with no line is not a run, so nothing goes and the image stays.
  it("keeps the line's image when there is no line to send it with", async () => {
    const form = await pasteAndSubmit("");
    await act(async () => undefined);
    expect(sendAction).not.toHaveBeenCalled();
    expect(within(form).queryByRole("img", { name: "shot.png" })).not.toBeNull();
  });

  // The panel is drawn in both responsive trees, and the text draft is shared between them.
  // A file must be too: attached in one, a resize across the breakpoint shows the other, and
  // Send there has to carry it, and clear it from both, so it can't ride along on a later line.
  it("sends a file attached in one drawing of the panel from the other, and clears it from both", async () => {
    render(<Page />);
    await act(async () => undefined);
    const [first, second] = screen.getAllByTestId("message-input") as HTMLTextAreaElement[];
    const image = new File([new Uint8Array(16)], "shot.png", { type: "image/png" });
    await act(async () => {
      fireEvent.paste(first!, { clipboardData: { items: [{ kind: "file", getAsFile: () => image }], files: [image] } });
    });
    await act(async () => {
      fireEvent.change(second!, { target: { value: "what is in this picture?" } });
    });
    await act(async () => {
      fireEvent.submit(second!.closest("form")!);
    });
    await waitFor(() => expect(sendAction).toHaveBeenCalledOnce());
    expect(sendAction.mock.calls[0]![2]).toMatchObject({ attachments: [expect.objectContaining({ filename: "shot.png" })] });
    await act(async () => undefined);
    expect(within(first!.closest("form")!).queryByRole("img", { name: "shot.png" })).toBeNull();
    expect(within(second!.closest("form")!).queryByRole("img", { name: "shot.png" })).toBeNull();
  });

  // The session's snapshot arrives after the page can take a file. Keyed on it, the composer
  // read its arrival as a switch of session and dropped the file: shown, then sent without it.
  it("keeps a file attached before the session's snapshot arrives", async () => {
    const loaded = session.snapshot;
    (session as { snapshot: unknown }).snapshot = null;
    onTestFinished(() => void ((session as { snapshot: unknown }).snapshot = loaded));
    const { rerender } = render(<Page />);
    await act(async () => undefined);
    const box = screen.getAllByTestId("message-input")[0] as HTMLTextAreaElement;
    const image = new File([new Uint8Array(16)], "early.png", { type: "image/png" });
    await act(async () => {
      fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", getAsFile: () => image }], files: [image] } });
    });
    (session as { snapshot: unknown }).snapshot = loaded;
    rerender(<Page />);
    await act(async () => {
      fireEvent.change(box, { target: { value: "and this?" } });
    });
    await act(async () => {
      fireEvent.submit(box.closest("form")!);
    });
    await waitFor(() => expect(sendAction).toHaveBeenCalledOnce());
    expect(sendAction.mock.calls[0]![2]).toMatchObject({ attachments: [expect.objectContaining({ filename: "early.png" })] });
  });
});
