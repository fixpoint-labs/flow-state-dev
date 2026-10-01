import { readSeatSkills } from "@flow-state-dev/workforce/loader";

// The caller identifies the seat it is already building. Folder placement
// determines the union: organization + pentest team + recon worker.
const { skills, errors } = await readSeatSkills("./workforce", {
  team: "pentest",
  worker: "recon",
});

if (errors.length > 0)
  throw new AggregateError(errors.map(({ error }) => error));
createSkillsCapability({ initialSkills: skills });
