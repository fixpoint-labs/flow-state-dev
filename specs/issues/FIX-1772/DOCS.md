# FIX-1772 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

The contributor rule (item 1) is not drafted here: it shipped in this PR as BP-042 in
`docs/contributing/best-practices/blocks.md`. Everything below is published by the
implementation PR, after checking it against the shipped behaviour.

## UPDATE · `apps/docs/docs/fundamentals/blocks.md` · "Key rules", new last bullet

- **Return what the next step needs, not everything you read.** A block's return value is
  recorded: it goes into the request's log, streams to DevTool, and, for a tool, becomes part of
  the model's history. A handler that reads a folder should return paths and sizes, not every
  file's contents. Keep large data in a resource and return a reference to it. Never return a
  secret; return a handle and resolve it where it's used. Values over the record limit are
  replaced in the record by a placeholder. See
  [Values too large to record](../streaming/items.md#values-too-large-to-record).

## UPDATE · `apps/docs/docs/streaming/items.md` · new section after `tool_output`, before "Lifecycle"

### Values too large to record

The runtime records what blocks return, but it won't record anything over 256 KiB. When a
`block_trace` input or output, or a `tool_output` result, is bigger than that once serialized,
the item holds a placeholder instead of the value:

```jsonc
// block_trace.output for a handler that returned 1.2 MB
{ "kind": "omitted", "bytes": 1258291, "preview": "{\"files\":[{\"path\":\"src/index.ts\",\"body\":\"…" }
```

```jsonc
// tool_output, completed, result over the limit
{ "type": "tool_output", "status": "completed", "outputOmitted": { "bytes": 1258291, "preview": "…" } }
```

`preview` is the first 512 characters of the serialized value. `bytes` is `null` when the value
couldn't be serialized at all, for example a value with a cycle in it. The server also logs one
warning naming the block and the size.

Only the record changes. The run itself still has the full value: the next step receives it,
`ctx.getBlockOutput()` returns it, and a generator gets the real tool result in the same turn.
Later turns see a short line in place of the result, naming the tool and the size.

If a request resumes after a pause or a crash, a block whose output was replaced runs again,
because the record can't give the later steps the real value. Guard that block's side effects
with `ctx.runOnce` if running it twice would matter. The better fix is to return less: see
[Key rules](../fundamentals/blocks.md#key-rules).

To change the limit for a server, set `maxRecordedValueBytes` on the router
([server API](../api/server.md#createflowapirouteroptions)).

Older items have no placeholders and read as they always did.

## UPDATE · `apps/docs/docs/api/server.md` · `createFlowApiRouter(options)`, after the example

Pass `maxRecordedValueBytes` to change the largest value the runtime records in an item, in
serialized bytes. The default is 256 KiB. Larger values are replaced in the record by a
placeholder; see [Values too large to record](../streaming/items.md#values-too-large-to-record).

```ts
const router = createFlowApiRouter({
  registry,
  maxRecordedValueBytes: 1024 * 1024, // 1 MiB
});
```

Raising it keeps more in your store and in model history. Lowering it means more blocks run
again when a request resumes.

## UPDATE · `apps/docs/docs/sequencers/connectors.md` · "Model-visible tool output", after the comparison table

`mapModelOutput` changes what the model is told. It doesn't change what is recorded: the
`tool_output` item still holds the full structured result, under the same
[record limit](../streaming/items.md#values-too-large-to-record) as any other result. To keep a
large value out of the record, return less from the block.

## UPDATE · `packages/engine/README.md` · after the `maxResponseBufferSize` example

Pass `maxRecordedValueBytes` to change the largest block or tool value recorded in an item
(default 256 KiB). Larger values are recorded as an `omitted` placeholder with their size and a
512-character preview; the run itself keeps the full value.

## UPDATE · `docs/architecture/items.md` · the `block_trace.output` union, and `tool_output`

Add a fourth case to the `BlockValue` list:

- **`omitted`** — the value was over the record limit (`maxRecordedValueBytes`, default 256 KiB)
  or could not be serialized. Carries `bytes` (or `null`) and `preview`, the first 512
  characters. The emitter writes it, on a copy; the live value is never replaced. It is never a
  completed output for replay: a block whose recorded output is `omitted` re-executes on
  resume. `resolveBlockValue` returns `undefined` for it.

Under `tool_output`, add: a result over the limit is recorded as `outputOmitted: { bytes,
preview }` with `output` and `modelOutput` absent. History replays it as one text line naming the
tool and the size. Generator resume treats it as unsettled and re-dispatches the call.

## Publication ownership

FIX-1772 owns all of the above. No epic. No new page and no sidebar change: the new section sits
inside the existing streaming items page.
