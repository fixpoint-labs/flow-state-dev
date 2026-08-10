/**
 * The per-worker seam a *composed* worker reaches its lease-renewal driver
 * through (FIX-1005).
 *
 * Split from `./lease-renewal` for one concrete reason: this file needs
 * `node:async_hooks`, and `@flow-state-dev/orchestration/tasks` is published as
 * a browser-safe subpath (`docs/architecture/items.md`). A browser bundler
 * cannot resolve a Node built-in, so anything the `tasks` entry can reach must
 * not import one. The renewal *driver* is timers and promises and stays there;
 * this seam is Node-only by nature and is exported from the package's main
 * entry, which already reaches `node:fs` through skills.
 *
 * Everything below was `lease-renewal.ts` until that constraint was noticed.
 * The rules are unchanged; only the file boundary is new.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { LeaseRenewalDriver } from "./lease-renewal";

/**
 * The running driver for the claim whose async chain this call is in
 * (FIX-1005) — the seam a *composed* worker reaches it through.
 *
 * A seam whose work is a statically composed step cannot be handed the driver
 * as an argument, and cannot stash it on sequencer state either: that state is
 * Zod-validated and persisted, and an `AbortController` is neither. It rides
 * `AsyncLocalStorage` instead, which is the mechanism the substrate already
 * uses to give each concurrent worker its own claim ticket — same per-iteration
 * isolation, no new machinery. A closure would be wrong here for a concrete
 * reason: a worker body is built **once** and shared by every worker on a
 * board, so one cell would serve `concurrency` workers at once.
 *
 * The mechanism is right; the way it is entered is easy to get wrong, and the
 * failure is silent. {@link openLeaseRenewalScope} carries that rule.
 */
const renewalScope = new AsyncLocalStorage<RenewalSlot>();

/**
 * The per-iteration cell the driver is published through.
 *
 * A **mutable slot** rather than the driver itself, and that indirection is
 * the whole point — see {@link openLeaseRenewalScope}.
 */
type RenewalSlot = { driver?: LeaseRenewalDriver };

/**
 * Open this worker iteration's renewal slot. **Call it before the first
 * `await` in the block that claims the task** — first statement, no
 * exceptions.
 *
 * `enterWith` mutates the *current* async resource. At the top of a block's
 * body you are still executing on the caller's resource, so the mutation is
 * visible to the sequencer's later steps. After an `await` you are on a
 * continuation resource that dies with the block, so the same call publishes
 * to nobody — silently, with every reader simply seeing `undefined`.
 *
 * That is exactly how this seam failed on arrival: the board's setup tap
 * stamped the driver after awaiting the collection and a `patchState`, so the
 * worker never ran under the lease-loss signal and neither recorder could stop
 * the driver. Nothing failed loudly, because a settled task makes renewal stop
 * itself (the write is declined `terminal`) — so only a task that is never
 * settled, which is precisely the suspension case, showed the leak.
 *
 * Splitting "open the slot" from "install the driver" is what makes the rule
 * followable: opening takes no arguments, so it can always be hoisted above
 * the awaits that produce the driver.
 */
export function openLeaseRenewalScope(): void {
  renewalScope.enterWith({});
}

/**
 * Publish `driver` into the slot {@link openLeaseRenewalScope} opened, so the
 * steps that follow can run under its signal and stop it when they settle the
 * task.
 *
 * Throws when no slot is open rather than returning quietly: a driver nobody
 * can reach renews a lease forever, and that failure is invisible at runtime.
 * Better to fail at the call site than to ship a mechanism that does nothing.
 */
export function stampLeaseRenewal(driver: LeaseRenewalDriver): void {
  const slot = renewalScope.getStore();
  if (slot === undefined) {
    // Don't leave the caller's driver running when we are about to reject it.
    driver.stop();
    throw new Error(
      `[tasks] stampLeaseRenewal() was called with no renewal scope open. ` +
        `Call openLeaseRenewalScope() before the first await in the block that ` +
        `claims the task — after an await the scope is published to nobody.`
    );
  }
  slot.driver = driver;
}

/**
 * The renewal driver of the claim whose async chain this call is running in,
 * or `undefined` outside one.
 *
 * Read twice per iteration: by a step's `abortSignal` resolver, so the work
 * runs under the lease-loss signal, and by whichever recorder settles the
 * task, to stop renewing.
 */
export function currentLeaseRenewal(): LeaseRenewalDriver | undefined {
  return renewalScope.getStore()?.driver;
}

/**
 * Run the block body that claims a task inside a fresh renewal scope, and stop
 * whatever driver that body stamped if the body does not finish.
 *
 * **Call it before the first `await` in the claiming block** — it opens the
 * scope, so it inherits {@link openLeaseRenewalScope}'s rule unchanged. In
 * practice that means `execute: async (input, ctx) => withLeaseRenewalScope(…)`,
 * where the wrapper call *is* the first statement.
 *
 * **Why the guarantee has to live here rather than in the caller's ordering.**
 * Every way of *leaving the work* is already covered: the step that dispatches
 * the worker carries `onSettled`, which runs whether the worker returned, threw
 * or suspended, and a cancelled request stops the driver through the ambient
 * signal. What none of those cover is the hand-off — the window between the
 * claim committing and that step being reached. The claiming block still has to
 * write its state and emit its status, and if either fails the work step never
 * runs, so no recorder and no `onSettled` ever fires. A failed request does not
 * abort its own signal either. The timer would go on renewing a row nobody is
 * working for as long as the host lives, and because the lease is exactly the
 * signal `claim()` reads to decide a row is abandoned, no other worker could
 * ever recover it. That is the deadlock this whole mechanism exists to remove,
 * rebuilt out of a failed state write.
 *
 * The two seams that claim and work in *different* steps — the task board's
 * worker body and `routedSpecialists` — each hand-rolled that hand-off, and
 * only one of them happened to put the driver start last where nothing could
 * fail after it. Ordering is not a property a reader can check or a test can
 * pin, so it is not the thing to rely on: the `catch` here makes where the
 * driver starts irrelevant, which is what makes both seams correct for the same
 * stated reason rather than by accident.
 *
 * Stopping is deliberately *all* it does. It does not settle the task or
 * release the claim — the row's lease simply lapses and the substrate hands it
 * to the next worker, which is the ordinary recovery path rather than a special
 * one.
 */
export async function withLeaseRenewalScope<T>(setup: () => Promise<T>): Promise<T> {
  openLeaseRenewalScope();
  try {
    return await setup();
  } catch (err) {
    currentLeaseRenewal()?.stop();
    throw err;
  }
}
