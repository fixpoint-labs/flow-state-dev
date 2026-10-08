# FIX-1812 · Docs

[Spec](SPEC.md) · [Decisions](DECISIONS.md) · [Rules](BUSINESS-RULES.md) · [Plan](PLAN.md) · **Docs**

No new page and no new prose. `.as()` is introduced on the blocks page by FIX-1811; this issue
only updates examples that still show the wrapper.

## Update `apps/docs/docs/workforce/projects.md`, the catalog example

```ts
import { defineAgentWorkerFlow, defineProjectBlocks } from "@flow-state-dev/workforce";

const projects = defineProjectBlocks();

const agent = defineAgentWorkerFlow({
  catalog: {
    createProject: projects.createProject.as({
      name: "createProject",
      description: "Create a project for the person you're talking to. They own it; `members` adds the user ids they name.",
    }),
    setWorkstreams: projects.setWorkstreams.as({
      name: "setWorkstreams",
      description: "Replace a project's workstreams with this list of full mailbox ids.",
    }),
  },
});
```

## Update `apps/docs/docs/workforce/chief-of-staff.md`, the roster tools example

`hire` becomes `hire.as({ name: "hire", description: "…" })`. `fire` keeps its sequencer,
because the approval tap is real behaviour.

## Update `packages/workforce/README.md`, the roster tools example

The same change as the chief of staff page, on one line.

The schema imports these examples no longer need are removed from them.
