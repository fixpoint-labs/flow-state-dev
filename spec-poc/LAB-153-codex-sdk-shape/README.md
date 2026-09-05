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

One `PASS`/`FAIL` line per premise; 24 held on 2026-09-05. The line marked **FINDING** is
the one that moved the spec (§9): an abort rejects only once the CLI's stdout closes, so a
subprocess the CLI itself spawned can hold the block open past the deadline — the block
bounds Codex, not what Codex ran.

What is *not* checked here, and is the goal check's job (§10): a real model, a real
checkout, a real resume that continues the conversation.

## Real-CLI leg (settles the LAB-153/LAB-154 dead-resume dispute)

`run.mjs`'s fake echoes the `resume <id>` argument back as `thread.started` for every
mode, unconditionally, by construction — it cannot show what the CLI does when the
resumed id doesn't exist. `real-cli-resume.mjs` drives the real, installed
`@openai/codex` CLI (pinned `0.152.1`) and the real SDK, no fake anywhere:

```
node spec-poc/LAB-153-codex-sdk-shape/real-cli-resume.mjs
```

7/7 held on 2026-09-05 (needs npx reaching the npm registry; no API key). **Confirmed**:
resuming a well-formed id the CLI has never seen produces zero stdout — no
`thread.started`, no event of any kind — and fails with a plain-text
`no rollout found for thread id …` on stderr, exit 1. A positive control (resuming a
thread the CLI *does* have, same run) fires `thread.started` with the matching id
first, proving the negative result is a real discriminator and not the harness's
inability to see the CLI's events at all. `run.mjs`'s new `dead-resume` fake mode
reproduces this finding for the fast, network-free suite.
