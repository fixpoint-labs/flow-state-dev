/**
 * Goal check — a capability author hands a capability typed configuration and
 * the resolver's output reaches the consuming block's real assembled surface,
 * composing with presets.
 *
 * Drives the REAL block-build path: `generator({ uses: [banner.config(...)] })`
 * runs resolveCapabilities → flatten → mergeCapabilities → resolveConfigSurface
 * → the generator's context assembly, and we assert on the assembled
 * `gen.config.context`. No model is in the loop: the resolver's entire effect
 * completes at block-build time (it makes zero runtime/ctx changes), so the
 * assertion is on the real merged surface, not a stubbed model output — it does
 * not violate the goals "never a mock" rule (there is nothing to mock).
 *
 * Held-out: the injected note is read from fixtures/input.json and asserted
 * back out; swapping it for any other string still passes a correct impl.
 *
 * Run: pnpm tsx goals/capability-config/resolver-reaches-generator/run.mts
 */
import { z } from "zod";
import { defineCapability, generator } from "@flow-state-dev/core";
import { DEFAULT_MODEL, loadFixture, runGoal } from "../../lib/index.mts";

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  }
}

/** The assembled context strings on a built generator. */
function assembledContext(gen: ReturnType<typeof generator>): string[] {
  const out: string[] = [];
  collectStrings((gen.config as { context?: unknown }).context, out);
  return out;
}

await runGoal(() => {
  const { note } = loadFixture<{ note: string }>(import.meta.url);
  const failures: string[] = [];

  // A capability with typed open config plus a flag preset. The resolver reads
  // the active preset set (owns override-vs-add) and maps config → context.
  const banner = defineCapability({
    name: "banner",
    presets: { shout: {}, default: [] },
    config: {
      schema: z.object({ note: z.string(), loud: z.boolean().default(false) }),
      resolve: (cfg, ctx) => {
        const loud = cfg.loud || ctx.presets.has("shout");
        return { context: [loud ? cfg.note.toUpperCase() : cfg.note] };
      },
    },
  });

  // 1. Explicit config value reaches the assembled surface.
  const loudCtx = assembledContext(
    generator({
      name: "loud",
      model: DEFAULT_MODEL,
      prompt: "p",
      uses: [banner.config({ note, loud: true })],
    }),
  );
  if (!loudCtx.includes(note.toUpperCase())) {
    failures.push(
      `expected assembled context to contain "${note.toUpperCase()}", got ${JSON.stringify(loudCtx)}`,
    );
  }

  // 2. The defaulted field (z.output) is honored: loud defaults to false.
  const quietCtx = assembledContext(
    generator({
      name: "quiet",
      model: DEFAULT_MODEL,
      prompt: "p",
      uses: [banner.config({ note })],
    }),
  );
  if (!quietCtx.includes(note)) {
    failures.push(`expected assembled context to contain "${note}", got ${JSON.stringify(quietCtx)}`);
  }

  // 3. Config composes with presets, in either chain order: a preset turned on
  //    reconciles against the config value (shout → uppercase even if !loud).
  for (const label of ["config-then-presets", "presets-then-config"] as const) {
    const uses =
      label === "config-then-presets"
        ? [banner.config({ note }).presets({ shout: true })]
        : [banner.presets({ shout: true }).config({ note })];
    const ctx = assembledContext(
      generator({ name: label, model: DEFAULT_MODEL, prompt: "p", uses }),
    );
    if (!ctx.includes(note.toUpperCase())) {
      failures.push(
        `[${label}] expected preset to reconcile config to "${note.toUpperCase()}", got ${JSON.stringify(ctx)}`,
      );
    }
  }

  return {
    failures,
    evidence: "config resolver output reached the assembled generator surface",
  };
});
