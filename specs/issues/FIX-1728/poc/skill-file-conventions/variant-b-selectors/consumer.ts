import { readWorkforceSkills } from "@flow-state-dev/workforce/loader";

// The loader must parse and evaluate a Workforce-specific selector language.
const { skills, errors } = await readWorkforceSkills("./workforce/skills", {
  team: "pentest",
  worker: "recon",
});

if (errors.length > 0)
  throw new AggregateError(errors.map(({ error }) => error));
createSkillsCapability({ initialSkills: skills });
