/**
 * resources by scope › a pin is one line and no session is made to read (FIX-2624).
 *
 * One `serve()` host on a bound port over SQLite, its resolver signing callers
 * in from two headers (`x-user`, `x-org`), as a session cookie would. Two flows
 * declare the resources, `threads` and a `dashboard`, so every address has two
 * declarers whose sign-in must agree. No model. Real clients (`createClient`
 * over Node's `fetch`) for Alice and Bob in org A and Carol in org B:
 *
 *   a  — Alice and Bob each read their own pins and org A's project, Carol
 *        org B's, by scope and key; the session and request stores are the same
 *        after every read.
 *   b  — Alice's two tabs and Bob's two tabs make their first pin at once: one
 *        write session per writer. Alice and Bob `update` org A's project at
 *        once, on different fields, both having read the same version: both
 *        changes are stored. Each write's request names its writer. A resource
 *        with no `runBy` is refused. A client that claims Bob in the body while
 *        signed in as Alice writes Alice's pins, never Bob's.
 *   c  — the identity read answers the signed-in user and org, with no session;
 *        the helper inventory finds no use of the four own-session helpers.
 *
 * The grade reads the stores (resource state, sessions, requests), never what
 * a route says about itself.
 *
 * Controls (this file runs again with an engine module patched as it loads):
 *   GOAL_CONTROL=no-version-check     b must FAIL on b:both-changes-stored
 *   GOAL_CONTROL=principal-from-body  b must FAIL on b:forged-user-ignored
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { defineFlow, defineResource, defineResourceCollection, handler } from "@flow-state-dev/core";
import { createClient, type Client } from "@flow-state-dev/client";
import { createFlowState } from "@flow-state-dev/engine";
import { serve, type ServeHandle } from "@flow-state-dev/node";
import { sqliteStores } from "@flow-state-dev/store-sqlite";
import { REPO_ROOT, RUN_STAMP, assertPatched, describePatches, goalTmpDir, modulePatchEnv, runGoal, silentLogger, stripIntentOverrides, untilIdle } from "../../lib/index.mts";
import { resolveResourceScopeId } from "../../../packages/engine/src/stores/scope-keys.ts";
import { isWriteSessionId } from "../../../packages/engine/src/resources/default-write-flow.ts";
import { PATCHES } from "./controls/patches.mts";

// No model: the ladder's overrides would only be refused at boot.
stripIntentOverrides();

const CONTROL = process.env.GOAL_CONTROL ?? "";
const SCRATCH = process.env.GOAL_SCRATCH ?? goalTmpDir("resources-by-scope");

if (CONTROL !== "" && PATCHES[CONTROL] === undefined) {
  console.error(`unknown GOAL_CONTROL "${CONTROL}"; known: ${Object.keys(PATCHES).join(", ")}`);
  process.exit(2);
}
if (PATCHES[CONTROL] !== undefined && process.env.GOAL_MODULE_PATCH === undefined) {
  mkdirSync(SCRATCH, { recursive: true });
  const mark = join(SCRATCH, `patch-mark-${RUN_STAMP}`);
  rmSync(mark, { force: true });
  console.error(`control ${CONTROL}:\n${describePatches(PATCHES[CONTROL]!, REPO_ROOT)}`);
  const child = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: "inherit",
    env: { ...process.env, GOAL_SCRATCH: SCRATCH, ...modulePatchEnv(PATCHES[CONTROL]!, REPO_ROOT, mark) }
  });
  assertPatched(PATCHES[CONTROL]!, REPO_ROOT, mark);
  process.exit(child.status ?? 1);
}

// ---------------------------------------------------------------------------
// The input: a pins user resource and an org projects collection, both
// written by the default write flow (the collection with `canWrite`), and a
// user resource with no `runBy`.
// ---------------------------------------------------------------------------

const ORG_A = "org-a";
const ORG_B = "org-b";

const pins = defineResource({
  ref: "pins",
  scope: "user",
  stateSchema: z.object({ pinned: z.array(z.string()).max(50).default([]) }),
  client: { expose: ["pinned"] },
  runBy: "default"
});

const projects = defineResourceCollection({
  pattern: "projects/*",
  scope: "org",
  stateSchema: z.object({ name: z.string().default(""), lead: z.string().default(""), status: z.string().default("draft") }),
  client: { state: { read: true } },
  runBy: "default",
  // No project goes nameless; anyone in the org may otherwise edit it.
  canWrite: ({ next }) => next === undefined || next.name.length > 0
});

const notes = defineResource({
  ref: "notes",
  scope: "user",
  stateSchema: z.object({ text: z.string().default("") }),
  client: { expose: ["text"] }
});

const noop = handler({ name: "noop", inputSchema: z.object({}).passthrough(), execute: () => ({}) });
const appFlow = (kind: string) => defineFlow({ kind, resources: { pins, projects, notes }, actions: { noop: { block: noop } } } as never);

/** The held-out data: who holds what before the run. */
const people = {
  alice: { org: ORG_A, pins: ["thread-a1"] },
  bob: { org: ORG_A, pins: ["thread-b1"] },
  carol: { org: ORG_B, pins: ["thread-c1"] }
} as const;
type Person = keyof typeof people;
const orgProject = { [ORG_A]: { topic: "apollo", name: "Apollo", lead: "alice" }, [ORG_B]: { topic: "zephyr", name: "Zephyr", lead: "carol" } } as const;

// ---------------------------------------------------------------------------
// Clients: each signs in by header and records what it sent and read.
// ---------------------------------------------------------------------------

type Sent = { url: string; status: number; body: { request?: { id?: string }; error?: string; message?: string } | null };

interface Probe {
  client: Client;
  /** Every resource send, with its HTTP answer. */
  sent: Sent[];
  /** The versions of the direct reads, in order. */
  readVersions: number[];
  /** Hold this client's next resource send until the promise settles. */
  holdNextSend(until: () => Promise<void>): void;
  /** Call `then` after this client's next direct read answers. */
  onNextRead(then: () => void): void;
}

function probe(base: string, signedIn: Person, claims: string = signedIn): Probe {
  const sent: Sent[] = [];
  const readVersions: number[] = [];
  let hold: (() => Promise<void>) | undefined;
  let afterRead: (() => void) | undefined;
  const client = createClient({
    userId: claims,
    baseUrl: base,
    fetcher: async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
      const isSend = method === "POST" && /\/resources\/(user|org)\/[^/]+\/actions\//.test(url);
      if (isSend && hold !== undefined) {
        const wait = hold;
        hold = undefined;
        await wait();
      }
      const headers = new Headers(init?.headers);
      headers.set("x-user", signedIn);
      headers.set("x-org", people[signedIn].org);
      const res = await fetch(input, { ...init, headers });
      if (isSend) sent.push({ url, status: res.status, body: await res.clone().json().catch(() => null) });
      if (method === "GET" && /\/resources\/(user|org)\//.test(url) && res.ok) {
        const body = (await res.clone().json().catch(() => null)) as { version?: number } | null;
        readVersions.push(body?.version ?? 0);
        const then = afterRead;
        afterRead = undefined;
        then?.();
      }
      return res;
    }
  });
  return {
    client,
    sent,
    readVersions,
    holdNextSend: (until) => {
      hold = until;
    },
    onNextRead: (then) => {
      afterRead = then;
    }
  };
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

/** Resolves once `count` calls of the returned tick have happened. */
function barrier(count: number): { tick: () => void; promise: Promise<void> } {
  const done = deferred();
  let seen = 0;
  return {
    tick: () => {
      seen += 1;
      if (seen === count) done.resolve();
    },
    promise: done.promise
  };
}

const requestIdsOf = (p: Probe, from = 0) => p.sent.slice(from).map((s) => s.body?.request?.id).filter((id): id is string => typeof id === "string");

await runGoal(async (failures, tell) => {
  const evidence: string[] = [];
  mkdirSync(SCRATCH, { recursive: true });
  const filename = join(SCRATCH, `stores-${RUN_STAMP}.sqlite`);
  const state = createFlowState({
    flows: [appFlow("threads"), appFlow("dashboard")],
    stores: { default: { primary: sqliteStores({ filename }) } },
    logger: silentLogger,
    resolvePrincipal: (context: { request?: Request }) => {
      const user = context.request?.headers.get("x-user");
      const org = context.request?.headers.get("x-org");
      return typeof user === "string" && typeof org === "string" ? { userId: user, orgId: org } : null;
    }
  } as never);
  let handle: ServeHandle | undefined;
  try {
    const stores = (await state.getRuntime()).stores;
    handle = await serve((await state.getRouter()) as never, { port: 0, host: "127.0.0.1", handleSignals: false, shutdownGraceMs: 200 });
    const base = `http://127.0.0.1:${handle.port}`;

    const userCell = (who: Person) => resolveResourceScopeId({ userId: who, orgId: people[who].org }, { id: "threads" }, "user", false);
    const orgCell = (org: string) => resolveResourceScopeId({ userId: "", orgId: org }, { id: "threads" }, "org", false);
    const storedPins = async (who: Person) => ((await stores.resourceState.get("user", userCell(who), "pins"))?.state as { pinned?: string[] } | undefined)?.pinned ?? [];
    const storedProject = async (org: string) =>
      (await stores.resourceState.get("org", orgCell(org), `projects/${orgProject[org as keyof typeof orgProject].topic}`))?.state as
        | { name: string; lead: string; status: string }
        | undefined;
    const storeSnapshot = async () =>
      JSON.stringify({
        sessions: (await stores.session.list({})).map((s) => [s.id, s.version]).sort(),
        requests: (await stores.request.list({})).map((r) => [r.id, r.status]).sort()
      });

    // Setup: what each person holds, written as a server flow would, before any client call.
    for (const [who, held] of Object.entries(people) as Array<[Person, (typeof people)[Person]]>) {
      await stores.resourceState.set("user", userCell(who), "pins", { pinned: [...held.pins] }, "any");
    }
    for (const [org, project] of Object.entries(orgProject)) {
      await stores.resourceState.set("org", orgCell(org), `projects/${project.topic}`, { name: project.name, lead: project.lead, status: "draft" }, "any");
    }

    const clients = { alice: probe(base, "alice"), bob: probe(base, "bob"), carol: probe(base, "carol") };

    // ------------------------------------------------------------------ a
    {
      const changed: string[] = [];
      let reads = 0;
      const read = async <T,>(what: string, run: () => Promise<T>): Promise<T> => {
        reads += 1;
        const before = await storeSnapshot();
        const value = await run();
        if ((await storeSnapshot()) !== before) changed.push(what);
        return value;
      };
      const sessionsBefore = (await stores.session.list({})).length;
      const seen: string[] = [];
      for (const who of Object.keys(people) as Person[]) {
        const own = await read(`${who}'s pins`, () => clients[who].client.resource(pins).state());
        seen.push(`${who} pins`);
        if (JSON.stringify(own.pinned) !== JSON.stringify(people[who].pins)) {
          failures.push(`a:own-pins: ${who} read ${JSON.stringify(own.pinned)}, holds ${JSON.stringify(people[who].pins)}`);
        }
        const org = people[who].org;
        const mine = orgProject[org];
        const entry = await read(`${who}'s org project`, () => clients[who].client.resource(projects).entry(mine.topic).read());
        seen.push(`${who} project`);
        if (entry.value?.name !== mine.name || entry.value?.lead !== mine.lead) {
          failures.push(`a:org-project: ${who} read ${JSON.stringify(entry.value)} for ${org}'s "${mine.topic}"`);
        }
        const listed = await read(`${who}'s org project list`, () => clients[who].client.resource(projects).list());
        const topics = listed.items.map((item) => item.topic).sort();
        if (JSON.stringify(topics) !== JSON.stringify([mine.topic])) {
          failures.push(`a:org-project: ${who} (${org}) listed ${JSON.stringify(topics)}, expected only ${JSON.stringify([mine.topic])}`);
        }
        // Another org's project, by its key: not this caller's to read.
        const other = Object.values(orgProject).find((p) => p.topic !== mine.topic)!;
        const foreign = await read(`${who}'s read of another org's project`, () => clients[who].client.resource(projects).entry(other.topic).read());
        if (foreign.value !== null) failures.push(`a:org-project: ${who} (${org}) read another org's "${other.topic}": ${JSON.stringify(foreign.value)}`);
      }
      tell.over("a · direct reads graded", seen);
      const sessionsAfter = (await stores.session.list({})).length;
      tell.over("a:no-session · reads that changed the session or request store", changed, { emptyIs: "the claim: no read makes or loads a session" });
      if (changed.length > 0) failures.push(`a:no-session: the session or request store changed on: ${changed.join(", ")}`);
      if (changed.length === 0) {
        evidence.push(`a: ${seen.length / 2} people read their own pins and their org's project (and nothing of the other org); sessions ${sessionsBefore} → ${sessionsAfter}, request store unchanged across ${reads} reads`);
      }
    }

    // ------------------------------------------------------------------ b
    {
      const writeSessions = async () => (await stores.session.list({})).filter((s) => isWriteSessionId(s.id));

      // b:one-session-per-writer — Alice's two tabs and Bob's two tabs make their
      // first pin at once. Every send is held until all four have read, so the
      // four first writes, and their session lookups, race. Each tab's pin must
      // be stored too (b:both-changes-stored): the two tabs read one version.
      const tabs = { alice: [probe(base, "alice"), probe(base, "alice")], bob: [probe(base, "bob"), probe(base, "bob")] };
      const allRead = barrier(4);
      for (const tab of [...tabs.alice, ...tabs.bob]) {
        tab.onNextRead(allRead.tick);
        tab.holdNextSend(() => allRead.promise);
      }
      const before = new Set((await writeSessions()).map((s) => s.id));
      const pinned = await Promise.allSettled(
        (Object.entries(tabs) as Array<["alice" | "bob", Probe[]]>).flatMap(([who, pair]) =>
          pair.map((tab, i) => tab.client.resource(pins).update((v) => ({ pinned: [...v.pinned, `${who}-tab-${i + 1}`] })))
        )
      );
      for (const r of pinned) if (r.status === "rejected") failures.push(`b:one-session-per-writer: a first pin was refused: ${String(r.reason)}`);
      const fresh = (await writeSessions()).filter((s) => !before.has(s.id));
      tell.over("b:one-session-per-writer · write sessions made by the race", fresh);
      for (const who of ["alice", "bob"] as const) {
        const theirs = fresh.filter((s) => s.userId === who);
        const used = new Set(
          await Promise.all(tabs[who].flatMap((tab) => requestIdsOf(tab)).map(async (id) => (await stores.request.get(id))?.sessionId))
        );
        if (theirs.length !== 1) failures.push(`b:one-session-per-writer: ${who}'s two first writes made ${theirs.length} write sessions`);
        if (used.size !== 1 || !used.has(theirs[0]?.id)) failures.push(`b:one-session-per-writer: ${who}'s pin requests ran in ${JSON.stringify([...used])}`);
        const expected = [...people[who].pins, `${who}-tab-1`, `${who}-tab-2`].sort();
        const stored = [...(await storedPins(who))].sort();
        // Two tabs' changes at once are a concurrent edit too: both must be stored.
        if (JSON.stringify(stored) !== JSON.stringify(expected)) failures.push(`b:both-changes-stored: ${who}'s two tabs' pins at once left ${JSON.stringify(stored)}, expected ${JSON.stringify(expected)}`);
      }
      if (fresh.length === 2 && new Set(fresh.map((s) => s.userId)).size === 2) {
        evidence.push(`b: four first pins at once (two tabs each) made one write session per writer (${fresh.length}), every pin stored`);
      }

      // b:both-changes-stored — Alice renames org A's project while Bob changes its
      // lead. Both read the same version before either writes; Bob's write is sent
      // after Alice's has landed, so it carries the version Alice's replaced.
      const alice = probe(base, "alice");
      const bob = probe(base, "bob");
      const bothRead = barrier(2);
      const aliceLanded = deferred();
      alice.onNextRead(bothRead.tick);
      bob.onNextRead(bothRead.tick);
      alice.holdNextSend(() => bothRead.promise);
      bob.holdNextSend(async () => {
        await bothRead.promise;
        await aliceLanded.promise;
      });
      const topic = orgProject[ORG_A].topic;
      const renamed = `${orgProject[ORG_A].name} (renamed by alice)`;
      const [a, b] = await Promise.allSettled([
        alice.client.resource(projects).entry(topic).update((v) => ({ ...v!, name: renamed })).finally(aliceLanded.resolve),
        bob.client.resource(projects).entry(topic).update((v) => ({ ...v!, lead: "bob" }))
      ]);
      const project = await storedProject(ORG_A);
      tell.over("b:both-changes-stored · versions the two clients first read", [alice.readVersions[0], bob.readVersions[0]].filter((v) => v !== undefined));
      if (alice.readVersions[0] !== bob.readVersions[0]) failures.push(`b:both-changes-stored: the clients read versions ${alice.readVersions[0]} and ${bob.readVersions[0]}, so nothing raced`);
      if (a.status === "rejected" || b.status === "rejected") failures.push(`b:both-changes-stored: an update was refused: ${String(a.status === "rejected" ? a.reason : (b as PromiseRejectedResult).reason)}`);
      // The race happened and the version caught it: Bob's first write ended
      // refused as stale (read from its request record), and he wrote again.
      const bobEndings = await Promise.all(
        requestIdsOf(bob).map(async (id) => {
          const record = await stores.request.get(id);
          return { status: record?.status, code: (record?.result as { error?: { code?: string } } | undefined)?.error?.code };
        })
      );
      const staleRefused = bobEndings.filter((e) => e.code === "stale_version");
      if (bob.sent.length < 2 || staleRefused.length === 0) {
        failures.push(`b:both-changes-stored: bob's client sent ${bob.sent.length} write(s), ended ${JSON.stringify(bobEndings)}: no stale write was refused`);
      }
      if (project?.name !== renamed || project?.lead !== "bob") {
        failures.push(`b:both-changes-stored: org A's project is ${JSON.stringify(project)}; expected name "${renamed}" and lead "bob"`);
      } else if (bob.sent.length >= 2 && staleRefused.length > 0) {
        evidence.push(
          `b: two updates from version ${alice.readVersions[0]} both stored (name and lead); bob's ${bob.sent.length} writes ended ${bobEndings.map((e) => e.code ?? e.status).join(", ")}`
        );
      }

      // b:request-names-writer — every write above recorded a request naming the
      // person who sent it, in that person's own write session.
      const senders: Array<[Person, Probe]> = [
        ...tabs.alice.map((t) => ["alice", t] as [Person, Probe]),
        ...tabs.bob.map((t) => ["bob", t] as [Person, Probe]),
        ["alice", alice],
        ["bob", bob]
      ];
      const graded: string[] = [];
      for (const [who, p] of senders) {
        for (const id of requestIdsOf(p)) {
          const record = await stores.request.get(id);
          const session = record?.sessionId === undefined ? undefined : await stores.session.get(record.sessionId);
          graded.push(id);
          if (record?.userId !== who || session?.userId !== who) {
            failures.push(`b:request-names-writer: ${who}'s request ${id} names ${record?.userId}, in a session of ${session?.userId}`);
          }
        }
      }
      tell.over("b:request-names-writer · write requests", graded);
      if (graded.length > 0 && !failures.some((f) => f.startsWith("b:request-names-writer"))) {
        evidence.push(`b: all ${graded.length} write requests name their writer`);
      }

      // b:no-run-by-refused — a user resource that names no writer.
      const refusedFrom = clients.alice.sent.length;
      const requestsBefore = (await stores.request.list({})).length;
      const refused = await clients.alice.client.resource(notes).set({ text: "written from a client" }).then(
        () => undefined,
        (error: unknown) => error
      );
      const answer = clients.alice.sent[refusedFrom];
      const notesStored = await stores.resourceState.get("user", userCell("alice"), "notes");
      if (refused === undefined) failures.push("b:no-run-by-refused: a write to a resource with no runBy resolved");
      if (answer?.status !== 403 || answer.body?.error !== "not_writable" || !/runBy/.test(answer.body?.message ?? "")) {
        failures.push(`b:no-run-by-refused: answered ${answer?.status} ${JSON.stringify(answer?.body)}, expected 403 not_writable naming runBy`);
      }
      if (notesStored !== undefined) failures.push(`b:no-run-by-refused: notes were stored: ${JSON.stringify(notesStored.state)}`);
      if ((await stores.request.list({})).length !== requestsBefore) failures.push("b:no-run-by-refused: the refused write recorded a request");
      if (refused !== undefined && answer?.status === 403 && notesStored === undefined) {
        evidence.push(`b: a resource with no runBy refused (${answer.status} ${answer.body?.error}: "${answer.body?.message}")`);
      }

      // b:forged-user-ignored — signed in as Alice, the client claims Bob (`userId`
      // in the body and the query). The pin lands in Alice's cell, and the request
      // names Alice.
      const forger = probe(base, "alice", "bob");
      const bobBefore = await storedPins("bob");
      const forgedPin = "pinned-by-alice-claiming-bob";
      const forged = await forger.client.resource(pins).update((v) => ({ pinned: [...v.pinned, forgedPin] })).then(
        () => undefined,
        (error: unknown) => String(error)
      );
      // The client can give up before the write it sent has run (a 404 on the
      // request read, under the control): grade the stores once every request
      // has ended, so a write that landed late is seen.
      await untilIdle(stores);
      const aliceAfter = await storedPins("alice");
      const bobAfter = await storedPins("bob");
      const forgedRequests = await Promise.all(requestIdsOf(forger).map((id) => stores.request.get(id)));
      tell.over("b:forged-user-ignored · the forged client's write requests", forgedRequests);
      // What must hold, each named: the write lands in Alice's pins, Bob's are
      // unchanged, and every request it recorded (at least one) names alice.
      const problems = [
        ...(forged === undefined ? [] : [`the write was refused (${forged})`]),
        ...(aliceAfter.includes(forgedPin) ? [] : [`alice's pins ${JSON.stringify(aliceAfter)} lack it`]),
        ...(JSON.stringify(bobAfter) === JSON.stringify(bobBefore) ? [] : [`bob's pins changed: ${JSON.stringify(bobBefore)} → ${JSON.stringify(bobAfter)}`]),
        ...(forgedRequests.length > 0 && forgedRequests.every((r) => r?.userId === "alice")
          ? []
          : [`its requests name ${JSON.stringify(forgedRequests.map((r) => r?.userId))}, not alice`])
      ];
      if (problems.length > 0) {
        failures.push(`b:forged-user-ignored: a client signed in as alice claiming bob: ${problems.join("; ")}`);
      } else {
        evidence.push("b: a userId of bob in the body and query of alice's client wrote alice's pins; bob's unchanged; the request names alice");
      }
    }

    // ------------------------------------------------------------------ c
    {
      const before = await storeSnapshot();
      const answers: Array<[string, { userId: string; orgId: string }, { userId: string; orgId: string }]> = [];
      for (const who of Object.keys(people) as Person[]) {
        answers.push([who, await clients[who].client.flow("threads").identity(), { userId: who, orgId: people[who].org }]);
      }
      // A client that claims Bob while signed in as Alice learns it is Alice.
      answers.push(["alice claiming bob", await probe(base, "alice", "bob").client.flow("dashboard").identity(), { userId: "alice", orgId: ORG_A }]);
      tell.over("c:identity · identity reads", answers);
      for (const [who, got, want] of answers) {
        if (got.userId !== want.userId || got.orgId !== want.orgId) failures.push(`c:identity: ${who} read ${JSON.stringify(got)}, signed in as ${JSON.stringify(want)}`);
      }
      if ((await storeSnapshot()) !== before) failures.push("c:identity: the identity read changed the session or request store");
      else if (!failures.some((f) => f.startsWith("c:identity"))) evidence.push(`c: ${answers.length} identity reads answered the signed-in user and org, store unchanged`);

      const inventory = spawnSync("bash", ["specs/issues/FIX-2624/poc/helper-inventory/run.sh"], {
        cwd: REPO_ROOT,
        env: { ...process.env, POC_EXPECT: "gone" },
        encoding: "utf8"
      });
      const verdict = (inventory.stdout ?? "").trim().split("\n").filter((l) => /^(PASS|FAIL)/.test(l));
      tell.over("c:inventory · the checker's verdict line", verdict);
      if (inventory.status !== 0) failures.push(`c:inventory: POC_EXPECT=gone exited ${inventory.status}: ${verdict.join(" ") || (inventory.stderr ?? "").slice(-400)}`);
      else evidence.push(`c: inventory ${verdict.join(" ")}`);
    }
  } finally {
    await handle?.close();
    await state.dispose?.();
  }
  console.error(`evidence: ${evidence.join(" · ")}`);
  return { failures, evidence: evidence.join(" · ") };
});
