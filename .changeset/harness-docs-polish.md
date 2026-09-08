---
---

Internal (docs): an editorial pass over the harness documentation, which three
changes had written in isolation from each other.

`apps/docs/docs/tools/coding-agents.md` is new and now owns what the two
harnesses share — the definition, the handle table, and the `cwd` / `resume` /
`onSession` configuration contract — which had been stated separately on the
Claude Code page, the Codex page, the harness-manager page and `core`'s README.
Those pages link to it instead of restating it.

`tools/overview.md` had never gained a Codex entry. `claude-code-sdk.md` had a
section appended below its own closing links; it moves up beside the other
"what the run produced" sections, and the checkout recipe now leads with the
harness manager, which does that derivation for you. The harness-swap example
names `codexAgent` rather than a placeholder, and the harness manager's
`/checkout` subpath entry point is documented on the site for the first time.

Corrects two stale statements in `packages/core/README.md`: the harness
resolver signatures are implemented by both shipped harnesses and driven by the
harness manager, and there are two harnesses rather than one.
