# Inventory fixture app

A fixed, tiny app that `labs/claude-code-style/test/inventory-module.test.ts` holds the shared
inventory module (`labs/test-support/inventory.mts`) to. It carries one of each shape the rules'
controls plant against: a read model in `src/app/` with a client import, two `.flow(` calls in one
function, a `.subscribe(` call, a hand-written row type, and one named like the screen type; a screen type in `src/lib/`; a file that
must go (`test/fake.ts`); and an allowlist listing exactly those findings.

It isn't a real app and nothing runs it. It never changes with the apps the epic cleans up, so
removing their debt never means rewriting the rules' controls. Change it only with those controls.
