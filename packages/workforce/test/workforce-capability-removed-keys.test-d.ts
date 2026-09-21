/**
 * Compile-time half of BR-16: `createWorkforceCapability`'s removed `agents`
 * key is refused LOUDLY, with a message naming what to pass instead.
 *
 * Runtime tests cannot reach this. An app that upgrades and keeps passing
 * `agents` would, if the key were simply deleted, either be told only that a
 * property is unknown (object literal) or be told nothing at all (options built
 * up in a variable and passed by reference, where excess-property checking does
 * not apply). Both are a roster silently ignored, which is the failure BP-030
 * names.
 *
 * So the key survives, typed as its own replacement message: the compiler
 * prints the expected type, and the expected type IS the instruction.
 *
 * Vitest strips types rather than checking them, so `tsconfig.test-d.json`
 * compiles this file and the `typecheck` script runs it. Delete the key and
 * the `@ts-expect-error` below has nothing to suppress, which is itself an
 * error (TS2578) — `pnpm typecheck` goes red either way.
 */
import { createWorkforceCapability } from "../src/workforce-capability";
import type { WorkforceCapabilityOptions } from "../src/workforce-capability";

/** The replacement, and the shape every case below is measured against. */
export const supported = createWorkforceCapability({
  roster: { workers: [], channels: [] },
  inventory: { seats: "seatInventory", channels: "channelInventory" }
});

/** A domain with no inventory key is an ordinary state, not a missing argument. */
export const partial = createWorkforceCapability({
  roster: { workers: [], channels: [] },
  inventory: { channels: "channelInventory" }
});

export const removedAgents = createWorkforceCapability({
  roster: { workers: [], channels: [] },
  inventory: {},
  // @ts-expect-error `agents` was removed — the expected type names the replacement.
  agents: [{ name: "reviewer" }]
});

export const removedCatalog = createWorkforceCapability({
  roster: { workers: [], channels: [] },
  inventory: {},
  // @ts-expect-error `catalog` was removed — it was never read.
  catalog: { search: {} }
});

/**
 * The options type refuses it too, not just the call.
 *
 * This is the case excess-property checking would miss on its own: an app that
 * types its own options bag and passes it by reference gets no literal check at
 * the call site, so the refusal has to live on the type.
 */
export const byReference: WorkforceCapabilityOptions = {
  roster: { workers: [], channels: [] },
  inventory: {},
  // @ts-expect-error same key, same refusal, reached through the exported type.
  agents: []
};
