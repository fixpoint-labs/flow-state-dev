# FIX-1325 POC — is a seat id containing `/` addressable?

**Question.** FIX-1335 decision 2 mints a worker's identity as `<teamId>/<name>`
(`engineering/lead`). FIX-1325 proposes to make that identity the seat's **flow instance
id**. Nobody had checked whether an instance id with a `/` in it survives the addresses an
instance answers to.

**Run:** `./node_modules/.bin/tsx spec-poc/FIX-1325-seat-addressing/run.mts`
(from the repo root, after `pnpm install`)

## Result — REFUTED. A slashed seat id registers fine and is unreachable.

```
1. defineFlow factory, id with '/'                   ACCEPTED — id=engineering/lead
2. registry.register, id with '/'                    ADMITTED
   registry.get('engineering/lead')                  RESOLVED
3a. POST …/engineering/lead/sessions (2 segments)    404 {"error":"Route not found"}
3b. POST …/<one segment 'engineering/lead'>          404 {"error":"Route not found"}
3c. POST …/engineering.lead/sessions                 201 created
3d. POST …/engineering__lead/sessions                201 created
4. POST …/seat/sessions (bare kind)                  404 {"error":"Unknown flow "seat""}
```

**Why, structurally.** `parseFlowRoute` joins the incoming path segments back into one
pathname and matches that string with `path-to-regexp`. So a `%2F` a client encodes is
indistinguishable from a real separator by the time matching happens — 3a and 3b are the
same string and fail identically. There is no POST route of the shape a `team/name` id
would need.

**Why it matters more than a 404.** Legs 1 and 2 are the dangerous half: `defineFlow` mints
it and the registry admits it, so nothing complains at boot. The failure only appears when
somebody tries to talk to the seat. That is the invisible-drift shape epic #1664 theme 3
exists to prevent, arriving through the front door.

**Not covered, deliberately.** That a seat reads its own frozen `ctx.flow.config` once
addressed — already proved on `main` by
`goals/flow-instances/settings-travel-with-the-copy`, against SQLite and a restart.

**Not checked.** The CLI (`fsdev run <id>`) and the BullMQ job processor take the id as an
argument rather than a URL segment, so they are likely unaffected; the spec does not lean on
that, since HTTP alone decides the question.
