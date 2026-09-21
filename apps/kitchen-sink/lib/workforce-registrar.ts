/**
 * Standalone workforce-registrar proxy.
 *
 * Sits in its own module for the same reason `lib/schedule-index.ts` does, and
 * it is the same shape: it breaks a cyclic import. `fsdev.config.ts` builds the
 * FlowState and installs the real implementation here;
 * `flows/workforce-admin/flow.ts` imports the proxy so its `hire` and `fire`
 * actions can admit and release an address. The admin flow cannot import the
 * config, because the config is what registers the admin flow.
 *
 * **The default throws rather than no-opping**, which is the one place this
 * differs from the schedule index. A no-op schedule index means no row is
 * mirrored, which the collection documents. A no-op registrar would mean a hire
 * that wrote its durable row, registered nothing, and reported success — a seat
 * that exists in storage, answers nowhere, and appears out of nothing at the
 * next boot. Failing loudly turns a wiring mistake into a refused hire with a
 * named cause, and the compensating delete then removes the row it wrote.
 */

import type { FlowInstance } from "@flow-state-dev/core/types";

/**
 * **Provenance lives here, not in the installed door.** `fire` may release only
 * an address this app registered *from a roster row* (BR-28). Nothing on a
 * `FlowInstance` says where it came from — a seat minted from a row and one
 * declared in `workforce/teams/` are the same shape and can carry the same
 * kind — so the only place that answer exists is the call site that did the
 * registering, and the only way to keep it is to record it there.
 *
 * It is module state beside `impl` rather than part of the door, because it is
 * a fact about THIS app's roster path and not about whichever admission door
 * is installed. Installing a door resets it: a new door is a new app, and a
 * mark carried over from the last one would claim provenance for a
 * registration that never happened.
 */
const fromRoster = new Set<string>();

/** What the app installs: the FlowState's admission door, plus one read. */
export interface WorkforceRegistrar {
  /** Admit one instance. Throws exactly as `FlowState.register` does. */
  register(flow: FlowInstance): void;
  /** Release one address. `false` when nothing held it. */
  unregister(id: string): boolean;
  /**
   * The kind of whatever currently holds an address, or `undefined`.
   *
   * Needed by `fire`, which must release an address **only** when the live
   * instance is the one this org's row minted. There is no public read of the
   * registry on `FlowState` today — `meta.flowKeys` answers *which ids* but not
   * *what kind* — so the config supplies this from `getRuntime().registry`.
   * That gap is recorded as a follow-up rather than worked around quietly.
   */
  kindAt(id: string): string | undefined;
}

/**
 * The proxy's own surface: the door, plus the two provenance operations that
 * belong to this app rather than to the door.
 */
export interface WorkforceRosterRegistrar extends WorkforceRegistrar {
  /**
   * Admit one instance minted from a roster row, and record that this app did
   * so. The two call sites are `hire` and the boot reload in `fsdev.config.ts`
   * — a seat that reaches the registry any other way is not this app's to
   * release.
   *
   * Marked only after the door accepts. A registration that threw (a duplicate
   * address, say, which is exactly what a file-declared seat holding the same
   * address produces at boot) left nothing registered, so claiming provenance
   * for it would hand `fire` someone else's instance.
   */
  registerFromRoster(flow: FlowInstance): void;
  /**
   * Whether this app registered the address from a roster row — what BR-28
   * actually asks, rather than the kind-equality proxy that answers `true` for
   * any file-declared seat that happens to share the row's kind.
   */
  isFromRoster(id: string): boolean;
}

function notInstalled(): never {
  throw new Error(
    "The workforce registrar has not been installed. `fsdev.config.ts` installs it " +
      "immediately after `createFlowState`, before anything can serve a request — so " +
      "reaching this means the admin flow was registered by some other assembly. " +
      "A hire cannot be honoured without it: the row would be written and no seat would answer."
  );
}

let impl: WorkforceRegistrar = {
  register: notInstalled,
  unregister: notInstalled,
  kindAt: notInstalled,
};

/** Install the backing implementation. Called once by `fsdev.config.ts`. */
export function setWorkforceRegistrarImpl(next: WorkforceRegistrar): void {
  impl = next;
  fromRoster.clear();
}

/**
 * Stable proxy whose methods delegate to the installed implementation.
 * Safe to import from anywhere at module-init time.
 */
export const workforceRegistrar: WorkforceRosterRegistrar = {
  register: (flow: FlowInstance) => impl.register(flow),
  unregister: (id: string) => {
    // The mark goes whether or not anything was holding the address: once an
    // address is released, this app is no longer the reason something is
    // there, and a mark that outlived its registration would let `fire`
    // release whatever took the address next.
    fromRoster.delete(id);
    return impl.unregister(id);
  },
  kindAt: (id: string) => impl.kindAt(id),
  registerFromRoster: (flow: FlowInstance) => {
    impl.register(flow);
    fromRoster.add(flow.id);
  },
  isFromRoster: (id: string) => fromRoster.has(id),
};
