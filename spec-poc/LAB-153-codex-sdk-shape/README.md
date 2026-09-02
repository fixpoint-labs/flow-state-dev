# LAB-153 POC — does `@openai/codex-sdk` actually have the shape the spec builds on?

**Throwaway. Never merges; closes with the spec PR. Not for code review.**

The epic-spec (theme 11) chose Codex on *documented* behaviour nobody had executed. This
POC runs the real SDK (`0.152.1`, fetched from npm, no API key) against a fake `codex`
binary that speaks the SDK's own JSONL wire, and checks every premise `spec/LAB-153.md`
rests on: dispatch → handle, thread id before the turn ends, resume by id, abort as a
throw, usage without cost, and how the three failure endings surface.

```
node spec-poc/LAB-153-codex-sdk-shape/run.mjs
```

One `PASS`/`FAIL` line per premise; 22 held on 2026-09-02. The line marked **FINDING** is
the one that moved the spec (§9): an abort rejects only once the CLI's stdout closes, so a
subprocess the CLI itself spawned can hold the block open past the deadline — the block
bounds Codex, not what Codex ran.

What is *not* checked here, and is the goal check's job (§10): a real model, a real
checkout, a real resume that continues the conversation.
