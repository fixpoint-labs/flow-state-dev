/**
 * A seat's own `discover:` key — what crosses the scope fence, and the one
 * thing it must never be able to do.
 *
 * Graded on what the DOOR ANSWERED, not on what the registry holds or what the
 * config parsed to. A seat whose settings carry the right list and whose tool
 * returns the whole catalogue anyway is exactly the failure this key exists to
 * remove, and every shape assertion over the registry survives it. So each case
 * builds the generator through the real `uses` merge, resolves the tool the
 * model would be offered, and runs it.
 *
 * The case that matters is BR-11: a seat naming a domain its scope does not
 * carry. It is written with a sibling seat that names an in-scope domain in the
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
import { hireWorkforce } from "../src/hire";
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

/** The capability under test, carrying three of the four domains. */
function capabilityWithThreeDomains() {
  return createWorkforceCapability({
    roster: { workers: [], channels: [] },
    inventory: {},
    sources: [sourceOf("seats"), sourceOf("channels"), sourceOf("skills")]
  });
}

/** A block ctx whose flow config is what one seat's file parsed to. */
function ctxForSeat(discover?: string[]): never {
  return {
    flow: { config: discover === undefined ? {} : { discover } },
    resources: {},
    signal: new AbortController().signal,
    session: { state: {} },
    request: { state: {} },
    user: { state: {} },
    self: { state: {} }
  } as never;
}

/**
 * Resolve the tools this seat would be offered and run the door, returning the
 * domains it answered with.
 *
 * Goes through `generator({ uses })` rather than calling the capability's
 * resolver directly: the control-tool path is where a capability's tool either
 * reaches the model or silently does not, and a test that skipped it would be
 * green for a door nobody could call.
 */
async function askDoor(
  capability: ReturnType<typeof capabilityWithThreeDomains>,
  discover?: string[],
  input: { domain?: string | null; detail?: "thin" | "full" } = {}
): Promise<{ domains: string[]; problem?: string; entries: string[] }> {
  const gen = generator({
    name: "answerer",
    model: "openai/gpt-5.4-mini",
    prompt: "p",
    uses: [capability]
  });
  const ctx = ctxForSeat(discover);
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

describe("a seat narrows the discovery door with its own file", () => {
  it("BR-10 · sees every domain its scope carries when its file names none", async () => {
    const answer = await askDoor(capabilityWithThreeDomains(), undefined);
    expect(answer.domains).toEqual(["seats", "channels", "skills"]);
    expect(answer.entries).toEqual(["seats-one", "channels-one", "skills-one"]);
  });

  it("BR-9 · sees the domains it named and no others", async () => {
    const answer = await askDoor(capabilityWithThreeDomains(), ["seats", "channels"]);
    expect(answer.domains).toEqual(["seats", "channels"]);
    // Absent, not empty-with-a-reason: the withheld domain does not appear at
    // all, so there is nothing for the model to ask about again.
    expect(answer.domains).not.toContain("skills");
  });

  it("BR-11 · does not reach a domain its scope lacks by naming it", async () => {
    // `resources` is one of the four pinned names and is NOT in this scope.
    // `seats` is in the same list and IS — so a run that returned nothing at
    // all would be a different failure than the one under test.
    const answer = await askDoor(capabilityWithThreeDomains(), ["seats", "resources"]);
    expect(answer.domains).toEqual(["seats"]);
    expect(answer.entries).toEqual(["seats-one"]);
  });

  it("BR-11 · cannot reach a withheld domain by asking the tool for it directly", async () => {
    // The gate is the registry, not the tool's filter (BP-031). The `domain`
    // argument is model-supplied, so this is the call a seat would make to
    // route around its own file.
    const answer = await askDoor(capabilityWithThreeDomains(), ["seats"], { domain: "skills" });
    expect(answer.entries).toEqual([]);
    expect(answer.domains).toEqual(["skills"]);
  });

  it("sees nothing at all when its file names an empty list", async () => {
    const answer = await askDoor(capabilityWithThreeDomains(), []);
    expect(answer.domains).toEqual([]);
  });

  it("BR-4 · names the known domains rather than throwing on a domain that does not exist", async () => {
    const answer = await askDoor(capabilityWithThreeDomains(), undefined, { domain: "boards" });
    expect(answer.problem).toMatch(/Unknown domain "boards"/);
    expect(answer.problem).toMatch(/seats, channels, skills, resources/);
  });
});

describe("the `discover:` worker-file key", () => {
  const record = (over: Partial<WorkerManifest> & { id: string }): WorkerManifest => ({
    declared: {},
    body: "",
    ...over
  });

  function hire(manifests: WorkerManifest[]) {
    const kind = defineAgentWorkerFlow({ uses: [capabilityWithThreeDomains()] });
    return hireWorkforce(manifests, { kinds: { agent: kind as never } });
  }

  it("carries a seat's list onto its settings", () => {
    const [seat] = hire([
      record({ id: "engineering.lead", declared: { discover: ["seats", "channels"] } })
    ]);
    expect((seat!.config as { discover?: string[] }).discover).toEqual(["seats", "channels"]);
  });

  it("leaves the key absent when the file names none, which is today's reach", () => {
    const [seat] = hire([record({ id: "engineering.lead" })]);
    expect((seat!.config as { discover?: string[] }).discover).toBeUndefined();
  });

  it("refuses a misspelled domain at the mint, naming the four", () => {
    let message = "";
    try {
      hire([record({ id: "engineering.lead", declared: { discover: ["seets"] } })]);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // The refusal has to point at THIS key and list the real names, or an
    // author reading it learns only that something about their file is wrong.
    expect(message).toMatch(/discover/);
    expect(message).toMatch(/seats/);
    expect(message).toMatch(/channels/);
    expect(message).toMatch(/resources/);
  });

  /**
   * The two halves joined: hire a seat from a record, run its own turn, and
   * call the door the seat's generator was actually handed.
   *
   * Every case above tests one half — a door built on a bare generator, or a
   * hired seat's parsed config. Both can be green while the capability never
   * reaches the seat's answering generator at all, or reaches it built from
   * the wrong seat's config. The model resolver here is the real seam a
   * provider sits behind, so `options.tools` is the tool list this seat would
   * have been offered, with its own context already bound into `execute`.
   */
  async function askThroughHiredSeat(seat: FlowInstance): Promise<string[]> {
    let answered: { domains: Array<{ domain: string; entries: Array<{ id: string }> }> } | undefined;

    const runtime = await createTestContext({
      flow: { ...seat, cardinality: "singleton" },
      orgId: "test-org",
      org: { state: {} },
      sessionId: `session-${seat.id}`,
      sequencerName: seat.actions.run!.block.name,
      declaredResources: seat.actions.run!.block.declaredResources,
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
      block: seat.actions.run.block,
      input: { message: "who can do this?" },
      ctx: runtime.ctx,
    });
    expect(result.error).toBeUndefined();
    if (answered === undefined) throw new Error("the seat's generator was offered no discover tool");
    return answered.domains.map((entry) => entry.domain);
  }

  it("hands a hired seat a door narrowed by its own file, end to end", async () => {
    const [lead, scribe] = hire([
      record({ id: "engineering.lead", declared: { discover: ["seats"] } }),
      record({ id: "engineering.scribe" })
    ]).sort((a, b) => a.id.localeCompare(b.id));

    // Two seats of ONE kind, addressed apart. A shared kind is always right
    // for somebody, so a seat carrying its own narrowing is evidence only
    // beside a sibling that does not carry it.
    expect(lead!.id).toBe("engineering.lead");
    expect(await askThroughHiredSeat(lead!)).toEqual(["seats"]);
    expect(await askThroughHiredSeat(scribe!)).toEqual(["seats", "channels", "skills"]);
  });

  it("accepts a domain the scope does not carry — narrowing is not a refusal", () => {
    // The counterpart to the refusal above, and the reason it cannot simply
    // check membership of the registry: `resources` is a real domain this
    // scope happens not to carry, and BR-11 says the seat sees nothing for it
    // rather than failing to hire.
    const [seat] = hire([
      record({ id: "engineering.lead", declared: { discover: ["resources"] } })
    ]);
    expect((seat!.config as { discover?: string[] }).discover).toEqual(["resources"]);
  });
});

/**
 * The door cache is keyed by the SET a seat named, not by how it wrote it.
 *
 * `controlTools` is resolved once before every step of a tool loop, so the
 * cache is what keeps that from rebuilding a door per step. Keyed on the raw
 * join, two kinds that narrow to the same domains in different orders are two
 * entries and two identical `discoveryTools` instances held for the life of the
 * capability — the cache still works, it just stops being one door per
 * narrowing.
 *
 * Graded on identity, because that is the whole claim: a behavioural check
 * cannot tell one shared door from two equal ones. The answers are compared
 * too, so a key change that quietly reordered what a seat sees goes red here
 * rather than in a reader's lap.
 */
describe("one door per narrowing, however the seat wrote it", () => {
  /** The `discover` tool this seat would be offered, un-run. */
  async function resolveDoor(
    capability: ReturnType<typeof capabilityWithThreeDomains>,
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
    ).tools(undefined, ctxForSeat(discover));
    const door = (tools as Array<{ name?: string }>).find((tool) => tool.name === "discover");
    if (!door) throw new Error("no discover tool");
    return door;
  }

  it("hands two seats that named the same domains in different orders the same door", async () => {
    // One capability instance: the cache is per-capability, so two of them
    // would prove nothing.
    const capability = capabilityWithThreeDomains();

    const written = await resolveDoor(capability, ["seats", "channels"]);
    const writtenOther = await resolveDoor(capability, ["channels", "seats"]);

    expect(writtenOther).toBe(written);
  });

  it("and the shared door answers each of them exactly as its own would", async () => {
    // The sort must normalize the KEY without touching the narrowing: a seat
    // that wrote its list the other way round still sees the same domains.
    const capability = capabilityWithThreeDomains();

    const forward = await askDoor(capability, ["seats", "channels"]);
    const reversed = await askDoor(capability, ["channels", "seats"]);

    expect(reversed).toEqual(forward);
    expect(forward.domains).toEqual(["seats", "channels"]);
  });

  it("still keeps a differently-narrowed seat on its own door", async () => {
    // The guard against over-normalizing: sorting the key must not collapse
    // two genuinely different sets into one shared door.
    const capability = capabilityWithThreeDomains();

    const pair = await resolveDoor(capability, ["seats", "channels"]);
    const single = await resolveDoor(capability, ["seats"]);

    expect(single).not.toBe(pair);
  });
});
