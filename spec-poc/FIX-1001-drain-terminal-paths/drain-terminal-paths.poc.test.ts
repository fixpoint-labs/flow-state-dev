/**
 * FIX-1001 spec POC — characterization of the four terminal paths in
 * `runAction`, and whether a queued background `.work()` task is still
 * pending (and still able to write) when the request record goes terminal.
 *
 * THROWAWAY. Lives on the spec branch only; CI ignores `spec-poc/`. It exists
 * so the spec's Part I decision criterion rests on a run, not on a reading.
 *
 * Run it:
 *   pnpm --filter @flow-state-dev/integration-tests exec vitest run \
 *     --root . spec-poc/FIX-1001-drain-terminal-paths/drain-terminal-paths.poc.test.ts
 *
 * (see RESULT.md in this directory for the recorded output)
 *
 * ---------------------------------------------------------------------------
 * WHAT IT SETTLES
 *
 * The issue states the exposure is "largely closed by the signal" for BOTH
 * abort and disconnect, leaving error as the lone open path. That is a
 * two-way split. This POC checks whether the split is really two-way.
 *
 * Three facts are read directly off `runAction` and are true by construction
 * (`packages/engine/src/execution/runAction.ts`):
 *
 *   :852  abortController = registerAbortController(requestId)   // the /abort endpoint
 *   :853  composedSignal  = AbortSignal.any([options.signal, abortController.signal])
 *   :889  backgroundController = new AbortController()
 *   :902  abortController.signal.addEventListener("abort", fireBackground)
 *
 * `backgroundController` — the signal substituted for `ctx.signal` inside a
 * `.work()` task — listens ONLY on `abortController`. The transport half of
 * `composedSignal` never reaches it. So the background signal fires on an
 * explicit `/abort` and on nothing else.
 *
 * That makes the terminal-path table three-way, not two-way:
 *
 *   success      composedSignal clean   bg signal clean    DRAINED (:1409)
 *   abort        composedSignal fired   bg signal FIRED    not drained
 *   interrupted  composedSignal fired   bg signal CLEAN    not drained
 *   failed       composedSignal clean   bg signal CLEAN    not drained
 *
 * The signal-half of that table is already pinned by a passing test on main:
 * `packages/integration-tests/src/scenarios/work-pool-signal-isolation.test.ts`
 * ("transport-level abort does NOT abort background .work()"). This POC adds
 * the half that test does not cover: whether the REQUEST RECORD is already
 * terminal while the task is still pending and still able to act.
 *
 * ---------------------------------------------------------------------------
 * DISCRIMINATION CHECK (the reason this is evidence and not a green tick)
 *
 * Case D runs the identical flow with the throw removed. If the harness were
 * broken — gate never held, task never queued, status never read — every case
 * would report the same thing and a skipped measurement would be
 * indistinguishable from a clean one. Case D must report `in_progress` and
 * must NOT resolve before the gate opens. If D and A agree, the POC is
 * measuring nothing and its verdict must be discarded.
 */
import { describe, expect, it } from "vitest";
import { defineFlow, handler, sequencer } from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import { runAction, abortRequest, createInMemoryStores } from "@flow-state-dev/engine";
import { z } from "zod";

type Deferred = { promise: Promise<void>; open: () => void };
function gate(): Deferred {
  let open!: () => void;
  const promise = new Promise<void>((r) => {
    open = r;
  });
  return { promise, open };
}

interface Observation {
  /** Did the background task body actually execute? */
  ran: boolean;
  /** `request.status` as the background task saw it, at the moment it acted. */
  statusAtWriteTime: string | undefined;
  /** Was the task's own `ctx.signal` aborted when it acted? */
  signalAborted: boolean;
  /** Did the background task act AFTER `runAction` had already returned? */
  actedAfterRunActionReturned: boolean;
}

const settle = (ms = 25): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * The background task under test. It parks on `held` (so the request reaches
 * its terminal path while this is unmistakably still pending), then reads the
 * request record and records what it saw. Reading the record is the honest
 * proxy for "can still write": both go through the same live stores handle
 * the runtime considers finished.
 */
function parkedWriter(
  held: Deferred,
  obs: Observation,
  stores: ReturnType<typeof createInMemoryStores>,
  requestId: string,
  runActionReturned: { value: boolean }
) {
  return handler({
    name: "parked-writer",
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async (_input: unknown, ctx: BlockContext) => {
      // Park until the driver decides the request has reached terminal.
      // An aborted background signal short-circuits the park — that is the
      // "exposure closed by the signal" behaviour, and case C must show it.
      await Promise.race([
        held.promise,
        new Promise<void>((resolve) => {
          if (ctx.signal?.aborted) return resolve();
          ctx.signal?.addEventListener("abort", () => resolve(), { once: true });
        })
      ]);

      obs.ran = true;
      obs.signalAborted = ctx.signal?.aborted ?? false;
      obs.actedAfterRunActionReturned = runActionReturned.value;
      obs.statusAtWriteTime = (await stores.request.get(requestId))?.status;
      return null;
    }
  });
}

const boom = handler({
  name: "boom",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async () => {
    throw new Error("action failed on purpose (FIX-1001 POC)");
  }
});

const noop = handler({
  name: "noop",
  inputSchema: z.unknown(),
  outputSchema: z.unknown(),
  execute: async () => null
});

/**
 * Firing a signal is not enough to reach the abort/disconnect terminal paths:
 * `runAction` only enters its catch block if something THROWS. A chain that
 * merely fires a signal and then ends runs to completion and takes the success
 * path (drain included) — which is what the first cut of this POC did, and why
 * cases B and C reported `completed` instead of the path they were named for.
 * So every terminator here fires its signal and then blocks on the main
 * chain's own `ctx.signal` (the composed signal) and rejects, exactly as
 * `packages/engine/test/abort.test.ts` does.
 */
function abortAndThrow(name: string, fire: (ctx: BlockContext) => void | Promise<void>) {
  return handler({
    name,
    inputSchema: z.unknown(),
    outputSchema: z.unknown(),
    execute: async (_input: unknown, ctx: BlockContext) => {
      await fire(ctx);
      await new Promise<never>((_resolve, reject) => {
        const fail = (): void => reject(new DOMException("Aborted", "AbortError"));
        if (ctx.signal?.aborted) return fail();
        ctx.signal?.addEventListener("abort", fail, { once: true });
      });
      return null;
    }
  });
}

/** Client disconnect / SSE close: fires `options.signal` only. */
function fireTransport(controller: AbortController) {
  return abortAndThrow("fire-transport", () => {
    controller.abort();
  });
}

/** Models the `/abort` endpoint: sets the record flag, then fires the registry. */
function fireExplicitAbort(stores: ReturnType<typeof createInMemoryStores>, requestId: string) {
  return abortAndThrow("fire-explicit-abort", async () => {
    const rec = await stores.request.get(requestId);
    if (rec) {
      await stores.request.set(requestId, { ...rec, abortRequested: true } as never, "any");
    }
    abortRequest(requestId);
  });
}

/**
 * Drive one terminal path. `terminator` is the block that pushes the request
 * onto the path under test; it runs AFTER `.work()` has queued the parked task.
 */
async function driveCase(
  label: string,
  requestId: string,
  makeTerminator: (
    stores: ReturnType<typeof createInMemoryStores>,
    requestId: string,
    transport: AbortController
  ) => ReturnType<typeof handler>,
  transportSignalUsed: boolean
): Promise<{ obs: Observation; recordStatusWhenRunActionReturned: string | undefined }> {
  const stores = createInMemoryStores();
  const held = gate();
  const transport = new AbortController();
  const runActionReturned = { value: false };
  const obs: Observation = {
    ran: false,
    statusAtWriteTime: undefined,
    signalAborted: false,
    actedAfterRunActionReturned: false
  };

  const root = sequencer({ name: "root", inputSchema: z.unknown() })
    .work(parkedWriter(held, obs, stores, requestId, runActionReturned))
    .tap(makeTerminator(stores, requestId, transport));

  const flow = defineFlow({
    kind: `fix1001-poc-${label}`,
    actions: { run: { block: root } }
  })({ id: "test" });

  const runPromise = runAction({
    flow,
    actionName: "run",
    userId: "u",
    input: undefined,
    requestId,
    ...(transportSignalUsed ? { signal: transport.signal } : {}),
    stores,
    runtimeConfig: {}
  }).then((r) => {
    runActionReturned.value = true;
    return r;
  });

  // Give the run a chance to reach its terminal path while the task is parked.
  // If the path drains (case D) this races the gate — resolved below.
  await settle(120);

  const recordStatusWhenRunActionReturned = runActionReturned.value
    ? (await stores.request.get(requestId))?.status
    : "<runAction had NOT returned>";

  // Release the parked task and let everything settle.
  held.open();
  await runPromise.catch(() => undefined);
  await settle(80);

  const finalStatus = (await stores.request.get(requestId))?.status;
  return { obs, recordStatusWhenRunActionReturned, finalStatus };
}

const TERMINAL = new Set(["completed", "failed", "aborted", "interrupted", "incomplete"]);

describe("FIX-1001 POC — is the request record terminal while background work is still pending?", () => {
  it("A · error path — record goes terminal with the task still parked", async () => {
    const r = await driveCase("error", "req_poc_error", () => boom, false);
    // eslint-disable-next-line no-console
    console.log("[A error]      ", { ...r.obs, at: r.recordStatusWhenRunActionReturned, final: r.finalStatus });

    // The path under test was actually reached.
    expect(r.finalStatus).toBe("failed");
    // ...and the record was already terminal while the task was still parked.
    expect(r.recordStatusWhenRunActionReturned).toBe("failed");
    expect(r.obs.ran).toBe(true);
    expect(r.obs.actedAfterRunActionReturned).toBe(true);
    expect(r.obs.signalAborted).toBe(false);
    expect(TERMINAL.has(r.obs.statusAtWriteTime ?? "")).toBe(true);
  });

  it("B · disconnect path — SAME exposure; the background signal is NOT aborted", async () => {
    const r = await driveCase(
      "disconnect",
      "req_poc_disconnect",
      (_s, _rid, transport) => fireTransport(transport),
      true
    );
    // eslint-disable-next-line no-console
    console.log("[B disconnect] ", { ...r.obs, at: r.recordStatusWhenRunActionReturned, final: r.finalStatus });

    expect(r.finalStatus).toBe("interrupted");
    // The claim the issue gets wrong: transport teardown leaves the background
    // signal CLEAN, so nothing stops the task — same exposure as the error path.
    expect(r.obs.signalAborted).toBe(false);
    expect(r.obs.ran).toBe(true);
    expect(r.obs.actedAfterRunActionReturned).toBe(true);
    expect(TERMINAL.has(r.obs.statusAtWriteTime ?? "")).toBe(true);
  });

  it("C · explicit abort — the background signal DOES fire (exposure closed by the signal)", async () => {
    const r = await driveCase(
      "abort",
      "req_poc_abort",
      (stores, requestId) => fireExplicitAbort(stores, requestId),
      false
    );
    // eslint-disable-next-line no-console
    console.log("[C abort]      ", { ...r.obs, at: r.recordStatusWhenRunActionReturned, final: r.finalStatus });

    expect(r.finalStatus).toBe("aborted");
    expect(r.obs.ran).toBe(true);
    // This is the ONE path where the issue's "closed by the signal" holds.
    expect(r.obs.signalAborted).toBe(true);
  });

  it("D · DISCRIMINATION — success path drains; the task sees a non-terminal record", async () => {
    const r = await driveCase("success", "req_poc_success", () => noop, false);
    // eslint-disable-next-line no-console
    console.log("[D success]    ", { ...r.obs, at: r.recordStatusWhenRunActionReturned, final: r.finalStatus });

    expect(r.finalStatus).toBe("completed");
    expect(r.obs.ran).toBe(true);
    // runAction must still have been BLOCKED on the drain when we sampled.
    expect(r.recordStatusWhenRunActionReturned).toBe("<runAction had NOT returned>");
    expect(r.obs.actedAfterRunActionReturned).toBe(false);
    // And the record it saw was not terminal — the drain runs first.
    expect(TERMINAL.has(r.obs.statusAtWriteTime ?? "")).toBe(false);
  });
});
