---
"@flow-state-dev/workforce": minor
---

A team can say once what all its seats are told: an optional `TEAM.md` at `teams/<teamId>/` carries the team's `description` and, in its body, the instructions every seat on that team is given (FIX-1377).

Two things a consumer can trip over:

- **`readWorkforce`'s result grows two fields**, `teams` and `teamErrors`. Treat a non-empty `teamErrors` as fatal alongside `errors` and `skillErrors` — a team file that failed is a whole team's seats running without instructions someone wrote for them.
- **A hired seat's settings bag can now carry `teamInstructions`.** Every kind that composes `workerConfigSchema()` already declared the key, so nothing new refuses; but a kind that reads its config exhaustively will see a key it did not see before, for seats whose team wrote a `TEAM.md`. It is absent — never empty — for every other seat, so a tree with no `TEAM.md` anywhere behaves exactly as it did.

A seat's own instructions and its team's stay two separate settings and are never merged. On the built-in `agent` kind both go into the prompt, the team's first and the seat's own last. That order is fixed, and it is a position rather than a ranking: nothing in the prompt path resolves a contradiction between the two.
