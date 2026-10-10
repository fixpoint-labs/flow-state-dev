# Preview Deployments (on-demand, label-gated)

Vercel no longer deploys on every push. Previews are opt-in per PR, per target,
via labels. Only PRs you explicitly label ever build.

## Targets

| Label                  | Source          | What it deploys        |
| ---------------------- | --------------- | ---------------------- |
| `preview/kitchen-sink` | `apps/kitchen-sink` | The Next.js demo app |
| `preview/docs`         | `apps/docs`     | The Docusaurus docs site |
| `preview/storybook`    | `packages/ui`   | The component Storybook |

Each target is a separate Vercel project.

## How to use it

1. Open (or push) a PR.
2. Add one or more of the `preview/*` labels.
3. The [`Preview Deploy`](../../.github/workflows/preview-deploy.yml) workflow
   builds that target from your branch and **posts a status as a PR comment** —
   one sticky comment per target, updated in place on each redeploy. On success
   it shows the deployment URL; if the deploy is skipped (missing secrets) or
   fails, the same comment links to the run so each label stays individually
   traceable. Each label runs as its own independent deployment — adding a
   second label never disturbs the first.
4. While the label stays applied, new commits redeploy that target
   automatically (the `synchronize` event). Remove the label to stop.

To force a fresh deploy without pushing a commit, remove the label and re-add it.

## Why it works this way

Vercel's git auto-deploys are disabled at the source, via `git.deploymentEnabled: false`
in each project's `vercel.json` (`apps/kitchen-sink`, `apps/docs`, `packages/ui`).
We deliberately avoid the **Ignored Build Step** mechanism — in practice it
produces stuck "waiting for deployment" / phantom-canceled checks that block
merges. With the git integration off, the only thing that creates a deployment
is the GitHub Action, which builds locally in the runner and uploads prebuilt
artifacts (`vercel build` + `vercel deploy --prebuilt`), so Vercel never runs
its own build.

## One-time setup

### 1. GitHub secrets

Add these under **Settings → Secrets and variables → Actions**:

| Secret | Value |
| ------ | ----- |
| `VERCEL_TOKEN` | A Vercel access token (Vercel → Account Settings → Tokens) |
| `VERCEL_ORG_ID` | Your Vercel org/team ID (shared across all three projects) |
| `VERCEL_PROJECT_ID_KITCHEN_SINK` | Project ID for the kitchen-sink project |
| `VERCEL_PROJECT_ID_DOCS` | Project ID for the docs project |
| `VERCEL_PROJECT_ID_STORYBOOK` | Project ID for the storybook project |

Get the IDs by linking each project locally once and reading `.vercel/project.json`:

```bash
# from the target's root directory, e.g. apps/docs
vercel link            # pick the matching Vercel project
cat .vercel/project.json   # -> { "orgId": "...", "projectId": "..." }
```

`orgId` is the same for all three (that's `VERCEL_ORG_ID`); each `projectId`
maps to the corresponding `VERCEL_PROJECT_ID_*` secret. Don't commit `.vercel/`.

### 2. Create the labels

Create the three labels in **Issues → Labels** (or they can be added to a PR
from the label picker once they exist):
`preview/kitchen-sink`, `preview/docs`, `preview/storybook`.

### 3. Let Vercel pick up the disabled git integration

After the `vercel.json` change merges, trigger one deployment per project (a
label-gated preview is enough) so Vercel registers `git.deploymentEnabled:
false`. Then confirm the Vercel dashboard no longer creates deployments on push.

### 4. Remove any required Vercel status check

If branch protection on `main` requires a Vercel deployment status check, remove
it — no deployment runs automatically anymore, so that check would block every
merge waiting for a deploy that never starts.

## Changing the behavior

- **Deploy only on the exact commit that was labeled** (no redeploy on later
  commits): drop `synchronize` from the workflow's `on.pull_request.types`,
  leaving just `[labeled]`. Re-adding the label becomes the only way to redeploy.
- **Add a target**: add an entry to the `MAP` in the `prepare` job, add the
  matching `VERCEL_PROJECT_ID_*` secret and the `case` branch in
  `Resolve Vercel project id`, and set `git.deploymentEnabled: false` in that
  project's `vercel.json`.
