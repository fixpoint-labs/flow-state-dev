/**
 * Leg b: the person changes who works in the Lab through the Shift Coordinator.
 * A hire lands at once; a fire waits for the person's Approve in Inbox, holds
 * across a restart while it waits, and lands only on Approve; a team seat
 * asked to hire doesn't.
 *
 * A worker the person hires is theirs: a row on their own roster, which
 * Shift Manager's Roster lists as theirs, and nothing in the organization's
 * seat inventory.
 *
 * Steps b1 to b4 (PLAN.md → Checks). Runs on leg a's store and server, after
 * leg a. Under the `deny-fire` control, b3 clicks Reject.
 */
import {
  answerInInbox,
  askShiftCoordinator,
  asksOf,
  callsTo,
  shiftCoordinatorFlowOf,
  hex,
  inboxAsks,
  quote,
  readInventory,
  readProjects,
  readWorkers,
  rosterOwn,
  sleep,
  treeWorkers,
  visible,
  type World,
} from "../steps.mts";
import type { StoredItem } from "../../../lib/shift-manager.mts";

/**
 * The ask for a coder, naming what the claim isn't about: the flow and the
 * brief a coder runs with, read from the team's own coder in the tree, so a
 * Shift Coordinator that asks which brief instead of hiring isn't graded on it.
 */
async function hireCoder(world: World, seat: string): Promise<string> {
  const coder = (await treeWorkers(world)).find((w) => w.id.endsWith(".coder"));
  if (coder === undefined || typeof coder.declared.flow !== "string" || typeof coder.declared.document !== "string") {
    throw new Error("the tree declares no team coder with a flow and a document to hire one like");
  }
  return `Please hire one more coder for the team, with the seat id "${seat}", like ${coder.id}: on the "${coder.declared.flow}" flow, with the settings { "document": "${coder.declared.document}" }.`;
}

/** What the worker looks like in each place it can be read: the person's roster, Roster's own rows, the org's seat inventory. */
async function where(world: World, worker: string) {
  const rosterRow = (await readWorkers(world.routes.owner)).find((x) => x.id === worker);
  const inventory = await readInventory(world.routes.owner);
  const onRoster = (await rosterOwn(world)).some((x) => x.id === worker);
  return {
    rosterRow,
    onRoster,
    inInventory: inventory.some((x) => typeof x.id === "string" && (x.id === worker || (x.id as string).endsWith(`.${worker}`))),
  };
}

/**
 * b1 only, as the `no-shift-coordinator` control runs it: the hire asked of whoever the
 * person can ask. With no Shift Coordinator, that is the EM, in a workstream it
 * leads (as b4 asks it). Fails at "seat appears" when no seat appears.
 */
export async function hireWithoutShiftCoordinator(world: World): Promise<void> {
  const r = world.record;
  const seat = `coder-${hex()}`;
  await world.open("/shift-coordinator");
  if (!(await visible(world.page, "shift-coordinator-none", 15_000))) {
    r.fail("setup", "the Shift Coordinator view does not draw its no-Shift Coordinator state, so the control's patch did not take");
    return;
  }
  r.saw("setup", "the Shift Coordinator view draws its no-Shift Coordinator state");
  const posted = await postInWorkstream(world, await hireCoder(world, seat));
  if (posted.stored !== 1) {
    r.fail("setup", `the ask to the EM was not kept: ${posted.said}; the workstream's session holds ${posted.stored} copies, so a missing worker would prove nothing`);
    return;
  }
  await sleep(20_000);
  const seen = await where(world, seat);
  if (seen.rosterRow === undefined && !seen.onRoster) r.fail("b1", `seat appears: asked of the EM seat with no Shift Coordinator, no worker "${seat}" is on the person's roster or listed in Roster`);
  else r.saw("b1", `"${seat}" appeared: roster row ${JSON.stringify(seen.rosterRow)}, Roster lists it ${seen.onRoster}`);
}

/** The id of the workstream the person opens for the EM to lead. */
const EM_WORKSTREAM = "feature";

/**
 * The person's own workstream led by the EM: opened, once, in the
 * organization's first project through the projects flow Shift Manager opens
 * one with. Its page and its session.
 */
async function emWorkstream(world: World): Promise<{ path: string; session: string }> {
  const routes = world.routes.owner;
  const lead = (await treeWorkers(world)).find((w) => w.declared.flow === "em")?.id;
  if (lead === undefined) throw new Error("the tree declares no worker on the em flow to lead a workstream");
  const project = (await readProjects(routes)).rows[0]?.id;
  if (project === undefined) throw new Error("the Lab holds no project to open a workstream in");
  const made = await routes.call("POST", "/projects/sessions", { userId: routes.user.userId });
  if (made.status !== 201) throw new Error(`no projects session: ${made.status} ${JSON.stringify(made.body)}`);
  const opened = await routes.act("projects", String(made.body.session.id), "openWorkstream", {
    project: { visibility: "shared", id: project },
    id: EM_WORKSTREAM,
    title: "Feature",
    lead,
  });
  const session = opened.output?.workstream?.sessionId;
  if (opened.status !== "completed" || typeof session !== "string") throw new Error(`opening ${project}'s ${EM_WORKSTREAM} ended ${opened.status}: ${opened.error ?? JSON.stringify(opened.output)}`);
  const path = `/p/${encodeURIComponent(project)}/workstreams?owner=${encodeURIComponent(routes.user.userId)}&ws=${EM_WORKSTREAM}`;
  return { path, session };
}

/**
 * Say `line` to the EM in a workstream it leads, through the workstream
 * page's composer, as a person does, and wait for the workstream's session to
 * keep it. `stored` is how many user messages in that session carry the line;
 * `said` is what the composer showed.
 */
async function postInWorkstream(world: World, line: string): Promise<{ stored: number; said: string }> {
  const { path, session } = await emWorkstream(world);
  await world.open(path);
  await world.page.getByTestId("project-entry-composer-input").waitFor({ timeout: 15_000 });
  await world.page.getByTestId("project-entry-composer-input").fill(line);
  await world.page.getByTestId("project-entry-composer-send").click();
  const kept = async () =>
    (await world.routes.owner.items(session, "message")).filter((i) => (i as { role?: string }).role === "user" && JSON.stringify(i).includes(JSON.stringify(line).slice(1, -1))).length;
  let stored = 0;
  for (const until = Date.now() + 60_000; Date.now() < until; await sleep(500)) {
    stored = await kept();
    if (stored > 0) break;
  }
  const error = await world.page.getByTestId("project-entry-composer-error").textContent({ timeout: 1_000 }).catch(() => null);
  const state = (await world.page.getByTestId("project-entry-composer-status").getAttribute("data-state").catch(() => null)) ?? "unknown";
  return { stored, said: error === null ? `the composer reads ${state}` : `the composer says "${error.trim().slice(0, 200)}"` };
}

/** b1 to b4. `restart` stops and starts the Lab on the same store. */
export async function legB(world: World, restart: (label: string) => Promise<void>, deny: boolean): Promise<void> {
  const r = world.record;
  const seat = `coder-${hex()}`;

  // ---- b1 · hire -----------------------------------------------------------------
  const hire = await askShiftCoordinator(world, "b1", await hireCoder(world, seat));
  if (hire === undefined) {
    r.fail("b1", "no Shift Coordinator seat: the Shift Coordinator view draws no Shift Coordinator to ask");
    return;
  }
  const shiftCoordinatorSession = hire.sessionId;
  const hires = callsTo(hire, "hire");
  if (hires.length !== 1 || !hires[0]!.ok) r.fail("b1", `Shift Coordinator's session holds ${hires.length} hire call(s), ${hires.filter((h) => h.ok).length} ok: ${quote(hire)}`);
  const raised = shiftCoordinatorSession === null || hire.requestId === null ? [] : (await asksOf(world.routes.owner, shiftCoordinatorSession, hire.requestId)).filter((a) => a.reason === "human_approval");
  if (raised.length > 0) r.fail("b1", `the hire raised ${raised.length} human_approval ask(s)`);
  if (hire.status !== "completed") r.fail("b1", `the hire turn ended ${hire.status}`);
  const hired = await where(world, seat);
  if (hired.rosterRow === undefined) r.fail("b1", `seat appears: the person's roster has no row for "${seat}"`);
  if (!hired.onRoster) r.fail("b1", `seat appears: Roster doesn't list "${seat}" as the person's own`);
  if (hired.inInventory) r.fail("b1", `"${seat}" is in the organization's seat inventory: a worker the person hires is theirs, not the organization's`);
  r.saw("b1", `Shift Coordinator: ${quote(hire)}; roster row ${JSON.stringify(hired.rosterRow)}, Roster lists it ${hired.onRoster}, in the org's inventory ${hired.inInventory}`);
  if (hired.rosterRow === undefined || shiftCoordinatorSession === null) return;

  // ---- b2 · fire asks ------------------------------------------------------------
  const fire = await askShiftCoordinator(world, "b2", `Please fire the seat "${seat}".`);
  if (fire?.composerSaid !== undefined) r.fail("b2", `the Shift Coordinator composer told the person "${fire.composerSaid}" for a line its session holds`);
  let ask: StoredItem | undefined;
  if (fire === undefined || fire.requestId === null || fire.sessionId === null) {
    r.fail("b2", `the fire was not asked: ${quote(fire)}`);
  } else {
    const asks = (await asksOf(world.routes.owner, fire.sessionId, fire.requestId)).filter((a) => a.reason === "human_approval");
    ask = asks[0];
    const named = (ask?.data as { worker?: string } | undefined)?.worker;
    if (fire.status !== "suspended" || asks.length !== 1) r.fail("b2", `the fire turn ended ${fire.status} with ${asks.length} human_approval ask(s): ${quote(fire)}`);
    else if (named !== seat || !/fire/i.test(ask!.message ?? "")) r.fail("b2", `the ask says "${ask!.message}" naming ${JSON.stringify(ask!.data)}, not a fire of "${seat}"`);
    const inbox = await inboxAsks(world);
    if (ask?.suspensionId === undefined || !inbox.includes(ask.suspensionId)) r.fail("b2", `Inbox doesn't list the ask ${ask?.suspensionId} (lists [${inbox.join(", ")}])`);
    else {
      await world.open(`/inbox/${encodeURIComponent(ask.suspensionId)}`);
      const card = world.page.locator(`[data-testid=ask-card][data-suspension-id="${ask.suspensionId}"]`);
      const text = (await card.textContent({ timeout: 15_000 }).catch(() => "")) ?? "";
      if (!text.includes(seat)) r.fail("b2", `Inbox's card doesn't name "${seat}": "${text.slice(0, 200)}"`);
      await r.shot(world.page, "b2-inbox");
      r.saw("b2", `Inbox card: "${text.replace(/\s+/g, " ").slice(0, 200)}"; stored ask "${ask.message}" ${JSON.stringify(ask.data)}`);
    }
  }
  const waiting = await where(world, seat);
  if (waiting.rosterRow === undefined || !waiting.onRoster) r.fail("b2", `"${seat}" changed before anyone answered: roster row ${waiting.rosterRow !== undefined}, Roster ${waiting.onRoster}`);
  await restart("b2-restart");
  const still = await where(world, seat);
  if (still.rosterRow === undefined || !still.onRoster) r.fail("b2", `after a restart "${seat}" is roster row ${still.rosterRow !== undefined}, Roster ${still.onRoster}`);
  const inboxAfter = await inboxAsks(world);
  if (ask?.suspensionId !== undefined && !inboxAfter.includes(ask.suspensionId)) r.fail("b2", `after a restart Inbox no longer lists the ask ${ask.suspensionId}`);
  else r.saw("b2", "after a restart the worker is still on the person's roster and the ask still in Inbox");

  // ---- b3 · Approve (or Reject, under deny-fire) ----------------------------------
  if (ask?.suspensionId !== undefined && fire?.requestId != null) {
    const answered = await answerInInbox(world, ask.suspensionId, deny ? "Reject" : "Approve");
    if (!answered.clicked) r.fail("b3", `Inbox draws no card for ${ask.suspensionId} to answer`);
    const settled = await world.routes.owner.settle(await shiftCoordinatorFlowOf(world), fire.requestId, 180_000, true);
    r.saw("b3", `${deny ? "Reject" : "Approve"} clicked in Inbox; the fire's turn ended ${settled}`);
    const gone = await where(world, seat);
    const checkGone = (label: string, g: typeof gone) => {
      if (g.rosterRow !== undefined || g.onRoster) {
        r.fail("b3", `seat gone: ${label} "${seat}" is roster row ${g.rosterRow !== undefined}, Roster ${g.onRoster}`);
        return false;
      }
      return true;
    };
    if (checkGone(`after ${deny ? "Reject" : "Approve"}`, gone)) r.saw("b3", `"${seat}" left the person's roster and Roster`);
    await restart("b3-restart");
    if (checkGone("after a restart", await where(world, seat))) r.saw("b3", "still gone after a restart");
  } else {
    r.fail("b3", "seat gone: no ask to answer");
  }

  // ---- b4 · no other seat hires ---------------------------------------------------
  const other = `coder-${hex()}`;
  const rosterBefore = (await readWorkers(world.routes.owner)).length;
  const posted = await postInWorkstream(world, `EM, please hire another coder seat for this team yourself, with the seat id "${other}".`);
  // Only a line the workstream kept was asked of anyone: an unsent one hires nothing whatever the EM would do.
  if (posted.stored !== 1) {
    r.fail("b4", `the ask was not kept: ${posted.said}; the workstream's session holds ${posted.stored} copies, so no worker being hired proves nothing`);
    return;
  }
  // The EM answers in its own time; give it the turn a person would wait for.
  await sleep(30_000);
  const after = await where(world, other);
  if (after.rosterRow !== undefined || after.onRoster || after.inInventory) r.fail("b4", `asked of the EM seat, "${other}" was hired: roster row ${after.rosterRow !== undefined}, Roster ${after.onRoster}, inventory ${after.inInventory}`);
  else r.saw("b4", `the workstream kept the line once; no worker "${other}" (the person's roster held ${rosterBefore} rows before, ${(await readWorkers(world.routes.owner)).length} after)`);
}
