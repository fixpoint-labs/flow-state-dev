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
 * inventory through the mailbox's session, the roster through the chief of
 * staff's, a seat's address by opening a session on it.
 *
 * Legs (each failure is tagged with its leg):
 *
 *   boot        the chief of staff is listed from the tree, on the agent kind,
 *               with a door; no other declared seat names a hire or fire tool
 *   discover    asked who is on the feature mailbox, it names every declared
 *               seat by its full id, with the kind its file declares
 *   hire        asked for a seat, it hires one at once: no ask is raised, the
 *               seat is listed, its roster row is written, its address answers
 *   discover hired  in a fresh session, asked which seats were hired, it names
 *               the new seat by its full id with its kind, coder
 *   restart    after a restart the hired seat is still listed and answers
 *   ask         asked to fire it, it raises one human_approval naming the seat,
 *               and nothing changes yet
 *   answer      the resume route takes the answer and the turn completes
 *   seat gone   on Approve, and after a second restart, the seat is gone from
 *               the inventory and the roster, and its address no longer answers
 *   a seat asks a declared seat posts its own hire request into its mailbox,
 *               the mailbox hands it to the chief of staff from that seat, and
 *               the hire lands: roster row, inventory row, and an address that
 *               answers (its own small host: seat-asks.mts)
 *
 * Controls:
 *
 *   deny-fire         Deny instead of Approve. Must fail at "seat gone" only.
 *   no-seat-delivery  The mailbox hands the seat's post to nobody. Must fail at
 *                     "a seat asks" only.
 *   hide-hired-from-discover  The hired seat's roster row, which discover reads
 *                     a hire from, is moved aside for the discover-hired turn
 *                     and put back after. Must fail at "discover hired" only.
 *
 * Run:      pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts
 * Control:  GOAL_CONTROL=deny-fire pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts
 * Control:  GOAL_CONTROL=no-seat-delivery pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts
 * Control:  GOAL_CONTROL=hide-hired-from-discover pnpm tsx goals/org-seats/cos-changes-the-roster/run.mts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { HIRED_ROSTER_PREFIX } from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { LAB_ORG_ID } from "../../devforce-lab/lab/host.mts";
import { CODER_KIND } from "../../devforce-lab/lab/workforce/flows/workers/coder.mts";
import { REPO_ROOT, goalTmpDir, intentFreeEnv, runGoal } from "../../lib/index.mts";
import { ASKER, runSeatAsks } from "./seat-asks.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["deny-fire", "no-seat-delivery", "hide-hired-from-discover"] as const;

/** A reply's own text as lines: `lastReply` hands back the content as one JSON string. */
function linesOf(reply: string): string[] {
  const parsed = JSON.parse(reply) as unknown;
  const text = Array.isArray(parsed)
    ? parsed.map((part) => String((part as { text?: unknown }).text ?? "")).join("\n")
    : String(parsed);
  return text.split("\n");
}

/** Whether `text` names `id` exactly: not inside a longer id, not as a bare suffix of it. */
function standsAlone(text: string, id: string): boolean {
  return new RegExp(`(?<![\\w.-])${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-]|\\.\\w)`).test(text);
}
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

type Item = {
  id: string;
  type: string;
  role?: string;
  requestId?: string;
  suspensionId?: string;
  reason?: string;
  message?: string;
  data?: unknown;
  content?: unknown;
};

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

  // Read off the tree, never spelled here: the org, the mailbox and its members.
  const tree = await readDeclaredRoster(DEVTEAM_TREE);
  const mailbox = tree.mailboxes[0];
  if (mailbox === undefined) throw new Error("the DevTeam tree declares no mailbox");
  const members = (mailbox.declared.members as string[] | undefined) ?? [];
  // The held-out seat: picked now, so no file in the repository can name it.
  const seat = `coder-${randomBytes(3).toString("hex")}`;

  mkdirSync(SCRATCH, { recursive: true });
  const pages = mkdtempSync(join(SCRATCH, "pages-"));
  writeFileSync(join(pages, "index.html"), "<!doctype html><html><head></head><body>routes only</body></html>");
  const store = join(mkdtempSync(join(SCRATCH, "store-")), "devteam.sqlite");

  const failures: string[] = [];
  const evidence: string[] = [];
  const fail = (leg: string, why: string) => failures.push(`${leg}: ${why}`);
  // The seat-asks leg's own failures, kept apart: it runs on its own host, so
  // a failure there must not stop the DevTeam legs from being graded.
  const seatAskFailures: string[] = [];
  /** Every failure, the control's tag on each when one is set. */
  const graded = (): string[] => {
    const all = [...seatAskFailures, ...failures];
    return CONTROL === "" ? all : all.map((f) => `[control ${CONTROL}] ${f}`);
  };

  // ---- a seat asks (BR-21): its own small host, since DevTeam has no seat
  // that messages another. The request lives only in the asking seat's file.
  {
    const asked = `helper-${randomBytes(3).toString("hex")}`;
    const result = await runSeatAsks(asked, CONTROL === "no-seat-delivery", SCRATCH);
    const toCos = result.deliveries.filter((d) => d.member === COS);
    const problems: string[] = [];
    if (result.startStatus !== "completed") problems.push(`"${ASKER}" did not finish its job: ${result.startStatus}`);
    if (toCos.length !== 1 || !toCos[0]!.delivered) {
      problems.push(`the mailbox handed "${ASKER}"'s post to the chief of staff ${toCos.filter((d) => d.delivered).length} time(s), not once`);
    } else if (toCos[0]!.author !== ASKER) {
      problems.push(`the post the chief of staff heard is from ${JSON.stringify(toCos[0]!.author)}, not "${ASKER}"`);
    }
    // A hire's three outcomes (BR-8): the roster row, the inventory row, and an address that answers.
    if (!result.rostered) problems.push(`no roster row for "${asked}" after the seat's request`);
    else if (result.rosterKind !== "agent") problems.push(`"${asked}" was hired as ${String(result.rosterKind)}, not "agent"`);
    if (result.address === undefined) problems.push(`no inventory row for "${asked}" after the seat's request`);
    else if (result.listedKind !== "agent") problems.push(`"${asked}" is listed as kind ${String(result.listedKind)}, not "agent"`);
    else if (result.answers !== 201) problems.push(`"${result.address}" does not answer: ${String(result.answers)}`);
    if (problems.length > 0) {
      for (const problem of problems) seatAskFailures.push(`a seat asks: ${problem}`);
    } else {
      evidence.push(
        `a seat asks: "${ASKER}" posted its own request as itself, the mailbox handed it to the chief of staff from "${ASKER}", ` +
          `and "${asked}" has a roster row and an inventory row on kind agent, and ${String(result.address)} answers ${String(result.answers)}; ` +
          `the check sent the seat id to no one`,
      );
    }
  }

  /** The hired seat's address, from the inventory row whose id ends with it. */
  const reads = async (api: Awaited<ReturnType<typeof labApi>>, cosSession: string) => {
    const inventory = await api.collection(mailbox.id, "inventory/seats/*");
    const roster = await api.collection(cosSession, "workforce/roster/*");
    const row = inventory.find((r) => typeof r.id === "string" && (r.id as string).endsWith(`.${seat}`));
    const rosterRow = roster.find((r) => r.seatId === seat);
    return {
      inventory,
      listed: row !== undefined,
      address: row?.id as string | undefined,
      rostered: rosterRow !== undefined,
      // The kind the seat was hired onto, as each collection records it.
      listedKind: row?.kind as string | undefined,
      rosterKind: rosterRow?.flow as string | undefined,
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
      return { failures: graded(), evidence: "" };
    }
    const cosSession = opened.body.session.id as string;

    const inventory = await api.collection(mailbox.id, "inventory/seats/*");
    const cos = inventory.find((r) => r.id === COS);
    if (cos === undefined) fail("boot", `no "${COS}" row in the seat inventory: ${JSON.stringify(inventory.map((r) => r.id))}`);
    else if (cos.kind !== "agent" || typeof cos.door !== "string") fail("boot", `"${COS}" is listed as ${JSON.stringify(cos)}`);
    const otherHirers = tree.workers.filter(
      (w) => w.id !== COS && ((w.declared.tools as string[] | undefined) ?? []).some((t) => ["hire", "fire", "rehire"].includes(t)),
    );
    if (otherHirers.length > 0) fail("boot", `seats other than ${COS} name a hire tool: ${otherHirers.map((w) => w.id).join(", ")}`);
    evidence.push(`boot: "${COS}" listed on kind ${String(cos?.kind)} with door ${String(cos?.door)}, and no other declared seat names hire or fire`);

    // discover
    const asked = await api.say(cosSession, `Who is on the ${mailbox.id} mailbox? Look up the mailbox, then look up each of its seats, and list every seat's id with the worker kind it runs on, one seat per line.`);
    const answer = await api.lastReply(cosSession);
    // Each member by its full seat id, standing alone (a bare "em" could be a
    // guess from the mailbox's name, and "eng.em" inside a longer id is not that
    // seat), with the kind its file declares on the same line, also exact.
    const kindOf = (id: string) => tree.workers.find((w) => w.id === id)?.declared.flow as string | undefined;
    const lines = linesOf(answer);
    const missing: string[] = [];
    const wrongKind: string[] = [];
    for (const member of members) {
      const line = lines.find((l) => standsAlone(l, member));
      if (line === undefined) missing.push(member);
      else if (kindOf(member) === undefined || !standsAlone(line, kindOf(member)!)) wrongKind.push(`${member} (kind ${String(kindOf(member))})`);
    }
    if (asked.status !== "completed") fail("discover", `the turn ended ${asked.status}`);
    else if (missing.length > 0) fail("discover", `the answer does not name ${missing.join(", ")} by full seat id: ${answer.slice(0, 300)}`);
    else if (wrongKind.length > 0) fail("discover", `the answer names ${wrongKind.join(", ")} without that kind: ${answer.slice(0, 300)}`);
    else evidence.push(`discover: asked who is on ${mailbox.id}, the answer named ${members.map((m) => `${m} (${String(kindOf(m))})`).join(", ")}`);

    // hire
    const hired = await api.say(cosSession, `Please hire one more coder for the team, with the seat id "${seat}".`);
    const asksAfterHire = (await api.items(cosSession, "suspension")).length;
    const afterHire = await reads(api, cosSession);
    if (hired.status !== "completed") fail("hire", `the turn ended ${hired.status} (a hire must not wait for anyone)`);
    if (asksAfterHire !== 0) fail("hire", `${asksAfterHire} approval(s) were raised for a hire`);
    if (!afterHire.listed) fail("hire", `no inventory row for "${seat}": ${JSON.stringify(afterHire.inventory.map((r) => r.id))}`);
    if (!afterHire.rostered) fail("hire", `no roster row for "${seat}"; the chief of staff said ${(await api.lastReply(cosSession)).slice(0, 400)}`);
    if (afterHire.listed && afterHire.rostered && (afterHire.listedKind !== CODER_KIND || afterHire.rosterKind !== CODER_KIND)) {
      fail("hire", `"${seat}" was hired as kind ${String(afterHire.rosterKind)} (roster) / ${String(afterHire.listedKind)} (inventory), not "${CODER_KIND}"`);
    }
    address = afterHire.address;
    if (address !== undefined) {
      const answers = await api.openSession(address);
      if (answers.status !== 201) fail("hire", `"${address}" does not answer: ${answers.status}`);
      else evidence.push(`hire: "${seat}" hired at once as ${address} (kind ${String(afterHire.inventory.find((r) => r.id === address)?.kind)}), no ask raised, its address answers`);
    }

    // discover hired (BR-23): a fresh turn finds the seat it just hired. The
    // question names neither the seat nor its kind; the line of the answer
    // that names the seat must carry both. Under the control, the hired
    // seat's roster row (what discover reads a hire from) is moved aside for
    // this turn only and put back after, so every later leg is unchanged.
    if (address !== undefined) {
      const rosterKey = `${HIRED_ROSTER_PREFIX}${seat}`;
      const side = createSQLiteStores({ filename: store });
      const hidden = CONTROL === "hide-hired-from-discover" ? await side.resourceState.get("org", LAB_ORG_ID, rosterKey) : undefined;
      if (hidden !== undefined) await side.resourceState.delete("org", LAB_ORG_ID, rosterKey, "any" as never);
      try {
        // A session of its own, so the hire turn's own words can't answer it.
        const fresh = (await api.openSession(COS)).body.session.id as string;
        const turn = await api.say(fresh, "Which seats has this organization hired? Look it up and give each one's full seat id and the worker kind it was hired into.");
        const reply = await api.lastReply(fresh);
        const line = linesOf(reply).find((l) => standsAlone(l, seat) || standsAlone(l, address!));
        if (turn.status !== "completed") fail("discover hired", `the turn ended ${turn.status}`);
        else if (line === undefined) fail("discover hired", `the answer does not name "${seat}" by its full seat id: ${reply.slice(0, 400)}`);
        else if (!standsAlone(line, CODER_KIND)) fail("discover hired", `the answer names "${seat}" without its kind "${CODER_KIND}": ${line.slice(0, 300)}`);
        else evidence.push(`discover hired: asked which seats were hired, the answer named ${seat} with kind ${CODER_KIND}`);
      } finally {
        if (hidden !== undefined) await side.resourceState.set("org", LAB_ORG_ID, rosterKey, hidden.state as never, "any" as never);
        side.close();
      }
    }
  } finally {
    await stop(served);
  }
  // A failed discover-hired turn changed nothing (its row is back), so the
  // legs after it still run; any earlier failure leaves nothing to carry on with.
  const blocking = failures.filter((f) => !f.startsWith("discover hired:"));
  if (blocking.length > 0 || address === undefined) {
    if (blocking.length === 0) fail("hire", "no address to carry on with");
    return { failures: graded(), evidence: evidence.join("; ") };
  }

  // ---- boot 2: the hire held; then the fire, through the person's answer ----
  served = await startDevTeam(store, pages);
  try {
    const api = await labApi(served.origin);
    const cosSession = (await api.openSession(COS)).body.session.id as string;
    const afterRestart = await reads(api, cosSession);
    if (!afterRestart.listed || !afterRestart.rostered) fail("restart", `after a restart "${seat}" is listed=${afterRestart.listed}, rostered=${afterRestart.rostered}`);
    else if (afterRestart.listedKind !== CODER_KIND || afterRestart.rosterKind !== CODER_KIND) {
      fail("restart", `after a restart "${seat}" is kind ${String(afterRestart.rosterKind)} (roster) / ${String(afterRestart.listedKind)} (inventory), not "${CODER_KIND}"`);
    }
    const answers = await api.openSession(address);
    if (answers.status !== 201) fail("restart", `after a restart "${address}" does not answer: ${answers.status}`);
    else evidence.push(`restart: "${seat}" still listed, rostered and answering`);

    const fire = await api.say(cosSession, `Please fire the seat "${seat}".`);
    const asks = (await api.items(cosSession, "suspension")).filter((i) => i.requestId === fire.requestId);
    const ask = asks[0] as (Item & { data?: { verb?: string; seatId?: string; kind?: string | null } }) | undefined;
    const beforeAnswer = await reads(api, cosSession);
    if (fire.status !== "suspended" || ask === undefined) {
      fail("ask", `the fire did not wait for a person: the turn ended ${fire.status} with ${asks.length} ask(s); the chief of staff said ${(await api.lastReply(cosSession)).slice(0, 400)}`);
    } else if (asks.length !== 1) {
      // Exactly one: a second ask on the request would be a second change waiting.
      fail("ask", `the fire raised ${asks.length} asks, not one: ${JSON.stringify(asks.map((a) => a.data))}`);
    } else {
      const askProblems: string[] = [];
      if (ask.reason !== "human_approval") askProblems.push(`reason ${JSON.stringify(ask.reason)}`);
      if (ask.data?.verb !== "fire") askProblems.push(`verb ${JSON.stringify(ask.data?.verb)}`);
      if (ask.data?.seatId !== seat) askProblems.push(`seat ${JSON.stringify(ask.data?.seatId)}`);
      if (ask.data?.kind !== CODER_KIND) askProblems.push(`kind ${JSON.stringify(ask.data?.kind)}`);
      if (typeof ask.message !== "string" || !ask.message.includes(seat)) askProblems.push(`message ${JSON.stringify(ask.message)}`);
      if (askProblems.length > 0) {
        fail("ask", `the ask is not a human_approval to fire "${seat}" (kind "${CODER_KIND}"): ${askProblems.join(", ")}`);
        return { failures: graded(), evidence: evidence.join("; ") };
      }
      if (!beforeAnswer.listed || !beforeAnswer.rostered) fail("ask", `"${seat}" changed before anyone answered`);
      else evidence.push(`ask: one ${ask.reason} "${ask.message}" ${JSON.stringify(ask.data)}, "${seat}" untouched while it waits`);

      const action = CONTROL === "deny-fire" ? "reject" : "approve";
      const resumed = await api.call("POST", `/${encodeURIComponent(COS)}/requests/${encodeURIComponent(fire.requestId)}/resume`, {
        suspensionId: ask.suspensionId,
        action,
      });
      // The answer is its own leg, so the control can only go red on what the
      // answer did to the seat, never on a refused resume or a stuck turn.
      if (resumed.status >= 400) fail("answer", `the resume route refused ${action}: ${resumed.status} ${JSON.stringify(resumed.body)}`);
      const settled = await api.settle(COS, fire.requestId, true);
      if (settled !== "completed") fail("answer", `after ${action} the turn ended ${settled}`);
      if (resumed.status < 400 && settled === "completed") evidence.push(`answer: the resume route took ${action} and the turn completed`);
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
    failures: graded(),
    evidence: `DevTeam served three times by Shift Manager's start script over one SQLite file, the chief of staff on a real model. ${evidence.join("; ")}`,
  };
});
