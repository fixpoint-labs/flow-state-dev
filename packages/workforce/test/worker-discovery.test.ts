/**
 * A worker's own `discover:` key — what crosses the scope fence, and the one
 * thing it must never be able to do.
 *
 * Graded on what the DOOR ANSWERED, not on what the registry holds or what the
 * config parsed to. A worker whose settings carry the right list and whose tool
 * returns the whole catalogue anyway is exactly the failure this key exists to
 * remove, and every shape assertion over the registry survives it. So each case
 * builds the generator through the real `uses` merge, resolves the tool the
 * model would be offered, and runs it.
 *
 * The case that matters is BR-11: a worker naming a domain its scope does not
 * carry. It is written with a sibling worker that names an in-scope domain in the
 * same list, so "the file was ignored entirely" and "the file narrowed and
 * could not widen" are two different readings rather than one.
 */
import { describe, expect, it } from "vitest";
import { generator } from "@flow-state-dev/core";
import type { BlockManifestSource, FlowInstance } from "@flow-state-dev/core";
import { executeBlock } from "@flow-state-dev/engine";
import { createTestContext, runForTest } from "@flow-state-dev/testing";
import { createWorkforceCapability } from "../src/workforce-capability";
import { defineAgentWorkerFlow } from "../src/agent-worker-flow";
import { mintWorkers } from "../src/hire";
import { markVerifiedWorker } from "../src/workers/verified-worker";
import type { WorkerManifest } from "../src/manifest";

/**
 * A source that answers for one domain with one entry, so a domain's presence
 * in an answer is a distinct string rather than a count.
 */
const sourceOf = (domain: BlockManifestSource["domain"]): BlockManifestSource => ({
  domain,
  origin: `test:${domain}`,
  entries: () => [{ id: `${domain}-one`, kind: domain, purpose: `A ${domain} entry.` }]
});

/** The capability under test, carrying two of the three domains. */
function capabilityWithTwoDomains() {
  return createWorkforceCapability({
    roster: { workers: [] },
    inventory: {},
    sources: [sourceOf("workers"), sourceOf("skills")]
  });
}

/**
 * A block ctx whose flow config is what one worker's file parsed to, or, with
 * `resolved`, the shared flow's own settings (no `discover:`) while the turn
 * resolved a worker whose file named `discover`, as on the `coordinator` flow.
 */
function ctxForWorker(discover?: string[], resolved = false): never {
  const session = { state: {} };
  if (resolved) markVerifiedWorker(session, "project-coordinator", discover === undefined ? {} : { discover });
  return {
    flow: { config: discover === undefined || resolved ? {} : { discover } },
    resources: {},
    signal: new AbortController().signal,
    session,
    request: { state: {} },
    user: { state: {} },
    self: { state: {} }
  } as never;
}

/**
 * Resolve the tools this worker would be offered and run the door, returning the
 * domains it answered with.
 *
 * Goes through `generator({ uses })` rather than calling the capability's
 * resolver directly: the control-tool path is where a capability's tool either
 * reaches the model or silently does not, and a test that skipped it would be
 * green for a door nobody could call.
 */
async function askDoor(
  capability: ReturnType<typeof capabilityWithTwoDomains>,
  discover?: string[],
  input: { domain?: string | null; detail?: "thin" | "full" } = {},
  resolved = false
): Promise<{ domains: string[]; problem?: string; entries: string[] }> {
  const gen = generator({
    name: "answerer",
    model: "openai/gpt-5.4-mini",
    prompt: "p",
    uses: [capability]
  });
  const ctx = ctxForWorker(discover, resolved);
  const tools = await (gen.config as { tools: (i: unknown, c: unknown) => Promise<unknown[]> }).tools(
    undefined,
    ctx
  );
  const door = (tools as Array<{ name?: string }>).find((tool) => tool.name === "discover");
  if (!door) throw new Error(`no discover tool among [${tools.map((t: any) => t.name).join(", ")}]`);

  const result = (await runForTest(
    door as never,
    { domain: input.domain ?? null, detail: input.detail ?? "thin" } as never,
    ctx
  )) as { domains: Array<{ domain: string; entries: Array<{ id: string }> }>; problem?: string };

  return {
    domains: result.domains.map((entry) => entry.domain),
    ...(result.problem === undefined ? {} : { problem: result.problem }),
    entries: result.domains.flatMap((d) => d.entries.map((e) => e.id))
  };
}

describe("a worker narrows the discovery door with its own file", () => {
  it("BR-10 · sees every domain its scope carries when its file names none", async () => {
    const answer = await askDoor(capabilityWithTwoDomains(), undefined);
    expect(answer.domains).toEqual(["workers", "skills"]);
    expect(answer.entries).toEqual(["workers-one", "skills-one"]);
  });

  it("BR-9 · sees the domains it named and no others", async () => {
    const answer = await askDoor(capabilityWithTwoDomains(), ["workers"]);
    expect(answer.domains).toEqual(["workers"]);
    // Absent, not empty-with-a-reason: the withheld domain does not appear at
    // all, so there is nothing for the model to ask about again.
    expect(answer.domains).not.toContain("skills");
  });

  it("BR-11 · does not reach a domain its scope lacks by naming it", async () => {
    // `resources` is one of the three pinned names and is NOT in this scope.
    // `workers` is in the same list and IS — so a run that returned nothing at
    // all would be a different failure than the one under test.
    const answer = await askDoor(capabilityWithTwoDomains(), ["workers", "resources"]);
    expect(answer.domains).toEqual(["workers"]);
    expect(answer.entries).toEqual(["workers-one"]);
  });

  it("BR-11 · cannot reach a withheld domain by asking the tool for it directly", async () => {
    // The gate is the registry, not the tool's filter (BP-031). The `domain`
    // argument is model-supplied, so this is the call a worker would make to
    // route around its own file.
    const answer = await askDoor(capabilityWithTwoDomains(), ["workers"], { domain: "skills" });
    expect(answer.entries).toEqual([]);
    expect(answer.domains).toEqual(["skills"]);
  });

  it("sees nothing at all when its file names an empty list", async () => {
    const answer = await askDoor(capabilityWithTwoDomains(), []);
    expect(answer.domains).toEqual([]);
  });

  it("is narrowed by the file of the worker its turn resolved, on a flow many workers share", async () => {
    // On `coordinator` the flow's own settings carry no `discover:`; the worker's
    // file is the one the turn resolved. Reading the flow's settings alone left
    // every coordinator seeing every worker, the ones that can't lead included.
    const answer = await askDoor(capabilityWithTwoDomains(), [], {}, true);
    expect(answer.domains).toEqual([]);
    expect(answer.entries).toEqual([]);
  });

  it("BR-4 · names the known domains rather than throwing on a domain that does not exist", async () => {
    const answer = await askDoor(capabilityWithTwoDomains(), undefined, { domain: "boards" });
    expect(answer.problem).toMatch(/Unknown domain "boards"/);
    expect(answer.problem).toMatch(/workers, skills, resources/);
  });
});

describe("the `discover:` worker-file key", () => {
  const record = (over: Partial<WorkerManifest> & { id: string }): WorkerManifest => ({
    declared: {},
    body: "",
    ...over
  });

  function hire(manifests: WorkerManifest[]) {
    const flow = defineAgentWorkerFlow({ uses: [capabilityWithTwoDomains()] });
    return mintWorkers(manifests, { workerFlows: { agent: flow as never } });
  }

  it("carries a worker's list onto its settings", () => {
    const [worker] = hire([
      record({ id: "engineering.lead", declared: { discover: ["workers", "skills"] } })
    ]);
    expect((worker!.config as { discover?: string[] }).discover).toEqual(["workers", "skills"]);
  });

  it("leaves the key absent when the file names none, which is today's reach", () => {
    const [worker] = hire([record({ id: "engineering.lead" })]);
    expect((worker!.config as { discover?: string[] }).discover).toBeUndefined();
  });

  it("refuses a misspelled domain at the mint, naming the three", () => {
    let message = "";
    try {
      hire([record({ id: "engineering.lead", declared: { discover: ["seets"] } })]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // The refusal has to point at THIS key and list the real names, or an
    // author reading it learns only that something about their file is wrong.
    expect(message).toMatch(/discover/);
    expect(message).toMatch(/workers/);
    expect(message).toMatch(/skills/);
    expect(message).toMatch(/resources/);
  });

  /**
   * The two halves joined: hire a worker from a record, run its own turn, and
   * call the door the worker's generator was actually handed.
   *
   * Every case above tests one half — a door built on a bare generator, or a
   * hired worker's parsed config. Both can be green while the capability never
   * reaches the worker's answering generator at all, or reaches it built from
   * the wrong worker's config. The model resolver here is the real seam a
   * provider sits behind, so `options.tools` is the tool list this worker would
   * have been offered, with its own context already bound into `execute`.
   */
  async function askThroughHiredWorker(worker: FlowInstance): Promise<string[]> {
    let answered: { domains: Array<{ domain: string; entries: Array<{ id: string }> }> } | undefined;

    const runtime = await createTestContext({
      flow: { ...worker, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: `session-${worker.id}`,
      sequencerName: worker.actions.respond!.block.name,
      declaredResources: worker.actions.respond!.block.declaredResources,
      modelResolver: (modelId: string) => ({
        modelId,
        async generate(options: {
          tools?: Array<{ name: string; execute?: (args: unknown, meta: unknown) => Promise<unknown> }>;
        }) {
          const door = (options.tools ?? []).find((tool) => tool.name === "discover");
          if (door?.execute) {
            answered = (await door.execute(
              { domain: null, detail: "thin" },
              { toolCallId: "call-1" },
            )) as typeof answered;
          }
          return { text: "done", finishReason: "stop" as const };
        },
      }),
    } as never);

    const result = await executeBlock({
      block: worker.actions.respond.block,
      input: { message: "who can do this?" },
      ctx: runtime.ctx,
    });
    expect(result.error).toBeUndefined();
    if (answered === undefined) throw new Error("the worker's generator was offered no discover tool");
    return answered.domains.map((entry) => entry.domain);
  }

  it("hands a hired worker a door narrowed by its own file, end to end", async () => {
    const [lead, scribe] = hire([
      record({ id: "engineering.lead", declared: { discover: ["workers"] } }),
      record({ id: "engineering.scribe" })
    ]).sort((a, b) => a.id.localeCompare(b.id));

    // Two workers on ONE worker flow, addressed apart. A shared flow is always right
    // for somebody, so a worker carrying its own narrowing is evidence only
    // beside a sibling that does not carry it.
    expect(lead!.id).toBe("engineering.lead");
    expect(await askThroughHiredWorker(lead!)).toEqual(["workers"]);
    expect(await askThroughHiredWorker(scribe!)).toEqual(["workers", "skills"]);
  });

  it("accepts a domain the scope does not carry — narrowing is not a refusal", () => {
    // The counterpart to the refusal above, and the reason it cannot simply
    // check membership of the registry: `resources` is a real domain this
    // scope happens not to carry, and BR-11 says the worker sees nothing for it
    // rather than failing to hire.
    const [worker] = hire([
      record({ id: "engineering.lead", declared: { discover: ["resources"] } })
    ]);
    expect((worker!.config as { discover?: string[] }).discover).toEqual(["resources"]);
  });
});

/**
 * The door cache is keyed by the SET a worker named, not by how it wrote it.
 *
 * `controlTools` is resolved once before every step of a tool loop, so the
 * cache is what keeps that from rebuilding a door per step. Keyed on the raw
 * join, two worker flows that narrow to the same domains in different orders are two
 * entries and two identical `discoveryTools` instances held for the life of the
 * capability — the cache still works, it just stops being one door per
 * narrowing.
 *
 * Graded on identity, because that is the whole claim: a behavioural check
 * cannot tell one shared door from two equal ones. The answers are compared
 * too, so a key change that quietly reordered what a worker sees goes red here
 * rather than in a reader's lap.
 */
describe("one door per narrowing, however the worker wrote it", () => {
  /** The `discover` tool this worker would be offered, un-run. */
  async function resolveDoor(
    capability: ReturnType<typeof capabilityWithTwoDomains>,
    discover?: string[]
  ): Promise<unknown> {
    const gen = generator({
      name: "answerer",
      model: "openai/gpt-5.4-mini",
      prompt: "p",
      uses: [capability]
    });
    const tools = await (
      gen.config as { tools: (i: unknown, c: unknown) => Promise<unknown[]> }
    ).tools(undefined, ctxForWorker(discover));
    const door = (tools as Array<{ name?: string }>).find((tool) => tool.name === "discover");
    if (!door) throw new Error("no discover tool");
    return door;
  }

  it("hands two workers that named the same domains in different orders the same door", async () => {
    // One capability instance: the cache is per-capability, so two of them
    // would prove nothing.
    const capability = capabilityWithTwoDomains();

    const written = await resolveDoor(capability, ["workers", "skills"]);
    const writtenOther = await resolveDoor(capability, ["skills", "workers"]);

    expect(writtenOther).toBe(written);
  });

  it("and the shared door answers each of them exactly as its own would", async () => {
    // The sort must normalize the KEY without touching the narrowing: a worker
    // that wrote its list the other way round still sees the same domains.
    const capability = capabilityWithTwoDomains();

    const forward = await askDoor(capability, ["workers", "skills"]);
    const reversed = await askDoor(capability, ["skills", "workers"]);

    expect(reversed).toEqual(forward);
    expect(forward.domains).toEqual(["workers", "skills"]);
  });

  it("still keeps a differently-narrowed worker on its own door", async () => {
    // The guard against over-normalizing: sorting the key must not collapse
    // two genuinely different sets into one shared door.
    const capability = capabilityWithTwoDomains();

    const pair = await resolveDoor(capability, ["workers", "skills"]);
    const single = await resolveDoor(capability, ["workers"]);

    expect(single).not.toBe(pair);
  });
});
