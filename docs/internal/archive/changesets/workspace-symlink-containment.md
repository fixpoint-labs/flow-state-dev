---
"@flow-state-dev/workspace": patch
---

A host place refuses a path that leaves its root by symlink (FIX-150).

The containment check resolved `..` and rejected what landed outside. A symlink defeats that completely: the path stays inside the root and the kernel walks out of it anyway. Anything that can write in the place can plant one — an agent, a hydrated collection, another process — after which a hydrate could clobber a host file the run was never given, and a flush could pull one into a collection that is durable and client-readable.

A link is now refused rather than followed, at the file and at any parent directory in the chain, by resolving the part of the path that exists and checking it is still inside the root. A link pointing back INSIDE the place is refused too: the walk does not list one, and a place that writes through a link it will not list holds one file under two names — which is enough to make a later flush decide a run created something it did not.

A prefix that reports `ENOENT` now re-checks the root before it is read as an empty mount. The root is probed once before the walks begin; if it goes after that — another process, a cleanup — every prefix under it reports missing, which is indistinguishable from a collection that hydrated nothing, and a flush acting on that emptiness deletes every path it owns.
