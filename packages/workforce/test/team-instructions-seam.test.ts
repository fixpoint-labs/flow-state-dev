/**
 * The team layer's two ends: the three doors that refuse an AUTHORED one, and
 * the prompt seam where the layer the loader read reaches a model.
 *
 * **The doors.** `teamInstructions` is the third key the framework imposes, and
 * the sharper of the refused ones: every hireable kind DECLARES it by composing
 * the admission contract, so an authored one is not caught by the closed schema
 * the way an undeclared key is. It would be accepted, and the seat would run on
 * team instructions its team never wrote — silently, and only for that seat. So
 * it is refused at all three places a record can arrive: the team's own file, a
 * worker's file, and the hire.
 *
 * The claim worth checking is not that each door refuses. It is that all three
 * refuse **from one constant**, which is what the last spec in that block is
 * for: a door holding a literal would keep refusing a name the framework had
 * since renamed, while the real key walked through it with nothing said.
 *
 * **The seam.** Asserted off the messages a model was actually handed, through
 * the real flow — not off a helper's return value, which would be a claim about
 * a helper. What is asserted is ORDER, and only order; the spec below says why
 * that is the whole of what this can honestly claim.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createInMemoryStores } from "@flow-state-dev/engine";
import { mockGenerator, testFlow } from "@flow-state-dev/testing";
import { z } from "zod";
import { hireWorkforce } from "../src/hire";
import { readTeamsDirectory } from "../src/loader/read-teams-directory";
import { readWorkforce } from "../src/loader/read-workforce";
import { readWorkforceDirectory } from "../src/loader/read-workforce-directory";
import {
  TEAM_INSTRUCTIONS_KEY,
  TEAM_MD,
  refusedTeamDeclarationMessage,
  type WorkerManifest,
} from "../src/manifest";
import { workerConfigSchema } from "../src/worker-config";

const USER_ID = "one-human";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "team-seam-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function writeWorker(
  team: string,
  worker: string,
  frontmatter: string,
  body = "Body.",
): Promise<void> {
  const dir = path.join(root, "teams", team, "workers", worker);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, "WORKER.md"), `---\n${frontmatter}\n---\n\n${body}\n`);
}

async function writeTeamMd(team: string, contents: string): Promise<void> {
  const dir = path.join(root, "teams", team);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, TEAM_MD), contents);
}

const record = (over: Partial<WorkerManifest> = {}): WorkerManifest => ({
  id: "engineering.lead",
  declared: { description: "The lead." },
  body: "You are the lead.",
  ...over,
});

const refusalOf = (roster: WorkerManifest[]): string => {
  try {
    hireWorkforce(roster);
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};

describe("three doors, one constant", () => {
  /**
   * The `TEAM.md` arm, written against an EMPTY BODY — the red state that
   * matters here.
   *
   * With the body empty there is no layer for the frontmatter to collide with,
   * so a reader that let the key fall through as ordinary metadata would
   * produce a team with no instructions and report nothing: the author's text
   * sitting in the file, read by nothing and named by nothing. That is this
   * epic's recurring failure, in the file that looks most like the right place
   * to write it.
   */
  it("refuses the imposed key in a TEAM.md, even with nothing else to notice", async () => {
    await writeWorker("engineering", "lead", "description: The lead.");
    await writeTeamMd(
      "engineering",
      `---\ndescription: Engineering.\n${TEAM_INSTRUCTIONS_KEY}: We answer within the hour.\n---\n`,
    );

    const { teams, errors } = await readTeamsDirectory(root);

    expect(teams).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.kind).toBe("refused-declaration");
    expect(errors[0]!.error.message).toContain(TEAM_INSTRUCTIONS_KEY);
  });

  it("refuses the imposed key in a WORKER.md", async () => {
    await writeWorker(
      "engineering",
      "lead",
      `description: The lead.\n${TEAM_INSTRUCTIONS_KEY}: We answer within the hour.`,
    );

    const { workers, errors } = await readWorkforceDirectory(root);

    expect(workers).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error.message).toContain(TEAM_INSTRUCTIONS_KEY);
  });

  it("refuses the imposed key on a hand-built record, at the hire", () => {
    expect(
      refusalOf([record({ declared: { description: "The lead.", [TEAM_INSTRUCTIONS_KEY]: "Ours." } })]),
    ).toContain(TEAM_INSTRUCTIONS_KEY);
  });

  /**
   * The spec the other three rest on: **every door answers to the constant,
   * and none answers to anything else.**
   *
   * Each door above is driven with the constant's CURRENT value rather than
   * with the literal `"teamInstructions"`, so renaming the constant carries all
   * three with it and a door left holding a literal stops refusing what the
   * others refuse. The near-miss half is what makes that mean something: a door
   * that refused every key would satisfy the first half forever.
   */
  it("answers to the key the constant names, and not to a neighbouring spelling", async () => {
    const impostor = `${TEAM_INSTRUCTIONS_KEY}Extra`;

    // Driven from the constant: the reader's door and the hire's door both
    // refuse the real key...
    expect(
      refusedTeamDeclarationMessage({ description: "x", [TEAM_INSTRUCTIONS_KEY]: "ours" }),
    ).toContain(TEAM_INSTRUCTIONS_KEY);
    expect(
      refusalOf([record({ declared: { description: "d", [TEAM_INSTRUCTIONS_KEY]: "x" } })]),
    ).toContain(TEAM_INSTRUCTIONS_KEY);

    // ...and the reader's door lets a neighbouring spelling through as the
    // ordinary unclaimed frontmatter it is. Without this, a door that refused
    // everything would pass the half above.
    expect(refusedTeamDeclarationMessage({ description: "x", [impostor]: "ours" })).toBeUndefined();

    await writeWorker("engineering", "lead", "description: The lead.");
    await writeTeamMd("engineering", `---\ndescription: Eng.\n${impostor}: ours\n---\n\nStay.\n`);
    const { teams, errors } = await readTeamsDirectory(root);
    expect(errors).toEqual([]);
    expect(teams[0]!.declared[impostor]).toBe("ours");
  });
});

describe("the prompt seam", () => {
  /**
   * Run one turn against a hired seat and hand back the system message the
   * model was actually given.
   *
   * Through the real flow and the real generator, because the claim is about
   * what reaches a model. A check on a compose helper's return value would be
   * green for a seam that never wired the helper to the prompt slot at all.
   */
  async function systemPromptOf(manifest: WorkerManifest): Promise<string> {
    const [seat] = hireWorkforce([manifest]);
    const answer = mockGenerator({ name: "agent-answer", script: [{ text: "noted" }] });
    const stores = createInMemoryStores();
    const sessionId = "seam-session";
    await seedOwnedSession(stores, sessionId, seat!);

    const result = await testFlow({
      sessionId,
      flow: seat!,
      action: "run",
      userId: USER_ID,
      input: { message: "hello" },
      stores,
      // The skills collection every seat of this kind carries lives at org
      // scope, so a run without an org has nowhere to resolve it from.
      seed: { org: { state: {} } },
      generators: { "agent-answer": answer },
      unmockedGeneratorPolicy: "allow",
    } as never);

    if ((result as { error?: unknown }).error) throw (result as { error: Error }).error;

    const messages = (answer.calls[0]?.input ?? []) as Array<{ role?: string; content?: unknown }>;
    const system = messages.filter((message) => message.role === "system");
    return system.map((message) => String(message.content ?? "")).join("\n");
  }

  /**
   * BR-17 — both layers, and the team's first **every time**.
   *
   * **Read this before changing the assertion.** What is pinned is the ORDER,
   * and only the order. Assembly on this path is plain concatenation with no
   * override, precedence or conflict-resolution mechanism anywhere in it, so a
   * green run here says exactly nothing about which line a model follows when a
   * team's instruction and a seat's contradict each other — that is the model's
   * behaviour, not the framework's. Asserting on index positions rather than on
   * "the seat's text wins" is the difference between checking the property and
   * checking a neighbour of it.
   */
  it("puts the team's text before the seat's own", async () => {
    const prompt = await systemPromptOf(
      record({ body: "Sweep the named hosts.", teamInstructions: "Stay inside the scope." }),
    );

    expect(prompt).toContain("Stay inside the scope.");
    expect(prompt).toContain("Sweep the named hosts.");
    expect(prompt.indexOf("Stay inside the scope.")).toBeLessThan(
      prompt.indexOf("Sweep the named hosts."),
    );
  });

  // BR-18 — the team's text alone, with no stray separator and no blank line
  // standing in for the body the seat does not have.
  it("gives a bodyless seat its team's text alone", async () => {
    const prompt = await systemPromptOf(record({ body: "", teamInstructions: "Stay in scope." }));

    expect(prompt).toContain("Stay in scope.");
    expect(prompt.startsWith("\n")).toBe(false);
    expect(prompt).not.toContain("\n\n\n");
  });

  /**
   * BR-19 — the off-state, and the regression guard for the whole feature.
   *
   * A seat whose team wrote nothing gets **byte for byte** what it got before
   * this layer existed. Compared against a prompt captured from the same seat
   * on the same path, so the assertion is about this change rather than about
   * whatever else the kind happens to put in a system message.
   */
  it("gives a seat whose team has no file exactly the prompt it had before", async () => {
    const withoutLayer = await systemPromptOf(record({ body: "Sweep the named hosts." }));

    expect(withoutLayer).toContain("Sweep the named hosts.");
    // No leading blank: an absent layer is DROPPED, not joined as an empty
    // string. This is the assertion that fails if the seam ever returns `""`
    // for a missing layer, which the slot's filter would happily keep.
    expect(withoutLayer.startsWith("\n")).toBe(false);

    // The control: the same seat WITH a team layer differs, so the assertion
    // above is about the layer's absence and not about an observer that never
    // moves.
    const withLayer = await systemPromptOf(
      record({ body: "Sweep the named hosts.", teamInstructions: "Stay inside the scope." }),
    );
    expect(withLayer).not.toBe(withoutLayer);
    expect(withLayer.replace("Stay inside the scope.\n", "")).toBe(withoutLayer);
  });
});

describe("a kind that ignores the layer", () => {
  /**
   * BR-20 — composing the contract and reading `teamInstructions` nowhere is
   * not an error. The door is what is mandatory; reading what comes through it
   * is not.
   *
   * BR-15 rides along: a hand-built record that never met the loader carries no
   * layer and hires cleanly. *Nobody read for it* and *it has none* are the
   * same value in the bag and stay tellable apart only on the record.
   */
  it("mints a kind that reads the key nowhere, and a record that never met the loader", () => {
    const noteSchema = z.object({ note: z.string() });
    const quiet = defineFlow({
      kind: "quiet-desk",
      cardinality: "collection",
      configSchema: workerConfigSchema().extend({ desk: z.string().default("front") }),
      actions: {
        run: {
          inputSchema: noteSchema,
          block: sequencer({ name: "quiet-work", inputSchema: noteSchema }).tap(
            handler({
              name: "quiet-step",
              inputSchema: noteSchema,
              outputSchema: z.void(),
              execute: async () => undefined,
            }),
          ),
        },
      },
    });

    const seats = hireWorkforce(
      [
        record({
          id: "engineering.lead",
          declared: { description: "The lead.", flow: "quiet-desk" },
          teamInstructions: "Stay in scope.",
        }),
        record({
          id: "engineering.scribe",
          declared: { description: "The scribe.", flow: "quiet-desk" },
        }),
      ],
      { kinds: { "quiet-desk": quiet as never } },
    );

    expect(seats).toHaveLength(2);
    const config = (id: string) =>
      seats.find((seat) => seat.id === id)!.config as Record<string, unknown>;

    // The layer arrived for the record that carried it...
    expect(config("engineering.lead")[TEAM_INSTRUCTIONS_KEY]).toBe("Stay in scope.");
    // ...and is ABSENT, not empty, on the record that never met the loader.
    expect(Object.hasOwn(config("engineering.scribe"), TEAM_INSTRUCTIONS_KEY)).toBe(false);
  });
});

describe("end to end, from files", () => {
  /**
   * The whole path in one spec: two teams' files read by the real loader,
   * hired by the real factory, each seat's bag carrying its own team's text.
   *
   * One shared bag is always right for somebody, so the sibling's value is
   * asserted as well as its own.
   */
  it("carries each team's own instructions into its seats' bags, and not its sibling's", async () => {
    await writeWorker("pentest", "recon", "description: Recon.");
    await writeWorker("billing", "desk", "description: Billing desk.");
    await writeTeamMd("pentest", "---\ndescription: Red team.\n---\n\nStay in scope.\n");
    await writeTeamMd("billing", "---\ndescription: Money.\n---\n\nNever refund blind.\n");

    const { workers, teamErrors } = await readWorkforce(root);
    expect(teamErrors).toEqual([]);

    const seats = hireWorkforce(workers);
    const config = (id: string) =>
      seats.find((seat) => seat.id === id)!.config as Record<string, unknown>;

    expect(config("pentest.recon")[TEAM_INSTRUCTIONS_KEY]).toBe("Stay in scope.\n");
    expect(config("billing.desk")[TEAM_INSTRUCTIONS_KEY]).toBe("Never refund blind.\n");
    // Two values, never merged: the seat's own instructions stay its own.
    expect(config("pentest.recon")["instructions"]).toBe("Body.\n");
  });
});

/**
 * Give a seat's session a record naming its owning instance. `testFlow` seeds
 * one without a `flowId`, which a collection flow reads as a pre-ownership row
 * and refuses; seeding first wins.
 */
async function seedOwnedSession(
  stores: ReturnType<typeof createInMemoryStores>,
  sessionId: string,
  seat: FlowInstance,
): Promise<void> {
  const now = new Date().toISOString();
  await stores.session.set(
    sessionId,
    {
      id: sessionId,
      flowKind: seat.kind,
      flowId: seat.id,
      userId: USER_ID,
      orgId: "test-org",
      state: {},
      version: 0,
      createdAt: now,
      updatedAt: now,
      journal: [],
    } as never,
    "any",
  );
}
