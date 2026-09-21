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
}

/**
 * Stable proxy whose methods delegate to the installed implementation.
 * Safe to import from anywhere at module-init time.
 */
export const workforceRegistrar: WorkforceRegistrar = {
  register: (flow: FlowInstance) => impl.register(flow),
  unregister: (id: string) => impl.unregister(id),
  kindAt: (id: string) => impl.kindAt(id),
};
