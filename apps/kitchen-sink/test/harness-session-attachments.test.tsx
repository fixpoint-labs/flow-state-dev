// @vitest-environment happy-dom
/**
 * The user pastes an image into a harness page's composer and sends: the
 * turn's request carries the image, by reference.
 *
 * The page lost it: the composer held the pasted image where no one saw it
 * and sent only the text. So these read what the page hands the session and
 * the client (the request on the wire), never the composer's state, which
 * looked fine while the image was dropped.
 *
 * The session hook and the client are stubbed; `useHarnessLines` and the
 * registry composer are the real ones.
 *
 * Red state produced before this was trusted: on main, where the page gives
 * its composer no uploader and sends `lines.send(prompt)`, both cases fail
 * (the pasted image is refused as unavailable, and the send carries no
 * `attachments`).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState, type ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const sendAction = vi.fn(async (..._args: unknown[]) => undefined);
/** The client's `flow(kind).send`: a line sent while a turn runs. */
const clientSend = vi.fn(async (..._args: unknown[]) => ({ id: "line-1" }));
/** The client's `flow(kind).upload`: answers as the server does. */
const upload = vi.fn(async (request: { data: Blob; mediaType?: string; filename?: string }) => ({
  type: "file" as const,
  mediaType: request.mediaType ?? request.data.type,
  ...(request.filename ? { filename: request.filename } : {}),
  data: "fsd-blob:b_0000000001",
}));
/** Which flow kind each upload went to. */
const uploadFlows: string[] = [];
let streaming = false;

vi.mock("@flow-state-dev/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/client")>()),
  createClient: () => ({
    flow: (kind: string) => ({
      send: (...args: unknown[]) => clientSend(...args),
      upload: (request: { data: Blob; mediaType?: string; filename?: string }) => {
        uploadFlows.push(kind);
        return upload(request);
      },
    }),
    sessions: { requests: async () => [] },
  }),
}));

vi.mock("@flow-state-dev/react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@flow-state-dev/react")>()),
  FlowProvider: ({ children }: { children: ReactNode }) => children,
  useJumpToLatest: () => ({ ref: () => undefined, atEnd: true, jump: () => undefined, sent: () => undefined, mine: () => ({}) }),
  useResourceManifest: () => ({ manifest: undefined, error: undefined }),
  useResourceCollectionList: () => ({ items: [], error: undefined }),
  useSession: () => {
    const [snapshot] = useState({ clientData: { session: {} } });
    return {
      flowKind: "cursor-session",
      sessionId: "s1",
      userId: "u",
      snapshot,
      refresh: async () => undefined,
      sendAction,
      followRequest: () => undefined,
      abortRequest: async () => undefined,
      dismissRequest: async () => undefined,
      isLoading: false,
      isStreaming: streaming,
      isFinishing: false,
      statusMessage: "",
      latestRequest: null,
      followedRequest: streaming ? { id: "turn-1", status: "in_progress" } : null,
      items: streaming ? [{ id: "i1", type: "message", role: "user", requestId: "turn-1", content: [] }] : [],
    };
  },
}));

vi.mock("@/components/flow-state/request-group", () => ({ RequestGroupRenderer: () => null }));

const { HarnessSessionView } = await import("@/components/harness-session");

afterEach(() => {
  cleanup();
  sendAction.mockClear();
  clientSend.mockClear();
  upload.mockClear();
  uploadFlows.length = 0;
  streaming = false;
  localStorage.clear();
});

function mount() {
  render(
    <HarnessSessionView
      label="Cursor"
      flowKind="cursor-session"
      sessionId="s1"
      models={{ models: [], defaultId: null, reason: null, fallbackId: null }}
    />,
  );
}

/** Paste an image into the box as a browser does, type a line, and send it. */
async function pasteAndSend(text: string) {
  const box = screen.getByPlaceholderText("Ask Cursor…") as HTMLTextAreaElement;
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
}

const sentImage = { type: "file", mediaType: "image/png", filename: "shot.png", data: "fsd-blob:b_0000000001" };

describe("a harness page sends a pasted image", () => {
  it("as the turn's attachment, uploaded to the session's flow", async () => {
    mount();
    await pasteAndSend("what is in this picture?");
    await waitFor(() => expect(sendAction).toHaveBeenCalledOnce());
    expect(sendAction.mock.calls[0]).toEqual([
      "turn",
      { prompt: "what is in this picture?" },
      expect.objectContaining({ attachments: [sentImage] }),
    ]);
    // Uploaded through the session's own flow, so its route's checks apply.
    expect(uploadFlows).toEqual(["cursor-session"]);
  });

  it("with the line that waits for a running turn, never as a steer", async () => {
    streaming = true;
    mount();
    await pasteAndSend("and this one?");
    await waitFor(() => expect(clientSend).toHaveBeenCalledOnce());
    expect(clientSend.mock.calls[0]).toEqual([
      "turn",
      { prompt: "and this one?" },
      expect.objectContaining({ sessionId: "s1", attachments: [sentImage] }),
    ]);
  });
});

// The composer clears its files when Send resolves. A page that resolves on a send it didn't
// make loses the images while the text draft stays, so a retry goes out without them.
describe("a harness page keeps the line's image when it isn't sent", () => {
  const strip = () => screen.queryByRole("img", { name: "shot.png" });

  it("when the turn's send fails", async () => {
    sendAction.mockImplementationOnce(async () => {
      throw new Error("refused");
    });
    mount();
    await pasteAndSend("what is in this picture?");
    await waitFor(() => expect(sendAction).toHaveBeenCalledOnce());
    await act(async () => undefined);
    expect(strip()).not.toBeNull();
  });

  // A turn takes a prompt: an image with no line is not a turn, so nothing goes and the image stays.
  it("when there is no line to send it with", async () => {
    mount();
    await pasteAndSend("");
    await act(async () => undefined);
    expect(sendAction).not.toHaveBeenCalled();
    expect(clientSend).not.toHaveBeenCalled();
    expect(strip()).not.toBeNull();
  });
});
