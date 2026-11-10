/**
 * Goal check, FIX-2526: a teammate from the Teammates lab's files takes your
 * edits, and only yours. See goal.md.
 *
 * The lab's own host and workers, in a child process with only the model
 * scripted (`host.mts`). The scripted model logs each turn's prompt; every leg
 * reads that prompt and the roster, never the adapter's calls.
 *
 *   a  Alice renames Chief of Staff and gives it new instructions: its next
 *      turn is told the new name and the new text, not the file's; researcher's
 *      next turn lists it by the new name.
 *   b  Alice's roster, read fresh: the same id, the new name, marked edited,
 *      listed once; the conversation is the same session, and the next turn
 *      still reads the earlier line.
 *   c  Bob, in the same organization: the file's name and text, on his roster
 *      and in his turn.
 *   d  Alice resets it: her next turn is the file's again, and the roster
 *      shows it unedited.
 *   e  Alice hires a teammate and renames it: same id and session, the new
 *      name in its next turn's identity line.
 *
 * Run:      pnpm tsx goals/teammates-lab/a-standard-teammate-takes-your-edits/run.mts
 * Controls: GOAL_CONTROL=ignore-edits  the turn reads the file, not the user's own
 *                                      row, for a standard id: must FAIL at a
 */
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { randomInt } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@flow-state-dev/client";
import { createWorkforceClient } from "@flow-state-dev/workforce/browser";
import {
  REPO_ROOT,
  assertPatched,
  describePatches,
  goalTmpDir,
  intentFreeEnv,
  modulePatchEnv,
  refuseIfAnswering,
  runGoal,
  sleep,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";

const HOST = fileURLToPath(new URL("./host.mts", import.meta.url));
const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS: Record<string, { does: string; patches: ModulePatch[] }> = {
  "ignore-edits": {
    does: "a standard id is always read from its file, so the user's own copy never reaches a turn",
    patches: [
      {
        module: "packages/workforce/src/workers/installation.ts",
        from: "if \\(stored !== undefined\\) \\{",
        to: "if (stored !== undefined && !standard.has(workerId)) {",
      },
    ],
  },
};
const control = CONTROL === "" ? undefined : CONTROLS[CONTROL];
if (CONTROL !== "" && control === undefined) throw new Error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);

const CHIEF = "teammates.chief-of-staff";
const RESEARCHER = "teammates.researcher";
/** The file's name for Chief of Staff, and a line of its file's instructions. */
const FILE_NAME = "Lead";
const FILE_LINE = "You run the team's work with the user";
const NEW_NAME = "Chief of Staff";
const NEW_LINE = `Answer in haiku. Marker ${randomInt(10_000, 99_999)}.`;
const EARLIER = `Remember the code word heron-${randomInt(10_000, 99_999)}.`;
const say = (s: string) => console.error(`[tm-edits ${new Date().toISOString().slice(11, 19)}] ${s}`);

await runGoal(async (failures) => {
  const dir = goalTmpDir("tm-standard-teammate-edits");
  const workdir = join(dir, "workdir");
  if (!existsSync(workdir)) {
    mkdirSync(workdir, { recursive: true });
    execFileSync("git", ["init", "-q", workdir]);
  }
  const prompts = join(dir, "prompts.jsonl");
  writeFileSync(prompts, "");
  const mark = join(dir, "patched.txt");
  const port = 47_000 + randomInt(0, 9_000);
  const origin = `http://127.0.0.1:${port}`;
  await refuseIfAnswering(origin);
  if (control !== undefined) say(`control ${CONTROL}: ${control.does}\n${describePatches(control.patches, REPO_ROOT)}`);

  let log = "";
  const child: ChildProcess = spawn("npx", ["tsx", HOST], {
    cwd: REPO_ROOT,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: intentFreeEnv(process.env, {
      GOAL_CONTROL: "",
      GOAL_PORT: String(port),
      GOAL_PROMPTS: prompts,
      GOAL_STORE: join(dir, "teammates.sqlite"),
      GOAL_WORKDIR: workdir,
      GOAL_RUNS: join(dir, "runs"),
      ...(control === undefined ? {} : modulePatchEnv(control.patches, REPO_ROOT, mark)),
    }),
  });
  const keep = (chunk: Buffer) => {
    log += chunk.toString();
    writeFileSync(join(dir, "server.log"), log);
  };
  child.stdout!.on("data", keep);
  child.stderr!.on("data", keep);
  try {
    for (const until = Date.now() + 120_000; !log.includes("ready on"); await sleep(250)) {
      if (child.exitCode !== null || Date.now() > until) throw new Error(`setup: the host never came up; log tail:\n${log.slice(-2000)}`);
    }

    const as = (userId: string) => {
      const fsd = createClient({ userId, baseUrl: origin });
      return { fsd, workforce: createWorkforceClient(fsd) };
    };
    const alice = as("alice");
    const bob = as("bob");

    /** One turn on `worker`'s conversation as `who`: the session, and the prompt its first step was handed. */
    const turn = async (who: ReturnType<typeof as>, worker: string, message = "Hello.") => {
      const session = await who.workforce.ensureWorkerSession({ worker });
      const before = readFileSync(prompts, "utf8").split("\n").filter(Boolean).length;
      const sent = await who.fsd.flow(session.flowId ?? session.flowKind).send("respond", { message }, { sessionId: session.id });
      const end = await sent.wait({ timeoutMs: 60_000 });
      if (end.status !== "completed") throw new Error(`setup: ${worker}'s turn ended ${end.status}`);
      const lines = readFileSync(prompts, "utf8").split("\n").filter(Boolean).slice(before);
      const said = lines.map((l) => (JSON.parse(l) as { said: string }).said).find((s) => s.includes(message));
      if (said === undefined) throw new Error(`setup: no prompt for ${worker}'s turn "${message}"`);
      return { session: session.id, said };
    };
    const identity = (said: string) => /You are ([^,.]+)[,.]/.exec(said)?.[1];
    const row = async (who: ReturnType<typeof as>, id: string) => (await who.workforce.roster()).filter((r) => r.id === id);

    // Before: Alice talks to Chief of Staff once, on the file's worker.
    const first = await turn(alice, CHIEF, EARLIER);
    if (identity(first.said) !== FILE_NAME) throw new Error(`setup: before any edit the turn said "You are ${identity(first.said)}", not ${FILE_NAME}`);

    // a — the edit reaches the next turn.
    await alice.workforce.edit({ id: CHIEF, name: NEW_NAME, instructions: NEW_LINE });
    const edited = await turn(alice, CHIEF, "What do you do?");
    if (identity(edited.said) !== NEW_NAME) failures.push(`a:identity — the next turn said "You are ${identity(edited.said)}", not ${NEW_NAME}`);
    if (!edited.said.includes(NEW_LINE)) failures.push("a:instructions — the next turn's prompt doesn't hold the new instructions");
    if (edited.said.includes(FILE_LINE)) failures.push("a:instructions — the next turn's prompt still holds the file's instructions");
    const peer = await turn(alice, RESEARCHER, "Who is on the team?");
    if (!peer.said.includes(`- ${NEW_NAME} (${CHIEF})`)) failures.push(`a:roster — researcher's roster doesn't list ${CHIEF} as ${NEW_NAME}`);

    // b — a fresh read keeps who it is.
    const fresh = as("alice");
    const listed = await row(fresh, CHIEF);
    if (listed.length !== 1) failures.push(`b:once — the roster lists ${CHIEF} ${listed.length} times`);
    else if (listed[0].name !== NEW_NAME || !listed[0].edited || !listed[0].standard) failures.push(`b:row — ${JSON.stringify(listed[0])}`);
    const again = await fresh.workforce.ensureWorkerSession({ worker: CHIEF });
    if (again.id !== first.session) failures.push(`b:conversation — the conversation moved from ${first.session} to ${again.id}`);
    if (!edited.said.includes(EARLIER)) failures.push("b:conversation — the turn after the edit no longer reads the earlier line");

    // c — Bob is untouched.
    const bobs = await row(bob, CHIEF);
    if (bobs[0]?.name !== FILE_NAME || bobs[0]?.edited !== false) failures.push(`c:roster — Bob's roster reads ${JSON.stringify(bobs)}`);
    const bobTurn = await turn(bob, CHIEF, "Hi from Bob.");
    if (identity(bobTurn.said) !== FILE_NAME || bobTurn.said.includes(NEW_LINE) || !bobTurn.said.includes(FILE_LINE)) {
      failures.push(`c:turn — Bob's turn said "You are ${identity(bobTurn.said)}"${bobTurn.said.includes(NEW_LINE) ? ", with Alice's instructions" : ""}`);
    }

    // d — Reset puts the file back.
    await alice.workforce.reset(CHIEF);
    const back = await turn(alice, CHIEF, "And now?");
    if (identity(back.said) !== FILE_NAME || !back.said.includes(FILE_LINE) || back.said.includes(NEW_LINE)) {
      failures.push(`d:turn — after Reset the turn said "You are ${identity(back.said)}"${back.said.includes(NEW_LINE) ? ", with the edited instructions" : ""}`);
    }
    const reset = await row(alice, CHIEF);
    if (reset.length !== 1 || reset[0].edited || reset[0].name !== FILE_NAME) failures.push(`d:roster — after Reset the roster reads ${JSON.stringify(reset)}`);
    if (back.session !== first.session) failures.push(`d:conversation — Reset moved the conversation to ${back.session}`);

    // e — a hired teammate's rename.
    await alice.workforce.hire({ id: "tester", description: "Runs the tests.", instructions: "Run them all." });
    const hired = await turn(alice, "tester", "Hello, tester.");
    await alice.workforce.edit({ id: "tester", name: "QA Bot" });
    const renamed = await turn(alice, "tester", "Who are you now?");
    if (identity(renamed.said) !== "QA Bot") failures.push(`e:identity — the renamed teammate's turn said "You are ${identity(renamed.said)}"`);
    if (renamed.session !== hired.session) failures.push(`e:conversation — the rename moved the conversation to ${renamed.session}`);
    const tester = await row(alice, "tester");
    if (tester[0]?.id !== "tester" || tester[0]?.name !== "QA Bot") failures.push(`e:roster — ${JSON.stringify(tester)}`);

    if (control !== undefined) assertPatched(control.patches, REPO_ROOT, mark);
    return {
      failures,
      evidence: `edited ${CHIEF} as "${NEW_NAME}": next turn "You are ${identity(edited.said)}" with the new text, same session ${first.session}; Bob saw "${identity(bobTurn.said)}"; after Reset "You are ${identity(back.said)}"; tester renamed "${identity(renamed.said)}" on ${renamed.session}`,
    };
  } finally {
    stopProcessGroup(child, "SIGKILL");
  }
});
