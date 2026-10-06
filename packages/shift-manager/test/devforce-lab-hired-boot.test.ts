/**
 * What the DevForce Lab (DevTeam's tree) does at a start with hired seats in
 * its store that it can't simply bring back.
 *
 * - A stored hire whose address is now a file-declared seat's is named and
 *   skipped; the Lab still starts, and the hires after it still serve.
 * - A re-hire the process died in, after its roster write, finishes when the
 *   chief of staff runs it again after the restart: the restart registered
 *   the seat from that row, and the retry counts it as its own.
 *
 * Each opens the Lab the way DevTeam's config does, over a SQLite file this
 * test seeds first. The chief of staff's model is scripted, so no key is needed.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  FlowInstance,
  GeneratorModel,
  GeneratorModelCallOptions,
  GeneratorModelResult,
  ModelResolver,
  SuspensionRecord,
} from "@flow-state-dev/core/types";
import { continueRequest, runAction } from "@flow-state-dev/engine";
import { createSQLiteStores, sqliteStores } from "@flow-state-dev/store-sqlite";
import { HIRED_ROSTER_PREFIX, seatAddress, toHiredSeatRow } from "@flow-state-dev/workforce";
import type { AskFeature } from "../teams/devteam/ask.mts";
import { selectHarness } from "../teams/devteam/harness.mts";
import { LAB_ORG_ID, LAB_TREE, LAB_USER_ID, openLab, type Lab } from "../teams/devteam/host.mts";
import { createNotifyLog } from "../teams/devteam/notify.mts";
import { BASE_REF, createScratchRepo } from "../teams/devteam/scratch-repo.mts";

const ASK_FEATURE = JSON.parse(
  readFileSync(fileURLToPath(new URL("../teams/devteam/ask.json", import.meta.url)), "utf8"),
) as AskFeature;

const COS = "chief-of-staff";

/** Seed roster rows into a fresh SQLite file, as an earlier run left them. */
async function seededStore(rows: Record<string, Record<string, unknown>>): Promise<string> {
  const file = join(mkdtempSync(join(tmpdir(), "devforce-hired-boot-")), "lab.sqlite");
  const stores = createSQLiteStores({ filename: file });
  for (const [seatId, state] of Object.entries(rows)) {
    await stores.resourceState.set("org", LAB_ORG_ID, `${HIRED_ROSTER_PREFIX}${seatId}`, state as never, "any" as never);
  }
  stores.close();
  return file;
}

const agentRow = (seatId: string, incarnation: string, extra: Record<string, unknown> = {}) => ({
  ...(toHiredSeatRow({
    seatId,
    flow: "agent",
    settings: {},
    instructions: `You are ${seatId}.`,
    owningOrgId: LAB_ORG_ID,
    incarnation,
  }) as unknown as Record<string, unknown>),
  ...extra,
});

let opened: Lab | undefined;
afterEach(async () => {
  await opened?.dispose();
  opened = undefined;
  vi.restoreAllMocks();
});

async function open(file: string, root?: string, scriptedModel?: ModelResolver, withAsk = true): Promise<Lab> {
  const scratch = createScratchRepo("hired-boot");
  const harness = selectHarness();
  opened = await openLab({
    stores: sqliteStores({ filename: file }),
    harness: harness.slot,
    runTimeoutMs: harness.runTimeoutMs,
    workspace: { root: scratch.root, sourceRepo: scratch.sourceRepo, baseRef: BASE_REF },
    coderSeatId: "eng.coder",
    mailboxes: { addresses: {}, log: createNotifyLog() },
    inventory: true,
    ...(withAsk ? { ask: ASK_FEATURE } : {}),
    ...(root === undefined ? {} : { root }),
  });
  if (scriptedModel !== undefined) {
    const runtime = await opened.state.getRuntime();
    (runtime.runtimeConfig as { modelResolver?: ModelResolver }).modelResolver = scriptedModel;
  }
  return opened;
}

describe("a stored hire whose address a file-declared seat now has", () => {
  it("is named and skipped; the Lab starts, and the hire after it serves", async () => {
    // A tree with a team named like the organization: its worker "helper" is
    // declared at the address a hire of "helper" had.
    const root = join(mkdtempSync(join(tmpdir(), "devforce-tree-")), "workforce");
    cpSync(LAB_TREE, root, { recursive: true });
    mkdirSync(join(root, "teams", LAB_ORG_ID, "workers", "helper"), { recursive: true });
    writeFileSync(
      join(root, "teams", LAB_ORG_ID, "workers", "helper", "WORKER.md"),
      "---\ndescription: Declared where a hire used to be.\nflow: agent\n---\n\nYou are the declared helper.\n",
    );
    const declared = `${LAB_ORG_ID}.helper`;
    expect(seatAddress(LAB_ORG_ID, "helper")).toBe(declared);

    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const file = await seededStore({ helper: agentRow("helper", "inc-helper"), zeta: agentRow("zeta", "inc-zeta") });
    const lab = await open(file, root);

    const runtime = await lab.state.getRuntime();
    const seat = (id: string) => runtime.registry.get(id) as (FlowInstance & { config?: { seatId?: string } }) | undefined;
    // The declared seat holds its address, and the hire after the refused one serves.
    expect(seat(declared)?.config?.seatId).toBe(declared);
    expect(seat(seatAddress(LAB_ORG_ID, "zeta"))?.kind).toBe("agent");
    expect(errors.mock.calls.map((c) => String(c[0])).join("\n")).toMatch(/skipped a hired seat — "devforce-lab\.helper" could not be registered/);
    // The declared seat's inventory row is its own, not the refused hire's.
    const inventory = await lab.stored("org", "inventory/seats/");
    expect(inventory[`inventory/seats/${declared}`]).toMatchObject({ hired: false });
    expect(inventory[`inventory/seats/${seatAddress(LAB_ORG_ID, "zeta")}`]).toMatchObject({ hired: true, incarnation: "inc-zeta" });
  }, 120_000);
});

describe("an org worker folder named like one of the Lab's own flows", () => {
  it("refuses to open, naming the folder, rather than replacing that flow", async () => {
    // `mailbox` is the mailbox kind's flow id: an org seat's id is its bare folder name.
    const root = join(mkdtempSync(join(tmpdir(), "devforce-tree-")), "workforce");
    cpSync(LAB_TREE, root, { recursive: true });
    mkdirSync(join(root, "org", "workers", "mailbox"), { recursive: true });
    writeFileSync(
      join(root, "org", "workers", "mailbox", "WORKER.md"),
      "---\ndescription: Named like the mailbox kind.\nflow: agent\n---\n\nYou are a seat called mailbox.\n",
    );
    const file = await seededStore({});
    await expect(open(file, root)).rejects.toThrow(/seat "mailbox".*already the flow "mailbox"/);
  }, 120_000);
});

describe("a Lab opened without the EM's ask", () => {
  it("still has the chief of staff's fire and re-hire wait for a person in Inbox, rather than refuse", async () => {
    // The ask option only raises the EM's approval on open; the chief of
    // staff's own approvals need durable execution whether it is set or not.
    const token = "inc-pending";
    const file = await seededStore({
      helper: agentRow("helper", "inc-helper"),
      fixer: agentRow("fixer", token, { pendingRepair: token }),
    });
    const calls = [
      { toolCallId: "f1", toolName: "fire", args: { seatId: "helper" } },
      { toolCallId: "r1", toolName: "rehire", args: { seatId: "fixer", flow: "agent", settings: {}, instructions: "You are fixer." } },
    ];
    let n = 0;
    const model: GeneratorModel = {
      modelId: "test/step",
      async generate() {
        throw new Error("the owned tool loop calls generateStep");
      },
      async generateStep() {
        const call = calls[n++];
        return call === undefined
          ? { text: "done", finishReason: "stop" }
          : { toolCalls: [call], finishReason: "tool-calls" };
      },
    };
    const resolver = Object.assign(() => model, { resolveId: (id: string) => id }) as unknown as ModelResolver;
    const lab = await open(file, undefined, resolver, false);
    const runtime = await lab.state.getRuntime();

    for (const [i, verb] of (["fire", "rehire"] as const).entries()) {
      const started = await runAction({
        orgId: LAB_ORG_ID,
        flow: runtime.registry.get(COS) as FlowInstance,
        actionName: "run",
        input: { message: `${verb} it` },
        userId: "u_person",
        sessionId: `s-cos-${i}`,
        stores: runtime.stores,
        runtimeConfig: runtime.runtimeConfig,
      } as never);
      expect((await runtime.stores.request.get(started.requestId!))?.status).toBe("suspended");
      const pending = ((await runtime.stores.suspensions.list({ status: "pending" })) as SuspensionRecord[]).filter(
        (s) => (s.data as { verb?: string } | undefined)?.verb === verb,
      );
      expect(pending).toHaveLength(1);
    }
    // Nothing changed while they wait.
    const stored = await lab.stored("org", "");
    expect(stored[`${HIRED_ROSTER_PREFIX}helper`]).toBeDefined();
    expect(stored[`${HIRED_ROSTER_PREFIX}fixer`]).toMatchObject({ pendingRepair: token });
  }, 120_000);
});

describe("a re-hire the process died in after its roster write", () => {
  it("finishes when the chief of staff runs it again after the restart, and clears the marker", async () => {
    const token = "inc-rehire";
    // What the dead re-hire left: its new row, marked pending, no inventory row.
    const file = await seededStore({ helper: agentRow("helper", token, { pendingRepair: token }) });

    const seen: GeneratorModelCallOptions[] = [];
    const script: Array<(o: GeneratorModelCallOptions) => GeneratorModelResult> = [
      () => ({
        toolCalls: [
          { toolCallId: "r1", toolName: "rehire", args: { seatId: "helper", flow: "agent", settings: {}, instructions: "You are helper." } },
        ],
        finishReason: "tool-calls",
      }),
      () => ({ text: "done", finishReason: "stop" }),
    ];
    const model: GeneratorModel = {
      modelId: "test/step",
      async generate() {
        throw new Error("the owned tool loop calls generateStep");
      },
      async generateStep(options) {
        seen.push(options);
        const step = script[seen.length - 1];
        if (step === undefined) throw new Error(`no script entry for step ${seen.length - 1}`);
        return step(options);
      },
    };
    const resolver = Object.assign(() => model, { resolveId: (id: string) => id }) as unknown as ModelResolver;
    const lab = await open(file, undefined, resolver);
    const runtime = await lab.state.getRuntime();
    const address = seatAddress(LAB_ORG_ID, "helper");
    expect(runtime.registry.get(address)?.kind).toBe("agent");

    const user = "u_person";
    const started = await runAction({
      orgId: LAB_ORG_ID,
      flow: runtime.registry.get(COS) as FlowInstance,
      actionName: "run",
      input: { message: "finish the helper's repair" },
      userId: user,
      sessionId: "s-cos-rehire",
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never);
    const pending = ((await runtime.stores.suspensions.list({ status: "pending" })) as SuspensionRecord[]).find(
      (s) => (s.data as { verb?: string } | undefined)?.verb === "rehire",
    );
    expect(pending).toBeDefined();
    const provider = (runtime.runtimeConfig as { durabilityProvider: { suspend(r: unknown): Promise<unknown> } }).durabilityProvider;
    await provider.suspend({ ...pending!, status: "approved", resolvedAt: Date.now() });
    const { finished } = await continueRequest({
      requestId: started.requestId!,
      stores: runtime.stores,
      flowRegistry: runtime.registry,
      resumeContext: { suspensionId: pending!.suspensionId, action: "approve", resumedBy: user },
      runtimeConfig: runtime.runtimeConfig,
    } as never);
    await finished;

    const toolResults = JSON.stringify((seen.at(-1)?.messages ?? []).filter((m) => (m as { role?: string }).role === "tool"));
    expect(toolResults).not.toMatch(/failed/);
    const stored = await lab.stored("org", "");
    expect(stored[`${HIRED_ROSTER_PREFIX}helper`]).toMatchObject({ pendingRepair: null, incarnation: token });
    expect(stored[`inventory/seats/${address}`]).toMatchObject({ hired: true, incarnation: token });
  }, 120_000);
});

describe("the chief of staff's post to the team mailbox", () => {
  it("lands as a line: the mailbox's members include the chief of staff", async () => {
    const file = await seededStore({});
    let mailbox = "";
    const seen: GeneratorModelCallOptions[] = [];
    const script: Array<(o: GeneratorModelCallOptions) => GeneratorModelResult> = [
      () => ({
        toolCalls: [{ toolCallId: "p1", toolName: "post-to-mailbox", args: { mailbox, body: "The helper is hired." } }],
        finishReason: "tool-calls",
      }),
      () => ({ text: "posted", finishReason: "stop" }),
    ];
    const model: GeneratorModel = {
      modelId: "test/step",
      async generate() {
        throw new Error("the owned tool loop calls generateStep");
      },
      async generateStep(options) {
        seen.push(options);
        const step = script[seen.length - 1];
        if (step === undefined) throw new Error(`no script entry for step ${seen.length - 1}`);
        return step(options);
      },
    };
    const resolver = Object.assign(() => model, { resolveId: (id: string) => id }) as unknown as ModelResolver;
    const lab = await open(file, undefined, resolver);
    mailbox = lab.mailboxId!;
    const runtime = await lab.state.getRuntime();

    const started = await runAction({
      orgId: LAB_ORG_ID,
      flow: runtime.registry.get(COS) as FlowInstance,
      actionName: "run",
      input: { message: "tell the team the helper is hired" },
      // The Lab's person, whose mailbox session it is.
      userId: LAB_USER_ID,
      sessionId: "s-cos-post",
      stores: runtime.stores,
      runtimeConfig: runtime.runtimeConfig,
    } as never);
    expect((await runtime.stores.request.get(started.requestId!))?.status).toBe("completed");

    // The dispatch hands the post over and returns; the mailbox lands it on its own request.
    let lines = await lab.transcript!();
    for (let tries = 0; tries < 50 && !lines.some((line) => line.author === COS); tries++) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      lines = await lab.transcript!();
    }
    expect(lines.filter((line) => line.author === COS).map((line) => line.body)).toEqual(["The helper is hired."]);
  }, 120_000);
});
