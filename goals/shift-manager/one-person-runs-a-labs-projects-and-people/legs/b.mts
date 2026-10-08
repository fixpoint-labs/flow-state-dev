/**
 * Leg b: the person changes who works in the Lab through the chief of staff.
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
  askCos,
  asksOf,
  callsTo,
  cosFlowOf,
  hex,
  inboxAsks,
  quote,
  readInventory,
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
 * chief of staff that asks which brief instead of hiring isn't graded on it.
 */
async function hireCoder(world: World, seat: string): Promise<string> {
  const coder = (await treeWorkers(world)).find((w) => w.id.endsWith(".coder"));
  if (coder === undefined || typeof coder.declared.flow !== "string" || typeof coder.declared.document !== "string") {
    throw new Error("the tree declares no team coder with a flow and a document to hire one like");
  }
  return `Please hire one more coder for the team, with the seat id "${seat}", like ${coder.id}: on the "${coder.declared.flow}" flow, with the settings { "document": "${coder.declared.document}" }.`;
}

/** What the worker looks like in each place it can be read: the person's roster, Roster's own rows, the org's seat inventory. */
async function where(world: World, mailboxSession: string, worker: string) {
  const rosterRow = (await readWorkers(world.routes.owner)).find((x) => x.id === worker);
  const inventory = await readInventory(world.routes.owner, mailboxSession);
  const onRoster = (await rosterOwn(world)).some((x) => x.id === worker);
  return {
    rosterRow,
    onRoster,
    inInventory: inventory.some((x) => typeof x.id === "string" && (x.id === worker || (x.id as string).endsWith(`.${worker}`))),
  };
}

/**
 * b1 only, as the `no-cos` control runs it: the hire asked of whoever the
 * person can ask. With no chief of staff, that is the EM seat, in the board's
 * workstream composer (as b4 asks it). Fails at "seat appears" when no seat
 * appears.
 */
export async function hireWithoutCos(world: World, mailboxSession: string, boardMailbox: string): Promise<void> {
  const r = world.record;
  const seat = `coder-${hex()}`;
  await world.open("/cos");
  if (!(await visible(world.page, "cos-none", 15_000))) {
    r.fail("setup", "the Chief of Staff view does not draw its no-CoS state, so the control's patch did not take");
    return;
  }
  r.saw("setup", "the Chief of Staff view draws its no-CoS state");
  const posted = await postInWorkstream(world, boardMailbox, await hireCoder(world, seat));
  if (posted.stored !== 1) {
    r.fail("setup", `the ask to the EM was not kept: ${posted.said}; the mailbox's session holds ${posted.stored} copies, so a missing worker would prove nothing`);
    return;
  }
  await sleep(20_000);
  const seen = await where(world, mailboxSession, seat);
  if (seen.rosterRow === undefined && !seen.onRoster) r.fail("b1", `seat appears: asked of the EM seat with no chief of staff, no worker "${seat}" is on the person's roster or listed in Roster`);
  else r.saw("b1", `"${seat}" appeared: roster row ${JSON.stringify(seen.rosterRow)}, Roster lists it ${seen.onRoster}`);
}

/**
 * Post `line` in a workstream's composer, as a person does, and wait for the
 * mailbox's session to keep it. A post (no `@name`) has no delivered state:
 * the composer reads the line back and clears its draft, or shows why not.
 * `stored` is how many `mailbox-post` items in the store carry the line;
 * `said` is what the composer showed.
 */
async function postInWorkstream(world: World, mailbox: string, line: string): Promise<{ stored: number; said: string }> {
  await world.open(`/w/${encodeURIComponent(mailbox)}/stream`);
  await world.page.getByTestId("composer-input").waitFor({ timeout: 15_000 });
  await world.page.getByTestId("composer-input").fill(line);
  await world.page.getByTestId("composer-send").click();
  const kept = async () => (await world.routes.owner.items(mailbox, "component")).filter((i) => (i as { component?: string }).component === "mailbox-post" && (i.data as { body?: string } | undefined)?.body === line).length;
  let stored = 0;
  for (const until = Date.now() + 60_000; Date.now() < until; await sleep(500)) {
    stored = await kept();
    if (stored > 0) break;
  }
  const error = await world.page.getByTestId("composer-error").textContent({ timeout: 1_000 }).catch(() => null);
  const state = (await world.page.getByTestId("composer-status").getAttribute("data-state").catch(() => null)) ?? "unknown";
  return { stored, said: error === null ? `the composer reads ${state}` : `the composer says "${error.trim().slice(0, 200)}"` };
}

/** b1 to b4. `restart` stops and starts the Lab on the same store. */
export async function legB(world: World, mailboxSession: string, boardMailbox: string, restart: (label: string) => Promise<void>, deny: boolean): Promise<void> {
  const r = world.record;
  const seat = `coder-${hex()}`;

  // ---- b1 · hire -----------------------------------------------------------------
  const hire = await askCos(world, "b1", await hireCoder(world, seat));
  if (hire === undefined) {
    r.fail("b1", "no CoS seat: the Chief of Staff view draws no chief of staff to ask");
    return;
  }
  const cosSession = hire.sessionId;
  const hires = callsTo(hire, "hire");
  if (hires.length !== 1 || !hires[0]!.ok) r.fail("b1", `CoS's session holds ${hires.length} hire call(s), ${hires.filter((h) => h.ok).length} ok: ${quote(hire)}`);
  const raised = cosSession === null || hire.requestId === null ? [] : (await asksOf(world.routes.owner, cosSession, hire.requestId)).filter((a) => a.reason === "human_approval");
  if (raised.length > 0) r.fail("b1", `the hire raised ${raised.length} human_approval ask(s)`);
  if (hire.status !== "completed") r.fail("b1", `the hire turn ended ${hire.status}`);
  const hired = await where(world, mailboxSession, seat);
  if (hired.rosterRow === undefined) r.fail("b1", `seat appears: the person's roster has no row for "${seat}"`);
  if (!hired.onRoster) r.fail("b1", `seat appears: Roster doesn't list "${seat}" as the person's own`);
  if (hired.inInventory) r.fail("b1", `"${seat}" is in the organization's seat inventory: a worker the person hires is theirs, not the organization's`);
  r.saw("b1", `CoS: ${quote(hire)}; roster row ${JSON.stringify(hired.rosterRow)}, Roster lists it ${hired.onRoster}, in the org's inventory ${hired.inInventory}`);
  if (hired.rosterRow === undefined || cosSession === null) return;

  // ---- b2 · fire asks ------------------------------------------------------------
  const fire = await askCos(world, "b2", `Please fire the seat "${seat}".`);
  if (fire?.composerSaid !== undefined) r.fail("b2", `the CoS composer told the person "${fire.composerSaid}" for a line its session holds`);
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
  const waiting = await where(world, mailboxSession, seat);
  if (waiting.rosterRow === undefined || !waiting.onRoster) r.fail("b2", `"${seat}" changed before anyone answered: roster row ${waiting.rosterRow !== undefined}, Roster ${waiting.onRoster}`);
  await restart("b2-restart");
  const still = await where(world, mailboxSession, seat);
  if (still.rosterRow === undefined || !still.onRoster) r.fail("b2", `after a restart "${seat}" is roster row ${still.rosterRow !== undefined}, Roster ${still.onRoster}`);
  const inboxAfter = await inboxAsks(world);
  if (ask?.suspensionId !== undefined && !inboxAfter.includes(ask.suspensionId)) r.fail("b2", `after a restart Inbox no longer lists the ask ${ask.suspensionId}`);
  else r.saw("b2", "after a restart the worker is still on the person's roster and the ask still in Inbox");

  // ---- b3 · Approve (or Reject, under deny-fire) ----------------------------------
  if (ask?.suspensionId !== undefined && fire?.requestId != null) {
    const answered = await answerInInbox(world, ask.suspensionId, deny ? "Reject" : "Approve");
    if (!answered.clicked) r.fail("b3", `Inbox draws no card for ${ask.suspensionId} to answer`);
    const settled = await world.routes.owner.settle(await cosFlowOf(world), fire.requestId, 180_000, true);
    r.saw("b3", `${deny ? "Reject" : "Approve"} clicked in Inbox; the fire's turn ended ${settled}`);
    const gone = await where(world, mailboxSession, seat);
    const checkGone = (label: string, g: typeof gone) => {
      if (g.rosterRow !== undefined || g.onRoster) {
        r.fail("b3", `seat gone: ${label} "${seat}" is roster row ${g.rosterRow !== undefined}, Roster ${g.onRoster}`);
        return false;
      }
      return true;
    };
    if (checkGone(`after ${deny ? "Reject" : "Approve"}`, gone)) r.saw("b3", `"${seat}" left the person's roster and Roster`);
    await restart("b3-restart");
    if (checkGone("after a restart", await where(world, mailboxSession, seat))) r.saw("b3", "still gone after a restart");
  } else {
    r.fail("b3", "seat gone: no ask to answer");
  }

  // ---- b4 · no other seat hires ---------------------------------------------------
  const other = `coder-${hex()}`;
  const rosterBefore = (await readWorkers(world.routes.owner)).length;
  const posted = await postInWorkstream(world, boardMailbox, `EM, please hire another coder seat for this team yourself, with the seat id "${other}".`);
  // Only a line the mailbox kept was asked of anyone: an unsent one hires nothing whatever the EM would do.
  if (posted.stored !== 1) {
    r.fail("b4", `the ask was not kept: ${posted.said}; the mailbox's session holds ${posted.stored} copies, so no worker being hired proves nothing`);
    return;
  }
  // The EM answers in its own time; give it the turn a person would wait for.
  await sleep(30_000);
  const after = await where(world, mailboxSession, other);
  if (after.rosterRow !== undefined || after.onRoster || after.inInventory) r.fail("b4", `asked of the EM seat, "${other}" was hired: roster row ${after.rosterRow !== undefined}, Roster ${after.onRoster}, inventory ${after.inInventory}`);
  else r.saw("b4", `the mailbox kept the line once; no worker "${other}" (the person's roster held ${rosterBefore} rows before, ${(await readWorkers(world.routes.owner)).length} after)`);
}
