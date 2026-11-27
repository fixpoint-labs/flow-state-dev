// @vitest-environment happy-dom
/**
 * Files in the composer, on fixtures: paste, the + picker, previews before
 * Send, refusals, and the line that carries them. What a send must carry is
 * each file's reference, never its bytes, so a worker reads what the person
 * attached and a session read stays small; a failed send keeps the files, so
 * nothing attached is lost. This proves the UI only; the goal check
 * (`goals/attachments/lab-composers/`) proves a teammate saw them.
 */
import type { Client } from "@flow-state-dev/client";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { App } from "../src/components/App";
import { scriptedServer, ScriptedProvider, type ScriptedServer } from "./scripted-server";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
});

const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], name, { type: "image/png" });

/**
 * The scripted lab, with every line its door took (`sends`), and the client the screen reads through:
 * the lab's own, with what `client` stands in for in it, a send that fails or an upload held, say.
 */
function recording(client: (lab: ScriptedServer) => Record<string, unknown> = () => ({})) {
  const lab = scriptedServer({ speed: 0.05 });
  return { lab, client: { ...lab.client, ...client(lab) } as Client, sends: lab.sends };
}

/** The app opens on Lead's conversation. */
async function open() {
  return (await screen.findByLabelText("Message Lead")) as HTMLTextAreaElement;
}

const composer = () => screen.getByLabelText("Message Lead").closest("form")!;

function paste(box: HTMLElement, file: File) {
  fireEvent.paste(box, { clipboardData: { items: [{ kind: "file", getAsFile: () => file }], types: ["Files"] } });
}

function pick(file: File) {
  fireEvent.change(within(composer()).getByLabelText("Upload files"), { target: { files: [file] } });
}

/** Both thumbnails are in the box and uploaded (no spinner left). */
async function attached(...names: string[]) {
  for (const name of names) await within(composer()).findByRole("img", { name });
  await waitFor(() => expect(within(composer()).queryByLabelText("Uploading")).toBeNull());
}

describe("files in a teammate's composer", () => {
  it("shows a pasted and a picked image before Send, sends their references, and draws them on your line", async () => {
    const { lab, client, sends } = recording();
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
    const box = await open();
    paste(box, png("bug.png"));
    pick(png("trace.png"));
    await attached("bug.png", "trace.png");
    // Each one can be taken off again before it goes.
    expect(within(composer()).getByRole("button", { name: "Remove bug.png" })).toBeTruthy();

    fireEvent.change(box, { target: { value: "What do these show?" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await waitFor(() => expect(sends).toHaveLength(1));
    // References, in the order attached: never the bytes or a data URL.
    expect(sends[0].attachments.map((file) => file.filename)).toEqual(["bug.png", "trace.png"]);
    for (const file of sends[0].attachments) expect(file.data).toMatch(/^fsd-blob:/);
    expect(sends[0].text).toBe("What do these show?");

    // The box is empty again, and your line carries both.
    await waitFor(() => expect(within(composer()).queryByRole("img")).toBeNull());
    const line = await screen.findByRole("list", { name: "Attached files" });
    await within(line).findByRole("img", { name: "bug.png" });
    await within(line).findByRole("img", { name: "trace.png" });
  });

  it("sends files with no words, and refuses a type it can't take by name without sending it", async () => {
    const { lab, client, sends } = recording();
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
    const box = await open();
    paste(box, new File([new Uint8Array([1])], "photo.heic", { type: "image/heic" }));
    expect((await within(composer()).findByRole("status", { name: "Attachment notices" })).textContent).toBe("photo.heic isn't supported");
    // A refused file alone is nothing to send.
    expect((within(composer()).getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(true);

    pick(png("only.png"));
    await attached("only.png");
    expect((within(composer()).getByRole("button", { name: "Send" }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(sends[0].attachments.map((file) => file.filename)).toEqual(["only.png"]);
  });

  it("keeps the files with the line when a send fails, and Retry sends them", async () => {
    let refuse = true;
    // The worker flow's door refuses while `refuse` holds, as a network that is down does.
    const { lab, client, sends } = recording((lab) => ({
      flow: (address: string) => {
        const flow = lab.client.flow(address);
        return {
          ...flow,
          send: async (...args: Parameters<typeof flow.send>) => {
            if (refuse) throw new Error("network down");
            return flow.send(...args);
          },
        } as typeof flow;
      },
    }));
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
    const box = await open();
    paste(box, png("bug.png"));
    await attached("bug.png");
    fireEvent.change(box, { target: { value: "Look at this" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect((await within(composer()).findByRole("alert")).textContent).toMatch(/Not sent: network down/);
    // Nothing attached is lost.
    expect(within(composer()).getByRole("img", { name: "bug.png" })).toBeTruthy();
    expect(box.value).toBe("Look at this");

    refuse = false;
    await act(async () => {
      fireEvent.click(within(composer()).getByRole("button", { name: "Retry" }));
    });
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(sends[0].attachments.map((file) => file.filename)).toEqual(["bug.png"]);
  });

  it("still sends a line pressed while its upload ran after you open another teammate, with no error in the new box", async () => {
    let finish: () => void = () => {};
    // The upload is held until the test lets it finish.
    const { lab, client, sends } = recording((lab) => ({
      upload: async (request: Parameters<Client["upload"]>[0]) => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return lab.client.upload(request);
      },
    }));
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
    const box = await open();
    paste(box, png("bug.png"));
    fireEvent.change(box, { target: { value: "Look at this" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    // Each teammate's conversation is its own composer: opening researcher leaves Lead's send to finish.
    fireEvent.click(screen.getByRole("navigation", { name: "Workers" }).querySelector<HTMLElement>('[data-worker="researcher"]')!);
    const other = (await screen.findByLabelText("Message researcher")).closest("form")!;
    await act(async () => finish());
    // The line goes with the file it was pressed with, and researcher's box shows no failure of Lead's.
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(sends[0].attachments.map((file) => file.filename)).toEqual(["bug.png"]);
    expect(within(other).queryByRole("alert")).toBeNull();
    expect(within(other).queryByRole("img")).toBeNull();
  });

  it("takes a PDF beside the text, and sends it by reference as a document", async () => {
    const { lab, client, sends } = recording();
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
    const box = await open();
    pick(new File([new TextEncoder().encode("%PDF-1.4\n")], "spec.pdf", { type: "application/pdf" }));
    await within(composer()).findByText("spec.pdf");
    await waitFor(() => expect(within(composer()).queryByLabelText("Uploading")).toBeNull());
    // A document is no refusal: nothing in the notices.
    expect(within(composer()).queryByRole("status", { name: "Attachment notices" })?.textContent ?? "").toBe("");
    fireEvent.change(box, { target: { value: "What does it say?" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(sends[0].attachments.map((file) => [file.filename, file.mediaType])).toEqual([["spec.pdf", "application/pdf"]]);
    expect(sends[0].attachments[0].data).toMatch(/^fsd-blob:/);
  });

  it("puts + in the Tab order, and Backspace in an empty box takes the last file off", async () => {
    const { lab, client } = recording();
    render(<ScriptedProvider server={lab} client={client}><App /></ScriptedProvider>);
    const box = await open();
    const plus = within(composer()).getByRole("button", { name: "Attach files" });
    expect(plus.tabIndex).toBe(0);
    paste(box, png("one.png"));
    paste(box, png("two.png"));
    await attached("one.png", "two.png");
    fireEvent.keyDown(box, { key: "Backspace" });
    await waitFor(() => expect(within(composer()).queryByRole("img", { name: "two.png" })).toBeNull());
    expect(within(composer()).getByRole("img", { name: "one.png" })).toBeTruthy();
  });
});
