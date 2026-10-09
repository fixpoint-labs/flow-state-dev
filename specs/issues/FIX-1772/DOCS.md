# FIX-1772 · Documentation draft

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

The contributor rule shipped in this PR as BP-042 in
`docs/contributing/best-practices/blocks.md`. Everything below is published by the
implementation PR, after checking it against the shipped behaviour.

## UPDATE · `apps/docs/docs/fundamentals/blocks.md` · "Key rules", new last bullet

- **Return what the next step needs, not everything you read.** A block's return value is
  recorded: it goes into the request's log, streams to DevTool, and, for a tool, becomes part of
  the model's history. Return paths and sizes, ids or a count, not file contents or a whole
  collection. To hand bulk data from one step to the next, transform it in a sequencer's
  [`.map`](../sequencers/overview.md#dsl-methods), which isn't recorded. Data a person needs to read
  belongs behind a read path, such as a resource the client can read, not in an action's return.
  Values over the record limit are replaced in the record; see
  [Values too large to record](../streaming/items.md#values-too-large-to-record).

## UPDATE · `apps/docs/docs/streaming/items.md` · new section after `tool_output`, before "Lifecycle"

### Values too large to record

The runtime records what blocks return and what tools give back, but not past a limit: 256 KiB
once serialized, unless the server sets another. A larger `block_trace` output or `tool_output`
result is recorded as a placeholder:

```jsonc
{ "kind": "omitted", "bytes": 1258291, "preview": "{\"files\":[{\"path\":\"src/index.ts\",\"body\":\"…" }
```

The same object appears in both places. On a `block_trace` it is the `output`; on a
`tool_output` it takes the place of the result. `preview` is the first 512 characters of the
serialized value, and `bytes` is `null` when the value couldn't be serialized, for example
because it has a cycle. The server logs one warning naming the block and the size.

Only the record changes. The run keeps the full value: the next step receives it,
`ctx.getBlockOutput()` returns it, and a generator gets the real tool result in the same turn.
Later turns see one line in its place, naming the tool and the size.

A request that resumes after a pause or a crash can't rebuild a value from a placeholder. If it
would have to hand one on, it fails with the error code `RECORDED_VALUE_OMITTED`, naming the
block. Fix the block so it returns less, then retry.

The limit is a backstop. The way to move bulk data between steps is a sequencer's `.map`,
which isn't a block and records nothing. A `.map` that is the sequencer's last step is the
exception: its value becomes the sequencer's output, which is recorded and limited like any other.

To change the limit, set `maxRecordedValueBytes` on the router
([server API](../api/server.md#createflowapirouteroptions)). Items recorded before the limit
existed read as they always did.

## UPDATE · `apps/docs/docs/api/server.md` · `createFlowApiRouter(options)`, after the example

Pass `maxRecordedValueBytes` to change the largest block output or tool result the runtime
records in an item, in serialized bytes. The default is 256 KiB. Larger values are recorded as a
placeholder; see [Values too large to record](../streaming/items.md#values-too-large-to-record).

```ts
const router = createFlowApiRouter({
  registry,
  maxRecordedValueBytes: 1024 * 1024, // 1 MiB
});
```

Raising it keeps more in your store and in model history.

## UPDATE · `apps/docs/docs/sequencers/connectors.md` · "Model-visible tool output", after the comparison table

`mapModelOutput` changes what the model is told. It doesn't change what is recorded: the
`tool_output` item still holds the full result, under the same
[record limit](../streaming/items.md#values-too-large-to-record) as any other. To keep a large
value out of the record, return less from the block.

## UPDATE · `packages/engine/README.md` · after the `maxResponseBufferSize` example

Pass `maxRecordedValueBytes` to change the largest block output or tool result recorded in an
item (default 256 KiB). Larger values are recorded as an `omitted` placeholder with their size
and a 512-character preview; the run itself keeps the full value.

## UPDATE · `docs/architecture/items.md` · the `block_trace.output` union, and `tool_output`

Add a fourth case to the `BlockValue` list:

- **`omitted`** — the value was over `maxRecordedValueBytes` (default 256 KiB) or could not be
  serialized. Carries `bytes` (or `null`) and `preview`, the first 512 characters. The response
  emitter writes it on a copy; the live value is never replaced. Resume never hands it on: a
  replay that would inject it fails with `RECORDED_VALUE_OMITTED`. `resolveBlockValue` returns
  `undefined` for it.

Under `tool_output`, add: a result over the limit is recorded as the same `omitted` object, with
`output` and `modelOutput` absent. History replays it as one text line naming the tool and the
size; generator resume refuses it with the same error.

## Publication ownership

FIX-1772 owns all of the above. No epic. No new page and no sidebar change.
