// FIX-2624.
/**
 * What the framework's own flows (the default write flow) read off the
 * context they run in, instead of capturing at install: the stores and the
 * host-level resolver of the runtime executing them. A built-in instance is
 * held once per registry, and two hosts can share a registry, so whatever it
 * captured would be the first host's; this seam is always the running one's.
 * Engine-private: a symbol, so no flow's input or state can carry it.
 */
import type { StoreRegistry } from "../stores/types";
import type { PrincipalResolver } from "../transports/types";

/** The executing runtime's stores and host resolver, as a built-in flow reads them. */
export type BuiltInHost = {
  stores: StoreRegistry;
  /** The host-level resolver the executing host is given; absent, the development resolver. */
  hostResolver: PrincipalResolver | undefined;
};

/** Where the execution context carries {@link BuiltInHost}. */
export const BUILT_IN_HOST: unique symbol = Symbol.for("@flow-state-dev/engine/built-in-host");

/** Attach `host` to an execution context. */
export function attachBuiltInHost(ctx: object, host: BuiltInHost): void {
  (ctx as { [BUILT_IN_HOST]?: BuiltInHost })[BUILT_IN_HOST] = host;
}

/** The executing runtime's {@link BuiltInHost}, or `undefined` outside an engine-built context. */
export function builtInHostOf(ctx: object): BuiltInHost | undefined {
  return (ctx as { [BUILT_IN_HOST]?: BuiltInHost })[BUILT_IN_HOST];
}
