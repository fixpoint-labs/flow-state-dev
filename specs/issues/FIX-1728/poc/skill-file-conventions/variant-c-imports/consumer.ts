import { readWorkerWithSkills } from "@flow-state-dev/workforce/loader";

// The seat manifest is now the source of truth for its complete inventory.
const { worker, skills, errors } = await readWorkerWithSkills(
  "./workforce/teams/pentest/workers/recon/WORKER.md",
);

if (errors.length > 0)
  throw new AggregateError(errors.map(({ error }) => error));
hireWorker(worker, {
  skills: createSkillsCapability({ initialSkills: skills }),
});
