# POC · kitchen-sink as one named organization

Retained evidence for the [post-merge amendment](../../EVOLUTION.md#amendment-named-org) that
records the owner's decision [D6](../../DECISIONS.md#d6). It is throwaway, it isn't production
code, and nothing imports it. It sits in no default build, test, lint or knip discovery
(`specs/issues/*/poc/**`). Its test runs only when it is copied into kitchen-sink's `test/`
folder, as shown below.

## The question

Where should kitchen-sink's one organization be set so that [D1](../../DECISIONS.md#d1) still
holds (the rail's hire and the rail's read resolve their organization the same way), and so that
hires survive a restart, show up in `discover`, and can still be fired by the operator?

## The mechanism it tests

**One host-level `resolvePrincipal`, handed to `createFlowState` in `fsdev.config.ts`.** It
returns `{ userId: "devuser", orgId: "kitchen-sink" }`. Both values are constants in host code,
and nothing on the request is read for either.

- `createFlowState` forwards it to the router (`packages/engine/src/flowstate/createFlowState.ts:1127`)
  and to the request host (`:1054`–`:1055`).
- `pickPrincipalResolver` makes it the resolver for every flow that has none of its own
  (`packages/engine/src/transports/auth/pickPrincipalResolver.ts:27`). That covers `chat-agent`,
  the rail's flow, every seat and every channel. `workforce-admin` and `weekly-digest` keep
  their own resolvers.
- The session binds to it (`orgId: ctx.principal?.orgId ?? DEFAULT_ORG_ID`,
  `packages/engine/src/routes/session-routes.ts:300`). An action whose org differs from its
  session's binding is refused (`packages/engine/src/context/createExecutionContext.ts:757`–`:759`).
  So the rail's hire and the rail's read resolve their org the same way, because they have no
  other way to do it.

The rest of the POC is real code. From the app: the generated kinds and catalog, the
`workforceRegistrar` proxy (installed over the router's own registry), the `workforce-admin`
flow and its bearer resolver, `admitReloadedSeats`, and `openChannels` over the real
`workforce/` tree. From the package: `createSeatHireBlocks` mounted as PR-D mounts it, and
`createSeatHireCapability` plus discover on the `agent` kind as FIX-1527 S1 composes it, both
built from **one shared options object**. Requests go through `createFlowApiRouter`: session
create, action, and resource read routes. That means route-level authentication runs exactly as
it would in the app.

## Legs

Observed on `origin/main` `95049473f`, and re-run unchanged on `d6738d922` for the review fold. All eight legs pass green.

| Leg | Claim | Green | Planted control → red |
|---|---|---|---|
| N1 | The rail's hire lands in the named org, and the rail's read finds the row | Session bound to `kitchen-sink`. `kitchen-sink.support.pat` registered as `agent`. The single-item roster read returns its `instructions`. Opening the hired seat itself returns 201, bound to `kitchen-sink`, so its owner pin admits the visitor | `POC_RESOLVER=default` (the app as it ships): session bound to `__fsd_default_org__`, the hire errors `Organization id "__fsd_default_org__" …`, and the read returns `null`. **Every leg goes red**, which is the point: the resolver is the whole mechanism |
| N2 | Hire and read agree on the org, and a body `orgId: "globex"` changes nothing | Nothing at `globex.support.pat`. The row is readable through the hire's own session on a bodyless read route | `POC_SPLIT=1` gives the rail's flow a resolver that names `globex` for bodyless routes and `kitchen-sink` for actions. The engine refuses the hire: `Session … is bound to org globex but request supplied org kitchen-sink`. Nothing lands |
| N3 | A file-declared seat (mara) runs in the named org, so its `discover` lists the rail's hire | mara's session is bound to `kitchen-sink`. The stream of a `discover`-only request contains `kitchen-sink.support.pat` | `POC_SEAT_ORG=globex` resolves seat-addressed requests to another org: `discover` does not list the hire. N5 and N6 go red too, because they also run mara |
| N4 | A restart (fresh registry, fresh router, same stores) brings the hire back through the boot's own reload | `stores.org.list()` includes `kitchen-sink`. `admitReloadedSeats` admits `kitchen-sink.support.pat`, `isFromRoster` is true, and the rail's read finds it | `POC_RELOAD_EMPTY=1` boots the second process on empty stores: `expected [] to include 'kitchen-sink'` |
| N5 | The operator's `workforce-admin` fire releases a rail hire and a seat-tool hire when its token is bound to the named org (FIX-1527 BR-10) | Both fires return `"released":true`, and both addresses are gone | `POC_ADMIN_ORG=acme` binds the token to another org: `This organization hired no seat …`. This is why PR-B pins the admin token to the named org (V22) |
| N6 | The capability's `fire` releases only an address this app registered from a roster row, because the shared options' `unregister` goes through `workforceRegistrar.isFromRoster` | A same-kind registration at the hired address that the roster did not make is left in place: `"released":false`, and the registry still holds it | `POC_UNGUARDED=1` passes `unregister` straight through: `"released":true`, and that registration is released |
| N7 | A user id the resolver can name on **every** route keeps one visitor's session usable across create, action and read | Constant `devuser`: create 201, action ok, and the read finds the row | `POC_USER_POLICY=body` reads the user from the body when there is one. Session create has no body in route-level auth, so the session is owned by `devuser`. The action then names `e2e-user-1` and is refused: `Session … is owned by user devuser but request supplied user e2e-user-1` |
| N8 | *(characterization)* The first named-org boot over a store the shipped app wrote | The channel open fails: `channel "support.ada-wren" could not be opened — Request failed (403)`. The session is still bound to `__fsd_default_org__`. `fsdev.config.ts` awaits that open at module scope, so the boot fails | `POC_N8_FIRST=named` makes the first boot named-org too: `opened` |

Each control flips one input its leg depends on. The legs that share that input go red with it,
as the table says. No other leg does.

## What it found, beyond "the mechanism holds"

- **No package change is needed.** D1's invariant holds with a kitchen-sink-only change.
- **The user id comes with the org.** A resolver other than the framework default turns on
  route-level ownership checks for every management route. Those routes resolve the principal
  with no body (`packages/engine/src/routes/route-auth.ts:414`–`:428`), so the resolver has to
  name a user without reading one from the request. N7 shows that a body-first user breaks the
  session it just created. The constant `devuser` is what the production page already uses
  (`apps/kitchen-sink/app/page.tsx:143`). What it costs is the Playwright suite's per-test
  `?e2eUserId=` isolation. PR-B keeps that suite green, and how it does so is the implementer's
  call.
- **A persistent store written before PR-B fails the first boot after it** (N8). This only
  matters for the filesystem and Postgres profiles, since the default dev profile is in-memory.
  PR-B handles it (BP-030). Earlier default-org conversations also stop being reachable, because
  route-level auth refuses a record from another org.
- **One roster key on the rail's flow.** `chat-agent` declares the panel's roster under
  `"roster"`, and the hire block reads `"hiredRoster"`. Declaring both on one flow is refused at
  definition: `Resource collision … resolve to the same effective storage key`. The first run of
  this POC hit that. PR-D re-keys the panel's roster to `HIRED_ROSTER_RESOURCE` and passes that
  ref to `Roster` and `SeatDetail`, since their default is `"roster"`.
- **`fsdev run` and `fsdev chat` never consult the app's resolver.** They pin `DEFAULT_ORG_ID`
  (`packages/cli/src/commands/run.ts:304`, `:373`; `packages/cli/src/chat/turn.ts:136`). After
  PR-B, a mara hire through `fsdev run` is still refused. The success form of FIX-1527's goal
  check therefore drives mara through the app's own HTTP router (`fsdev dev`, or the Next app).
  Read from the file; not changed here.

## Run it

From the repository root, after `pnpm install --frozen-lockfile` and
`pnpm exec turbo run build --filter=@flow-state-dev/kitchen-sink^...`:

```bash
cp specs/issues/FIX-1500/poc/named-org/named-org.test.ts apps/kitchen-sink/test/zz-poc-named-org.test.ts
(cd apps/kitchen-sink && env -u FSDEV_DEFAULT_MODEL ../../node_modules/.bin/vitest run test/zz-poc-named-org.test.ts)
# controls, one at a time — each turns its leg red:
(cd apps/kitchen-sink && POC_RESOLVER=default ../../node_modules/.bin/vitest run test/zz-poc-named-org.test.ts)
#   POC_SPLIT=1 · POC_SEAT_ORG=globex · POC_RELOAD_EMPTY=1 · POC_ADMIN_ORG=acme
#   POC_UNGUARDED=1 · POC_USER_POLICY=body · POC_N8_FIRST=named
rm apps/kitchen-sink/test/zz-poc-named-org.test.ts
```

It has to run from kitchen-sink because it imports the app's own modules through the `@/` alias.

## Limits

- **The rail's flow is a stand-in.** It carries only what PR-D adds to `chat-agent`: the two
  collections and the hire action. It isn't `chat-agent` itself, whose generators and memory
  aren't what's in question here.
- **Mocked model.** mara's tool calls are scripted. Whether a real model calls `hire` is
  FIX-1527's goal check.
- **mara is minted in the test**, as `hireWorkforce([{ id: "support.mara", … }])`, the same way
  FIX-1527's POC did it, because her `WORKER.md` doesn't exist on `main` yet.
- **No browser, no Next build.** Those are FIX-1500's `VG` and PR-B's e2e run.
