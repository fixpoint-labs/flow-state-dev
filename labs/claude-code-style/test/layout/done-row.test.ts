/**
 * A finished task's row in the tasks pane, laid out by a real browser at the
 * pane's default and narrowest widths (`pane-width.ts`): the row fits the
 * pane, so the list never scrolls sideways, and its title keeps room to be
 * read. happy-dom lays nothing out, so this runs the lab's stylesheet in
 * Chromium, over a Vite server on `index.html` beside it.
 *
 * Red state produced before this was trusted: the row as it was, with the
 * worker, spend and age each refusing to shrink, overflows at both widths
 * and squeezes the title to nothing.
 */
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "@playwright/test";
import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PANE_DEFAULT, PANE_MIN } from "../../src/lib/pane-width";

let server: ViteDevServer;
let browser: Browser;
let origin: string;

beforeAll(async () => {
  server = await createServer({
    configFile: fileURLToPath(new URL("../../vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL(".", import.meta.url)),
    base: "/",
    logLevel: "error",
    server: { port: 0, host: "127.0.0.1" },
  });
  await server.listen();
  origin = server.resolvedUrls!.local[0]!.replace(/\/$/, "");
  browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {});
}, 60_000);

afterAll(async () => {
  await browser?.close();
  await server?.close();
});

describe("a finished task's row in the tasks pane", () => {
  for (const width of [PANE_DEFAULT, PANE_MIN]) {
    it(`fits the pane at ${width}px with its title readable`, async () => {
      const page = await browser.newPage({ viewport: { width: 1000, height: 800 } });
      try {
        await page.goto(`${origin}/index.html?width=${width}`);
        await page.getByText(/Done · 3/).click();
        const rows = page.locator('[data-task-status="completed"]');
        await expect.poll(() => rows.count()).toBe(3);

        const list = page.locator('aside[aria-label="Background tasks"] .overflow-y-auto');
        const { scrollWidth, clientWidth } = await list.evaluate((el) => ({ scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
        expect(scrollWidth, "the list scrolls sideways").toBeLessThanOrEqual(clientWidth);

        const box = (await list.boundingBox())!;
        for (let i = 0; i < 3; i++) {
          const row = (await rows.nth(i).boundingBox())!;
          expect(row.x + row.width, `row ${i + 1} runs past the pane`).toBeLessThanOrEqual(box.x + box.width + 0.5);
          // Room for a few words of the title, not a sliver of ellipsis.
          const title = (await rows.nth(i).locator("[data-task-title]").boundingBox())!;
          expect(title.width, `row ${i + 1}'s title`).toBeGreaterThanOrEqual(80);
        }
      } finally {
        await page.close();
      }
    });
  }
});
