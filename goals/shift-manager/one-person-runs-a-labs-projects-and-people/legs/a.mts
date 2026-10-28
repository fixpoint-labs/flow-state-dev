/**
 * Leg a: the person asks the Shift Coordinator for two projects, one shared with
 * another member, and finds them under PROJECTS, each with four tabs whose Stream is
 * the person's own project coordinator for it, before and after a restart.
 *
 * Steps a1 to a5 (PLAN.md → Checks). Only rows the Shift Coordinator created in
 * this run are graded: the boot's own rows are snapshotted first and must be
 * unchanged.
 */
import type { Page } from "playwright";
import { hex, quote, callsTo, projectCoordinatorOf, projectsDrawn, readProjects, same, sleep, streamCoordinator, visible, askShiftCoordinator, type ProjectRow, type World } from "../steps.mts";

/** Open Shift Manager at `url` in another person's page: whether its shell drew, or the refusal it drew instead. */
async function openAs(page: Page, url: string): Promise<{ ok: true } | { ok: false; why: string }> {
  await page.goto(url);
  await Promise.race([page.getByTestId("shell").waitFor({ timeout: 30_000 }), page.getByTestId("refusal").waitFor({ timeout: 30_000 })]).catch(() => undefined);
  if ((await page.getByTestId("shell").count()) > 0) return { ok: true };
  const why = ((await page.getByTestId("refusal").textContent().catch(() => null)) ?? "neither the shell nor a refusal was drawn").replace(/\s+/g, " ").trim();
  return { ok: false, why };
}

/** What leg a hands the steps after it, and a restart re-reads. */
export interface LegA {
  p1: ProjectRow;
  p2: ProjectRow;
  defaults: ProjectRow[];
  /** The session each project's Stream drew for the person, by project id, so a restart can find the same. */
  streams: Record<string, string>;
}

const rowKey = (r: ProjectRow) => JSON.stringify({ t: r.title, b: r.brief ?? null, o: r.ownerUserId, m: [...r.members].sort() });

/** The flow a person reads their roster and projects through: the session made for a person who holds none. */
const READER_FLOW = "workforce-roster";

/**
 * When Shift Manager refuses a person who holds no session (the refusal is
 * graded first), make them one session over HTTP on the roster flow, and open
 * `url` again, so the rest of a4 is still graded.
 */
async function openWithSession(world: World, who: "member" | "outsider", page: Page, url: string): Promise<{ ok: true; madeSession?: string } | { ok: false; why: string }> {
  const first = await openAs(page, url);
  if (first.ok) return first;
  const kind = READER_FLOW;
  const made = await world.routes[who].call("POST", `/${encodeURIComponent(kind)}/sessions`, { userId: world.routes[who].user.userId });
  if (made.status >= 400) return first;
  const again = await openAs(page, url);
  return again.ok ? { ok: true, madeSession: `${kind}/${String(made.body?.session?.id)}` } : first;
}

/** a1 and a2 to a4: ask, then read. Returns undefined when a1 left nothing to grade. */
export async function legA(world: World): Promise<LegA | undefined> {
  const r = world.record;
  const { owner, member } = world.people;

  // ---- a1 · ask for two projects ---------------------------------------------
  // A project lists no mailbox, so D1's "one workstream on each of two teams" has no subject:
  // a project's workstreams are entries people open in it, which the Shift Coordinator doesn't pick.
  const boot = await readProjects(world.routes.owner);
  const titles = [`Launch ${hex(2)}`, `Research ${hex(2)}`];
  const words =
    `Please create two projects for me. The first is called "${titles[0]}": add ${member.userId} as a member. ` +
    `The second is called "${titles[1]}": a shared project too, with only me as a member.`;
  const turn = await askShiftCoordinator(world, "a1", words);
  if (turn === undefined) {
    r.fail("a1", "no Shift Coordinator seat: the Shift Coordinator view draws no Shift Coordinator to ask");
    return undefined;
  }
  const creates = callsTo(turn, "createProject");
  if (creates.length !== 2 || creates.some((c) => !c.ok)) r.fail("a1", `Shift Coordinator's session holds ${creates.length} createProject call(s), ${creates.filter((c) => c.ok).length} ok, not two ok: ${quote(turn)}`);
  const after = await readProjects(world.routes.owner);
  const before = new Set(boot.rows.map((row) => row.id));
  const created = after.rows.filter((row) => !before.has(row.id));
  const p1 = created.find((row) => row.title.trim().toLowerCase() === titles[0]!.toLowerCase());
  const p2 = created.find((row) => row.title.trim().toLowerCase() === titles[1]!.toLowerCase());
  if (created.length !== 2 || p1 === undefined || p2 === undefined) {
    r.fail("a1", `two rows: the store holds ${created.length} new row(s) [${created.map((c) => `${c.id} "${c.title}"`).join(", ")}], wanted exactly "${titles[0]}" and "${titles[1]}"; ${quote(turn)}`);
    return undefined;
  }
  for (const [row, members] of [
    [p1, [owner.userId, member.userId]],
    [p2, [owner.userId]],
  ] as const) {
    if (row.ownerUserId !== owner.userId) r.fail("a1", `${row.id} is owned by ${row.ownerUserId}, not the person who asked (${owner.userId})`);
    if (!same(row.members, members)) r.fail("a1", `${row.id}'s members are [${row.members.join(", ")}], asked for [${members.join(", ")}]`);
  }
  const defaults = after.rows.filter((row) => before.has(row.id));
  for (const row of boot.rows) {
    const now = defaults.find((d) => d.id === row.id);
    if (now === undefined || rowKey(now) !== rowKey(row)) r.fail("a1", `the default project ${row.id} changed while Shift Coordinator created the new ones`);
  }
  r.saw("a1", `asked "${words}"; Shift Coordinator: ${quote(turn)}; new rows ${p1.id} {owner ${p1.ownerUserId}, members [${p1.members}]} and ${p2.id} {owner ${p2.ownerUserId}, members [${p2.members}]}`);

  const state: LegA = { p1, p2, defaults: boot.rows, streams: {} };
  await readBack(world, state, false);
  return state;
}

/**
 * a2 to a4 (and, after a restart, a5: the same reads on a new process, each
 * Stream on the same coordinator session as before).
 */
export async function readBack(world: World, state: LegA, restarted: boolean): Promise<void> {
  const r = world.record;
  const tag = (step: string) => (restarted ? "a5" : step);
  const { p1, p2 } = state;
  const store = await readProjects(world.routes.owner);
  const row1 = store.rows.find((x) => x.id === p1.id);
  const row2 = store.rows.find((x) => x.id === p2.id);
  if (row1 === undefined || row2 === undefined) {
    r.fail(tag("a2"), `the store no longer holds ${row1 === undefined ? p1.id : ""} ${row2 === undefined ? p2.id : ""}`);
    return;
  }
  if (restarted) {
    for (const [was, now] of [
      [p1, row1],
      [p2, row2],
    ] as const) {
      if (rowKey(was) !== rowKey(now)) r.fail("a5", `${was.id}'s row changed across the restart: ${rowKey(was)} became ${rowKey(now)}`);
    }
  }

  // ---- a2 · PROJECTS ---------------------------------------------------------
  await world.open("/shift-coordinator");
  const groups = await projectsDrawn(world.page);
  for (const row of [row1, row2]) {
    const g = groups.find((x) => x.id === row.id);
    if (g === undefined) r.fail(tag("a2"), `PROJECTS does not list ${row.id} ("${row.title}")`);
    else if (g.streams.length > 0) r.fail(tag("a2"), `PROJECTS lists [${g.streams.join(", ")}] under ${row.id}, and a project lists no mailbox`);
  }
  const titles = await world.page.locator("[data-testid=project-group]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-project-id")}=${(e.textContent ?? "").trim().slice(0, 80)}`));
  for (const row of [row1, row2]) if (!titles.some((t) => t.startsWith(`${row.id}=`) && t.toLowerCase().includes(row.title.toLowerCase()))) r.fail(tag("a2"), `PROJECTS does not title ${row.id} "${row.title}"`);
  for (const d of state.defaults) {
    const g = groups.find((x) => x.id === d.id);
    if (g === undefined || g.streams.length > 0) r.fail(tag("a2"), `the default ${d.id} is drawn as [${g?.streams.join(", ") ?? "nothing"}], and a project lists no mailbox`);
  }
  r.saw(tag("a2"), `PROJECTS: ${groups.map((g) => `${g.id}[${g.streams.join(",")}]`).join(" ")}`);

  // ---- a3 · four tabs each -----------------------------------------------------
  const tabs = tag("a3");
  const coordinator = await projectCoordinatorOf(world);
  if ("error" in coordinator) r.fail(tabs, `the Stream's coordinator can't be graded: ${coordinator.error}`);
  for (const row of [row1, row2]) {
    // Any tab-level gap only: a Stream whose conversation has no line yet draws `project-stream-conversation-empty`.
    const gaps = ["brief", "workstreams", "board", "stream"].map((t) => `[data-testid=project-${t}-empty]`).join(", ");
    const noGap = async (name: string) => {
      if ((await world.page.locator(gaps).count()) > 0) r.fail(tabs, `${row.id}'s ${name} draws a project-<tab>-empty gap state`);
    };
    const tab = async (name: string) => {
      await world.open(`/p/${encodeURIComponent(row.id)}/${name}`);
      await world.page.locator(`[role=tab][data-tab=${name}][aria-selected=true]`).waitFor({ timeout: 10_000 }).catch(() => undefined);
      await noGap(name);
      const text = (await world.page.locator("main").textContent().catch(() => "")) ?? "";
      if (/FIX-1650|arrives? with FIX-17(18|19)|once org seats ship/.test(text)) r.fail(tabs, `${row.id}'s ${name} draws gap copy`);
    };
    await tab("brief");
    if (row.brief === null || row.brief === undefined || row.brief.trim() === "") {
      if (!(await visible(world.page, "project-brief-none"))) r.fail(tabs, `${row.id} has no brief and its Brief doesn't say so`);
    } else {
      const drawn = ((await world.page.getByTestId("project-brief").textContent().catch(() => "")) ?? "").trim();
      if (drawn !== row.brief.trim()) r.fail(tabs, `${row.id}'s Brief draws "${drawn}", stored "${row.brief}"`);
    }
    await tab("workstreams");
    if (!(await visible(world.page, "project-progress"))) r.fail(tabs, `${row.id}'s Workstreams draws no progress`);
    const listed = await world.page.locator("[data-testid=project-workstream]").evaluateAll((els) => els.map((e) => e.getAttribute("data-mailbox-id") ?? ""));
    if (listed.length > 0) r.fail(tabs, `${row.id}'s Workstreams lists mailbox workstreams [${listed}], and a project lists none`);
    await tab("board");
    if (!(await visible(world.page, "project-board-none"))) r.fail(tabs, `${row.id}'s Board doesn't draw its named no-board state`);
    await tab("stream");
    // The Stream is the person's own project coordinator for this project, and after a restart the same one.
    if (!("error" in coordinator)) {
      const drawn = await streamCoordinator(world.page, world.routes.owner, coordinator, row.id);
      // The Stream opens its session after the tab is selected, so its gap is read again once it is drawn.
      await noGap("stream");
      if ("why" in drawn) r.fail(tabs, `${row.id}'s Stream: ${drawn.why}`);
      else if (restarted && state.streams[row.id] !== undefined && state.streams[row.id] !== drawn.session) {
        r.fail(tabs, `${row.id}'s Stream draws coordinator session ${drawn.session} after the restart, ${state.streams[row.id]} before`);
      } else {
        state.streams[row.id] = drawn.session;
        r.saw(tabs, `${row.id}'s Stream is the person's ${coordinator.worker} session ${drawn.session}`);
      }
    }
  }
  await r.shot(world.page, restarted ? "a5" : "a3");

  // ---- a4 · the second member's own coordinator; the outsider reads the org's projects ----
  const a4 = tag("a4");
  const memberView = await world.as("member");
  try {
    const url = `${world.served.origin}/p/${encodeURIComponent(row1.id)}/stream`;
    const refused = await openAs(memberView.page, url);
    if (!refused.ok) r.fail(a4, `the second member can't open Shift Manager: "${refused.why}"`);
    const opened = refused.ok ? refused : await openWithSession(world, "member", memberView.page, url);
    if (!refused.ok && opened.ok) r.saw(a4, `the rest of a4's member checks ran after the check made the member a session over HTTP (${(opened as { madeSession?: string }).madeSession})`);
    if (opened.ok && !("error" in coordinator)) {
      const drawn = await streamCoordinator(memberView.page, world.routes.member, coordinator, row1.id);
      if ("why" in drawn) r.fail(a4, `the second member's ${row1.id} Stream: ${drawn.why}`);
      else if (drawn.session === state.streams[row1.id]) r.fail(a4, `the second member's ${row1.id} Stream draws the person's own coordinator session ${drawn.session}`);
      else r.saw(a4, `the second member's ${row1.id} Stream is their own ${coordinator.worker} session ${drawn.session}`);
    }
    await r.shot(memberView.page, restarted ? "a5-member" : "a4-member");
  } finally {
    await memberView.context.close();
  }
  const outsiderView = await world.as("outsider");
  try {
    const url = `${world.served.origin}/shift-coordinator`;
    const refused = await openAs(outsiderView.page, url);
    if (!refused.ok) r.fail(a4, `the outsider can't open Shift Manager: "${refused.why}"`);
    const opened = refused.ok ? refused : await openWithSession(world, "outsider", outsiderView.page, url);
    if (!opened.ok) {
      await r.shot(outsiderView.page, restarted ? "a5-outsider" : "a4-outsider");
      return;
    }
    if (!refused.ok) r.saw(a4, `the rest of a4's outsider checks ran after the check made the outsider a session over HTTP (${(opened as { madeSession?: string }).madeSession})`);
    const seen = await projectsDrawn(outsiderView.page);
    for (const row of [row1, row2]) if (!seen.some((g) => g.id === row.id)) r.fail(a4, `the outsider's PROJECTS doesn't list ${row.id}`);
    await r.shot(outsiderView.page, restarted ? "a5-outsider" : "a4-outsider");
  } finally {
    await outsiderView.context.close();
  }
  r.saw(a4, `the outsider saw ${row1.id} and ${row2.id} listed`);
}
