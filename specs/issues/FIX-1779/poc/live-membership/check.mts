/**
 * FIX-1779 · live membership — can a mailbox wake a worker it gained after boot?
 *
 * Throwaway experiment retained as design evidence. Not production code, not a
 * workspace package, not in any default test, lint or knip discovery. Run it by
 * hand; see README.md.
 *
 * The load-bearing claims:
 *   1. A wake that reads the host's LIVE worker registry on each post reaches a
 *      worker registered after the wake was built (a fresh hire), through the
 *      router's existing `validateRoute` hook. No core or engine change.
 *   2. Delivery reads members from the mailbox session on every post, so a
 *      member written into the session after open is woken on the next post.
 *
 * Each claim has a control that is run. A green check nobody has seen fail is
 * not evidence (tenet 7).
 */
import { DEFAULT_ORG_ID, defineFlow, dispatcher, handler, router } from "../../../../../packages/core/src/index";
import type { BlockContext, BlockDefinition, FlowInstance } from "../../../../../packages/core/src/types";
import { createFlowState, inMemoryStores, runAction } from "../../../../../packages/engine/src/index";
import type { FlowStateRuntime, StoreRegistry } from "../../../../../packages/engine/src/index";
import { z } from "zod";
import {
  MAILBOX_KIND,
  defineMailboxFlow,
  hireWorkforce,
  mailboxNotifyInputSchema,
  wakeMemberSeats,
  workerConfigSchema,
  type MailboxNotifyInput
} from "../../../../../packages/workforce/src/index";
import { hearingSeatsById, reachableSeat } from "../../../../../packages/workforce/src/mailbox/wake-member-seats";

let failures = 0;
const expect = (name: string, cond: boolean, detail: string) => {
  if (cond) console.log(`  PASS  ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL  ${name}\n        ${detail}`);
  }
};

const USER_ID = "u_poc";
const heard: string[] = [];

const listen = handler({
  name: "poc-listen",
  inputSchema: mailboxNotifyInputSchema,
  outputSchema: z.object({ ok: z.boolean() }),
  execute: (post: MailboxNotifyInput, ctx) => {
    heard.push(`${ctx.flow.id}|${post.body}`);
    return { ok: true };
  }
});
const answer = handler({
  name: "poc-answer",
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

/**
 * The sketch: the same wake, but the worker list is read when a post is
 * delivered, from a getter the host hands in (its live registry), not frozen
 * when the block is built. A dispatcher per worker is built on first use and
 * kept; `validateRoute` accepts it because it is one this wake built.
 */
function wakeLiveMembers(seats: () => readonly FlowInstance[]): BlockDefinition<any, any> {
  const silent = handler({
    name: "poc-silent",
    inputSchema: mailboxNotifyInputSchema,
    outputSchema: z.object({}),
    execute: () => ({})
  });
  const built = new Map<string, BlockDefinition<any, any>>();
  const wakeOf = (seat: FlowInstance) => {
    let wake = built.get(seat.id);
    if (wake === undefined) {
      wake = dispatcher({
        name: `wake-${seat.id}`,
        flowKind: seat.id,
        action: "onMailboxPost",
        inputSchema: mailboxNotifyInputSchema,
        session: { key: (post: MailboxNotifyInput) => `mailbox:${post.mailboxId}` }
      }) as BlockDefinition<any, any>;
      built.set(seat.id, wake);
    }
    return wake;
  };
  return router({
    name: "poc-wake-live",
    inputSchema: mailboxNotifyInputSchema,
    routes: [silent],
    validateRoute: (candidate: BlockDefinition<any, any>) =>
      candidate === silent || [...built.values()].includes(candidate),
    execute: (post: MailboxNotifyInput, ctx: BlockContext) => {
      const seat = reachableSeat(hearingSeatsById(seats()).get(post.member) ?? [], ctx);
      if (seat === undefined || post.seatAuthored === true) return silent;
      return wakeOf(seat);
    }
  } as never) as BlockDefinition<any, any>;
}

async function bind(stores: StoreRegistry, sessionId: string, members: string[]) {
  const now = Date.now();
  await stores.session.set(
    sessionId,
    {
      id: sessionId, flowKind: MAILBOX_KIND, flowId: MAILBOX_KIND, userId: USER_ID, orgId: DEFAULT_ORG_ID,
      state: { members, instructions: "Charter.", transcript: [] },
      lineageId: `lin_${sessionId}`, version: 0, createdAt: now, updatedAt: now, journal: []
    } as never,
    "any"
  );
}

/** Write members into an open mailbox's session, as a subscribe would. */
async function subscribe(stores: StoreRegistry, sessionId: string, member: string) {
  const record = (await stores.session.get(sessionId)) as any;
  await stores.session.set(
    sessionId,
    { ...record, state: { ...record.state, members: [...record.state.members, member] } },
    "any"
  );
}

async function post(runtime: FlowStateRuntime, mailbox: FlowInstance, sessionId: string, body: string) {
  const result = await runAction({
    orgId: DEFAULT_ORG_ID, flow: mailbox, actionName: "post", input: { body }, userId: USER_ID,
    sessionId, stores: runtime.stores, runtimeConfig: { ...runtime.runtimeConfig }
  } as never);
  if (result.error) throw new Error(JSON.stringify(result.error));
  // Let the fan-out and the woken runs settle.
  for (let i = 0; i < 300; i += 1) {
    const reqs = await runtime.stores.request.list({});
    if (reqs.every((r: any) => r.status !== "in_progress")) break;
    await new Promise((r) => setTimeout(r, 10));
  }
  await new Promise((r) => setTimeout(r, 50));
}

/** One host: the boot workers, a wake built over `wake(registry)`, and a hire registered after boot. */
async function run(label: string, wake: (live: () => readonly FlowInstance[], boot: FlowInstance[]) => BlockDefinition<any, any>) {
  heard.length = 0;
  const kinds = { listener } as never;
  const boot = hireWorkforce([{ id: "eng.ivy", declared: { flow: "listener" }, body: "" }], { kinds });
  let registryRef: { list(): FlowInstance[] } | undefined;
  const notify = wake(() => registryRef?.list() ?? [], boot);
  const mailbox = defineMailboxFlow({ notify })();
  const state = createFlowState({
    flows: { [MAILBOX_KIND]: mailbox, ...Object.fromEntries(boot.map((s) => [s.id, s])) },
    stores: { default: { primary: inMemoryStores() } }
  } as never);
  try {
    const runtime = await state.getRuntime();
    registryRef = runtime.registry;
    // The fresh hire: registered after the wake was built, as `hire` does at run time.
    const [hire] = hireWorkforce([{ id: "eng.newhire", declared: { flow: "listener" }, body: "" }], { kinds });
    runtime.registry.register(hire!);

    await bind(runtime.stores, "eng.task", ["eng.ivy"]);
    await post(runtime, mailbox, "eng.task", "before");
    const before = [...heard];
    await subscribe(runtime.stores, "eng.task", "eng.newhire");
    await post(runtime, mailbox, "eng.task", "after");
    return { before, after: heard.filter((h) => h.endsWith("|after")) };
  } finally {
    await state.dispose();
  }
}

console.log("Check 1+2 · live wake + runtime member: the hire is woken on the post after subscribe");
const live = await run("live", (live) => wakeLiveMembers(live));
expect("declared member woken before subscribe", live.before.includes("eng.ivy|before"), JSON.stringify(live.before));
expect("hire NOT woken before it is a member", !live.before.some((h) => h.startsWith("eng.newhire")), JSON.stringify(live.before));
expect("hire woken on the post after subscribe", live.after.includes("eng.newhire|after"), JSON.stringify(live.after));
expect("declared member still woken after subscribe", live.after.includes("eng.ivy|after"), JSON.stringify(live.after));

console.log("Control · today's wake (boot list): the same subscribe does not wake the hire");
const today = await run("today", (_live, boot) => wakeMemberSeats(boot));
expect("declared member woken (the control is not just broken)", today.after.includes("eng.ivy|after"), JSON.stringify(today.after));
expect("hire NOT woken under the boot-list wake", !today.after.some((h) => h.startsWith("eng.newhire")), JSON.stringify(today.after));

console.log(failures === 0 ? "\nALL CHECKS BEHAVE" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
