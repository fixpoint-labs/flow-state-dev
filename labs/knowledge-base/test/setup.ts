// Adapter/capability tests exercise the resource graph, not model calls. The
// dev container sets FSDEV_INTENT_* / FSDEV_DEFAULT_MODEL for `fsdev`, which
// makes the default model resolver throw on an unconfigured test flow. Drop
// those overrides so `createExecutionContext` builds an empty resolver.
for (const key of Object.keys(process.env)) {
  if (key.startsWith("FSDEV_INTENT_") || key === "FSDEV_DEFAULT_MODEL") {
    delete process.env[key];
  }
}
