/**
 * Goal check: a Lab that declares a chief of staff gets it as a running seat,
 * and a person changes who works there by asking it. A hire lands at once, a
 * fire lands only on Approve, and both hold across restarts. See goal.md.
 *
 * Real path, real model. The DevTeam profile (`labs/shift-manager/teams/
 * devteam`) is served by Shift Manager's own start script over a SQLite file
 * this check owns, started three times over that one file. Every change goes
 * through the chief of staff's own turn on `openai/gpt-5.4-mini`; the approval
 * goes through the engine's resume route, as Inbox sends it. What happened is
 * read through the Lab's routes, the ones Shift Manager reads: the seat
 * inventory through the channel's session, the roster through the chief of
 * staff's, a seat's address by opening a session on it.
 *
 * Legs (each failure is tagged with its leg):
 *
 *   boot        the chief of staff is listed from the tree, on the agent kind,
 *               with a door; no other declared seat names a hire or fire tool
 *   discover    asked who is on the feature channel, it names the declared seats
 *   hire        asked for a seat, it hires one at once: no ask is raised, the
 *               seat is listed, its roster row is written, its address answers
 *   restart     after a restart the hired seat is still listed and answers
 *   ask         asked to fire it, it raises one human_approval naming the seat,
 *               and nothing changes yet
 *   seat gone   on Approve, and after a second restart, the seat is gone from
 *               the inventory and the roster, and its address no longer answers
 *
 * Control:
 *
 *   deny-fire   Deny instead of Approve. Must fail at "seat gone".
 *
 * Run:      pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts
 * Control:  GOAL_CONTROL=deny-fire pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, runGoal } from "../../lib/index.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["deny-fire"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

const SHIFT_MANAGER = join(REPO_ROOT, "labs", "shift-manager");
const DEVTEAM_CONFIG = join(SHIFT_MANAGER, "teams", "devteam", "fsdev.config.mts");
const DEVTEAM_TREE = join(REPO_ROOT, "goals", "devforce-lab", "lab", "workforce");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SCRATCH = goalTmpDir("org-seats-cos");
/** The seat Shift Manager and FIX-1722 find the chief of staff by. */
const COS = "chief-of-staff";
/** How long one turn of the chief of staff may take: a real model answers it. */
const TURN_MS = 180_000;
const MODEL_KEYS = ["AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY"];

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// ---- serving the Lab -----------------------------------------------------------

type Served = { origin: string; child: ChildProcess; exited: Promise<void>; log: () => string };

/**
 * Serve DevTeam over `store` through Shift Manager's start script. The pages
 * are a stub: this check reads routes, never the screen.
 */
async function startDevTeam(store: string, pages: string): Promise<Served> {
  const workDir = mkdtempSync(join(SCRATCH, "run-"));
  let log = "";
  const child = spawn(TSX, [join(SHIFT_MANAGER, "bin", "start.mts"), "--config", DEVTEAM_CONFIG, "--port", "0", "--assets", pages], {
    cwd: workDir,
    env: intentFreeEnv(process.env, { INIT_CWD: workDir, GOAL_CONTROL: "", DEVTEAM_STORE: store }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (log += String(d)));
  child.stderr!.on("data", (d) => (log += String(d)));
  let gone = false;
  const exited = new Promise<void>((resolve) =>
    child.on("exit", () => {
      gone = true;
      resolve();
    }),
  );
  for (let waited = 0; waited < 120_000; waited += 250) {
    const match = /Shift Manager: (http:\/\/\S+)/.exec(log);
    if (match !== null) return { origin: match[1]!, child, exited, log: () => log };
    if (gone) break;
    await sleep(250);
  }
  child.kill("SIGTERM");
  throw new Error(`Shift Manager's start script never served DevTeam. Log tail:\n${log.slice(-3000)}`);
}

async function stop(served: Served): Promise<void> {
  served.child.kill("SIGTERM");
  await served.exited;
}

// ---- the Lab's routes ------------------------------------------------------------

type Item = { id: string; type: string; role?: string; requestId?: string; suspensionId?: string; data?: unknown; content?: unknown };

async function labApi(origin: string) {
  // The person's identity and bearer, as the page is handed them.
  const html = await (await fetch(`${origin}/`)).text();
  const config = /window\.__FSD_DEVTOOL_CONFIG__ = (\{.*?\});<\/script>/.exec(html)?.[1];
  if (config === undefined) throw new Error("the served page carries no connection config");
  const { userId, bearerToken } = JSON.parse(config) as { userId: string; bearerToken?: string };
  const enc = encodeURIComponent;

  const call = async (method: string, path: string, body?: unknown): Promise<{ status: number; body: any }> => {
    const response = await fetch(`${origin}/api/flows${path}`, {
      method,
      headers: { "content-type": "application/json", ...(bearerToken === undefined ? {} : { authorization: `Bearer ${bearerToken}` }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text.length === 0 ? null : JSON.parse(text) };
  };
  const get = async (path: string): Promise<any> => {
    const { status, body } = await call("GET", path);
    if (status !== 200) throw new Error(`GET ${path}: ${status} ${JSON.stringify(body)}`);
    return body;
  };

  /** Every row of the collection at `pattern`, read through a session whose flow declares it. */
  const collection = async (sessionId: string, pattern: string): Promise<Array<Record<string, unknown>>> => {
    const manifest = await get(`/sessions/${enc(sessionId)}/manifest`);
    const ref = (manifest.resources as Array<{ kind: string; pattern?: string; ref: string }>).find(
      (r) => r.kind === "collection" && r.pattern === pattern,
    )?.ref;
    if (ref === undefined) throw new Error(`session ${sessionId} declares no collection ${pattern}`);
    const rows: Array<Record<string, unknown>> = [];
    let cursor: string | undefined;
    for (let page = 0; page < 50; page += 1) {
      const body = await get(`/sessions/${enc(sessionId)}/resources/${enc(ref)}?limit=200${cursor === undefined ? "" : `&cursor=${enc(cursor)}`}`);
      rows.push(...((body.items ?? []) as Array<{ clientData?: Record<string, unknown> }>).map((i) => i.clientData ?? {}));
      if (body.nextCursor === undefined || body.nextCursor === cursor) break;
      cursor = body.nextCursor;
    }
    return rows;
  };

  /** A new session on `flowId` for the person, or the refusal. */
  const openSession = (flowId: string) => call("POST", `/${enc(flowId)}/sessions`, { userId });

  /** Every item of `types` in one session, in stored order. */
  const items = async (sessionId: string, types: string): Promise<Item[]> => {
    const out: Item[] = [];
    for (let offset = 0, page = 0; page < 50; page += 1) {
      const body = await get(`/sessions/${enc(sessionId)}/state?include_items=true&item_types=${types}&offset=${offset}&limit=200`);
      out.push(...(body.items ?? []));
      if (body.pagination?.hasMore !== true) break;
      offset = body.pagination.nextOffset ?? offset + 200;
    }
    return out;
  };

  /** Wait for a request to leave the running states (and `suspended`, after a resume). */
  const settle = async (flowId: string, requestId: string, resumed = false): Promise<string> => {
    const running = ["pending", "queued", "in_progress", "running", ...(resumed ? ["suspended"] : [])];
    for (const until = Date.now() + TURN_MS; Date.now() < until; await sleep(500)) {
      const polled = await call("GET", `/${enc(flowId)}/requests/${enc(requestId)}/status`);
      const status = polled.body?.status as string | undefined;
      if (status !== undefined && !running.includes(status)) return status;
    }
    return "timed-out";
  };

  /** Say one line to the chief of staff in `sessionId`, and wait for its turn to end. */
  const say = async (sessionId: string, message: string) => {
    const posted = await call("POST", `/${enc(COS)}/${enc(sessionId)}/actions/run`, { userId, input: { message } });
    if (posted.status >= 400) throw new Error(`the chief of staff's door refused the line: ${posted.status} ${JSON.stringify(posted.body)}`);
    const requestId = posted.body.request.id as string;
    return { requestId, status: await settle(COS, requestId) };
  };

  /** The text of the last assistant message in a session. */
  const lastReply = async (sessionId: string): Promise<string> => {
    const messages = (await items(sessionId, "message")).filter((i) => i.role === "assistant");
    return JSON.stringify(messages.at(-1)?.content ?? "");
  };

  return { userId, call, get, collection, openSession, items, settle, say, lastReply };
}

// ---- the goal ------------------------------------------------------------------

await runGoal(async () => {
  if (!MODEL_KEYS.some((key) => (process.env[key] ?? "") !== "")) {
    return {
      failures: [`precondition: the chief of staff runs a real model, and none of ${MODEL_KEYS.join(", ")} is set, so nothing here was checked`],
      evidence: "",
    };
  }

  // Read off the tree, never spelled here: the org, the channel and its members.
  const tree = await readDeclaredRoster(DEVTEAM_TREE);
  const channel = tree.channels[0];
  if (channel === undefined) throw new Error("the DevTeam tree declares no channel");
  const members = (channel.declared.members as string[] | undefined) ?? [];
  // The held-out seat: picked now, so no file in the repository can name it.
  const seat = `coder-${randomBytes(3).toString("hex")}`;

  mkdirSync(SCRATCH, { recursive: true });
  const pages = mkdtempSync(join(SCRATCH, "pages-"));
  writeFileSync(join(pages, "index.html"), "<!doctype html><html><head></head><body>routes only</body></html>");
  const store = join(mkdtempSync(join(SCRATCH, "store-")), "devteam.sqlite");

  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, why: string) => failures.push(`${leg}: ${why}`);

  /** The hired seat's address, from the inventory row whose id ends with it. */
  const reads = async (api: Awaited<ReturnType<typeof labApi>>, cosSession: string) => {
    const inventory = await api.collection(channel.id, "inventory/seats/*");
    const roster = await api.collection(cosSession, "workforce/roster/*");
    const row = inventory.find((r) => typeof r.id === "string" && (r.id as string).endsWith(`.${seat}`));
    return {
      inventory,
      listed: row !== undefined,
      address: row?.id as string | undefined,
      rostered: roster.some((r) => r.seatId === seat),
    };
  };

  // ---- boot 1: the tree's chief of staff, then the hire ---------------------
  let served = await startDevTeam(store, pages);
  let address: string | undefined;
  try {
    const api = await labApi(served.origin);
    const opened = await api.openSession(COS);
    if (opened.status !== 201) {
      fail("boot", `the chief of staff's address did not answer: ${opened.status} ${JSON.stringify(opened.body)}`);
      return { failures, evidence: "" };
    }
    const cosSession = opened.body.session.id as string;

    const inventory = await api.collection(channel.id, "inventory/seats/*");
    const cos = inventory.find((r) => r.id === COS);
    if (cos === undefined) fail("boot", `no "${COS}" row in the seat inventory: ${JSON.stringify(inventory.map((r) => r.id))}`);
    else if (cos.kind !== "agent" || typeof cos.door !== "string") fail("boot", `"${COS}" is listed as ${JSON.stringify(cos)}`);
    const otherHirers = tree.workers.filter(
      (w) => w.id !== COS && ((w.declared.tools as string[] | undefined) ?? []).some((t) => ["hire", "fire", "rehire"].includes(t)),
    );
    if (otherHirers.length > 0) fail("boot", `seats other than ${COS} name a hire tool: ${otherHirers.map((w) => w.id).join(", ")}`);
    evidence.push(`boot: "${COS}" listed on kind ${String(cos?.kind)} with door ${String(cos?.door)}, and no other declared seat names hire or fire`);

    // discover
    const asked = await api.say(cosSession, `Who is on the ${channel.id} channel? Look it up and list the seat ids.`);
    const answer = await api.lastReply(cosSession);
    const missing = members.filter((m) => !answer.includes(m) && !new RegExp(`\\b${m.split(".").at(-1)}\\b`).test(answer));
    if (asked.status !== "completed") fail("discover", `the turn ended ${asked.status}`);
    else if (missing.length > 0) fail("discover", `the answer names none of ${missing.join(", ")}: ${answer.slice(0, 300)}`);
    else evidence.push(`discover: asked who is on ${channel.id}, the answer named ${members.join(", ")}`);

    // hire
    const hired = await api.say(cosSession, `Please hire one more coder for the team, with the seat id "${seat}".`);
    const asksAfterHire = (await api.items(cosSession, "suspension")).length;
    const afterHire = await reads(api, cosSession);
    if (hired.status !== "completed") fail("hire", `the turn ended ${hired.status} (a hire must not wait for anyone)`);
    if (asksAfterHire !== 0) fail("hire", `${asksAfterHire} approval(s) were raised for a hire`);
    if (!afterHire.listed) fail("hire", `no inventory row for "${seat}": ${JSON.stringify(afterHire.inventory.map((r) => r.id))}`);
    if (!afterHire.rostered) fail("hire", `no roster row for "${seat}"; the chief of staff said ${(await api.lastReply(cosSession)).slice(0, 400)}`);
    address = afterHire.address;
    if (address !== undefined) {
      const answers = await api.openSession(address);
      if (answers.status !== 201) fail("hire", `"${address}" does not answer: ${answers.status}`);
      else evidence.push(`hire: "${seat}" hired at once as ${address} (kind ${String(afterHire.inventory.find((r) => r.id === address)?.kind)}), no ask raised, its address answers`);
    }
  } finally {
    await stop(served);
  }
  if (failures.length > 0 || address === undefined) {
    return { failures: failures.length > 0 ? failures : ["hire: no address to carry on with"], evidence: evidence.join("; ") };
  }

  // ---- boot 2: the hire held; then the fire, through the person's answer ----
  served = await startDevTeam(store, pages);
  try {
    const api = await labApi(served.origin);
    const cosSession = (await api.openSession(COS)).body.session.id as string;
    const afterRestart = await reads(api, cosSession);
    if (!afterRestart.listed || !afterRestart.rostered) fail("restart", `after a restart "${seat}" is listed=${afterRestart.listed}, rostered=${afterRestart.rostered}`);
    const answers = await api.openSession(address);
    if (answers.status !== 201) fail("restart", `after a restart "${address}" does not answer: ${answers.status}`);
    else evidence.push(`restart: "${seat}" still listed, rostered and answering`);

    const fire = await api.say(cosSession, `Please fire the seat "${seat}".`);
    const asks = (await api.items(cosSession, "suspension")).filter((i) => i.requestId === fire.requestId);
    const ask = asks[0] as (Item & { data?: { verb?: string; seatId?: string; kind?: string | null } }) | undefined;
    const beforeAnswer = await reads(api, cosSession);
    if (fire.status !== "suspended" || ask === undefined) {
      fail("ask", `the fire did not wait for a person: the turn ended ${fire.status} with ${asks.length} ask(s); the chief of staff said ${(await api.lastReply(cosSession)).slice(0, 400)}`);
    } else {
      if (ask.data?.verb !== "fire" || ask.data?.seatId !== seat) fail("ask", `the ask names ${JSON.stringify(ask.data)}`);
      if (!beforeAnswer.listed || !beforeAnswer.rostered) fail("ask", `"${seat}" changed before anyone answered`);
      else evidence.push(`ask: one human_approval ${JSON.stringify(ask.data)}, "${seat}" untouched while it waits`);

      const action = CONTROL === "deny-fire" ? "reject" : "approve";
      const resumed = await api.call("POST", `/${encodeURIComponent(COS)}/requests/${encodeURIComponent(fire.requestId)}/resume`, {
        suspensionId: ask.suspensionId,
        action,
      });
      if (resumed.status >= 400) fail("seat gone", `the resume route refused ${action}: ${resumed.status} ${JSON.stringify(resumed.body)}`);
      const settled = await api.settle(COS, fire.requestId, true);
      if (settled !== "completed") fail("seat gone", `after ${action} the turn ended ${settled}`);
    }
  } finally {
    await stop(served);
  }

  // ---- boot 3: what the answer did, after a second restart -----------------
  served = await startDevTeam(store, pages);
  try {
    const api = await labApi(served.origin);
    const cosSession = (await api.openSession(COS)).body.session.id as string;
    const after = await reads(api, cosSession);
    const answers = await api.openSession(address);
    if (after.listed) fail("seat gone", `"${seat}" is still in the seat inventory after the answer and a restart`);
    if (after.rostered) fail("seat gone", `"${seat}" still has a roster row after the answer and a restart`);
    if (answers.status === 201) fail("seat gone", `"${address}" still answers after the answer and a restart`);
    if (!after.listed && !after.rostered && answers.status !== 201) {
      evidence.push(`seat gone: after Approve and a second restart "${seat}" has no inventory row, no roster row, and "${address}" answers ${answers.status}`);
    }
  } finally {
    await stop(served);
  }

  return {
    failures: CONTROL === "" ? failures : failures.map((f) => `[control ${CONTROL}] ${f}`),
    evidence: `DevTeam served three times by Shift Manager's start script over one SQLite file, the chief of staff on a real model. ${evidence.join("; ")}`,
  };
});
