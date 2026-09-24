# POC · which organization a CLI run executes under

Retained evidence for [D1](../../DECISIONS.md#d1). It is throwaway, not production code, and
nothing imports it. It sits in no default build, test, lint or knip discovery
(`specs/issues/*/poc/**`). `run.sh` copies it into `packages/cli/test/`, runs it with that
package's vitest config, and removes the copy.

```bash
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@flow-state-dev/fsdev...
specs/issues/FIX-1551/poc/cli-principal/run.sh                      # all green
POC_HOST_RESOLVER=none specs/issues/FIX-1551/poc/cli-principal/run.sh   # a planted control
```

## The question

Can the CLI get the organization the app's HTTP host would give an equivalent caller, by asking
the app's own resolver with a terminal's question (no request, no credential)? And is the host
resolver even reachable from what the CLI loads?

## The fixture

`fixture/app.ts` is kitchen-sink after FIX-1500's PR-B, in miniature: one host-level resolver
returning `devuser` in `kitchen-sink` from constants, and three flows. `echo` has no resolver of
its own. `admin` checks a bearer token, as `workforce-admin` does. `digest` wraps the framework
default for non-scheduled callers, as `weekly-digest` does. `fixture/fsdev.config.ts` is what
`fsdev run` loads.

## Legs

Observed on `origin/main` `639d12238`, 2026-09-24. All five pass green.

| Leg | Claim | Green | Planted control → red |
|---|---|---|---|
| P1 | *(characterization)* Today the real `fsdev run` and the same app's router disagree | `executeRunCommand` stores its session as `cli-user` in `__fsd_default_org__`. The router binds a session to `kitchen-sink` (201) | `POC_HOST_RESOLVER=none`: the router is on the placeholder too, `expected '__fsd_default_org__' to be 'kitchen-sink'` |
| P2 | The host resolver is not reachable from anything a loaded FlowState exposes | `getRuntime()` has `registry`, `stores`, `runtimeConfig`. Neither they, `runtimeConfig`'s keys, `meta`, nor any registered flow's `authentication` holds it | `POC_PER_FLOW=1` moves the same resolver onto `echo`: found at `registry.echo.authentication.resolvePrincipal`. P1 still passes under that control, so the CLI ignores a reachable per-flow resolver too |
| P3 | The host's own answer (`createInboundTransportHost(…).resolvePrincipal`) to a terminal's question (`source: "cli"`, no request, `cli-user` as the caller-named user) equals the router's answer to a credential-less HTTP caller, flow by flow | `echo`: `devuser@kitchen-sink` both ways. `admin`: 401 both ways. `digest`: 401 both ways | `POC_CLI_FALLBACK=1`, F2's alternative, falls back to the placeholder on refusal: `admin: expected 'ok cli-user@__fsd_default_org__' to be 'refused 401'`. `POC_HOST_RESOLVER=none`: `echo` is `cli-user@__fsd_default_org__` |
| P4 | A run under P3's answer leaves a session the app's router reads back | `runAction` as `devuser@kitchen-sink`, then `GET sessions/cli-s4` is 200, bound to `kitchen-sink` | `POC_TODAY=1` runs as the CLI does today: `expected 403 to be 200` |
| P5 | A developer-named organization stays out of the app's view | `runAction` in `acme-local` stores it there; the app's router answers 403 | `POC_NAMED_ORG=kitchen-sink` names the app's own organization: `expected 200 not to be 200` |

Each control flips one input; the legs that don't depend on it stay green.

## What it settled, and what it didn't

- **Settled:** the engine owes the CLI one read (P2), and the host's existing answer is the right
  one to expose, because it already matches HTTP including refusals (P3). The premise held.
- **Found on the way:** a `digest`-shaped resolver refuses *every* non-scheduled HTTP caller,
  because wrapping the framework default hides the development default from the host. Whether
  kitchen-sink's own `weekly-digest` has that gap is a follow-up.
- **Not tested:** the real kitchen-sink app, which needs PR-B. The POC builds the host itself
  from the resolver it configured, because P2 shows the CLI can't get it; that is S1's job.
