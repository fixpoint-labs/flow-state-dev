# FIX-1551 · Business rules

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · **Rules** · [Plan](PLAN.md) · [Docs](DOCS.md) · [Evolution](EVOLUTION.md)

The cases, as rules. *Proved by* names the check in [PLAN.md](PLAN.md). Rules marked **(F1)** or
**(F2)** carry the owner's answers to those forks.

## Who a terminal run is

| # | When | Then | Proved by |
|---|---|---|---|
| BR-1 | An app's host resolver names an organization from host code alone (kitchen-sink after FIX-1500 PR-B) | The run executes as exactly that user and organization. The stored session carries them | V1 · VG |
| BR-2 | An app configures no resolver anywhere | `cli-user` (or `--user`) in the placeholder organization, as today. The only new output is the capture's identity field and one stderr line | V2 |
| BR-3 | The flow has a resolver of its own | Its resolver is asked, not the host's, as over HTTP | V3 |
| BR-4 | The resolver answers the terminal's question with the placeholder organization, a blank one, or none | Refused, exactly as HTTP refuses it. The placeholder is never a configured resolver's answer | V3 |
| BR-5 | The resolver needs a credential the CLI doesn't carry, or throws for any reason | The run stops before any session or request record is written. The message names the flow, carries the resolver's own message, and names `--org` **(F2)** | V3 · V4 |
| BR-6 | The same flow is called over HTTP by a caller with no credential | Its outcome equals BR-1 to BR-5's for the terminal, flow by flow: same organization, or refused both ways | V3 |

## What the developer can name (F1)

| # | When | Then | Proved by |
|---|---|---|---|
| BR-7 | `--org X` is given | The resolver is not asked. The run is `--user` (else `cli-user`) in X. The capture says a flag chose it | V5 |
| BR-8 | `--org` is blank, whitespace, or the reserved placeholder | Refused before anything is written, with the invalid-arguments exit code | V5 |
| BR-9 | `--user U` is given without `--org` | The resolver is asked. Its organization is kept and its user replaced by U. If it refuses, BR-5 applies | V5 |
| BR-10 | A developer-named organization differs from the app's | Its records are invisible to the app's callers, like any other organization's | V5 (POC P5) |

## Sessions, surfaces, and output

| # | When | Then | Proved by |
|---|---|---|---|
| BR-11 | `--session` or `--seed-session` names a session bound to another organization **or another user in the same organization**, such as one created before this change | Refused before any write, with the owner named. The stored record is byte-for-byte unchanged, seed included. Nothing is migrated | V6 |
| BR-12 | `--seed-session` creates a session | It is written under the identity the run uses. One identity per invocation | V1 |
| BR-13 | `fsdev chat` sends a turn | Identity is resolved for that turn's target. A refused turn fails and the loop continues. `/status` shows the organization | V7 |
| BR-14 | `--capture` is set | The capture records the user, the organization, and whether the resolver, a flag, or the development default chose them. Stdout NDJSON is unchanged | V1 |

## The network stays where it is (BP-031)

| # | When | Then | Proved by |
|---|---|---|---|
| BR-15 | Anyone runs `fsdev serve` or `fsdev dev` with `--org` or `--user` | Unknown option. No command that serves a network accepts an identity | V8 |
| BR-16 | An HTTP caller sends an organization in a body, query or header | Ignored, as today. HTTP requests are always `source: "http"` | V8 |
| BR-17 | A network bind is requested for an app with a flow on the development default | Still refused by the node host, unchanged | V8 |
| BR-18 | Any transport adapter, built-in or an app's own, resolves a request with `source: "cli"` | Refused, whatever source the adapter declared. Only the in-process entry point `fsdev` uses can produce that source, through a mark adapters never receive | V9 |

## Failure taxonomy

Every refusal happens before anything is written, exits with the invalid-arguments code, and names
the way through. Nothing falls back to the placeholder organization for an app that configured a
resolver. Nothing retries.

## Acceptance criteria this issue owns

After FIX-1500's PR-B has merged, `fsdev run support.mara` in kitchen-sink hires a seat into
`kitchen-sink`, and a zero-model read of the store finds the row there and nothing in the
placeholder organization. That is VG.
