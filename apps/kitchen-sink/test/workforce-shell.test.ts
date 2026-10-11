/**
 * The names the shell writes down, held to the tree they describe.
 *
 * The rail's flow lists and the coordinators it lists are literals in
 * `lib/workforce-shell.ts`, because a browser cannot read `workforce/`. That
 * makes them a second copy, and a copy drifts: add a worker flow or a
 * coordinator's `WORKER.md`, and the rail silently shows the old one. These
 * cases fail on that drift.
 *
 * Red states produced before these were trusted:
 *   - add a worker flow to the tree and not to `WORKER_FLOWS` or `COORDINATOR_FLOWS`:
 *     the worker-flow case fails.
 *   - drop `agent`'s entry from `WORKER_ASKS`: the answering-action case fails,
 *     naming the worker flow with no entry.
 *   - misname `agent`'s field `message`: the answering-action case fails,
 *     naming the field the worker flow actually takes.
 *   - drop `support.help` from `SHELL_COORDINATORS`: the coordinator case
 *     fails.
 */
import { describe, expect, it } from "vitest";
import { z, type ZodTypeAny } from "zod";
import { COORDINATOR_FLOW } from "@flow-state-dev/workforce";
import { readWorkforce } from "@flow-state-dev/workforce/loader";

import { buildKitchenSinkWorkforce, workforceRoot } from "../workforce/hire";
import {
  COORDINATOR_ASK,
  COORDINATOR_FLOWS,
  defaultConversation,
  delegateOfRun,
  WORKER_ASKS,
  WORKER_FLOWS,
  SHELL_COORDINATORS,
  workerAskFor,
} from "../lib/workforce-shell";

describe("the shell's names match the workforce tree", () => {
  it("lists every worker flow the app runs workers on, the coordinator's apart", async () => {
    const { installation } = await buildKitchenSinkWorkforce();
    expect([...WORKER_FLOWS, ...COORDINATOR_FLOWS].sort()).toEqual(Object.keys(installation.workerFlows()).sort());
    expect([...COORDINATOR_FLOWS]).toEqual([COORDINATOR_FLOW]);
  });

  it("lists every coordinator the tree declares, by its worker id", async () => {
    const { workers, errors } = await readWorkforce(workforceRoot);
    expect(errors).toEqual([]);
    const declared = workers.filter((worker) => worker.declared.flow === COORDINATOR_FLOW).map((worker) => worker.id);
    // Not vacuous: the tree does declare a coordinator.
    expect(declared.length).toBeGreaterThan(0);
    expect([...SHELL_COORDINATORS].sort()).toEqual(declared.sort());
  });
});

/**
 * The actions of a flow a person could answer through: the public ones whose
 * input is exactly one required string field. Keyed by action, valued by that
 * field's name.
 */
async function oneStringActions(flow: string): Promise<Record<string, string>> {
  const { installation } = await buildKitchenSinkWorkforce();
  const factory = installation.workerFlows()[flow]!.flow as unknown as {
    actions: Record<string, { inputSchema?: ZodTypeAny; block: { inputSchema?: ZodTypeAny } }>;
  };
  const found: Record<string, string> = {};
  for (const [name, action] of Object.entries(factory.actions)) {
    const schema = action.inputSchema ?? action.block.inputSchema;
    if (!(schema instanceof z.ZodObject)) continue;
    const fields = Object.entries(schema.shape as Record<string, ZodTypeAny>);
    if (fields.length === 1 && fields[0]![1] instanceof z.ZodString) found[name] = fields[0]![0];
  }
  return found;
}

describe("each worker flow's composer sends to an action the flow declares", () => {
  it("names every worker flow, and no other", () => {
    expect(Object.keys(WORKER_ASKS).sort()).toEqual([...WORKER_FLOWS].sort());
  });

  it.each([...WORKER_FLOWS])("%s: the named action takes exactly the named one string field, or it has none", async (flow) => {
    const ask = workerAskFor(flow);
    if (ask === undefined) throw new Error(`WORKER_ASKS has no entry for "${flow}"`);
    const actions = await oneStringActions(flow);
    if ("none" in ask) {
      // "None" is only honest where there is truly nothing to answer through.
      expect(actions, `"${flow}" is written down as taking no messages`).toEqual({});
      expect(ask.none.length).toBeGreaterThan(0);
    } else {
      expect(actions[ask.action], `"${flow}"'s one-string actions: ${JSON.stringify(actions)}`).toBe(ask.field);
    }
  });
});

describe("a coordinator's composer sends to the coordinator flow's door", () => {
  it("names the action that takes exactly the post, one string field", async () => {
    const actions = await oneStringActions(COORDINATOR_FLOW);
    expect(actions[COORDINATOR_ASK.action], `the coordinator's one-string actions: ${JSON.stringify(actions)}`).toBe(COORDINATOR_ASK.field);
  });
});

describe("the conversation the page opens on", () => {
  // A store kept across the upgrade still holds the session an earlier page's
  // "Hire another" ran on, tagged `worker-hires`. Opening it by default would
  // put the person's turns in that administrative session.
  it("is the most recent, passing over the session an earlier page's hire ran on", () => {
    const hires = { id: "sess-hires", tags: ["worker-hires"] };
    const chat = { id: "sess-chat", tags: [] };
    expect(defaultConversation([hires, chat])?.id).toBe("sess-chat");
    expect(defaultConversation([chat, hires])?.id).toBe("sess-chat");
  });

  it("is none when the hire session is all there is, so the page starts one", () => {
    expect(defaultConversation([{ id: "sess-hires", tags: ["worker-hires"] }])).toBeUndefined();
    expect(defaultConversation([])).toBeUndefined();
  });
});

describe("a coordinator's working row names the delegate it handed the post to", () => {
  // Every worker runs on the one `agent` copy, so a run's flow id is `agent`
  // for all of them; only the delivery's key says which worker it is. The key
  // a real delivery carries is held in `test/mailbox-wake.test.ts`.
  it("reads the worker off the delivery's key, and nothing off any other run", () => {
    expect(delegateOfRun({ topic: `delegate:${JSON.stringify(["support.devices", null])}` })).toBe("support.devices");
    expect(delegateOfRun({ topic: "delegate:not json" })).toBeUndefined();
    expect(delegateOfRun({ topic: "brief:billing" })).toBeUndefined();
    expect(delegateOfRun({})).toBeUndefined();
  });
});
