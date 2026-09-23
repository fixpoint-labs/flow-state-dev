/**
 * Chromium for a goal that reads the shipped DevTool in a real browser.
 *
 * Kept out of `index.mts` on purpose: importing it loads Playwright, and most
 * goals never open a browser. Import it directly:
 *
 *   import { launchChromium } from "../../lib/playwright.mts";
 *
 * Two goals carry their own copy of {@link preinstalledChromium}
 * (`flow-instances/devtool-shows-the-selected-copy` and
 * `multi-seat-collab/it-hands-a-row-between-two-seats-in-view`). This is the
 * one a new goal imports; moving those two onto it is a separate change.
 */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright";

/**
 * A Chromium already on the machine whose build number Playwright did not pick.
 *
 * An environment that pre-installs browsers into `PLAYWRIGHT_BROWSERS_PATH`
 * pins one build. Bumping the Playwright package asks for a different one and
 * gets "run npx playwright install", which such a machine cannot do. Any
 * Chromium in that pool drives the DevTool fine, because a goal grades the
 * DevTool and not the browser, so an existing one is used rather than fetched.
 *
 * @returns The binary's path, or `undefined` when there is no pool and
 *   Playwright's own resolution should be used.
 */
export function preinstalledChromium(): string | undefined {
  const pool = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (pool === undefined || !existsSync(pool)) return undefined;
  for (const entry of readdirSync(pool)) {
    if (!entry.startsWith("chromium-")) continue;
    const binary = join(pool, entry, "chrome-linux", "chrome");
    if (existsSync(binary)) return binary;
  }
  return undefined;
}

/**
 * Launch a headless Chromium, preferring a pre-installed one.
 *
 * @returns The browser. The caller closes it.
 */
export async function launchChromium(): Promise<Browser> {
  const executablePath = preinstalledChromium();
  return await chromium.launch({
    headless: true,
    ...(executablePath === undefined ? {} : { executablePath }),
  });
}
