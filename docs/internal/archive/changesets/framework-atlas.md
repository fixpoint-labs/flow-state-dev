---
---

Internal (docs): the framework architecture atlas lands as a rendered page at `docs/atlas/framework.html`, alongside the Conductor atlas. No package surface changes.

It is the second atlas, so `index.html` stops being a redirect to `conductor.html` and becomes a real listing of what the directory holds. The `docs/atlas` README gains a contents entry, and the note anticipating this file is removed now that it is here.

One caveat carried on the page and in the README: the atlas's counts — packages, lines, test cases, item types, deprecations — are measured against the commit that last touched it rather than regenerated, so they should be read as a snapshot.
