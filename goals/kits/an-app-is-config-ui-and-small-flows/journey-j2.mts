/**
 * Journey j2, a team that shows user- or org-level data: Shift Manager over
 * DevTeam, in a browser, opens Projects, Usage and Schedules in turn.
 *
 * - `j2:renders`: each surface draws its title (Schedules is titled *Routines* now), with no
 *   failure on it and no page error.
 * - `j2:no-read-session`: every session made while the page read has a request, a task or a run.
 * - `j2:read-writes-nothing`: opening Schedules adds 0 requests. Opening Usage adds only its
 *   Re-check, one request on the usage collection's write flow (FIX-2624 kept it: a view writes
 *   nothing, and opening Usage asks for a fresh reading); anything else fails.
 * - `j2:identity`: the projects drawn are the ones the store holds under the identity read's org.
 *
 * DevTeam serves one organization, so "one user in two orgs" can't be set up without a host
 * option it doesn't have; the goal says so rather than faking a second org.
 */
import { join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { goalTmpDir, REPO_ROOT, sleep, type Tell } from "../../lib/index.mts";
import { launchChromium } from "../../lib/playwright.mts";
import { buildShiftManagerCopy, buildShiftManagerPages, openShiftManager, personPage, startShiftManager, type Patch } from "../../lib/shift-manager.mts";
import { storeAt } from "./store.mts";

const DEVTEAM = join(REPO_ROOT, "packages/shift-manager/teams/devteam/fsdev.config.mts");
const ROSTER_FLOW = "workforce-roster";
/** The surfaces the journey opens, by the address Shift Manager routes. */
const SURFACES = [
  { name: "Projects", path: "/p/storefront", title: "Storefront" },
  { name: "Usage", path: "/usage", title: "Usage" },
  { name: "Schedules", path: "/routines", title: "Routines" },
] as const;

/** The control: Schedules sends a write each time it reads, as a reader session's action did. */
const PLANTS: Record<string, Patch[]> = {
  "schedules-write": [
    {
      file: "src/lib/routines.ts",
      from: "    client\n      .view(routinesView, {})",
      to: '    void client.resource({ scope: "user", pattern: SCHEDULES_PATTERN }).send(ROUTINE_VERBS.pause, { id: "closure-control", paused: false }).catch(() => undefined);\n    client\n      .view(routinesView, {})',
      why: "Schedules writes on each read",
    },
  ],
};

export async function journeyTwo(control: string, failures: string[], notes: string[], tell: Tell): Promise<void> {
  const scratch = goalTmpDir("closure-j2");
  const pages = PLANTS[control] !== undefined ? (await buildShiftManagerCopy(scratch, "control", PLANTS[control]!)).pages : await buildShiftManagerPages(join(scratch, "pages"));
  const file = join(scratch, "devteam.sqlite");
  const served = await startShiftManager({ scratch, label: "j2", config: DEVTEAM, pages, env: { DEVTEAM_STORE: file }, timeoutMs: 180_000 });
  const store = storeAt(file);
  const browser = await launchChromium();
  try {
    const { page, errors } = await personPage(browser, served.origin, { userId: "", bearer: "" }, true);
    await openShiftManager(page, served.origin, "/");
    const config = (await page.evaluate(() => (window as any).__FSD_DEVTOOL_CONFIG__)) as { userId: string; bearerToken?: string };
    const fsd = createClient({
      userId: config.userId,
      baseUrl: served.origin,
      fetcher: (input, init) => fetch(input, { ...init, headers: { ...(init?.headers as Record<string, string>), ...(config.bearerToken ? { authorization: `Bearer ${config.bearerToken}` } : {}) } }),
    });
    const readFrom = Date.now();
    const quiet = async () => {
      for (let last = store.requests(0).length, still = 0; still < 3; await sleep(1_000)) {
        const now = store.requests(0).length;
        still = now === last ? still + 1 : 0;
        last = now;
      }
    };
    for (const surface of SURFACES) {
      await quiet();
      const before = new Set(store.requests(0).map((r) => r.id));
      await page.evaluate((path) => {
        history.pushState({}, "", path);
        dispatchEvent(new PopStateEvent("popstate"));
      }, surface.path);
      const drawn = await page.getByRole("heading", { name: surface.title, exact: true }).first().waitFor({ timeout: 30_000 }).then(() => true, () => false);
      await sleep(4_000);
      const failed = await page.getByText(/couldn't load|failed to load|didn't load/i).count();
      if (!drawn) failures.push(`j2:renders: ${surface.name} (${surface.path}) drew no "${surface.title}" heading`);
      if (failed > 0) failures.push(`j2:renders: ${surface.name} shows ${failed} failure(s)`);
      const added = store.requests(0).filter((r) => !before.has(r.id));
      const allowed = surface.name === "Usage" ? added.filter((r) => /usage/i.test(r.flow_kind) || r.flow_kind === "fsd-default-write") : [];
      const extra = added.filter((r) => !allowed.includes(r));
      if (surface.name !== "Projects" && extra.length > 0) failures.push(`j2:read-writes-nothing: opening ${surface.name} added ${extra.length} request(s): ${extra.map((r) => `${r.flow_kind} ${r.status}`).join(", ")}`);
      if (surface.name === "Usage" && allowed.length > 1) failures.push(`j2:read-writes-nothing: opening Usage sent ${allowed.length} Re-checks, not one`);
      notes.push(`j2 ${surface.name}: drawn ${drawn}, ${added.length} new request(s)${added.length ? ` (${added.map((r) => r.flow_kind).join(", ")})` : ""}`);
    }
    if (errors.length > 0) failures.push(`j2:renders: page errors: ${errors.slice(0, 3).join(" | ")}`);

    // j2:no-read-session
    const made = tell.over("j2:no-read-session · sessions made while the page read", store.sessions(readFrom), { emptyIs: "no session made is none made only to read" });
    const requested = new Set(store.requests(readFrom).map((r) => r.session_id));
    const taskText = store.resources().filter((r) => /^(tasks|runs)\//.test(r.resource_key)).map((r) => r.state).join("\n");
    for (const s of made) if (!requested.has(s.id) && !taskText.includes(s.id)) failures.push(`j2:no-read-session: session ${s.id} (${s.flow_kind}) has no request, task or run`);

    // j2:identity
    const orgId = (await fsd.flow(ROSTER_FLOW).identity()).orgId;
    const orgProjects = store.resources().filter((r) => r.scope_type === "org" && r.scope_id.endsWith(orgId ?? "\0") && /^projects\//.test(r.resource_key));
    tell.over("j2:identity · projects the store holds under the identity's org", orgProjects);
    await page.evaluate(() => {
      history.pushState({}, "", "/p/storefront");
      dispatchEvent(new PopStateEvent("popstate"));
    });
    const shown = await page.getByRole("heading", { name: "Storefront" }).first().waitFor({ timeout: 15_000 }).then(() => true, () => false);
    if (!shown || !orgProjects.some((r) => r.resource_key.endsWith("/storefront"))) failures.push(`j2:identity: the page ${shown ? "draws" : "doesn't draw"} Storefront, and the identity read's org (${orgId}) holds ${orgProjects.map((r) => r.resource_key).join(", ") || "no project"}`);
    notes.push(`j2:identity: org ${orgId}, ${orgProjects.length} project(s) under it; ${made.length} session(s) made while reading`);
  } finally {
    await browser.close().catch(() => undefined);
    await served.stop();
  }
}
