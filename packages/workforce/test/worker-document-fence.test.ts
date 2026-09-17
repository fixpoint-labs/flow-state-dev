/**
 * The fence: a worker's document is *that worker's alone* when its own
 * frontmatter says so, and readable by every sibling seat when it does not.
 *
 * This file is the durable form of a settlement. The claim — that isolating a
 * document per seat needs no framework machinery, only a line in the author's
 * file — was argued three ways and priced wrong twice before it was measured,
 * and the run that settled it was a throwaway that no longer exists. Prose in a
 * decision record is not evidence anyone can re-run, so the measurement lives
 * here instead, as a check that goes red if the mechanism ever stops working.
 *
 * Nothing on the path is stubbed. Two real `.md` files, the real frontmatter
 * parse, the real reader, the real install, the production `hireWorkforce`, two
 * real per-seat execution contexts over ONE set of stores. Sharing the stores is
 * the whole point: two seats with their own stores would read their own rows
 * whether the fence worked or not, which is a green that proves nothing.
 *
 * **What makes this go red.** Adding `flowIsolation` to the refused-declaration
 * set (`DERIVED_RESOURCE_KEYS`) is the tidy-up that silently kills the fence:
 * that set is one shared list, so refusing the key "for the worker level"
 * refuses it at all three, and every isolated document in every tree quietly
 * becomes shared with nothing thrown. No test of the reader's own rules would
 * notice. This one would — the isolated seat starts reading its sibling's row.
 *
 * Model-free and deterministic: nothing here reaches a provider.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { defineFlow, handler } from "@flow-state-dev/core";
import { createExecutionContext, createInMemoryStores, toBareStates } from "@flow-state-dev/engine";
import { readResourcesDirectory } from "../src/loader";
import { hireWorkforce } from "../src/hire";
import { workerConfigSchema } from "../src/worker-config";
import { resourcesFromDocs } from "../src/resources-from-docs";
import { DERIVED_RESOURCE_KEYS, type WorkerManifest } from "../src/manifest";

const ORG_ID = "test-org";
const TEAM = "pentest";

/** The two seats. Both are hired into ONE kind, from one flow definition. */
const ALICE = `${TEAM}.alice`;
const BOB = `${TEAM}.bob`;

const roots: string[] = [];

afterEach(() => {
  for (const dir of roots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A real workforce tree on disk holding one worker's two documents: `diary`,
 * which asks to be isolated, and `shared`, which does not.
 *
 * `isolate` is the one variable. Passing `false` writes the same tree with the
 * frontmatter line removed — the red state, kept as a parameter so the contrast
 * is run rather than described.
 */
function treeWithDocuments(isolate: boolean): string {
  const root = mkdtempSync(join(tmpdir(), "fsd-fence-"));
  roots.push(root);

  const slot = join(root, "teams", TEAM, "workers", "recon", "resources");
  mkdirSync(slot, { recursive: true });

  writeFileSync(
    join(slot, "diary.md"),
    `---
description: The seat's own working notes.
${isolate ? "flowIsolation: true\n" : ""}---

Notes go here.
`,
  );
  writeFileSync(
    join(slot, "shared.md"),
    `---
description: Notes the whole kind works from.
---

Everyone reads this.
`,
  );

  return root;
}

const REF = {
  diary: `teams/${TEAM}/workers/recon/diary`,
  shared: `teams/${TEAM}/workers/recon/shared`,
} as const;

/** Two seats of one kind, hired the way an app hires them, over one store set. */
async function hireTwoSeatsOver(root: string) {
  const { documents, errors } = await readResourcesDirectory(root);
  expect(errors).toEqual([]);

  const resources = resourcesFromDocs(documents);

  const noop = handler({ name: "noop", execute: () => "ok" });
  const reconFlow = defineFlow({
    kind: "recon",
    cardinality: "collection",
    actions: { run: { inputSchema: z.string(), block: noop } },
    // Admission, not decoration: a hireable kind declares where a seat's
    // instructions and resolved skills arrive, or `hireWorkforce` refuses the
    // whole roster. This kind adds no settings of its own, so it composes the
    // bag bare. It changes nothing the fence measures — the documents and the
    // per-seat instance ids are minted the same either way.
    configSchema: workerConfigSchema(),
    resources,
  });

  // `flow: "recon"` is what puts both seats in the kind that declares the
  // documents. Without it they are hired into the built-in `agent` kind, which
  // carries its own resources and none of these — a seat with nothing to read,
  // which is not what this file is measuring.
  const manifests: WorkerManifest[] = [
    { id: ALICE, declared: { description: "Recon seat.", flow: "recon" }, body: "" },
    { id: BOB, declared: { description: "Recon seat.", flow: "recon" }, body: "" },
  ];

  // The production factory, not a hand-built pair of instances: what makes the
  // fence work is that `hireWorkforce` mints one flow INSTANCE ID per seat, and
  // a hand-built pair would be assuming exactly the thing under test.
  const seats = hireWorkforce(manifests, { kinds: { recon: reconFlow } });
  expect(seats.map((s) => s.id)).toEqual([ALICE, BOB]);

  // Both seats really carry the documents. Without this, a roster hired into
  // the wrong kind — which is one missing `flow:` key away — would give every
  // seat an empty registry, and "bob cannot read alice's row" would be green
  // because nobody can read anything.
  for (const seat of seats) {
    expect(Object.keys(seat.resources ?? {}).sort()).toEqual([REF.diary, REF.shared].sort());
  }

  const stores = createInMemoryStores();
  const contextFor = async (seatId: string) => {
    const seat = seats.find((s) => s.id === seatId)!;
    return createExecutionContext({
      flow: seat,
      actionName: "run",
      requestId: `req_${seatId}`,
      sessionId: `sess_${seatId}`,
      userId: "one-human",
      orgId: ORG_ID,
      stores,
      // Supplied so the context never builds the default resolver, which reads
      // `process.env` and fails fast when a shell exports `FSDEV_DEFAULT_MODEL`
      // at a flow declaring no intents — as the remote dev containers do. This
      // flow is one handler and resolves no model, so the stub is never called;
      // passing it keeps the fence's evidence independent of the shell it runs
      // in, without scrubbing globals other suites in this package share.
      modelResolver: () => {
        throw new Error("the fence's evidence reaches no model");
      },
    });
  };

  return { documents, resources, seats, stores, contextFor };
}

describe("a worker document's fence", () => {
  // The flag survives the file as a real boolean, at both ends of the install.
  // Asserted separately from the behaviour because these are the two places a
  // refusal would eat it: the reader's declared bag, and the built resource.
  it("carries `flowIsolation` off real YAML through to the installed resource", async () => {
    const { documents, resources } = await hireTwoSeatsOver(treeWithDocuments(true));

    const diary = documents.find((d) => d.ref === REF.diary)!;
    expect(diary.declared["flowIsolation"]).toBe(true);
    expect((resources[REF.diary] as { flowIsolation?: boolean }).flowIsolation).toBe(true);

    const shared = documents.find((d) => d.ref === REF.shared)!;
    expect(shared.declared["flowIsolation"]).toBeUndefined();
    expect((resources[REF.shared] as { flowIsolation?: boolean }).flowIsolation).toBeUndefined();
  });

  // The behaviour itself, in one run over one set of stores.
  it("gives each seat its own rows for an isolated document and one shared row for the other", async () => {
    const { contextFor } = await hireTwoSeatsOver(treeWithDocuments(true));

    const alice = await contextFor(ALICE);
    await alice.resources[REF.diary]!.patchState({ text: "alice-secret" });
    await alice.resources[REF.shared]!.patchState({ text: "alice-secret" });

    const bob = await contextFor(BOB);

    // The fence. Bob asks for the same document and gets his OWN empty copy —
    // not an error, and not Alice's row. Isolation is not a refusal.
    expect((bob.resources[REF.diary]!.state as { text?: string }).text ?? "").toBe("");

    // And the document that did not ask for a fence is genuinely shared: the
    // control that stops this file passing because the seats never shared a
    // store at all.
    expect((bob.resources[REF.shared]!.state as { text?: string }).text).toBe("alice-secret");
  });

  // Where the rows actually land, which is what "per seat" means underneath:
  // the isolated one is namespaced by the seat's flow instance id, the shared
  // one sits at the bare org identity.
  it("keys the isolated document by the seat's own instance id and the shared one at the bare org", async () => {
    const { contextFor, stores } = await hireTwoSeatsOver(treeWithDocuments(true));

    const alice = await contextFor(ALICE);
    await alice.resources[REF.diary]!.patchState({ text: "alice-secret" });
    await alice.resources[REF.shared]!.patchState({ text: "alice-secret" });

    const bare = toBareStates(await stores.resourceState.getAll("org", ORG_ID));
    expect(bare).toHaveProperty(REF.shared);
    expect(bare).not.toHaveProperty(REF.diary);

    const aliceOwn = toBareStates(await stores.resourceState.getAll("org", `${ORG_ID}:${ALICE}`));
    expect(aliceOwn).toHaveProperty(REF.diary);
    expect(aliceOwn).not.toHaveProperty(REF.shared);
  });

  /**
   * The red state, run rather than described.
   *
   * Same tree, same pipeline, one line deleted from the author's file. If this
   * passed, the two specs above would be green for some reason other than the
   * one they claim — the seats not really sharing a store, `patchState` not
   * really persisting — and the whole file would be worthless. Bob reading
   * Alice's diary here is what makes Bob NOT reading it above mean something.
   */
  it("shares the very same document across both seats once the frontmatter line is gone", async () => {
    const { documents, resources, contextFor } = await hireTwoSeatsOver(treeWithDocuments(false));

    expect(documents.find((d) => d.ref === REF.diary)!.declared["flowIsolation"]).toBeUndefined();
    expect((resources[REF.diary] as { flowIsolation?: boolean }).flowIsolation).toBeUndefined();

    const alice = await contextFor(ALICE);
    await alice.resources[REF.diary]!.patchState({ text: "alice-secret" });

    const bob = await contextFor(BOB);
    expect((bob.resources[REF.diary]!.state as { text?: string }).text).toBe("alice-secret");
  });

  /**
   * The guardrail the specs above cannot state for themselves.
   *
   * `flowIsolation` is not a setting the convention derives from where a file
   * sits — it is the author's own choice — so it must stay out of the refused
   * set. This spec is a tripwire on the exact edit that would kill the fence
   * silently, placed where someone adding a key to that list will meet it.
   */
  it("keeps `flowIsolation` out of the settings the convention refuses", () => {
    expect([...DERIVED_RESOURCE_KEYS]).not.toContain("flowIsolation");
  });
});
