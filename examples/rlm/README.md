# RLM Reference Implementation

A reference implementation of the Recursive Language Model (RLM) architecture ([Gao et al. 2025](https://alexzhang13.github.io/blog/2025/rlm/)) built with `@flow-state-dev`.

The core idea: an LM that never sees the full context directly. Instead, it uses tools to explore, search, and recursively sub-query over large contexts.

## What this validates

**Generator-as-tool composition.** The root generator (depth-0) lists a sub-query generator (depth-1) in its `tools` array. When the LLM calls the sub-query tool, the framework executes the sub-generator and returns its structured output as the tool result. This required zero framework changes.

**Handler blocks as LLM tools.** Three context exploration tools (peek, grep, chunk) are plain `handler` blocks with `inputSchema`, `outputSchema`, and `description`. The generator exposes them to the LLM automatically.

**Depth control via tool set restriction.** The root generator has `[peek, grep, chunk, subQuery]` as tools. The sub-query generator has only `[peek, grep, chunk]`. No recursive tool at depth-1 means no infinite recursion. Simple and effective.

**Session resources for large context.** The context document is stored in a session resource. Tool blocks access it via `ctx.session.resources.get("context")`. This keeps the context out of block inputs/outputs and avoids passing large strings through the pipeline.

## Structure

```
src/flows/rlm/
  flow.ts           RLM flow: generators, pipeline, flow definition
  schemas.ts        Context resource state schema
  blocks/
    peek.ts         Read a slice of context by offset
    grep.ts         Regex search over context
    chunk.ts        Get numbered chunks of context
    index.ts        Block exports

test/
  blocks.test.ts    Unit tests for exploration tools
  flow.test.ts      Integration tests for the RLM pipeline
```

## Running tests

```bash
pnpm --filter @flow-state-dev/example-rlm test
```

## Feasibility Analysis

### What mapped cleanly to existing primitives

| RLM Concept | Framework Primitive | Notes |
|---|---|---|
| Root LM | `generator` with `tools` | Generator's tool loop is the RLM's agentic loop. No adaptation needed. |
| Recursive LM call | Generator-as-tool | Generator listed in another generator's `tools` array. Works out of the box. |
| Context store | Session resource | `contextResourceStateSchema` + `ctx.session.resources.get()`. Clean fit. |
| Peek/grep/chunk tools | `handler` blocks | Standard handler blocks with `description` for LLM exposure. |
| FINAL(answer) | Generator `outputSchema` | Structured output terminates the generator loop. |
| Depth control | Tool set restriction | Leaf generators simply omit the recursive tool. Elegant. |
| Pipeline orchestration | `sequencer.then()` | Store context, run generator, increment counter. Trivial. |

### What worked but could be smoother

| Area | Observation |
|---|---|
| **Context slot typing** | When using function-typed `context` slots, explicit type annotations on the arrow function parameters conflict with the generator's inferred input type. Omitting them and letting TypeScript infer works fine, but the error message when you do annotate is confusing. |
| **Resource access in tools** | Tools use `ctx.session.resources.get("name")` which returns a nullable handle. The pattern works but requires a null check every time. A non-nullable accessor or the `sessionResources` shorthand from the design doc would reduce boilerplate. |
| **Sub-query context passing** | The sub-query generator receives context as a tool argument string, but the actual context lives in the session resource. There's a design tension: should the sub-query re-read from the resource, or should the root pass a subset directly? Both work; the resource approach is cleaner for this use case. |

### What would improve the pattern (potential framework helpers)

1. **`helper.contextExplorer(resource)`** - Factory that creates peek/grep/chunk tool blocks pre-wired to a specific resource. The three tools here are ~90 lines of nearly identical resource-access boilerplate. A factory would reduce this to one call.

2. **`helper.recursiveLM(config)`** - Factory that auto-generates depth-controlled generators with exploration tools. Takes `{ maxDepth, model, explorationTools, outputSchema }` and returns the root generator with recursive sub-generators already wired.

3. **Token budget tracking** - The RLM paper notes cost control matters. No current mechanism tracks cumulative token usage across recursive calls. A request-state counter fed by `GeneratorModelResult.usage` would solve this.

### Recommendations

- **Keep as `examples/rlm`** for now. The pattern validates cleanly without framework changes.
- **Extract `contextExplorer` to core helpers** if other examples need context exploration (RAG, document QA). The three tools are generic enough to reuse.
- **Defer `recursiveLM` helper** until we see more recursive patterns. One example isn't enough to generalize.
- **Consider token budget** as a framework-level concern for Phase 2, not specific to RLM.

### Framework changes required

**Zero.** The entire RLM implementation uses existing primitives: `generator`, `handler`, `sequencer`, `defineFlow`, session resources, and generator-as-tool composition. This validates that the block composition model handles recursive AI patterns without new abstractions.
