/**
 * Goal check, FIX-2636: in a flow that installs the attachments capability, a
 * person asks about any document their session was sent, however many turns
 * back, and the model reads it on request through the one resolver; no call
 * carries an earlier turn's document text unless the model read it in that
 * turn. A flow without the capability keeps FIX-2517 D1's window. See goal.md.
 *
 *   Server A: `host.mts`, a local server on on-disk SQLite. Session A on
 *             `with-capability`: turn 1 sends a PDF (doc 1), turn 2 a `.md`
 *             (doc 2) and four small files, turn 3 a `.csv` (doc 3) and four
 *             more, each with a fresh code word. Turns 4 to 7: turn 5 asks
 *             about doc 2, which the scripted model reads by the id its
 *             history line names. Session B on `without-capability`: the
 *             three documents, then a fourth turn. The server is crashed.
 *   Server B: the same store. Turn 8 asks about doc 1 by the name the person
 *             uses; its turn has left the three-turn window and ten newer
 *             documents pushed it off the list of eight, so the model reads it
 *             by name. Session C reads doc 1's id from another session.
 *
 * Every signal reads the prompts at the provider seam (what the scripted model
 * was sent, after the model call prepared it) and the items and list through
 * `@flow-state-dev/client`.
 *
 * Controls (same command): `GOAL_CONTROL=resend` (the history rule off) must
 * FAIL `quiet`; `name-only` (a read gives the name, not the text) must FAIL
 * `turn8` and `turn5`; `id-only` (the tool refuses a name) must FAIL `turn8`.
 *
 * Run: pnpm tsx goals/attachments/read-on-request/run.mts
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomInt } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createClient, type ClientFetch, type FlowHandle } from "@flow-state-dev/client";
import { ATTACHMENTS, parseBlobRef } from "@flow-state-dev/core/attachments";
import type { FileContent } from "@flow-state-dev/core/items";
import { makePdf } from "../../../packages/engine/test/blobs/pdf-fixture.ts";
import {
  REPO_ROOT,
  assertPatched,
  crashAndRestart,
  describePatches,
  goalTmpDir,
  modulePatchEnv,
  refuseIfAnswering,
  runGoal,
  stopProcessGroup,
  type ModulePatch,
} from "../../lib/index.mts";

const CONTROLS: Record<string, ModulePatch[]> = {
  // The capability installed, its history rule off: FIX-2517 D1's window.
  resend: [
    {
      module: "packages/core/src/helpers/attachments-capability.ts",
      from: String.raw`history: \{ history: \{ earlierDocuments: "named" \} \}`,
      to: 'history: { history: { earlierDocuments: "window" } }',
    },
  ],
  // A read reaches the model as the file's name, not its text.
  "name-only": [
    {
      module: "packages/engine/src/context/history-files.ts",
      from: String.raw`return \{ \.\.\.part, output: \{ type: "text", value: text \} \};`,
      to: 'return { ...part, output: { type: "text", value: file.filename ?? "" } };',
    },
  ],
  // The tool takes an id only.
  "id-only": [
    {
      module: "packages/core/src/helpers/attachments-capability.ts",
      from: String.raw`\} else if \(input\.name !== undefined && input\.name !== ""\) \{`,
      to: "} else if (false) {",
    },
  ],
};
const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROLS[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(CONTROLS).join(", ")}`);
  process.exit(2);
}
const PATCHES = CONTROL === "" ? [] : CONTROLS[CONTROL]!;

const PORT = 5_000 + Math.floor(Math.random() * 1_000);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SCRATCH = goalTmpDir("read-on-request");
const DB = join(SCRATCH, "store.sqlite");
const CALLS = join(SCRATCH, "calls.jsonl");
const MARK = join(SCRATCH, "patched.txt");
const HOST = join(REPO_ROOT, "goals", "attachments", "read-on-request", "host.mts");
const TSX = join(REPO_ROOT, "node_modules", ".bin", "tsx");
const SMALL = 2 * 1024;

/** A fresh code word per run: ten capital letters, which no other text here holds. */
const word = () => Array.from({ length: 10 }, () => String.fromCharCode(65 + randomInt(26))).join("");

async function startHost(): Promise<ChildProcess> {
  await refuseIfAnswering(ORIGIN);
  const control = PATCHES.length > 0 ? modulePatchEnv(PATCHES, REPO_ROOT, MARK) : {};
  const child = spawn(TSX, [HOST], {
    cwd: SCRATCH,
    env: { ...process.env, ...control, PORT: String(PORT), GOAL_DB: DB, GOAL_CALLS: CALLS },
    stdio: ["ignore", "inherit", "inherit"],
    detached: true,
  });
  for (let i = 0; i < 120; i += 1) {
    try {
      if ((await fetch(`${ORIGIN}/healthz`)).ok) return child;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  stopProcessGroup(child, "SIGKILL");
  throw new Error("the host never answered /healthz");
}

const as =
  (user: string): ClientFetch =>
  (input, init) => {
    const headers = new Headers(init?.headers);
    headers.set("x-user", user);
    return fetch(input, { ...init, headers });
  };

type Message = { role: string; content: unknown };

/** Each model call so far, as the scripted model was sent it. */
const readCalls = (): Message[][] =>
  readFileSync(CALLS, "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Message[]);

const textOf = (message: Message | undefined): string =>
  typeof message?.content === "string"
    ? message.content
    : ((message?.content as Array<{ text?: string }> | undefined) ?? []).map((part) => part.text ?? "").join("");

/** The calls of the turn whose person's line says `said`, in step order. */
const callsOf = (calls: Message[][], said: string) =>
  calls.filter((messages) => textOf(messages.filter((m) => m.role === "user").at(-1)) === said);

/**
 * Everything a call shows the model, as text: the messages, and each file
 * part's bytes decoded, so a PDF sent as a file is read for its words too.
 */
const shown = (messages: Message[]): string => {
  const files = messages.flatMap((m) =>
    Array.isArray(m.content)
      ? (m.content as Array<{ type?: string; data?: unknown }>)
          .filter((part) => part.type === "file" && typeof part.data === "string")
          .map((part) => Buffer.from(part.data as string, "base64").toString("latin1"))
      : [],
  );
  return [JSON.stringify(messages), ...files].join("\n");
};

/** The tool results a call carries, as text. */
const toolResults = (messages: Message[]) => messages.filter((m) => m.role === "tool").map((m) => JSON.stringify(m.content));

let host: ChildProcess | undefined;
await runGoal(async (failures, tell) => {
  try {
    if (CONTROL !== "") console.error(`control ${CONTROL}:\n${describePatches(PATCHES, REPO_ROOT)}`);
    writeFileSync(CALLS, "");
    const words = [word(), word(), word()] as const;
    const [w1, w2, w3] = words;
    const hasWord = (text: string) => words.filter((w) => text.includes(w));

    // --- Server A ---------------------------------------------------------------
    host = await startHost();
    const alice = createClient({ userId: "alice", baseUrl: ORIGIN, fetcher: as("alice") });
    const docs = async (flow: string) => {
      const handle = alice.flow(flow);
      const upload = (data: Uint8Array, mediaType: string, filename: string) => handle.upload({ data, mediaType, filename });
      const encode = (text: string) => new TextEncoder().encode(text);
      return {
        handle,
        upload,
        encode,
        doc1: await upload(makePdf([`Quarterly report\nThe code word is ${w1}`]), "application/pdf", "q3-report.pdf"),
        doc2: await upload(encode(`# Plan\n\nThe code word is ${w2}.\n`), "text/markdown", "plan.md"),
        doc3: await upload(encode(`metric,value\ncode word,${w3}\n`), "text/csv", "numbers.csv"),
      };
    };
    const turn = async (handle: FlowHandle, sessionId: string, message: string, files: FileContent[] = []) => {
      const request = await handle.send("send", { message }, { sessionId, attachments: files });
      const { status } = await request.wait({ pollMs: 100, timeoutMs: 60_000 });
      if (status !== "completed") throw new Error(`setup: "${message}" ended ${status}`);
    };

    const a = await docs("with-capability");
    const sessionA = (await a.handle.createSession()).id;
    const fillers = async (batch: string) => {
      const out: FileContent[] = [];
      for (let i = 1; i <= 4; i += 1) out.push(await a.upload(a.encode(`filler ${batch}-${i}`), "text/plain", `filler-${batch}-${i}.txt`));
      return out;
    };
    await turn(a.handle, sessionA, "A1 here is the Q3 report", [a.doc1]);
    await turn(a.handle, sessionA, "A2 and the plan", [a.doc2, ...(await fillers("a"))]);
    await turn(a.handle, sessionA, "A3 and the numbers", [a.doc3, ...(await fillers("b"))]);
    await turn(a.handle, sessionA, "A4 thanks");
    await turn(a.handle, sessionA, "ASK plan.md");
    await turn(a.handle, sessionA, "A6 ok");
    await turn(a.handle, sessionA, "A7 ok");

    const b = await docs("without-capability");
    const sessionB = (await b.handle.createSession()).id;
    await turn(b.handle, sessionB, "B1 here is the Q3 report", [b.doc1]);
    await turn(b.handle, sessionB, "B2 and the plan", [b.doc2]);
    await turn(b.handle, sessionB, "B3 and the numbers", [b.doc3]);
    await turn(b.handle, sessionB, "B4 thanks");

    // --- The crash, and Server B on the same store -------------------------------
    host = await crashAndRestart(host, startHost);
    const after = createClient({ userId: "alice", baseUrl: ORIGIN, fetcher: as("alice") }).flow("with-capability");
    const ask8 = "ASK Q3-Report.pdf";
    await turn(after, sessionA, ask8);
    const doc1Id = parseBlobRef(a.doc1.data)!;
    const readOther = `READ ${doc1Id}`;
    await turn(after, (await after.createSession()).id, readOther);

    const calls = readCalls();

    // turn8: doc 1, outside both windows, read by name after the restart.
    const t8 = tell.over("turn8 · turn 8's calls", callsOf(calls, ask8));
    const shownBefore = shown(t8[0] ?? []).split(ask8).join("");
    if (/q3-report/i.test(shownBefore) || shownBefore.includes(doc1Id)) {
      failures.push("turn8: turn 8's history or file list names doc 1, so the read by name was not needed");
    }
    if (!(t8.length >= 2 && toolResults(t8.at(-1)!).some((r) => r.includes(w1)))) {
      failures.push(`turn8: turn 8's model input holds no tool result with doc 1's word (${t8.length} calls; results ${JSON.stringify(toolResults(t8.at(-1) ?? []))})`);
    }

    // turn5: doc 2, read by the id its history line names.
    const t5 = tell.over("turn5 · turn 5's calls", callsOf(calls, "ASK plan.md"));
    if (!JSON.stringify(t5[0] ?? []).includes(`[document: plan.md, id ${parseBlobRef(a.doc2.data)}`)) {
      failures.push("turn5: turn 5's history does not name doc 2 with its id");
    }
    if (!(t5.length >= 2 && toolResults(t5.at(-1)!).some((r) => r.includes(w2)))) {
      failures.push("turn5: turn 5's model input holds no tool result with doc 2's word");
    }

    // quiet: turns 4-7 carry no document text but turn 5's read.
    const quiet = tell.over(
      "quiet · turns 4-7's calls",
      ["A4 thanks", "ASK plan.md", "A6 ok", "A7 ok"].flatMap((said) => callsOf(calls, said).map((messages) => ({ said, messages }))),
    );
    for (const { said, messages } of quiet) {
      const kept = said === "ASK plan.md" ? messages.filter((m) => !(m.role === "tool" && JSON.stringify(m.content).includes(w2))) : messages;
      const found = hasWord(shown(kept));
      if (found.length > 0) failures.push(`quiet: a call of "${said}" carries document text (${found.length} code word(s))`);
    }

    // stored: the tool's items and the list hold references, small, with no word.
    const state = (await createClient({ userId: "alice", baseUrl: ORIGIN, fetcher: as("alice") }).sessions.state(sessionA, {
      includeItems: true,
      limit: 200,
    })) as { items?: Array<{ type?: string }> };
    const outputs = tell.over("stored · session A's tool_output items", (state.items ?? []).filter((item) => item.type === "tool_output"));
    for (const item of outputs) {
      const json = JSON.stringify(item);
      if (json.length >= SMALL || hasWord(json).length > 0) failures.push(`stored: a tool_output item is ${json.length} bytes with ${hasWord(json).length} code word(s)`);
    }
    const reader = createClient({ userId: "alice", baseUrl: ORIGIN, fetcher: as("alice") });
    const page = await reader.resources.listCollectionResources(sessionA, ATTACHMENTS, { limit: 100 });
    const listed = tell.over("stored · session A's attachments list", page.items);
    const pageJson = JSON.stringify(page);
    if (hasWord(pageJson).length > 0) failures.push(`stored: the attachments list holds ${hasWord(pageJson).length} code word(s)`);
    for (const entry of listed) {
      const json = JSON.stringify(entry);
      if (json.length >= SMALL) failures.push(`stored: a list entry is ${json.length} bytes`);
    }

    // other-session: another session's id is not read.
    const other = tell.over("other-session · the read's calls", callsOf(calls, readOther));
    const otherResults = (other.at(-1) ? toolResults(other.at(-1)!) : []).join("\n");
    if (!otherResults.includes("not in this conversation") || otherResults.includes(w1)) {
      failures.push(`other-session: reading doc 1's id from another session answered ${JSON.stringify(otherResults.slice(0, 200))}`);
    }

    // without: the flow without the capability keeps the window.
    const b4 = tell.over("without · B4's calls", callsOf(calls, "B4 thanks"));
    const b4Words = hasWord(shown(b4[0] ?? []));
    if (b4Words.length !== 3) failures.push(`without: turn 4 without the capability carries ${b4Words.length} of 3 code words`);

    if (CONTROL !== "") assertPatched(PATCHES, REPO_ROOT, MARK);
    return {
      failures,
      evidence:
        `SIGKILL and restart on SQLite; turn 8 read doc 1 by name (${t8.length} calls), turn 5 read doc 2 by id; ` +
        `turns 4-7 (${quiet.length} calls) carry no other document text; ${outputs.length} tool_output items and ` +
        `${listed.length} list entries (each under 2 KB) hold no code word; another session's id answers ` +
        `"not in this conversation"; without the capability turn 4 carries ${b4Words.length} of 3 words`,
    };
  } finally {
    stopProcessGroup(host, "SIGKILL");
    rmSync(SCRATCH, { recursive: true, force: true });
  }
});
