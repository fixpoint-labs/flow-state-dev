/**
 * How `createFlowState({ kits })` installs kits.
 *
 * Two halves, split by when they can run:
 *
 * - {@link planKits}, at construction and synchronous: order the kits by
 *   `requires` (any listed order), resolve each kit's folder, and merge every
 *   slot from what the kits that require its owner contribute, then from the
 *   app's own `fill`. Contributions run dependents first, so a kit's
 *   `contributes` reads its own slots already filled. Everything wrong here throws one
 *   `FlowStateConfigError` naming each problem, as a duplicate flow id does.
 * - {@link installKits}, at start-up: read every kit's folder through the
 *   claim pass, refuse the app if any entry was left unused (every one named,
 *   all at once), then run each install in order and hand back its flows.
 *
 * Every contribution is merged before any install runs, so a kit's install
 * receives its own slots fully filled by the kits that require it, as its
 * `contributes` did.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FlowInstance, KitInstance, SlotDeclaration } from "@flow-state-dev/core";
import { FlowStateConfigError } from "../errors/flow-error";
import { openKitFolder } from "../folder/claim";

/** What construction settled about the kits, for start-up to install. */
export interface KitPlan {
  /** The kits in install order: each after every kit it requires, ties in listed order. */
  readonly order: readonly KitInstance[];
  /** Each declared slot's merged entries, by slot key. */
  readonly slots: ReadonlyMap<string, unknown>;
  /** Each folder-owning kit's folder, by kit name, spelled as given (absolute or against the working directory). */
  readonly folders: ReadonlyMap<string, string>;
}

/** What `check` returns for an entry its slot's schema refused. */
const NOT_PARSED = Symbol("not parsed");

/** The app's root as a directory path, spelled as given: a path, or a URL such as `import.meta.url`. */
function rootPath(root: string | URL | undefined): string {
  if (root === undefined) return process.cwd();
  if (root instanceof URL || root.startsWith("file:")) return fileURLToPath(new URL(".", root));
  // As written: a `..` in it reaches the root check unnormalized.
  return root;
}

function refuse(problems: readonly string[]): never {
  throw new FlowStateConfigError(
    problems.length === 1
      ? `createFlowState: ${problems[0]}`
      : `createFlowState: the kits can't be installed:\n${problems.map((problem) => `  - ${problem}`).join("\n")}`,
  );
}

/** Order kits so each installs after the kits it requires; ties keep the app's order. */
function orderKits(kits: readonly KitInstance[]): KitInstance[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const kit of kits) {
    if (names.has(kit.kitName)) problems.push(`kit "${kit.kitName}" is listed twice; a kit installs once per app.`);
    names.add(kit.kitName);
  }
  for (const kit of kits) {
    for (const needed of kit.definition.requires ?? []) {
      if (!names.has(needed.kitName)) {
        problems.push(`kit "${kit.kitName}" requires kit "${needed.kitName}", which is not installed.`);
      }
    }
  }
  if (problems.length > 0) refuse(problems);

  const ordered: KitInstance[] = [];
  const placed = new Set<string>();
  const pending = [...kits];
  while (pending.length > 0) {
    const next = pending.findIndex((kit) => (kit.definition.requires ?? []).every((needed) => placed.has(needed.kitName)));
    if (next < 0) {
      refuse([`kits require each other: ${pending.map((kit) => `"${kit.kitName}"`).join(", ")}.`]);
    }
    const [kit] = pending.splice(next, 1);
    ordered.push(kit!);
    placed.add(kit!.kitName);
  }
  return ordered;
}

/** Every kit `kit` requires, directly or through another. */
function requiredBy(kit: KitInstance, byName: ReadonlyMap<string, KitInstance>): Set<string> {
  const reached = new Set<string>();
  const visit = (current: KitInstance) => {
    for (const needed of current.definition.requires ?? []) {
      if (reached.has(needed.kitName)) continue;
      reached.add(needed.kitName);
      const next = byName.get(needed.kitName);
      if (next !== undefined) visit(next);
    }
  };
  visit(kit);
  return reached;
}

/**
 * Settle what can be settled before start-up. Throws `FlowStateConfigError`
 * naming every problem with the list or its slots.
 */
export function planKits(
  kits: readonly KitInstance[],
  appFill: Readonly<Record<string, unknown>> | undefined,
  root: string | URL | undefined,
): KitPlan {
  const order = orderKits(kits);
  const byName = new Map(order.map((kit) => [kit.kitName, kit]));
  const problems: string[] = [];

  const declared = new Map<string, { owner: string; slot: SlotDeclaration }>();
  for (const kit of order) {
    for (const [name, declaration] of Object.entries((kit.definition.slots ?? {}) as Record<string, SlotDeclaration>)) {
      declared.set(`${kit.kitName}.${name}`, { owner: kit.kitName, slot: declaration });
    }
  }

  /** One contribution waiting for its slot's owner: who gave it, where they install, what they gave. */
  interface Pending {
    from: string;
    rank: number;
    value: unknown;
    /** Keys of a keyed slot the app dropped from this contribution. */
    dropped: ReadonlySet<string>;
  }
  const pending = new Map<string, Pending[]>();

  /** Record a contribution, refusing one to an undeclared slot or from a kit that doesn't require its owner. */
  const record = (key: string, contribution: Pending, requires: Set<string> | null) => {
    const target = declared.get(key);
    if (target === undefined) {
      problems.push(`${contribution.from} fills slot "${key}", which no installed kit declares.`);
      return;
    }
    if (requires !== null && !requires.has(target.owner)) {
      problems.push(`${contribution.from} fills slot "${key}", but does not require kit "${target.owner}", which declares it.`);
      return;
    }
    pending.set(key, [...(pending.get(key) ?? []), contribution]);
  };

  /** Merge every contribution to one slot, in install order, the app's last. */
  const merge = (key: string): unknown => {
    const { slot } = declared.get(key)!;
    const given = [...(pending.get(key) ?? [])].sort((a, b) => a.rank - b.rank);
    /** The entry as the slot's schema parsed it (defaults, coercions), or `NOT_PARSED`. */
    const check = (entry: unknown, from: string, label: string): unknown => {
      const parsed = slot.schema.safeParse(entry);
      if (parsed.success) return parsed.data;
      problems.push(`slot "${key}": ${from} gave ${label} its schema refuses: ${parsed.error.issues.map((issue) => issue.message).join("; ")}.`);
      return NOT_PARSED;
    };
    if (slot.kind === "list") {
      const list: unknown[] = [];
      for (const { from, value } of given) {
        for (const entry of Array.isArray(value) ? value : [value]) {
          const parsed = check(entry, from, "an entry");
          if (parsed !== NOT_PARSED) list.push(parsed);
        }
      }
      return list;
    }
    // No prototype: an entry keyed `__proto__` must be an own key, not a
    // call to the inherited setter that drops it from `Object.keys`.
    const into: Record<string, unknown> = Object.create(null);
    const keyedBy = new Map<string, string>();
    for (const { from, value, dropped } of given) {
      // A record gives its keys; a list of entries is keyed by each entry's `id`.
      let entries: [string, unknown][];
      if (Array.isArray(value)) {
        const unkeyed = value.filter((entry) => typeof (entry as { id?: unknown } | null)?.id !== "string");
        if (unkeyed.length > 0) {
          problems.push(`slot "${key}" is keyed, but ${from} gave it an entry with no string \`id\` to key it by.`);
          continue;
        }
        entries = value.map((entry) => [(entry as { id: string }).id, entry]);
      } else if (typeof value === "object" && value !== null) {
        entries = Object.entries(value);
      } else {
        problems.push(`slot "${key}" is keyed, but ${from} gave it something other than a record or a list of entries.`);
        continue;
      }
      for (const [entryKey, entry] of entries) {
        if (dropped.has(entryKey)) continue;
        const earlier = keyedBy.get(entryKey);
        if (earlier !== undefined) {
          problems.push(`slot "${key}": the key "${entryKey}" is filled by ${earlier} and by ${from}.`);
          continue;
        }
        const parsed = check(entry, from, `the entry "${entryKey}"`);
        if (parsed === NOT_PARSED) continue;
        keyedBy.set(entryKey, from);
        into[entryKey] = parsed;
      }
    }
    return into;
  };

  for (const [key, value] of Object.entries(appFill ?? {})) {
    record(key, { from: "the app", rank: Number.POSITIVE_INFINITY, value, dropped: new Set() }, null);
  }

  // Dependents first: a kit's slots are filled only by kits that require it,
  // which install after it, so walking the install order backwards finishes
  // each kit's slots before its own `contributes` reads them.
  const slots = new Map<string, unknown>();
  for (let rank = order.length - 1; rank >= 0; rank--) {
    const kit = order[rank]!;
    const own: Record<string, unknown> = Object.create(null);
    for (const name of Object.keys(kit.definition.slots ?? {})) {
      const key = `${kit.kitName}.${name}`;
      const merged = merge(key);
      slots.set(key, merged);
      own[name] = merged;
    }
    if (kit.definition.contributes === undefined) continue;
    const requires = requiredBy(kit, byName);
    const given = kit.definition.contributes({ config: kit.config, slots: own as never });
    for (const [key, value] of Object.entries(given)) {
      const withheld = kit.withheld.filter((entry) => entry.slot === key);
      if (withheld.some((entry) => entry.key === undefined)) continue;
      const dropped = new Set(withheld.map((entry) => entry.key!));
      record(key, { from: `kit "${kit.kitName}"`, rank, value, dropped }, requires);
    }
  }

  const base = rootPath(root);
  const folders = new Map<string, string>();
  const folderOwner = new Map<string, string>();
  for (const kit of order) {
    const directory = kit.definition.directory;
    if (directory === undefined) continue;
    // The kit's default reads against the app's root; a path the app typed
    // into config reads as any path a user gives does, against the working
    // directory.
    // `spelled` keeps the path as written for the root check, which refuses a
    // `..` stepping back through an earlier segment (a linked one would send
    // the kernel elsewhere); `absolute` is normalized only to compare folders.
    const spelled =
      kit.directory !== undefined
        ? kit.directory
        : path.isAbsolute(directory.path)
          ? directory.path
          : `${base}${path.sep}${directory.path}`;
    const absolute = path.resolve(spelled);
    const other = folderOwner.get(absolute);
    if (other !== undefined) {
      problems.push(`kits "${other}" and "${kit.kitName}" both read the folder "${absolute}"; each kit owns its own.`);
      continue;
    }
    folderOwner.set(absolute, kit.kitName);
    folders.set(kit.kitName, spelled);
  }

  if (problems.length > 0) refuse(problems);
  return { order, slots, folders };
}

/**
 * Read every kit's folder, then install every kit, in order. Rejects with one
 * `FlowStateConfigError` naming every refused entry, across every kit, before
 * any install runs.
 */
export async function installKits(plan: KitPlan): Promise<FlowInstance<any, any>[]> {
  const read = new Map<string, unknown>();
  const problems: string[] = [];
  for (const kit of plan.order) {
    const folder = plan.folders.get(kit.kitName);
    if (folder === undefined) continue;
    const what = `folder of kit "${kit.kitName}"`;
    try {
      const opened = await openKitFolder(folder, what);
      read.set(kit.kitName, await kit.definition.directory!.read(opened.folder, { config: kit.config }));
      for (const report of await opened.unclaimed()) {
        problems.push(`kit "${kit.kitName}": ${report.error.message} (${folder})`);
      }
    } catch (err) {
      problems.push(`kit "${kit.kitName}": ${(err as Error).message}`);
    }
  }
  if (problems.length > 0) {
    throw new FlowStateConfigError(
      `createFlowState: the app can't start; a kit's folder was refused:\n` +
        problems.map((problem) => `  - ${problem}`).join("\n"),
    );
  }

  const flows: FlowInstance<any, any>[] = [];
  for (const kit of plan.order) {
    const own = Object.fromEntries(
      Object.keys(kit.definition.slots ?? {}).map((name) => [name, plan.slots.get(`${kit.kitName}.${name}`)]),
    );
    const installed = await kit.definition.install({ config: kit.config, folder: read.get(kit.kitName), slots: own as never });
    flows.push(...installed.flows);
  }
  return flows;
}
