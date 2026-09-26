/**
 * Goal check — a team hired while the app runs is still there after a redeploy.
 *
 * Six legs, over the real HTTP route against the **Next-built** app, restarted
 * from the same build between them. The restart is the whole point: a roster
 * that only lives in the process that hired it passes every in-process test
 * ever written and fails the one thing this issue exists to deliver.
 *
 *   0  the CONTROL, asserted before anything else. The file-declared
 *      `support.ada` answers, and keeps answering across every restart below.
 *      A failure here means the probe is blind — the app is not serving, or the
 *      store was wiped — not that durability broke. Without it, a zero on any
 *      other leg means nothing.
 *
 *   1  HIRE two seats. One good, one naming a kind the app does not carry. The
 *      good one answers; the bad one is refused and leaves no address behind.
 *
 *   2  HIRE a third carrying a token GENERATED AT CHECK TIME, then restart.
 *
 *   3  the DURABILITY leg. The token seat answers after the restart and its
 *      answer carries THAT token — read from what this check sent, never
 *      written into the check. A seat answering from a file-declared default,
 *      or from a kind's own default, has no way to produce it.
 *
 *   4  the DEGRADE leg. A stored row is edited on disk to name a kind the code
 *      does not carry — which is what a real one looks like once a kind is
 *      deleted from the source. After a restart the app SERVES, the other
 *      seats answer, that one address 404s, and the boot named it.
 *
 *   5  the FIRE leg. Firing the token seat and restarting leaves a 404, and the
 *      seat does not come back — so the removal was durable, not in-process.
 *
 * Persistence is the filesystem store profile (`STORE_TYPE=filesystem`), which
 * is what makes "the same store across two processes" true without a database.
 * The store directory is removed before the run, so a stale roster from an
 * earlier run can never be what passes leg 3.
 *
 * Run: pnpm tsx goals/workforce-conventions/durable-hire-survives-redeploy/run.mts
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { KITCHEN_SINK, loadFixture, runGoal } from "../../lib/index.mts";

interface Fixture {
  userId: string;
  note: string;
  port: number;
  org: string;
  otherOrg: string;
  controlSeat: string;
  controlDesk: string;
  goodSeat: string;
  missingKindSeat: string;
  tokenSeat: string;
  kind: string;
  missingKind: string;
}

const fixture = loadFixture<Fixture>(import.meta.url);
const ORIGIN = `http://127.0.0.1:${fixture.port}`;
const DATA_DIR = join(KITCHEN_SINK, ".fsdev", "data");

/** The admin credentials this run configures — two orgs, so "which org" has a wrong answer to give. */
const ADMIN_TOKEN = `tok-${randomUUID()}`;
const OTHER_TOKEN = `tok-${randomUUID()}`;
const ADMIN_TOKENS = `${fixture.org}:${ADMIN_TOKEN},${fixture.otherOrg}:${OTHER_TOKEN}`;

const SERVER_ENV = {
  ...process.env,
  PORT: String(fixture.port),
  FSD_ENV: "dev",
  STORE_TYPE: "filesystem",
  WORKFORCE_ADMIN_TOKENS: ADMIN_TOKENS,
  // The clerk's answer calls a model: the scripted one, keyless. The goal
  // grades the desk tag the kind writes from the seat's settings, not the
  // model's words.
  KITCHEN_SINK_TEST_MODE: "1",
};

/**
 * A runtime-hired seat's address. Only these carry the organization.
 *
 * A FILE-declared seat does not: `hireKitchenSinkWorkforce` mints it under the
 * id its folders spell (`support.ada`), with no org segment, because a file is
 * not hired into an organization. The control below therefore addresses the
 * bare id — using this helper for it is what made the first run of this check
 * report a blind probe, which is the control working rather than failing.
 */
const address = (seat: string): string => `${fixture.org}.${seat}`;

// ---------------------------------------------------------------------------
// The server, and the two predicates that must not be shared
// ---------------------------------------------------------------------------

/**
 * The flow index's status, or `undefined` when nothing answered.
 *
 * Refusing to start wants ANY answer: something holding the port is a reason to
 * stop. Readiness wants a 200 specifically — a process answering 4xx/5xx is
 * listening but not serving, and grading it is how a run passes against a
 * server it did not build.
 */
async function flowIndexStatus(): Promise<number | undefined> {
  try {
    return (await fetch(`${ORIGIN}/api/flows`)).status;
  } catch {
    return undefined;
  }
}

let server: ChildProcess | undefined;
/** Everything the running server has written to stderr since it started. */
let serverLog = "";

async function startServer(): Promise<void> {
  if ((await flowIndexStatus()) !== undefined) {
    throw new Error(
      `something is already answering on ${ORIGIN}; stop it first, or this check would grade it ` +
        `instead of the build it just made`
    );
  }
  serverLog = "";
  // Detached, so the kill below reaches the whole group: `pnpm start` execs
  // `next start` as a child, and signalling only the shim leaves the server up
  // for the next leg to grade.
  server = spawn("pnpm", ["start"], {
    cwd: KITCHEN_SINK,
    env: SERVER_ENV,
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  server.stdout?.on("data", (chunk: Buffer) => { serverLog += chunk.toString(); });
  server.stderr?.on("data", (chunk: Buffer) => { serverLog += chunk.toString(); });

  let last: number | undefined;
  for (let i = 0; i < 180; i += 1) {
    last = await flowIndexStatus();
    if (last === 200) return;
    if (server.exitCode !== null) {
      throw new Error(
        `the app exited with code ${server.exitCode} before it served ${ORIGIN}/api/flows:\n${serverLog}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(
    `the built app never served ${ORIGIN}/api/flows — ` +
      (last === undefined ? "nothing answered" : `the last answer was ${last}`) +
      `\n${serverLog}`
  );
}

async function stopServer(): Promise<string> {
  const log = serverLog;
  if (server?.pid !== undefined) {
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // already gone
    }
  }
  server = undefined;
  // Wait for the port to actually free, or the next start refuses on its own
  // guard and the failure reads as "something else is listening".
  for (let i = 0; i < 60; i += 1) {
    if ((await flowIndexStatus()) === undefined) return log;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`the app kept answering on ${ORIGIN} after SIGTERM`);
}

async function restart(): Promise<string> {
  const log = await stopServer();
  await startServer();
  return log;
}

// ---------------------------------------------------------------------------
// The app's surfaces
// ---------------------------------------------------------------------------

interface AdminResult {
  status: number;
  body: string;
}

async function admin(action: "hire" | "fire", input: unknown, token = ADMIN_TOKEN): Promise<AdminResult> {
  const res = await fetch(`${ORIGIN}/api/flows/workforce-admin/actions/${action}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId: fixture.userId, input }),
  });
  return { status: res.status, body: await res.text() };
}

/**
 * Run a seat's `answer` action and return the text it put on the wire, or
 * `undefined` when the address does not resolve.
 *
 * Read off the inline SSE stream an `Accept: text/event-stream` POST returns —
 * the same stream a browser client reads, so nothing here is a back channel.
 */
async function answerOf(seatAddress: string): Promise<string | undefined> {
  const created = await fetch(`${ORIGIN}/api/flows/${seatAddress}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: fixture.userId, orgId: fixture.org }),
  });
  if (created.status === 404) return undefined;
  if (!created.ok) throw new Error(`${seatAddress}: creating a session returned ${created.status}`);
  const sessionId = ((await created.json()) as { session: { id: string } }).session.id;

  const res = await fetch(`${ORIGIN}/api/flows/${seatAddress}/${sessionId}/actions/answer`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify({ userId: fixture.userId, orgId: fixture.org, input: { note: fixture.note } }),
  });
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`${seatAddress}: its answer action returned ${res.status}`);

  let said = "";
  for (const line of (await res.text()).split("\n")) {
    if (!line.startsWith("data: ")) continue;
    const event = JSON.parse(line.slice(6)) as {
      type: string;
      item?: { type: string; content?: { text?: string }[] };
    };
    if (event.type !== "item.done" || event.item?.type !== "message") continue;
    said = event.item.content?.map((part) => part.text ?? "").join("") ?? "";
  }
  return said;
}

/** Whether an address resolves at all — a 404 on session create is the miss. */
async function resolves(seatAddress: string): Promise<boolean> {
  const created = await fetch(`${ORIGIN}/api/flows/${seatAddress}/sessions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: fixture.userId, orgId: fixture.org }),
  });
  return created.status !== 404;
}

// ---------------------------------------------------------------------------
// The store, reached directly — leg 4 needs a row no API would write
// ---------------------------------------------------------------------------

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

/**
 * The on-disk leaf holding one seat's roster row.
 *
 * Found by walking and then reading each candidate's `seatId`, rather than by
 * rebuilding the store's path scheme. Two reasons, and the second was found by
 * this check failing rather than reasoned out in advance: the scheme is the
 * store's business, and it **percent-encodes the dot** — `support.bo` is filed
 * as `support%2Ebo.json`, so matching the seat id against the path finds
 * nothing while the row is sitting right there.
 */
function rosterFileFor(seatId: string): string {
  const matches = walk(DATA_DIR)
    .filter((path) => path.includes(join("workforce", "roster")) && path.endsWith(".json"))
    .filter((path) => {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
        return Array.isArray(raw) && (raw[3] as { seatId?: string } | undefined)?.seatId === seatId;
      } catch {
        return false;
      }
    });
  if (matches.length !== 1) {
    throw new Error(
      `expected exactly one stored roster row for "${seatId}" under ${DATA_DIR}, found ${matches.length}` +
        (matches.length > 0 ? `:\n  ${matches.join("\n  ")}` : "")
    );
  }
  return matches[0]!;
}

/**
 * Rewrite a stored row's `flow` to a kind the code does not carry.
 *
 * This is what a real bad row looks like: it was written by a past runtime
 * against code that has since moved. Fabricating a row from nothing would test
 * the parser; editing one the app itself wrote tests the thing that actually
 * happens.
 */
function breakStoredKind(seatId: string): void {
  const path = rosterFileFor(seatId);
  const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error(`the stored row at ${path} is not this store's envelope: ${typeof raw}`);
  }
  const state = raw[3] as Record<string, unknown>;
  state.flow = fixture.missingKind;
  writeFileSync(path, JSON.stringify(raw));
}

// ---------------------------------------------------------------------------

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const token = `desk-${randomUUID()}`;

  // A run must never inherit a roster. Otherwise leg 3 could pass against a
  // seat an earlier run hired, which is the one false green that would look
  // exactly like success.
  rmSync(DATA_DIR, { recursive: true, force: true });

  // Built here rather than assumed, so the check cannot grade a `.next` a
  // previous branch left behind.
  execFileSync("pnpm", ["build"], { cwd: KITCHEN_SINK, stdio: "inherit" });

  try {
    await startServer();

    // ---- (0) the control, before anything else -----------------------------
    const controlFirst = await answerOf(fixture.controlSeat);
    if (controlFirst === undefined || !controlFirst.includes(fixture.controlDesk)) {
      // Nothing below can mean anything if the app is not serving its
      // file-declared team, so this is reported on its own.
      return {
        failures: [
          `the probe is blind: the file-declared ${fixture.controlSeat} answered ` +
            `${JSON.stringify(controlFirst)} rather than naming its "${fixture.controlDesk}" desk, so a ` +
            `failure on any durability leg below would not mean durability broke`,
        ],
        evidence: "",
      };
    }

    // ---- (1) hire two seats, one of which names a kind that is not here -----
    const good = await admin("hire", {
      seatId: fixture.goodSeat,
      flow: fixture.kind,
      settings: { desk: "back" },
      instructions: "You work the back desk.",
    });
    if (good.status !== 200) {
      failures.push(`hiring ${fixture.goodSeat} returned ${good.status}: ${good.body.slice(0, 400)}`);
    }
    const goodAnswer = await answerOf(address(fixture.goodSeat));
    if (goodAnswer === undefined || !goodAnswer.includes("back")) {
      failures.push(
        `${address(fixture.goodSeat)} was hired but answered ${JSON.stringify(goodAnswer)} — it should ` +
          `carry the desk the hire supplied, straight away, in this process`
      );
    }

    const refused = await admin("hire", {
      seatId: fixture.missingKindSeat,
      flow: fixture.missingKind,
      settings: {},
    });
    if (refused.status === 200 && !refused.body.includes("error")) {
      failures.push(
        `hiring ${fixture.missingKindSeat} into "${fixture.missingKind}" was accepted; a kind this app ` +
          `does not carry must be refused before anything is written`
      );
    }
    if (await resolves(address(fixture.missingKindSeat))) {
      failures.push(`${address(fixture.missingKindSeat)} resolves, but its hire was refused`);
    }

    // ---- (2) hire a seat carrying a token minted right now ------------------
    const tokenHire = await admin("hire", {
      seatId: fixture.tokenSeat,
      flow: fixture.kind,
      settings: { desk: token },
      instructions: "You work a desk named by the check.",
    });
    if (tokenHire.status !== 200) {
      failures.push(`hiring ${fixture.tokenSeat} returned ${tokenHire.status}: ${tokenHire.body.slice(0, 400)}`);
    }

    // The body says another organization. The credential says this one. The
    // credential is what must decide — otherwise "the org comes from the
    // principal" is a sentence with no mechanism behind it.
    await admin("hire", {
      orgId: fixture.otherOrg,
      seatId: "support.spoof",
      flow: fixture.kind,
      settings: { desk: "spoofed" },
    });
    if (await resolves(`${fixture.otherOrg}.support.spoof`)) {
      failures.push(
        `a hire whose BODY named "${fixture.otherOrg}" landed there; under "${fixture.org}"'s credential it ` +
          `must land in "${fixture.org}" and leave the other organization untouched`
      );
    }
    if (!(await resolves(address("support.spoof")))) {
      failures.push(
        `a hire whose body named "${fixture.otherOrg}" did not land in "${fixture.org}" either — the ` +
          `credential's organization is what the row should have been written under`
      );
    }

    // ---- (3) the durability leg --------------------------------------------
    await restart();

    const controlAfter = await answerOf(fixture.controlSeat);
    if (controlAfter === undefined || !controlAfter.includes(fixture.controlDesk)) {
      failures.push(
        `after the restart the file-declared ${fixture.controlSeat} answered ${JSON.stringify(controlAfter)} — ` +
          `the control failed, so the durability result below is not interpretable`
      );
    }

    const tokenAfter = await answerOf(address(fixture.tokenSeat));
    if (tokenAfter === undefined) {
      failures.push(
        `${address(fixture.tokenSeat)} did not survive the restart — it 404s, so the hire was never written down`
      );
    } else if (!tokenAfter.includes(token)) {
      failures.push(
        `${address(fixture.tokenSeat)} answered after the restart but said ${JSON.stringify(tokenAfter)}, ` +
          `which does not carry the token this check generated (${token}) — so it came back on a default ` +
          `rather than on the settings the hire supplied`
      );
    }
    evidence.push(
      `across a restart of the Next-built app: ${address(fixture.tokenSeat)} said ` +
        `${JSON.stringify(tokenAfter)} carrying the check-time token, control ${fixture.controlSeat} still ` +
        `naming its "${fixture.controlDesk}" desk`
    );

    // ---- (4) the degrade leg ------------------------------------------------
    breakStoredKind(fixture.goodSeat);
    await restart();

    if (!(await resolves(fixture.controlSeat))) {
      failures.push(
        `after a row naming a missing kind was stored, the app stopped serving the file-declared team — ` +
          `one unusable row must not take the deployment down`
      );
    }
    const tokenStillThere = await answerOf(address(fixture.tokenSeat));
    if (tokenStillThere === undefined || !tokenStillThere.includes(token)) {
      failures.push(
        `the other hired seat stopped answering once one row went bad — a skip must cost one seat, not the roster`
      );
    }
    if (await resolves(address(fixture.goodSeat))) {
      failures.push(
        `${address(fixture.goodSeat)} still resolves although its stored row names "${fixture.missingKind}", ` +
          `which this app does not carry`
      );
    }
    if (!serverLog.includes(fixture.goodSeat) || !serverLog.includes("skipped")) {
      failures.push(
        `the boot did not name the seat it skipped. A count and a list are owed wherever the roster is ` +
          `shown; the log is what this check can observe across a process boundary. Server output:\n${serverLog.slice(-1500)}`
      );
    }
    // The bad row is left exactly as it was — a boot never repairs data it did
    // not understand, because the repair destroys the evidence of why.
    const afterBoot = JSON.parse(readFileSync(rosterFileFor(fixture.goodSeat), "utf8")) as unknown[];
    if ((afterBoot[3] as { flow?: string }).flow !== fixture.missingKind) {
      failures.push(
        `the boot rewrote the row it could not use — it now reads ` +
          `${JSON.stringify((afterBoot[3] as { flow?: string }).flow)} rather than the stored ` +
          `"${fixture.missingKind}"`
      );
    }
    evidence.push(
      `with one stored row naming a kind the code does not carry: the app served, ` +
        `${address(fixture.goodSeat)} 404'd, the boot named it, and the row was left unrepaired`
    );

    // ---- (5) the fire leg ---------------------------------------------------
    const fired = await admin("fire", { seatId: fixture.tokenSeat });
    if (fired.status !== 200) {
      failures.push(`firing ${fixture.tokenSeat} returned ${fired.status}: ${fired.body.slice(0, 400)}`);
    }
    if (await resolves(address(fixture.tokenSeat))) {
      failures.push(`${address(fixture.tokenSeat)} still resolves in the process that fired it`);
    }

    await restart();
    if (await resolves(address(fixture.tokenSeat))) {
      failures.push(
        `${address(fixture.tokenSeat)} came back after a restart — the fire removed the address but not the row`
      );
    }
    if (!(await resolves(fixture.controlSeat))) {
      failures.push(`the control stopped answering after the fire leg's restart`);
    }
    evidence.push(
      `after firing ${address(fixture.tokenSeat)} and restarting, its address 404s and it is gone from the roster`
    );
  } finally {
    await stopServer().catch(() => undefined);
  }

  return { failures, evidence: evidence.join("; ") };
});
