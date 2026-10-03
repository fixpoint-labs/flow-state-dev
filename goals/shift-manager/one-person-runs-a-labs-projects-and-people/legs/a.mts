/**
 * Leg a: the person asks the chief of staff for two projects, one spanning two
 * teams, and finds them under PROJECTS, each with four tabs and a room its
 * members share and an outsider can't read, before and after a restart.
 *
 * Steps a1 to a5 (PLAN.md → Checks). Only rows the chief of staff created in
 * this run are graded: the boot's own rows are snapshotted first and must be
 * unchanged.
 */
import type { Page } from "playwright";
import { hex, quote, callsTo, projectsDrawn, readProjects, readRoom, same, sleep, visible, askCos, type ProjectRow, type World } from "../steps.mts";

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
  token: string;
  answer: string | undefined;
}

const teamOf = (channelId: string) => channelId.split(".")[0]!;
const rowKey = (r: ProjectRow) => JSON.stringify({ t: r.title, b: r.brief ?? null, o: r.ownerUserId, m: [...r.members].sort(), w: r.workstreams, s: r.sessions.map((s) => `${s.userId}=${s.sessionId}`).sort() });

/** a1 and a2 to a4: ask, then read. Returns undefined when a1 left nothing to grade. */
export async function legA(world: World, channelSession: string): Promise<LegA | undefined> {
  const r = world.record;
  const { owner, member } = world.people;

  // ---- a1 · ask for two projects ---------------------------------------------
  const boot = await readProjects(world.routes.owner, channelSession);
  const claimed = new Set(boot.rows.flatMap((row) => row.workstreams));
  const free = boot.channels.filter((c) => !claimed.has(c));
  const teams = [...new Set(free.map(teamOf))].sort();
  // D1: one workstream on each of two teams that no default project holds.
  const picked = teams.slice(0, 2).map((t) => free.find((c) => teamOf(c) === t)!);
  if (picked.length < 2) {
    r.fail("a1", `D1's workstreams: the boot's projects leave free [${free.join(", ")}], not one on each of two teams (finding against FIX-1718)`);
    return undefined;
  }
  const titles = [`Launch ${hex(2)}`, `Research ${hex(2)}`];
  const words =
    `Please create two projects for me. The first is called "${titles[0]}": give it the workstreams ${picked[0]} and ${picked[1]}, ` +
    `and add ${member.userId} as a member. The second is called "${titles[1]}", with no workstreams and nobody else.`;
  const turn = await askCos(world, "a1", words);
  if (turn === undefined) {
    r.fail("a1", "no CoS seat: the Chief of Staff view draws no chief of staff to ask");
    return undefined;
  }
  const creates = callsTo(turn, "createProject");
  if (creates.length !== 2 || creates.some((c) => !c.ok)) r.fail("a1", `CoS's session holds ${creates.length} createProject call(s), ${creates.filter((c) => c.ok).length} ok, not two ok: ${quote(turn)}`);
  const after = await readProjects(world.routes.owner, channelSession);
  const before = new Set(boot.rows.map((row) => row.id));
  const created = after.rows.filter((row) => !before.has(row.id));
  const p1 = created.find((row) => row.title.trim().toLowerCase() === titles[0]!.toLowerCase());
  const p2 = created.find((row) => row.title.trim().toLowerCase() === titles[1]!.toLowerCase());
  if (created.length !== 2 || p1 === undefined || p2 === undefined) {
    r.fail("a1", `two rows: the store holds ${created.length} new row(s) [${created.map((c) => `${c.id} "${c.title}"`).join(", ")}], wanted exactly "${titles[0]}" and "${titles[1]}"; ${quote(turn)}`);
    return undefined;
  }
  for (const [row, members, workstreams] of [
    [p1, [owner.userId, member.userId], picked],
    [p2, [owner.userId], []],
  ] as const) {
    if (row.ownerUserId !== owner.userId) r.fail("a1", `${row.id} is owned by ${row.ownerUserId}, not the person who asked (${owner.userId})`);
    if (!same(row.members, members)) r.fail("a1", `${row.id}'s members are [${row.members.join(", ")}], asked for [${members.join(", ")}]`);
    if (!same(row.workstreams, workstreams)) r.fail("a1", `${row.id}'s workstreams are [${row.workstreams.join(", ")}], asked for [${workstreams.join(", ")}]`);
    if (!row.sessions.some((s) => s.userId === owner.userId)) r.fail("a1", `${row.id}'s sessions list no talk session for the person`);
  }
  const defaults = after.rows.filter((row) => before.has(row.id));
  for (const row of boot.rows) {
    const now = defaults.find((d) => d.id === row.id);
    if (now === undefined || rowKey(now) !== rowKey(row)) r.fail("a1", `the default project ${row.id} changed while CoS created the new ones`);
  }
  r.saw("a1", `asked "${words}"; CoS: ${quote(turn)}; new rows ${p1.id} {owner ${p1.ownerUserId}, members [${p1.members}], workstreams [${p1.workstreams}]} and ${p2.id} {owner ${p2.ownerUserId}, members [${p2.members}], workstreams [${p2.workstreams}]}`);

  const state: LegA = { p1, p2, defaults: boot.rows, token: `room-${hex(4)}`, answer: undefined };
  await readBack(world, channelSession, state, false);
  return state;
}

/**
 * a2 to a4 (and, after a restart, a5: the same reads on a new process). The
 * first time, a3 posts the token into P1's room; after a restart it only reads.
 */
export async function readBack(world: World, channelSession: string, state: LegA, restarted: boolean): Promise<void> {
  const r = world.record;
  const tag = (step: string) => (restarted ? "a5" : step);
  const { owner } = world.people;
  const { p1, p2 } = state;
  const store = await readProjects(world.routes.owner, channelSession);
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
  await world.open("/cos");
  const groups = await projectsDrawn(world.page);
  for (const row of [row1, row2]) {
    const g = groups.find((x) => x.id === row.id);
    if (g === undefined) r.fail(tag("a2"), `PROJECTS does not list ${row.id} ("${row.title}")`);
    else if (!same(g.streams, row.workstreams)) r.fail(tag("a2"), `PROJECTS lists [${g.streams.join(", ")}] under ${row.id}, its row lists [${row.workstreams.join(", ")}]`);
  }
  const titles = await world.page.locator("[data-testid=project-group]").evaluateAll((els) => els.map((e) => `${e.getAttribute("data-project-id")}=${(e.textContent ?? "").trim().slice(0, 80)}`));
  for (const row of [row1, row2]) if (!titles.some((t) => t.startsWith(`${row.id}=`) && t.toLowerCase().includes(row.title.toLowerCase()))) r.fail(tag("a2"), `PROJECTS does not title ${row.id} "${row.title}"`);
  if (new Set(row1.workstreams.map(teamOf)).size < 2) r.fail(tag("a2"), `${row1.id} lists workstreams of one team: ${row1.workstreams.join(", ")}`);
  for (const d of state.defaults) {
    const g = groups.find((x) => x.id === d.id);
    if (g === undefined || !same(g.streams, d.workstreams)) r.fail(tag("a2"), `the default ${d.id} is drawn as [${g?.streams.join(", ") ?? "nothing"}], its row lists [${d.workstreams.join(", ")}]`);
  }
  r.saw(tag("a2"), `PROJECTS: ${groups.map((g) => `${g.id}[${g.streams.join(",")}]`).join(" ")}`);

  // ---- a3 · four tabs each -----------------------------------------------------
  const tabs = tag("a3");
  for (const row of [row1, row2]) {
    const tab = async (name: string) => {
      await world.open(`/p/${encodeURIComponent(row.id)}/${name}`);
      await world.page.locator(`[role=tab][data-tab=${name}][aria-selected=true]`).waitFor({ timeout: 10_000 }).catch(() => undefined);
      if ((await world.page.locator("[data-testid^=project-][data-testid$=-empty]").count()) > 0) r.fail(tabs, `${row.id}'s ${name} draws a project-*-empty gap state`);
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
    if (row.workstreams.length === 0) {
      if (!(await visible(world.page, "project-workstreams-none"))) r.fail(tabs, `${row.id} lists no workstream and its Workstreams doesn't say so`);
    } else {
      await visible(world.page, "project-workstream");
      const listed = await world.page.locator("[data-testid=project-workstream]").evaluateAll((els) => els.map((e) => e.getAttribute("data-channel-id") ?? ""));
      if (!same(listed, row.workstreams)) r.fail(tabs, `${row.id}'s Workstreams lists [${listed}], its row [${row.workstreams}]`);
      // Each entry opens its workstream: click it, as a person would, and read where the page went.
      for (const id of listed) {
        await world.open(`/p/${encodeURIComponent(row.id)}/workstreams`);
        await world.page.locator(`[data-testid=project-workstream][data-channel-id="${id}"] button`).click({ timeout: 10_000 }).catch(() => undefined);
        await sleep(300);
        const path = new URL(world.page.url()).pathname;
        if (!path.startsWith(`/w/${encodeURIComponent(id)}`)) r.fail(tabs, `${row.id}'s Workstreams entry ${id} opens ${path}, not its workstream`);
      }
    }
    await tab("board");
    if (!(await visible(world.page, "project-board-none"))) r.fail(tabs, `${row.id}'s Board doesn't draw its named no-board state`);
    await tab("stream");
  }
  const own = row1.sessions.find((s) => s.userId === owner.userId)?.sessionId;
  if (own === undefined) {
    r.fail(tabs, `${row1.id} lists no talk session for the person`);
    return;
  }
  if (!restarted) {
    await world.open(`/p/${encodeURIComponent(row1.id)}/stream`);
    if (!(await visible(world.page, "composer-input"))) {
      r.fail(tabs, `${row1.id}'s Stream has no composer`);
      return;
    }
    await world.page.getByTestId("composer-input").fill(`${state.token}: what does this project need first?`);
    await world.page.getByTestId("composer-send").click();
    // The seat's answer: a later room line with an author, waited for, not retried.
    let room: Awaited<ReturnType<typeof readRoom>> = [];
    let mine: (typeof room)[number] | undefined;
    let answer: (typeof room)[number] | undefined;
    for (const until = Date.now() + 180_000; Date.now() < until; await sleep(1000)) {
      room = await readRoom(world.routes.owner, own);
      mine = room.find((l) => l.body.includes(state.token) && l.userId === owner.userId && l.author === null);
      answer = mine === undefined ? undefined : room.find((l) => l.seq > mine!.seq && l.author !== null);
      if (answer !== undefined) break;
    }
    if (mine === undefined) r.fail(tabs, `${row1.id}'s room holds no line with the token posted from its Stream`);
    else if (answer === undefined) r.fail(tabs, `no template seat answered in ${row1.id}'s room within 180 s (lines: ${room.map((l) => `${l.seq}:${l.author ?? l.userId}`).join(" ")})`);
    else {
      state.answer = answer.body;
      r.saw(tabs, `room: the person's line at seq ${mine.seq}, ${answer.author}'s answer at seq ${answer.seq}: "${answer.body.slice(0, 160)}"`);
    }
  }
  if (state.answer !== undefined) {
    await world.open(`/p/${encodeURIComponent(row1.id)}/stream`);
    for (const body of [state.token, state.answer.slice(0, 60)]) {
      try {
        await world.page.getByTestId("transcript-line-body").filter({ hasText: body }).first().waitFor({ timeout: 30_000 });
      } catch {
        r.fail(tabs, `${row1.id}'s Stream doesn't draw "${body.slice(0, 60)}" after the wake`);
      }
    }
  }
  await r.shot(world.page, restarted ? "a5" : "a3");

  // ---- a4 · org-wide, members only -------------------------------------------
  const a4 = tag("a4");
  const memberView = await world.as("member");
  try {
    const opened = await openAs(memberView.page, `${world.served.origin}/p/${encodeURIComponent(row1.id)}/stream`);
    if (!opened.ok) r.fail(a4, `the second member can't open Shift Manager: "${opened.why}"`);
    else {
      if (await visible(memberView.page, "project-join", 8_000)) await memberView.page.getByTestId("project-join").click();
      for (const body of [state.token, ...(state.answer === undefined ? [] : [state.answer.slice(0, 60)])]) {
        try {
          await memberView.page.getByTestId("transcript-line-body").filter({ hasText: body }).first().waitFor({ timeout: 30_000 });
        } catch {
          r.fail(a4, `the second member's ${row1.id} Stream doesn't draw "${body.slice(0, 60)}"`);
        }
      }
    }
    await r.shot(memberView.page, restarted ? "a5-member" : "a4-member");
  } finally {
    await memberView.context.close();
  }
  const outsiderView = await world.as("outsider");
  try {
    const opened = await openAs(outsiderView.page, `${world.served.origin}/cos`);
    if (!opened.ok) {
      r.fail(a4, `the outsider can't open Shift Manager: "${opened.why}"`);
      await r.shot(outsiderView.page, restarted ? "a5-outsider" : "a4-outsider");
      return;
    }
    const seen = await projectsDrawn(outsiderView.page);
    for (const row of [row1, row2]) if (!seen.some((g) => g.id === row.id)) r.fail(a4, `the outsider's PROJECTS doesn't list ${row.id}`);
    await outsiderView.page.goto(`${world.served.origin}/p/${encodeURIComponent(row1.id)}/stream`);
    await outsiderView.page.getByTestId("shell").waitFor({ timeout: 30_000 });
    if (!(await visible(outsiderView.page, "project-stream-members-only", 15_000))) r.fail(a4, `the outsider's ${row1.id} Stream doesn't draw the members-only state`);
    await sleep(1500);
    const html = await outsiderView.page.content();
    if (html.includes(state.token) || (state.answer !== undefined && html.includes(state.answer.slice(0, 40)))) r.fail(a4, `the outsider's page holds a line of ${row1.id}'s room`);
    await r.shot(outsiderView.page, restarted ? "a5-outsider" : "a4-outsider");
  } finally {
    await outsiderView.context.close();
  }
  r.saw(a4, `the second member read both lines in ${row1.id}'s Stream; the outsider saw ${row1.id} and ${row2.id} listed and the members-only state`);
}
