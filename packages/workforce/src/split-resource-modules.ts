/**
 * The install half of the code door — the generated `resourceModules` map
 * becomes the two things an app already passes: the capabilities its worker
 * kind `uses`, and the resources its flow declares.
 *
 * Sibling of `resources-from-docs.ts`, and pure and isomorphic for the same
 * reasons: no `node:fs`, no store, no registry. The two halves of one
 * `resources/` folder meet at the app's own call site, where the document map
 * and this one are spread into a single `resources` option — there is one
 * resource map, and a module's plain resource lands in it beside a Markdown
 * document's.
 *
 * It splits rather than installs. A capability has to reach a flow through the
 * worker kind's `uses`, because that is where a capability's own resources,
 * context and tools are resolved, while a plain resource reaches it through the
 * flow's resource map — two destinations, one folder. Returning both and
 * letting the app write the two lines keeps the wiring visible in the app's
 * source, which is the same bargain `resourcesFromDocs` makes.
 *
 * What a module exports is the app's own `tsc`'s to check, against the types
 * the generated map carries: nothing in either walk opens a module. This
 * function is the second door on that check rather than the first — a
 * `ResourceModules` map can be written by hand or left stale, and a value that
 * is not an object at all cannot be either half.
 *
 * **Where that second door stops.** It refuses what cannot be either half; it
 * does not re-judge which half a thing belongs in. An *object* that is neither
 * lands in the resource map and is refused, by ref, by `defineFlow` for having
 * no intrinsic scope. And a capability written in one worker's own folder is
 * the generated map's per-entry type to refuse, because saying so here would
 * mean re-deriving the ref grammar that `./loader/resource-convention` owns —
 * a second spelling of the one rule that names everything in this tree.
 */

import type { DeclaredResources, DefinedCapability } from "@flow-state-dev/core";
import { emptyMap } from "./empty-map";
import type { ResourceModules } from "./resource-modules";

/** The brand `defineCapability` stamps on what it returns. The one thing that tells the two halves apart at runtime. */
const CAPABILITY_BRAND = "Capability";

/** What a `resourceModules` map splits into — the two slots an app already has. */
export interface ResourceModuleHalves {
  /**
   * The capabilities, in the map's own order, for the worker kind's `uses`.
   *
   * A list rather than a map: `uses` takes refs, and a capability is addressed
   * by its own `name` from there on. Duplicates and name collisions are core's
   * to judge — it dedupes two paths to one capability and refuses two different
   * capabilities sharing a name — and a second ruling here would be a second
   * answer to one question.
   */
  capabilities: DefinedCapability[];
  /**
   * The plain resources, keyed by ref, to merge into the flow's resource map.
   *
   * Null-prototype, like the document half's, and spread into the app's own map
   * at the app's own call site.
   */
  resources: DeclaredResources;
}

/**
 * Split a generated `resourceModules` map into the capabilities a worker kind
 * installs and the resources a flow declares.
 *
 * ```ts
 * const { capabilities, resources } = splitResourceModules(resourceModules);
 *
 * const kind = defineAgentWorkerFlow({ uses: capabilities, ... });
 * const flowResources = { ...resourcesFromDocs(documents), ...resources };
 * ```
 *
 * **The two maps are spread by the app, in that order, and a ref in both is the
 * module's.** It cannot arise from a tree the command generated — a document
 * and a module of one name in one folder are refused by name at generation, and
 * refs are minted from the path by the one rule both doors share — so a
 * collision here means the generated module and the tree have drifted apart,
 * which is what `fsdev gen --check` exists to catch in CI.
 *
 * Throws, rather than collecting, when an entry cannot be either half. That is
 * startup misconfiguration, and it is the same line `resourcesFromDocs` draws:
 * the loader's collect-don't-throw discipline covers reading a tree, not
 * building from what was read.
 *
 * @param modules The generated map, keyed by ref.
 * @returns The capabilities, in map order, and the resources, keyed by ref.
 */
export function splitResourceModules(modules: ResourceModules): ResourceModuleHalves {
  const capabilities: DefinedCapability[] = [];
  const resources: DeclaredResources = emptyMap();

  for (const [ref, value] of Object.entries(modules)) {
    if (typeof value !== "object" || value === null) {
      throw new Error(
        `Resource module "${ref}" exports ${describe(value)}, not a capability or a resource — ` +
          `a TypeScript file in a resources/ folder default-exports one or the other`,
      );
    }

    if (isCapability(value)) {
      capabilities.push(value);
      continue;
    }

    resources[ref] = value;
  }

  return { capabilities, resources };
}

/**
 * Whether a module's export is a capability rather than a resource.
 *
 * Read off the brand `defineCapability` stamps, and read **through the
 * prototype chain** on purpose: `.presets()`, `.config()` and `.with()` each
 * return a clone made with `Object.create(base)`, so a capability an author
 * configured before exporting it carries the brand on its prototype and not as
 * an own property. An own-property check would file such a capability as a
 * resource, and the resource map would then hold a thing with no `ref` and no
 * `stateSchema`.
 *
 * Compared for **equality** rather than tested for presence, because a resource
 * collection carries a brand too (`"ResourceCollection"`) and belongs on the
 * resource side. `"__brand" in value` would put one in `uses`, where it would
 * be keyed by an undefined `name`.
 *
 * A plain resource has no brand of its own to test for — `defineResource`
 * returns the config it was given — so the capability side has to be the
 * positive case.
 */
function isCapability(value: object): value is DefinedCapability {
  return (value as { __brand?: unknown }).__brand === CAPABILITY_BRAND;
}

/** What a non-object export is, for the refusal to name. */
function describe(value: unknown): string {
  if (value === undefined) return "nothing";
  if (value === null) return "null";
  return `a ${typeof value}`;
}
