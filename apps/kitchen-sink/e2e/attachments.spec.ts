/**
 * The user attaches images in Flow State chat and on each coding harness
 * page, in the browser: one pasted, one picked with +. Both show before Send,
 * the turn's request carries both by reference, and after a reload the user
 * line still shows both. A HEIC is refused in the composer and nothing is sent.
 *
 * The server runs in test mode: the assistant's model is the mock, and each
 * harness's SDK is the scripted one. Neither reads an image, so whether a
 * model or a harness *sees* the files is the goal check's
 * (`goals/attachments/kitchen-sink-chats/`); this holds the page's half: the
 * files leave the page, as references, and come back on the line.
 *
 * Read on the wire and off what the browser drew, never the composer's state.
 *
 * Red state produced before this was trusted: on main the composer has no
 * uploader, so both images are refused as unavailable and the strip shows no
 * thumbnail; the first expectation fails on every page.
 */
import { deflateSync } from "node:zlib";
import type { Page, Request } from "@playwright/test";
import { test, expect, openKitchenSink, byTestId } from "./fixtures";

/** A small solid PNG of `rgb`, valid enough for the browser to draw. */
function png(rgb: [number, number, number], size = 8): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff]! ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // truecolour
  const scanline = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: size }, () => rgb).flat())]);
  const pixels = Buffer.concat(Array.from({ length: size }, () => scanline));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Paste `bytes` as `name` into the visible message box, as a browser's clipboard does. */
async function pasteImage(page: Page, name: string, bytes: Buffer): Promise<void> {
  await byTestId(page, "message-input").evaluate(
    (box, { name, data }) => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], name, { type: name.endsWith(".png") ? "image/png" : "image/heic" }));
      box.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
    },
    { name, data: bytes.toString("base64") },
  );
}

/** Pick a file with the composer's + button. */
async function pickFile(page: Page, name: string, mimeType: string, buffer: Buffer): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.locator('button[aria-label="Attach files"]:visible').click();
  await (await chooser).setFiles({ name, mimeType, buffer });
}

/** An image the browser drew, by its file name, inside `scope`. */
async function expectDrawn(page: Page, scope: string, name: string): Promise<void> {
  const img = page.locator(`${scope} img[alt="${name}"]:visible`).first();
  await expect(img).toBeVisible();
  await expect.poll(() => img.evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
}

/** The send that carries a turn, on the flow's action route. */
const isTurn = (action: string) => (request: Request) =>
  request.method() === "POST" && new RegExp(`/api/flows/[^/]+/(?:[^/]+/)?actions/${action}$`).test(new URL(request.url()).pathname);

/** Paste one image, pick a second, send a line; the request is returned. */
async function attachBothAndSend(page: Page, action: string): Promise<Request> {
  await pasteImage(page, "pasted.png", png([200, 40, 40]));
  await pickFile(page, "picked.png", "image/png", png([40, 40, 200]));
  // Both are shown before Send, each with its remove button.
  await expectDrawn(page, "form", "pasted.png");
  await expectDrawn(page, "form", "picked.png");
  await expect(page.locator('button[aria-label="Remove pasted.png"]:visible')).toBeVisible();
  await expect(page.locator('button[aria-label="Remove picked.png"]:visible')).toBeVisible();
  // Uploaded on attach: wait for both before Send, so the line goes at once.
  await expect(page.locator('[aria-label="Uploading"]:visible')).toHaveCount(0);

  const sent = page.waitForRequest(isTurn(action));
  const box = byTestId(page, "message-input");
  await box.fill("What colours are these two images?");
  await box.press("Enter");
  return sent;
}

/** The request body's files: exactly the two, by reference, and no bytes. */
function expectReferences(request: Request): void {
  const body = request.postData() ?? "";
  const parsed = JSON.parse(body) as { attachments?: { data: string; filename?: string }[] };
  expect(parsed.attachments?.map((file) => file.filename)).toEqual(["pasted.png", "picked.png"]);
  for (const file of parsed.attachments ?? []) expect(file.data).toMatch(/^fsd-blob:/);
  expect(body).not.toMatch(/data:image|[A-Za-z0-9+/]{1024}/);
}

/** After a reload, the user line shows both images, read back from the server. */
async function expectOnTheLineAfterReload(page: Page): Promise<void> {
  const line = '[data-testid="conversation"] [aria-label="Attached files"]';
  await expectDrawn(page, line, "pasted.png");
  await page.reload();
  await expectDrawn(page, line, "pasted.png");
  await expectDrawn(page, line, "picked.png");
}

/** A HEIC is refused by name in the composer, and Send carries nothing. */
async function expectHeicRefused(page: Page, action: string): Promise<void> {
  let sends = 0;
  page.on("request", (request) => {
    if (isTurn(action)(request)) sends += 1;
  });
  await pasteImage(page, "photo.heic", Buffer.from("not really a heic"));
  await expect(page.locator('[aria-label="Attachment notices"]:visible')).toContainText("photo.heic isn't supported");
  await expect(page.locator('form img[alt="photo.heic"]:visible')).toHaveCount(0);
  expect(sends).toBe(0);
}

test.describe("attaching images", () => {
  test("Flow State chat sends both images by reference, and the line shows them after a reload", async ({
    page,
    sessionId,
    consoleErrors: _consoleErrors,
  }) => {
    await openKitchenSink(page, sessionId);
    await expectHeicRefused(page, "run");
    expectReferences(await attachBothAndSend(page, "run"));
    await expectOnTheLineAfterReload(page);
  });

  for (const [mode, label] of [
    ["claude-code", "Claude Code"],
    ["codex", "Codex"],
    ["cursor", "Cursor"],
  ] as const) {
    test(`the ${label} page sends both images by reference, and the line shows them after a reload`, async ({
      page,
      consoleErrors: _consoleErrors,
    }) => {
      await page.goto(`/${mode}`);
      await page.getByTestId("new-session").click();
      await expect(page.getByTestId("stream")).toHaveAttribute("data-session-id", /.+/);
      await expect(page.getByTestId("message-input")).toBeEnabled();
      await expectHeicRefused(page, "turn");
      expectReferences(await attachBothAndSend(page, "turn"));
      // The turn ran: the scripted harness answered it.
      await expect(page.getByTestId("turn-notice")).toBeVisible();
      await expectOnTheLineAfterReload(page);
    });
  }
});
