/**
 * Leg c: a release cut the kind a hired seat ran on. The chief of staff names
 * the seat that no longer starts, retires it on the person's Approve, and the
 * next start names nothing.
 *
 * Steps c1 to c4 (PLAN.md → Checks), over one store and three boots: boot 1
 * on the `extra-kind` patch (one more kind, `kind`, that the shipped Lab
 * doesn't carry), boots 2 and 3 as `shipped` (the commit as it is, or the
 * control's own patch without the extra kind).
 */
import { answerInInbox, askCos, asksOf, callsTo, quote, readInventory, readRoster, teamsSeats, type World } from "../steps.mts";

export async function legC(
  world: World,
  channelSession: string,
  opts: { seat: string; kind: string; patchedConfig: string; shippedConfig: string },
): Promise<void> {
  const r = world.record;
  const { seat, kind } = opts;
  const rowOf = (rows: Array<Record<string, any>>) => rows.find((x) => typeof x.id === "string" && (x.id === seat || (x.id as string).endsWith(`.${seat}`)));

  // ---- c1 · boot 1, extra-kind ----------------------------------------------------
  await world.boot("c-boot-1", opts.patchedConfig);
  let cosSession: string | null = null;
  try {
    const hire = await askCos(world, "c1", `Please hire a seat with the seat id "${seat}" on the "${kind}" kind. It needs no settings.`);
    if (hire === undefined) {
      r.fail("c1", "no CoS seat: the Chief of Staff view draws no chief of staff to ask");
      return;
    }
    cosSession = hire.sessionId;
    const hires = callsTo(hire, "hire");
    if (hires.length !== 1 || !hires[0]!.ok) r.fail("c1", `CoS's session holds ${hires.length} hire call(s), ${hires.filter((h) => h.ok).length} ok: ${quote(hire)}`);
    const teams = await teamsSeats(world);
    const row = rowOf(await readInventory(world.routes.owner, channelSession));
    if (row === undefined || !teams.includes(String(row.id))) r.fail("c1", `TEAMS doesn't list "${seat}" (inventory row ${String(row?.id)}, TEAMS [${teams.join(", ")}])`);
    else if (row.kind !== kind) r.fail("c1", `"${seat}" was hired on ${row.kind}, not ${kind}`);
    else r.saw("c1", `CoS: ${quote(hire)}; TEAMS lists ${row.id} on ${row.kind}`);
  } finally {
    await world.stop();
  }
  if (r.verdict("c1") === "FAIL" || cosSession === null) return;

  // ---- c2 · boot 2, as shipped ----------------------------------------------------
  await world.boot("c-boot-2", opts.shippedConfig);
  try {
    const problems = world.record.boots.at(-1)!.problems;
    if (!problems.some((p) => p.includes(seat))) r.fail("c2", `the boot's problems don't name "${seat}": [${problems.join(" | ")}]`);
    else r.saw("c2", `boot 2 named: ${problems.join(" | ")}`);
    const rosterBefore = rowOf(((await readRoster(world.routes.owner, cosSession)) ?? []).map((x) => ({ ...x, id: x.seatId })));
    const asked = await askCos(world, "c2", "Which of our hired seats won't start any more, and why?");
    const reads = callsTo(asked, "brokenSeats");
    const listed = reads.some((t) => t.ok && t.output.includes(seat) && t.output.includes("kind-gone"));
    if (!listed) r.fail("c2", `CoS's brokenSeats result doesn't list "${seat}" with kind-gone: ${quote(asked)}; outputs ${reads.map((t) => t.output).join(" | ")}`);
    if (asked === undefined || !asked.onScreen || !asked.reply.includes(seat)) r.fail("c2", `the answer on screen doesn't name "${seat}": ${quote(asked)} (drawn ${asked?.onScreen})`);
    const rosterAfter = rowOf(((await readRoster(world.routes.owner, cosSession)) ?? []).map((x) => ({ ...x, id: x.seatId })));
    if (rosterBefore === undefined || JSON.stringify(rosterBefore) !== JSON.stringify(rosterAfter)) r.fail("c2", `"${seat}"'s roster row changed while CoS read it: ${JSON.stringify(rosterBefore)} → ${JSON.stringify(rosterAfter)}`);
    if (listed) r.saw("c2", `CoS: ${quote(asked)}`);

    // ---- c3 · retire, on Approve ---------------------------------------------------
    const retire = await askCos(world, "c3", `Please retire the seat "${seat}".`);
    if (retire === undefined || retire.requestId === null || retire.sessionId === null) {
      r.fail("c3", `the retire was not asked: ${quote(retire)}`);
    } else {
      const asks = (await asksOf(world.routes.owner, retire.sessionId, retire.requestId)).filter((a) => a.reason === "human_approval");
      if (retire.status !== "suspended" || asks.length !== 1) r.fail("c3", `the retire turn ended ${retire.status} with ${asks.length} human_approval ask(s): ${quote(retire)}`);
      else {
        const answered = await answerInInbox(world, asks[0]!.suspensionId!, "Approve");
        if (!answered.clicked) r.fail("c3", `Inbox draws no card for ${asks[0]!.suspensionId}`);
        const settled = await world.routes.owner.settle("chief-of-staff", retire.requestId, 180_000, true);
        r.saw("c3", `Inbox card "${answered.card.slice(0, 160)}"; Approve; the turn ended ${settled}`);
      }
    }
  } finally {
    await world.stop();
  }

  // ---- c4 · boot 3 ------------------------------------------------------------------
  await world.boot("c-boot-3", opts.shippedConfig);
  try {
    const problems = world.record.boots.at(-1)!.problems;
    if (problems.length > 0) r.fail("c4", `boot 3 names problems: ${problems.join(" | ")}`);
    const teams = await teamsSeats(world);
    if (teams.some((t) => t === seat || t.endsWith(`.${seat}`))) r.fail("c4", `TEAMS still lists "${seat}"`);
    const inv = rowOf(await readInventory(world.routes.owner, channelSession));
    const ros = rowOf(((await readRoster(world.routes.owner, cosSession)) ?? []).map((x) => ({ ...x, id: x.seatId })));
    if (inv !== undefined || ros !== undefined) r.fail("c4", `"${seat}" still has ${inv !== undefined ? "an inventory row" : ""} ${ros !== undefined ? "a roster row" : ""}`);
    if (r.verdict("c4") !== "FAIL") r.saw("c4", `boot 3 named no problem; TEAMS [${teams.join(", ")}]; no inventory or roster row for "${seat}"`);
    await r.shot(world.page, "c4");
  } finally {
    await world.stop();
  }
}
