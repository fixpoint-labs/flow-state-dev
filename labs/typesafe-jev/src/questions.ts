/**
 * Ticket-triage question set used by the demo flow.
 *
 * One call, three primitives: route (choice), urgency (noul/boolean), frustration (score).
 */

import { choice, noul, score } from "./schemas";

export const TICKET_QUESTIONS = {
  department: choice("Which team should handle `message`?", {
    billing: "Payments, invoicing, refunds, charges",
    technical: "Bugs, outages, integrations",
    sales: "Pricing, upgrades, new accounts",
  }),
  is_urgent: noul("Does `message` convey urgency?", {
    true: "Explicitly time-sensitive",
    false: "No urgency expressed",
  }),
  frustration: score("How frustrated is the customer in `message`?", [
    "Calm",
    "Frustrated",
    "Very angry",
  ]),
} as const;

export type TicketQuestions = typeof TICKET_QUESTIONS;
