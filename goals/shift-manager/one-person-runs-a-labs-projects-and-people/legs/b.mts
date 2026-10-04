/**
 * Leg b: the person changes who works in the Lab through the chief of staff.
 * A hire lands at once; a fire waits for the person's Approve in Inbox, holds
 * across a restart while it waits, and lands only on Approve; a team seat
 * asked to hire doesn't.
 *
 * Steps b1 to b4 (PLAN.md → Checks). Runs on leg a's store and server, after
 * leg a. Under the `deny-fire` control, b3 clicks Reject.
 */
import {
  answerInInbox,
  askCos,
  asksOf,
  callsTo,
  hex,
  inboxAsks,
  quote,
  readInventory,
  readRoster,
  sleep,
  teamsSeats,
  visible,
  type World,
} from "../steps.mts";
import type { StoredItem } from "../../../lib/shift-manager.mts";

const hiredAs = (rows: Array<Record<string, any>>, seat: string) => rows.find((r) => typeof r.id === "string" && (r.id === seat || (r.id as string).endsWith(`.${seat}`)));

/** What the seat looks like in each place it can be read. */
async function where(world: World, mailboxSession: string, cosSession: string | null, seat: string) {
  const inventory = await readInventory(world.routes.owner, mailboxSession);
  const roster = await readRoster(world.routes.owner, cosSession);
  const row = hiredAs(inventory, seat);
  const teams = await teamsSeats(world);
  return {
    inventoryRow: row,
    rosterRow: roster?.find((x) => x.seatId === seat),
    rosterReadable: roster !== undefined,
    inTeams: row !== undefined ? teams.includes(String(row.id)) : teams.some((t) => t === seat || t.endsWith(`.${seat}`)),
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
  await postInWorkstream(world, boardMailbox, `Please hire one more coder for the team, with the seat id "${seat}".`);
  await sleep(20_000);
  const seen = await where(world, mailboxSession, null, seat);
  if (seen.inventoryRow === undefined && !seen.inTeams) r.fail("b1", `seat appears: asked of the EM seat with no chief of staff, no seat "${seat}" is in the inventory or TEAMS`);
  else r.saw("b1", `"${seat}" appeared: inventory ${String(seen.inventoryRow?.id)}, TEAMS ${seen.inTeams}`);
}

async function postInWorkstream(world: World, mailbox: string, line: string): Promise<string> {
  await world.open(`/w/${encodeURIComponent(mailbox)}/stream`);
  await world.page.getByTestId("composer-input").waitFor({ timeout: 15_000 });
  await world.page.getByTestId("composer-input").fill(line);
  await world.page.getByTestId("composer-send").click();
  let state = "";
  for (const until = Date.now() + 60_000; Date.now() < until; await sleep(200)) {
    state = (await world.page.getByTestId("composer-status").getAttribute("data-state").catch(() => "")) ?? "";
    if (["delivered", "refused", "not-sent", "unconfirmed", "blocked"].includes(state)) break;
  }
  return state;
}

/** b1 to b4. `restart` stops and starts the Lab on the same store. */
export async function legB(world: World, mailboxSession: string, boardMailbox: string, restart: (label: string) => Promise<void>, deny: boolean): Promise<void> {
  const r = world.record;
  const seat = `coder-${hex()}`;

  // ---- b1 · hire -----------------------------------------------------------------
  const hire = await askCos(world, "b1", `Please hire one more coder for the team, with the seat id "${seat}".`);
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
  const hired = await where(world, mailboxSession, cosSession, seat);
  if (hired.inventoryRow === undefined) r.fail("b1", `seat appears: no inventory row for "${seat}"`);
  if (hired.rosterRow === undefined) r.fail("b1", `seat appears: no roster row for "${seat}"${hired.rosterReadable ? "" : " (no session reads the roster)"}`);
  if (!hired.inTeams) r.fail("b1", `seat appears: TEAMS doesn't list "${seat}"`);
  const address = hired.inventoryRow === undefined ? undefined : String(hired.inventoryRow.id);
  const kind = hired.inventoryRow?.kind as string | undefined;
  r.saw("b1", `CoS: ${quote(hire)}; inventory ${address} kind ${kind}, roster row ${hired.rosterRow === undefined ? "none" : `flow ${hired.rosterRow.flow}`}, TEAMS lists it ${hired.inTeams}`);
  if (address === undefined || cosSession === null) return;

  // ---- b2 · fire asks ------------------------------------------------------------
  const fire = await askCos(world, "b2", `Please fire the seat "${seat}".`);
  if (fire?.composerSaid !== undefined) r.fail("b2", `the CoS composer told the person "${fire.composerSaid}" for a line its session holds`);
  let ask: StoredItem | undefined;
  if (fire === undefined || fire.requestId === null || fire.sessionId === null) {
    r.fail("b2", `the fire was not asked: ${quote(fire)}`);
  } else {
    const asks = (await asksOf(world.routes.owner, fire.sessionId, fire.requestId)).filter((a) => a.reason === "human_approval");
    ask = asks[0];
    const data = ask?.data as { verb?: string; seatId?: string; kind?: string } | undefined;
    if (fire.status !== "suspended" || asks.length !== 1) r.fail("b2", `the fire turn ended ${fire.status} with ${asks.length} human_approval ask(s): ${quote(fire)}`);
    else if (data?.verb !== "fire" || data?.seatId !== seat || data?.kind !== kind) r.fail("b2", `the ask names ${JSON.stringify(data)}, not fire "${seat}" of kind ${kind}`);
    const inbox = await inboxAsks(world);
    if (ask?.suspensionId === undefined || !inbox.includes(ask.suspensionId)) r.fail("b2", `Inbox doesn't list the ask ${ask?.suspensionId} (lists [${inbox.join(", ")}])`);
    else {
      await world.open(`/inbox/${encodeURIComponent(ask.suspensionId)}`);
      const card = world.page.locator(`[data-testid=ask-card][data-suspension-id="${ask.suspensionId}"]`);
      const text = (await card.textContent({ timeout: 15_000 }).catch(() => "")) ?? "";
      if (!text.includes(seat)) r.fail("b2", `Inbox's card doesn't name "${seat}": "${text.slice(0, 200)}"`);
      await r.shot(world.page, "b2-inbox");
      r.saw("b2", `Inbox card: "${text.replace(/\s+/g, " ").slice(0, 200)}"; stored ask ${JSON.stringify(data)}`);
    }
  }
  const waiting = await where(world, mailboxSession, cosSession, seat);
  if (waiting.inventoryRow === undefined || waiting.rosterRow === undefined || !waiting.inTeams) r.fail("b2", `"${seat}" changed before anyone answered: inventory ${waiting.inventoryRow !== undefined}, roster ${waiting.rosterRow !== undefined}, TEAMS ${waiting.inTeams}`);
  await restart("b2-restart");
  const still = await where(world, mailboxSession, cosSession, seat);
  if (still.inventoryRow === undefined || still.rosterRow === undefined || !still.inTeams) r.fail("b2", `after a restart "${seat}" is inventory ${still.inventoryRow !== undefined}, roster ${still.rosterRow !== undefined}, TEAMS ${still.inTeams}`);
  const inboxAfter = await inboxAsks(world);
  if (ask?.suspensionId !== undefined && !inboxAfter.includes(ask.suspensionId)) r.fail("b2", `after a restart Inbox no longer lists the ask ${ask.suspensionId}`);
  else r.saw("b2", "after a restart the seat is still listed and the ask still in Inbox");

  // ---- b3 · Approve (or Reject, under deny-fire) ----------------------------------
  if (ask?.suspensionId !== undefined && fire?.requestId != null) {
    const answered = await answerInInbox(world, ask.suspensionId, deny ? "Reject" : "Approve");
    if (!answered.clicked) r.fail("b3", `Inbox draws no card for ${ask.suspensionId} to answer`);
    const settled = await world.routes.owner.settle("chief-of-staff", fire.requestId, 180_000, true);
    r.saw("b3", `${deny ? "Reject" : "Approve"} clicked in Inbox; the fire's turn ended ${settled}`);
    const gone = await where(world, mailboxSession, cosSession, seat);
    const checkGone = (label: string, g: typeof gone) => {
      if (g.inventoryRow !== undefined || g.rosterRow !== undefined || g.inTeams) {
        r.fail("b3", `seat gone: ${label} "${seat}" is inventory ${g.inventoryRow !== undefined}, roster ${g.rosterRow !== undefined}, TEAMS ${g.inTeams}`);
        return false;
      }
      return true;
    };
    if (checkGone(`after ${deny ? "Reject" : "Approve"}`, gone)) r.saw("b3", `"${seat}" left TEAMS, the inventory and the roster`);
    await restart("b3-restart");
    if (checkGone("after a restart", await where(world, mailboxSession, cosSession, seat))) r.saw("b3", "still gone after a restart");
  } else {
    r.fail("b3", "seat gone: no ask to answer");
  }

  // ---- b4 · no other seat hires ---------------------------------------------------
  const other = `coder-${hex()}`;
  const rosterBefore = (await readRoster(world.routes.owner, cosSession))?.length;
  const delivered = await postInWorkstream(world, boardMailbox, `EM, please hire another coder seat for this team yourself, with the seat id "${other}".`);
  // The EM answers in its own time; give it the turn a person would wait for.
  await sleep(30_000);
  const after = await where(world, mailboxSession, cosSession, other);
  if (after.rosterRow !== undefined || after.inventoryRow !== undefined || after.inTeams) r.fail("b4", `asked of the EM seat, "${other}" was hired: roster ${after.rosterRow !== undefined}, inventory ${after.inventoryRow !== undefined}`);
  else r.saw("b4", `the line went ${delivered}; no roster row for "${other}" (roster ${rosterBefore} rows before, ${(await readRoster(world.routes.owner, cosSession))?.length} after)`);
}
