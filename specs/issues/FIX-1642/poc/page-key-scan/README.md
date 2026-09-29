# page-key-scan · can a page's names be checked against what ships?

Throwaway evidence for [FIX-1642](../../PLAN.md#the-scan). Not production code, not in any
test root, no dependencies.

**Question.** Leg C of the goal check says every API name and config key the page and its
table name resolves to a shipped export, and a planted false option fails the run. Is that
mechanical, with a totality rule (a token nobody can classify fails), or does it need a person?

**Run it** (from the repo root; the page draft is the epic's `DOCS.md`, whose page prose is quoted):

```bash
awk '/^## CREATE/,/^## UPDATE/' specs/epics/FIX-1637/DOCS.md > /tmp/page-draft.md
node specs/issues/FIX-1642/poc/page-key-scan/scan.mjs /tmp/page-draft.md --quoted
node specs/issues/FIX-1642/poc/page-key-scan/scan.mjs /tmp/page-draft.md --quoted --plant 'bullmqWorker({ connection, inlineDispatch: true })'
node specs/issues/FIX-1642/poc/page-key-scan/scan.mjs /tmp/page-draft.md --quoted --plant 'refused: "queue-host"'
node specs/issues/FIX-1642/poc/page-key-scan/scan.mjs /tmp/page-draft.md --quoted --plant 'schedules.static.<id>.priority'
node specs/issues/FIX-1642/poc/page-key-scan/scan.mjs /tmp/page-draft.md --quoted --plant 'GET /api/flows/:flowKind/webhooks/:provider'
```

**What it showed, on `main` at c63ee231:**

| Run | Result |
|---|---|
| The draft page, as written | PASS, 36 of 36 tokens: exports, config keys, both mounted routes (method and path), the `@flow-state-dev/bullmq/schedules` entry, the three worker modes, `refused: "external-dispatcher"` |
| Planted `inlineDispatch` on `bullmqWorker` | FAIL, names `inlineDispatch` |
| Planted `refused: "queue-host"` | FAIL, names `"queue-host"` |
| Planted `schedules.static.<id>.priority` | **PASS, wrongly.** `priority` is a real option, of BullMQ's enqueue options, not of a schedule |
| Planted `GET` on the webhook route | FAIL, names `GET /api/flows/:flowKind/webhooks/:provider`: only `POST` is mounted there. Routes are compared as method and path together |

**So.** The premise holds for an invented name: 76 entry points, the routes and the literals are
enough to resolve every token the draft names, and the totality rule works. It fails for a real
name on the wrong owner, which is the more likely way a page goes wrong. The committed scan
therefore resolves each key against the type it is passed to, and the goal's control plants
that kind of option, not only an invented one ([PLAN.md → Controls](../../PLAN.md#controls)).

Two smaller things it found. The scheduled route is mounted as `*scheduleId`, not
`:scheduleId`, so a route check that compares text literally fails a correct page. And the
draft file also quotes contributor prose (`epic-wake`), so the scan reads the published page,
never the draft.
