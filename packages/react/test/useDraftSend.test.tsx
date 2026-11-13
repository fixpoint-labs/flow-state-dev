// @vitest-environment happy-dom
/**
 * `useDraftSend`: a box's text, and its files, leave only once the send lands.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { FileContent } from "@flow-state-dev/core/items";

import { useDraftSend } from "../src";

const NS = "test:draft";

const FILE: FileContent = { type: "file", mediaType: "text/plain", filename: "notes.txt", data: "fsd://file/notes" };

/** A box's files as a composer's attachment strip holds them: `settle` waits on `uploaded`. */
function makeAttachments(files: { id: string; status: "uploading" | "ready" | "refused" }[], refusals: string[] = []) {
  let finish!: (files: FileContent[]) => void;
  const uploaded = new Promise<FileContent[]>((resolve) => (finish = resolve));
  return {
    files,
    refusals,
    settle: vi.fn(() => uploaded),
    consume: vi.fn((_ids: string[], _shown: string[]) => {}),
    finish,
  };
}

afterEach(() => {
  localStorage.clear();
});

describe("useDraftSend", () => {
  it("sends the trimmed line, then empties the box and its stored draft", async () => {
    const { result } = renderHook(() => useDraftSend(NS, "s1"));
    act(() => result.current.setText("  hello  "));
    const send = vi.fn(async (_line: string, _files: FileContent[]) => {});

    await act(() => result.current.submit(send));

    expect(send).toHaveBeenCalledWith("hello", []);
    expect(result.current.text).toBe("");
    expect(localStorage.getItem(`${NS}:s1`)).toBeNull();
  });

  it("waits for the box's uploads, sends their references with the line, and only then takes them from the box", async () => {
    const attachments = makeAttachments([{ id: "f1", status: "uploading" }], ["too big: huge.bin"]);
    const { result } = renderHook(() => useDraftSend(NS, "s1", attachments));
    act(() => result.current.setText("see file"));
    const send = vi.fn(async (_line: string, _files: FileContent[]) => {});

    let sent!: Promise<void>;
    act(() => void (sent = result.current.submit(send)));
    // Still uploading: nothing has gone yet, and the file is still in the box.
    expect(send).not.toHaveBeenCalled();
    expect(attachments.consume).not.toHaveBeenCalled();

    await act(async () => {
      attachments.finish([FILE]);
      await sent;
    });

    expect(send).toHaveBeenCalledWith("see file", [FILE]);
    expect(attachments.consume).toHaveBeenCalledWith(["f1"], ["too big: huge.bin"]);
  });

  it("keeps the text and the files when the send fails, and says why", async () => {
    const attachments = makeAttachments([{ id: "f1", status: "ready" }]);
    attachments.finish([FILE]);
    const { result } = renderHook(() => useDraftSend(NS, "s1", attachments));
    act(() => result.current.setText("see file"));

    await act(() => result.current.submit(async () => Promise.reject(new Error("offline"))));

    expect(result.current.failure).toBe("offline");
    expect(result.current.text).toBe("see file");
    expect(localStorage.getItem(`${NS}:s1`)).toBe("see file");
    // The file stays in the box, so a Retry sends it again.
    expect(attachments.consume).not.toHaveBeenCalled();
  });

  it("sends nothing from an empty box", async () => {
    const attachments = makeAttachments([{ id: "f1", status: "refused" }], ["too big: huge.bin"]);
    const { result } = renderHook(() => useDraftSend(NS, "s1", attachments));
    const send = vi.fn(async () => {});

    // A refused file is not something to send.
    expect(result.current.canSend).toBe(false);
    await act(() => result.current.submit(send));

    expect(send).not.toHaveBeenCalled();
    expect(attachments.settle).not.toHaveBeenCalled();
  });

  it("sends a box holding only files", async () => {
    const attachments = makeAttachments([{ id: "f1", status: "ready" }]);
    attachments.finish([FILE]);
    const { result } = renderHook(() => useDraftSend(NS, "s1", attachments));
    const send = vi.fn(async (_line: string, _files: FileContent[]) => {});

    expect(result.current.canSend).toBe(true);
    await act(() => result.current.submit(send));

    expect(send).toHaveBeenCalledWith("", [FILE]);
    expect(attachments.consume).toHaveBeenCalledWith(["f1"], []);
  });

  it("sends nothing when every file was refused while it uploaded and there is no text, leaving the refusals on screen", async () => {
    const attachments = makeAttachments([{ id: "f1", status: "uploading" }]);
    attachments.finish([]);
    const { result } = renderHook(() => useDraftSend(NS, "s1", attachments));
    const send = vi.fn(async () => {});

    await act(() => result.current.submit(send));

    expect(send).not.toHaveBeenCalled();
    expect(attachments.consume).not.toHaveBeenCalled();
    expect(result.current.failure).toBeUndefined();
  });

  it("keeps text typed while the send ran", async () => {
    let land!: () => void;
    const { result } = renderHook(() => useDraftSend(NS, "s1"));
    act(() => result.current.setText("first"));

    let sent!: Promise<void>;
    act(() => void (sent = result.current.submit(() => new Promise<void>((resolve) => (land = resolve)))));
    expect(result.current.sending).toBe(true);
    act(() => result.current.setText("second"));
    await act(async () => {
      land();
      await sent;
    });

    expect(result.current.text).toBe("second");
    expect(localStorage.getItem(`${NS}:s1`)).toBe("second");
  });
});
