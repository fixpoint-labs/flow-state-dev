/**
 * The rebuilt shell, against the built app: the rail browses channels and
 * seats to the depth each flow declares, the panel stands beside the stream,
 * and the three regions give way in the right order as the window narrows.
 *
 * These open the app as `devuser`, not a per-test user, because that is who
 * the boot opens the channels for: a fresh user would see no channel
 * conversations at all. Nothing here writes to a channel, so sharing the user
 * across parallel tests is safe.
 *
 * The network half of the first test is what makes it more than a picture.
 * Fetch sessions for every row up front and every DOM assertion still passes;
 * only the request count catches it.
 */
import type { Page, Request } from "@playwright/test";
import { test, expect } from "./fixtures";

const SEAT = "support.ada";

/** Session-list requests, recorded from the moment this is called. */
function sessionListRequests(page: Page): { take: () => string[] } {
  let seen: string[] = [];
  page.on("request", (request: Request) => {
    if (/\/api\/flows\/sessions\?/.test(request.url())) seen.push(request.url());
  });
  return {
    take: () => {
      const out = seen;
      seen = [];
      return out;
    },
  };
}

/** Give the seat one conversation, so it has something to open into. */
async function seedSeatSession(page: Page): Promise<string> {
  const response = await page.request.post(`/api/flows/${SEAT}/sessions`, {
    data: { userId: "devuser" },
  });
  expect(response.ok(), await response.text()).toBe(true);
  const json = (await response.json()) as { session?: { id: string }; id?: string };
  return (json.session?.id ?? json.id)!;
}

async function openShell(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.locator('[data-testid="message-input"]:visible')).toBeEnabled();
}

const rail = (page: Page) => page.getByTestId("rail");
const row = (page: Page, name: string) => rail(page).getByRole("button", { name, exact: true });

test("the rail opens a channel kind into conversations and a seat kind into seats, reading only leaves", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const seatSessionId = await seedSeatSession(page);
  const requests = sessionListRequests(page);
  await openShell(page);
  await expect(rail(page).getByRole("list", { name: "Channels" })).toBeVisible();
  await expect(rail(page).getByRole("list", { name: "Seats" })).toBeVisible();
  // Drawing the rail reads no session list of its own. The one read at load
  // is the assistant's, for the conversation the stream opens on.
  await page.waitForLoadState("networkidle");
  expect(requests.take().filter((url) => !url.includes("flowKind=chat-agent"))).toEqual([]);

  // A channel kind is a singleton: its row is the leaf, so opening it is ONE
  // read and lands straight on the channel conversations.
  await row(page, "channel").click();
  await expect(row(page, "support.desk")).toBeVisible();
  expect(requests.take()).toHaveLength(1);

  // A seat kind is a collection: opening it lists the seats and reads nothing.
  await row(page, "desk-clerk").click();
  await expect(row(page, SEAT)).toBeVisible();
  await page.waitForTimeout(300);
  expect(requests.take()).toEqual([]);

  // Opening one seat is one read, for that seat, and shows its conversation.
  await row(page, SEAT).click();
  await expect(rail(page).locator(`[data-session-id="${seatSessionId}"]`)).toBeVisible();
  const seatReads = requests.take();
  expect(seatReads).toHaveLength(1);
  expect(seatReads[0]).toContain(`flowId=${encodeURIComponent(SEAT)}`);
});

test("expanded all the way in the 256px rail, three levels still indent inside one scroll container", async ({
  page,
  consoleErrors: _consoleErrors,
}) => {
  const seatSessionId = await seedSeatSession(page);
  await openShell(page);
  await expect(row(page, "agent")).toBeVisible();

  // Expand every collapsed row until none are left: the whole tree, not a
  // tidy collapsed rail.
  const collapsed = rail(page).locator('nav[data-fsd-flow-navigator] button[aria-expanded="false"]');
  for (let pass = 0; pass < 20; pass++) {
    if ((await collapsed.count()) === 0) break;
    await collapsed.first().click();
    await page.waitForTimeout(100);
  }
  await expect(collapsed).toHaveCount(0);

  const width = await rail(page).evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBe(256);

  const scrollers = await rail(page).evaluate((el) =>
    [el, ...el.querySelectorAll("*")].filter((node) => {
      const overflow = getComputedStyle(node).overflowY;
      return overflow === "auto" || overflow === "scroll";
    }).length,
  );
  expect(scrollers).toBe(1);

  const indent = async (name: string) =>
    row(page, name).first().evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  const kind = await indent("desk-clerk");
  const instance = await indent(SEAT);
  const session = await rail(page)
    .locator(`[data-session-id="${seatSessionId}"]`)
    .evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft));
  expect(instance).toBeGreaterThan(kind);
  expect(session).toBeGreaterThan(instance);
});

for (const { width, rail: railShown, panel: panelShown } of [
  { width: 1440, rail: true, panel: true },
  { width: 900, rail: true, panel: false },
  { width: 400, rail: false, panel: false },
]) {
  test(`at ${width}px the panel yields first, the rail second, the stream never`, async ({
    page,
    consoleErrors: _consoleErrors,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await openShell(page);

    await expect(page.getByTestId("stream")).toBeVisible();
    await expect(rail(page)).toBeVisible({ visible: railShown });
    await expect(page.getByTestId("team-panel")).toBeVisible({ visible: panelShown });

    // What yielded is still one tap away, from the header.
    if (!panelShown) {
      await page.getByRole("button", { name: "Open boards and roster" }).click();
      await expect(page.getByTestId("team-panel")).toBeVisible();
      await expect(page.getByTestId("roster-panel")).toBeVisible();
      await page.getByRole("button", { name: "Close boards and roster" }).last().click();
    }
    if (!railShown) {
      await page.getByRole("button", { name: "Browse" }).click();
      await expect(rail(page)).toBeVisible();
      await expect(row(page, "channel")).toBeVisible();
    }
  });
}
