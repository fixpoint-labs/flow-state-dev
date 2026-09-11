# FIX-1342 — what an author experiences when a worker folder holds a `worker.ts`

Throwaway. Never merges.

```bash
pnpm tsx spec-poc/FIX-1342-worker-ts-slot/run.mts
```

**What is checked in here:** one script, `run.mts`, and this README. Nothing else — no
transcripts, no fixtures. The script builds its tree in a temp directory and removes it.

**The question.** The spec's problem statement rests on one claim: an app that follows the
documented startup guidance refuses to boot when a worker slot holds a `worker.ts`, and the
message it prints names no route the author could take instead. Both halves of that are
already checked in — the loader's behaviour is pinned by
`packages/workforce/test/read-workforce-directory.test.ts` ("reports a folder holding only a
worker.ts, rather than skipping it"), and the startup guard is the snippet
`apps/docs/docs/orchestration/workers-on-disk.md` tells every app to write. What is *not*
checked in anywhere is what the two do together, which is the only part the author sees.

**How it grades.** By assertion, not by printing. The healthy worker must load, the code
folder must be reported under its own path, the documented guard must throw, and the message
must name no route — that last one is `assert.doesNotMatch(refusal, /kind|flow factory|
hireWorkforce/i)`.

**What makes it fail.** The last assertion is the live one: it is red the moment the refusal
message is sharpened. This is a characterization check of the behaviour the issue proposes to
change, so a green run means the problem is still there and a red run means it was fixed.
