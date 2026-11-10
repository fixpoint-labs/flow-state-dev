// @vitest-environment happy-dom
/**
 * A person attaching files to a registry composer: what they see before Send,
 * what they are told when a file is refused, and what Send carries.
 *
 * The rule under test is the epic's fence: a message carries references to
 * uploaded files, never their bytes. So every case reads what the composer
 * draws and what `onSubmit` receives, never the hook's internals: a hook whose
 * state looks right while Send ships data URLs must fail here.
 */
import type { FileContent } from "@flow-state-dev/core/items";
import { act, cleanup, renderHook, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import {
  AttachButton,
  AttachmentStrip,
  fitWithin,
  useAttachments,
  type AttachmentUploader,
} from "../../registry/components/attachments";
import { Message } from "../../registry/components/message";
import {
  PromptInput,
  PromptInputAttachButton,
  PromptInputAttachments,
  PromptInputSubmit,
  PromptInputTextarea,
  type PromptInputMessage,
} from "../../registry/components/prompt-input";

afterEach(cleanup);

const MB = 1024 * 1024;

/** A file of `size` bytes (sparse: the bytes are never read in these cases). */
function file(name: string, type: string, size = 1024): File {
  const f = new File([new Uint8Array(Math.min(size, 1024))], name, { type });
  if (size > 1024) Object.defineProperty(f, "size", { value: size });
  return f;
}

let blobCount = 0;

/** An uploader that answers as the server does, after `gate` resolves when one is given. */
function uploader(options: { gate?: Promise<void>; refuse?: (name: string) => number | undefined } = {}) {
  const upload = vi.fn(async (request: { data: Blob; mediaType?: string; filename?: string }): Promise<FileContent> => {
    if (options.gate) await options.gate;
    const status = options.refuse?.(request.filename ?? "");
    if (status !== undefined) throw Object.assign(new Error(`refused ${status}`), { status });
    blobCount += 1;
    return {
      type: "file",
      mediaType: request.mediaType ?? request.data.type,
      ...(request.filename ? { filename: request.filename } : {}),
      data: `fsd-blob:b_${String(blobCount).padStart(10, "0")}`,
    };
  });
  return { upload } satisfies AttachmentUploader;
}

function composer(client: AttachmentUploader | null) {
  const onSubmit = vi.fn<(message: PromptInputMessage) => void>();
  render(
    <PromptInput client={client} onSubmit={onSubmit}>
      <PromptInputAttachments />
      <PromptInputTextarea />
      <PromptInputAttachButton />
      <PromptInputSubmit />
    </PromptInput>,
  );
  return { onSubmit, box: screen.getByTestId("message-input") };
}

/** Paste `files` into `target` as a browser does: file items on the clipboard. */
function paste(target: Element, files: File[]) {
  fireEvent.paste(target, {
    clipboardData: { items: files.map((f) => ({ kind: "file", getAsFile: () => f })), files },
  });
}

/** Pick `files` through the hidden input the + button opens. */
function pick(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, "files", { value: files, configurable: true });
  fireEvent.change(input);
}

describe("attaching in PromptInput", () => {
  it("shows a pasted image at once, and Send carries its reference, not its bytes", async () => {
    const client = uploader();
    const { onSubmit, box } = composer(client);

    await act(async () => paste(box, [file("shot.png", "image/png")]));
    expect(screen.getByRole("img", { name: "shot.png" })).toBeTruthy();

    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    const sent = onSubmit.mock.calls[0]![0];
    expect(sent.files).toHaveLength(1);
    expect(sent.files[0]!.url).toMatch(/^fsd-blob:b_/);
    // No bytes, and no local preview address: a data URL, base64, or a `blob:` URL.
    expect(JSON.stringify(sent)).not.toMatch(/"(data|blob):|base64/);
    expect(client.upload).toHaveBeenCalledOnce();
    // Sent, so the strip is empty again.
    expect(screen.queryByRole("img", { name: "shot.png" })).toBeNull();
  });

  it("uploads on attach, and Send waits only for an upload still in flight", async () => {
    let open!: () => void;
    const client = uploader({ gate: new Promise<void>((done) => (open = done)) });
    const { onSubmit, box } = composer(client);

    await act(async () => pick([file("a.png", "image/png"), file("b.jpg", "image/jpeg")]));
    // Already uploading, before any Send.
    expect(client.upload).toHaveBeenCalledTimes(2);
    expect(screen.getAllByLabelText("Uploading")).toHaveLength(2);

    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect(onSubmit).not.toHaveBeenCalled();
    await act(async () => open());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]![0].files.map((f) => f.url)).toEqual([
      expect.stringMatching(/^fsd-blob:/),
      expect.stringMatching(/^fsd-blob:/),
    ]);
  });

  it("names every refused file in the composer, in a live region, and keeps the rest", async () => {
    const client = uploader();
    const { box } = composer(client);
    const ten = Array.from({ length: 10 }, (_, i) => file(`p${i}.png`, "image/png"));

    await act(async () => paste(box, ten));
    await act(async () =>
      pick([file("p10.png", "image/png"), file("report.png", "image/png", 25 * MB), file("photo.heic", "image/heic")]),
    );

    const live = screen.getByRole("status", { name: "Attachment notices" });
    expect(live.getAttribute("aria-live")).toBe("polite");
    expect(live.textContent).toContain("Only 10 images per message");
    expect(live.textContent).toContain("report.png is over 20 MB");
    expect(live.textContent).toContain("photo.heic isn't supported");
    expect(screen.getAllByRole("img")).toHaveLength(10);
    // Refused files never reached the server.
    expect(client.upload).toHaveBeenCalledTimes(10);
  });

  it("says why on the file's own chip when the server refuses it, and leaves it out of Send", async () => {
    const client = uploader({ refuse: (name) => (name === "bad.png" ? 415 : undefined) });
    const { onSubmit, box } = composer(client);

    await act(async () => pick([file("ok.png", "image/png"), file("bad.png", "image/png")]));
    await waitFor(() => expect(screen.getByRole("status", { name: "Attachment notices" }).textContent).toContain("bad.png isn't supported"));

    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]![0].files.map((f) => f.filename)).toEqual(["ok.png"]);
  });

  it("refuses by name when the composer has nowhere to upload, rather than dropping the file", async () => {
    const { box } = composer(null);
    await act(async () => paste(box, [file("shot.png", "image/png")]));
    expect(screen.getByRole("status", { name: "Attachment notices" }).textContent).toContain("Attachments aren't available here");
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("reaches + and each remove button by Tab, with labels; Backspace in an empty box removes the last file", async () => {
    const { box } = composer(uploader());
    await act(async () => pick([file("a.png", "image/png"), file("b.png", "image/png")]));

    const plus = screen.getByRole("button", { name: "Attach files" });
    const removeA = screen.getByRole("button", { name: "Remove a.png" });
    const removeB = screen.getByRole("button", { name: "Remove b.png" });
    for (const button of [plus, removeA, removeB]) expect(button.tabIndex).toBe(0);

    await act(async () => {
      fireEvent.keyDown(box, { key: "Backspace" });
    });
    expect(screen.queryByRole("img", { name: "b.png" })).toBeNull();
    await act(async () => fireEvent.click(removeA));
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("opens a multi-select picker for the contract's image types from +", async () => {
    composer(uploader());
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.multiple).toBe(true);
    expect(input.accept).toBe("image/png,image/jpeg,image/webp,image/gif");
    const click = vi.spyOn(input, "click");
    fireEvent.click(screen.getByRole("button", { name: "Attach files" }));
    expect(click).toHaveBeenCalledOnce();
  });

  it("takes dropped files and marks itself a drop target while dragging", async () => {
    const client = uploader();
    composer(client);
    const form = document.querySelector("form")!;
    const files = [file("dropped.png", "image/png")];
    await act(async () => fireEvent.dragEnter(form, { dataTransfer: { types: ["Files"], files } }));
    expect(form.getAttribute("data-dragging")).toBe("true");
    await act(async () => fireEvent.drop(form, { dataTransfer: { types: ["Files"], files } }));
    expect(form.getAttribute("data-dragging")).toBeNull();
    expect(screen.getByRole("img", { name: "dropped.png" })).toBeTruthy();
  });
});

describe("PromptInput's Send", () => {
  it("leaves a file attached while Send waits in the draft for the next message", async () => {
    let open!: () => void;
    const client = uploader({ gate: new Promise<void>((done) => (open = done)) });
    const { onSubmit, box } = composer(client);
    await act(async () => pick([file("a.png", "image/png")]));
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await act(async () => pick([file("b.png", "image/png")]));
    await act(async () => open());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(onSubmit.mock.calls[0]![0].files.map((f) => f.filename)).toEqual(["a.png"]);
    expect(screen.queryByRole("img", { name: "a.png" })).toBeNull();
    expect(screen.getByRole("img", { name: "b.png" })).toBeTruthy();
  });

  it("clears the refusal lines that were on screen once Send goes out", async () => {
    const { onSubmit, box } = composer(uploader());
    await act(async () => pick([file("a.png", "image/png"), file("x.heic", "image/heic")]));
    expect(screen.getByText("x.heic isn't supported")).toBeTruthy();
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce());
    expect(screen.queryByText("x.heic isn't supported")).toBeNull();
  });

  it("sends once when Enter is pressed again while an upload is in flight", async () => {
    let open!: () => void;
    const client = uploader({ gate: new Promise<void>((done) => (open = done)) });
    const { onSubmit, box } = composer(client);
    await act(async () => pick([file("a.png", "image/png")]));
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await act(async () => open());
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    // A second call would send the same file in a second message.
    expect(onSubmit).toHaveBeenCalledOnce();
  });
});

describe("useAttachments in an app's own composer", () => {
  function Composer({ client, sessionId, onSend }: { client: AttachmentUploader; sessionId: string; onSend: (files: FileContent[]) => void }) {
    const attachments = useAttachments({ client, sessionId });
    const [text, setText] = useState("");
    return (
      <div>
        <AttachmentStrip attachments={attachments} />
        <textarea aria-label="Message" value={text} onChange={(e) => setText(e.target.value)} onPaste={attachments.onPaste} />
        <AttachButton attachments={attachments} />
        <button type="button" onClick={async () => onSend(await attachments.take())}>
          Send
        </button>
      </div>
    );
  }

  it("takes the references once and clears the draft", async () => {
    const onSend = vi.fn();
    render(<Composer client={uploader()} sessionId="s1" onSend={onSend} />);
    await act(async () => paste(screen.getByLabelText("Message"), [file("x.webp", "image/webp")]));
    expect(screen.getByRole("img", { name: "x.webp" })).toBeTruthy();

    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Send" })));
    await waitFor(() => expect(onSend).toHaveBeenCalledOnce());
    expect(onSend.mock.calls[0]![0]).toEqual([expect.objectContaining({ type: "file", mediaType: "image/webp", data: expect.stringMatching(/^fsd-blob:/) })]);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("drops a draft's files on a session switch", async () => {
    const client = uploader();
    const { rerender } = render(<Composer client={client} sessionId="s1" onSend={vi.fn()} />);
    await act(async () => paste(screen.getByLabelText("Message"), [file("x.png", "image/png")]));
    expect(screen.getByRole("img", { name: "x.png" })).toBeTruthy();
    rerender(<Composer client={client} sessionId="s2" onSend={vi.fn()} />);
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("a send's batch", () => {
  /** An uploader whose answer for each file waits on that file's own gate. */
  function gated(refused: string[] = []) {
    const gates = new Map<string, () => void>();
    const client = {
      upload: vi.fn(async (request: { data: Blob; mediaType?: string; filename?: string }): Promise<FileContent> => {
        const name = request.filename ?? "";
        await new Promise<void>((open) => gates.set(name, open));
        if (refused.includes(name)) throw Object.assign(new Error("refused 500"), { status: 500 });
        return { type: "file", mediaType: request.mediaType ?? "image/png", filename: name, data: `fsd-blob:b_${name.padEnd(10, "0").slice(0, 10)}` };
      }),
    } satisfies AttachmentUploader;
    const open = (name: string) => act(async () => gates.get(name)!());
    return { client, open };
  }

  it("carries only the files on screen when Send began; one attached while it waits stays for the next message", async () => {
    const { client, open } = gated();
    const { result } = renderHook(() => useAttachments({ client, prepare: async (f) => f }));
    await act(async () => result.current.add([file("a.png", "image/png")]));
    let taken!: Promise<FileContent[]>;
    act(() => {
      taken = result.current.take();
    });
    await act(async () => result.current.add([file("b.png", "image/png")]));
    await open("b.png");
    await open("a.png");
    expect((await taken).map((f) => f.filename)).toEqual(["a.png"]);
    // b was not sent, so it is still in the draft for the next Send.
    expect(result.current.files.map((f) => f.filename)).toEqual(["b.png"]);
  });

  it("gives a second Send pressed while the first waits none of the first's files", async () => {
    const { client, open } = gated();
    const { result } = renderHook(() => useAttachments({ client, prepare: async (f) => f }));
    await act(async () => result.current.add([file("a.png", "image/png")]));
    let first!: Promise<FileContent[]>;
    let second!: Promise<FileContent[]>;
    act(() => {
      first = result.current.take();
      second = result.current.take();
    });
    await open("a.png");
    expect(await first).toHaveLength(1);
    // Sending a file twice would attach it to two messages.
    expect(await second).toEqual([]);
  });

  it("keeps a file the server refuses while Send waits, with its line, so the person sees it didn't go", async () => {
    const { client, open } = gated(["b.png"]);
    const { result } = renderHook(() => useAttachments({ client, prepare: async (f) => f }));
    await act(async () => result.current.add([file("a.png", "image/png"), file("b.png", "image/png")]));
    let taken!: Promise<FileContent[]>;
    act(() => {
      taken = result.current.take();
    });
    await open("a.png");
    await open("b.png");
    expect((await taken).map((f) => f.filename)).toEqual(["a.png"]);
    expect(result.current.files.map((f) => [f.filename, f.status])).toEqual([["b.png", "refused"]]);
    expect(result.current.refusals).toHaveLength(1);
  });

  it("doesn't announce a failed upload for a file already removed", async () => {
    const { client, open } = gated(["a.png"]);
    const onRefused = vi.fn();
    const { result } = renderHook(() => useAttachments({ client, prepare: async (f) => f, onRefused }));
    await act(async () => result.current.add([file("a.png", "image/png")]));
    act(() => result.current.remove(result.current.files[0]!.id));
    await open("a.png");
    expect(onRefused).not.toHaveBeenCalled();
    expect(result.current.refusals).toEqual([]);
  });
});

describe("downscaling", () => {
  it("fits the longest side within the edge and keeps the shape", () => {
    expect(fitWithin(4032, 3024, 1568)).toEqual({ width: 1568, height: 1176 });
    expect(fitWithin(1000, 3000, 1568)).toEqual({ width: 523, height: 1568 });
    // Already small enough: not resized.
    expect(fitWithin(1568, 800, 1568)).toBeUndefined();
  });
});

describe("a user line with files", () => {
  it("draws an image as a thumbnail read through the read route, and a document as a chip", () => {
    render(
      <Message
        item={{
          id: "i1",
          type: "message",
          role: "user",
          status: "completed",
          content: [
            { type: "output_text", text: "see these" },
            { type: "file", mediaType: "image/png", filename: "shot.png", data: "fsd-blob:b_abcdefgh12" },
            { type: "file", mediaType: "application/pdf", filename: "spec.pdf", data: "fsd-blob:b_zyxwvuts98" },
          ],
        } as never}
      />,
    );
    const img = screen.getByRole("img", { name: "shot.png" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("/api/flows/blobs/b_abcdefgh12");
    expect(screen.getByText("spec.pdf")).toBeTruthy();
    expect(screen.getByText("see these")).toBeTruthy();
  });

  it("draws a line with files and no text, and says so when a file can't be read", () => {
    render(
      <Message
        item={{
          id: "i2",
          type: "message",
          role: "user",
          status: "completed",
          content: [{ type: "file", mediaType: "image/png", filename: "gone.png", data: "fsd-blob:b_gonegone12" }],
        } as never}
      />,
    );
    fireEvent.error(screen.getByRole("img", { name: "gone.png" }));
    expect(screen.getByText("gone.png")).toBeTruthy();
    expect(screen.getByText("Couldn't load")).toBeTruthy();
  });

  // An app that authenticates by headers (a custom fetcher) can't put them on a
  // plain <img> request, so the thumbnail has to come through its own read.
  it("reads a thumbnail through readFile when one is given, and shows the bytes it returns", async () => {
    const create = vi.fn(() => "blob:local-1");
    const revoke = vi.fn();
    const saved = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: create, revokeObjectURL: revoke });
    onTestFinished(() => void Object.assign(URL, saved));
    const readFile = vi.fn(async () => new Blob(["png"], { type: "image/png" }));
    const file = { type: "file", mediaType: "image/png", filename: "auth.png", data: "fsd-blob:b_authauth12" };
    const { unmount } = render(
      <Message
        item={{ id: "i3", type: "message", role: "user", status: "completed", content: [file] } as never}
        readFile={readFile}
      />,
    );
    const img = (await screen.findByRole("img", { name: "auth.png" })) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:local-1");
    expect(readFile).toHaveBeenCalledWith(file, "/api/flows/blobs/b_authauth12");
    unmount();
    expect(revoke).toHaveBeenCalledWith("blob:local-1");
  });

  // An inline readFile is a new function each render, and a streamed reply re-renders the
  // transcript per token: re-reading on identity would send an authenticated request each time.
  it("reads a thumbnail once across re-renders with a new readFile and a rebuilt item", async () => {
    const saved = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: () => "blob:local-2", revokeObjectURL: () => {} });
    onTestFinished(() => void Object.assign(URL, saved));
    const reads = vi.fn(async (_file: FileContent, _url: string) => new Blob(["png"], { type: "image/png" }));
    const item = () =>
      ({
        id: "i5",
        type: "message",
        role: "user",
        status: "completed",
        content: [{ type: "file", mediaType: "image/png", filename: "once.png", data: "fsd-blob:b_onceonce12" }],
      }) as never;
    const { rerender } = render(<Message item={item()} readFile={(f, u) => reads(f, u)} />);
    await screen.findByRole("img", { name: "once.png" });
    rerender(<Message item={item()} readFile={(f, u) => reads(f, u)} />);
    rerender(<Message item={item()} readFile={(f, u) => reads(f, u)} />);
    await screen.findByRole("img", { name: "once.png" });
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it("says Couldn't load when readFile fails", async () => {
    const readFile = vi.fn(async () => {
      throw new Error("401");
    });
    render(
      <Message
        item={{
          id: "i4",
          type: "message",
          role: "user",
          status: "completed",
          content: [{ type: "file", mediaType: "image/png", filename: "locked.png", data: "fsd-blob:b_lockedlk12" }],
        } as never}
        readFile={readFile}
      />,
    );
    expect(await screen.findByText("Couldn't load")).toBeTruthy();
    expect(screen.queryByRole("img", { name: "locked.png" })).toBeNull();
  });
});
