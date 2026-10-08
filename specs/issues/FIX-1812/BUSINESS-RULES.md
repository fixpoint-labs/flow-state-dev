# FIX-1812 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md)

| When | Then | Proved by |
| --- | --- | --- |
| the chief of staff's model lists its tools | it sees `hire` and `setWorkstreams` with the same names and descriptions as before | existing shift-manager tool-set tests, plus one assertion on the descriptions if none exists |
| the model calls `hire` or `setWorkstreams` | the same write happens, with the same input and output validation | existing devteam host tests |
| a Lab's `tools:` line names `hire` or `setWorkstreams` | the catalog accepts the entry | the Workforce catalog name check, as FIX-1811 meets it |
| a wrapper has a tap, connector, branch, rescue or a second step | it is unchanged | sweep checker: listed as `kept` |
| someone adds a described one-step wrapper | the checker fails until it is classified | sweep checker, negative control run |

**Acceptance:** the checker passes with every `rename` site gone and every `kept` site present;
`pnpm typecheck` and the touched packages' tests pass.
