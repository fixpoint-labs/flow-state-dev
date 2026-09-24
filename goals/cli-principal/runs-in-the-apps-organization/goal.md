# cli-principal › it runs in the app's organization

**Issue:** FIX-1551 (VG). Needs FIX-1500 PR-B, which gives kitchen-sink its host resolver.
**Outcome:** A developer runs a kitchen-sink seat from the terminal and it behaves as the app would for a browser visitor. `support.mara` hires a seat, and the hire lands in the `kitchen-sink` organization, where the app's own pages can see it. Before this, the terminal ran in the framework's development organization and the hire was refused.
**Input:** `fixtures/input.json`: the manager seat, the action, a seat-name prefix, the message template, and the identity the app's resolver names. Held-out: the seat name gets a fresh suffix every run, so the check cannot pass on a row an earlier run left behind. Changing the prefix or the message wording must still pass a correct implementation.
**Signal:** Three checks on one run. (a) The capture's `command.principal` is exactly the fixture's `expect` (`devuser` / `kitchen-sink` / `resolver`). (b) The run completes. (c) A zero-model read of the same filesystem store finds `workforce/roster/<seat>` under `kitchen-sink` and not under `__fsd_default_org__`.
**Anti-game:** A hollow pass would grade the model's transcript ("I hired support.pat"), or the CLI's own claim about its identity. Neither proves where the row went. This check MUST read the roster out of the store, in both organizations, and must not treat `result.success` alone as proof of the hire. It must not reuse a fixed seat name, or a row from an earlier run passes it.
**Model:** real — kitchen-sink's configured model (no `--model` override)
**Run:** `pnpm tsx goals/cli-principal/runs-in-the-apps-organization/run.mts` (sets `STORE_TYPE=filesystem` for the child `fsdev run`)
**Controls:** none planted. The red is `main` before FIX-1551: the same command ends in `Organization id "__fsd_default_org__"`, and (a) and (c) fail.

## Verdict log
| Date | Commit | Model | Verdict | Notes |
|------|--------|-------|---------|-------|
| 2026-09-24 | c21ca3ba2 | intent/chat → vercel/anthropic/claude-sonnet-5 | **PASS** | Principal `devuser`/`kitchen-sink`/`resolver`. mara hired `support.patmufzb4j2` (address `kitchen-sink.support.patmufzb4j2`). The filesystem store holds `workforce/roster/support.patmufzb4j2` under `kitchen-sink` and nothing under `__fsd_default_org__`. Run on a fresh `.fsdev/data`: a store written before PR-B is refused at boot by design. |
| 2026-09-24 | c21ca3ba2 + control | intent/chat → vercel/anthropic/claude-sonnet-5 | **FAIL (expected)** | Control: the CLI's ask replaced with the old placeholder answer. Ran as `cli-user` in `__fsd_default_org__`, and the hire was refused with `Organization id "__fsd_default_org__" must be lowercase letters…`. Red on (a) the principal and (c) no roster row under `kitchen-sink`. |
