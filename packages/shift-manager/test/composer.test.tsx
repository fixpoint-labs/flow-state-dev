// @vitest-environment happy-dom
/**
 * The turn composer keeps what the user typed after they pressed Send. A send
 * that finishes clears the draft only if it is still the line that was sent.
 */
import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileContent } from "@flow-state-dev/core/items";
import { toBlobRef } from "@flow-state-dev/core/attachments";
import { TurnComposer } from "../src/components/TurnComposer";
import { TurnNotDelivered } from "../src/lib/send";
import { legacyTaskDraftKey, taskDraftKey } from "../src/lib/tasks";

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

/** A promise and the function that settles it. */
function gate() {
  let open!: () => void;
  const done = new Promise<void>((resolve) => (open = resolve));
  return { done, open };
}

describe("a slow send keeps the next line typed while it ran", () => {
  it("the turn composer: typing during a slow delivery is kept", async () => {
    const delivered = gate();
    render(<TurnComposer testId="turn" label="Message" placeholder="" blocked={null} send={() => delivered.done} />);
    const input = screen.getByTestId("turn-input") as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: "first message" } });
    act(() => fireEvent.click(screen.getByTestId("turn-send")));
    fireEvent.change(input, { target: { value: "the next message" } });
    await act(async () => {
      delivered.open();
      await delivered.done;
    });
    expect(input.value).toBe("the next message");
  });
});

describe("a line leaves the draft once the worker's session holds it (FIX-1773)", () => {
  it("clears before the send resolves, and puts the line back if it then fails", async () => {
    const reply = gate();
    const started = gate();
    let held!: () => void;
    render(
      <TurnComposer
        testId="t"
        label="Message worker"
        placeholder=""
        blocked={null}
        send={async (_message, onHeld) => {
          held = onHeld;
          started.open();
          await reply.done;
          throw new TurnNotDelivered("refused", "no thanks");
        }}
      />,
    );
    const input = screen.getByTestId("t-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a line" } });
    act(() => fireEvent.click(screen.getByTestId("t-send")));
    await act(() => started.done);
    // Sent, not yet held: the draft stays.
    expect(input.value).toBe("a line");
    act(() => held());
    expect(input.value).toBe("");
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("held");
    await act(async () => {
      reply.open();
      await reply.done;
    });
    // The worker refused after the line left: it comes back, with the reason.
    expect(input.value).toBe("a line");
    expect(screen.getByTestId("t-error").textContent).toBe("no thanks");
  });
});

describe("a delivered line that stopped the worker says on what", () => {
  const sendAs = async (stopped: "ask" | "wait" | null) => {
    cleanup();
    render(<TurnComposer testId="turn" label="Message" placeholder="" blocked={null} send={async () => ({ stopped })} />);
    fireEvent.change(screen.getByTestId("turn-input"), { target: { value: "fire eng.coder" } });
    await act(async () => fireEvent.click(screen.getByTestId("turn-send")));
    const status = screen.getByTestId("turn-status");
    expect(status.getAttribute("data-state")).toBe("delivered");
    expect(screen.queryByTestId("turn-retry")).toBeNull();
    return status.textContent;
  };

  it("points at Inbox only for a user's ask; any other stop reads as waiting, and no stop as plain delivered", async () => {
    expect(await sendAs("ask")).toMatch(/Delivered\..*in Inbox/);
    const wait = await sendAs("wait");
    expect(wait).toMatch(/Delivered\..*waiting/);
    expect(wait).not.toMatch(/Inbox/);
    expect(await sendAs(null)).toBe("Delivered.");
  });
});

describe("a send finishes under StrictMode (dev mounts every effect twice)", () => {
  it("clears the draft and says delivered", async () => {
    render(
      <StrictMode>
        <TurnComposer testId="turn" label="Message" placeholder="" blocked={null} send={async () => ({ stopped: null })} />
      </StrictMode>,
    );
    const input = screen.getByTestId("turn-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "a line" } });
    await act(async () => fireEvent.click(screen.getByTestId("turn-send")));
    expect(screen.getByTestId("turn-status").getAttribute("data-state")).toBe("delivered");
    expect(input.value).toBe("");
  });
});

describe("a reload keeps what was typed, and what may already have been sent (SM-ROB-8)", () => {
  const composer = (
    draftKey: string,
    send: (message: string, held: () => void) => Promise<void> = () => new Promise(() => {}),
  ) => (
    <TurnComposer testId="t" label="Message worker" placeholder="" blocked={null} draftKey={draftKey} send={send} />
  );

  it("brings a half-written line back to its own composer, and only there", () => {
    const first = render(composer("task:t-1"));
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "half an instruction" } });
    first.unmount();

    const again = render(composer("task:t-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("half an instruction");
    again.unmount();
    render(composer("task:t-2"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("");
  });

  it("brings an unconfirmed line back with its warning and no Retry, so a reload doesn't invite a second send", async () => {
    const first = render(composer("conversation:w-1", () => Promise.reject(new Error("the connection dropped"))));
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("unconfirmed");
    first.unmount();

    render(composer("conversation:w-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("ship it");
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("unconfirmed");
    expect(screen.getByTestId("t-error").textContent).toBe("the connection dropped");
    expect(screen.queryByTestId("t-retry")).toBeNull();
  });

  it("doesn't bring a line back as unsent when it lands after its composer closed", async () => {
    const reply = gate();
    const first = render(
      composer("conversation:w-1", async (_message?: string, held?: () => void) => {
        held?.();
        await reply.done;
      }),
    );
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    first.unmount();
    await act(async () => reply.open());

    render(composer("conversation:w-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("");
  });

  it("clears a line delivered after its composer closed, even when the session never said it held it (a task's send)", async () => {
    const reply = gate();
    const first = render(
      composer("task:t-1", async () => {
        await reply.done;
      }),
    );
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    first.unmount();
    await act(async () => reply.open());

    render(composer("task:t-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("");
  });

  it("keeps a line typed in a reopened composer when the earlier send settles", async () => {
    const reply = gate();
    const first = render(
      composer("conversation:w-1", async () => {
        await reply.done;
      }),
    );
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    first.unmount();

    const second = render(composer("conversation:w-1"));
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it today" } });
    await act(async () => reply.open());
    second.unmount();

    render(composer("conversation:w-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("ship it today");
  });

  it("keeps the warning through a reload while the next send is still out", async () => {
    const first = render(composer("task:t-1", () => Promise.reject(new Error("the connection dropped"))));
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    first.unmount();

    const second = render(composer("task:t-1", () => new Promise(() => {})));
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    second.unmount();

    render(composer("task:t-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("ship it");
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("unconfirmed");
  });

  it("keeps the warning for a line whose send ends unconfirmed after its composer closed", async () => {
    let drop!: (error: Error) => void;
    const first = render(composer("task:t-1", () => new Promise((_, reject) => (drop = reject))));
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    first.unmount();
    await act(async () => drop(new TurnNotDelivered("unconfirmed", "the status read failed")));

    render(composer("task:t-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("ship it");
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("unconfirmed");
    expect(screen.getByTestId("t-error").textContent).toBe("the status read failed");
  });

  it("forgets the warning when the resend lands after its composer closed", async () => {
    const first = render(composer("task:t-1", () => Promise.reject(new Error("the connection dropped"))));
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    first.unmount();

    const reply = gate();
    const second = render(composer("task:t-1", () => reply.done));
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    second.unmount();
    await act(async () => reply.open());

    render(composer("task:t-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("t-status").getAttribute("data-state")).not.toBe("unconfirmed");
  });

  it("forgets the warning once a send lands", async () => {
    const first = render(composer("conversation:w-1", () => Promise.reject(new Error("the connection dropped"))));
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    first.unmount();

    const second = render(composer("conversation:w-1", () => Promise.resolve()));
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("delivered");
    second.unmount();
    render(composer("conversation:w-1"));
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("");
    expect(screen.getByTestId("t-status").getAttribute("data-state")).not.toBe("unconfirmed");
  });
});

// FIX-2483: a task id is unique only on its board.
describe("a task's draft belongs to its board as well as its id", () => {
  const taskComposer = (
    boardRef: string,
    taskId: string,
    send: (message: string, held: () => void) => Promise<void> = () => new Promise(() => {}),
  ) => (
    <TurnComposer
      testId="t"
      label="Message worker"
      placeholder=""
      blocked={null}
      draftKey={taskDraftKey(boardRef, taskId)}
      legacyDraftKey={legacyTaskDraftKey(taskId)}
      send={send}
    />
  );
  const input = () => screen.getByTestId("t-input") as HTMLInputElement;

  it("two boards' tasks that share an id keep their own line and their own unconfirmed warning", async () => {
    // Board A's send may have arrived: its line and warning are kept, so a second send isn't invited.
    const a = render(taskComposer("lead.tasks", "t-1", () => Promise.reject(new Error("the connection dropped"))));
    fireEvent.change(input(), { target: { value: "ship it" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("unconfirmed");
    a.unmount();

    // Board B's task t-1 is a different task: it opens empty, free to send, with no warning.
    const b = render(taskComposer("reviewer.tasks", "t-1"));
    expect(input().value).toBe("");
    expect(screen.getByTestId("t-status").getAttribute("data-state")).toBe("idle");
    expect(screen.queryByTestId("t-error")).toBeNull();
    fireEvent.change(input(), { target: { value: "a different instruction" } });
    b.unmount();

    // And board A's task still holds its own.
    render(taskComposer("lead.tasks", "t-1"));
    expect(input().value).toBe("ship it");
    expect(screen.getByTestId("t-error").textContent).toBe("the connection dropped");
  });

  it("a draft stored under the old id-only key opens on the first board's task, once", () => {
    const old = render(
      <TurnComposer testId="t" label="Message worker" placeholder="" blocked={null} draftKey={legacyTaskDraftKey("t-1")} send={() => new Promise(() => {})} />,
    );
    fireEvent.change(input(), { target: { value: "written before the key named the board" } });
    old.unmount();

    const first = render(taskComposer("lead.tasks", "t-1"));
    expect(input().value).toBe("written before the key named the board");
    first.unmount();
    // Adopted by one task only: the other board's t-1 doesn't inherit it too.
    const other = render(taskComposer("reviewer.tasks", "t-1"));
    expect(input().value).toBe("");
    other.unmount();
    render(taskComposer("lead.tasks", "t-1"));
    expect(input().value).toBe("written before the key named the board");
  });
});

describe("adopting an old task draft when storage is full", () => {
  it("keeps the draft under the old key when the copy can't be written", () => {
    const old = render(
      <TurnComposer testId="t" label="Message worker" placeholder="" blocked={null} draftKey={legacyTaskDraftKey("t-1")} send={() => new Promise(() => {})} />,
    );
    fireEvent.change(screen.getByTestId("t-input"), { target: { value: "kept through a full storage" } });
    old.unmount();

    const storage = window.localStorage;
    const realSet = storage.setItem;
    const setItem = vi.fn(() => {
      throw new DOMException("quota", "QuotaExceededError");
    });
    Object.defineProperty(storage, "setItem", { value: setItem, configurable: true, writable: true });
    const full = render(
      <TurnComposer testId="t" label="Message worker" placeholder="" blocked={null} draftKey={taskDraftKey("lead.tasks", "t-1")} legacyDraftKey={legacyTaskDraftKey("t-1")} send={() => new Promise(() => {})} />,
    );
    full.unmount();
    Object.defineProperty(storage, "setItem", { value: realSet, configurable: true, writable: true });
    expect(setItem).toHaveBeenCalled();

    // Space again: the next open adopts it.
    render(
      <TurnComposer testId="t" label="Message worker" placeholder="" blocked={null} draftKey={taskDraftKey("lead.tasks", "t-1")} legacyDraftKey={legacyTaskDraftKey("t-1")} send={() => new Promise(() => {})} />,
    );
    expect((screen.getByTestId("t-input") as HTMLInputElement).value).toBe("kept through a full storage");
  });
});

// FIX-2522.
describe("a line's files (FIX-2522)", () => {
  /** An uploader that answers with a stored file's reference, as the Lab does. */
  const uploader = () => ({
    upload: vi.fn(async (request: { data: Blob; mediaType?: string; filename?: string }): Promise<FileContent> => ({
      type: "file",
      mediaType: request.mediaType ?? request.data.type,
      ...(request.filename ? { filename: request.filename } : {}),
      data: toBlobRef(`b_${(request.filename ?? "file").replace(/\W/g, "")}000000`),
    })),
  });
  const png = (name: string) => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: "image/png" });
  const paste = (target: Element, files: File[]) =>
    fireEvent.paste(target, { clipboardData: { items: files.map((f) => ({ kind: "file", getAsFile: () => f })), files } });

  it("go beside the line as references, by paste or the + picker, and leave the draft with it", async () => {
    const client = uploader();
    const send = vi.fn(async (_message: string, held: () => void, _files: FileContent[]) => held());
    render(<TurnComposer testId="t" label="Message worker" placeholder="" blocked={null} uploader={client} send={send} />);
    const input = screen.getByTestId("t-input");
    await act(async () => paste(input, [png("pasted.png")]));
    const picker = document.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, "files", { value: [png("picked.png")], configurable: true });
    await act(async () => fireEvent.change(picker));
    expect(screen.getByRole("button", { name: "Attach files" })).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);

    fireEvent.change(input, { target: { value: "what's wrong here?" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]![0]).toBe("what's wrong here?");
    expect(send.mock.calls[0]![2].map((f) => f.filename)).toEqual(["pasted.png", "picked.png"]);
    expect(JSON.stringify(send.mock.calls[0]![2])).not.toMatch(/base64|"blob:/);
    // Sent: the strip is empty again.
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("stay in the draft when the line never got there, and Retry sends them again", async () => {
    const client = uploader();
    let tries = 0;
    const send = vi.fn(async (_message: string, _held: () => void, _files: FileContent[]) => {
      tries += 1;
      if (tries === 1) throw new TurnNotDelivered("not-sent", "the Lab is unreachable");
    });
    render(<TurnComposer testId="t" label="Message worker" placeholder="" blocked={null} uploader={client} send={send} />);
    const input = screen.getByTestId("t-input");
    await act(async () => paste(input, [png("bug.png")]));
    fireEvent.change(input, { target: { value: "look" } });
    await act(async () => fireEvent.click(screen.getByTestId("t-send")));
    expect(screen.getByTestId("t-error").textContent).toContain("the Lab is unreachable");
    expect(screen.getAllByRole("listitem")).toHaveLength(1);

    await act(async () => fireEvent.click(screen.getByTestId("t-retry")));
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]![2].map((f) => f.filename)).toEqual(["bug.png"]);
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("are refused by name in a composer with nowhere to upload them", async () => {
    render(<TurnComposer testId="t" label="Message worker" placeholder="" blocked={null} send={async () => undefined} />);
    await act(async () => paste(screen.getByTestId("t-input"), [png("bug.png")]));
    expect(screen.getByRole("status", { name: "Attachment notices" }).textContent).toBe("Attachments aren't available here");
  });
});
