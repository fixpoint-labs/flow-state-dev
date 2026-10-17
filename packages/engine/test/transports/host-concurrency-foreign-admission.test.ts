/**
 * A session read is held open, so the window before the concurrency place is
 * taken is as wide as the test wants. Places on a key are taken in dispatch
 * order, so a request dispatched behind a pending read waits for it; what a
 * non-owner's pending read must never do is take a place of its own.
 */
import { describe, it, expect } from "vitest";
import { DEFAULT_ORG_ID, defineFlow, handler } from "@flow-state-dev/core";
import { z } from "zod";
import {
  createFlowRegistry,
  createInMemoryStores,
  createInboundTransportHost,
  defaultBodyUserIdPrincipalResolver,
  UserBindingMismatchError
} from "../../src";
import { ConcurrencyRejectedError } from "../../src/transports/errors";

type Gate = { id: string; release: () => void };

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function buildHost() {
  const registry = createFlowRegistry();
  const stores = createInMemoryStores();
  const gates: Gate[] = [];
  const started: string[] = [];

  let pending: Promise<void> | undefined;
  const sessionGet = stores.session.get.bind(stores.session);
  stores.session.get = async (...args: Parameters<typeof sessionGet>) => {
    const wait = pending;
    pending = undefined;
    if (wait !== undefined) await wait;
    return sessionGet(...args);
  };

  const block = (name: string) =>
    handler({
      name,
      execute: async (input: { value: string }): Promise<{ ok: true }> => {
        started.push(input.value);
        await new Promise<void>((resolve) => gates.push({ id: input.value, release: resolve }));
        return { ok: true };
      }
    });

  registry.register(
    defineFlow({
      kind: "conversation",
      actions: {
        strict: {
          concurrency: "reject",
          inputSchema: z.object({ value: z.string() }),
          block: block("strict")
        },
        line: {
          concurrency: "queue",
          inputSchema: z.object({ value: z.string() }),
          block: block("line")
        }
      }
    })({ id: "conversation" })
  );

  const host = createInboundTransportHost({
    registry,
    stores,
    resolvePrincipal: defaultBodyUserIdPrincipalResolver,
    runtimeConfig: {}
  });

  const release = (id: string) => {
    const found = gates.find((g) => g.id === id);
    if (found === undefined) throw new Error(`"${id}" is not running`);
    gates.splice(gates.indexOf(found), 1);
    found.release();
  };

  return {
    started,
    release,
    pauseNextSessionRead: (): (() => void) => {
      let resume!: () => void;
      pending = new Promise<void>((resolve) => {
        resume = resolve;
      });
      return resume;
    },
    dispatch: (action: "strict" | "line", value: string, userId = "u_1") =>
      host.dispatch({
        source: "http" as const,
        flowKind: "conversation",
        action,
        input: { value },
        sessionId: "s_1",
        principal: { userId, orgId: DEFAULT_ORG_ID }
      })
  };
}

/** u_1 owns s_1 once its first request has run there. */
async function ownedSession(h: ReturnType<typeof buildHost>) {
  const first = h.dispatch("strict", "owner-first");
  await tick();
  h.release("owner-first");
  await first.finished;
}

describe("a caller who does not own the session (in-memory backend)", () => {
  it("cannot get the owner's `reject` request refused", async () => {
    const h = buildHost();
    await ownedSession(h);

    const resume = h.pauseNextSessionRead();
    const foreign = h.dispatch("strict", "x-1", "u_2");
    void foreign.finished.catch(() => {});

    let owner!: ReturnType<typeof h.dispatch>;
    expect(() => {
      owner = h.dispatch("strict", "owner-2");
    }).not.toThrow();
    await tick();
    expect(h.started).toEqual(["owner-first"]);

    resume();
    await expect(foreign.finished).rejects.toBeInstanceOf(UserBindingMismatchError);
    await owner.accepted;
    await tick();
    expect(h.started).toEqual(["owner-first", "owner-2"]);
    h.release("owner-2");
    await owner.finished;
    expect(h.started).not.toContain("x-1");
  });

  it("cannot stand in front of the owner's `queue` request", async () => {
    const h = buildHost();
    await ownedSession(h);

    const resume = h.pauseNextSessionRead();
    const foreign = h.dispatch("line", "x-1", "u_2");
    void foreign.finished.catch(() => {});

    const owner = h.dispatch("line", "owner-2");
    await tick();
    expect(h.started).toEqual(["owner-first"]);

    resume();
    await expect(foreign.finished).rejects.toBeInstanceOf(UserBindingMismatchError);
    await owner.accepted;
    await tick();
    await tick();
    expect(h.started).toEqual(["owner-first", "owner-2"]);
    h.release("owner-2");
    await owner.finished;
    expect(h.started).not.toContain("x-1");
  });

  it("is refused with nothing left held: the owner's next `reject` request runs", async () => {
    const h = buildHost();
    await ownedSession(h);

    const foreign = h.dispatch("strict", "x-1", "u_2");
    await expect(foreign.finished).rejects.toBeInstanceOf(UserBindingMismatchError);

    const owner = h.dispatch("strict", "owner-2");
    await owner.accepted;
    await tick();
    h.release("owner-2");
    await owner.finished;
    expect(h.started).toEqual(["owner-first", "owner-2"]);
  });
});

describe("two requests from the session's owner on one key (in-memory backend)", () => {
  // The first request's ownership read is the slow one, so its place would be
  // taken after the second's if places followed read completion.
  it("`queue`: the first dispatched runs first", async () => {
    const h = buildHost();
    await ownedSession(h);

    const resume = h.pauseNextSessionRead();
    const first = h.dispatch("line", "a");
    const second = h.dispatch("line", "b");
    await tick();
    resume();
    await first.accepted;
    await second.accepted;
    await tick();
    expect(h.started).toEqual(["owner-first", "a"]);

    h.release("a");
    await first.finished;
    await tick();
    h.release("b");
    await second.finished;
    expect(h.started).toEqual(["owner-first", "a", "b"]);
  });

  it("`reject`: the first dispatched runs and the second is refused", async () => {
    const h = buildHost();
    await ownedSession(h);

    const resume = h.pauseNextSessionRead();
    const first = h.dispatch("strict", "a");
    const second = h.dispatch("strict", "b");
    void second.finished.catch(() => {});
    await tick();
    resume();
    await tick();
    await tick();
    expect(h.started).toEqual(["owner-first", "a"]);
    await expect(second.finished).rejects.toBeInstanceOf(ConcurrencyRejectedError);

    h.release("a");
    await first.finished;
  });
});
