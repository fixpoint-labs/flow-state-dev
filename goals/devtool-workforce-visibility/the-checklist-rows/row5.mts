/**
 * Row 5 of the checklist: the organization's registered seats, channels and
 * memberships, read with nothing expanded from a channel's session in the
 * shipped DevTool, with the debug endpoints off. See goal.md for the contract.
 *
 * The hire is `multi-seat-collab`'s, served by its own config, which opens the
 * inventory at boot exactly as the inventory docs show an app doing it. This
 * file stands nothing up: it plants another organization's rows, serves the
 * lab, and reads the store and the screen.
 *
 * Order of evidence, and why:
 *
 *  1. Another organization's rows are planted in the lab's database before the
 *     server starts, and read back — so "absent from the page" is about rows
 *     that exist.
 *  2. The lab is served with `FSDEV_DEBUG_ENDPOINTS=0`.
 *  3. The positive record: the store holds exactly the rows the TREE implies
 *     for the lab's organization, and a second boot over the same database
 *     changes none of them. Nothing on screen is judged until this holds.
 *  4. The screen: the channel's session, then the Inventory tab, rows read by
 *     id inside the tab with nothing expanded, graded against the store.
 *  5. Each graded cell is in view on both axes.
 *  6. The network: the rows came through the production collection read, no
 *     debug read succeeded, and none was aimed at the inventory.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { CHANNEL_KIND } from "@flow-state-dev/workforce";
import { LAB_DB_PATH, LAB_ORG_ID, type LabTree } from "../../multi-seat-collab/lab/host.mts";
import { serveLab, type ServedLab } from "../../multi-seat-collab/lab/run-scenario.mts";

/** The three published key patterns, by the tab's section names. */
const PATTERNS = {
  seats: "inventory/seats/*",
  channels: "inventory/channels/*",
  memberships: "inventory/members/**",
} as const;
type Section = keyof typeof PATTERNS;
const SECTIONS = Object.keys(PATTERNS) as Section[];

/** The smallest visible area that counts as legible (row 4's bound). */
const MIN_VISIBLE_WIDTH = 40;
const MIN_VISIBLE_HEIGHT = 10;

type Row = Record<string, unknown>;
type Stored = Record<string, Row>;

/** What the leg reports back to the goal. */
export interface Row5Result {
  failures: string[];
  notes: string[];
  evidence: string;
}

/** Every inventory row stored for one organization, straight out of the store — never through a route. */
async function readStore(dbFile: string, orgId: string): Promise<Stored> {
  const stores = createSQLiteStores({ filename: dbFile });
  try {
    const rows = await stores.resourceState.getByPrefix("org", orgId, "inventory/");
    return Object.fromEntries(Object.entries(rows).map(([key, entry]) => [key, entry.state as Row]));
  } finally {
    stores.close();
  }
}

/** The rows the tree implies: every hired seat, the one channel, and one membership per declared member. */
function expectedFromTree(tree: LabTree): { keys: string[]; seatKinds: Map<string, string>; members: string[] } {
  const seatKinds = new Map(tree.roster.workers.map((worker) => [worker.id, String(worker.declared.flow)]));
  const members = (tree.channel.declared.members as string[] | undefined) ?? [];
  const keys = [
    ...[...seatKinds.keys()].map((id) => `inventory/seats/${id}`),
    `inventory/channels/${tree.channel.id}`,
    ...members.map((seat) => `inventory/members/${seat}/${tree.channel.id}`),
  ].sort();
  return { keys, seatKinds, members };
}

/**
 * Step 3's check of one boot's store against the tree. Returns the failure
 * line, or `undefined` when the store holds exactly what the tree implies.
 */
function judgeStore(tree: LabTree, stored: Stored): string | undefined {
  const expected = expectedFromTree(tree);
  const keys = Object.keys(stored).sort();
  if (keys.length === 0) {
    return "the lab's organization holds no inventory rows, so there is nothing for the screen to show (the boot did not open the inventory)";
  }
  if (JSON.stringify(keys) !== JSON.stringify(expected.keys)) {
    return `the store holds ${JSON.stringify(keys)} for the lab's organization; the tree implies ${JSON.stringify(expected.keys)}`;
  }
  for (const [id, kind] of expected.seatKinds) {
    const row = stored[`inventory/seats/${id}`]!;
    if (row.id !== id || row.kind !== kind) return `seat row ${id} holds ${JSON.stringify(row)}; the tree hired it as "${kind}"`;
  }
  const channel = stored[`inventory/channels/${tree.channel.id}`]!;
  if (JSON.stringify(channel.members) !== JSON.stringify(expected.members)) {
    return `channel row ${tree.channel.id} names members ${JSON.stringify(channel.members)}; the channel was opened with ${JSON.stringify(expected.members)}`;
  }
  if (typeof channel.openedAt !== "string") return `channel row ${tree.channel.id} carries no registration time`;
  return undefined;
}

/** Open a session from the navigator: the kind, the instance when the rail shows one, then the session. */
async function openSession(page: Page, kind: string, sessionId: string): Promise<void> {
  const kindRow = page.locator(`[data-kind="${kind}"]`);
  if ((await kindRow.getAttribute("aria-expanded")) !== "true") await kindRow.click();
  const instanceRow = page.locator(`[data-instance-id="${kind}"]`);
  if ((await instanceRow.count()) > 0 && (await instanceRow.getAttribute("aria-expanded")) !== "true") {
    await instanceRow.click();
  }
  await page.locator(`[data-session-id="${sessionId}"]`).click();
  await page.waitForFunction(
    (id) =>
      [...document.querySelectorAll("[title^='Session ID: ']")].some((el) => el.getAttribute("title")?.includes(id)),
    sessionId,
    { timeout: 15_000 },
  );
}

/** One row of a section as the tab shows it, with how much of its smallest cell can be seen. */
interface ScreenRow {
  cells: Record<string, string>;
  /** The least visible width, in px, of any cell on the row. */
  minVisibleWidth: number;
  /** The least visible height, in px, of any cell on the row. */
  minVisibleHeight: number;
  /** The shortest cell's own height, so "one line" can be capped at the cell. */
  minCellHeight: number;
}

interface ScreenRead {
  sections: Record<string, { status: string; text: string; rows: ScreenRow[] }>;
  openExpanders: number;
  html: string;
  bodyText: string;
}

/**
 * Read the Inventory tab's panel as it stands: every section's status and
 * rows, by column heading, with each cell's visible box after every clipping
 * ancestor and the window. The count of open expanders is taken in the same read.
 */
async function readTab(page: Page): Promise<ScreenRead> {
  return await page.evaluate(() => {
    const panel = document.querySelector("main [role='tabpanel'][data-state='active']");
    // No named function in here: the bundler wraps one in a helper the page does not have.
    const sections: Record<string, { status: string; text: string; rows: Array<Record<string, unknown>> }> = {};
    for (const section of panel?.querySelectorAll("[data-inventory-section]") ?? []) {
      const name = section.getAttribute("data-inventory-section") ?? "";
      const table = section.querySelector("table");
      const headers = table === null ? [] : [...table.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
      const rows = table === null ? [] : [...table.querySelectorAll("tbody tr")].map((tr) => {
        const tds = [...tr.querySelectorAll("td")];
        const boxes = tds.map((cell) => {
          const box = cell.getBoundingClientRect();
          let left = Math.max(box.left, 0);
          let right = Math.min(box.right, window.innerWidth);
          let top = Math.max(box.top, 0);
          let bottom = Math.min(box.bottom, window.innerHeight);
          for (let el = cell.parentElement; el !== null; el = el.parentElement) {
            const style = getComputedStyle(el);
            const clip = el.getBoundingClientRect();
            if (style.overflowX !== "visible") {
              left = Math.max(left, clip.left);
              right = Math.min(right, clip.right);
            }
            if (style.overflowY !== "visible") {
              top = Math.max(top, clip.top);
              bottom = Math.min(bottom, clip.bottom);
            }
          }
          const height = Math.max(0, bottom - top);
          return { width: height === 0 ? 0 : Math.max(0, right - left), height, own: box.height };
        });
        return {
          cells: Object.fromEntries(headers.map((head, i) => [head, (tds[i]?.textContent ?? "").trim()])),
          minVisibleWidth: Math.min(...boxes.map((b) => b.width)),
          minVisibleHeight: Math.min(...boxes.map((b) => b.height)),
          minCellHeight: Math.min(...boxes.map((b) => b.own)),
        };
      });
      sections[name] = {
        status: section.getAttribute("data-inventory-status") ?? "",
        text: (section.textContent ?? "").trim(),
        rows,
      };
    }
    return {
      sections,
      openExpanders: panel?.querySelectorAll("details[open]").length ?? -1,
      html: document.documentElement.outerHTML,
      bodyText: document.body.innerText,
    };
  }) as unknown as ScreenRead;
}

/** Run the row-5 leg on its own serve of the lab. */
export async function gradeRow5(options: {
  browser: Browser;
  tree: LabTree;
  control: string;
  workDir: string;
  shots: string;
}): Promise<Row5Result> {
  const { tree } = options;
  const failures: string[] = [];
  const notes: string[] = [];
  const fail = (step: string, line: string) => failures.push(`[row 5] ${step}: ${line}`);

  // ---- step 1: another organization's rows, before the server starts ------
  mkdirSync(join(options.workDir, ".fsdev", "data"), { recursive: true });
  const dbFile = join(options.workDir, LAB_DB_PATH);
  const foreign = {
    org: `org-foreign-${randomUUID().slice(0, 8)}`,
    seat: `foreign-${randomUUID().slice(0, 8)}.seat`,
    channel: `foreign-${randomUUID().slice(0, 8)}.room`,
  };
  const treeIds = [...tree.roster.workers.map((w) => w.id), tree.channel.id];
  if (treeIds.some((id) => id === foreign.seat || id === foreign.channel)) {
    throw new Error("a planted foreign id collides with the tree");
  }
  {
    const stores = createSQLiteStores({ filename: dbFile });
    try {
      await stores.resourceState.set("org", foreign.org, `inventory/seats/${foreign.seat}`, { id: foreign.seat, kind: "worker" }, "any");
      await stores.resourceState.set(
        "org",
        foreign.org,
        `inventory/channels/${foreign.channel}`,
        { id: foreign.channel, kind: "channel", members: [foreign.seat], openedAt: new Date().toISOString() },
        "any",
      );
    } finally {
      stores.close();
    }
  }
  const planted = Object.keys(await readStore(dbFile, foreign.org)).sort();
  if (JSON.stringify(planted) !== JSON.stringify([`inventory/channels/${foreign.channel}`, `inventory/seats/${foreign.seat}`])) {
    throw new Error(`the foreign rows did not store: ${JSON.stringify(planted)}`);
  }

  // ---- step 2: serve, debug off ---------------------------------------------
  let served: ServedLab = await serveLab({ control: options.control, workDir: options.workDir, debugEndpoints: false });
  try {
    // ---- step 3: the positive record, then a second boot ------------------
    const first = await readStore(dbFile, LAB_ORG_ID);
    const firstProblem = judgeStore(tree, first);
    if (firstProblem !== undefined) {
      fail("step 3", firstProblem);
      return { failures, notes, evidence: "" };
    }

    // BR-19: the seat writer is not an HTTP door. The refusal must be the
    // server saying the public map has no such action — not any error — and
    // the store must not move.
    const fabricated = await fetch(
      `${served.origin}/api/flows/${CHANNEL_KIND}/inventory-binder/actions/registerSeatsInInventory`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u_multi_seat_collab", input: { seats: [{ id: "fabricated.seat", kind: "worker" }] } }),
      },
    );
    const refusal = await fabricated.text();
    await new Promise((r) => setTimeout(r, 500));
    const afterFabricated = await readStore(dbFile, LAB_ORG_ID);
    const landed = "inventory/seats/fabricated.seat" in afterFabricated;
    if (fabricated.status < 400 || !refusal.includes('does not define action \\"registerSeatsInInventory\\"') || landed) {
      fail(
        "step 3",
        `the internal seat writer, asked over HTTP, answered ${fabricated.status} ${refusal.slice(0, 200)}, ` +
          `and the store ${landed ? "gained" : "did not gain"} a fabricated seat row`,
      );
    } else {
      notes.push(`row 5: the internal seat writer is not an HTTP action (${fabricated.status}: ${refusal}) and the store did not move`);
    }

    served.stop();
    await served.exited();
    served = await serveLab({ control: options.control, workDir: options.workDir, debugEndpoints: false });
    const second = await readStore(dbFile, LAB_ORG_ID);
    const moved = [...new Set([...Object.keys(first), ...Object.keys(second)])]
      .sort()
      .filter((key) => JSON.stringify(first[key]) !== JSON.stringify(second[key]))
      .map((key) => `${key}: ${JSON.stringify(first[key])} -> ${JSON.stringify(second[key])}`);
    if (moved.length > 0) {
      fail("step 3", `a second boot over the same database changed the inventory: ${moved.join("; ")}`);
      return { failures, notes, evidence: "" };
    }
    const stored = second;
    const under = (prefix: string) =>
      Object.entries(stored)
        .filter(([key]) => key.startsWith(prefix))
        .map(([, row]) => row);
    const storedSeats = under("inventory/seats/");
    const storedChannels = under("inventory/channels/");
    const storedMemberships = under("inventory/members/");

    // The refs, off the channel session's manifest — never hard-coded.
    const manifest = (await (await fetch(`${served.origin}/api/flows/sessions/${encodeURIComponent(tree.channel.id)}/manifest`)).json()) as {
      resources: Array<{ ref: string; pattern?: string }>;
    };
    const refs = Object.fromEntries(
      SECTIONS.map((name) => [name, manifest.resources.find((entry) => entry.pattern === PATTERNS[name])?.ref]),
    ) as Record<Section, string | undefined>;

    // ---- step 4: the screen ----------------------------------------------
    const page = await options.browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const network: Array<{ method: string; url: string; status: number }> = [];
    page.on("response", (response) =>
      network.push({ method: response.request().method(), url: response.url(), status: response.status() }),
    );
    try {
      await page.goto(served.origin, { waitUntil: "networkidle" });
      await openSession(page, CHANNEL_KIND, tree.channel.id);
      const tab = page.getByRole("tab", { name: "Inventory" });
      try {
        await tab.waitFor({ timeout: 10_000 });
      } catch {
        fail("step 4", `the channel's session ${tree.channel.id} shows no Inventory tab (tabs: ${(await page.getByRole("tab").allTextContents()).join(", ")})`);
      }
      let screen: ScreenRead | undefined;
      if ((await tab.count()) > 0) {
        await tab.click();
        await page.waitForFunction(
          () => document.querySelector("[role='tab'][aria-selected='true']")?.textContent?.trim() === "Inventory",
          undefined,
          { timeout: 10_000 },
        );
        await page.waitForFunction(() => document.querySelectorAll("main [role='tabpanel'][data-state='active'] [data-inventory-section]").length === 3, undefined, { timeout: 15_000 });
        screen = await readTab(page);
        await page.screenshot({ path: join(options.shots, "row5-inventory.png") });
      }

      if (screen !== undefined) {
        if (screen.openExpanders !== 0) fail("step 4", `${screen.openExpanders} expander(s) were open when the tab was read`);
        const seats = screen.sections.seats;
        const channels = screen.sections.channels;
        const memberships = screen.sections.memberships;
        for (const [name, section] of Object.entries({ seats, channels, memberships })) {
          if (section?.status !== "loaded") {
            fail("step 4", `the ${name} section reads "${section?.status ?? "missing"}", not loaded: ${JSON.stringify(section?.text ?? "")}`);
          }
        }
        const rowById = (section: ScreenRead["sections"][string] | undefined, key: string, id: string) =>
          section?.rows.find((row) => row.cells[key] === id);

        // Seats: each with its kind and the channels its membership rows name.
        if (seats?.status === "loaded") {
          if (seats.rows.length !== storedSeats.length) {
            fail("step 4", `the tab lists ${seats.rows.length} seat(s); the store holds ${storedSeats.length}`);
          }
          for (const seat of storedSeats) {
            const row = rowById(seats, "Id", String(seat.id));
            const channelsOfSeat = storedMemberships.filter((m) => m.seatId === seat.id).map((m) => String(m.channelId));
            const wantChannels = channelsOfSeat.length === 0 ? "none" : channelsOfSeat.join(", ");
            if (row === undefined) fail("step 4", `seat ${seat.id} has no row in the tab`);
            else if (row.cells.Kind !== seat.kind) fail("step 4", `seat ${seat.id}'s Kind cell reads ${JSON.stringify(row.cells.Kind)}; the store holds "${seat.kind}"`);
            else if (row.cells.Channels !== wantChannels) fail("step 4", `seat ${seat.id}'s Channels cell reads ${JSON.stringify(row.cells.Channels)}; its membership rows name "${wantChannels}"`);
          }
        }
        // Channels: each with its kind, its members and its registration time.
        if (channels?.status === "loaded") {
          if (channels.rows.length !== storedChannels.length) {
            fail("step 4", `the tab lists ${channels.rows.length} channel(s); the store holds ${storedChannels.length}`);
          }
          for (const channel of storedChannels) {
            const row = rowById(channels, "Id", String(channel.id));
            const members = (channel.members as string[]).join(", ");
            if (row === undefined) fail("step 4", `channel ${channel.id} has no row in the tab`);
            else if (row.cells.Members !== members) fail("step 4", `channel ${channel.id}'s Members cell reads ${JSON.stringify(row.cells.Members)}; the store holds "${members}"`);
            else if (row.cells.Kind !== channel.kind) fail("step 4", `channel ${channel.id}'s Kind cell reads ${JSON.stringify(row.cells.Kind)}; the store holds "${channel.kind}"`);
            else if (row.cells.Registered !== channel.openedAt) fail("step 4", `channel ${channel.id}'s Registered cell reads ${JSON.stringify(row.cells.Registered)}; the store holds "${channel.openedAt}"`);
          }
        }
        if (memberships?.status === "loaded" && memberships.rows.length !== storedMemberships.length) {
          fail("step 4", `the tab lists ${memberships.rows.length} membership(s); the store holds ${storedMemberships.length}`);
        }
        // Another organization's rows, planted and stored, appear nowhere.
        for (const id of [foreign.seat, foreign.channel, foreign.org]) {
          if (screen.html.includes(id)) fail("step 4", `another organization's "${id}" is on the page`);
        }

        // ---- step 5: every graded cell is in view on both axes -----------
        for (const [name, section] of Object.entries({ seats, channels, memberships })) {
          for (const row of section?.rows ?? []) {
            const id = Object.values(row.cells)[0];
            if (row.minVisibleHeight < Math.min(MIN_VISIBLE_HEIGHT, row.minCellHeight)) {
              fail("step 5", `the ${name} row ${id} is out of view vertically: ${Math.round(row.minVisibleHeight)}px of a ${Math.round(row.minCellHeight)}px cell can be seen`);
            } else if (row.minVisibleWidth < MIN_VISIBLE_WIDTH) {
              fail("step 5", `the ${name} row ${id} has a cell only ${Math.round(row.minVisibleWidth)}px wide in view`);
            }
          }
        }
      }

      // ---- step 6: the production read, and not the debug one ------------
      const inventoryReads = network.filter((entry) => {
        const path = new URL(entry.url).pathname;
        return path.startsWith(`/api/flows/sessions/${encodeURIComponent(tree.channel.id)}/resources/`);
      });
      for (const name of SECTIONS) {
        if (screen?.sections[name]?.status !== "loaded" && screen !== undefined) continue;
        const ref = refs[name];
        const ok = inventoryReads.some(
          (entry) => entry.method === "GET" && entry.status === 200 && new URL(entry.url).pathname.endsWith(`/resources/${encodeURIComponent(ref ?? "")}`),
        );
        if (!ok) fail("step 6", `no 200 on the production collection read for the ${name} collection (ref ${ref ?? "absent from the manifest"})`);
      }
      const debug = network.filter((entry) => new URL(entry.url).pathname.includes("/debug/"));
      const debugServed = debug.filter((entry) => entry.status < 400);
      if (debugServed.length > 0) {
        fail("step 6", `a debug read was served with the debug endpoints off: ${debugServed.map((e) => `${e.status} ${e.url}`).join(", ")}`);
      }
      const debugAimedAtInventory = debug.filter((entry) =>
        [...Object.values(refs), "inventory"].some((ref) => ref !== undefined && entry.url.includes(encodeURIComponent(ref))),
      );
      if (debugAimedAtInventory.length > 0) {
        fail("step 6", `the page asked the debug endpoint for the inventory: ${debugAimedAtInventory.map((e) => `${e.status} ${e.url}`).join(", ")}`);
      }
      const debugDisabled = (await page.locator("text=Debug endpoints disabled").count()) > 0;
      if (!debugDisabled) fail("step 6", "the debug Resources surface does not report the debug endpoints disabled");
      notes.push(
        `row 5 network: ${debug.length} debug request(s), every one refused (${[...new Set(debug.map((e) => `${e.status} ${new URL(e.url).pathname.replace(/\/sessions\/[^/]+/, "/sessions/…")}`))].join("; ")})`,
      );

      if (failures.length === 0 && screen !== undefined) {
        return {
          failures,
          notes,
          evidence:
            `row 5 read on the multi-seat-collab hire with the debug endpoints off: the channel's session ${tree.channel.id}, ` +
            `opened from the navigator, showed ${screen.sections.seats!.rows.length} registered seat(s) ` +
            `(${screen.sections.seats!.rows.map((r) => `${r.cells.Id} ${r.cells.Kind} in ${r.cells.Channels}`).join("; ")}), ` +
            `the channel ${tree.channel.id} with members ${screen.sections.channels!.rows[0]?.cells.Members}, and ` +
            `${screen.sections.memberships!.rows.length} membership(s), exactly as the store holds them, nothing expanded; ` +
            `another organization's rows were stored and appeared nowhere; a second boot changed nothing`,
        };
      }
      return { failures, notes, evidence: "" };
    } finally {
      await page.close();
    }
  } finally {
    served.stop();
    await served.exited();
  }
}
