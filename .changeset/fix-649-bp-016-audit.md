---
"@flow-state-dev/patterns": patch
"@flow-state-dev/memory": patch
---

Generator output schemas in the patterns and memory packages now pass OpenAI strict-mode validation (BP-016). The supervisor reviewer's verdict schema previously carried `criteria` as an open `z.record` map, which serializes to `additionalProperties: true` and fails strict structured-output mode with an opaque "Invalid schema for response_format" error; it is now a fixed-shape `{ name, score }[]` array. Each package ships an `output-schemas-strict` regression spec that walks every generator output schema and fails if a `z.record`, an `optional`/`default` that survives the strict transform, or a heterogeneous union slips back in.
