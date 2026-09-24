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
 *
 * The rail's layout is measured on the rendered page, in both hosts that draw
 * it: where each label's first glyph lands, where each action is drawn and
 * when it shows. Its padding values can all differ while the text still lands
 * in the wrong column, so nothing here reads a style value to decide layout.
 */
import type { Browser, Locator, Page, Request } from "@playwright/test";
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
async function seedSeatSession(page: Page, title?: string): Promise<string> {
  const response = await page.request.post(`/api/flows/${SEAT}/sessions`, {
    data: { userId: "devuser", ...(title === undefined ? {} : { title }) },
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

/** The assistant's kind: its row is the leaf that carries "New session". */
const SHELL_KIND = "chat-agent";
/** A seat name that runs past any rail. */
const LONG_SEAT = "support.escalations-overnight-weekend-queue";
/** A conversation title that runs past any rail. */
const LONG_TITLE = "Refund escalation for order 4417 and both of its linked chargebacks";

/**
 * Serve this page the real flow list plus one desk-clerk seat whose name is
 * too long for the rail. The roster is the app's workforce tree, which has no
 * name this long, and hiring one would leave it in every other scenario's
 * rail. Its session read goes to the real server, which has none for it.
 */
async function withLongSeat(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname === "/api/flows",
    async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const response = await route.fetch();
      const body = (await response.json()) as { flows: Record<string, unknown>[] };
      body.flows.push({
        id: LONG_SEAT,
        kind: "desk-clerk",
        cardinality: "collection",
        requireUser: true,
        actions: ["run"],
      });
      await route.fulfill({ response, json: body });
    },
  );
}

/** Open every collapsed row until none is left, and let every open leaf finish its read. */
async function expandAll(page: Page, nav: Locator): Promise<void> {
  const collapsed = nav.locator('button[aria-expanded="false"]');
  for (let pass = 0; pass < 40; pass++) {
    if ((await collapsed.count()) === 0) break;
    await collapsed.first().click();
    await page.waitForTimeout(100);
  }
  await expect(collapsed).toHaveCount(0);
  await expect(nav.getByText("Loading sessions…")).toHaveCount(0);
}

/** Nothing hovered, nothing focused. */
async function rest(page: Page): Promise<void> {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const size = page.viewportSize()!;
  await page.mouse.move(size.width - 2, size.height - 2);
  await page.waitForTimeout(50);
}

const ROW_BUTTON = "button[data-kind], button[data-instance-id], button[data-session-id]";

/**
 * Tag every host action in the rail: anything interactive that is not a row's
 * own button or the component's Retry. Returns how many there are.
 */
const markActions = (nav: Locator) =>
  nav.evaluate((root, rowButton) => {
    const actions = [...root.querySelectorAll("button, a[href]")].filter(
      (el) => !el.matches(rowButton) && el.textContent?.trim() !== "Retry",
    );
    actions.forEach((el, i) => el.setAttribute("data-vg-action", String(i)));
    return actions.length;
  }, ROW_BUTTON);

type ActionState = {
  id: string;
  /** A selector for the row button this action sits beside, or null when it sits on no row. */
  row: string | null;
  rowSelected: boolean;
  onRow: boolean;
  /** Opacity as drawn: the product of its own and every ancestor's, up to the rail. */
  opacity: number;
  focusable: boolean;
  inkW: number;
  inkH: number;
  hitW: number;
  hitH: number;
};

/** Where each host action sits, how it is drawn, and whether it shows. */
const readActions = (nav: Locator): Promise<ActionState[]> =>
  nav.evaluate((root) => {
    const own = ":scope > button[data-kind], :scope > button[data-instance-id], :scope > button[data-session-id]";
    // A row's frame is the element whose own child is the row's button.
    const frameOf = (el: Element): Element | null => {
      for (let n = el.parentElement; n !== null && n !== root; n = n.parentElement) {
        if (n.querySelector(own) !== null) return n;
      }
      return null;
    };
    const drawnOpacity = (el: Element): number => {
      let o = 1;
      for (let n: Element | null = el; n !== null && n !== root; n = n.parentElement) {
        o *= Number(getComputedStyle(n).opacity);
      }
      return o;
    };
    const selectorOf = (b: HTMLElement): string =>
      b.dataset.sessionId !== undefined
        ? `[data-session-id="${CSS.escape(b.dataset.sessionId)}"]`
        : b.dataset.instanceId !== undefined
          ? `[data-instance-id="${CSS.escape(b.dataset.instanceId)}"]`
          : `[data-kind="${CSS.escape(b.dataset.kind!)}"]`;

    return [...root.querySelectorAll<HTMLElement>("[data-vg-action]")].map((a) => {
      const frame = frameOf(a);
      const rowButton = frame?.querySelector<HTMLElement>(own) ?? null;
      const r = a.getBoundingClientRect();
      const f = frame?.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      // The drawing, not its box: every box can match while one glyph fills
      // more of it than another.
      const svg = a.querySelector("svg");
      let inkW = Number.NaN;
      let inkH = Number.NaN;
      if (svg !== null) {
        const box = svg.getBoundingClientRect();
        const ink = svg.getBBox();
        const unit = box.width / (svg.viewBox.baseVal?.width || box.width);
        inkW = ink.width * unit;
        inkH = ink.height * unit;
      }
      return {
        id: a.dataset.vgAction!,
        row: rowButton === null ? null : selectorOf(rowButton),
        rowSelected: rowButton?.getAttribute("aria-current") === "true",
        onRow: f !== undefined && cx >= f.left && cx <= f.right && cy >= f.top && cy <= f.bottom,
        opacity: drawnOpacity(a),
        focusable:
          a.tabIndex >= 0 &&
          !(a as HTMLButtonElement).disabled &&
          getComputedStyle(a).visibility !== "hidden" &&
          a.closest("[inert]") === null,
        inkW,
        inkH,
        hitW: r.width,
        hitH: r.height,
      };
    });
  });

/** Where every label, note and tree line lands, and whether the long rows fit. */
const measureRows = (nav: Locator) =>
  nav.evaluate(
    (root, long) => {
      // The first glyph a person sees, through a text range. Padding values
      // can differ while the text still lands in the wrong place.
      const textLeft = (el: Element): number | null => {
        const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
          if ((node.textContent ?? "").trim().length === 0) continue;
          if (node.parentElement?.closest('[aria-hidden="true"]')) continue;
          const range = document.createRange();
          range.selectNodeContents(node);
          return range.getBoundingClientRect().left;
        }
        return null;
      };
      const labelOf = (b: Element) => (b.textContent ?? "").replace(/[▾▸]/g, "").trim();
      // Sessions stand at the level a collection's copies would when their
      // leaf is a singleton's kind row, and one deeper under a copy.
      const sessionLevel = (leaf: Element) =>
        leaf.parentElement?.querySelector(":scope > div > button[data-kind]") ? 2 : 3;

      const rows = [...root.querySelectorAll<HTMLElement>("button[data-kind], button[data-instance-id], button[data-session-id]")]
        // A dispatch run sits one step in under the session that started it, by design.
        .filter((b) => !b.hasAttribute("data-dispatch-run-of"))
        .map((b) => ({
          label: labelOf(b),
          level:
            b.dataset.kind !== undefined ? 1 : b.dataset.instanceId !== undefined ? 2 : sessionLevel(b.closest("ul[data-leaf]")!),
          x: textLeft(b),
        }));

      const notes = [...root.querySelectorAll("ul[data-leaf] > li > p, ul[data-leaf] > li > [role='alert']")].map((n) => ({
        text: (n.textContent ?? "").trim(),
        level: sessionLevel(n.closest("ul[data-leaf]")!),
        x: textLeft(n),
      }));

      const guides = [...root.querySelectorAll<HTMLElement>('button[aria-expanded="true"]')].flatMap((b) => {
        const list = b.closest("li")?.querySelector(":scope > ul");
        if (!list) return [];
        const children = [...list.children];
        const marks = children.filter((c) => c.getAttribute("aria-hidden") === "true");
        const lines = children.filter((c) => c.getAttribute("aria-hidden") !== "true");
        const twisty = b.querySelector('[aria-hidden="true"]')!.getBoundingClientRect();
        const g = marks[0]?.getBoundingClientRect();
        return [
          {
            parent: labelOf(b),
            count: marks.length,
            twistyX: twisty.left + twisty.width / 2,
            x: g === undefined ? null : g.left + g.width / 2,
            top: g?.top ?? null,
            bottom: g?.bottom ?? null,
            firstTop: lines[0]?.getBoundingClientRect().top ?? null,
            lastBottom: lines.at(-1)?.firstElementChild?.getBoundingClientRect().bottom ?? null,
            listBottom: list.getBoundingClientRect().bottom,
          },
        ];
      });

      const railRect = root.getBoundingClientRect();
      const fit = [...root.querySelectorAll<HTMLElement>("button[data-instance-id], button[data-session-id]")]
        .filter((b) => long.some((text) => (b.textContent ?? "").includes(text)))
        .map((b) => {
          const frame = b.parentElement!;
          const frameRect = frame.getBoundingClientRect();
          const text = [...b.children].filter((c) => c.getAttribute("aria-hidden") !== "true").at(-1)!;
          const trailing = b.nextElementSibling?.getBoundingClientRect() ?? null;
          return {
            label: labelOf(b),
            ellipsized: text.scrollWidth > text.clientWidth + 1 && getComputedStyle(text).textOverflow === "ellipsis",
            overflows:
              frame.scrollWidth > frame.clientWidth + 1 ||
              frameRect.right > railRect.right + 0.5 ||
              (trailing !== null && trailing.right > frameRect.right + 0.5) ||
              b.getBoundingClientRect().right > (trailing?.left ?? frameRect.right) + 0.5,
          };
        });

      return {
        rows,
        notes,
        guides,
        fit,
        railOverflows: root.scrollWidth > root.clientWidth + 1,
        scrollers: [root, ...root.querySelectorAll("*")].filter((n) => {
          const overflow = getComputedStyle(n).overflowY;
          return overflow === "auto" || overflow === "scroll";
        }).length,
      };
    },
    [LONG_SEAT, LONG_TITLE],
  );

const spread = (xs: number[]) => (xs.length === 0 ? 0 : Math.max(...xs) - Math.min(...xs));
const shown = (a: ActionState) => a.opacity >= 0.99;
const hidden = (a: ActionState) => a.opacity <= 0.01;

/**
 * The rail's layout goal (G1–G8), measured on the rendered page: where text
 * lands, where each action is drawn and when it shows. Style values can agree
 * with each other while the labels land in the wrong place, so nothing here
 * reads a padding.
 */
async function checkRail(
  page: Page,
  nav: Locator,
  name: string,
  shot: { hoverRow: string; quietRow: string; container: Locator; file: string },
): Promise<void> {
  // Each measurement is kept on the run's report, passing or not, so a green
  // run still shows the numbers it passed on.
  const soft = (ok: boolean, what: string, detail: string) => {
    test.info().annotations.push({ type: ok ? "pass" : "fail", description: `${name} · ${what} — ${detail}` });
    expect.soft(ok, `${name} · ${what} — ${detail}`).toBe(true);
  };

  await markActions(nav);
  await rest(page);
  const atRest = await readActions(nav);
  expect(atRest.length, `${name} has host actions to measure`).toBeGreaterThan(0);

  // Each action measured with its own row pointed at: what a person sees.
  const revealed = new Map<string, number>();
  for (const action of atRest) {
    await (action.row === null ? nav.locator(`[data-vg-action="${action.id}"]`) : nav.locator(action.row)).hover();
    revealed.set(action.id, (await readActions(nav)).find((a) => a.id === action.id)!.opacity);
  }
  const allRevealed = [...revealed.values()].every((o) => o >= 0.99);

  const offRow = atRest.filter((a) => !a.onRow);
  soft(
    offRow.length === 0 && allRevealed,
    "G1 every host action sits on the row it acts on",
    `${offRow.length} of ${atRest.length} off-row; all shown when their row is pointed at: ${allRevealed}`,
  );

  const m = await measureRows(nav);
  const levels = [...new Set(m.rows.map((r) => r.level))].sort();
  const columns = levels.map((level) => {
    const xs = m.rows.filter((r) => r.level === level).map((r) => r.x!);
    return { level, x: Math.min(...xs), spread: spread(xs) };
  });
  soft(
    columns.every((c) => c.spread <= 0.5),
    "G2 every label at one level starts at one x",
    columns.map((c) => `L${c.level} ${c.x.toFixed(1)} spread ${c.spread.toFixed(1)}px`).join(", "),
  );

  const steps = columns.slice(1).map((c, i) => c.x - columns[i]!.x);
  soft(
    steps.length > 0 && steps.every((s) => s >= 12 && Math.abs(s - steps[0]!) <= 0.5),
    "G3 each level steps right by one equal amount, at least 12px",
    `steps ${steps.map((s) => s.toFixed(1)).join(", ")}px`,
  );

  const column = (level: number) => columns.find((c) => c.level === level)?.x ?? Number.NaN;
  soft(
    m.notes.length > 0 && m.notes.every((n) => Math.abs(n.x! - column(n.level)) <= 0.5),
    "G4 each note starts on its level's column",
    m.notes.map((n) => `"${n.text}" ${n.x?.toFixed(1)} vs L${n.level} ${column(n.level).toFixed(1)}`).join("; ") || "no notes",
  );

  const ink = (key: "inkW" | "inkH" | "hitW" | "hitH") => spread(atRest.map((a) => a[key]));
  soft(
    [ink("inkW"), ink("inkH"), ink("hitW"), ink("hitH")].every((s) => s <= 0.5) && allRevealed,
    "G5 every row action's drawn glyph and hit area are one size",
    `glyph spread ${ink("inkW").toFixed(1)}×${ink("inkH").toFixed(1)}px, hit spread ${ink("hitW").toFixed(1)}×${ink("hitH").toFixed(1)}px over ${atRest.length} actions`,
  );

  const badGuides = m.guides.filter(
    (g) =>
      g.count !== 1 ||
      Math.abs(g.x! - g.twistyX) > 0.5 ||
      g.top! > g.firstTop! + 0.5 ||
      g.bottom! < g.lastBottom! - 0.5 ||
      g.bottom! > g.listBottom + 0.5,
  );
  soft(
    m.guides.length > 0 && badGuides.length === 0,
    "G6 each open parent has one hidden tree line on its twisty's centre, spanning its children",
    `${m.guides.length - badGuides.length} of ${m.guides.length} open parents${badGuides.length ? `; wrong: ${badGuides.map((g) => `${g.parent} (${g.count} lines)`).join(", ")}` : ""}`,
  );

  // G7, with each long row pointed at so its actions are measured shown.
  const railWidth = await nav.evaluate((el) => el.getBoundingClientRect().width);
  await nav.locator(`[data-instance-id="${LONG_SEAT}"]`).hover();
  const fitSeat = (await measureRows(nav)).fit;
  const titled = nav.locator("button[data-session-id]").filter({ hasText: LONG_TITLE });
  await titled.first().hover();
  const fitTitle = (await measureRows(nav)).fit;
  const fit = [
    ...fitSeat.filter((f) => f.label.includes(LONG_SEAT)),
    ...fitTitle.filter((f) => f.label.includes(LONG_TITLE)),
  ];
  soft(
    fitSeat.some((f) => f.label.includes(LONG_SEAT)) &&
      fitTitle.some((f) => f.label.includes(LONG_TITLE)) &&
      fit.every((f) => f.ellipsized && !f.overflows) && !m.railOverflows && ink("hitW") <= 0.5 && ink("hitH") <= 0.5,
    `G7 at ${railWidth}px the long labels ellipsize, actions keep their box, nothing overflows`,
    `${fit.filter((f) => f.ellipsized).length} of ${fit.length} long labels ellipsized, ${fit.filter((f) => f.overflows).length} overflow, rail overflows: ${m.railOverflows}`,
  );

  // G8 · hidden at rest yet reachable; Tab and hover show only their own row.
  await rest(page);
  const still = await readActions(nav);
  const quiet = still.filter((a) => !a.rowSelected);
  const tabRow = quiet.find((a) => a.row !== null)?.row ?? null;
  let tabbedTo: string | null = null;
  let tabShows = false;
  if (tabRow !== null) {
    await nav.locator(tabRow).focus();
    await page.keyboard.press("Tab");
    tabbedTo = await page.evaluate(() => document.activeElement?.getAttribute("data-vg-action") ?? null);
    const after = await readActions(nav);
    const mine = after.filter((a) => a.row === tabRow);
    tabShows = tabbedTo === mine[0]?.id && mine.every(shown);
  }
  await rest(page);
  const hoverRow = [...quiet].reverse().find((a) => a.row !== null)?.row ?? null;
  let hoverShowsOnlyIt = false;
  if (hoverRow !== null) {
    await nav.locator(hoverRow).hover();
    hoverShowsOnlyIt = (await readActions(nav)).every((a) =>
      a.row === hoverRow ? shown(a) : a.rowSelected || hidden(a),
    );
  }
  await rest(page);
  await nav.locator(shot.quietRow).hover();
  const plainQuiet = (await readActions(nav)).filter((a) => !a.rowSelected).every(hidden);
  soft(
    quiet.length > 0 && quiet.every(hidden) && still.every((a) => a.focusable) && tabShows && hoverShowsOnlyIt && plainQuiet,
    "G8 actions are invisible at rest yet reachable; Tab and hover show their own row's only",
    `hidden at rest ${quiet.filter(hidden).length} of ${quiet.length}, reachable ${still.filter((a) => a.focusable).length} of ${still.length}; Tab from ${tabRow} lands on ${tabbedTo} and shows it: ${tabShows}; hovering ${hoverRow} shows only it: ${hoverShowsOnlyIt}; a row without actions shows none: ${plainQuiet}`,
  );

  // One row pointed at, the rest quiet, for a person to look at.
  await rest(page);
  await nav.locator(shot.hoverRow).hover();
  await page.waitForTimeout(100);
  const path = test.info().outputPath(shot.file);
  await shot.container.screenshot({ path });
  await test.info().attach(shot.file, { path, contentType: "image/png" });
}

/** G8's last clause: a screen with no hover pointer shows every row's actions. */
async function checkTouch(
  browser: Browser,
  open: (page: Page) => Promise<Locator>,
  name: string,
): Promise<void> {
  const context = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    viewport: { width: 1280, height: 800 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  const nav = await open(page);
  await expandAll(page, nav);
  await markActions(nav);
  await rest(page);
  const noHover = await page.evaluate(() => matchMedia("(hover: none)").matches);
  const actions = await readActions(nav);
  const ok = noHover && actions.length > 0 && actions.every(shown);
  const line = `${name} · G8 a screen with no hover pointer shows every action — (hover: none) ${noHover}, shown ${actions.filter(shown).length} of ${actions.length}`;
  test.info().annotations.push({ type: ok ? "pass" : "fail", description: line });
  expect.soft(ok, line).toBe(true);
  await context.close();
}

test("the rail, fully expanded in both hosts, draws each action on its row, one column per level, tree lines, and shows actions on hover or focus", async ({
  page,
  browser,
  consoleErrors: _consoleErrors,
}) => {
  test.setTimeout(180_000);
  // A seat with a conversation that has no title, one with a title too long
  // for the rail, a seat with none, and the singleton channels the boot opens.
  await seedSeatSession(page);
  await seedSeatSession(page, LONG_TITLE);

  // Kitchen-sink's own rail, at its 256px.
  const openShellRail = async (p: Page) => {
    await withLongSeat(p);
    await p.goto("/");
    await expect(p.locator('[data-testid="message-input"]:visible')).toBeEnabled();
    return rail(p).locator("nav[data-fsd-flow-navigator]");
  };
  const shellNav = await openShellRail(page);
  await expandAll(page, shellNav);
  expect(await rail(page).evaluate((el) => el.getBoundingClientRect().width)).toBe(256);
  // Every level indents inside ONE scroll container: nested scrollbars in 256px are the failure.
  expect((await measureRows(shellNav)).scrollers).toBe(1);
  await checkRail(page, shellNav, "/", {
    hoverRow: `[data-kind="${SHELL_KIND}"]`,
    quietRow: '[data-kind="channel"]',
    container: rail(page),
    file: "rail-kitchen-sink.png",
  });
  await checkTouch(browser, openShellRail, "/");

  // The developer tool's rail, narrowed to the same 256px.
  const openToolRail = async (p: Page) => {
    await withLongSeat(p);
    await p.goto("/devtool");
    const nav = p.getByTestId("devtool-panel").locator("nav[data-fsd-flow-navigator]");
    await expect(nav.locator(`[data-kind="desk-clerk"]`)).toBeVisible();
    return nav;
  };
  const toolNav = await openToolRail(page);
  await expandAll(page, toolNav);
  const aside = page.getByTestId("devtool-panel").locator("aside").first();
  const handle = (await aside.locator("+ [role='separator']").boundingBox())!;
  const asideWidth = (await aside.boundingBox())!.width;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
  await page.mouse.down();
  await page.mouse.move(handle.x + handle.width / 2 - (asideWidth - 256), handle.y + handle.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await aside.boundingBox())!.width).toBe(256);
  await checkRail(page, toolNav, "/devtool", {
    hoverRow: `[data-instance-id="${SEAT}"]`,
    quietRow: '[data-kind="agent"]',
    container: aside,
    file: "rail-devtool.png",
  });
  await checkTouch(browser, openToolRail, "/devtool");
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
