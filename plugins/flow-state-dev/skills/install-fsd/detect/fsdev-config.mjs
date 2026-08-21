/**
 * Resolution 8 — the `fsdev.config.*` the CLI actually loads — and 8b, what its registry holds.
 *
 * The CLI searches its cwd only and loads the **first present** of four filenames, printing its
 * own stderr warning about each it ignores. A fact taken from a shadowed file describes nothing
 * that runs: a marker in a `fsdev.config.mts` proves the demo flow is registered only while no
 * `fsdev.config.ts` sits beside it, and this path writes `.mts` precisely because it must not add
 * `"type": "module"` to a manifest somebody else owns.
 */
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEMO_FLOW, FSDEV_CONFIG_FILENAMES, GENERATED_MARKER } from "./constants.mjs";
import { readIfPresent } from "./fs-util.mjs";
import { declaredLiteral, importMap, settingValue, splitTopLevel } from "./source-scan.mjs";

/**
 * Resolution 8. Every candidate in the CLI's precedence order, with the winner named.
 *
 * Reported as a list rather than a single "config: present/absent", because a single fact is what
 * lets a run act on a file the CLI is not loading. Not a refusal — several configs in one
 * directory is a legal state, and refusing would lock out any project that ran both entry paths.
 */
export function resolveLoadedConfig(writeRoot) {
  const candidates = FSDEV_CONFIG_FILENAMES.map((name) => join(writeRoot, name)).filter((path) =>
    existsSync(path),
  );
  const winner = candidates[0] ?? null;
  const content = winner === null ? null : readIfPresent(winner);
  return {
    order: [...FSDEV_CONFIG_FILENAMES],
    candidates,
    winner,
    shadowed: candidates.slice(1),
    // Ours is decided by the marker, never by the filename — and only ever on the winner.
    winnerIsOurs: content !== null && content.includes(GENERATED_MARKER),
  };
}

/** Resolve a relative import specifier to a file on disk, trying the extensions a config may omit. */
function resolveSpecifier(fromFile, specifier) {
  if (!specifier.startsWith(".")) return null;
  const base = resolve(dirname(fromFile), specifier);
  const attempts = [base, ...[".ts", ".mts", ".js", ".mjs", ".tsx"].map((ext) => `${base}${ext}`)];
  // A config may import `./flows/hello/flow.mts` or the extensionless form; try both, and an
  // index file, before giving up.
  attempts.push(...[".ts", ".mts", ".js", ".mjs"].map((ext) => join(base, `index${ext}`)));
  attempts.push(...[".ts", ".mts", ".js", ".mjs"].map((ext) => base.replace(/\.m?[jt]s$/, ext)));
  return attempts.find((path) => existsSync(path)) ?? null;
}

/**
 * Resolution 8b — what the winning config's registry holds, and whether our demo's kind is free.
 *
 * A kind is a namespace we do not own. `FlowRegistry.register` rejects a duplicate `(kind, id)`
 * outright, so registering ours over an existing one would throw — and on the branch where their
 * config imports our flow file, that takes their whole app down at load. Skipping registration
 * instead is worse: `fsdev run hello send` then invokes **their** flow, which has no `send`
 * action.
 *
 * Our own entry is identified by **the import it resolves to** — the flow file we wrote — never by
 * the flow's kind. An idempotency check keyed on the kind reads the name, concludes the entry is
 * ours, skips registration, and writes the flow file anyway.
 *
 * Three verdicts, and `undetermined` is deliberately not folded into either of the others: a
 * config whose registry we cannot read statically is the one state where the demo flow really may
 * be unregistered, and reporting it as free would write files that never load.
 */
export function inspectRegistry(configPath) {
  if (configPath === null) {
    return { extendable: true, entries: [], demoKind: "free", ourEntry: null };
  }
  const source = readIfPresent(configPath);
  if (source === null) {
    return { extendable: false, entries: [], demoKind: "undetermined", ourEntry: null };
  }

  // **Anchored on the `createFlowState` call, not on the first `flows:` in the file.** A helper
  // object defined above it is not the registry, and taking the first match reported a live
  // registry that already owns our demo kind as free.
  const hit = settingValue(source, "flows", { anchor: "createFlowState(" });
  const raw = hit.unreadable ? null : hit.raw;
  // We do not execute their config, the same rule as for `pageExtensions` and `basePath`. A
  // registry built from a spread or an imported module is not statically extendable, and neither
  // is one we could not anchor.
  if (hit.unreadable || raw === null || !raw.startsWith("{") || raw.includes("...")) {
    return {
      extendable: false,
      entries: [],
      demoKind: "undetermined",
      ourEntry: null,
      why: hit.unreadable ?? (raw === null ? "no flows registry found" : "the registry is not a plain object literal"),
    };
  }

  const imports = importMap(source);
  const entries = [];
  // Both spellings, because a registry is written either way and the shorthand is the common one:
  // `{ hello }` and `{ hello: helloFlow }` register the same thing.
  for (const part of splitTopLevel(raw.slice(1, raw.lastIndexOf("}")))) {
    const named = /^(["']?)([\w-]+)\1\s*:\s*([\w.]+)$/.exec(part);
    const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(part);
    const name = named?.[2] ?? shorthand?.[1] ?? null;
    const identifier = named?.[3] ?? shorthand?.[1] ?? null;
    if (name === null || identifier === null) {
      // A member we cannot parse is a flow we cannot rule out. Dropping it silently narrowed the
      // registry to the entries we happened to understand and reported the rest as absent.
      entries.push({ name: null, identifier: null, specifier: null, modulePath: null, kind: null, raw: part });
      continue;
    }
    const rootIdentifier = identifier.split(".")[0];
    const specifier = imports.get(rootIdentifier) ?? null;
    const modulePath = specifier === null ? null : resolveSpecifier(configPath, specifier);
    entries.push({ name, identifier, specifier, modulePath, kind: kindOf(modulePath), raw: part });
  }

  const ourEntry =
    entries.find((entry) => entry.specifier !== null && isOurFlowSpecifier(entry.specifier)) ?? null;
  const foreignWithOurKind = entries.filter(
    (entry) => entry !== ourEntry && entry.kind === DEMO_FLOW.kind,
  );
  const unreadable = entries.filter((entry) => entry !== ourEntry && entry.kind === null);

  const demoKind =
    foreignWithOurKind.length > 0
      ? "taken"
      : unreadable.length > 0
        ? "undetermined"
        : "free";

  return { extendable: true, entries, demoKind, ourEntry, foreignWithOurKind, unreadable };
}

/** Does this specifier point at the flow file this skill writes? */
function isOurFlowSpecifier(specifier) {
  return specifier.replace(/\.m?[jt]s$/, "") === DEMO_FLOW.modulePath.replace(/\.m?[jt]s$/, "");
}

/**
 * The `kind` a flow module declares, or `null` when it cannot be read.
 *
 * Goes through {@link declaredLiteral} rather than a regex of its own. This was the sibling scan:
 * the config-level read was fixed to blank comments and anchor to the effective export, and this
 * one still took raw first-match — so a commented-out `// kind: "hello"` decided whether our demo
 * name was free. Every static read of somebody else's source now has one entry point, which is
 * what stops there being a third one to forget.
 */
function kindOf(modulePath) {
  if (modulePath === null) return null;
  const source = readIfPresent(modulePath);
  if (source === null) return null;
  const literal = declaredLiteral(source, "kind", { anchor: "defineFlow(" });
  return literal === null || literal.unreadable !== undefined ? null : literal;
}
