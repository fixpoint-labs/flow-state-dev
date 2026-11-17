/**
 * FIX-2771's factual base, re-derived: which of Teammates' inventory
 * allowlist entries this issue removes, that every entry has exactly one
 * owner (a totality check, so an entry nobody named is reported), and the
 * configuration's line count against its 300-line cap.
 *
 * Retained spec evidence, not production code: a plain `.mts` script, not a
 * test file, and no workspace's test glob reaches `specs/`.
 *
 * Run from the repository root:
 *   node specs/issues/FIX-2771/poc/entries/check.mts            # the check
 *   node specs/issues/FIX-2771/poc/entries/check.mts --control  # plants an entry nobody owns: must exit 1
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const LAB = "labs/teammates";
const CAP = 300;

type Owner = "FIX-2771" | "FIX-2772" | "FIX-2773" | "last child";

/**
 * The owner of each entry, by `file · symbol · kind`, as the coordinator
 * settled the Teammates seams (2026-11-17): the busy dot is FIX-2771's;
 * `steps.ts` is FIX-2772's; the shared plumbing types and the fake app's
 * `gone` entry go with whichever Teammates child merges last ("last child").
 */
const OWNERS: Record<string, Owner> = {
  "configuration · (lines) · cap": "FIX-2771",
  "src/app/setup.ts · viewRef · client import": "FIX-2771",
  "src/app/setup.ts · AppHarness · type": "FIX-2771",
  "src/app/setup.ts · AppContext · type": "FIX-2771",
  "src/app/setup.ts · SetupCalls · type": "FIX-2771",
  "src/app/talk.ts · readEveryCollectionPage · client import": "FIX-2771",
  "src/app/talk.ts · topic · client import": "FIX-2771",
  "src/app/talk.ts · AppTalk · type": "FIX-2771",
  "src/app/talk.ts · TalkCalls · type": "FIX-2771",
  "src/app/workers.ts · topic · client import": "FIX-2771",
  "src/app/workers.ts · AppWorker · type": "FIX-2771",
  "src/app/workers.ts · TeammateEdit · type": "FIX-2771",
  "src/app/workers.ts · NewTeammate · type": "FIX-2771",
  "src/app/workers.ts · Activity · type": "FIX-2771",
  "src/app/workers.ts · WorkerCalls · type": "FIX-2771",

  "src/app/conversations.ts · topic · client import": "FIX-2772",
  "src/app/conversations.ts · send · flow call": "FIX-2772",
  "src/app/conversations.ts · interrupt · flow call": "FIX-2772",
  "src/app/conversations.ts · answerApproval · flow call": "FIX-2772",
  "src/app/conversations.ts · retry · flow call": "FIX-2772",
  "src/app/conversations.ts · ConversationEntry · type": "FIX-2772",
  "src/app/conversations.ts · ConversationView · type": "FIX-2772",
  "src/app/conversations.ts · ConversationCalls · type": "FIX-2772",
  "src/app/files.ts · createClient · client import": "FIX-2772",
  "src/app/files.ts · AppConnection · type": "FIX-2772",
  "src/app/files.ts · FileCalls · type": "FIX-2772",
  "src/app/window.ts · topic · client import": "FIX-2772",
  "src/app/window.ts · WindowMark · type": "FIX-2772",
  "src/app/window.ts · WindowRead · type": "FIX-2772",
  "src/app/window.ts · HistorySummaryFace · type": "FIX-2772",
  "src/app/window.ts · WindowCalls · type": "FIX-2772",
  "src/components/App.tsx · ClientHttpError · client import": "FIX-2772",
  "src/lib/session-feed.ts · sessionFeed · client import": "FIX-2772",
  "src/lib/session-feed.ts · watch · subscribe call": "FIX-2772",
  "src/lib/session-feed.ts · watchState · subscribe call": "FIX-2772",
  "src/lib/session-feed.ts · watchRuns · subscribe call": "FIX-2772",
  "src/lib/session-feed.ts · SessionFeed · type": "FIX-2772",

  "src/app/runs.ts · bindStoreToCallbacks · client import": "FIX-2773",
  "src/app/runs.ts · createRequestStreamStore · client import": "FIX-2773",
  "src/app/runs.ts · topic · client import": "FIX-2773",
  "src/app/runs.ts · open · flow call": "FIX-2773",
  "src/app/runs.ts · WorkingNow · type": "FIX-2773",
  "src/app/runs.ts · RunCalls · type": "FIX-2773",
  "src/app/tasks.ts · withBrief · flow call": "FIX-2773",
  "src/app/tasks.ts · BoardTask · type": "FIX-2773",
  "src/app/tasks.ts · TaskWaiting · type": "FIX-2773",
  "src/app/tasks.ts · TaskActions · type": "FIX-2773",
  "src/app/tasks.ts · TaskAnswer · type": "FIX-2773",
  "src/app/tasks.ts · TaskCalls · type": "FIX-2773",

  "src/app/steps.ts · SessionStep · type": "FIX-2772",
  "src/app/steps.ts · StepRun · type": "FIX-2772",
  "src/app/steps.ts · RunSummary · type": "FIX-2772",

  "test/fake-app.ts · (file) · gone": "last child",
  "src/app/calls.ts · AppCalls · type": "last child",
  "src/app/items.ts · Item · type": "last child",
  "src/app/reads.ts · Unsubscribe · type": "last child",
  "src/app/state.ts · AppState · type": "last child",
};

type Entry = { file: string; symbol: string; kind: string };
const keyOf = (e: Entry) => `${e.file} · ${e.symbol} · ${e.kind}`;

const allowlist: Entry[] = JSON.parse(readFileSync(join(LAB, "test/inventory-allowlist.json"), "utf8"));
if (process.argv.includes("--control")) allowlist.push({ file: "src/app/planted.ts", symbol: "Planted", kind: "type" });

const problems: string[] = [];
const seen = new Map<string, number>();
for (const entry of allowlist) {
  const key = keyOf(entry);
  seen.set(key, (seen.get(key) ?? 0) + 1);
  if (OWNERS[key] === undefined) problems.push(`no owner: ${key}`);
}
for (const [key, n] of seen) if (n > 1) problems.push(`repeated ${n} times, owned once: ${key}`);
for (const key of Object.keys(OWNERS)) if (!seen.has(key)) problems.push(`owned, but not on the allowlist: ${key}`);

const by = (owner: Owner) => allowlist.filter((e) => OWNERS[keyOf(e)] === owner).map(keyOf);
for (const owner of ["FIX-2771", "FIX-2772", "FIX-2773", "last child"] as const) {
  const keys = by(owner);
  console.log(`${owner}: ${keys.length}`);
  if (owner === "FIX-2771") for (const k of keys) console.log(`  ${k}`);
}
console.log(`allowlist: ${allowlist.length} entries`);

/** The configuration, as the inventory counts it: `fsdev.config.mts`, `host.mts`, and every `.md` under `workforce/`. */
const lines = (rel: string) => (readFileSync(join(LAB, rel), "utf8").match(/\n/g) ?? []).length;
const prompts: string[] = [];
const walk = (rel: string) => {
  for (const name of readdirSync(join(LAB, rel))) {
    const path = join(rel, name);
    if (statSync(join(LAB, path)).isDirectory()) walk(path);
    else if (name.endsWith(".md")) prompts.push(path);
  }
};
walk("workforce");
const host = lines("host.mts");
const config = lines("fsdev.config.mts");
const promptLines = prompts.reduce((n, rel) => n + lines(rel), 0);
const total = host + config + promptLines;
console.log(`configuration: ${total} lines (host.mts ${host}, fsdev.config.mts ${config}, ${prompts.length} prompts ${promptLines}); cap ${CAP}`);
console.log(`host.mts budget with the rest as it is: ${CAP - config - promptLines} lines (cut ${host - (CAP - config - promptLines)})`);

if (problems.length > 0) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log("PASS: every entry has exactly one owner");
