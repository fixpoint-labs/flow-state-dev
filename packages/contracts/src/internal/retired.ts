/**
 * The retired-name helper: one table per package, one error, one message.
 *
 * A package that retires a name a published version accepted or wrote keeps it
 * in its one table (`packages/<pkg>/src/retired.ts`), built with
 * {@link retiredNames}. Each entry names what replaces the old name and the
 * version of the package that removes the entry (`removeIn`, at least two
 * minors past the first version that refuses it). Entry points look names up in
 * the table: {@link refuseRetired} for an option key, {@link refuseRetiredValue}
 * for a value, {@link readRetired} for a stored value a published version wrote,
 * which reads as its replacement.
 *
 * The vocabulary sweep reads the same tables and fails CI on an entry whose
 * `removeIn` is at or below its package's version, so an expiry cannot drift.
 *
 * Internal: for the framework's own packages, not adopters.
 */

/** A package version, `major.minor.patch`. */
export type RetiredVersion = `${number}.${number}.${number}`;

/** One retired name. */
export type RetiredEntry = {
  /** The version of the package that removes this entry, and with it the refusal. */
  readonly removeIn: RetiredVersion;
  /**
   * A stored value a published version wrote reads as this one
   * ({@link readRetired}). A new use is still refused.
   */
  readonly readAs?: string;
} & (
  | {
      /** What to write instead, as the message shows it: `"user_approval"`, `` `runner` ``. */
      readonly replacement: string;
      readonly drop?: never;
    }
  | {
      /** Why the name goes with nothing in its place. */
      readonly drop: string;
      readonly replacement?: never;
    }
);

/** A package's retired names, with the package they belong to. */
export interface RetiredTable<Name extends string = string> {
  readonly package: string;
  readonly entries: Readonly<Record<Name, RetiredEntry>>;
}

/**
 * Build a package's retired table. One per package, exported from its
 * `src/retired.ts` as `REFUSALS`.
 */
export function retiredNames<const Entries extends Record<string, RetiredEntry>>(
  pkg: string,
  entries: Entries
): RetiredTable<keyof Entries & string> {
  return { package: pkg, entries };
}

/** What a retired name was refused with. */
export class RetiredNameError extends Error {
  override name = "RetiredNameError";
  /** The retired name. */
  readonly retired: string;
  /** What replaces it, when something does. */
  readonly replacement: string | undefined;
  /** The package whose table holds it. */
  readonly package: string;
  /** The package version that removes this refusal. */
  readonly removeIn: RetiredVersion;

  /**
   * @param table - The package's retired table; it must hold `name`.
   * @param name - The retired name.
   * @param where - The entry point, as the message starts: `ctx.suspend`.
   * @param options - `subject` names what the value is (`reason`); `replacement`
   *   names this caller's own replacement in place of the entry's, when the
   *   entry point can spell it out (`"vercel:openai/gpt-6"` for one model string).
   */
  constructor(
    table: RetiredTable,
    name: string,
    where: string,
    options: { readonly subject?: string; readonly replacement?: string } = {}
  ) {
    const entry = entryOf(table, name)!;
    const replacement = options.replacement ?? entry.replacement;
    const instead = replacement !== undefined ? `Use ${replacement}.` : `Drop it: ${entry.drop}.`;
    super(
      `${where}: ${options.subject === undefined ? "" : `${options.subject} `}"${name}" was retired. ${instead} ` +
        `This refusal is removed in ${table.package} ${entry.removeIn}.`
    );
    this.retired = name;
    this.replacement = replacement;
    this.package = table.package;
    this.removeIn = entry.removeIn;
  }
}

function entryOf(table: RetiredTable, name: string): RetiredEntry | undefined {
  return Object.prototype.hasOwnProperty.call(table.entries, name)
    ? (table.entries as Record<string, RetiredEntry>)[name]
    : undefined;
}

/**
 * Throw {@link RetiredNameError} for the first key of `given` the table holds.
 * `only` narrows the lookup to some entries, for an entry point that accepts
 * just those.
 */
export function refuseRetired<Name extends string>(
  table: RetiredTable<Name>,
  given: object | null | undefined,
  where: string,
  only?: readonly Name[]
): void {
  if (given == null) return;
  for (const name of only ?? (Object.keys(table.entries) as Name[])) {
    if (name in given) throw new RetiredNameError(table, name, where);
  }
}

/**
 * Throw {@link RetiredNameError} when `value` is a name the table holds.
 * `subject` names what the value is (`reason`, `backing`); `only` narrows the
 * lookup to some entries, as for {@link refuseRetired}.
 */
export function refuseRetiredValue<Name extends string>(
  table: RetiredTable<Name>,
  value: unknown,
  where: string,
  subject?: string,
  only?: readonly Name[]
): void {
  if (typeof value !== "string" || (only !== undefined && !(only as readonly string[]).includes(value))) return;
  if (entryOf(table, value) !== undefined) {
    throw new RetiredNameError(table, value, where, { subject });
  }
}

/**
 * A stored value as the current version reads it: the entry's `readAs` when
 * the table holds one for it, else the value unchanged.
 */
export function readRetired<Value extends string>(table: RetiredTable, value: Value): Value | string {
  return entryOf(table, value)?.readAs ?? value;
}
