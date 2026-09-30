/**
 * Goal check — the EM seat asks a person before it files a feature, and the
 * answer decides whether anything is filed.
 *
 * Nothing in this lab's tree asked a person anything, so an Inbox pointed at it
 * had nothing to show. With the ask turned on, opening the lab leaves one
 * pending approval in the EM seat's own session. Approve files the row and the
 * coder seat's run starts; Deny files nothing and the EM says so.
 *
 * Model-free, and keyless: the ask is handlers and the stock `human_approval`
 * suspension, and the coder runs the scripted stub. A miss here is a finding
 * about the lab or the shell, never about what a model chose to do.
 *
 * Every read a person's client would make goes through the lab's HTTP door
 * with its verified bearer, and the answer goes through the engine's own resume
 * route. Nothing in the lab answers the ask for the check. Rows are enumerated,
 * not looked up by the id this check expects.
 *
 * Legs, and the rules each one closes (the spec's AR-n):
 *
 *   0  AR-1 AR-7     — opened without the ask, nothing asks; held-out strings
 *                      live in no lab code; no model key in the env
 *   1  AR-2 AR-3 AR-4 — opened with it: one pending approval in the EM's own
 *                      session, listed as Inbox lists it; no row, no dispatch
 *   4a AR-5          — re-opened while pending: no second ask
 *   2  AR-8 AR-9 AR-11 AR-13 — refused without a bearer or with `submit`; then
 *                      Approve: one row, handed to the coder by id, run once
 *   4b AR-5          — re-opened after Approve: no second ask, no second row
 *   3  AR-10 AR-11   — a fresh open, Deny: no row, no dispatch, says so
 *   4c AR-5          — re-opened after Deny: still nothing asked or filed
 *   6  AR-6          — an open that cannot raise the ask fails, naming the step
 *   7  AR-12         — a row another door filed first: Approve files no second
 *
 * Control: `GOAL_CONTROL=no-gate` makes the asking door file before it
 * suspends. Leg 1 must go red on "a row existed before any approval".
 */

import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { inMemoryStores } from "@flow-state-dev/engine";
import type { Task } from "@flow-state-dev/orchestration/tasks";
import { loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import {
  LAB_ORG_ID,
  LAB_TREE,
  LAB_USER_ID,
  openLab,
  type Lab,
  type OpenLabOptions,
} from "../lab/host.mts";
import { harnessStub, type StubRun } from "../lab/harness-stub.mts";
import { BASE_REF, commitAll, createScratchRepo } from "../lab/scratch-repo.mts";
import { RAISE_ASK_STEP, raiseAsk, seatSessionId } from "../lab/ask.mts";
import { ASK_ENTRY } from "../lab/seat-config.mts";

stripIntentOverrides();

interface Fixture {
  feature: { issue: string; goal: string };
  coordinatorSeat: string;
  assignedSeat: string;
  silentSeat: string;
  channel: string;
  wait: { timeoutMs: number; pollMs: number };
}

const fixture = loadFixture<Fixture>(import.meta.url);
const { feature, wait } = fixture;

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS = ["no-gate"] as const;
if (CONTROL === "list") {
  console.log(`controls: ${CONTROLS.join(", ")}`);
  process.exit(0);
}
if (CONTROL !== "" && !(CONTROLS as readonly string[]).includes(CONTROL)) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${CONTROLS.join(", ")}`);
  process.exit(2);
}

const LAB_ROOT = fileURLToPath(new URL("../lab", import.meta.url));
const EM_SESSION = seatSessionId(fixture.coordinatorSeat);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** What the coder's run "did": write a file and commit it, so the row can settle done. */
const commitWork = (run: StubRun): void => {
  writeFileSync(join(run.cwd, "NIGHT-MODE.md"), "A night-mode toggle, as the ask named.\n");
  commitAll(run.cwd, "add night-mode toggle");
};

interface Opened {
  lab: Lab;
  runs: StubRun[];
}

/** Open a lab over `stores` (fresh unless given), with the ask on unless told otherwise. */
async function open(
  label: string,
  stores: unknown,
  over: Partial<OpenLabOptions> = {},
): Promise<Opened> {
  const dirs = createScratchRepo(label);
  const stub = harnessStub({ duringRun: commitWork });
  const lab = await openLab({
    stores,
    harness: stub.slot,
    workspace: { root: dirs.root, sourceRepo: dirs.sourceRepo, baseRef: BASE_REF },
    coderSeatId: fixture.assignedSeat,
    logger: silentLogger,
    ask: feature,
    ...(CONTROL === "no-gate" ? { fileBeforeAsking: true } : {}),
    ...over,
  });
  return { lab, runs: stub.runs };
}

/** One pending approval, as a person's Inbox would see it. */
interface PendingAsk {
  requestId: string;
  suspensionId: string;
  reason: string;
  message: string;
  allow: string[];
}

/**
 * What a person's client reads, through the lab's door: the sessions listed
 * for this person with dispatch runs included, and in the EM seat's session,
 * its requests with their items.
 */
async function inbox(lab: Lab): Promise<{
  listed: boolean;
  requests: Array<{ id: string; status: string; actionName: string; items?: any[] }>;
  pending: PendingAsk[];
}> {
  const sessions = await lab.door("GET", "sessions?include=dispatch-runs");
  if (sessions.status !== 200) {
    throw new Error(`the session listing answered ${sessions.status}: ${JSON.stringify(sessions.body)}`);
  }
  const listed = (sessions.body.sessions as Array<{ id: string }>).some((s) => s.id === EM_SESSION);
  if (!listed) return { listed, requests: [], pending: [] };
  const found = await lab.door("GET", `sessions/${EM_SESSION}/requests?include_items=true`);
  if (found.status !== 200) {
    throw new Error(`the EM session's requests answered ${found.status}: ${JSON.stringify(found.body)}`);
  }
  const requests = found.body.requests as Array<{
    id: string;
    status: string;
    actionName: string;
    items?: any[];
  }>;
  const pending: PendingAsk[] = [];
  for (const request of requests) {
    if (request.status !== "suspended") continue;
    const item = (request.items ?? []).filter((i) => i.type === "suspension").at(-1);
    if (item === undefined || item.suspensionStatus !== "pending") continue;
    pending.push({
      requestId: request.id,
      suspensionId: item.suspensionId,
      reason: item.reason,
      message: item.message ?? "",
      allow: item.allow ?? ["approve", "reject"],
    });
  }
  return { listed, requests, pending };
}

/** Every message item the EM's requests carry, as text. */
function messagesOf(requests: Array<{ items?: any[] }>): string[] {
  return requests
    .flatMap((r) => r.items ?? [])
    .filter((i) => i.type === "message")
    .map((i) => JSON.stringify(i.content ?? i.text ?? i));
}

/** Answer through the engine's resume route, as App Lab does. */
async function answer(
  lab: Lab,
  ask: PendingAsk,
  action: string,
  bearer = true,
): Promise<{ status: number; body: any }> {
  return await lab.door(
    "POST",
    `${fixture.coordinatorSeat}/requests/${ask.requestId}/resume`,
    { body: { suspensionId: ask.suspensionId, action }, bearer },
  );
}

/** Poll the request's status through the door until it reaches one of `want`. */
async function requestReaches(lab: Lab, requestId: string, want: string[]): Promise<string> {
  let last = "";
  for (let waited = 0; waited < wait.timeoutMs; waited += wait.pollMs) {
    const r = await lab.door("GET", `${fixture.coordinatorSeat}/requests/${requestId}/status`);
    last = r.body?.status ?? r.body?.request?.status ?? `http ${r.status}`;
    if (want.includes(last)) return last;
    await sleep(wait.pollMs);
  }
  return last;
}

/** Wait until the one row leaves `pending`/`in_progress`, or the bound runs out. */
async function rowSettles(lab: Lab): Promise<Task | undefined> {
  for (let waited = 0; waited < wait.timeoutMs; waited += wait.pollMs) {
    const rows = Object.values(await lab.rows());
    const row = rows[0];
    if (row !== undefined && row.status !== "pending" && row.status !== "in_progress") return row;
    await sleep(wait.pollMs);
  }
  return Object.values(await lab.rows())[0];
}

/** Every file under a directory, recursively. */
function filesUnder(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const full = join(root, entry);
    return statSync(full).isDirectory() ? filesUnder(full) : [full];
  });
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];
  const note = (leg: string, message: string): void => {
    failures.push(`leg ${leg}: ${message}`);
  };
  const askRequests = (requests: Array<{ actionName: string }>) =>
    requests.filter((r) => r.actionName === ASK_ENTRY);

  // ---- 0 · AR-1, AR-7 — nothing asks unless a host asked -----------------
  {
    for (const key of ["AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"]) {
      if (process.env[key] !== undefined) delete process.env[key];
    }
    // Held-out: the feature is the fixture's, and no lab code spells it.
    for (const file of filesUnder(LAB_ROOT).filter((f) => f.endsWith(".mts"))) {
      const text = readFileSync(file, "utf8");
      for (const token of [feature.issue, feature.goal]) {
        if (text.includes(token)) note("0", `${file} spells the held-out "${token}"`);
      }
    }
    const { lab } = await open("ask-off", inMemoryStores(), { ask: undefined });
    try {
      if (lab.ask !== undefined) note("0", "an open without the ask reported raising one");
      const seen = await inbox(lab);
      if (seen.requests.length !== 0 || seen.pending.length !== 0) {
        note("0", `without the ask the EM's session holds ${seen.requests.length} request(s)`);
      }
      if (Object.keys(await lab.rows()).length !== 0) note("0", "without the ask a row exists");
    } finally {
      await lab.dispose();
    }
    evidence.push("without the ask nothing is raised, filed or listed; the held-out feature lives in no lab code; run keyless");
  }

  // ---- 1 · AR-2, AR-3, AR-4 — the ask is pending, and nothing is filed ----
  const storesA = inMemoryStores();
  let ask: PendingAsk | undefined;
  {
    const { lab, runs } = await open("ask-a1", storesA);
    try {
      if (lab.ask?.raised !== true) note("1", `open did not raise the ask: ${JSON.stringify(lab.ask)}`);
      // Rows first: the control files before it asks, and this is what catches it.
      const rows = await lab.rows();
      if (Object.keys(rows).length !== 0) {
        note("1", `a row existed before any approval: ${Object.keys(rows).join(", ")}`);
      }
      const seen = await inbox(lab);
      if (!seen.listed) note("1", `the session listing did not return the EM's session ${EM_SESSION}`);
      if (seen.pending.length !== 1) {
        note("1", `the EM's session holds ${seen.pending.length} pending approval(s), wanted 1`);
      }
      ask = seen.pending[0];
      if (ask !== undefined) {
        if (ask.reason !== "human_approval") note("1", `the ask's reason is "${ask.reason}"`);
        for (const token of [feature.issue, feature.goal]) {
          if (!ask.message.includes(token)) note("1", `the ask does not name "${token}": ${ask.message}`);
        }
        if ([...ask.allow].sort().join(",") !== "approve,reject") {
          note("1", `the ask allows ${JSON.stringify(ask.allow)}, wanted approve and reject`);
        }
      }
      const members =
        lab.roster.channels.find((c) => c.id === fixture.channel)?.declared.members ?? [];
      if (!(members as string[]).includes(fixture.coordinatorSeat)) {
        note("1", `the feature channel's declared members ${JSON.stringify(members)} omit the EM`);
      }
      if ((await lab.dispatched(fixture.coordinatorSeat)).length !== 0) {
        note("1", "the EM dispatched before any answer");
      }
      if (runs.length !== 0) note("1", `the coder was reached ${runs.length} time(s) before any answer`);
    } finally {
      await lab.dispose();
    }
    evidence.push(
      `opening with the ask left one pending human_approval in ${EM_SESSION}, listed as Inbox lists it and naming the feature, with no row and no dispatch`,
    );
  }

  // ---- 4a · AR-5 — a reopen while pending asks nothing new ---------------
  // ---- 2 · AR-8, AR-9, AR-11, AR-13 — Approve --------------------------
  {
    const { lab, runs } = await open("ask-a2", storesA);
    try {
      if (lab.ask?.raised !== false) note("4a", `a reopen while pending raised again: ${JSON.stringify(lab.ask)}`);
      const seen = await inbox(lab);
      if (askRequests(seen.requests).length !== 1 || seen.pending.length !== 1) {
        note("4a", `after a reopen: ${askRequests(seen.requests).length} ask(s), ${seen.pending.length} pending`);
      }
      ask = seen.pending[0] ?? ask;

      if (ask === undefined) {
        note("2", "no pending ask to approve");
      } else {
        // The negative half first: nothing verified, then an action the ask does not allow.
        const unverified = await answer(lab, ask, "approve", false);
        if (unverified.status !== 401) note("2", `a resume with no bearer answered ${unverified.status}`);
        const submitted = await answer(lab, ask, "submit");
        if (submitted.status < 400) note("2", `a resume with "submit" answered ${submitted.status}`);
        if ((await inbox(lab)).pending.length !== 1) note("2", "a refused resume changed the pending ask");
        if (Object.keys(await lab.rows()).length !== (CONTROL === "no-gate" ? 1 : 0)) {
          note("2", "a refused resume filed a row");
        }

        const approved = await answer(lab, ask, "approve");
        if (approved.status !== 202) note("2", `approve answered ${approved.status}: ${JSON.stringify(approved.body)}`);
        const status = await requestReaches(lab, ask.requestId, ["completed", "failed"]);
        if (status !== "completed") note("2", `the approved request ended "${status}"`);
        const row = await rowSettles(lab);
        const rows = await lab.rows();
        const ids = Object.values(rows).map((r) => r.id);
        if (ids.length !== 1) note("2", `after approve the board holds ${ids.length} row(s): ${ids.join(", ")}`);
        if (row !== undefined && !row.id.startsWith(feature.issue)) {
          note("2", `the row "${row.id}" is not derived from "${feature.issue}"`);
        }
        if (row?.status !== "completed") note("2", `the row settled "${row?.status}", wanted "completed"`);
        const reached = (await lab.dispatched(fixture.coordinatorSeat)).map((d) => d.flowId);
        if (reached.length !== 1 || reached[0] !== fixture.assignedSeat) {
          note("2", `the board handed the row to ${JSON.stringify(reached)}, wanted ["${fixture.assignedSeat}"]`);
        }
        if (reached.includes(fixture.silentSeat)) note("2", `${fixture.silentSeat} was dispatched to`);
        if (runs.length !== 1) note("2", `the coder was reached ${runs.length} time(s), wanted 1`);
        const after = await inbox(lab);
        if (after.pending.length !== 0) note("2", `${after.pending.length} approval(s) still pending after approve`);
        evidence.push(
          `a resume with no bearer (${unverified.status}) and with "submit" (${submitted.status}) were refused; approve answered ${approved.status}, the request completed, one row (${row?.id}) settled ${row?.status}, handed to ${reached.join(", ")} by id, the coder ran ${runs.length} time(s), nothing left pending`,
        );
      }
    } finally {
      await lab.dispose();
    }
  }

  // ---- 4b · AR-5 — a reopen after Approve asks nothing, files nothing -----
  {
    const { lab } = await open("ask-a3", storesA);
    try {
      if (lab.ask?.raised !== false) note("4b", `a reopen after approve raised again: ${JSON.stringify(lab.ask)}`);
      const seen = await inbox(lab);
      if (askRequests(seen.requests).length !== 1 || seen.pending.length !== 0) {
        note("4b", `after a reopen: ${askRequests(seen.requests).length} ask(s), ${seen.pending.length} pending`);
      }
      if (Object.keys(await lab.rows()).length !== 1) note("4b", "a reopen after approve changed the row count");
    } finally {
      await lab.dispose();
    }
  }

  // ---- 3 · AR-10, AR-11 — Deny, on a fresh open -------------------------
  const storesB = inMemoryStores();
  {
    const { lab, runs } = await open("ask-b1", storesB);
    try {
      const pending = (await inbox(lab)).pending[0];
      if (pending === undefined) {
        note("3", "no pending ask to deny");
      } else {
        const denied = await answer(lab, pending, "reject");
        if (denied.status !== 202) note("3", `reject answered ${denied.status}: ${JSON.stringify(denied.body)}`);
        const status = await requestReaches(lab, pending.requestId, ["completed", "failed"]);
        if (status !== "completed") note("3", `the denied request ended "${status}"`);
        await sleep(300);
        const rows = Object.keys(await lab.rows());
        if (rows.length !== 0) note("3", `after deny the board holds ${rows.join(", ")}`);
        if ((await lab.dispatched(fixture.coordinatorSeat)).length !== 0) note("3", "after deny the EM dispatched");
        if (runs.length !== 0) note("3", `after deny the coder was reached ${runs.length} time(s)`);
        const after = await inbox(lab);
        if (after.pending.length !== 0) note("3", "an approval is still pending after deny");
        const said = messagesOf(after.requests);
        if (!said.some((m) => m.includes("Nothing filed") && m.includes(feature.issue))) {
          note("3", `the EM did not say nothing was filed: ${JSON.stringify(said)}`);
        }
        evidence.push(`deny answered ${denied.status}, the request completed, no row, no dispatch, and the EM said nothing was filed`);
      }
    } finally {
      await lab.dispose();
    }
  }

  // ---- 4c · AR-5 — a reopen after Deny: the Deny stands ------------------
  {
    const { lab } = await open("ask-b2", storesB);
    try {
      if (lab.ask?.raised !== false) note("4c", `a reopen after deny raised again: ${JSON.stringify(lab.ask)}`);
      const seen = await inbox(lab);
      if (askRequests(seen.requests).length !== 1 || seen.pending.length !== 0) {
        note("4c", `after a reopen: ${askRequests(seen.requests).length} ask(s), ${seen.pending.length} pending`);
      }
      if (Object.keys(await lab.rows()).length !== 0) note("4c", "a reopen after deny filed a row");
    } finally {
      await lab.dispose();
    }
    evidence.push("reopening over the same store while pending, after approve and after deny raised no second ask and filed nothing new");
  }

  // ---- 6 · AR-6 — an open that cannot raise the ask fails, naming it ------
  {
    // A tree with no EM seat: nothing to ask from. Derived from the real tree
    // so the missing seat is the only difference.
    const root = mkdtempSync(join(tmpdir(), "devforce-tree-no-em-"));
    cpSync(LAB_TREE, root, { recursive: true });
    rmSync(join(root, "teams/eng/workers/em"), { recursive: true });
    const charter = join(root, "teams/eng/channels/feature/CHANNEL.md");
    writeFileSync(
      charter,
      readFileSync(charter, "utf8").replace(`${fixture.coordinatorSeat}, `, ""),
    );
    let refused: string | undefined;
    try {
      const { lab } = await open("ask-no-em", inMemoryStores(), { root });
      await lab.dispose();
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    }
    if (refused === undefined) note("6", "an open that could not raise the ask succeeded");
    else if (!refused.startsWith(`${RAISE_ASK_STEP}:`)) note("6", `the open failed without naming the step: ${refused}`);
    evidence.push("an open that could not raise the ask failed, naming the step");
  }

  // ---- 7 · AR-12 — a row another door filed first ------------------------
  {
    const { lab } = await open("ask-c1", inMemoryStores());
    try {
      const pending = (await inbox(lab)).pending[0];
      const direct = await lab.file(fixture.coordinatorSeat, feature);
      if (direct.error !== undefined) note("7", `filing through the direct door was refused — ${direct.error}`);
      if (pending === undefined) {
        note("7", "no pending ask to approve");
      } else {
        await answer(lab, pending, "approve");
        await requestReaches(lab, pending.requestId, ["completed", "failed"]);
        const rows = Object.keys(await lab.rows());
        if (rows.length !== 1) note("7", `approve over an existing row left ${rows.length} row(s)`);
        const said = messagesOf((await inbox(lab)).requests);
        if (!said.some((m) => m.includes("already existed"))) {
          note("7", `the EM did not say the row existed: ${JSON.stringify(said)}`);
        }
      }
    } finally {
      await lab.dispose();
    }
    evidence.push("approving after another door filed the row left one row, and the EM said it already existed");
  }

  // ---- 8 · AR-5 — two raises at once over one store ----------------------
  {
    // The step needs a durable flow state, which only an open with the ask
    // builds: open with one for a throwaway feature, then race two raises for
    // another, the way two hosts over one store would.
    const { lab } = await open("ask-race", inMemoryStores(), {
      ask: { issue: "race-warmup", goal: "warm up the store" },
    });
    try {
      const other = { issue: `${feature.issue}-race`, goal: feature.goal };
      const both = await Promise.all(
        [0, 1].map(() =>
          raiseAsk({
            state: lab.state,
            emSeat: lab.seats[fixture.coordinatorSeat]!,
            feature: other,
            principal: { userId: LAB_USER_ID, orgId: LAB_ORG_ID },
            ledger: lab.ledger,
          }),
        ),
      );
      const raised = both.filter((r) => r.raised).length;
      if (raised !== 1) note("8", `two concurrent raises raised ${raised} ask(s), wanted 1`);
      const seen = await inbox(lab);
      const forOther = seen.pending.filter((p) => p.message.includes(other.issue)).length;
      if (forOther !== 1) note("8", `after two concurrent raises ${forOther} ask(s) for it are pending, wanted 1`);
    } finally {
      await lab.dispose();
    }
    evidence.push("two raises racing over one store raised exactly one ask");
  }

  // ---- 9 · AR-6 — a store that refuses a read fails the open, naming the step
  {
    const base = inMemoryStores();
    const refusing = {
      capabilities: ["primary"],
      async resolve(context: Parameters<typeof base.resolve>[0]) {
        const registry = (await base.resolve(context)) as Record<string, any>;
        const resourceState = new Proxy(registry.resourceState, {
          get(target, prop) {
            if (prop === "get") {
              return async () => {
                throw new Error("resource state is unavailable");
              };
            }
            const value = Reflect.get(target, prop);
            return typeof value === "function" ? value.bind(target) : value;
          },
        });
        return { ...registry, resourceState };
      },
    };
    let refused: string | undefined;
    try {
      const { lab } = await open("ask-store-refuses", refusing);
      await lab.dispose();
    } catch (error) {
      refused = error instanceof Error ? error.message : String(error);
    }
    if (refused === undefined) note("9", "an open over a store that refuses reads succeeded");
    else if (!refused.startsWith(`${RAISE_ASK_STEP}:`)) {
      note("9", `a store refusal escaped without naming the step: ${refused}`);
    }
    evidence.push("a store that refused a read failed the open, naming the step");
  }

  // ---- 10 · AR-5 — an ask nobody decided does not hold the feature -------
  for (const status of ["interrupted", "aborted"] as const) {
    const stores = inMemoryStores();
    // The in-memory adapter memoizes one registry, so this is the one the
    // opens below run over.
    const registry = (await (stores.resolve as () => Promise<unknown>)()) as Record<string, any>;
    const first = await open(`ask-${status}-1`, stores);
    const firstId = first.lab.ask?.raised === true ? first.lab.ask.requestId : undefined;
    await first.lab.dispose();
    if (firstId === undefined) {
      note("10", `no first ask to mark ${status}`);
      continue;
    }
    // What a crash before the gate, or an explicit abort, leaves behind.
    const record = await registry.request.get(firstId);
    await registry.request.set(firstId, { ...record, status }, record.version);

    const second = await open(`ask-${status}-2`, stores);
    try {
      if (second.lab.ask?.raised !== true) {
        note("10", `after the first ask was ${status}, a reopen raised nothing: ${JSON.stringify(second.lab.ask)}`);
      }
      const seen = await inbox(second.lab);
      if (seen.pending.length !== 1) {
        note("10", `after the first ask was ${status}, ${seen.pending.length} ask(s) are pending, wanted 1`);
      }
    } finally {
      await second.lab.dispose();
    }
  }
  evidence.push("an ask left interrupted or aborted did not stop a reopen from asking again");

  return { failures, evidence: evidence.join("; ") };
});
