---
sidebar_position: 4
title: Development Tips
---

# Development Tips

This guide synthesizes CLI and DevTool usage into practical development workflows. Use it when you're iterating on blocks, debugging flows, or trying to understand what the framework is doing.

---

## The CLI: fsdev

The CLI gives you a terminal interface for running flows and blocks without a server. No HTTP. No React. Just execution and output.

**When to use it:** Quick iteration, testing changes, debugging block behavior. You can validate a flow end-to-end before wiring up a frontend.

### `fsdev run <flow> <action>`

Execute a flow action with NDJSON streaming to stdout.

```bash
fsdev run hello-chat chat -i '{"message": "Hello!"}'
```

**Reading the output:** Each line is a JSON object. Event types include:
- `item_added` — A new item (message, reasoning, tool call, etc.) was created
- `content_delta` — Text chunk for a streaming item
- `state_change` — Scope state or resource was modified
- `flow_complete` — Action finished successfully
- `error` — Action failed

You see the same events the client receives over SSE. Useful for verifying that items and state changes appear in the right order.

**Session reuse:** Pass `--session` to persist state between invocations.

```bash
fsdev run hello-chat chat -i '{"message": "First"}' --session my-session
fsdev run hello-chat chat -i '{"message": "Second"}' --session my-session
```

The second run continues the conversation. State (e.g. message count) accumulates. The CLI uses the same filesystem stores as the server by default, so sessions persist across terminal sessions. Helps test multi-turn behavior without a browser.

**Input from file:** Use `-f` or `--input-file` for larger payloads:

```bash
fsdev run my-flow action -f ./test-inputs/scenario.json --session test-session
```

### `fsdev block <file>`

Run a single block in isolation. No flow. No session. Just the block and its input.

```bash
fsdev block ./src/flows/hello-chat/blocks/counter.ts -i '{}'
```

**Why use it:** Test a handler or generator without wiring up a full flow. Faster feedback. Easier to pinpoint failures. The block runs in the testing harness (in-memory stores, optional mock generators).

**Output format:** By default, `fsdev block` prints a JSON object with `success`, `block` metadata, `output`, `schemaValidation`, and `execution` timing. Use `--format json` for machine parsing. The block must be exported from the file; the CLI discovers it by loading the module and finding the block definition.

### Model overrides with `-m`

Swap models without changing code:

```bash
fsdev run hello-chat chat -i '{"message": "Hi"}' -m gpt-4o
fsdev block ./src/blocks/summarizer.ts -i '{"text": "..."}' -m claude-sonnet-4
```

Useful for comparing model behavior or testing with a cheaper model during development.

### Seeding state

Start with specific state for debugging:

```bash
fsdev run support-triage triageTicket -i '{"ticketId": "T1"}' \
  --seed-session '{"openTicketCount": 3}'
```

Options: `--seed-session`, `--seed-user`, `--seed-project`. Accept inline JSON or a file path. Simulates scenarios like "user has already sent 5 messages" or "project has existing config."

---

## The DevTool

A first-party inspector app for real-time flow visualization. See blocks executing, inspect state, replay requests.

**What it shows:**

- **Flow visualization** — Blocks executing in real time. Which step is running, what's next.
- **Trace view** — Every item with provenance, timing, and content. Drill into messages, tool calls, state changes.
- **Session state** — Current scope state and resources. Inspect what the flow has stored.
- **Replay** — Re-run previous requests to reproduce behavior. No need to retype inputs.

**How to run it:** Run the DevTool app alongside your server. Connect to your flow kind and session. The exact launch command may vary (e.g. `fsdev dev` or running the devtool app from the monorepo). See the project's DevTool docs for current setup.

**When to use it:** Visual debugging of multi-block flows. Understanding item provenance (which block emitted what). Inspecting state after a run. Reproducing bugs by replaying a request. The DevTool is most helpful when the flow has several steps and you need to see the execution order and data flow.

---

## Development workflow

**Start with `fsdev block` to test individual blocks.** If a handler's logic is wrong, isolate it. Fix it. Move on. Don't debug through the full flow until the block behaves.

**Use `fsdev run` with `--session` to test multi-turn conversations.** Send a few messages. Check state. Verify counts, modes, or other session state accumulate correctly.

**Run the DevTool alongside your server for visual debugging.** When something looks wrong in the UI, open the DevTool. See which block ran, what it emitted, what state changed. Trace issues backward from the item or state you care about.

**Use the testing harness for CI.** Deterministic. No LLM calls. Same contracts as production. Seed state for edge cases. Run `pnpm test` before pushing.

**Seed state for specific scenarios.** Testing "what happens when the user has already used 5 messages" or "what happens when project config is missing" is easier with `--seed-session` or `seed` in `testFlow`. No need to replay a long conversation.

---

## Debugging patterns

### Block not receiving expected input?

Check connector types. Sequencer steps pass output to the next block's input. If you used `then(connector, block)`, the connector transforms the value. Verify the connector's return type matches the block's `inputSchema`. Use `fsdev block` with the exact input shape you expect.

### State not updating?

Verify the partial state schema includes the field. A handler's `sessionStateSchema` must declare every key it reads or writes. The flow's `session.stateSchema` merges block declarations. If the flow schema doesn't include your field, either the block didn't declare it or there's a merge conflict.

### Items not streaming?

Check that the generator has `emit` configured correctly. By default, generators emit messages, reasoning, and tool calls. If you disabled something with `emit: { messages: false }`, that explains missing output. Handlers are silent by default; use `ctx.emitMessage()` or `ctx.emitComponent()` if you want client-visible output from a handler.

### Stream connects but no items?

Confirm the client is filtering correctly. `useSession(id, { items: { visibility: "ui" } })` shows only UI-visible items. Some item types (e.g. `block_output` without `toolCall`) are devtools-only. Check the [streaming docs](/docs/streaming/overview) for which types go to the client.

### Session not persisting between requests?

CLI: use `--session` explicitly. Browser: `useFlow({ autoCreateSession: true })` creates a session on mount. The client sends the session ID on subsequent action calls. If the session ID changes (e.g. new tab, cleared storage), you get a new session.

### Generator returns wrong structure?

Check the `outputSchema`. Generators with a custom `outputSchema` use structured output mode (no streaming). The framework parses and validates the model's response. If parsing fails, `repair.mode` controls retry, rescue, or fail. For streaming text, use the default `z.string()` or omit `outputSchema`.

### Tool block throws but error is unclear?

Run the tool block in isolation with `fsdev block`. Pass the exact arguments the generator would send. The block runs in the same harness; you'll see the real error. Tool blocks receive `BlockContext` with the same scope chain as the enclosing generator, so you can seed session or user state to match the failing scenario.
