/**
 * Goal check: Kitchen Sink opens on a picker of four modes. A mode this host
 * can't run says why, on the picker and at its own address, and draws nothing
 * else. Flow State opens today's app at its own address.
 *
 * Real path, no model, out of CI. See goal.md for the contract.
 *
 * One production build (built here, never assumed), served four times with
 * `next start`, each with a different host setting, and never rebuilt
 * between. One real browser reads each start's pages. Legs:
 *
 *   picker      `/` lists the four modes in order; Flow State is available and
 *               links to its address; each harness mode is unavailable and
 *               shows this start's reason.
 *   address     each harness mode opened by its address shows the reason its
 *               card shows and a link back, and no rail, no navigator, no
 *               composer.
 *   return      on the start with a checkout: picking Flow State opens today's
 *               shell at `/flow-state`; its rail's link back opens the picker
 *               again, all four listed.
 *   phone       on the unset start at a phone's width: the four stack, each
 *               reason is on screen, and nothing scrolls sideways.
 *
 * Run:      PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers pnpm tsx goals/kitchen-sink-harness-mode/opens-on-the-picker/run.mts
 * Controls: GOAL_CONTROL=gate-open  (must FAIL at picker and address, and nothing else)
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright";
import { goalTmpDir, KITCHEN_SINK, loadFixture, runGoal } from "../../lib/index.mts";
import { buildKitchenSink, startKitchenSink, type KitchenSinkServer } from "../../lib/kitchen-sink.mts";
import { launchChromium } from "../../lib/playwright.mts";

interface Mode {
  id: string;
  label: string;
  href: string;
}

interface Start {
  name: string;
  setting: "unset" | "plain-directory" | "checkout";
  vercel: boolean;
  /** What each harness mode's reason must match on this start. */
  reason: string;
}

interface Fixture {
  port: number;
  modes: Mode[];
  starts: Start[];
  phone: { width: number; height: number };
}

const fixture = loadFixture<Fixture>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";

/** The legs each control must redden, and only those. */
const EXPECTED: Record<string, string[]> = {
  // Every mode is let past the host: no start shows the host's reason, on the
  // picker or at an address. "Not built yet" still shows, so the checkout
  // start alone stays green, and the others go red.
  "gate-open": ["picker", "address"],
};
if (CONTROL !== "" && EXPECTED[CONTROL] === undefined) {
  throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(EXPECTED).join(", ")}`);
}

const SETTING = "KITCHEN_SINK_HARNESS_WORKSPACE";
const harnessModes = fixture.modes.filter((mode) => mode.id !== "flow-state");

/** A card on the picker, as drawn. */
interface Card {
  id: string;
  label: string;
  available: boolean;
  href: string | null;
  reason: string | null;
}

/** The picker's cards, in the order drawn. */
async function readPicker(page: Page): Promise<Card[]> {
  await page.locator("[data-mode-id]").first().waitFor({ timeout: 15_000 });
  return await page.locator("[data-mode-id]").evaluateAll((cards) =>
    cards.map((card) => ({
      id: card.getAttribute("data-mode-id") ?? "",
      label: card.querySelector(".font-medium")?.textContent ?? "",
      available: card.getAttribute("data-available") === "true",
      href: card.querySelector("a")?.getAttribute("href") ?? null,
      reason: card.querySelector('[data-testid="mode-reason"]')?.textContent ?? null,
    })),
  );
}

/** The `.next/BUILD_ID` the server is about to serve. */
const buildId = () => readFileSync(join(KITCHEN_SINK, ".next", "BUILD_ID"), "utf8").trim();

await runGoal(async (failures) => {
  const evidence: string[] = [];
  const fail = (leg: string, message: string) => failures.push(`[${leg}] ${message}`);

  // The directories the settings name, made fresh by this run.
  const tmp = goalTmpDir("kitchen-sink-harness-mode");
  const plain = join(tmp, "plain");
  const checkout = join(tmp, "checkout");
  mkdirSync(plain, { recursive: true });
  execFileSync("git", ["init", "-q", checkout]);
  const named: Record<Start["setting"], string> = { unset: "", "plain-directory": plain, checkout };

  buildKitchenSink();
  const built = buildId();
  evidence.push(`one build ${built}`);

  const browser = await launchChromium();
  let server: KitchenSinkServer | undefined;
  try {
    for (const start of fixture.starts) {
      if (buildId() !== built) fail("build", `the build changed before the ${start.name} start; each start must serve the same build`);
      server = await startKitchenSink(fixture.port, {
        NODE_ENV: "production",
        [SETTING]: named[start.setting],
        VERCEL: start.vercel ? "1" : "",
        ...(CONTROL === "" ? {} : { GOAL_CONTROL: CONTROL }),
      });
      const page = await browser.newPage();
      const reason = new RegExp(start.reason);
      try {
        // ---- picker: four modes, in order; the host's reason under each harness mode
        await page.goto(`${server.origin}/`);
        const cards = await readPicker(page);
        const order = cards.map((card) => card.id);
        const wantOrder = fixture.modes.map((mode) => mode.id);
        if (order.join() !== wantOrder.join()) {
          fail("picker", `${start.name}: the picker lists [${order.join(", ")}] (want [${wantOrder.join(", ")}])`);
        }
        for (const mode of fixture.modes) {
          const card = cards.find((c) => c.id === mode.id);
          if (card === undefined) continue;
          if (card.label !== mode.label) fail("picker", `${start.name}: ${mode.id} is labelled "${card.label}" (want "${mode.label}")`);
          if (mode.id === "flow-state") {
            if (!card.available || card.href !== mode.href) {
              fail("picker", `${start.name}: Flow State is ${card.available ? "available" : "unavailable"}, linking to ${card.href} (want available, linking to ${mode.href})`);
            }
            continue;
          }
          if (card.available || card.href !== null) {
            fail("picker", `${start.name}: ${mode.label} is offered as available (want unavailable)`);
          } else if (card.reason === null || !reason.test(card.reason)) {
            fail("picker", `${start.name}: ${mode.label} shows the reason ${JSON.stringify(card.reason)} (want /${start.reason}/)`);
          } else if (start.setting === "plain-directory" && !card.reason.includes(plain)) {
            fail("picker", `${start.name}: ${mode.label}'s reason does not name ${plain}: ${JSON.stringify(card.reason)}`);
          }
        }
        evidence.push(`${start.name}: picker [${cards.map((c) => `${c.id}:${c.available ? "on" : JSON.stringify(c.reason)}`).join(", ")}]`);

        // ---- address: each harness mode by its address refuses with its card's reason
        for (const mode of harnessModes) {
          await page.goto(`${server.origin}${mode.href}`);
          await page.waitForLoadState("networkidle");
          const shown = await page.getByTestId("mode-reason").textContent({ timeout: 5_000 }).catch(() => null);
          const card = cards.find((c) => c.id === mode.id);
          const drawn = {
            rail: await page.getByTestId("rail").count(),
            navigator: await page.locator("nav[data-fsd-flow-navigator]").count(),
            composer: await page.getByTestId("message-input").count(),
            newSession: await page.getByTestId("new-session").count(),
          };
          if (shown === null || !reason.test(shown)) {
            fail("address", `${start.name}: ${mode.href} shows the reason ${JSON.stringify(shown)} (want /${start.reason}/)`);
          } else if (card?.reason !== shown) {
            fail("address", `${start.name}: ${mode.href} shows ${JSON.stringify(shown)}, the picker ${JSON.stringify(card?.reason)}`);
          }
          if (drawn.rail + drawn.navigator + drawn.composer + drawn.newSession > 0) {
            fail("address", `${start.name}: ${mode.href} drew ${JSON.stringify(drawn)} (want nothing)`);
          }
          if ((await page.getByRole("link", { name: "Back to the modes" }).count()) !== 1) {
            fail("address", `${start.name}: ${mode.href} has no link back to the modes`);
          }
        }
        evidence.push(`${start.name}: ${harnessModes.map((m) => m.href).join(", ")} each refused with the card's reason`);

        // ---- return: Flow State opens the shell, and its rail leads back to the picker
        if (start.setting === "checkout" && !start.vercel) {
          await page.goto(`${server.origin}/`);
          await page.locator('[data-mode-id="flow-state"] a').click();
          await page.waitForURL(`${server.origin}/flow-state`, { timeout: 15_000 }).catch(() => {});
          const opened = await page
            .locator('[data-testid="message-input"]:visible')
            .waitFor({ state: "visible", timeout: 30_000 })
            .then(() => true, () => false);
          if (!page.url().endsWith("/flow-state") || !opened) {
            fail("return", `picking Flow State opened ${page.url()} ${opened ? "with" : "without"} the composer (want /flow-state with it)`);
          } else {
            await page.getByTestId("rail").getByRole("link", { name: "Back to the modes" }).click();
            await page.waitForURL(`${server.origin}/`, { timeout: 15_000 }).catch(() => {});
            const again = await readPicker(page).catch(() => [] as Card[]);
            if (again.length !== fixture.modes.length) {
              fail("return", `the rail's link back opened ${page.url()} with ${again.length} modes listed (want the picker, all ${fixture.modes.length})`);
            } else {
              evidence.push(`checkout: Flow State opened the shell at /flow-state; its rail led back to the picker`);
            }
          }
        }

        // ---- phone: the four stack, reasons on screen, no sideways scroll
        if (start.setting === "unset") {
          const phone = await browser.newPage({ viewport: fixture.phone });
          try {
            await phone.goto(`${server.origin}/`);
            await readPicker(phone);
            const layout = await phone.evaluate(() => ({
              scrollWidth: document.documentElement.scrollWidth,
              innerWidth: window.innerWidth,
              cards: [...document.querySelectorAll("[data-mode-id]")].map((card) => {
                const box = card.getBoundingClientRect();
                return { left: box.left, right: box.right, top: box.top, bottom: box.bottom };
              }),
              reasons: [...document.querySelectorAll('[data-testid="mode-reason"]')].map((r) => {
                const box = r.getBoundingClientRect();
                return { left: box.left, right: box.right, width: box.width };
              }),
            }));
            if (layout.scrollWidth > layout.innerWidth) {
              fail("phone", `the page scrolls sideways at ${layout.innerWidth}px (content ${layout.scrollWidth}px wide)`);
            }
            const stacked = layout.cards.every((card, i) => i === 0 || card.top >= layout.cards[i - 1]!.bottom);
            if (!stacked) fail("phone", `the four cards do not stack at ${layout.innerWidth}px: ${JSON.stringify(layout.cards)}`);
            const offscreen = layout.reasons.filter((r) => r.left < 0 || r.right > layout.innerWidth || r.width === 0);
            if (offscreen.length > 0 || layout.reasons.length !== harnessModes.length) {
              fail("phone", `${layout.reasons.length} reasons drawn, ${offscreen.length} of them off screen`);
            }
            evidence.push(`phone ${layout.innerWidth}px: ${layout.cards.length} cards stacked, content ${layout.scrollWidth}px wide`);
          } finally {
            await phone.close();
          }
        }
      } finally {
        await page.close();
        server.stop();
        server = undefined;
        // Let the port close before the next start, which refuses a busy one.
        await new Promise((resolve) => setTimeout(resolve, 1_000));
      }
    }
  } finally {
    await browser.close();
    server?.stop();
  }

  // A control must redden each leg it names, and only those.
  if (CONTROL !== "") {
    const want = EXPECTED[CONTROL]!;
    const legs = new Set(failures.map((f) => /^\[([^\]]+)\]/.exec(f)?.[1] ?? ""));
    for (const leg of want) {
      if (!legs.has(leg)) failures.push(`[control] GOAL_CONTROL=${CONTROL} left the ${leg} leg green, so that leg cannot fail`);
    }
    for (const leg of legs) {
      if (!want.includes(leg) && leg !== "control") failures.push(`[control] GOAL_CONTROL=${CONTROL} also reddened the ${leg} leg`);
    }
  }
  return { failures, evidence: evidence.join("; ") };
});
