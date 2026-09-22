---
description: The feature this team is building, and the contract the work is accepted against.
llmReadable: true
---

# Feature brief

Add a greeting module to the repository you are working in.

Export a function `greet(name)` from `src/greeting.js`. For any non-empty
name it returns `Hello, <name>!`; for an empty name it returns `Hello!`.

The repository is an ES module project, so use `export`.

## Done when

The acceptance check accompanying this brief imports `greet` from that path
and asserts both behaviours, and passes. It is run from outside your
checkout and you cannot edit it. Adding a test of your own does not
substitute for it.

Put this marker in your commit message:

FEATURE-BRIEF-E61B8
