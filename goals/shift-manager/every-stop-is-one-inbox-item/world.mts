/**
 * The closure's Lab, served by Shift Manager's own command, and what Alice can do and read in it.
 *
 * Alice is DevTeam's Lab owner, signed in with her verified bearer, acting through the shipped
 * clients. Every read a grade rests on is one of hers: Shift Manager's own Inbox snapshot
 * (`createLabReader().read().inbox`), and her board's `getTask` and `listTasks`. The proof file
 * is written from inside the Lab's runs (`lab/fsdev.config.mts`); nothing here writes a row.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Client } from "@flow-state-dev/client";
import { createInboxClient, type InboxHold, type InboxItem } from "@flow-state-dev/orchestration/inbox";
import { reconcileInbox, rowTruthOf, suspensionTruthOf } from "@flow-state-dev/orchestration/inbox/check";
import { RUN_STAMP } from "../../lib/index.mts";
import { startShiftManager, type ServedShiftManager } from "../../lib/shift-manager.mts";
import { act as actAs, connect as connectPerson, type Acted, type Connected, type Shipped } from "../workers-message-each-other/legs.mts";
import { LAB_USERS } from "../../../packages/shift-manager/teams/devteam/host.mts";
import { createBareRemote } from "../../../packages/shift-manager/teams/devteam/scratch-repo.mts";
import { connect as connectShiftManager } from "../../../packages/shift-manager/src/lib/connection.ts";
import { createLabReader } from "../../../packages/shift-manager/src/lib/reads.ts";
import { CAST, writeTree, type Words } from "./cast.mts";

const HERE = fileURLToPath(new URL(".", import.meta.url));
export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export const show = (value: unknown, n = 500) => JSON.stringify(value)?.slice(0, n);

/** Storefront, the project a coding task runs in. */
export const STOREFRONT = { visibility: "shared", id: "storefront" } as const;
export type Row = Record<string, any>;
export const TERMINAL = new Set(["completed", "errored", "cancelled", "failed"]);

/** What one Lab was started with: its files, so a restart serves the same store. */
export interface LabFiles {
  dir: string;
  store: string;
  tree: string;
  runs: string;
  proof: string;
  remote: string;
}

/** Lay out one Lab's files under `scratch`: a store, the tree, a repository, a proof file. */
export function labFiles(scratch: string, label: string, words: Words): LabFiles {
  const dir = join(scratch, `${label}-${RUN_STAMP}`);
  mkdirSync(join(dir, "runs"), { recursive: true });
  const remote = createBareRemote(`closure-${label}`, { at: join(dir, "storefront.git"), seed: { "README.md": "# Storefront\n\n## Checkout\n\n## Catalog\n" } });
  const proof = join(dir, "proof.ndjson");
  writeFileSync(proof, "", "utf8");
  return { dir, store: join(dir, "lab.sqlite"), tree: writeTree(join(dir, "workforce"), words), runs: join(dir, "runs"), proof, remote: remote.url };
}

/** The settings one Lab process is served with. */
export interface Serving {
  scratch: string;
  pages: string;
  files: LabFiles;
  harness: "claude-code" | "stub";
  fact: string;
  userDeadlineMs?: number;
  sweepMs?: number;
}

/** Serve the closure's Lab with Shift Manager's command. */
export function serveLab(serving: Serving, label: string): Promise<ServedShiftManager> {
  const f = serving.files;
  return startShiftManager({
    scratch: serving.scratch,
    label,
    config: join(HERE, "lab", "fsdev.config.mts"),
    pages: serving.pages,
    env: {
      GOAL_STORE: f.store,
      GOAL_TREE: f.tree,
      GOAL_RUNS: f.runs,
      GOAL_REMOTE: f.remote,
      GOAL_PROOF: f.proof,
      GOAL_HARNESS: serving.harness,
      GOAL_FACT: serving.fact,
      // A step run twice shows as a work counter of 2, not as a cached trace (FIX-2137).
      FSDEV_TRACE_OBSERVABILITY: "0",
      ...(serving.userDeadlineMs === undefined ? {} : { GOAL_USER_DEADLINE_MS: String(serving.userDeadlineMs) }),
      ...(serving.sweepMs === undefined ? {} : { GOAL_SWEEP_MS: String(serving.sweepMs) }),
    },
    timeoutMs: 240_000,
  });
}

/** One proof line, written inside the Lab's runs. */
export type Proof = Record<string, any> & { kind: string; at: number };
export const proofsOf = (file: string): Proof[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Proof)
    : [];

/** Alice in one served Lab: her conversation with `desk.front`, her board and her Inbox. */
export interface Alice {
  origin: string;
  conversation: string;
  person: Connected;
  client: Client;
  act(flowKind: string, sessionId: string, action: string, input: unknown, timeoutMs?: number): Promise<Acted>;
  /** Say `message` to `desk.front` in her conversation. */
  say(message: string, timeoutMs?: number): Promise<Acted>;
  /** File a task on her conversation's board, as a screen does. Its id, or the refusal. */
  file(init: Record<string, unknown>): Promise<{ id?: string; acted: Acted }>;
  update(input: Record<string, unknown>): Promise<Acted>;
  rows(): Promise<Row[]>;
  row(id: string): Promise<Row | undefined>;
  inbox(): Promise<InboxItem<unknown>[]>;
  itemOf(taskId: string): Promise<InboxItem<unknown> | undefined>;
  answer(item: InboxItem<unknown>, answer: unknown, questionId?: string): Promise<string>;
  answerOne(hold: InboxHold<unknown>, answer: unknown): Promise<string>;
  /** `reconcileInbox` over her Inbox against her rows and the task sessions' suspended requests; `undefined` when green. */
  reconciled(closed: string[]): Promise<string | undefined>;
  until<T>(read: () => Promise<T>, done: (value: T) => boolean, ms: number): Promise<T>;
}

/** Alice signed in to the Lab at `origin`, with her conversation with `desk.front` open. */
export async function aliceIn(shipped: Shipped, origin: string): Promise<Alice> {
  const person = connectPerson(shipped, origin, { label: "Alice", ...LAB_USERS.owner });
  const client = connectShiftManager({ baseUrl: origin, userId: LAB_USERS.owner.userId, bearerToken: LAB_USERS.owner.bearer });
  const opened = await person.workforce.ensureWorkerSession({ worker: CAST.front });
  const conversation = opened.id;
  const flow = opened.flowKind;
  const act: Alice["act"] = (flowKind, sessionId, action, input, timeoutMs) => actAs(person, flowKind, sessionId, action, input, timeoutMs);
  const rows = async (): Promise<Row[]> => {
    const listed = await act(flow, conversation, "listTasks_tasks", {}, 60_000);
    if (listed.status !== "completed") throw new Error(`listTasks_tasks ended ${listed.status}: ${listed.error ?? show(listed.output)}`);
    return (listed.output?.tasks ?? []) as Row[];
  };
  const row = async (id: string): Promise<Row | undefined> => {
    const read = await act(flow, conversation, "getTask_tasks", { id }, 60_000);
    return read.output?.ok === true ? (read.output.task as Row) : undefined;
  };
  const inbox = async (): Promise<InboxItem<unknown>[]> => {
    const snapshot = await createLabReader(client).read();
    if (!("inbox" in snapshot) || snapshot.inbox === undefined) throw new Error(`Shift Manager's read came back ${show(snapshot)}`);
    if (!snapshot.inbox.ok) throw new Error(`Shift Manager's Inbox didn't load: ${snapshot.inbox.failure.message}`);
    return snapshot.inbox.value as InboxItem<unknown>[];
  };
  const inboxClient = createInboxClient(client);
  const call = async (go: () => Promise<unknown>): Promise<string> => {
    try {
      await go();
      return "ok";
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  return {
    origin,
    conversation,
    person,
    client,
    act,
    say: (message, timeoutMs = 300_000) => act(flow, conversation, "respond", { message }, timeoutMs),
    file: async (init) => {
      const acted = await act(flow, conversation, "createTask_tasks", init, 60_000);
      const id = (acted.output?.taskId ?? acted.output?.id) as string | undefined;
      return { ...(id === undefined ? {} : { id }), acted };
    },
    update: (input) => act(flow, conversation, "updateTask_tasks", input, 60_000),
    rows,
    row,
    inbox,
    itemOf: async (taskId) => (await inbox()).find((item) => item.task?.taskId === taskId),
    answer: (item, answer, questionId) => call(() => inboxClient.answer(item, answer as never, questionId)),
    answerOne: (hold, answer) => call(() => inboxClient.answerOne(hold, answer as never)),
    reconciled: async (closed) => {
      const all = await rows();
      const sessions = new Set<string>(all.flatMap((r) => (typeof r.run?.sessionId === "string" ? [r.run.sessionId as string] : [])));
      const suspensions = [];
      for (const sessionId of sessions) suspensions.push(...suspensionTruthOf(sessionId, await client.sessions.requests(sessionId, { status: "suspended", includeItems: true })));
      const items = await inbox();
      const board = items.find((item) => item.task !== null)?.task?.board ?? `${conversation}.tasks`;
      const truth = { rows: rowTruthOf(all.map((r) => ({ board, id: r.id, status: r.status, holds: r.holds ?? [], steers: r.steers ?? [] }))), suspensions, closed };
      const result = reconcileInbox(items, truth);
      return result.green ? undefined : show({ ...result, green: undefined }, 1500);
    },
    until: async (read, done, ms) => {
      let last = await read();
      for (const deadline = Date.now() + ms; !done(last) && Date.now() < deadline; last = await read()) await sleep(1000);
      return last;
    },
  };
}

/** A row's open holds: a suspension's mirror, or a row hold no steer has answered. */
export function openHoldsOf(row: Row | undefined): Row[] {
  if (row === undefined || TERMINAL.has(row.status)) return [];
  const answered = new Set(((row.steers ?? []) as Row[]).flatMap((s) => (typeof s.answers === "string" ? [s.answers] : [])));
  return ((row.holds ?? []) as Row[]).filter((h) => h.source?.kind === "suspension" || !answered.has(h.id));
}
export const suspensionHolds = (row: Row | undefined) => openHoldsOf(row).filter((h) => h.source?.kind === "suspension");
export const rowHolds = (row: Row | undefined) => openHoldsOf(row).filter((h) => h.source?.kind === "row");
