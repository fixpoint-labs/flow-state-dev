/**
 * Goal check, FIX-2523: in both labs, a line's images reach the worker it is
 * sent to, and the line keeps them after a reload. See goal.md.
 *
 *   Host:   each lab's own host (`labs/claude-code-style/host.mts`,
 *           `labs/teammates/host.mts`), in this process, on a SQLite store in
 *           a scratch folder, driven through the calls each lab's page makes
 *           (each lab's `src/app/` calls; the Teammates lab's under its
 *           provider, with a follower on Lead's conversation): `upload` for
 *           each file, then `send` with the references beside the line.
 *   Input:  two fresh PNGs, a random word drawn on each. The line names
 *           neither word.
 *   Legs:   the Claude Code-style lab's main session and the Teammates lab's
 *           Lead each name both words; a fresh client's read of each thread
 *           shows the line with both files, whose bytes read back.
 *
 * Control (same command): `GOAL_CONTROL=drop-attachments` patches both
 * labs' `send` to carry no files, as on `main` before this change.
 * `names-both` must FAIL in both labs.
 *
 * Run: pnpm tsx --tsconfig labs/teammates/tsconfig.json goals/attachments/lab-composers/run.mts
 *      (the tsconfig resolves the labs' `@/` imports the adapters load)
 */
import { execFileSync, spawnSync } from "node:child_process";
import { randomInt } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, sessionFeed, type Client } from "@flow-state-dev/client";
import { sessionTurnsViewRef } from "@flow-state-dev/workforce/browser";
import type { FileContent, OutputItem } from "@flow-state-dev/core/items";
import { conversationLines } from "@flow-state-dev/react";
import { createInProcessFetch } from "@flow-state-dev/engine";
import { openClaudeCodeStyle } from "../../../labs/claude-code-style/host.mts";
import { appCalls } from "../../../labs/claude-code-style/src/app/index.ts";
import { THREAD_ITEMS } from "../../../labs/claude-code-style/src/app/feed.ts";
import { textOf as ccsTextOf } from "../../../labs/claude-code-style/src/components/lines.tsx";
import { openTeammates } from "../../../labs/teammates/host.mts";
import { filesOf, textOf } from "../../../labs/teammates/src/components/lines.tsx";
import type { ConversationView } from "../../../labs/teammates/src/lib/conversation.ts";
import { teammatesScreen } from "../../teammates-lab/screen.mts";
import {
  REPO_ROOT,
  RUN_STAMP,
  assertPatched,
  describePatches,
  goalModel,
  goalTmpDir,
  keysServing,
  modulePatchEnv,
  runGoal,
  type ModulePatch,
} from "../../lib/index.mts";
import { wordPng } from "../reach-the-model/png.mts";

const SCRATCH = goalTmpDir("lab-composers");
const MODEL = goalModel("openai/gpt-6-luna");
const USER_ID = "u_lab_composers";
const TURN_TIMEOUT_MS = 240_000;
const LINE = "Two images are attached. What word is written on each image? Answer with the two words only.";
const LEAD = "teammates.chief-of-staff";

/** Held-out: two of these, drawn per run. Any pair of distinct A–Z words works. */
const WORDS = [
  "MANGO", "TIGER", "PLANET", "CASTLE", "RIVER", "FALCON", "LEMON", "ORBIT", "WALNUT", "BISON",
  "CANYON", "HARBOR", "VELVET", "JUNGLE", "PEPPER", "QUARTZ", "SUMMIT", "TULIP", "ZEBRA", "KETTLE",
];

const CONTROL = process.env.GOAL_CONTROL ?? "";
const CONTROLS: Record<string, { patches: ModulePatch[] }> = {
  // Each lab's send carries the line alone, as on main before this change.
  "drop-attachments": {
    patches: ["labs/claude-code-style/src/app/calls.ts", "labs/teammates/src/app/conversations.ts"].flatMap((module) => [
      { module, from: String.raw`attachments: \[\.\.\.attachments\] \}\);`, to: "attachments: [] });" },
    ]),
  },
};
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const control = CONTROL === "" ? undefined : CONTROLS[CONTROL]!;
if (control !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(control.patches, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, ...modulePatchEnv(control.patches, REPO_ROOT, mark) },
  });
  assertPatched(control.patches, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

const say = (s: string) => console.error(`[lab-composers ${new Date().toISOString().slice(11, 19)}] ${s}`);

/** The latest value `watch` reports once `check` holds for it, or a throw after `ms`. */
function until<T>(watch: (on: (value: T) => void) => () => void, check: (value: T) => boolean, ms = TURN_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve, reject) => {
    let last: T | undefined;
    let stop = () => {};
    const timer = setTimeout(() => {
      stop();
      reject(new Error(`never held; last: ${JSON.stringify(last)?.slice(0, 600)}`));
    }, ms);
    stop = watch((value) => {
      last = value;
      if (!check(value)) return;
      clearTimeout(timer);
      queueMicrotask(() => stop());
      resolve(value);
    });
  });
}

/** The Claude Code-style thread as its screen reads it: the session's items on the feed, and whether a turn runs, from workforce's session turns view. */
type CcsThread = { entries: Array<{ kind: string; text?: string; files?: FileContent[] }>; running: boolean };
/** The thread's lines (React's conversation model, as the lab draws them), with what a line of words says and carries. */
const ccsEntriesOf = (items: OutputItem[]): CcsThread["entries"] =>
  conversationLines(items).map((line) =>
    line.kind === "user" || line.kind === "assistant"
      ? { kind: line.kind, text: ccsTextOf(line.item), files: line.item.content.filter((part): part is FileContent => part.type === "file") }
      : { kind: line.kind },
  );
function watchCcsThread(client: Client, sessionId: string, on: (view: CcsThread) => void): () => void {
  let items: OutputItem[] | undefined;
  let running: boolean | undefined;
  const tell = () => {
    if (items !== undefined && running !== undefined) on({ entries: ccsEntriesOf(items), running });
  };
  const feed = sessionFeed(client, sessionId, { itemTypes: [...THREAD_ITEMS] });
  const stopFeed = feed.subscribe(({ items: next, state }) => {
    if (next.length === 0 && state === "connecting") return;
    items = next as unknown as OutputItem[];
    tell();
  });
  const stopTurns = client.live<{ status: string }[]>([], {
    topicsFromResult: true,
    read: async () => {
      const answer = await client.view(sessionTurnsViewRef(), { sessionId });
      return { value: answer.value, topics: answer.topics, ...(answer.hears === undefined ? {} : { hears: answer.hears }) };
    },
    onValue: (turns) => {
      running = turns.some((turn) => turn.status === "in_progress");
      tell();
    },
    pollIntervalMs: 1_500,
  }).close;
  return () => {
    stopFeed();
    feed.close();
    stopTurns();
  };
}

/** A scratch git checkout a lab may work in: its `.gitignore` keeps a run's notes out. */
function checkout(dir: string): string {
  const git = { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
  mkdirSync(dir, { recursive: true });
  execFileSync("git", ["init", "-q", "-b", "main", dir]);
  writeFileSync(join(dir, ".gitignore"), "**/.fsdev/\n");
  writeFileSync(join(dir, "README.md"), "A scratch checkout.\n");
  execFileSync("git", ["-C", dir, "add", "-A"], { env: git });
  execFileSync("git", ["-C", dir, "commit", "-q", "-m", "init"], { env: git });
  return dir;
}

/** What one lab's leg read. */
interface Leg {
  reply: string;
  reloadedFiles: FileContent[];
  readBack: number[];
}

/** One user line with files, and what the lab shows for it: the turn's answer, then a fresh adapter's read of the line. */
async function legOf<View>(
  lab: { upload: (r: { data: Blob; mediaType?: string; filename?: string }) => Promise<FileContent>; send: (id: string, text: string, files: readonly FileContent[]) => Promise<void>; readFile: (file: FileContent) => Promise<Blob> },
  fresh: typeof lab,
  watch: (adapter: typeof lab, on: (view: View) => void) => () => void,
  entriesOf: (view: View) => Array<{ kind: string; text?: string; files?: FileContent[] }>,
  running: (view: View) => boolean,
  sessionId: string,
  words: string[],
): Promise<Leg> {
  const shots: FileContent[] = [];
  for (const [i, word] of words.entries()) {
    shots.push(await lab.upload({ data: new Blob([wordPng(word) as Uint8Array<ArrayBuffer>], { type: "image/png" }), mediaType: "image/png", filename: `image-${i + 1}.png` }));
  }
  await lab.send(sessionId, LINE, shots);
  const after = (view: View) => {
    const entries = entriesOf(view);
    return entries.slice(entries.findIndex((e) => e.kind === "user" && e.text === LINE) + 1);
  };
  const done = await until<View>(
    (on) => watch(lab, on),
    (view) => !running(view) && after(view).some((e) => e.kind === "assistant" || e.kind === "failed"),
  );
  const reply = after(done)
    .filter((e) => e.kind === "assistant")
    .map((e) => e.text ?? "")
    .join(" ");
  // A reload: a fresh adapter, as a reopened page reads the thread.
  const reloaded = await until<View>((on) => watch(fresh, on), (view) => entriesOf(view).some((e) => e.kind === "user" && e.text === LINE));
  const line = entriesOf(reloaded).find((e) => e.kind === "user" && e.text === LINE);
  const reloadedFiles = line?.files ?? [];
  const readBack = await Promise.all(reloadedFiles.map(async (file) => (await fresh.readFile(file)).size));
  return { reply, reloadedFiles, readBack };
}

await runGoal(async (failures, tell) => {
  const key = keysServing(MODEL).find((k) => (process.env[k] ?? "") !== "");
  if (key === undefined) {
    return { failures: [`blocked: no key here serves ${MODEL}; none of ${keysServing(MODEL).join(", ")} is set`], evidence: "" };
  }
  rmSync(SCRATCH, { recursive: true, force: true });
  mkdirSync(SCRATCH, { recursive: true });
  // The default blob store is on disk under the working directory: keep it in scratch.
  process.chdir(SCRATCH);
  const first = WORDS[randomInt(WORDS.length)]!;
  let second = first;
  while (second === first) second = WORDS[randomInt(WORDS.length)]!;
  say(`model ${MODEL}; words ${first}, ${second}${CONTROL ? `; control ${CONTROL}` : ""}`);

  // --- The Claude Code-style lab: the main session --------------------------
  const repo = checkout(join(SCRATCH, "ccs-repo"));
  const { flowState: ccsHost } = await openClaudeCodeStyle({ data: join(SCRATCH, "ccs"), userId: USER_ID, model: MODEL, utilityModel: MODEL, repositories: [repo] });
  const ccsFetch = createInProcessFetch(ccsHost as never) as never;
  const ccsClient = () => createClient({ userId: USER_ID, baseUrl: "", fetcher: ccsFetch });
  const ccsLab = () => {
    const client = ccsClient();
    return { client, ...appCalls(client, { fetcher: ccsFetch }) };
  };
  const ccs = ccsLab();
  const project = await ccs.createProject("lab-composers", `file://${repo}`);
  const ccsSession = (await ccs.openSession("session", project.id)).id;
  const main = await legOf<CcsThread>(
    ccs,
    ccsLab(),
    (lab, on) => watchCcsThread((lab as ReturnType<typeof ccsLab>).client, ccsSession, on),
    (view) => view.entries,
    (view) => view.running,
    ccsSession,
    [first, second],
  );
  say(`main session replied: ${main.reply.slice(0, 200)}`);

  // --- The Teammates lab: Lead, a generator teammate ------------------------
  const tmHost = await openTeammates({ store: join(SCRATCH, "teammates.sqlite"), model: MODEL, userId: USER_ID, workdir: checkout(join(SCRATCH, "tm-repo")), runsRoot: join(SCRATCH, "tm-runs") });
  const tmFetch = createInProcessFetch(tmHost as never) as never;
  // The lab's screen half, as a page holds it: its provider over a client, and a follower per conversation watched.
  const tmScreen = () => teammatesScreen(createClient({ userId: USER_ID, baseUrl: "", fetcher: tmFetch }), { fetcher: tmFetch });
  const tm = await tmScreen();
  const leadSession = await tm.calls.open(LEAD);
  const freshTm = await tmScreen();
  const lab = (screen: typeof tm) => ({ ...screen.calls, screen });
  const lead = await legOf<ConversationView>(
    lab(tm),
    lab(freshTm),
    (adapter, on) => (adapter as ReturnType<typeof lab>).screen.watch(leadSession, (view) => on(view)),
    (view) => view.lines.map((line) => (line.kind === "user" || line.kind === "assistant" ? { kind: line.kind, text: textOf(line.item), files: filesOf(line.item) } : { kind: line.kind })),
    (view) => view.running,
    leadSession,
    [first, second],
  );
  say(`Lead replied: ${lead.reply.slice(0, 200)}`);

  for (const [name, leg] of [["main session", main], ["Lead", lead]] as const) {
    // names-both: the worker read both images.
    for (const word of tell.over(`names-both · ${name} · the two words`, [first, second])) {
      if (!leg.reply.toUpperCase().includes(word)) failures.push(`names-both: ${name}'s reply does not name ${word}: "${leg.reply.slice(0, 200)}"`);
    }
    // reload: the line keeps both files, as references whose bytes read back.
    if (leg.reloadedFiles.length !== 2 || leg.reloadedFiles.some((f) => !f.data.startsWith("fsd-blob:"))) {
      failures.push(`reload: ${name}'s line holds ${leg.reloadedFiles.length} files after a reload, not two references`);
    }
    if (leg.readBack.some((size) => size === 0)) failures.push(`reload: a file on ${name}'s line read back empty`);
  }

  // A coding run (the Claude Code-style lab's Claude Code task, the Teammates lab's coding
  // worker) gets a line's files only through the task its worker files, and a filed task
  // carries no files until FIX-2522 lands. Named, never skipped.
  failures.push("blocked: the coding legs wait on a filed task carrying its turn's files (FIX-2522); the generator legs above ran");

  await (ccsHost as unknown as { dispose?: () => Promise<void> }).dispose?.();
  tm.close();
  freshTm.close();
  await (tmHost as unknown as { dispose?: () => Promise<void> }).dispose?.();
  return {
    failures,
    evidence:
      `words ${first}/${second}; main session replied "${main.reply.slice(0, 80)}", reload ${main.reloadedFiles.length} files (${main.readBack.join("/")} bytes); ` +
      `Lead replied "${lead.reply.slice(0, 80)}", reload ${lead.reloadedFiles.length} files (${lead.readBack.join("/")} bytes)`,
  };
});
