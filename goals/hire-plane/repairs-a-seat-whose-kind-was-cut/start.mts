/**
 * One start of the app, as its own process. `run.mts` spawns this four times
 * over one SQLite file and grades what each start printed.
 *
 *   tsx start.mts <hire|ask|answer|verify> <state.json>
 *
 * `state.json` carries the fixture, the database file, the control and what
 * earlier starts left for later ones (the pending asks). This process prints
 * one line, `RESULT <json>`, and exits.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { listedSeatRows } from "@flow-state-dev/workforce/browser";
import { openApp, type Fixture } from "./app.mts";

type State = {
  fixture: Fixture;
  dbFile: string;
  control?: string;
  pending?: Array<{ label: string; requestId: string; suspensionId: string }>;
};

const [step, statePath] = process.argv.slice(2) as [string, string];
const state = JSON.parse(readFileSync(statePath, "utf8")) as State;
const { fixture } = state;
const ROSTER = "workforce/roster/";
const SEATS = "inventory/seats/";

const app = await openApp({
  fixture,
  release: step === "hire" ? "before" : "after",
  dbFile: state.dbFile,
  control: state.control,
});
const stores = app.runtime.stores;

/** Every row under a prefix in the org, by its key relative to the prefix. */
async function rows(prefix: string): Promise<Record<string, Record<string, unknown>>> {
  const found = await stores.resourceState.getByPrefix("org", fixture.orgId, prefix);
  return Object.fromEntries(
    Object.entries(found).map(([key, value]) => [key.slice(prefix.length), (value as { state: Record<string, unknown> }).state]),
  );
}

/** The pending suspension a repair request raised. */
async function suspensionOf(requestId: string): Promise<string | undefined> {
  const found = await stores.suspensions.list({ requestId } as never);
  return found.find((s) => s.requestId === requestId && s.status === "pending")?.suspensionId;
}

async function resume(requestId: string, suspensionId: string, action: "approve" | "reject") {
  const posted = await app.call("POST", ["ops", "requests", requestId, "resume"], {
    suspensionId,
    action,
    resumedBy: fixture.userId,
  });
  if (posted.status >= 400) return { status: `http ${posted.status}`, body: posted.json };
  return app.settle("ops", requestId, true);
}

const brokenSeats = async () => {
  const read = await app.answerOf("brokenSeats", {});
  return { error: read.error?.message, entries: (read.output ?? []) as Array<Record<string, unknown>> };
};

const result: Record<string, unknown> = { problems: app.reload.problems };

if (step === "hire") {
  const withSetting = { [fixture.requiredSetting]: fixture.settingValue };
  const hires: Array<[string, string, Record<string, unknown>]> = [
    [fixture.cutSeat, fixture.cutKind, {}],
    [fixture.rehireSeat, fixture.cutKind, {}],
    [fixture.refusedSeat, fixture.keptKind, {}],
    [fixture.healthySeat, fixture.keptKind, withSetting],
    [fixture.firedBeforeSeat, fixture.keptKind, withSetting],
  ];
  const hired: Record<string, string> = {};
  for (const [seatId, flow, settings] of hires) {
    hired[seatId] = (await app.act("ops", "hire", { seatId, flow, settings, instructions: `You are ${seatId}.` })).status;
  }
  // A seat fired before this change, the way that fire left it: its roster row
  // gone, its inventory row still there.
  const key = `${ROSTER}${fixture.firedBeforeSeat}`;
  const stored = await stores.resourceState.get("org", fixture.orgId, key);
  if (stored !== undefined) await stores.resourceState.delete("org", fixture.orgId, key, stored.version);
  Object.assign(result, { hired, roster: Object.keys(await rows(ROSTER)), inventory: Object.keys(await rows(SEATS)) });
}

if (step === "ask") {
  result.read = await brokenSeats();

  // Deny: the row must not move.
  const before = (await rows(ROSTER))[fixture.cutSeat];
  const denied = await app.act("ops", "repair", { op: "retire", seatId: fixture.cutSeat });
  const deniedSuspension = await suspensionOf(denied.requestId);
  const deny = deniedSuspension === undefined ? { status: "no pending ask" } : await resume(denied.requestId, deniedSuspension, "reject");
  result.deny = {
    raised: denied.status,
    answered: deny.status,
    rowUnchanged: JSON.stringify((await rows(ROSTER))[fixture.cutSeat]) === JSON.stringify(before),
    stillListed: (await brokenSeats()).entries.some((entry) => entry.seatId === fixture.cutSeat),
  };

  // The asks a person answers after a restart.
  const asks: Array<[string, Record<string, unknown>]> = [
    ["retire", { op: "retire", seatId: fixture.cutSeat }],
    ["rehire", { op: "rehire", seatId: fixture.rehireSeat, flow: fixture.keptKind, settings: { [fixture.requiredSetting]: fixture.settingValue } }],
    ["refused", { op: "rehire", seatId: fixture.refusedSeat, flow: fixture.keptKind, settings: { [fixture.requiredSetting]: fixture.settingValue } }],
  ];
  const pending: NonNullable<State["pending"]> = [];
  const raised: Record<string, string> = {};
  for (const [label, input] of asks) {
    const asked = await app.act("ops", "repair", input);
    raised[label] = asked.status;
    const suspensionId = await suspensionOf(asked.requestId);
    if (suspensionId !== undefined) pending.push({ label, requestId: asked.requestId, suspensionId });
  }
  result.raised = raised;
  writeFileSync(statePath, JSON.stringify({ ...state, pending }));
}

if (step === "answer") {
  const answered: Record<string, string> = {};
  for (const ask of state.pending ?? []) {
    answered[ask.label] = (await resume(ask.requestId, ask.suspensionId, "approve")).status;
  }
  result.answered = answered;
}

if (step === "verify") {
  const inventory = await rows(SEATS);
  const roster = await rows(ROSTER);
  const teamList = listedSeatRows(
    fixture.orgId,
    Object.values(inventory) as Array<{ id: string; kind: string }>,
    Object.values(roster).map((row) => ({
      seatId: String(row.seatId),
      incarnation: typeof row.incarnation === "string" ? row.incarnation : null,
    })),
  );
  const answers: Record<string, { status: string; kind: string | undefined }> = {};
  for (const seatId of [fixture.healthySeat, fixture.rehireSeat, fixture.refusedSeat]) {
    const address = `${fixture.orgId}.${seatId}`;
    const ran = await app.act(address, "answer", { tag: fixture.marker });
    answers[seatId] = { status: ran.status, kind: app.runtime.registry.get(address)?.kind };
  }
  Object.assign(result, {
    read: await brokenSeats(),
    teamList: teamList.map((row) => row.id),
    inventory: Object.keys(inventory),
    roster: Object.keys(roster),
    answers,
  });
}

process.stdout.write(`RESULT ${JSON.stringify(result)}\n`);
process.exit(0);
