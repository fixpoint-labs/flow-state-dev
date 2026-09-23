/**
 * `createWorkforceCapability` — the discovery door a workforce's seats read
 * through.
 *
 * Compose it into a worker kind's `uses` and every seat of that kind gains one
 * tool: `discover`, which answers what is in scope for it right now. The
 * capability installs the workforce's own two domains (seats and channels,
 * projected from the declared roster (files, and when asked the durable hired
 * roster) joined to FIX-1405's live inventory rows —
 * see `./manifest-sources`) and carries whatever other domains the app hands
 * it, so there is ONE registration point and one door rather than a second
 * registry per package.
 *
 * ## What is a fence and what is a choice
 *
 * The **registry** is the fence, built once here from the sources the app
 * declared. It is the complete set of domains any seat of this kind can reach,
 * and a domain that is not in it cannot be reached by naming it (BP-031).
 *
 * A **seat's own file** narrows that with `discover:` — a choice, resolved per
 * turn, that can only subtract. See `./seat-discovery`.
 *
 * The door is a `controlTool` rather than a catalog grant: a seat holds it
 * because its kind composed this capability at all, so there is nothing for a
 * `tools:` fence to check, and fencing it would leave a seat advertising a tool
 * in its prompt it cannot call.
 *
 * ## What changed
 *
 * The `agents` option is **gone**. It took a pre-built `Agent[] | AgentRegistry`
 * for a DevTool listing that never shipped, and the function's whole body was a
 * duplicate-name check over it plus a standing `TODO`. An app passing it now
 * fails to type-check with a message naming the replacement, rather than having
 * its roster silently ignored (BP-030). Pass `roster` and `inventory` instead;
 * the capability reads both.
 */

import { createManifestRegistry, defineCapability, discoveryTools } from "@flow-state-dev/core";
import type {
  BlockManifestSource,
  DefinedCapability,
  ManifestDomain,
  ManifestRegistry,
} from "@flow-state-dev/core";
import type { BlockContext } from "@flow-state-dev/core/types";
import {
  workforceManifestSources,
  type DeclaredWorkforce,
  type InventoryKeys,
} from "./manifest-sources";
import { narrowToSeatSelection, seatDiscoverSelection } from "./seat-discovery";

export interface WorkforceCapabilityOptions {
  /**
   * What the tree declared, resolved at boot — `readDeclaredRoster(...)`'s
   * result passes straight in.
   *
   * Read here rather than on the discover path: `readDeclaredRoster` is a
   * synchronous filesystem tree walk, and the door sits behind a tool a model
   * may call on every step.
   */
  roster: DeclaredWorkforce;
  /**
   * Which resource-registry keys the live inventory collections are mounted
   * under, on the block that carries this capability.
   *
   * A domain with no key registers no source, and the door carries one domain
   * fewer — an ordinary state, not an error.
   */
  inventory: InventoryKeys;
  /**
   * Registry key for the durable hired roster. When set, Discover treats a
   * roster row with no file as the declared half for that seat, so a runtime
   * hire is visible on the same lookup Labs already use.
   */
  hiredRoster?: string;
  /**
   * Other domains' sources to put behind the same door — `skillsManifestSource()`
   * from `@flow-state-dev/orchestration`, `resourcesManifestSource()` from
   * `@flow-state-dev/core`.
   *
   * Here rather than in a second capability because a model should have one
   * place to ask. Two sources claiming one domain are refused at construction,
   * naming both sites.
   */
  sources?: readonly BlockManifestSource[];
  /**
   * Removed (FIX-817). The pre-built roster this took never reached a caller —
   * the capability validated duplicate names, returned an empty capability and
   * carried a standing `TODO`.
   *
   * Typed as its own replacement message rather than deleted, so an app that
   * still passes it is told what to pass instead. Deleting the key would rely
   * on excess-property checking, which says only that the key is unknown —
   * and says nothing at all when the options are built up in a variable
   * (BP-030).
   *
   * @deprecated Pass `roster` and `inventory` instead.
   */
  agents?: "`agents` was removed: pass `roster` (the declared roster) and `inventory` (the live inventory collection keys) instead";
  /**
   * Removed (FIX-817). Nothing ever read it.
   *
   * @deprecated Tool catalogs reach a worker kind through
   * `defineAgentWorkerFlow({ catalog })`.
   */
  catalog?: "`catalog` was removed: it was never read. A tool catalog reaches a worker kind through defineAgentWorkerFlow({ catalog })";
}

/**
 * Build the workforce discovery capability.
 *
 * @param options The boot-resolved roster, the inventory keys, and any other
 *   domains' sources to put behind the same door.
 * @returns A capability named `workforce`, contributing the `discover` control
 *   tool and nothing else.
 * @throws when two sources claim the same domain, naming both registration
 *   sites — at construction, not at the first ambiguous read.
 */
export function createWorkforceCapability(
  options: WorkforceCapabilityOptions,
): DefinedCapability {
  // One registration point (tenet 5). The workforce's own two domains and the
  // app's go into the same call, so a duplicate is refused in one place with
  // both sites named rather than discovered when a seat asks.
  const registry: ManifestRegistry = createManifestRegistry([
    ...workforceManifestSources({
      roster: options.roster,
      inventory: options.inventory,
      hiredRoster: options.hiredRoster,
    }),
    ...(options.sources ?? []),
  ]);

  // One door per distinct narrowing, built the first time a seat asks for it.
  //
  // The resolver below runs on every render of the generator's bindings — once
  // before each step of a tool loop — and a registry is immutable, so what it
  // would build is the same object every time. A roster has few distinct
  // `discover:` lists, so this is bounded by the kind rather than by traffic.
  // It caches the TOOL, never a domain's entries: a source is still called on
  // every `discover`, which is what "projected when asked" means.
  const doors = new Map<string, ReturnType<typeof discoveryTools>["discover"]>();
  const doorFor = (selection: readonly ManifestDomain[] | undefined) => {
    // Sorted, because the key stands for a SET: a kind that writes
    // `discover: [seats, channels]` and one that writes `[channels, seats]`
    // narrow to the same door, and an order-sensitive key would build and hold
    // a second identical `discoveryTools` instance for the same scope.
    const key = selection === undefined ? "*" : [...selection].sort().join(",");
    let door = doors.get(key);
    if (door === undefined) {
      door = discoveryTools(narrowToSeatSelection(registry, selection)).discover;
      doors.set(key, door);
    }
    return door;
  };

  return defineCapability({
    name: "workforce",
    presets: {
      /**
       * The door itself. On by default — composing this capability IS the
       * declaration that a seat may ask what is around it, so there is nothing
       * for a second switch to add. It is declared as a preset because that is
       * the only slot a capability has for a tool; an app that wants the
       * sources installed and the tool withheld turns it off here.
       */
      door: {
        // Resolved per execution because the narrowing is per SEAT: a kind is
        // built once and hired many times, so a seat's `discover:` cannot be
        // read where the registry is built. The work is one config read and a
        // map lookup — no source is touched until the model calls the tool.
        //
        // A CONTROL rather than a catalog grant (FIX-1393): a seat holds it
        // because its kind composed this capability, so there is nothing for a
        // `tools:` fence to check, and fencing it would leave the seat
        // advertising a tool in its prompt that it cannot call.
        controlTools: (ctx) => [doorFor(seatDiscoverSelection(ctx as unknown as BlockContext))],
      },
      default: ["door"],
    },
  });
}
