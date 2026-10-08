/**
 * Goal check — a worker's model reaches the documents its own file names, and
 * nothing else, on one shared copy of its flow.
 *
 * One workforce tree, read by the real loader. Three workers on one flow,
 * registered once: one granting a document read-only, one granting another
 * `rw`, and one naming no documents at all. Each opens a session on the one
 * copy, created naming it, and runs core's model-facing document tools (list,
 * read, write, search, the discovery door) and an app tool built on core's
 * lookup, as its model would. What each reached is graded off what the tools
 * answered.
 *
 * Real path, no mocking, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workforce-seats/a-seat-reaches-the-documents-its-file-names/run.mts
 * Control: GOAL_CONTROL=no-visibility-rule (the flow sets no rule) must FAIL on
 * "the first worker's model lists the second's document".
 */
import { DEFAULT_ORG_ID } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import { createWorkerInstallation, hireWorkforce, resourcesFromDocs } from "@flow-state-dev/workforce";
import { readDeclaredRoster } from "@flow-state-dev/workforce/loader";
import { join } from "node:path";
import { fixtureDir, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { DESK_KIND, buildDesk } from "./fixtures/flows";

type SeatFixture = { id: string; reaches: string[]; writes: string[] };
type Fixture = {
  userId: string;
  note: string;
  documents: string[];
  store: string;
  seats: { lead: SeatFixture; cfo: SeatFixture; chief: SeatFixture };
  control: { dir: string; id: string; ref: string };
};

stripIntentOverrides();

const CONTROL = process.env.GOAL_CONTROL ?? "";
if (CONTROL !== "" && CONTROL !== "no-visibility-rule") throw new Error(`unknown GOAL_CONTROL "${CONTROL}"`);

const fixture = loadFixture<Fixture>(import.meta.url);
const workers = [fixture.seats.lead, fixture.seats.cfo, fixture.seats.chief];
const tree = (name: string): string => join(fixtureDir(import.meta.url), name);
/** A document's uri, as core's tools name it: every document is org-scoped. */
const uri = (ref: string): string => `org/${ref}`;
const sorted = (values: Iterable<string>): string[] => [...new Set(values)].sort();
const same = (a: readonly string[], b: readonly string[]): boolean => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
/** The documents among `uris`, as refs. */
const documentsIn = (uris: readonly string[]): string[] =>
  sorted(uris.filter((u) => fixture.documents.some((ref) => uri(ref) === u)).map((u) => u.slice("org/".length)));

/** Build the installation and its copies over `root`, as an app does at boot. */
async function boot(root: string) {
  const declared = await readDeclaredRoster(root);
  let flows: Record<string, unknown> = {};
  const installation = createWorkerInstallation({
    standardWorkers: declared.workers,
    workerFlows: () => flows as never,
    documents: resourcesFromDocs(declared.documents),
  });
  flows = { [DESK_KIND]: buildDesk(installation, { withoutRule: CONTROL === "no-visibility-rule" }) };
  return { declared, installation, copies: () => hireWorkforce(installation) };
}

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [];

  // ---- (a) the real loader reads the tree; one copy of the flow runs every worker
  const { declared, copies: register } = await boot(tree("workforce"));
  if (declared.problems.length > 0) {
    failures.push(`the loader reported ${declared.problems.length} problem(s): ${JSON.stringify(declared.problems.map((p) => `${p.layer} ${p.path}: ${p.error.message}`))}`);
  }
  if (!same(declared.workers.map((w) => w.id), workers.map((w) => w.id))) {
    failures.push(`the tree produced workers ${JSON.stringify(declared.workers.map((w) => w.id))}, wanted ${JSON.stringify(workers.map((w) => w.id))}`);
  }
  if (!same(declared.documents.map((d) => d.ref), fixture.documents)) {
    failures.push(`the tree produced documents ${JSON.stringify(declared.documents.map((d) => d.ref))}, wanted ${JSON.stringify(fixture.documents)}`);
  }
  const copies = register();
  const desks = copies.filter((copy) => copy.kind === DESK_KIND);
  if (desks.length !== 1 || desks[0]!.id !== DESK_KIND) {
    failures.push(`${desks.length} copies of "${DESK_KIND}" registered (${desks.map((c) => c.id).join(", ")}), wanted one, at its kind`);
  }
  if (copies.some((copy) => workers.some((w) => w.id === copy.id))) failures.push("a copy was registered at a worker's id");
  const desk = desks[0] as FlowInstance;

  const state = createFlowState({
    flows: Object.fromEntries(copies.map((copy) => [copy.id, copy])),
    stores: { default: { primary: inMemoryStores() } },
  } as never);
  try {
    const runtime = await state.getRuntime();
    const router = await state.getRouter();

    /** Open a session on the one desk copy, naming `worker`. */
    const open = async (worker: string): Promise<string> => {
      const sessionId = `s_${worker.replace(/\W/g, "_")}`;
      const path = [DESK_KIND, "sessions"];
      const res = await router.POST(
        new Request(`http://goal/api/flows/${path.join("/")}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: fixture.userId, sessionId, state: { workerId: worker } }),
        }),
        { params: { path } },
      );
      if (res.status !== 201) throw new Error(`the session naming "${worker}" was not created: ${res.status} ${await res.text()}`);
      return sessionId;
    };
    /** Run one of the copy's tools in `sessionId`, as its worker's model would. */
    const tool = async (sessionId: string, actionName: string, input: unknown) => {
      const result = await runAction({
        orgId: DEFAULT_ORG_ID,
        flow: desk,
        actionName,
        input,
        userId: fixture.userId,
        sessionId,
        stores: runtime.stores,
        runtimeConfig: { ...runtime.runtimeConfig, logger: silentLogger },
      });
      const error = result.error as { message?: unknown } | undefined;
      return { output: result.output as any, error: error === undefined ? undefined : String(error.message ?? error) };
    };

    const seen: Record<string, string[]> = {};
    const sessions: Record<string, string> = {};
    for (const worker of workers) sessions[worker.id] = await open(worker.id);

    // ---- (b) what each worker's model lists, searches and discovers ------
    for (const worker of workers) {
      const sessionId = sessions[worker.id]!;
      const listed = await tool(sessionId, "read", {});
      const globbed = await tool(sessionId, "glob", {});
      const grepped = await tool(sessionId, "grep", { pattern: "#" });
      const discovered = await tool(sessionId, "discover", {});
      for (const [name, answered] of Object.entries({ listed, globbed, grepped, discovered })) {
        if (answered.error !== undefined) failures.push(`${worker.id}: ${name} failed: ${answered.error}`);
      }
      const lists = documentsIn(listed.output?.uris ?? []);
      seen[worker.id] = lists;
      const views: Record<string, string[]> = {
        lists,
        "glob finds": documentsIn(globbed.output?.uris ?? []),
        "grep finds": documentsIn((grepped.output?.matches ?? []).map((m: { uri: string }) => m.uri)),
        "discover names": fixture.documents.filter((ref) => JSON.stringify(discovered.output ?? {}).includes(uri(ref))),
      };
      for (const [view, refs] of Object.entries(views)) {
        if (!same(refs, worker.reaches)) {
          failures.push(`${worker.id}'s model ${view} ${JSON.stringify(refs)}, its file grants ${JSON.stringify(worker.reaches)}`);
        }
      }
      // The control's named assertion: the first worker's model must not list the second's document.
      if (worker === workers[0]) {
        const theirs = workers[1]!.reaches.filter((ref) => !worker.reaches.includes(ref));
        const leaked = lists.filter((ref) => theirs.includes(ref));
        if (leaked.length > 0) failures.push(`the first worker's model lists the second's document: ${worker.id} lists ${JSON.stringify(leaked)}`);
      }
    }

    // ---- (c) a document it isn't granted answers as one that doesn't exist
    const missing = "org/no-such-document";
    for (const worker of workers) {
      const sessionId = sessions[worker.id]!;
      for (const ref of fixture.documents) {
        const read = await tool(sessionId, "read", { uri: uri(ref) });
        const peeked = await tool(sessionId, "peek", { uri: uri(ref) });
        if (worker.reaches.includes(ref)) {
          if (read.error !== undefined || typeof read.output?.content !== "string") failures.push(`${worker.id} can't read ${ref}, which its file grants: ${read.error}`);
          if (peeked.output?.found !== true) failures.push(`${worker.id}'s app tool doesn't find ${ref}, which its file grants`);
          continue;
        }
        const absent = await tool(sessionId, "read", { uri: missing });
        if (read.error === undefined) failures.push(`${worker.id}'s model read ${ref}, which its file doesn't grant`);
        else if (read.error !== absent.error?.replace(missing, uri(ref))) {
          failures.push(`${worker.id} reading ${ref} answered "${read.error}", not what a missing document answers ("${absent.error}")`);
        }
        if (peeked.output?.found !== false) failures.push(`${worker.id}'s app tool found ${ref}, which its file doesn't grant`);
        const write = await tool(sessionId, "write", { uri: uri(ref), content: "rewritten" });
        const absentWrite = await tool(sessionId, "write", { uri: missing, content: "rewritten" });
        if (write.error === undefined) failures.push(`${worker.id}'s model wrote ${ref}, which its file doesn't grant`);
        else if (write.error !== absentWrite.error?.replace(missing, uri(ref))) {
          failures.push(`${worker.id} writing ${ref} answered "${write.error}", not what a missing document answers ("${absentWrite.error}")`);
        }
      }
    }

    // ---- (d) a read-only grant can't be written; an `rw` grant can --------
    for (const worker of workers) {
      const sessionId = sessions[worker.id]!;
      const wrote: string[] = [];
      for (const ref of worker.reaches) {
        const write = await tool(sessionId, "write", { uri: uri(ref), content: `${worker.id} was here` });
        if (write.error === undefined) wrote.push(ref);
      }
      if (!same(wrote, worker.writes)) failures.push(`${worker.id}'s model wrote ${JSON.stringify(sorted(wrote))}, its file lets it write ${JSON.stringify(worker.writes)}`);
    }

    // ---- (e) one copy, and still no two workers reached the same set ------
    const sets = workers.map((w) => JSON.stringify(seen[w.id] ?? []));
    if (new Set(sets).size !== sets.length) failures.push(`two workers on the one copy reached the same documents: ${JSON.stringify(seen)}`);

    evidence.push(
      `one "${DESK_KIND}" copy ran ${workers.length} workers: ` +
        workers.map((w) => `${w.id} lists ${JSON.stringify(seen[w.id])} and writes ${JSON.stringify(w.writes)}`).join("; ") +
        `; another worker's document read, wrote and was looked up as one that doesn't exist`,
    );
  } finally {
    await state.dispose();
  }

  // ---- (f) a file granting a ref no document matches registers nothing ----
  const typo = await boot(tree(fixture.control.dir));
  let refusal = "";
  let registered = -1;
  try {
    registered = typo.copies().length;
  } catch (error) {
    refusal = error instanceof Error ? error.message : String(error);
  }
  if (registered >= 0) failures.push(`a tree granting "${fixture.control.ref}" registered ${registered} copies instead of refusing`);
  else if (!refusal.includes(fixture.control.id) || !refusal.includes(fixture.control.ref) || !refusal.includes("nothing was registered")) {
    failures.push(`the refusal did not name the worker, the ref and that nothing was registered: ${refusal}`);
  } else {
    evidence.push(`a tree granting "${fixture.control.ref}" registered nothing, naming ${fixture.control.id}`);
  }

  return { failures, evidence: evidence.join("; ") };
});
