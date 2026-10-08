/**
 * Leg c: a release cut the flow one of the person's workers ran on. The
 * worker's turn is refused, naming the flow, while its row stays for the
 * person to clear; the chief of staff fires it on the person's Approve, and
 * it is gone after a restart.
 *
 * Steps c1 to c4 (PLAN.md → Checks), over one store and three boots: boot 1
 * on the `extra-flow` patch (one more worker flow, `flow`, that the shipped
 * Lab doesn't carry), boots 2 and 3 as `shipped` (the commit as it is, or the
 * control's own patch without the extra flow).
 *
 * Shift Manager draws no conversation with a person's own worker, so the
 * worker's turn is sent as the person over the Lab's routes, the way an app
 * opens a session with a worker: on the flow its roster row names, naming it.
 * A refused turn changes nothing; every change still goes through the chief
 * of staff or Inbox.
 */
import { EXTRA_FLOW_DOOR } from "../controls/patches.mts";
import { answerInInbox, askCos, asksOf, callsTo, cosFlowOf, quote, readWorkers, rosterOwn, type World } from "../steps.mts";

export async function legC(world: World, opts: { worker: string; flow: string; patchedConfig: string; shippedConfig: string }): Promise<void> {
  const r = world.record;
  const { worker, flow } = opts;
  // The Lab's routes as the person, on the boot serving now: each boot serves on its own address.
  const owner = () => world.routes.owner;
  const rowOf = async () => (await readWorkers(owner())).find((x) => x.id === worker);
  const line = "Who are you, and which flow do you run on?";

  // ---- c1 · boot 1, extra-flow ----------------------------------------------------
  await world.boot("c-boot-1", opts.patchedConfig);
  let talk: string | undefined;
  try {
    const hire = await askCos(world, "c1", `Please hire a worker with the id "${worker}" on the "${flow}" flow. It needs no settings.`);
    if (hire === undefined) {
      r.fail("c1", "no CoS seat: the Chief of Staff view draws no chief of staff to ask");
      return;
    }
    const hires = callsTo(hire, "hire");
    if (hires.length !== 1 || !hires[0]!.ok) r.fail("c1", `CoS's session holds ${hires.length} hire call(s), ${hires.filter((h) => h.ok).length} ok: ${quote(hire)}`);
    const row = await rowOf();
    const drawn = (await rosterOwn(world)).find((x) => x.id === worker);
    if (row === undefined) r.fail("c1", `the person's roster has no row for "${worker}": ${quote(hire)}`);
    else if (row.flow !== flow) r.fail("c1", `"${worker}" was hired on "${row.flow}", not "${flow}"`);
    if (drawn === undefined) r.fail("c1", `Roster doesn't list "${worker}" as the person's own`);
    else if (!drawn.text.includes(flow)) r.fail("c1", `Roster lists "${worker}" as "${drawn.text}", not on "${flow}"`);
    if (row === undefined || row.flow !== flow) return;
    // The person's session with the worker, on the flow its row names, and one turn in it: it runs while the flow exists.
    const opened = await owner().call("POST", `/${encodeURIComponent(row.flow)}/sessions`, { userId: owner().user.userId, state: { workerId: worker } });
    if (opened.status !== 201) {
      r.fail("c1", `a session with "${worker}" on "${row.flow}" was refused: ${opened.status} ${JSON.stringify(opened.body)}`);
      return;
    }
    talk = String(opened.body.session.id);
    const ran = await owner().act(row.flow, talk, EXTRA_FLOW_DOOR, { message: line });
    if (ran.status !== "completed" || ran.output?.worker !== worker || ran.output?.flow !== flow) {
      r.fail("c1", `the turn with "${worker}" on boot 1 ended ${ran.status}: ${JSON.stringify(ran.output ?? ran.error)}`);
    }
    if (r.verdict("c1") !== "FAIL") r.saw("c1", `CoS: ${quote(hire)}; roster row ${JSON.stringify(row)}; Roster lists "${drawn?.text}"; session ${talk} on "${row.flow}" ran a turn as ${JSON.stringify(ran.output)}`);
  } finally {
    await world.stop();
  }
  if (r.verdict("c1") === "FAIL" || talk === undefined) return;

  // ---- c2 · boot 2, as shipped: the worker's turn is refused, naming the flow ---------
  await world.boot("c-boot-2", opts.shippedConfig);
  try {
    const before = await rowOf();
    const refused = await owner().call("POST", `/${encodeURIComponent(flow)}/${encodeURIComponent(talk)}/actions/${EXTRA_FLOW_DOOR}`, { userId: owner().user.userId, input: { message: line } });
    const error = String(refused.body?.error ?? "");
    if (refused.status < 400) r.fail("c2", `the turn with "${worker}" ran on boot 2 (${refused.status} ${JSON.stringify(refused.body).slice(0, 300)}): the flow was not cut, or the turn doesn't need it`);
    else if (!error.includes(`"${flow}"`)) r.fail("c2", `the turn was refused (${refused.status}) without naming "${flow}": ${JSON.stringify(refused.body)}`);
    const after = await rowOf();
    if (before === undefined || JSON.stringify(before) !== JSON.stringify(after)) r.fail("c2", `"${worker}"'s roster row changed across the refused turn: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    const drawn = (await rosterOwn(world)).find((x) => x.id === worker);
    if (drawn === undefined) r.fail("c2", `Roster no longer lists "${worker}", so the person can't see what to clear`);
    if (r.verdict("c2") !== "FAIL") r.saw("c2", `the turn in ${talk} was refused: ${refused.status} ${error}; the row is unchanged (${JSON.stringify(after)}) and Roster still lists "${drawn?.text}"`);

    // ---- c3 · fire, on Approve ------------------------------------------------------
    const fire = await askCos(world, "c3", `Please fire the worker "${worker}".`);
    if (fire?.composerSaid !== undefined) r.fail("c3", `the CoS composer told the person "${fire.composerSaid}" for a line its session holds`);
    if (fire === undefined || fire.requestId === null || fire.sessionId === null) {
      r.fail("c3", `the fire was not asked: ${quote(fire)}`);
    } else {
      const asks = (await asksOf(owner(), fire.sessionId, fire.requestId)).filter((a) => a.reason === "human_approval");
      const named = (asks[0]?.data as { worker?: string } | undefined)?.worker;
      if (fire.status !== "suspended" || asks.length !== 1) r.fail("c3", `the fire turn ended ${fire.status} with ${asks.length} human_approval ask(s): ${quote(fire)}`);
      else if (named !== worker || !/fire/i.test(asks[0]!.message ?? "")) r.fail("c3", `the ask says "${asks[0]!.message}" naming ${JSON.stringify(asks[0]!.data)}, not a fire of "${worker}"`);
      else {
        const answered = await answerInInbox(world, asks[0]!.suspensionId!, "Approve");
        if (!answered.clicked) r.fail("c3", `Inbox draws no card for ${asks[0]!.suspensionId}`);
        const settled = await owner().settle(await cosFlowOf(world), fire.requestId, 180_000, true);
        r.saw("c3", `Inbox card "${answered.card.slice(0, 160)}"; Approve; the turn ended ${settled}`);
      }
    }
  } finally {
    await world.stop();
  }

  // ---- c4 · boot 3: still gone --------------------------------------------------------
  await world.boot("c-boot-3", opts.shippedConfig);
  try {
    const row = await rowOf();
    const drawn = (await rosterOwn(world)).find((x) => x.id === worker);
    if (row !== undefined) r.fail("c4", `the person's roster still has a row for "${worker}": ${JSON.stringify(row)}`);
    if (drawn !== undefined) r.fail("c4", `Roster still lists "${worker}"`);
    if (r.verdict("c4") !== "FAIL") r.saw("c4", `after a restart the person's roster has no row for "${worker}", and Roster doesn't list it`);
    await r.shot(world.page, "c4");
  } finally {
    await world.stop();
  }
}
