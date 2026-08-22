/**
 * Shared catalog-key resolution for agent `tools:` lists.
 *
 * Workforce and the skills worker-materializer used to each own a copy of
 * this loop. One implementation keeps the own-property miss path (FIX-965)
 * from drifting between packages.
 */
import type { GeneratorTool } from "@flow-state-dev/core";

/**
 * Resolve `toolKeys` against a catalog. Unknown keys warn and drop
 * (additive-not-restrictive). `logPrefix` is the bracket tag in the
 * warning (`[skills]`, `[workforce]`).
 */
export function resolveCatalogTools(
  agentKey: string,
  toolKeys: readonly string[] | undefined,
  catalog: Record<string, GeneratorTool>,
  logPrefix: string,
): GeneratorTool[] {
  if (!toolKeys || toolKeys.length === 0) return [];
  const out: GeneratorTool[] = [];
  for (const key of toolKeys) {
    // BP-031: `key` is model-supplied — own-property guard (FIX-965).
    if (!Object.hasOwn(catalog, key)) {
      console.warn(
        `[${logPrefix}] agent "${agentKey}": unknown tool "${key}" — skipped`,
      );
      continue;
    }
    out.push(catalog[key]!);
  }
  return out;
}
