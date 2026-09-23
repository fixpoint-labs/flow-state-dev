/**
 * Manifest entries (FIX-817) — the one record every discovery domain projects
 * into, and the type of a source that produces them for one domain.
 *
 * An orchestrator that has to decide *who does this* asks one door what is in
 * scope for it right now. Seats, channels, skills and resources already have
 * working readers; what they lacked is a shared shape to answer in. This is
 * that shape and nothing more: identity, what kind of thing it is, what it is
 * for, and an optional hint at how to work with it.
 *
 * Lives in the zero-dependency contracts layer because three packages project
 * into it (`core`, `orchestration`, `workforce`) and none of them should have
 * to depend on another to agree on the record. `core` re-exports every symbol
 * here, so consumers keep importing from `@flow-state-dev/core`.
 *
 * A manifest entry is **projected when asked** — no row is written anywhere,
 * and no source stores a second copy of its domain's state.
 *
 * Not to be confused with `ResourceManifest` (client-facing, flow-static) or
 * `WorkerManifest` / `ChannelManifest` (on-disk records). Those keep the bare
 * word; this surface only ever says "manifest entry".
 */

/**
 * The domains the door answers for, in the order a caller sees them.
 *
 * Pinned and model-facing: these strings appear in a tool argument and in a
 * seat's own file, so renaming one breaks prompts and files on disk. Four, not
 * six — a generator already gets its tool list from its provider, and what
 * another seat can do belongs on that seat's entry.
 */
export const MANIFEST_DOMAINS = ["seats", "channels", "skills", "resources"] as const;

/** One of the four pinned discovery domains. */
export type ManifestDomain = (typeof MANIFEST_DOMAINS)[number];

/** True when `value` is one of the pinned domain names. */
export function isManifestDomain(value: string): value is ManifestDomain {
  return (MANIFEST_DOMAINS as readonly string[]).includes(value);
}

/**
 * One thing an agent could plan against.
 *
 * `purpose` is the field the choice actually gets made on, so it is required
 * and worth writing well — an entry reading "does engineering things" will not
 * get picked over one that says what it does. `contract` is the optional
 * deeper half (how to work with this thing), withheld from a thin read so a
 * catalog stays cheap on every call.
 *
 * An entry says a thing was **registered or declared**. It does not promise
 * the thing is open, running or still there; a caller confirms that the same
 * way it would without a catalog.
 */
export type ManifestEntry = {
  /** Stable identifier the caller uses to act on this thing. */
  id: string;
  /** What kind of thing this is within its domain — `"seat"`, `"resource"`, … */
  kind: string;
  /** One line saying what it is for. What an agent chooses on. */
  purpose: string;
  /** Optional hint at how to work with it. Returned only on a detailed read. */
  contract?: string;
};

/**
 * A projection of one domain's existing reader into manifest entries.
 *
 * `entries` is computed at call time from the caller's context — a source
 * holds no state and caches nothing, so what an agent reads is what the
 * domain's reader says at the moment it asks.
 *
 * Generic over the context type: this layer is zero-dependency and node-free,
 * so it does not know `BlockContext`. `core` binds it.
 *
 * A source does not know how many tools sit in front of it. Whether the door
 * is one tool taking a domain or a family of per-domain tools is a decision
 * above this type, and either answer reads the same source.
 */
export type ManifestSource<TCtx = unknown> = {
  /** The single domain this source answers for. */
  domain: ManifestDomain;
  /**
   * Where this source was registered from, e.g. `"createWorkforceCapability"`.
   * Used to name both sites when two sources claim one domain.
   */
  origin?: string;
  /** Project this domain's reader into entries. Called on every read. */
  entries: (ctx: TCtx) => ManifestEntry[] | Promise<ManifestEntry[]>;
};
