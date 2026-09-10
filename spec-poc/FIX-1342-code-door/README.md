# FIX-1342 — does a code-defined worker already have a path to hire?

Throwaway. Never merges. See `spec/FIX-1342.md` §7 for what it showed.

```bash
pnpm tsx spec-poc/FIX-1342-code-door/run.mts
```

**The question.** The issue asks how an async module load reconciles with a synchronous,
isomorphic `hireWorkforce`. This POC tests whether that question has to be answered at all —
that is, whether a worker too complex for a `WORKER.md` can already be hired today.

**What it builds.** Two workers described in documents, and one whose distinguishing setting
is a live routing *function* — something YAML cannot write, so it could only ever be code. The
app imports that one itself with an ordinary static `import` and passes it to `hireWorkforce`
beside the records the loader returned.

**How it grades.** By dereference, not presence: the check **calls** the routing function
against held-out subjects and grades the answers. A seat that merely *has* a `route` key fails.

**Controls run, each failing as predicted.** The function hard-coded to one answer; the code
worker left out of the roster; the value written as a string the way YAML would have to (that
last one is refused by the flow's own `configSchema`, which is the framework already policing
the code/document boundary at the right seam).

**Two notes on the setup, neither load-bearing.** Imports address the package source by path
because `spec-poc/` is deliberately outside the pnpm workspace, and the code worker is named
`worker.mts` rather than `worker.ts` because this directory carries no `package.json` and so is
CJS, while a real FSD app is ESM. The filename under discussion in the issue is `worker.ts`.
Step 0 of `run.mts` records what CJS does to that module's default export, which is why the
spec's Decision 2 chooses a named one.
