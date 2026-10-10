/**
 * A coordinator conversation's delegates: what a configuration may say, how
 * the list starts, and the one check every add passes, through the app's
 * actions and the coordinator's own tools alike.
 *
 * Checks, by the spec's ids (`specs/issues/FIX-1791/BUSINESS-RULES.md`, V1 and V2):
 *   V1     no `routing:` means judgment, no `rounds:` means zero;
 *   BR-11  a standard coordinator's defaults naming a worker that isn't standard is refused at load;
 *   BR-26  `rounds:` above 3 is refused when saved, and at load for a file; 1 to 3 are taken,
 *          under each of the four policies;
 *   BR-1   the first read copies the defaults into the conversation; the configuration is not written;
 *   BR-1a  a delegate action on a session no create linked to a worker is refused, naming why;
 *   BR-2   an add lands in this conversation only; a `target` sent to `addDelegate` is refused, naming it;
 *   BR-3   Bob's worker and a name nobody holds get one answer; nothing is written;
 *   BR-4   a worker whose flow takes neither a post nor a task is refused, naming the flow;
 *   BR-5   a record already on the list, or a 26th, is refused; records go by worker and target;
 *   BR-6   removal checks the list, not the roster: a fired delegate can be removed; removing the fallback clears it;
 *   BR-6a  the fallback is set to a listed record or cleared; an unlisted one is refused;
 *   BR-7   two changes arriving together both land;
 *   BR-8   a create carrying delegates is refused with 400 naming the field;
 *   BR-10  the delegate read returns the whole list with each note, and what each delegate does and takes;
 *   BR-32  the coordinator's tool refuses Bob's worker as the action does.
 */
import { describe, expect, it } from "vitest";
import { mockGenerator } from "@flow-state-dev/testing";
import { coordinatorConfigSchema } from "../src/coordinator/coordinator-config";
import { applyDelegateChange } from "../src/coordinator/coordinator-delegates";
import { createWorkerInstallation } from "../src/workers/installation";
import { bootHost, messageOf, standardWorkers } from "./coordinator-harness";

const workersOf = (output: { delegates: Array<{ worker: string }> }) => output.delegates.map((d) => d.worker);

describe("a coordinator's configuration (V1)", () => {
  it("routes by judgment with no rounds when its file says neither", () => {
    const parsed = coordinatorConfigSchema().parse({ delegates: ["eng.em"] });
    expect(parsed.routing).toBe("judgment");
    expect(parsed.rounds).toBe(0);
    expect(bootHost().installation.standardWorkerProblems()).toEqual([]);
  });

  it("refuses, at load, a standard coordinator whose defaults name a worker that isn't standard (BR-11)", () => {
    expect(() =>
      createWorkerInstallation({
        standardWorkers: standardWorkers({ chief: { delegates: ["eng.em", "my-own-helper"] } })
      })
    ).toThrow(/standard worker "chief" names "my-own-helper" in `delegates:`, which isn't a standard worker/);
  });

  it("refuses rounds above three when a file is loaded, and when a row is saved (BR-26)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { rounds: 4 } }) });
    expect(host.installation.standardWorkerProblems().join("\n")).toMatch(/worker "desk" — .*rounds can be at most 3/);

    const saved = await host.hire("alice", { id: "triage", flow: "coordinator", settings: { rounds: 5 } });
    expect(messageOf(saved.error)).toMatch(/rounds can be at most 3/);
    const fine = await host.hire("alice", { id: "triage", flow: "coordinator", settings: { rounds: 0 } });
    expect(fine.error, messageOf(fine.error)).toBeUndefined();
  });

  it("takes rounds up to three and each of the four policies, at load and on save (BR-26, D1)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { rounds: 3, routing: "everyone" } }) });
    expect(host.installation.standardWorkerProblems()).toEqual([]);
    for (const [rounds, routing] of [
      [1, "round-robin"],
      [2, "everyone"],
      [3, "best-fit"],
      [3, "judgment"]
    ] as const) {
      const saved = await host.hire("alice", {
        id: `triage-${routing}-${rounds}`,
        flow: "coordinator",
        settings: { rounds, routing }
      });
      expect(saved.error, messageOf(saved.error)).toBeUndefined();
    }
    const unknown = await host.hire("alice", { id: "triage-random", flow: "coordinator", settings: { routing: "random" } });
    expect(messageOf(unknown.error)).toMatch(/routing/);
  });

  it("refuses a minConfidence outside 0 to 1, or not a number, naming the key, at load and on save (FIX-1833 BR-15)", async () => {
    for (const bad of [-0.1, 1.5, "high"]) {
      const host = bootHost({ standard: standardWorkers({ desk: { minConfidence: bad } }) });
      expect(host.installation.standardWorkerProblems().join("\n")).toMatch(/worker "desk" — .*minConfidence must be a number from 0 to 1/);
    }
    const host = bootHost();
    const saved = await host.hire("alice", { id: "triage", flow: "coordinator", settings: { routing: "best-fit", minConfidence: 2 } });
    expect(messageOf(saved.error)).toMatch(/minConfidence must be a number from 0 to 1/);
  });

  it("refuses a minConfidence on a coordinator that doesn't route by best fit, naming both (FIX-1833 BR-16)", async () => {
    const host = bootHost({ standard: standardWorkers({ chief: { minConfidence: 0.7 } }) });
    expect(host.installation.standardWorkerProblems().join("\n")).toMatch(/`minConfidence:`.*`routing: best-fit`/);
    const saved = await host.hire("alice", { id: "triage", flow: "coordinator", settings: { routing: "everyone", minConfidence: 0.5 } });
    expect(messageOf(saved.error)).toMatch(/`minConfidence:`.*`routing: best-fit`/);
  });

  it("takes a best-fit file with a minConfidence from 0 to 1, and one without it (FIX-1833 V2)", async () => {
    for (const minConfidence of [0, 0.7, 1, undefined]) {
      const host = bootHost({ standard: standardWorkers({ desk: minConfidence === undefined ? {} : { minConfidence } }) });
      expect(host.installation.standardWorkerProblems()).toEqual([]);
    }
    expect(coordinatorConfigSchema().parse({ routing: "best-fit" }).minConfidence).toBeUndefined();
  });

  it("refuses a fallback that isn't one of its defaults", () => {
    const host = bootHost({ standard: standardWorkers({ desk: { fallback: "eng.nobody" } }) });
    expect(host.installation.standardWorkerProblems().join("\n")).toMatch(
      /names "eng.nobody" as `fallback:`, which isn't one of its `delegates:`/
    );
  });
});

describe("a conversation's delegates (V2)", () => {
  it("copies the defaults on first read, into that conversation only (BR-1, BR-2)", async () => {
    const host = bootHost();
    const first = await host.conversation("alice", "desk");
    const second = await host.conversation("alice", "desk");
    expect((await host.sessionState(first)).delegates).toBeNull();

    const read = await host.act("alice", first, "listDelegates", {});
    expect(workersOf(read.output)).toEqual(["eng.em", "eng.coder", "support.general"]);
    expect(read.output.fallback).toEqual({ worker: "support.general" });
    expect((await host.sessionState(first)).delegates.map((d: any) => d.worker)).toEqual([
      "eng.em",
      "eng.coder",
      "support.general"
    ]);

    const removed = await host.act("alice", first, "removeDelegate", { worker: "eng.coder" });
    expect(workersOf(removed.output)).toEqual(["eng.em", "support.general"]);
    // The change stays in the conversation it was made in...
    expect(workersOf((await host.act("alice", first, "listDelegates", {})).output)).toEqual(["eng.em", "support.general"]);
    // ...and nowhere else.
    const other = await host.act("alice", second, "listDelegates", {});
    expect(workersOf(other.output)).toEqual(["eng.em", "eng.coder", "support.general"]);
    // The configuration is not written: a third conversation starts from the file.
    const third = await host.conversation("alice", "desk");
    expect(workersOf((await host.act("alice", third, "listDelegates", {})).output)).toContain("eng.coder");
  });

  it("starts empty when the defaults are empty", async () => {
    const host = bootHost({ standard: standardWorkers({ chief: { delegates: [] } }) });
    const id = await host.conversation("alice", "chief");
    expect((await host.act("alice", id, "listDelegates", {})).output.delegates).toEqual([]);
  });

  it("adds a worker of the user's own and a standard one, each with an optional note (BR-2, BR-10)", async () => {
    const host = bootHost();
    expect((await host.hire("alice", { id: "licenses", flow: "helper", description: "Audits licenses." })).error).toBeUndefined();
    const id = await host.conversation("alice", "chief");
    const own = await host.act("alice", id, "addDelegate", { worker: "licenses", note: "license questions" });
    expect(own.error, messageOf(own.error)).toBeUndefined();
    const standard = await host.act("alice", id, "addDelegate", { worker: "eng.coder" });
    expect(standard.error, messageOf(standard.error)).toBeUndefined();
    const listed = await host.act("alice", id, "listDelegates", {});
    expect(listed.output.delegates).toEqual([
      { worker: "eng.em", description: "Plans and staffs engineering work.", takes: "posts" },
      { worker: "licenses", note: "license questions", description: "Audits licenses.", takes: "posts" },
      { worker: "eng.coder", description: "Writes code.", takes: "posts" }
    ]);
    expect(listed.output.max).toBe(25);
  });

  it("says what each delegate does and takes, and a hand-off reaches exactly the ones it says take posts", async () => {
    // The coordinator's turn picks whom to hand a post to from this read: what
    // each delegate does (its worker's description) and what it takes. So a
    // delegate it says takes posts must be one `handOff` delivers to, and a
    // delegate it says takes only tasks, or nothing, must be one it refuses.
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: ["eng.em", "eng.builder", "eng.lead", "temp"].map((worker, n) => ({
            toolCallId: `h${n}`,
            toolName: "handOff",
            args: { worker }
          }))
        },
        { text: "Handed on." }
      ]
    });
    const host = bootHost({ judgment });
    expect((await host.hire("alice", { id: "temp", flow: "helper", description: "Covers for now." })).error).toBeUndefined();
    const id = await host.conversation("alice", "chief");
    for (const worker of ["eng.builder", "eng.lead", "temp"]) {
      const added = await host.act("alice", id, "addDelegate", { worker });
      expect(added.error, messageOf(added.error)).toBeUndefined();
    }
    expect((await host.fire("alice", "temp")).error).toBeUndefined();

    const listed = await host.act("alice", id, "listDelegates", {});
    expect(listed.output.delegates).toEqual([
      { worker: "eng.em", description: "Plans and staffs engineering work.", takes: "posts" },
      { worker: "eng.builder", description: "Builds what a task names.", takes: "tasks" },
      { worker: "eng.lead", description: "Leads engineering work.", takes: "both" },
      // Fired: no roster row to read a description from.
      { worker: "temp", description: null, takes: "nothing" }
    ]);

    const turn = await host.act("alice", id, "run", { message: "hand this to each of them" });
    expect(turn.error, messageOf(turn.error)).toBeUndefined();
    await host.settled();
    const [record] = (await host.items(id)).records;
    const delivered = record.delegates.filter((d: any) => d.outcome === "delivered").map((d: any) => d.worker);
    const takesPosts = (listed.output.delegates as Array<{ worker: string; takes: string }>)
      .filter((d) => d.takes === "posts" || d.takes === "both")
      .map((d) => d.worker);
    expect(delivered).toEqual(takesPosts);
  });

  it("refuses a target sent to addDelegate, naming the field (BR-2)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "chief");
    const sent = await host.act("alice", id, "addDelegate", { worker: "eng.coder", target: "workstream-1" });
    expect(messageOf(sent.error)).toMatch(/target/);
    expect((await host.sessionState(id)).delegates).toBeNull();
  });

  it("gives Bob's worker and a name nobody holds one answer, and writes nothing (BR-3)", async () => {
    const host = bootHost();
    expect((await host.hire("bob", { id: "bobs-helper", flow: "helper", description: "Bob's." })).error).toBeUndefined();
    const id = await host.conversation("alice", "chief");
    const bobs = await host.act("alice", id, "addDelegate", { worker: "bobs-helper" });
    const missing = await host.act("alice", id, "addDelegate", { worker: "nobody-at-all" });
    expect(messageOf(bobs.error)).toBe('No worker "bobs-helper" on your roster.');
    expect(messageOf(missing.error)).toBe('No worker "nobody-at-all" on your roster.');
    expect((await host.sessionState(id)).delegates).toBeNull();
  });

  it("refuses a worker whose flow takes neither a post nor a task, naming the flow (BR-4)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "chief");
    const refused = await host.act("alice", id, "addDelegate", { worker: "notes" });
    expect(messageOf(refused.error)).toBe('Worker "notes" runs on flow "quiet", which takes neither a delegated post nor a task.');
    expect((await host.sessionState(id)).delegates).toBeNull();
  });

  it("refuses a record already on the list, and a 26th (BR-5)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "chief");
    const twice = await host.act("alice", id, "addDelegate", { worker: "eng.em" });
    expect(messageOf(twice.error)).toBe('"eng.em" is already a delegate in this conversation.');

    for (let n = 1; n < 25; n += 1) {
      const hired = await host.hire("alice", { id: `h${n}`, flow: "helper" });
      expect(hired.error, messageOf(hired.error)).toBeUndefined();
      const added = await host.act("alice", id, "addDelegate", { worker: `h${n}` });
      expect(added.error, messageOf(added.error)).toBeUndefined();
    }
    expect((await host.hire("alice", { id: "h25", flow: "helper" })).error).toBeUndefined();
    const over = await host.act("alice", id, "addDelegate", { worker: "h25" });
    expect(messageOf(over.error)).toMatch(/already has 25 delegates, the most it can hold/);
    expect((await host.sessionState(id)).delegates).toHaveLength(25);
  });

  it("tells records apart by worker and target, for the internal mutation (BR-5, BR-6)", () => {
    const empty = { delegates: [], fallback: null };
    const one = applyDelegateChange(empty, { add: { worker: "lead", target: "ws-a" } });
    expect(one.ok).toBe(true);
    const two = applyDelegateChange((one as any).list, { add: { worker: "lead", target: "ws-b" } });
    expect(two.ok).toBe(true);
    const again = applyDelegateChange((two as any).list, { add: { worker: "lead", target: "ws-a" } });
    expect(again).toEqual({ ok: false, message: '"lead (ws-a)" is already a delegate in this conversation.' });
    const removed = applyDelegateChange((two as any).list, { remove: { worker: "lead", target: "ws-a" } });
    expect((removed as any).list.delegates).toEqual([{ worker: "lead", target: "ws-b" }]);
  });

  it("removes a delegate fired since it was added, and clears the fallback it was (BR-6)", async () => {
    const host = bootHost({ standard: standardWorkers({ desk: { fallback: "support.general" } }) });
    expect((await host.hire("alice", { id: "temp", flow: "helper", description: "Temporary." })).error).toBeUndefined();
    const id = await host.conversation("alice", "desk");
    expect((await host.act("alice", id, "addDelegate", { worker: "temp" })).error).toBeUndefined();
    expect((await host.fire("alice", "temp")).error).toBeUndefined();
    const removed = await host.act("alice", id, "removeDelegate", { worker: "temp" });
    expect(removed.error, messageOf(removed.error)).toBeUndefined();
    expect(workersOf(removed.output)).not.toContain("temp");

    const noFallback = await host.act("alice", id, "removeDelegate", { worker: "support.general" });
    expect(noFallback.output.fallback).toBeNull();
    const notListed = await host.act("alice", id, "removeDelegate", { worker: "support.general" });
    expect(messageOf(notListed.error)).toBe('"support.general" isn\'t a delegate in this conversation.');
  });

  it("sets the fallback to a listed delegate, clears it, and refuses an unlisted one (BR-6a)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "desk");
    const set = await host.act("alice", id, "setFallback", { worker: "eng.em" });
    expect(set.output.fallback).toEqual({ worker: "eng.em" });
    const cleared = await host.act("alice", id, "setFallback", { worker: null });
    expect(cleared.output.fallback).toBeNull();
    const refused = await host.act("alice", id, "setFallback", { worker: "notes" });
    expect(messageOf(refused.error)).toBe('"notes" isn\'t a delegate in this conversation, so it can\'t be the fallback.');
    expect((await host.sessionState(id)).fallback).toBeNull();
  });

  it("lands two changes that arrive together (BR-7)", async () => {
    const host = bootHost();
    const id = await host.conversation("alice", "chief");
    const [a, b] = await Promise.all([
      host.act("alice", id, "addDelegate", { worker: "eng.coder" }),
      host.act("alice", id, "addDelegate", { worker: "support.general" })
    ]);
    // The stronger promise: both land, not one refused as stale.
    expect(a.error, messageOf(a.error)).toBeUndefined();
    expect(b.error, messageOf(b.error)).toBeUndefined();
    const delegates = (await host.sessionState(id)).delegates.map((d: any) => d.worker);
    expect([...delegates].sort()).toEqual(["eng.coder", "eng.em", "support.general"]);
  });

  it("refuses a create that carries delegates, with 400 naming the field (BR-8)", async () => {
    const host = bootHost();
    const created = await host.create("alice", "coordinator", {
      state: { workerId: "chief", delegates: [{ worker: "bobs-helper" }] }
    });
    expect(created.status).toBe(400);
    expect(created.body.error).toMatch(/"delegates"/);
    const fallback = await host.create("alice", "coordinator", { state: { workerId: "chief", fallback: { worker: "x" } } });
    expect(fallback.status).toBe(400);
  });

  it("refuses a delegate action on a session no create linked to a worker (BR-1a)", async () => {
    const host = bootHost();
    const runtime = await host.state.getRuntime();
    const now = Date.now();
    await runtime.stores.session.set(
      "unlinked",
      {
        id: "unlinked",
        flowKind: "coordinator",
        flowId: "coordinator",
        userId: "alice",
        orgId: "acme",
        state: {},
        lineageId: "lin_unlinked",
        version: 0,
        createdAt: now,
        updatedAt: now,
        journal: []
      } as never,
      "any"
    );
    // Refused by the turn's worker load, before the action runs.
    const refused = await host.act("alice", "unlinked", "addDelegate", { worker: "eng.coder" }).catch((error: unknown) => ({
      error
    }));
    expect(messageOf(refused.error)).toMatch(/names no worker/);
    expect((await host.sessionState("unlinked")).delegates ?? null).toBeNull();
  });
});

describe("the coordinator's own delegate tools (V2, BR-32)", () => {
  it("adds and lists through the tools, and refuses Bob's worker exactly as the action does", async () => {
    const judgment = mockGenerator({
      script: [
        {
          toolCalls: [
            { toolCallId: "t1", toolName: "addDelegate", args: { worker: "bobs-helper" } },
            { toolCallId: "t2", toolName: "addDelegate", args: { worker: "eng.coder", note: "the build" } },
            { toolCallId: "t3", toolName: "listDelegates", args: {} }
          ]
        },
        { text: "Done." }
      ]
    });
    const host = bootHost({ judgment });
    expect((await host.hire("bob", { id: "bobs-helper", flow: "helper" })).error).toBeUndefined();
    const id = await host.conversation("alice", "chief");
    const turn = await host.act("alice", id, "run", { message: "bring in a coder" });
    expect(turn.error, messageOf(turn.error)).toBeUndefined();

    const results = await toolResults(host, id);
    expect(results.addDelegate[0]).toEqual({ refused: 'No worker "bobs-helper" on your roster.' });
    expect(results.listDelegates[0].delegates).toEqual([
      { worker: "eng.em", description: "Plans and staffs engineering work.", takes: "posts" },
      { worker: "eng.coder", note: "the build", description: "Writes code.", takes: "posts" }
    ]);
    expect((await host.sessionState(id)).delegates.map((d: any) => d.worker)).toEqual(["eng.em", "eng.coder"]);
  });
});

/** Each tool's results in a conversation, by tool name, oldest first. */
async function toolResults(host: ReturnType<typeof bootHost>, sessionId: string) {
  const { all } = await host.items(sessionId);
  const byTool: Record<string, any[]> = {};
  for (const item of all) {
    if (item.type !== "tool_output") continue;
    (byTool[String(item.blockName)] ??= []).push(item.output);
  }
  return byTool;
}
