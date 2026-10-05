/**
 * The wake over a live worker list: `wakeMemberSeats` handed a getter (the
 * host's registry) reads the workers when a post is delivered, not when the
 * block is built.
 *
 * So a worker hired after boot is woken by the next post that names it, and
 * one taken out of the registry is not. Handed a plain list, the wake behaves
 * as it always has: a worker registered later is never woken, which is the
 * control for the first case. The list is read once per post, however many
 * members the post is delivered to.
 *
 * Graded on what each worker heard, on a real in-process host.
 */
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import type { BlockDefinition, FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState, inMemoryStores, runAction } from "@flow-state-dev/engine";
import type { FlowStateRuntime } from "@flow-state-dev/engine";
import { z } from "zod";
import {
  MAILBOX_KIND,
  defineMailboxFlow,
  hireWorkforce,
  mailboxNotifyInputSchema,
  routeByPurpose,
  wakeMemberSeats,
  workerConfigSchema,
  type MailboxNotifyInput
} from "../src/index";
import { hearingPerPost } from "../src/mailbox/wake-member-seats";

const USER_ID = "u_live";
const heard: string[] = [];

const listen = handler({
  name: "live-listen",
  inputSchema: mailboxNotifyInputSchema,
  outputSchema: z.object({ ok: z.boolean() }),
  execute: (post: MailboxNotifyInput, ctx) => {
    heard.push(`${ctx.flow.id}|${post.body}`);
    return { ok: true };
  }
});
const answer = handler({
  name: "live-answer",
  inputSchema: z.object({ message: z.string() }),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: () => ({ ok: true })
});
const listener = defineFlow({
  kind: "listener",
  cardinality: "collection",
  configSchema: workerConfigSchema(),
  actions: { ask: { block: answer } },
  internal: { actions: { onMailboxPost: { inputSchema: mailboxNotifyInputSchema, block: listen } } }
} as never);
const kinds = { listener } as never;

const hire = (id: string): FlowInstance => hireWorkforce([{ id, declared: { flow: "listener" }, body: "" }], { kinds })[0]!;

const disposers: Array<() => Promise<void>> = [];
afterEach(async () => {
  heard.length = 0;
  while (disposers.length > 0) await disposers.pop()!();
});

/** A host whose mailbox kind wakes with `notify`, built before the runtime and its registry exist. */
async function boot(boot: FlowInstance[], notify: (live: () => readonly FlowInstance[]) => BlockDefinition<any, any>) {
  let runtime: FlowStateRuntime | undefined;
  let reads = 0;
  const live = () => {
    reads += 1;
    return runtime?.registry.list() ?? [];
  };
  const mailbox = defineMailboxFlow({ notify: notify(live) })();
  const state = createFlowState({
    flows: { [MAILBOX_KIND]: mailbox, ...Object.fromEntries(boot.map((worker) => [worker.id, worker])) },
    stores: { default: { primary: inMemoryStores() } }
  } as never);
  disposers.push(() => state.dispose());
  runtime = await state.getRuntime();
  const rt = runtime;

  const open = async (sessionId: string, members: string[]) => {
    const now = Date.now();
    await rt.stores.session.set(
      sessionId,
      {
        id: sessionId,
        flowKind: MAILBOX_KIND,
        flowId: MAILBOX_KIND,
        userId: USER_ID,
        orgId: DEFAULT_ORG_ID,
        state: { members, instructions: "Charter.", transcript: [] },
        lineageId: `lin_${sessionId}`,
        version: 0,
        createdAt: now,
        updatedAt: now,
        journal: []
      } as never,
      "any"
    );
  };

  /** Post, and wait until the fan-out and every run it woke have settled. */
  const post = async (sessionId: string, body: string) => {
    const result = await runAction({
      orgId: DEFAULT_ORG_ID,
      flow: mailbox,
      actionName: "post",
      input: { body },
      userId: USER_ID,
      sessionId,
      stores: rt.stores,
      runtimeConfig: { ...rt.runtimeConfig }
    } as never);
    expect(result.error).toBeUndefined();
    for (let i = 0; i < 400; i += 1) {
      const requests = await rt.stores.request.list({});
      if (requests.every((r: { status: string }) => r.status !== "in_progress")) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
    return heard.filter((line) => line.endsWith(`|${body}`)).map((line) => line.split("|")[0]).sort();
  };

  return { runtime: rt, open, post, reads: () => reads };
}

describe("a wake over the host's live registry", () => {
  it("wakes a worker registered after the wake was built, on the next post that names it", async () => {
    const h = await boot([hire("eng.ivy")], (live) => wakeMemberSeats(live));
    await h.open("eng.task", ["eng.ivy", "eng.newhire"]);
    expect(await h.post("eng.task", "before the hire")).toEqual(["eng.ivy"]);

    h.runtime.registry.register(hire("eng.newhire"));
    expect(await h.post("eng.task", "after the hire")).toEqual(["eng.ivy", "eng.newhire"]);
  });

  it("does not wake a worker taken out of the registry", async () => {
    const h = await boot([hire("eng.ivy"), hire("eng.gone")], (live) => wakeMemberSeats(live));
    await h.open("eng.task", ["eng.ivy", "eng.gone"]);
    expect(await h.post("eng.task", "both here")).toEqual(["eng.gone", "eng.ivy"]);

    h.runtime.registry.unregister("eng.gone");
    expect(await h.post("eng.task", "one gone")).toEqual(["eng.ivy"]);
  });

  it("reads the registry once per post, however many members the post reaches", async () => {
    const h = await boot([hire("eng.a"), hire("eng.b"), hire("eng.c")], (live) => wakeMemberSeats(live));
    await h.open("eng.task", ["eng.a", "eng.b", "eng.c"]);
    const before = h.reads();
    expect(await h.post("eng.task", "three members")).toEqual(["eng.a", "eng.b", "eng.c"]);
    expect(h.reads() - before).toBe(1);
  });
});

describe("a wake over a plain list", () => {
  it("never wakes a worker registered after it was built, as before", async () => {
    const ivy = hire("eng.ivy");
    const h = await boot([ivy], () => wakeMemberSeats([ivy]));
    await h.open("eng.task", ["eng.ivy", "eng.newhire"]);
    h.runtime.registry.register(hire("eng.newhire"));
    expect(await h.post("eng.task", "after the hire")).toEqual(["eng.ivy"]);
  });
});

describe("a route over the host's live registry", () => {
  it("names the members it can send to from the registry as it is when asked", () => {
    const workers: FlowInstance[] = [hire("eng.ivy")];
    const route = routeByPurpose(() => workers, { model: "openai/gpt-5.4-mini" });
    expect(route.members).toEqual(["eng.ivy"]);
    workers.push(hire("eng.newhire"));
    expect(route.members).toEqual(["eng.ivy", "eng.newhire"]);
  });
});

describe("one read per post, shared", () => {
  it("gives the wake and the route over one getter the same read for a post, and a fresh one for the next", () => {
    let reads = 0;
    const live = () => {
      reads += 1;
      return [hire("eng.ivy")];
    };
    // What the wake and the route each hold: one reader per getter.
    const forWake = hearingPerPost(live);
    const forRoute = hearingPerPost(live);
    const post = (id: string) => ({ request: { identity: { id } } }) as never;

    expect(forWake(post("req_1"))).toBe(forRoute(post("req_1")));
    expect(reads).toBe(1);
    forRoute(post("req_2"));
    expect(reads).toBe(2);
  });
});
