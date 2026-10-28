# poc/codex-plan-tool · does the Codex `main` pins now offer its model a plan tool?

Characterization. It isn't a new probe: this is [FIX-1916's](../../../FIX-1916/poc/codex-wire/README.md)
probe, run again on 2026-10-28 against the SDK `packages/codex` pins on `main` at `05ef856`
(`@openai/codex-sdk` 0.164.0). It is the evidence for Codex's plan leg (`cx:p`) and for whether
[FIX-1951](https://linear.app/fixpoint-labs/issue/FIX-1951) can land, through FIX-2259 or on its own.

```bash
pnpm install --filter @flow-state-dev/codex...
node specs/issues/FIX-1916/poc/codex-wire/probe.mjs
```

The full output is [`probe-0.164.0.json`](probe-0.164.0.json).

| Leg | 0.152.1 (FIX-1916) | 0.164.0 (this run) |
|---|---|---|
| A, B, C, E · a thread is named, resumed, refused, survives a stop | pass | pass |
| D0 · the probe reads the tools Codex offers | pass | pass |
| D1 · Codex offers the model `update_plan` | **fails** | **fails**. Offered: `exec_command`, `write_stdin`, `request_user_input`, `view_image`, `multi_agent_v1`, `get_goal`, `create_goal`, `update_goal`, `web_search` |
| D2 · a scripted `update_plan` call becomes a `todo_list` item | **fails** | **fails**. Codex answers `unsupported call: update_plan` |

**Config toggles, also tried** (the probe with `config` passed to `new Codex(...)`, which the SDK
turns into `--config` overrides): `{ include_plan_tool: true }`, `{ tools: { update_plan: true } }`,
`{ features: { collaboration_modes: true } }`. D1 and D2 fail under each. The CLI binary does carry
`update_plan` strings ("update_plan is a TODO/checklist tool and is not allowed in Plan mode"), so
the tool exists in Codex. This headless path doesn't offer it.

**Not covered.** A real model, and a ChatGPT-account sign-in, which may load another model
catalogue. A signed-in host is the only place left to look.
