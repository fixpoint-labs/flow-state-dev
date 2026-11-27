/**
 * A rough kit, for the FIX-2622 proof only: `defineKit` (which would sit in
 * `core`, beside the other definers) and a `createFlowState` that takes
 * `kits` (which would be the `engine`'s own). Never shipped, never imported
 * outside the POC; `run.sh` copies it beside the lab's host for the run.
 *
 * What it does, and only that:
 *
 * - **Slots.** A kit declares named slots, each a keyed map (a duplicate key
 *   is refused) or a list (contributions append). The app and other kits
 *   contribute by the slot's key (`kit.slots.<name>`); a contribution to a
 *   slot no installed kit declares is refused.
 * - **Order.** Kits install in `requires` order; a missing requirement is refused.
 * - **The owned directory.** A kit may own one directory in the app, resolved
 *   against the app's `root`. A path the kit's config names instead is
 *   resolved against the working directory, as today's hosts read one. It is
 *   opened with the shared walk primitive (`openRoot`, standing in for the
 *   engine subpath it lifts to) and handed to the kit's own `load`.
 * - **Flows.** Each kit's install returns the flows it serves, and anything
 *   it publishes (`exports`), which `kit.exports()` reads after the install.
 *   Flow ids are merged with the app's own `flows`; a duplicate id is refused.
 */
import { isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { FlowInstance } from "@flow-state-dev/core/types";
import { createFlowState as createEngineFlowState } from "@flow-state-dev/engine";
import { openRoot } from "@flow-state-dev/workforce/loader";

/** How a slot merges what it is given. */
export type SlotMerge = "keyed" | "list";

/** What a kit's install is handed, and returns. */
export interface KitInstall<Config, Directory, Slots> {
  config: Config;
  /** What the kit's `directory.load` read, or `undefined` when it owns none. */
  directory: Directory;
  /** Each declared slot's merged contributions: a record for `keyed`, an array for `list`. */
  slots: Slots;
}

export interface KitSpec<Config, Directory, Slots extends Record<string, unknown>, Exports> {
  name: string;
  requires?: readonly { readonly kitName: string }[];
  slots?: { [K in keyof Slots]: SlotMerge };
  /** The directory the kit owns in the app, by its default path, and the kit's reader for it. */
  directory?: { path: string; load(root: string): Promise<Directory> };
  install(input: KitInstall<Config, Directory, Slots>): { flows: FlowInstance[]; exports: Exports };
}

/** One installed kit, as `createFlowState({ kits })` takes it. */
export interface KitInstance<Exports = unknown> {
  readonly kitName: string;
  /** What the kit's install published. Throws before the install has run. */
  exports(): Exports;
  /** @internal */
  readonly run: (root: string, slots: Map<string, unknown>) => Promise<FlowInstance[]>;
  /** @internal */
  readonly declares: Readonly<Record<string, SlotMerge>>;
  /** @internal */
  readonly needs: readonly string[];
}

/** A kit's factory: call it with its config to install it. */
export type KitFactory<Config, Slots, Exports> = ((config: Config & { directory?: string }) => KitInstance<Exports>) & {
  readonly kitName: string;
  /** The key a contribution to each slot is given under. */
  readonly slots: { readonly [K in keyof Slots]: string };
};

export function defineKit<Config, Directory, Slots extends Record<string, unknown>, Exports>(
  spec: KitSpec<Config, Directory, Slots, Exports>,
): KitFactory<Config, Slots, Exports> {
  const keys = Object.fromEntries(Object.keys(spec.slots ?? {}).map((name) => [name, `${spec.name}.${name}`])) as { [K in keyof Slots]: string };
  const declares = Object.fromEntries(Object.entries(spec.slots ?? {}).map(([name, merge]) => [`${spec.name}.${name}`, merge as SlotMerge]));
  const factory = (config: Config & { directory?: string }): KitInstance<Exports> => {
    let published: { value: Exports } | undefined;
    return {
      kitName: spec.name,
      declares,
      needs: (spec.requires ?? []).map((kit) => kit.kitName),
      exports: () => {
        if (published === undefined) throw new Error(`kit "${spec.name}": read before createFlowState installed it.`);
        return published.value;
      },
      run: async (root, slots) => {
        const { directory: chosen, ...own } = config;
        let directory: Directory = undefined as Directory;
        if (spec.directory !== undefined) {
          // The kit's own path is the app's; a path the app names in config is read as any other
          // path a user gives (an env var, a flag), against the working directory.
          const absolute = chosen !== undefined ? resolve(chosen) : isAbsolute(spec.directory.path) ? spec.directory.path : resolve(root, spec.directory.path);
          await openRoot(absolute);
          directory = await spec.directory.load(absolute);
        }
        const mine = Object.fromEntries(Object.keys(keys).map((name) => [name, slots.get(keys[name as keyof Slots])])) as Slots;
        const { flows, exports } = spec.install({ config: own as Config, directory, slots: mine });
        published = { value: exports };
        return flows;
      },
    };
  };
  return Object.assign(factory, { kitName: spec.name, slots: keys });
}

type EngineOptions = Parameters<typeof createEngineFlowState>[0];

export interface KitFlowStateOptions extends Omit<EngineOptions, "flows"> {
  kits: readonly KitInstance[];
  /** The app's folder, which a kit's directory is resolved against: `import.meta.url` works. */
  root: string | URL;
  /** The app's own contributions to the kits' slots, by slot key. */
  contributes?: Record<string, unknown>;
  /** The app's own flows, by id. */
  flows?: Record<string, FlowInstance>;
}

/** Merges one contribution into a slot, by its policy. */
function contribute(slots: Map<string, unknown>, merge: SlotMerge, key: string, value: unknown, from: string): void {
  if (merge === "list") {
    slots.set(key, [...((slots.get(key) as unknown[] | undefined) ?? []), ...(Array.isArray(value) ? value : [value])]);
    return;
  }
  const into = (slots.get(key) as Record<string, unknown> | undefined) ?? {};
  for (const [entry, item] of Object.entries(value as Record<string, unknown>)) {
    if (Object.hasOwn(into, entry)) throw new Error(`slot "${key}": "${entry}" is contributed twice (again by ${from}).`);
    into[entry] = item;
  }
  slots.set(key, into);
}

/** `createFlowState` with `kits`: orders, collects, installs, then hands the merged flows to the engine. */
export async function createFlowState(options: KitFlowStateOptions) {
  const { kits, root, contributes = {}, flows = {}, ...engine } = options;
  const rootPath = root instanceof URL || root.startsWith("file:") ? fileURLToPath(new URL(".", root)) : root;
  const ordered: KitInstance[] = [];
  const pending = [...kits];
  while (pending.length > 0) {
    const next = pending.findIndex((kit) => kit.needs.every((need) => ordered.some((done) => done.kitName === need)));
    if (next < 0) throw new Error(`kits: ${pending.map((kit) => `"${kit.kitName}" requires ${kit.needs.join(", ")}`).join("; ")}, which isn't installed.`);
    ordered.push(...pending.splice(next, 1));
  }
  const declared = new Map(ordered.flatMap((kit) => Object.entries(kit.declares)));
  const slots = new Map<string, unknown>();
  for (const [key, value] of Object.entries(contributes)) {
    const merge = declared.get(key);
    if (merge === undefined) throw new Error(`slot "${key}": no installed kit declares it.`);
    contribute(slots, merge, key, value, "the app");
  }
  const merged: Record<string, FlowInstance> = {};
  for (const kit of ordered) {
    for (const flow of await kit.run(rootPath, slots)) {
      if (Object.hasOwn(merged, flow.id)) throw new Error(`kits: flow "${flow.id}" is served twice (again by "${kit.kitName}").`);
      merged[flow.id] = flow;
    }
  }
  for (const [id, flow] of Object.entries(flows)) {
    if (Object.hasOwn(merged, id)) throw new Error(`kits: flow "${id}" is served by a kit and by the app.`);
    merged[id] = flow;
  }
  return createEngineFlowState({ ...engine, flows: merged } as EngineOptions);
}
