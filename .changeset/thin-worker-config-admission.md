---
"@flow-state-dev/workforce": minor
---

Every hireable worker kind now admits the same settings, and hiring always hands them over.

`workerConfigSchema()` is the new admission contract: `instructions?`, `teamInstructions?` and
`seatSkills`. Compose it into a worker kind's own schema and add that kind's settings at the top
level:

```ts
configSchema: workerConfigSchema().extend({ desk: z.string().default("front") })
```

`hireWorkforce` hands that bag to every seat, so a seat receives the skills its folders declared
whatever kind it runs on — not only the built-in `agent`. Reading them is optional; the door is
not.

**Breaking for custom worker kinds.** A kind that has not composed the contract refuses at the
hire, for the whole roster, with a message naming the worker and the fix. Previously such a kind
hired and was silently handed nothing, so a skills folder could load, a seat could mint and run,
and the two never met with no message anywhere. Add `workerConfigSchema().extend({ ... })` around
each custom kind's settings.

Two consequences worth knowing: a worker file may not declare `teamInstructions:` or `seatSkills:`
— both are refused by name at the loader and at the hire — and because every composed kind declares
`instructions`, a kind can no longer refuse a worker's body by leaving that key out.
