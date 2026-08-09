/**
 * Vitest setup: strip ambient runtime/debug env vars so model-resolver and
 * provider-detection paths run against a clean, deterministic environment.
 *
 * Byte-for-byte the same scrub `packages/engine/test/setup-env.ts` and
 * `packages/core/test/setup-env.ts` apply, and for the same reason: every test
 * here that runs a real action goes through `createExecutionContext`, which
 * builds a `createModelResolver`. That resolver fails fast when
 * `FSDEV_DEFAULT_MODEL` or an `FSDEV_INTENT_*` override is set but the fixture
 * flow declares no intents — which is every fixture flow in this package. A
 * developer shell or CI container that exports those (as the Claude Code
 * web/remote environments do) would otherwise fail these tests for reasons
 * unrelated to SQLite. Tests that exercise the override path pass an explicit
 * `env` and are unaffected.
 */
for (const key of Object.keys(process.env)) {
  if (key.startsWith("FSDEV_INTENT_")) delete process.env[key];
}

for (const key of [
  "FSDEV_DEFAULT_MODEL",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_GENERATIVE_AI_API_KEY",
  "AI_GATEWAY_API_KEY",
  "OPENROUTER_API_KEY",
]) {
  delete process.env[key];
}
