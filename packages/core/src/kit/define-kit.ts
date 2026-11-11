/**
 * `defineKit`: the installable unit above a flow.
 *
 * A kit packages a feature so an app installs it with one config object:
 * `createFlowState({ kits: [workforce({ model }), harnesses({})] })`. It
 * declares what it needs (`config`, the kits it `requires`), the typed places
 * other kits fill (`slots`), what it fills in the kits it requires
 * (`contributes`), an optional folder it owns in the app (`directory`), and an
 * `install` that returns the flows it serves. It composes existing pieces:
 * resources, views and capabilities ride on the flows the install returns.
 *
 * This module only defines. Ordering kits by `requires`, merging slots, reading
 * folders and registering flows are the engine's (`createFlowState({ kits })`),
 * so nothing here imports Node: a kit's definition is safe to import anywhere,
 * and only its folder reader, which a kit's server entry supplies, touches the
 * file system.
 */
import type { z } from "zod";
import type { FlowInstance } from "../types/flow";
import { segmentNameProblem } from "../helpers/segment-name";

/**
 * A slot that holds entries by key. Each contributor gives a record of
 * entries, or entries (one, or an array) that each carry a string `id`, which
 * is then the key. Two contributors giving one key is refused, naming both.
 */
export interface KeyedSlot<T = unknown> {
  readonly kind: "keyed";
  /** Every entry contributed is checked against it. */
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
}

/**
 * A slot that holds a list. Contributions append in install order (each
 * kit's `requires` first, ties in the app's listed order), the app's last.
 */
export interface ListSlot<T = unknown> {
  readonly kind: "list";
  /** Every entry contributed is checked against it. */
  readonly schema: z.ZodType<T, z.ZodTypeDef, unknown>;
}

/** A slot a kit declares: keyed or list. */
export type SlotDeclaration<T = unknown> = KeyedSlot<T> | ListSlot<T>;

/** What a kit's `install` receives for one slot: the merged entries. */
export type SlotValue<S> =
  S extends KeyedSlot<infer T> ? Readonly<Record<string, T>> : S extends ListSlot<infer T> ? readonly T[] : never;

/**
 * The key a contribution to one slot goes under: `<kit>.<slot>`, read from
 * the owning kit's factory (`workforce.slots.workerFlows`) rather than spelled.
 */
export type SlotKey<S extends SlotDeclaration = SlotDeclaration> = string & { readonly __slot?: S };

/** The two slot shapes, each with the schema its entries are checked against. */
export const slot = {
  /** A slot of entries by key; a key given twice is refused, naming both contributors. */
  keyed<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>): KeyedSlot<T> {
    return { kind: "keyed", schema };
  },
  /** A slot of entries in a list, appended in install order, the app's last. */
  list<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>): ListSlot<T> {
    return { kind: "list", schema };
  },
} as const;

/**
 * The folder a kit owns, as its reader sees it.
 *
 * Every entry in it is used or refused: the reader claims what it consumed,
 * and anything left unclaimed (except the names that never mean anything,
 * such as `.DS_Store`) stops the app starting, each named. The engine builds
 * this; a kit's reader only reads `path` and calls `claim`.
 */
export interface KitFolder {
  /** The folder's absolute path. */
  readonly path: string;
  /**
   * Mark a file or directory as used, by its slash-separated path relative to
   * the folder (`"teams"`, `"teams/eng/team.md"`). Claiming a directory claims
   * everything under it; `"."` claims the whole folder. A symlink is refused
   * wherever it is, claimed or not.
   */
  claim(relativePath: string): void;
}

/** The config a kit's factory takes: its schema's input, or nothing. */
type ConfigInput<C> = C extends z.ZodTypeAny ? z.input<C> : { readonly [key: string]: never };
/** The factory argument: the config, plus the app's `directory` for the kit's folder. */
type FactoryInput<C> = C extends z.ZodTypeAny ? z.input<C> & { readonly directory?: string } : { readonly directory?: string };
/** The config a kit's own functions receive: its schema's output, or `{}`. */
type ConfigOutput<C> = C extends z.ZodTypeAny ? z.output<C> : Record<string, never>;

/** What an `install` returns: the flows the kit serves. */
export interface KitInstallation {
  readonly flows: readonly FlowInstance<any, any>[];
}

/** What a kit's `install` is handed. */
export interface KitInstallInput<Config, Folder, Slots> {
  /** The kit's config, as its schema parsed it. */
  readonly config: Config;
  /** What the kit's `directory.read` returned; `undefined` when it owns no folder. */
  readonly folder: Folder;
  /** Each declared slot's merged entries. */
  readonly slots: { readonly [K in keyof Slots]: SlotValue<Slots[K]> };
}

/** The definition `defineKit` takes. */
export interface KitDefinition<
  Name extends string = string,
  ConfigSchema extends z.ZodTypeAny | undefined = z.ZodTypeAny | undefined,
  Slots extends Record<string, SlotDeclaration> = Record<string, SlotDeclaration>,
  Folder = unknown,
> {
  /** The kit's name: lowercase letters, digits and single hyphens, unique in an app. */
  readonly name: Name;
  /** The schema the factory checks its config against. Omitted: the kit takes none. */
  readonly config?: ConfigSchema;
  /** The kits this one installs after, and may fill the slots of (directly or through another). */
  readonly requires?: readonly AnyKitFactory[];
  /** The slots this kit declares, by name. Only a kit that requires it can fill them. */
  readonly slots?: Slots;
  /**
   * What this kit puts in the slots of the kits it requires, by slot key:
   * `{ [workforce.slots.workerFlows]: { coder: coderFlow(config) } }` for a
   * keyed slot (or entries carrying an `id`), an entry or an array of them for
   * a list slot.
   *
   * Runs after every kit that requires this one has contributed, so `slots`
   * holds this kit's own slots fully filled, the app's `fill` included.
   */
  readonly contributes?: (input: {
    readonly config: ConfigOutput<ConfigSchema>;
    readonly slots: { readonly [K in keyof Slots]: SlotValue<Slots[K]> };
  }) => Readonly<Record<string, unknown>>;
  /**
   * The folder this kit owns in the app. `path` is its default, read against
   * the app's root; an app overrides it with `directory` in the kit's config,
   * read against the working directory. `read` is the kit's reader, and runs
   * on the server at start-up.
   */
  readonly directory?: {
    readonly path: string;
    readonly read: (folder: KitFolder, input: { readonly config: ConfigOutput<ConfigSchema> }) => Folder | Promise<Folder>;
  };
  /** Builds the flows the kit serves, from its config, its folder and its slots. */
  readonly install: (
    input: KitInstallInput<ConfigOutput<ConfigSchema>, Folder, Slots>,
  ) => KitInstallation | Promise<KitInstallation>;
}

/** One installed kit, as `createFlowState({ kits })` takes it: a factory called with its config. */
export interface KitInstance {
  /** The kit's name. */
  readonly kitName: string;
  /** The definition the factory was made from. */
  readonly definition: KitDefinition<string, any, any, any>;
  /** The config, as the kit's schema parsed it. */
  readonly config: unknown;
  /** The folder path the app gave in config, read against the working directory; `undefined` for the kit's default. */
  readonly directory: string | undefined;
  /** What this instance's contributions are withheld from: a whole slot, or one key of a keyed slot. */
  readonly withheld: readonly KitWithheld[];
  /**
   * The same kit with its contribution to `slot` dropped, or only the entry
   * under `key` when the slot is keyed (`harnesses().without(workforce.slots.workerFlows, "coder")`).
   */
  without(slot: SlotKey, key?: string): KitInstance;
}

/** One contribution an app dropped from a kit: a slot, or one key in it. */
export interface KitWithheld {
  readonly slot: string;
  /** Set when only this entry of a keyed slot is dropped. */
  readonly key?: string;
}

/**
 * A kit's factory: call it with the kit's config to install it. The config
 * may also carry `directory`, the app's path for the kit's folder, read
 * against the working directory; a kit that owns no folder refuses it.
 */
export type KitFactory<
  Name extends string = string,
  ConfigSchema extends z.ZodTypeAny | undefined = z.ZodTypeAny | undefined,
  Slots extends Record<string, SlotDeclaration> = Record<string, SlotDeclaration>,
> = ((
  ...config: {} extends ConfigInput<ConfigSchema>
    ? [config?: FactoryInput<ConfigSchema>]
    : [config: FactoryInput<ConfigSchema>]
) => KitInstance) & {
  /** The kit's name. */
  readonly kitName: Name;
  /** The key a contribution to each of this kit's slots goes under. */
  readonly slots: { readonly [K in keyof Slots]: SlotKey<Slots[K]> };
};

/** Any kit factory, for `requires`. */
export type AnyKitFactory = { readonly kitName: string; readonly slots: Readonly<Record<string, string>> };

/**
 * Define a kit. Returns its factory: the app calls it with the kit's config
 * and lists the result in `createFlowState({ kits })`, in any order.
 *
 * Throws when the name breaks the naming rule (it is half of every slot key,
 * joined with a `.`), and, from the factory, when the config fails the kit's
 * schema or names a `directory` for a kit that owns no folder.
 */
export function defineKit<
  const Name extends string,
  ConfigSchema extends z.ZodTypeAny | undefined = undefined,
  Slots extends Record<string, SlotDeclaration> = {},
  Folder = undefined,
>(
  definition: KitDefinition<Name, ConfigSchema, Slots, Folder>,
): KitFactory<Name, ConfigSchema, Slots> {
  const problem = segmentNameProblem(definition.name);
  if (problem !== undefined) {
    throw new Error(
      `defineKit: kit name "${definition.name}" must be lowercase letters, digits and single hyphens, ` +
        `at most 64 characters and not a reserved name (${problem}): it is half of every slot key, joined with a ".".`,
    );
  }

  const keys = Object.fromEntries(
    Object.keys(definition.slots ?? {}).map((name) => [name, `${definition.name}.${name}`]),
  );

  const instance = (config: unknown, directory: string | undefined, withheld: readonly KitWithheld[]): KitInstance => ({
    kitName: definition.name,
    definition: definition as KitDefinition<string, any, any, any>,
    config,
    directory,
    withheld,
    without: (slotKey, key) => instance(config, directory, [...withheld, key === undefined ? { slot: slotKey } : { slot: slotKey, key }]),
  });

  const factory = (given?: Record<string, unknown>): KitInstance => {
    const { directory, ...rest } = given ?? {};
    if (directory !== undefined && definition.directory === undefined) {
      throw new Error(`kit "${definition.name}": \`directory\` is set, but this kit owns no folder.`);
    }
    if (directory !== undefined && typeof directory !== "string") {
      throw new Error(`kit "${definition.name}": \`directory\` must be a path.`);
    }
    let config: unknown = {};
    if (definition.config !== undefined) {
      const parsed = definition.config.safeParse(rest);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(config)"}: ${issue.message}`)
          .join("; ");
        throw new Error(`kit "${definition.name}": its config is invalid: ${issues}`);
      }
      config = parsed.data;
    } else if (Object.keys(rest).length > 0) {
      throw new Error(
        `kit "${definition.name}" takes no config, but was given ${Object.keys(rest).map((key) => `"${key}"`).join(", ")}.`,
      );
    }
    return instance(config, directory, []);
  };

  return Object.assign(factory, {
    kitName: definition.name,
    slots: keys,
  }) as never;
}
