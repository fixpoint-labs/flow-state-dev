---
"@flow-state-dev/core": patch
---

Fix non-streaming text generators sending an invalid structured-output schema. A generator with a `z.string()` output (explicit, or the default when `outputSchema` is omitted) was passing that schema to the model on the non-streaming path, producing a `response_format` with root `type: "string"`. OpenAI and the AI Gateway require the structured-output root to be `type: "object"` and reject a string root with `GatewayInternalServerError: Invalid schema for response_format ... got 'type: "string"'`.

The streaming path already omits the schema for text generators and returns plain text; the non-streaming path now mirrors that, so single-shot text generators (no item visibility, no tools) work against strict providers. Object output schemas are unaffected and still flow through as structured output. This surfaced when running the cross-pattern benchmark through the gateway, where every subject runs non-streaming.
