# POC · which flows the repo's workers name

Retained evidence for [FIX-1788](../../SPEC.md). Not production code: nothing imports it, it
has no package manifest, and it is outside default build, test, lint and knip discovery
([specs/README.md](../../../../README.md)).

## The question

FIX-1788 makes every flow a worker can name one shared copy. Which flows is that, across the
repo's `WORKER.md` files, and where is each one defined? The epic asked the spec to list them
rather than say "about two dozen".

## How to run it

```bash
node specs/issues/FIX-1788/poc/flow-inventory/inventory.mjs                     # PASS, the table
CONTROL=drop-one node specs/issues/FIX-1788/poc/flow-inventory/inventory.mjs    # must FAIL, exit 1
```

No install needed. It reads `git ls-files`, so it sees tracked files only.

## What it checks

- **Totality.** Every tracked `WORKER.md` outside `specs/` is classified exactly once: under the
  flow its `flow:` names, or under `agent` when it names none. The count is checked against
  `git ls-files`. The control drops one file from classification, and the check must fail.
- **Where each flow is defined.** Three static rules: `kind: "<name>"` in a source file, a
  `*KIND = "<name>"` constant, or the file-per-flow convention
  `workforce/flows/workers/<name>.{ts,mts,tsx}`. Test files and `specs/` are excluded.

## What was observed

On `fbecfe6f2`: **94 files, 23 flows, PASS**. The control exits 1 with `classified 93 of 94`.

| Flow | Files | Flow | Files |
|---|---|---|---|
| `agent` (built in; 20 files name no flow) | 23 | `intake` | 3 |
| `probe` | 10 | `lead` | 3 |
| `seat` | 9 | `audit` | 2 |
| `asker` | 7 | `desk-clerk` | 2 |
| `builder` | 5 | `em` | 2 |
| `request-triage` | 5 | `worker` | 2 |
| `custom-agent` | 4 | `legacy-desk` · `note` · `planner` · `request-triage-legacy` | 1 each |
| `desk` | 4 | `ghost` · `note-taker` · `reviewer` | 1 each |
| `coder` | 3 | `coordinator` | 3 |

Four names have no static definition. Three are refusal fixtures that name a flow nobody
registers on purpose (`ghost`, `note-taker`, `reviewer`), and they stay refusals. `lead` is
defined at run time from its own file's `flow:` value
(`goals/shift-manager/it-shows-who-is-on-shift/lab/lab.mts`).

## What it means

Every defined name above is a flow that FIX-1788 registers once, as a shared copy, in place of
one copy per worker. The conversion is one change at the hire, not 23 changes: each flow is
already defined once and handed to the hire by name. `legacy-desk` and
`request-triage-legacy` are the "no contract" fixtures and stay refused.

## What it doesn't cover

Flows an app hands the hire with no `WORKER.md` naming them (a runtime hire's kinds, say).
`PLAN.md` → V0 finds those at implement time from every `hireWorkforce` call. Files under
`specs/` are retained POC evidence and are not converted.
