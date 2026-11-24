// @vitest-environment happy-dom
/**
 * Files in the composer, on the lab's own host: paste, the + picker, previews before
 * Send, refusals, and the line that carries them. What a send must carry is
 * each file's reference, never its bytes, so a worker reads what the person
 * attached and a session read stays small; a failed send keeps the files, so
 * nothing attached is lost. This proves the UI only; the goal check
 * (`goals/attachments/lab-composers/`) proves a worker saw them.
 */
import type { FileContent } from "@flow-state-dev/core/items";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ClientFetch } from "@flow-state-dev/client";
import { App } from "../src/components/App";
import { closeApps, openTestApp, type TestApp } from "./app-host";

afterEach(async () => {
  cleanup();
  window.history.replaceState(null, "", "/");
  window.localStorage.clear();
  await closeApps();
});

/** A real one-page PDF with `text` in its text layer: the host opens an upload to read it. */
function pdf(text: string): Uint8Array<ArrayBuffer> {
  const content = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [4 0 R] /Count 1 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents 5 0 R >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => {
    const at = out.length;
    out += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return at;
  });
  const xref = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((at) => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(out);
}

const png = (name: string) => new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3])], name, { type: "image/png" });

/**
 * The lab's host, with every line the main session's door took, as the page
 * sent it. `refuse.on` drops each send on the way, as a lost network does.
 */
async function recording(): Promise<{ lab: TestApp; sends: Array<{ text: string; attachments: readonly FileContent[] }>; refuse: { on: boolean } }> {
  const sends: Array<{ text: string; attachments: readonly FileContent[] }> = [];
  const refuse = { on: false };
  const lab = await openTestApp({
    intercept: (inner) =>
      (async (input, init) => {
        const url = String(input instanceof Request ? input.url : input);
        if (init?.method === "POST" && /\/actions\/respond$|\/respond$/.test(new URL(url, "http://x").pathname)) {
          if (refuse.on) throw new TypeError("network down");
          const body = JSON.parse(String(init.body)) as { input: { message: string }; attachments?: FileContent[] };
          sends.push({ text: body.input.message, attachments: body.attachments ?? [] });
        }
        return inner(input, init);
      }) as ClientFetch,
  });
  return { lab, sends, refuse };
}

async function open() {
  const picker = await screen.findByRole("region", { name: "Choose a project" });
  fireEvent.click(await within(picker).findByRole("button", { name: "vendor-notes" }, { timeout: 10_000 }));
  return (await screen.findByLabelText("Message the main session", undefined, { timeout: 10_000 })) as HTMLTextAreaElement;
}

const composer = () => screen.getByLabelText("Message the main session").closest("form")!;

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

describe("files in the main session's composer", () => {
  it("shows a pasted and a picked image before Send, sends their references, and draws them on your line", async () => {
    const { lab, sends } = await recording();
    render(lab.wrap(<App />));
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
    const { lab, sends } = await recording();
    render(lab.wrap(<App />));
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
    const { lab, sends, refuse } = await recording();
    render(lab.wrap(<App />));
    const box = await open();
    paste(box, png("bug.png"));
    await attached("bug.png");
    refuse.on = true;
    fireEvent.change(box, { target: { value: "Look at this" } });
    await act(async () => {
      fireEvent.keyDown(box, { key: "Enter" });
    });
    expect((await within(composer()).findByRole("alert")).textContent).toMatch(/Not sent: network down/);
    // Nothing attached is lost.
    expect(within(composer()).getByRole("img", { name: "bug.png" })).toBeTruthy();
    expect(box.value).toBe("Look at this");

    refuse.on = false;
    await act(async () => {
      fireEvent.click(within(composer()).getByRole("button", { name: "Retry" }));
    });
    await waitFor(() => expect(sends).toHaveLength(1));
    expect(sends[0].attachments.map((file) => file.filename)).toEqual(["bug.png"]);
  });

  it("takes a PDF beside the text, and sends it by reference as a document", async () => {
    const { lab, sends } = await recording();
    render(lab.wrap(<App />));
    const box = await open();
    pick(new File([pdf("The spec")], "spec.pdf", { type: "application/pdf" }));
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
    render((await recording()).lab.wrap(<App />));
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
