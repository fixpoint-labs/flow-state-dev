/**
 * Goal check: a worker works things out for itself before it asks the user
 * (FIX-2364). On a real model, over the Teammates lab's HTTP API, against
 * `fsdev dev --app @flow-state-dev/teammates`. See goal.md for the contract.
 *
 * Leg 1: the user hires a worker of their own with a description and nothing
 * else (no instructions, no file tools), so what it is told about asking comes
 * from the built-in worker flow's default layer alone. The working folder's
 * last commit changed `docs/pricing.md` and wrote a wrong saving (40%). The
 * worker is asked to review "PR #42", which it can't see. Graded on every
 * reply its conversation holds once it goes quiet:
 *   - looked: it called a tool (asking a teammate is looking);
 *   - no paste: no reply asks the user to paste, share or send the diff,
 *     link or copy;
 * Reported, not graded: whether a reply names the 40% claim, which it can
 * only learn through a teammate who reads the file.
 * Leg 2 (FIX-2336's check, kept as a regression): Chief of Staff, asked what
 * its teammates are doing, messages them or reads their conversations, and
 * offers nothing it could have done.
 *
 * Control (`GOAL_CONTROL=old-rule`, same command): the layer's rule is
 * patched back to its one-line wording from before FIX-2364. Leg 1 must FAIL.
 * Leg 2 is not the control's: Chief of Staff's own file says the same.
 *
 * Run: pnpm tsx goals/teammates-lab/works-it-out-first/run.mts
 */
import { execFileSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import {
  assertPatched,
  describePatches,
  goalTmpDir,
  loadFixture,
  modulePatchEnv,
  REPO_ROOT,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";
import { itemsOf, sleep, startTeammates, type Fsd } from "../lab.mts";

const fixture = loadFixture<{
  worker: { id: string; description: string };
  tools: string[] | null;
  file: string;
  before: string;
  after: string;
  commit: string;
  asks: string[];
  lead: { id: string; asks: string[] };
}>(import.meta.url);
const CONTROL = process.env.GOAL_CONTROL ?? "";
const RUNS = Number(process.env.GOAL_RUNS ?? 3);
const USER = "u_goal";
const ROSTER = "workforce-roster";
/** A request in one of these has ended; any other (running, queued, parked on a reply) is still owed. */
const ENDED = new Set(["completed", "failed", "incomplete", "aborted", "interrupted", "cancelled"]);

/** The `old-rule` control: the layer's rule as it read before FIX-2364, patched in as the server loads it. */
const OLD_RULE: ModulePatch[] = [
  {
    module: "packages/workforce/src/messages/worker-identity.ts",
    from: String.raw`lines\.push\("", TOOL_USE_RULE\)`,
    to: `lines.push("", "Use your tools to do what you're asked before you answer. Don't offer to do something you can do now: do it.")`,
  },
];
if (!["", "old-rule"].includes(CONTROL)) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);

/** The working folder: a git checkout whose last commit changed the pricing copy. */
function seedWorkdir(dir: string): string {
  const workdir = join(dir, "workdir");
  const file = join(workdir, fixture.file);
  mkdirSync(dirname(file), { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-C", workdir, "-c", "user.name=goal", "-c", "user.email=goal@example.com", ...args]);
  execFileSync("git", ["init", "-q", workdir]);
  writeFileSync(file, fixture.before);
  git("add", "-A");
  git("commit", "-q", "-m", "Pricing page");
  writeFileSync(file, fixture.after);
  git("commit", "-q", "-am", fixture.commit);
  return workdir;
}

/**
 * Say one line in a worker's conversation and wait for it to go quiet: every
 * reply the conversation then holds, and the tools its turns called. A reply
 * can come in a later turn (a teammate's reply waking it, or a turn parked on
 * one), so the conversation is read once no request in any of the user's
 * conversations has been open for 20s, and only what came after this ask is
 * graded: an earlier ask's reply or tool calls never count for this one.
 */
async function ask(fsd: Fsd, worker: string, line: string) {
  const session = await createWorkforceClient(fsd).ensureWorkerSession({ worker });
  const before = (await itemsOf(fsd, session.id)).length;
  const sent = await fsd.flow(session.flowId ?? session.flowKind).send("respond", { message: line }, { sessionId: session.id });
  await sent.wait();
  for (let waited = 0, quiet = 0; waited < 8 * 60_000 && quiet < 20_000; waited += 2_000) {
    // Every conversation of the user's, not only this one: a teammate's turn
    // runs in its own conversation, and its reply wakes this one after.
    const all = (await fsd.sessions.list({ userId: USER })) as Array<{ id: string }>;
    let running = 0;
    for (const { id } of all) {
      const listed = (await fsd.sessions.requests(id, { limit: 50 })) as Array<{ status?: string }>;
      running += listed.filter((request) => !ENDED.has(String(request.status))).length;
    }
    quiet = running === 0 ? quiet + 2_000 : 0;
    await sleep(2_000);
  }
  const items = (await itemsOf(fsd, session.id)).slice(before);
  const reply = items
    .filter((item) => item.type === "message" && item.role === "assistant")
    .map((item) => (item.content ?? []).map((part) => part.text ?? "").join(""))
    .join("\n");
  return { reply, toolCalls: items.filter((item) => item.type === "tool_output").map((item) => item.blockName ?? "(unnamed)") };
}

const pick = <T,>(list: T[]): T => list[randomInt(0, list.length)]!;
/**
 * An ask for the user to hand over what the system holds: "please share the
 * diff", "paste it here", "once you send the link". Asking a teammate is
 * looking, not this.
 */
const ASKS_USER_TO_PASTE = new RegExp(
  [
    String.raw`\b(please|can you|could you|would you|if you|once you|when you)\b[^.?!\n]{0,40}\b(paste|share|send|provide|upload|forward|give)\b[^.?!\n]{0,60}\b(diff|patch|commit|changes?|file|text|copy|contents?|link|PR|pull request)\b`,
    String.raw`\b(paste|share|send|provide)\b[^.?!\n]{0,60}\b(here|in your next message|with me|in this chat)\b`,
  ].join("|"),
  "i"
);

/** An offer to do what the worker could have done: "if you want, I can ask them". */
const OFFERS = /\b(if you(?:'d| would)? (?:like|want)|want me to|shall I|should I)\b[^.?!\n]{0,60}\b(I can|I'll|me to|ask|message|check)\b/i;

await runGoal(async (failures, tell) => {
  if (CONTROL === "old-rule") console.error(describePatches(OLD_RULE, REPO_ROOT));
  const notes: string[] = [];
  const graded: number[] = [];
  for (let n = 1; n <= RUNS; n += 1) {
    const fail = (what: string) => failures.push(`run ${n} · ${what}`);
    const dir = goalTmpDir(`works-it-out-first-${n}`);
    const mark = join(dir, "patched.txt");
    const lab = await startTeammates(dir, USER, CONTROL === "old-rule" ? modulePatchEnv(OLD_RULE, REPO_ROOT, mark) : {}, seedWorkdir(dir));
    try {
      const me = createClient({ userId: USER, baseUrl: lab.origin });
      const rosterSession =
        ((await me.sessions.list({ flowKind: ROSTER, userId: USER })) as Array<{ id: string }>)[0]?.id ??
        ((await me.flow(ROSTER).createSession()) as { id: string }).id;
      const hired = await me.flow(ROSTER).send(
        "hire",
        { id: fixture.worker.id, flow: "agent", description: fixture.worker.description, ...(fixture.tools === null ? {} : { settings: { tools: fixture.tools } }) },
        { sessionId: rosterSession }
      );
      const hire = await hired.wait();
      if ((hire as { status?: string }).status !== "completed") throw new Error(`setup: the hire of ${fixture.worker.id} ended ${JSON.stringify(hire).slice(0, 400)}`);

      const { reply, toolCalls } = await ask(me, fixture.worker.id, pick(fixture.asks));
      if (reply.trim() === "") throw new Error(`run ${n}: the worker gave no reply, nothing to grade`);
      if (toolCalls.length === 0) fail(`leg 1 · looked: the turn called no tool before answering: ${JSON.stringify(reply.slice(0, 400))}`);
      const paste = reply.match(ASKS_USER_TO_PASTE);
      if (paste !== null) fail(`leg 1 · no paste: the reply asks the user for it ("${paste[0]}"): ${JSON.stringify(reply.slice(0, 500))}`);
      // Not graded: whether it got far enough to review. The issue asks that it look and not ask
      // for a paste; reaching the file depends on which teammate it asks and what they find.
      const reviewed = /40\s*%/.test(reply);
      console.error(`run ${n}: tools [${toolCalls.join(", ")}]\n${reply}\n---`);
      notes.push(`run ${n}: tools [${toolCalls.join(", ")}], reviewed ${reviewed}, ${JSON.stringify(reply.slice(0, 160))}`);

      // ── Leg 2 (FIX-2336's check, kept): asked about its teammates, Chief of Staff acts, unpushed.
      const lead = await ask(me, fixture.lead.id, pick(fixture.lead.asks));
      if (lead.reply.trim() === "") throw new Error(`run ${n}: Chief of Staff gave no reply, nothing to grade`);
      const reached = lead.toolCalls.filter((name) => /sendMessage|consultSessionHistory/.test(name));
      if (reached.length === 0) fail(`leg 2 · acted: Chief of Staff neither messaged a teammate nor read their conversation: tools [${lead.toolCalls.join(", ")}]`);
      const offer = lead.reply.match(OFFERS);
      if (offer !== null) fail(`leg 2 · no offer: "${offer[0]}": ${JSON.stringify(lead.reply.slice(0, 400))}`);
      console.error(`run ${n} leg 2: tools [${lead.toolCalls.join(", ")}]\n${lead.reply}\n---`);
      notes.push(`run ${n} leg 2: tools [${lead.toolCalls.join(", ")}]`);
      if (CONTROL === "old-rule") assertPatched(OLD_RULE, REPO_ROOT, mark);
    } finally {
      stopProcessGroup(lab.child);
    }
    graded.push(n);
  }
  tell.over("runs graded", graded);
  return { failures, evidence: `${RUNS} of ${RUNS} runs: ${notes.join("; ")}` };
});
