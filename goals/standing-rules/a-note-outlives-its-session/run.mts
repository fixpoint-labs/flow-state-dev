/** What this run proves is `goal.md` beside this file. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client } from "@flow-state-dev/client";
import { WORKER_ID_STATE_KEY, createWorkforceClient, type StandingRulesActionOutput } from "@flow-state-dev/workforce/browser";
import { REPO_ROOT, goalTmpDir, runGoal } from "../../lib/index.mts";
import { assertPatched, describePatches, modulePatchEnv, type ModulePatch } from "../../lib/module-patch.mts";
import { labRoutes, startShiftManager, type LabRoutes, type ServedShiftManager, type StoredItem } from "../../lib/shift-manager.mts";

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROL !== "no-rules-context") throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; this goal knows no-rules-context`);
const SCRATCH = goalTmpDir("standing-rules");
const DEVTEAM = join(REPO_ROOT, "packages", "shift-manager", "teams", "devteam");
const CONFIG = join(DEVTEAM, "fsdev.config.mts");

/** The input: two notes, each a marker the replies must carry exactly. */
const NOTES = {
  start: { marker: "Noted —", words: "From now on, start every reply with `Noted —`." },
  end: { marker: "— CoS", words: "From now on, end every reply with `— CoS`." },
};
/** What the person asks the worker to change the start marker to, in words. */
const CHANGED_START = "Got it —";
/** What the page changes the end marker to. */
const PAGE_END = "— Shift";

/** Unrelated asks, one per fresh session: each worker gets ones it answers itself. */
const ASKS: Record<string, string[]> = {
  "chief-of-staff": [
    "Who works on this team? Keep it short.",
    "Which projects do we have right now? Keep it short.",
    "What does the researcher do? One sentence.",
  ],
  researcher: [
    "In one sentence, what does a code review catch that tests miss?",
    "In one sentence, why do teams pin dependency versions?",
    "In one sentence, what is the trade-off of a monorepo?",
  ],
};
const WORKERS = (process.env.GOAL_WORKERS ?? "chief-of-staff,researcher").split(",").map((w) => w.trim()).filter(Boolean);

/** The control: the capability's context entry returns nothing. Reads the same in the source and in tsx's output. */
const CONTROL_PATCHES: ModulePatch[] = [
  {
    module: "packages/workforce/src/standing-rules/rules-capability.ts",
    from: "context: \\(_input, ctx\\) => rulesContext\\(ctx(?: as never)?\\)",
    to: "context: () => undefined",
  },
];

interface Person {
  label: string;
  userId: string;
  bearer: string;
}

/** A reply, with what the person saw beside it. */
interface Turn {
  sessionId: string;
  ask: string;
  reply: string;
  /** The tool lines (`✎ …`) the turn posted. */
  lines: string[];
  status: string;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const RUNNING = new Set(["pending", "queued", "in_progress", "running"]);

/** The text of a stored message item. */
function textOf(item: StoredItem): string {
  const c = item.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => String((p as { text?: unknown }).text ?? "")).join("");
  return "";
}

/**
 * The reply with markdown emphasis peeled off its two ends only (`**`, `_`,
 * backticks, quotes): a marker the model bolds or code-formats still reads as
 * the marker; a marker anywhere but the edge does not.
 */
function edges(reply: string): string {
  return reply.trim().replace(/^[*_`"“]+/, "").replace(/[*_`"”.!\s]+$/, "").trim();
}
const startsWith = (reply: string, marker: string) => edges(reply).startsWith(marker);
const endsWith = (reply: string, marker: string) => edges(reply).endsWith(marker);

/** One person on one served install. */
class SignedIn {
  readonly routes: LabRoutes;
  readonly workforce: ReturnType<typeof createWorkforceClient>;
  /** The person's one client: their user, their credential. */
  readonly client: Client;
  constructor(
    readonly person: Person,
    origin: string,
  ) {
    const fetcher: typeof fetch = (input, init) => {
      const headers = new Headers(init?.headers);
      headers.set("authorization", `Bearer ${person.bearer}`);
      return fetch(input, { ...init, headers });
    };
    this.routes = labRoutes(origin, { userId: person.userId, bearer: person.bearer });
    this.client = createClient({ userId: person.userId, baseUrl: origin, fetcher });
    this.workforce = createWorkforceClient(this.client);
  }

  /** The roster entry whose id is `worker` or ends in `.worker`. */
  async worker(worker: string): Promise<{ id: string; flow: string }> {
    const roster = await this.workforce.roster();
    const found = roster.find((w) => w.id === worker || w.id.endsWith(`.${worker}`));
    if (found === undefined) throw new Error(`setup: ${this.person.label}'s roster has no ${worker}: ${roster.map((w) => w.id).join(", ")}`);
    return found;
  }

  /** A brand-new conversation with `worker`, opened as Shift Manager opens one. */
  async fresh(worker: { id: string; flow: string }): Promise<string> {
    const sessionId = `conv_goal_${Math.random().toString(16).slice(2, 14)}`;
    await this.client.flow(worker.flow).createSession({ sessionId, state: { [WORKER_ID_STATE_KEY]: worker.id } });
    return sessionId;
  }

  /** Say `words` in `sessionId` through the worker's door (`respond`), and read the turn back by request id. */
  async say(worker: { flow: string }, sessionId: string, words: string): Promise<Turn> {
    const posted = await this.routes.call("POST", `/${encodeURIComponent(worker.flow)}/${encodeURIComponent(sessionId)}/actions/respond`, {
      userId: this.person.userId,
      input: { message: words },
    });
    if (posted.status !== 202) return { sessionId, ask: words, reply: `refused ${posted.status}: ${JSON.stringify(posted.body)}`, lines: [], status: `http ${posted.status}` };
    const requestId = String(posted.body?.request?.id);
    let status = "timed-out";
    for (const until = Date.now() + 240_000; Date.now() < until; await sleep(500)) {
      const now = await this.routes.status(worker.flow, requestId);
      if (now !== undefined && !RUNNING.has(now)) {
        status = now;
        break;
      }
    }
    const mine = (await this.routes.items(sessionId, "message")).filter((i) => i.requestId === requestId && i.role === "assistant");
    const texts = mine.map(textOf);
    const lines = texts.filter((t) => t.startsWith("✎"));
    const reply = texts.filter((t) => !t.startsWith("✎") && t.trim() !== "").at(-1) ?? "";
    return { sessionId, ask: words, reply, lines, status };
  }

  /** The worker's rules for this person, through the action the Rules page calls. */
  rules(worker: string, input: Parameters<ReturnType<typeof createWorkforceClient>["standingRules"]>[1]): Promise<StandingRulesActionOutput> {
    return this.workforce.standingRules(worker, input);
  }
}

/** Three fresh sessions with `worker`, one unrelated ask each. */
async function threeFresh(user: SignedIn, worker: { id: string; flow: string }, asks: string[]): Promise<Turn[]> {
  const turns: Turn[] = [];
  for (const ask of asks) turns.push(await user.say(worker, await user.fresh(worker), ask));
  return turns;
}

const quoteReply = (t: Turn) => `${t.status}: ${JSON.stringify(t.reply.slice(0, 160))}`;

await runGoal(async (failures) => {
  const keys = ["AI_GATEWAY_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY", "ANTHROPIC_API_KEY"].filter((k) => (process.env[k] ?? "") !== "");
  if (keys.length === 0) throw new Error("blocked: no model credential (AI_GATEWAY_API_KEY, OPENAI_API_KEY, OPENROUTER_API_KEY or ANTHROPIC_API_KEY)");
  const host = (await import(join(DEVTEAM, "host.mts"))) as { LAB_USERS: Record<"owner" | "member", { userId: string; bearer: string }> };
  const alice: Person = { label: "Alice", ...host.LAB_USERS.owner };
  const bob: Person = { label: "Bob", ...host.LAB_USERS.member };

  // This goal reads no page (PR B's browser check does); the command still wants a pages directory.
  const pages = join(SCRATCH, "pages");
  mkdirSync(pages, { recursive: true });
  writeFileSync(join(pages, "index.html"), "<!doctype html><title>goal</title>");

  const mark = join(SCRATCH, "patched.txt");
  const patchEnv = CONTROL === "no-rules-context" ? modulePatchEnv(CONTROL_PATCHES, REPO_ROOT, mark) : {};
  if (CONTROL !== "") console.error(`control ${CONTROL}:\n${describePatches(CONTROL_PATCHES, REPO_ROOT)}`);

  const evidence: string[] = [];
  const log: Record<string, unknown> = {};

  for (const workerName of WORKERS) {
    const asks = ASKS[workerName];
    if (asks === undefined) throw new Error(`setup: no asks for ${workerName}`);
    const tag = (leg: string) => `[${workerName}] ${leg}`;
    const store = join(SCRATCH, "stores", workerName);
    mkdirSync(store, { recursive: true });
    const boot = (label: string): Promise<ServedShiftManager> =>
      startShiftManager({ scratch: SCRATCH, label: `${workerName}-${label}`, config: CONFIG, pages, env: { DEVTEAM_STORE: join(store, "devteam.sqlite"), ...patchEnv }, timeoutMs: 180_000 });
    const record: Record<string, unknown> = {};
    log[workerName] = record;

    // Session 1: Alice gives both notes in words, then the server restarts.
    let served = await boot("boot-1");
    let worker: { id: string; flow: string };
    try {
      const a = new SignedIn(alice, served.origin);
      worker = await a.worker(workerName);
      const s1 = await a.fresh(worker);
      const given = [await a.say(worker, s1, NOTES.start.words), await a.say(worker, s1, NOTES.end.words)];
      record.session1 = given;
      const added = given.flatMap((t) => t.lines).filter((l) => l.startsWith("✎ Rule added"));
      if (added.length < 2) failures.push(`${tag("next-session-follows")}: session 1 showed ${added.length} "Rule added" lines for two notes: ${JSON.stringify(given.map((t) => t.lines))}; replies ${given.map(quoteReply).join(" | ")}`);
    } finally {
      writeFileSync(join(store, "boot-1.log"), served.log());
      await served.stop();
    }

    served = await boot("boot-2");
    try {
      const a = new SignedIn(alice, served.origin);
      const b = new SignedIn(bob, served.origin);

      // next-session-follows: after the restart, three fresh sessions, unrelated asks, both markers.
      const after = await threeFresh(a, worker, asks);
      record.nextSessionFollows = after;
      const follows = after.filter((t) => startsWith(t.reply, NOTES.start.marker) && endsWith(t.reply, NOTES.end.marker)).length;
      if (follows !== 3) failures.push(`${tag("next-session-follows")}: ${follows} of 3 fresh sessions after the restart carried "${NOTES.start.marker}" … "${NOTES.end.marker}": ${after.map(quoteReply).join(" | ")}`);
      else evidence.push(`${workerName}: 3/3 fresh sessions after a restart opened "${NOTES.start.marker}" and closed "${NOTES.end.marker}"`);

      // person-scoped: Bob's fresh sessions with the same worker carry neither marker.
      const bobs = await threeFresh(b, await b.worker(workerName), asks);
      record.personScoped = bobs;
      const leaked = bobs.filter((t) => startsWith(t.reply, NOTES.start.marker) || endsWith(t.reply, NOTES.end.marker));
      if (leaked.length > 0 || bobs.some((t) => t.status !== "completed")) failures.push(`${tag("person-scoped")}: Bob's sessions: ${bobs.map(quoteReply).join(" | ")}`);
      else evidence.push(`${workerName}: Bob's 3 fresh sessions carried neither marker`);

      if (CONTROL !== "") continue; // The control's claim is next-session-follows; the rest would only spend.

      // worker-edits: Alice asks in words to change the start marker, then to drop it.
      const change = await a.say(worker, await a.fresh(worker), `Please change your rule about how to start replies: start every reply with \`${CHANGED_START}\` instead of \`${NOTES.start.marker}\`.`);
      const changed = await threeFresh(a, worker, asks);
      const drop = await a.say(worker, await a.fresh(worker), `Please drop your rule about starting replies with \`${CHANGED_START}\`. Keep the other one.`);
      const dropped = await threeFresh(a, worker, asks);
      record.workerEdits = { change, changed, drop, dropped };
      if (!change.lines.some((l) => l.startsWith("✎ Rule") && l.includes("changed"))) failures.push(`${tag("worker-edits")}: asking to change showed no "Rule … changed" line: ${JSON.stringify(change.lines)}; ${quoteReply(change)}`);
      const onlyNew = changed.filter((t) => startsWith(t.reply, CHANGED_START) && !t.reply.includes(NOTES.start.marker)).length;
      if (onlyNew !== 3) failures.push(`${tag("worker-edits")}: ${onlyNew} of 3 sessions after the change opened with only "${CHANGED_START}": ${changed.map(quoteReply).join(" | ")}`);
      if (!drop.lines.some((l) => l.startsWith("✎ Rule") && l.includes("removed"))) failures.push(`${tag("worker-edits")}: asking to drop showed no "Rule … removed" line: ${JSON.stringify(drop.lines)}; ${quoteReply(drop)}`);
      const neither = dropped.filter((t) => !startsWith(t.reply, CHANGED_START) && !startsWith(t.reply, NOTES.start.marker) && endsWith(t.reply, NOTES.end.marker)).length;
      if (neither !== 3) failures.push(`${tag("worker-edits")}: ${neither} of 3 sessions after the drop opened with neither start marker and still closed "${NOTES.end.marker}": ${dropped.map(quoteReply).join(" | ")}`);
      if (onlyNew === 3 && neither === 3) evidence.push(`${workerName}: after a change in words 3/3 opened "${CHANGED_START}" only; after a drop 3/3 opened with neither and kept "${NOTES.end.marker}"`);

      // page-edit-takes: the end marker changed through the action the Rules page calls.
      const read = await a.rules(workerName, { op: "read" });
      const endRule = read.rules.find((r) => r.text.includes(NOTES.end.marker));
      if (endRule === undefined) {
        failures.push(`${tag("page-edit-takes")}: the page's read shows no rule with "${NOTES.end.marker}": ${JSON.stringify(read.rules)}`);
      } else {
        const edited = await a.rules(workerName, { op: "change", version: read.version, number: endRule.number, current: endRule.text, text: endRule.text.replace(NOTES.end.marker, PAGE_END) });
        const afterPage = await threeFresh(a, worker, asks);
        record.pageEditTakes = { read, edited, afterPage };
        const takes = afterPage.filter((t) => endsWith(t.reply, PAGE_END) && !endsWith(t.reply, NOTES.end.marker)).length;
        if (takes !== 3) failures.push(`${tag("page-edit-takes")}: ${takes} of 3 sessions after the page edit closed with only "${PAGE_END}": ${afterPage.map(quoteReply).join(" | ")}`);
        else evidence.push(`${workerName}: after the page's edit 3/3 closed "${PAGE_END}" only`);
      }

      // cap-honest: filled to 20 on the page, then asked in words for a 21st.
      let list = await a.rules(workerName, { op: "read" });
      for (let i = list.rules.length + 1; i <= 20; i += 1) list = await a.rules(workerName, { op: "add", version: list.version, text: `Filler note ${i}: no action needed.` });
      const full = list.rules.map((r) => r.text);
      const ask21 = await a.say(worker, await a.fresh(worker), "Save this as a new standing rule: keep every reply under 80 words.");
      const kept = (await a.rules(workerName, { op: "read" })).rules.map((r) => r.text);
      record.capHonest = { full, ask21, kept };
      const refusedLine = ask21.lines.find((l) => l.startsWith("✎ Rule not added"));
      if (full.length !== 20) failures.push(`${tag("cap-honest")}: the page filled ${full.length} rules, not 20`);
      if (refusedLine === undefined) failures.push(`${tag("cap-honest")}: the 21st note showed no refusal line: ${JSON.stringify(ask21.lines)}; ${quoteReply(ask21)}`);
      if (JSON.stringify(kept) !== JSON.stringify(full)) failures.push(`${tag("cap-honest")}: the 20 rules changed: before ${JSON.stringify(full)}, after ${JSON.stringify(kept)}`);
      if (refusedLine !== undefined && JSON.stringify(kept) === JSON.stringify(full)) evidence.push(`${workerName}: the 21st note showed ${JSON.stringify(refusedLine)} and the 20 stayed as they were`);
    } finally {
      writeFileSync(join(store, "boot-2.log"), served.log());
      await served.stop();
    }
  }

  if (CONTROL !== "") assertPatched(CONTROL_PATCHES, REPO_ROOT, mark);
  writeFileSync(join(SCRATCH, "turns.json"), JSON.stringify(log, null, 2));
  console.error(`turns: ${join(SCRATCH, "turns.json")}`);
  return { failures, evidence: evidence.join("; ") };
});
