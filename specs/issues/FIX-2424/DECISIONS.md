# FIX-2424 · Decisions

[Spec](SPEC.md) · **Decisions**

<a name="d1"></a>
## D1 · Show the mixed state; don't change the gates

| | Log it, gates unchanged (chosen) | Gates follow the resolved profile |
|---|---|---|
| A stray `FSD_DB_URL` is visible | yes | yes |
| Deployed behaviour changes | no | yes: a deploy with `FSD_ENV=dev` and a URL would open debug endpoints |
| Size | comments and one line | a behaviour change in a reference app's security gate |

- **Because:** the issue asks for the truth told, not the rule changed. Opening debug
  endpoints on a profile name rather than on "no database configured" is a security call that
  belongs to its own issue.
- **If wrong:** a follow-up moves the two gates to `activeProfile === "dev"`; the log line
  already names both values, so nothing here is thrown away.

<a name="d2"></a>
## D2 · The line lives in the app's config, not the engine

| | App config (chosen) | Engine, for every host |
|---|---|---|
| Knows the store kind | yes: the app built it | no: a store adapter carries no kind name today |
| Knows the gates' inputs | yes | only their resolved values |
| Layer cost | none | a new engine log contract every host inherits |

- **Because:** only the app knows that `prod` means Postgres and that `STORE_TYPE` picks the dev
  store. ER-1 isn't at stake (no workforce noun), but a store-kind log in the engine would need
  an adapter field that doesn't exist.
- **If wrong:** the engine grows `StoreAdapter.kind` and logs it; the app line then drops `store=`.

## Decided, not asked

- **E1 · stderr, not stdout.** The `fsdev` CLI imports this config and keeps stdout for NDJSON.
- **E2 · Logged when the config loads**, once per HMR re-evaluation too, since each builds a
  fresh FlowState. Reading `activeProfile` there moves an undeclared `FSD_ENV` failure from the
  first request to the start.
- **E3 · `durable` is one const** used by both `createFlowState` and the line, so the log can't
  disagree with the config.
- **E4 · The resolver's new name is `lib/test-model-resolver.ts`**, beside `lib/e2e-mock-script.ts`.
- **E5 · No changeset:** Kitchen Sink is a private app.
