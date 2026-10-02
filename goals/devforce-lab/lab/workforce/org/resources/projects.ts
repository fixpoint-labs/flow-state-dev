/**
 * The organization's projects, and the talk template every project's room is
 * minted from: the seats a post in the room wakes, and the room's charter.
 *
 * A project belongs to the organization and names no team. Its workstreams
 * come from any team, and so do the template's seats. `chief-of-staff` is the
 * org seat that joins every room once the Lab hires one; until then a post
 * wakes the EM alone.
 */
import { defineProjectsCollection } from "@flow-state-dev/workforce";

export default defineProjectsCollection({
  talk: {
    seats: ["eng.em", "chief-of-staff"],
    charter: "Say what the project needs next, and who is on it. The EM reads every line.",
  },
});
