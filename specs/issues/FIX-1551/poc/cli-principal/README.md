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

Observed on `origin/main` `639d12238`, 2026-09-24. All eight pass green. P3 was re-pointed at the
HTTP action route and P6 to P8 added after the first review round; every control was re-run.

| Leg | Claim | Green | Planted control → red |
|---|---|---|---|
| P1 | *(characterization)* Today the real `fsdev run` and the same app's router disagree | `executeRunCommand` stores its session as `cli-user` in `__fsd_default_org__`. The router binds a session to `kitchen-sink` (201) | `POC_HOST_RESOLVER=none`: the router is on the placeholder too, `expected '__fsd_default_org__' to be 'kitchen-sink'` |
| P2 | The host resolver is not reachable from anything a loaded FlowState exposes | `getRuntime()` has `registry`, `stores`, `runtimeConfig`. Neither they, `runtimeConfig`'s keys, `meta`, nor any registered flow's `authentication` holds it | `POC_PER_FLOW=1` moves the same resolver onto `echo`: found at `registry.echo.authentication.resolvePrincipal`. P1 still passes under that control, so the CLI ignores a reachable per-flow resolver too |
| P3 | The host's own answer (`createInboundTransportHost(…).resolvePrincipal`) to a terminal's question (`source: "cli"`, no request, `cli-user` as the caller-named user, action `respond`, input `{message:"hi"}`) equals the app's **action route**, `POST /<flow>/actions/respond` with the same action and input and no credential, flow by flow | `echo`: `devuser@kitchen-sink` both ways, read from the HTTP request's own record. `admin` and `digest`: the same refusal message both ways (`Action request requires non-empty userId`; `…returned no usable orgId…`). Statuses differ and are not compared: the route maps the host's missing-user 401 to a legacy 400 for `admin` | `POC_CLI_FALLBACK=1`, F2's alternative: `admin: expected 'ok cli-user@__fsd_default_org__' to be 'refused: Action request requires non-…'`. `POC_HOST_RESOLVER=none`: `expected 'ok cli-user@__fsd_default_org__' to be 'ok devuser@kitchen-sink'` |
| P4 | A run under P3's answer leaves a session the app's router reads back | `runAction` as `devuser@kitchen-sink`, then `GET sessions/cli-s4` is 200, bound to `kitchen-sink` | `POC_TODAY=1` runs as the CLI does today: `expected 403 to be 200` |
| P5 | A developer-named organization stays out of the app's view | `runAction` in `acme-local` stores it there; the app's router answers 403 | `POC_NAMED_ORG=kitchen-sink` names the app's own organization: `expected 200 not to be 200` |
| P6 | *(characterization)* Today a custom network adapter can put `source: "cli"` on the context it resolves, and gets a `cli` branch's credential-free identity | An adapter declaring `custom-ws` stashes the shared host and resolves `{ source: "cli", request, no credential }`: `local-dev@acme`. Refusing adapters that *declare* `cli` would not catch it | `POC_CLI_BRANCH=0` drops the resolver's `cli` branch: refused, `expected { ok: false, …(1) } to deeply equal { ok: true, … }` |
| P7 | A mark only the in-process entry point can set closes P6 and keeps the CLI's answer | With a module-private `WeakSet` guard in front of the host's resolution: the adapter's `cli` context is refused (`source "cli" is reserved…`); the in-process ask still gets `local-dev@acme` | `POC_NO_GUARD=1`: the adapter gets `local-dev@acme` again, `expected 'ok {…}' to match /^refused: source "cli" is reserved/`. `POC_CLI_BRANCH=0` also turns it red, on the in-process side |
| P8 | *(characterization)* Today `--seed-session` on a same-organization session owned by another user writes the seed before the run is refused | `alice` owns `alice-s` in the placeholder org. The real `executeRunCommand` as `cli-user` fails with `Session alice-s is owned by user alice but request supplied user cli-user.`, and the record's state went from `{}` to `{ tampered: true }` | `POC_SEED_OWNER=cli-user` (the caller owns it): the run succeeds, `expected true to be false` |

Each control flips one input. The only legs that go red are the ones that depend on it, as listed.

## What it settled, and what it didn't

- **Settled:** the engine owes the CLI one read (P2), and the host's existing answer is the right
  one to expose, because it already matches HTTP including refusals (P3). The premise held.
- **Settled in review:** `cli` needs a mark adapters can't set, not a list of declared sources
  (P6, P7), and the seed has to wait for the ownership check (P8).
- **Found on the way:** a `digest`-shaped resolver refuses *every* non-scheduled HTTP caller,
  because wrapping the framework default hides the development default from the host. Whether
  kitchen-sink's own `weekly-digest` has that gap is a follow-up.
- **Not tested:** the real kitchen-sink app, which needs PR-B. The POC builds the host itself
  from the resolver it configured, because P2 shows the CLI can't get it; that is S1's job.
