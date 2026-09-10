/**
 * Goal check — a described worker becomes one you can talk to.
 *
 * Two worker records, two flow kinds an app defined in code, one call. Each
 * worker becomes a copy addressable by its own id, running on the settings its
 * own record declared and none of its sibling's — read back through the real
 * HTTP router after a restart, from a block nested inside the action. A record
 * naming a kind nobody defined, one declaring a setting its flow never offered,
 * and a body handed to a flow kind that never asked for one all refuse at the
 * hire, with nothing registered.
 *
 * Real path, no mocking, no model. See goal.md for the contract.
 *
 * Run: pnpm tsx goals/workforce-seats/two-seats-run-their-own-configuration/run.mts
 */
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFlowApiRouter, createFlowRegistry, type StoreRegistry } from "@flow-state-dev/engine";
import { createSQLiteStores } from "@flow-state-dev/store-sqlite";
import { hireWorkforce, type HireOptions, type WorkerManifest } from "@flow-state-dev/workforce";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { fixtureDir, loadFixture, runGoal, silentLogger, stripIntentOverrides } from "../../lib/index.mts";
import { INTAKE_KIND, WORKER_AGENT_KIND, intakeFlow, workerAgentFlow } from "./fixtures/flows";

type LeadFixture = {
  id: string;
  flow: string;
  description: string;
  model: string;
  tools: string[];
  body: string;
};
type IntakeFixture = { id: string; flow: string; description: string; desk: string };
type RefusalFixture = {
  dir: string;
  id: string;
  flow: string;
  description: string;
  body: string;
  key?: string;
  value?: string;
};
type Fixture = {
  userId: string;
  note: string;
  roster: { lead: LeadFixture; intake: IntakeFixture };
  refusals: {
    unknownKind: RefusalFixture;
    undeclaredSetting: RefusalFixture;
    thinWithBody: RefusalFixture;
  };
};

stripIntentOverrides();

const fixture = loadFixture<Fixture>(import.meta.url);
const { lead, intake } = fixture.roster;

const kinds: HireOptions["kinds"] = {
  [WORKER_AGENT_KIND]: workerAgentFlow,
  [INTAKE_KIND]: intakeFlow
};

// ---------------------------------------------------------------------------
// Where the records come from. The selector is mechanical — the presence of the
// loader export, never a judgement call — and the run says which half it took,
// so a reader can tell which bar a green run cleared.
// ---------------------------------------------------------------------------

type LoaderModule = {
  readWorkforceDirectory?: (root: string) => Promise<{ workers: WorkerManifest[] }>;
};

/** Not a literal specifier: the subpath does not exist until the loader lands. */
const LOADER_SPECIFIER = "@flow-state-dev/workforce/loader";

const loader: LoaderModule | undefined = await import(LOADER_SPECIFIER).then(
  (mod: LoaderModule) => (typeof mod.readWorkforceDirectory === "function" ? mod : undefined),
  () => undefined
);

const rosterSource = loader
  ? `readWorkforceDirectory(fixtures/teams)`
  : "hand-built manifests (loader not landed)";
console.log(`roster source: ${rosterSource}`);

/** Hand-built exactly as the shared record type declares it. */
function handBuilt(over: {
  id: string;
  declared: Record<string, unknown>;
  body?: string;
}): WorkerManifest {
  return { id: over.id, declared: over.declared, body: over.body ?? "" };
}

const handBuiltRosters: Record<string, WorkerManifest[]> = {
  teams: [
    handBuilt({
      id: lead.id,
      declared: {
        description: lead.description,
        flow: lead.flow,
        model: lead.model,
        tools: lead.tools
      },
      body: lead.body
    }),
    handBuilt({
      id: intake.id,
      declared: { description: intake.description, flow: intake.flow, desk: intake.desk }
    })
  ],
  [fixture.refusals.unknownKind.dir]: [
    handBuilt({
      id: fixture.refusals.unknownKind.id,
      declared: {
        description: fixture.refusals.unknownKind.description,
        flow: fixture.refusals.unknownKind.flow
      },
      body: fixture.refusals.unknownKind.body
    })
  ],
  [fixture.refusals.undeclaredSetting.dir]: [
    handBuilt({
      id: fixture.refusals.undeclaredSetting.id,
      declared: {
        description: fixture.refusals.undeclaredSetting.description,
        flow: fixture.refusals.undeclaredSetting.flow,
        [fixture.refusals.undeclaredSetting.key!]: fixture.refusals.undeclaredSetting.value
      },
      body: fixture.refusals.undeclaredSetting.body
    })
  ],
  [fixture.refusals.thinWithBody.dir]: [
    handBuilt({
      id: fixture.refusals.thinWithBody.id,
      declared: {
        description: fixture.refusals.thinWithBody.description,
        flow: fixture.refusals.thinWithBody.flow
      },
      body: fixture.refusals.thinWithBody.body
    })
  ]
};

/**
 * The `WORKER.md` a record's id maps to — which is also the folder convention
 * under test: "engineering.lead" lives at teams/engineering/workers/lead/.
 */
function workerFile(tree: string, id: string): string {
  const [team, name] = id.split(".");
  const base = tree === "teams" ? fixtureDir(import.meta.url) : join(fixtureDir(import.meta.url), tree);
  return join(base, "teams", team ?? "", "workers", name ?? "", "WORKER.md");
}

/**
 * What a `WORKER.md` declares: its frontmatter keys, and the body under them.
 *
 * Not a loader — it produces no records and nothing under test consumes it.
 * It exists only to compare the two fixture sources to each other.
 */
function declarationsOf(text: string): { front: Map<string, string>; body: string } {
  const parsed = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (parsed === null) return { front: new Map(), body: text.trim() };
  const front = new Map<string, string>();
  for (const line of (parsed[1] ?? "").split("\n")) {
    const at = line.indexOf(":");
    if (at <= 0) continue;
    front.set(line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^"(.*)"$/, "$1"));
  }
  return { front, body: (parsed[2] ?? "").trim() };
}

/**
 * What keeps the two roster sources honest.
 *
 * The fixture tree is what the loader path reads; `input.json` is what every
 * assertion grades against and what the hand-built path builds from. Nothing
 * would otherwise notice them drifting apart — a model string changed in one
 * and not the other would quietly weaken whichever path is not running. Values
 * are compared whole: a substring check would let "openai/gpt-5.4-mini" pass
 * for "openai/gpt-5.4".
 *
 * **Temporary, and delete it here rather than move it.** This exists only while
 * the fixture tree goes unread. Once `readWorkforceDirectory` lands, the run
 * takes the loader path, the tree becomes the roster the assertions grade, and
 * a drift between the two sources fails on its own — so this check, and the
 * `declarationsOf` parse under it, go with it.
 */
function declares(tree: string, id: string, expected: Record<string, string>, body: string): string[] {
  const path = workerFile(tree, id);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return [`${id}: no WORKER.md at ${path}`];
  }
  const seen = declarationsOf(text);
  const drift = Object.entries(expected)
    .filter(([key, value]) => seen.front.get(key) !== value)
    .map(
      ([key, value]) =>
        `${id}: its WORKER.md declares ${key}: ${JSON.stringify(seen.front.get(key) ?? null)}, input.json says ` +
        `${JSON.stringify(value)} — the fixture tree and input.json have drifted`
    );
  if (seen.body !== body.trim()) {
    drift.push(`${id}: its WORKER.md body differs from the one in input.json — the two sources have drifted`);
  }
  return drift;
}

/** One fixture tree's records, from whichever source this run is using. */
async function roster(tree: string): Promise<WorkerManifest[]> {
  if (loader?.readWorkforceDirectory) {
    const root = tree === "teams" ? fixtureDir(import.meta.url) : join(fixtureDir(import.meta.url), tree);
    const { workers } = await loader.readWorkforceDirectory(root);
    return workers;
  }
  return handBuiltRosters[tree]!;
}

// ---------------------------------------------------------------------------
// The host.
// ---------------------------------------------------------------------------

function host(stores: StoreRegistry, flows: FlowInstance[]) {
  const registry = createFlowRegistry();
  registry.registerMany(flows);
  return createFlowApiRouter({ registry, stores, runtimeConfig: { logger: silentLogger } } as never);
}

type Router = ReturnType<typeof createFlowApiRouter>;

async function act(router: Router, address: string, sessionId: string): Promise<Response> {
  const path = [address, sessionId, "actions", "run"];
  return router.POST(
    new Request(`http://goal/api/flows/${path.join("/")}`, {
      method: "POST",
      body: JSON.stringify({ userId: fixture.userId, input: { note: fixture.note } })
    }),
    { params: { path } }
  );
}

/** What a seat's blocks actually ran on, through the public `/state` route. */
async function ranOn(router: Router, sessionId: string) {
  const path = ["sessions", sessionId, "state"];
  const res = await router.GET(new Request(`http://goal/api/flows/${path.join("/")}`), {
    params: { path }
  });
  const body = (await res.json()) as {
    clientData?: {
      session?: { ran?: { persona?: string | null; model?: string | null; desk?: string | null; runs?: number } };
    };
  };
  return { status: res.status, ...(body.clientData?.session?.ran ?? {}) };
}

async function settled(stores: StoreRegistry, requestId: string): Promise<string | undefined> {
  for (let i = 0; i < 200; i += 1) {
    const record = await stores.request.get(requestId);
    if (record !== undefined && record.status !== "in_progress") return record.status;
    await new Promise((r) => setTimeout(r, 25));
  }
  return undefined;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

await runGoal(async () => {
  const failures: string[] = [];
  const evidence: string[] = [`roster source: ${rosterSource}`];
  const dir = mkdtempSync(join(tmpdir(), "fsd-workforce-seats-"));
  const dbFile = join(dir, "goal.db");
  const sessions: Record<string, string> = { [lead.id]: "s_lead", [intake.id]: "s_intake" };

  const records = await roster("teams");
  // Hired once. Registering the same copies in each host is the shape an app
  // has anyway — one hire at boot, whatever is built around it afterwards.
  const seats = hireWorkforce(records, { kinds });

  // ---- (0) the two roster sources still say the same thing ---------------
  {
    const { unknownKind, undeclaredSetting, thinWithBody } = fixture.refusals;
    failures.push(
      ...declares(
        "teams",
        lead.id,
        {
          description: lead.description,
          flow: lead.flow,
          model: lead.model,
          tools: `[${lead.tools.join(", ")}]`
        },
        lead.body
      ),
      ...declares("teams", intake.id, { description: intake.description, flow: intake.flow, desk: intake.desk }, ""),
      ...declares(
        unknownKind.dir,
        unknownKind.id,
        { description: unknownKind.description, flow: unknownKind.flow },
        unknownKind.body
      ),
      ...declares(
        undeclaredSetting.dir,
        undeclaredSetting.id,
        {
          description: undeclaredSetting.description,
          flow: undeclaredSetting.flow,
          [undeclaredSetting.key!]: undeclaredSetting.value!
        },
        undeclaredSetting.body
      ),
      ...declares(
        thinWithBody.dir,
        thinWithBody.id,
        { description: thinWithBody.description, flow: thinWithBody.flow },
        thinWithBody.body
      )
    );
    evidence.push(
      "every WORKER.md in the fixture trees declares exactly what input.json says it does, so neither roster source can drift from the other unnoticed"
    );
  }

  // ---- (a) one call, one copy per record, each answering to its own id ----
  {
    if (records.length !== 2) {
      failures.push(`the roster produced ${records.length} record(s), wanted 2`);
    }
    const ids = seats.map((s) => s.id);
    if (ids.join(",") !== [intake.id, lead.id].join(",")) {
      failures.push(`hired ${JSON.stringify(ids)}, wanted the two record ids in id order`);
    }
    if (seats.some((s) => s.id === WORKER_AGENT_KIND || s.id === INTAKE_KIND)) {
      failures.push("a seat is addressed by its flow kind rather than by its own id");
    }
    evidence.push("one call turned the two records into two flow copies, each carrying its record's id");
  }

  // ---- (b) each seat runs on its OWN record's settings, read after a restart
  let stores: StoreRegistry = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, seats);
    for (const id of [lead.id, intake.id]) {
      const res = await act(router, id, sessions[id]!);
      const body = (await res.json()) as { request?: { id: string } };
      if (res.status !== 202) failures.push(`${id}: expected 202 from its own address, got ${res.status}`);
      const status = await settled(stores, body.request?.id ?? "");
      if (status !== "completed") failures.push(`${id}: request ended ${String(status)}`);
    }
    evidence.push("both seats ran an action to completion through the real HTTP route");
  }

  (stores as unknown as { close(): void }).close();
  stores = createSQLiteStores({ filename: dbFile }) as unknown as StoreRegistry;
  {
    const router = host(stores, seats);

    const seenLead = await ranOn(router, sessions[lead.id]!);
    if (seenLead.status !== 200) failures.push(`${lead.id}: /state returned ${seenLead.status}`);
    // The body's whole journey, observed at the far end: file (or record) →
    // config bag → a block nested inside the action.
    if ((seenLead.persona ?? "").trim() !== lead.body.trim()) {
      failures.push(`${lead.id}: its nested block saw persona ${JSON.stringify(seenLead.persona)}`);
    }
    if (seenLead.model !== lead.model) {
      failures.push(`${lead.id}: its nested block ran on model ${String(seenLead.model)}`);
    }
    // The sibling's setting must be ABSENT, not merely different — one shared
    // bag is always right for somebody.
    if (seenLead.desk != null) {
      failures.push(`${lead.id}: read its sibling's desk (${String(seenLead.desk)})`);
    }
    if (seenLead.runs !== 1) failures.push(`${lead.id}: ran ${String(seenLead.runs)} times`);

    const seenIntake = await ranOn(router, sessions[intake.id]!);
    if (seenIntake.status !== 200) failures.push(`${intake.id}: /state returned ${seenIntake.status}`);
    // The thin seat is a LIVE seat, not an omission: it ran, and what it wrote
    // is its own flow's setting.
    if (seenIntake.desk !== intake.desk) {
      failures.push(`${intake.id}: its nested block saw desk ${String(seenIntake.desk)}`);
    }
    if (seenIntake.persona != null) {
      failures.push(`${intake.id}: a thin seat carried a persona (${String(seenIntake.persona)})`);
    }
    if (seenIntake.model != null) {
      failures.push(`${intake.id}: read its sibling's model (${String(seenIntake.model)})`);
    }
    if (seenIntake.runs !== 1) failures.push(`${intake.id}: ran ${String(seenIntake.runs)} times`);

    evidence.push(
      "after closing the store and rebuilding the host, each seat's nested block shows the settings its own record declared — the lead's body arrived as its persona — and no sibling's"
    );

    // ---- (c) the bare flow kind is not an address -------------------------
    for (const kind of [WORKER_AGENT_KIND, INTAKE_KIND]) {
      const res = await act(router, kind, `s_bare_${kind}`);
      if (res.status !== 404) {
        failures.push(`the bare kind "${kind}" answered with ${res.status}, wanted 404`);
      }
    }
    evidence.push("neither bare flow kind is an address — both 404");
  }

  // ---- (d) three refusals, each leaving nothing registered ----------------
  {
    const cases = [
      {
        what: "a record naming a kind the app did not define",
        records: [...records, ...(await roster(fixture.refusals.unknownKind.dir))],
        names: [fixture.refusals.unknownKind.id, fixture.refusals.unknownKind.flow]
      },
      {
        what: "a record declaring a setting its flow never offered",
        records: [...records, ...(await roster(fixture.refusals.undeclaredSetting.dir))],
        names: [fixture.refusals.undeclaredSetting.id, fixture.refusals.undeclaredSetting.key!]
      },
      {
        what: "a body handed to a flow kind that never declared one",
        // The SAME thin record, with a body added: thinness is a property the
        // framework enforces, so this is the enforcement being graded.
        records: [
          records.find((r) => r.id === lead.id)!,
          ...(await roster(fixture.refusals.thinWithBody.dir))
        ],
        names: [fixture.refusals.thinWithBody.id, "persona"]
      }
    ];

    for (const testCase of cases) {
      let hired: FlowInstance[] | undefined;
      let refusal = "";
      try {
        hired = hireWorkforce(testCase.records, { kinds });
      } catch (error) {
        refusal = messageOf(error);
      }
      if (hired !== undefined) {
        failures.push(`${testCase.what}: the hire returned ${hired.length} seat(s) instead of refusing`);
        continue;
      }
      for (const name of testCase.names) {
        if (!refusal.includes(name)) {
          failures.push(`${testCase.what}: the refusal does not name "${name}": ${refusal}`);
        }
      }
      // A refusal after a partial hire is not a refusal: nothing came back, so
      // nothing can be registered, and the good worker's address is dead too.
      const router = host(stores, hired ?? []);
      const res = await act(router, lead.id, `s_refused_${testCase.names[0]}`);
      if (res.status !== 404) {
        failures.push(`${testCase.what}: a seat was registered anyway (${lead.id} answered ${res.status})`);
      }
    }
    evidence.push(
      "an unknown kind, an undeclared setting and a body handed to a thin kind each refuse at the hire, naming the worker, with nothing hired and nothing registered"
    );
  }

  (stores as unknown as { close(): void }).close();
  return { failures, evidence: evidence.join("; ") };
});
