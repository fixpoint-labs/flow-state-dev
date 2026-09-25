/**
 * What ONE seat picks up from the capabilities its kind carries.
 *
 * A kind installs capabilities once, for every seat of that kind — that is
 * what `uses` is and this file does not change it. What it adds is the other
 * half a `resources/` folder needs: a worker's own file naming which of those
 * capabilities' presets *this* seat wants, so two seats of one kind can differ
 * by what their own files say.
 *
 * **A seat adds; it never takes away.** A file that names nothing carries
 * exactly what the kind installed, which is what every seat gets today. A file
 * that names a preset carries that preset on top. There is no spelling that
 * removes one — an app that wants a capability quieter for some seats turns it
 * down where it installs it, because what a workforce *may* do is the app's
 * call and a file a team edits is not where that is decided.
 *
 * ## Why the selection is resolved per turn and the install is not
 *
 * A kind is built once and hired many times: one block graph, one `uses`
 * array, one settings schema, and a config bag per seat. So a seat's selection
 * cannot reach a static `uses` entry — by the time a seat exists the entry is
 * already resolved. The one slot that can see a seat is a DYNAMIC `uses`
 * entry, `(ctx) => refs`, which the framework resolves per execution off
 * `ctx.flow.config`.
 *
 * That path carries **context and tools** — catalog tools and controls alike;
 * {@link DYNAMIC_KEYS} is the list. Resources, state schemas and
 * the generator singletons have to exist before a block runs, so the framework
 * resolves them at build time from static entries alone. Two consequences run
 * through this whole file:
 *
 * - The capability stays on its STATIC entry exactly as the app wrote it, so
 *   its resources and its default presets reach every seat the way they do
 *   today. The dynamic entry carries **only the presets a seat named that were
 *   not already active** — the delta, never the whole capability. No preset is
 *   resolved twice, which matters because the framework resolves the two paths
 *   independently and does not dedupe across them: a capability contributing
 *   its presets on both would hand a seat that named a default preset two
 *   copies of it.
 * - A preset that can only be delivered at build time cannot be selected, and
 *   a capability with open config cannot be reached dynamically at all. Both
 *   are refused **at the mint**, by name, rather than failing on the seat's
 *   first turn. See {@link BUILD_TIME_ONLY_KEYS} and {@link seatCapabilityProblems}.
 *
 * Everything here is pure and isomorphic: no `node:fs`, no registry, no state.
 * The catalogue is built once when the kind is built; the per-turn half is one
 * map lookup per named capability and one clone per capability that has a
 * delta.
 */

import type { CapabilityRef, GeneratorTool, PresetDef, UsesSlot } from "@flow-state-dev/core";
import {
  flattenCapabilities,
  getBaseCapability,
  resolveActivePresets
} from "@flow-state-dev/core/capability";

/**
 * What a worker file's `capabilities:` key parses to — capability name to the
 * presets that seat wants.
 *
 * ```yaml
 * capabilities:
 *   research: [briefing]
 * ```
 *
 * An empty list is legal and means *carry this capability's defaults*, which
 * is also what naming the capability nowhere means. It reads as a no-op
 * because it is one; refusing it would make an author delete a line to say the
 * thing the line already says.
 */
export type SeatCapabilitySelection = Record<string, readonly string[]>;

/**
 * The surface keys a preset can declare that the dynamic path cannot deliver.
 *
 * The framework resolves a dynamic `uses` entry per execution, when the
 * block's resources, state containers and model are long since fixed. So a
 * preset declaring any of these is a build-time preset: the app installs it
 * for the whole kind or nobody has it, and a seat naming it is refused rather
 * than given half of it.
 *
 * Listed rather than derived by negation from `context`/`tools` on purpose — a
 * key added to `PresetDef` later must be classified deliberately, and being
 * absent from this list is the claim that the dynamic path carries it. The
 * assertion under {@link DYNAMIC_KEYS} makes "deliberately" real: a new key
 * that neither list names fails to compile here.
 */
const BUILD_TIME_ONLY_KEYS = [
  "resources",
  "sessionStateSchema",
  "requestStateSchema",
  "userStateSchema",
  "orgStateSchema",
  "sequencerStateSchema",
  "stateSchema",
  "targetStateSchemas",
  "model",
  "providerOptions",
  "caching"
] as const satisfies readonly (keyof PresetDef)[];

/**
 * The surface keys the dynamic path DOES carry, as the framework resolves it.
 *
 * Kept only so the two lists can be checked against `PresetDef` together.
 *
 * `controlTools` (FIX-1393) is dynamic because core makes it so —
 * `resolveDynamicCapSurface` collects it alongside `tools` — not as a
 * preference. Build-time-only would refuse a seat naming a control-bearing
 * preset, which inverts what a control is for.
 *
 * Being dynamic is not being unfenced: a selected preset's catalog `tools`
 * still stop at a `tools:` line the seat wrote. A seat that wrote none is
 * granted them by the kind's tools slot instead — see
 * {@link selectedPresetTools}. See `PresetDef.controlTools` for the
 * distinction, and the paired tests in `test/seat-capabilities.test.ts` for
 * the behaviour — *"carries a selected preset's context but not its tool past
 * the seat's fence"* and *"lets a selected preset's CONTROL tool through the
 * same empty tools list"*, one key apart on the same seat.
 */
const DYNAMIC_KEYS = ["context", "tools", "controlTools"] as const satisfies readonly (keyof PresetDef)[];

/**
 * Compile-time proof that every `PresetDef` key is classified as one or the
 * other. A key added to `PresetDef` upstream lands in neither list, so
 * `Exclude` stops being `never` and this alias fails to compile — the whole
 * point of listing the build-time keys instead of deriving them by negation.
 */
type _EveryPresetKeyIsClassified = AssertNever<
  Exclude<keyof PresetDef, (typeof BUILD_TIME_ONLY_KEYS)[number] | (typeof DYNAMIC_KEYS)[number]>
>;
type AssertNever<T extends never> = T;

/** Which build-time-only keys this preset declares, in the order listed above. */
function buildTimeOnlySurface(preset: PresetDef): string[] {
  return BUILD_TIME_ONLY_KEYS.filter((key) => preset[key] !== undefined);
}

/**
 * One capability a seat may pick presets from, flattened once when the kind is
 * built.
 *
 * Everything a refusal or a per-turn resolution needs is read here, so neither
 * walks a capability again: the mint does map lookups and the turn does one
 * clone per capability with a delta.
 */
interface SelectableCapability {
  /**
   * The ref the app installed, presets and config as the app configured them.
   * A seat's clone is made from THIS, so an app's own `.presets()` and
   * `.config()` survive into the seat's copy.
   */
  ref: CapabilityRef;
  /** Every preset the capability declares, in declaration order. */
  declared: string[];
  /**
   * The presets already active for every seat of this kind — the capability's
   * own defaults as the app's `.presets()` left them. A seat naming one of
   * these is naming what it already has, so it is carried once: it stays on
   * the static path and never joins the delta.
   */
  activeForKind: Set<string>;
  /**
   * Presets the app turned OFF where it installed the capability.
   *
   * A seat may not switch one back on. The app's `false` is a statement about
   * the whole kind — most sharply where it keeps a tool-bearing preset away
   * from the model — and a file a team edits is not where that is reversed.
   * Refused at the mint rather than honoured or ignored.
   */
  disabledByApp: Set<string>;
  /**
   * Whether the capability declares open config (`defineCapability({ config })`).
   *
   * The framework refuses such a capability on the dynamic path outright,
   * because that path resolves presets only and would silently drop the config
   * resolver's surface. So its presets are the app's to set, and a seat naming
   * one is refused at the mint — where the alternative is a throw inside the
   * seat's first answer.
   */
  hasOpenConfig: boolean;
  /** Preset name to the build-time-only keys it declares; only non-empty entries are held. */
  buildTimeOnly: Map<string, string[]>;
  /**
   * Preset name to the catalog `tools` it declares, as declared: an array, or
   * a function resolved per turn. Only presets that declare tools are held.
   * Read by {@link selectedPresetTools}; controls are not here, because a
   * control reaches the seat through the capability whatever its `tools:` says.
   */
  presetTools: Map<string, NonNullable<PresetDef["tools"]>>;
}

/** What a kind's `uses` offers a seat to pick from. */
export type SeatCapabilityCatalog = ReadonlyMap<string, SelectableCapability>;

/**
 * Read the capabilities a seat may pick presets from off a kind's `uses`.
 *
 * **Top-level static entries only.** A dynamic entry is a function whose
 * result is not known until a request runs, so nothing can be listed from it;
 * and a capability reached transitively through another's own `uses` is that
 * capability's internal business rather than something the app put on the
 * kind. Both are passed over, so a seat naming one is refused by
 * {@link seatCapabilityProblems} the same way a typo is.
 *
 * **Which ref is read is the framework's answer, not this array's order.**
 * `flattenCapabilities` walks depth-first, so a capability reached through an
 * earlier entry's own `uses` is recorded before the same capability appearing
 * later at the top level, and that later one is then skipped as a diamond. The
 * block therefore runs off the nested ref. Reading the array directly would
 * describe a seat's options against a ref that never resolved — and, worse,
 * would call a preset the winning ref already turned on inactive, so a seat
 * naming it would be handed it a second time on the dynamic path.
 *
 * @param uses The kind's `uses` slot, as the app passed it.
 * @returns The catalogue, keyed by capability name. Empty when the kind
 *   installs no capabilities — in which case the kind grows no per-seat entry
 *   at all and any selection is refused.
 */
export function catalogSeatCapabilities(uses: UsesSlot | undefined): SeatCapabilityCatalog {
  const catalog = new Map<string, SelectableCapability>();
  if (!uses) return catalog;

  const topLevel = uses.filter(
    (entry): entry is CapabilityRef => typeof entry !== "function"
  );
  // What the app itself put on the kind. The flatten below also returns
  // capabilities reached only through another's `uses`, which stay unselectable.
  const selectable = new Set(topLevel.map((entry) => getBaseCapability(entry).name));

  for (const entry of flattenCapabilities(topLevel)) {
    const base = getBaseCapability(entry);
    if (!selectable.has(base.name)) continue;
    const presetDefs = (base.__presetDefs ?? {}) as Record<string, PresetDef>;
    const declared = Object.keys(presetDefs).filter((key) => key !== "default");

    const overrides = ("__presetOverrides" in entry
      ? ((entry as { __presetOverrides?: Record<string, unknown> }).__presetOverrides ?? {})
      : {}) as Record<string, unknown>;

    const buildTimeOnly = new Map<string, string[]>();
    const presetTools = new Map<string, NonNullable<PresetDef["tools"]>>();
    for (const name of declared) {
      const keys = buildTimeOnlySurface(presetDefs[name]!);
      if (keys.length > 0) buildTimeOnly.set(name, keys);
      const tools = presetDefs[name]!.tools;
      if (tools !== undefined) presetTools.set(name, tools);
    }

    catalog.set(base.name, {
      ref: entry,
      declared,
      // Asked of the framework rather than re-derived: which presets a ref
      // resolves to is one rule, and a second reading of it here is how a
      // seat's idea of "already on" drifts from the block's.
      activeForKind: new Set(resolveActivePresets(entry).map((preset) => preset.name)),
      disabledByApp: new Set(
        Object.entries(overrides)
          .filter(([, value]) => value === false)
          .map(([name]) => name)
      ),
      hasOpenConfig: base.__configDef !== undefined,
      buildTimeOnly,
      presetTools
    });
  }

  return catalog;
}

/** Quote a list for a refusal, or say there is nothing to list. */
function listed(names: Iterable<string>): string {
  const quoted = [...names].map((name) => `"${name}"`);
  return quoted.length > 0 ? quoted.join(", ") : "(none)";
}

/**
 * Every reason a seat's selection is refused, as messages — one per problem,
 * so a file with two mistakes is told about both.
 *
 * Separated from the schema that reports them because the same list is what a
 * test asserts on and what the refusal text is built from; a rule living only
 * inside a `superRefine` closure can be checked only by minting a seat.
 *
 * @param catalog The kind's catalogue.
 * @param selection What the worker's file named.
 * @returns One message per problem, in file order. Empty when the selection is good.
 */
export function seatCapabilityProblems(
  catalog: SeatCapabilityCatalog,
  selection: SeatCapabilitySelection
): string[] {
  const problems: string[] = [];

  for (const [name, presets] of Object.entries(selection)) {
    const capability = catalog.get(name);
    if (!capability) {
      problems.push(
        `names capability "${name}", which its kind does not carry. ` +
          `This kind carries: ${listed(catalog.keys())}. ` +
          `A capability reaches a kind through \`defineAgentWorkerFlow({ uses })\` — ` +
          `install it there, or drop it from this worker.`
      );
      continue;
    }

    for (const preset of presets) {
      if (!capability.declared.includes(preset)) {
        problems.push(
          `names preset "${preset}" on capability "${name}", which that capability does not ` +
            `declare. It declares: ${listed(capability.declared)}.`
        );
        continue;
      }

      // Already carried: nothing to add and nothing to refuse. Skipped here so
      // the three refusals below only ever fire on a preset that would really
      // travel the per-seat path.
      if (capability.activeForKind.has(preset)) continue;

      if (capability.disabledByApp.has(preset)) {
        problems.push(
          `names preset "${preset}" on capability "${name}", which the app turned off where it ` +
            `installed that capability. A seat adds to what its kind carries and never widens past ` +
            `it — turn the preset back on at \`defineAgentWorkerFlow({ uses })\` if every seat ` +
            `should have it.`
        );
        continue;
      }

      if (capability.hasOpenConfig) {
        problems.push(
          `names preset "${preset}" on capability "${name}", which takes config ` +
            `(\`defineCapability({ config })\`). Such a capability is resolved once, where the ` +
            `app installs it, so its presets cannot be picked per seat — set them at ` +
            `\`defineAgentWorkerFlow({ uses })\`.`
        );
        continue;
      }

      const buildTimeOnly = capability.buildTimeOnly.get(preset);
      if (buildTimeOnly) {
        problems.push(
          `names preset "${preset}" on capability "${name}", which declares ` +
            `${buildTimeOnly.join(", ")} — that has to exist before a request runs, so the preset ` +
            `is the app's to turn on for the whole kind rather than one seat's to pick.`
        );
      }
    }
  }

  problems.push(...pickedToolCollisions(catalog, selection));
  return problems;
}

/**
 * Two picked presets carrying DIFFERENT tools under one name, as messages.
 *
 * A worker with no `tools:` line is granted every picked preset's tools (see
 * {@link selectedPresetTools}), and one name is one tool, so such a pair is a
 * turn that would fail on the framework's duplicate-name check. Refused here,
 * at the mint, for the listed tools it can see; a function-valued preset's
 * tools exist only per turn and are left to that check.
 *
 * Checked whether or not the worker wrote a `tools:` line: a kind's settings
 * are one closed object, so a rule here cannot read a sibling setting. The
 * same tool instance picked through two presets is one tool and passes.
 */
function pickedToolCollisions(
  catalog: SeatCapabilityCatalog,
  selection: SeatCapabilitySelection
): string[] {
  const problems: string[] = [];
  const seen = new Map<string, { tool: unknown; where: string }>();
  for (const [name, presets] of Object.entries(selection)) {
    const capability = catalog.get(name);
    if (!capability) continue;
    for (const preset of presets) {
      const declared = capability.presetTools.get(preset);
      if (!Array.isArray(declared)) continue;
      const where = `preset "${preset}" on capability "${name}"`;
      for (const tool of declared) {
        const toolName = (tool as { name?: unknown }).name;
        if (typeof toolName !== "string") continue;
        const first = seen.get(toolName);
        if (first === undefined) {
          seen.set(toolName, { tool, where });
        } else if (first.tool !== tool) {
          problems.push(
            `picks ${first.where} and ${where}, which carry different tools named ` +
              `"${toolName}". One name is one tool — pick one of the two presets.`
          );
        }
      }
    }
  }
  return problems;
}

/**
 * The refs a seat's selection adds on top of what its kind already carries.
 *
 * One entry per named capability that has at least one preset the kind does
 * not already have on. Each is a clone of the app's own ref with an explicit
 * on/off for every declared preset — on for this seat's additions, off for
 * everything else, the presets the static entry is already contributing
 * included. That is what keeps a named default preset from arriving twice.
 *
 * Runs on every render of the generator's bindings, so it stays a map lookup
 * and a clone per addition, and returns nothing at all for the common case of
 * a seat that named none.
 *
 * Assumes the selection passed {@link seatCapabilityProblems} at the mint: an
 * unknown capability or preset is skipped here rather than checked twice.
 *
 * @param catalog The kind's catalogue.
 * @param selection What this seat's file named.
 * @returns The per-seat refs for a dynamic `uses` entry.
 */
export function resolveSeatCapabilities(
  catalog: SeatCapabilityCatalog,
  selection: SeatCapabilitySelection | undefined
): CapabilityRef[] {
  if (!selection) return [];
  const refs: CapabilityRef[] = [];

  for (const [name, presets] of Object.entries(selection)) {
    const capability = catalog.get(name);
    if (!capability) continue;

    const additions = presets.filter(
      (preset) => capability.declared.includes(preset) && !capability.activeForKind.has(preset)
    );
    if (additions.length === 0) continue;

    const overrides: Record<string, boolean> = {};
    for (const preset of capability.declared) {
      overrides[preset] = additions.includes(preset);
    }
    const ref = (capability.ref as { presets(overrides: unknown): CapabilityRef }).presets(
      overrides
    );
    // Cut the clone loose from what this capability COMPOSES, which the static
    // entry has already delivered in full.
    //
    // `.presets()` returns `Object.create(base)`, so the clone inherits the
    // capability's own `uses` — and the per-seat path walks that subtree rather
    // than stopping at the entry it was handed. Left on, a capability that
    // composes another would hand this seat the nested surface a second time,
    // and a nested capability declaring open config would take a seat that
    // hired cleanly and fail every turn it runs, since that path refuses open
    // config outright. Both break along the same axis the delta is here to
    // hold: one path per contribution, per seat.
    //
    // An OWN `undefined` shadowing the prototype's, rather than a walk of our
    // own: whatever the subtree holds stays the static entry's business, and
    // `getBaseCapability` still recovers the base through the prototype, so
    // nothing downstream loses the capability's identity.
    (ref as { uses?: unknown }).uses = undefined;
    refs.push(ref);
  }

  return refs;
}

/**
 * The catalog tools of every preset a seat's own file picked — what a worker
 * with no `tools:` line can call (FIX-1459 D1).
 *
 * **Read from the selection as written**, not from what
 * {@link resolveSeatCapabilities} delivers. That function skips a preset the
 * kind already has on, which is right for context (carried once, by the static
 * entry) and wrong here: picking a preset the kind switches on by default is
 * still the seat's choice, and the choice is what grants. A preset the kind
 * switches on that the seat did NOT pick grants nothing.
 *
 * Only the preset's own `tools`. Its controls reach the seat through the
 * capability as they always have, and what the capability composes is the
 * static entry's business, exactly as on the per-seat path.
 *
 * Runs per turn from the kind's tools slot, so it stays one map lookup per
 * picked preset, plus the preset's own function when its tools are one. The
 * same tool instance picked through two presets is offered once.
 *
 * @param catalog The kind's catalogue.
 * @param selection What this seat's file named.
 * @param ctx The running block's context, handed to a function-valued preset.
 * @returns The tools, in selection order.
 */
export async function selectedPresetTools(
  catalog: SeatCapabilityCatalog,
  selection: SeatCapabilitySelection | undefined,
  ctx: unknown
): Promise<GeneratorTool[]> {
  if (!selection) return [];
  const tools: GeneratorTool[] = [];
  for (const [name, presets] of Object.entries(selection)) {
    const capability = catalog.get(name);
    if (!capability) continue;
    for (const preset of presets) {
      const declared = capability.presetTools.get(preset);
      if (declared === undefined) continue;
      // A function-valued preset is resolved here, per turn, with the same
      // context the framework hands it on the capability path.
      const resolved = Array.isArray(declared)
        ? declared
        : await declared(ctx as Parameters<typeof declared>[0]);
      for (const tool of resolved) if (!tools.includes(tool)) tools.push(tool);
    }
  }
  return tools;
}
