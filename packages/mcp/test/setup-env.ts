/**
 * Vitest setup: strip ambient runtime/debug env vars so model-resolver and
 * provider-detection tests run against a clean, deterministic environment.
 *
 * `createModelResolver` reads `process.env` by default. The `FSDEV_INTENT_*`
 * and `FSDEV_DEFAULT_MODEL` flow-debugging overrides trip its fail-fast
 * "unknown intent" guard against the fixture intents tests declare, and the
 * provider / gateway API keys change `detectAvailableProviders` results. A
 * developer shell or CI container that sets any of these would make unit tests
 * fail (or pass) for reasons unrelated to the code under test. Tests that
 * exercise the override / detection paths pass an explicit `env`, so they are
 * unaffected by this scrub.
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
