/**
 * Static 8-K item-code classifier — maps SEC item codes to typed,
 * signal-ranked material events. Pure module, no IO.
 *
 * Item codes follow the modern decimal format (X.YY) effective 2004-08-23.
 * Signal tiers derive from Lerman & Livnat (2010) and SEC red-flag guidance.
 */

export type Signal = "high" | "medium" | "low";

export type MaterialEventItem = {
  code: string;
  label: string;
  title: string;
  signal: Signal;
};

const ITEM_CODE_MAP: Record<string, { label: string; title: string; signal: Signal }> = {
  // Section 1 — Registrant's Business and Operations
  "1.01": { label: "material-agreement", title: "Entry into a Material Definitive Agreement", signal: "high" },
  "1.02": { label: "termination-of-agreement", title: "Termination of a Material Definitive Agreement", signal: "high" },
  "1.03": { label: "bankruptcy", title: "Bankruptcy or Receivership", signal: "high" },
  "1.04": { label: "mine-safety", title: "Mine Safety — Reporting of Shutdowns and Patterns of Violations", signal: "low" },
  "1.05": { label: "cybersecurity-incident", title: "Material Cybersecurity Incidents", signal: "high" },

  // Section 2 — Financial Information
  "2.01": { label: "acquisition-disposition", title: "Completion of Acquisition or Disposition of Assets", signal: "high" },
  "2.02": { label: "earnings", title: "Results of Operations and Financial Condition", signal: "high" },
  "2.03": { label: "direct-obligation", title: "Creation of a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement", signal: "medium" },
  "2.04": { label: "triggering-events", title: "Triggering Events That Accelerate or Increase a Direct Financial Obligation or an Obligation under an Off-Balance Sheet Arrangement", signal: "high" },
  "2.05": { label: "exit-costs", title: "Costs Associated with Exit or Disposal Activities", signal: "high" },
  "2.06": { label: "impairment", title: "Material Impairments", signal: "high" },

  // Section 3 — Securities and Trading Markets
  "3.01": { label: "delisting", title: "Notice of Delisting or Failure to Satisfy a Continued Listing Rule or Standard; Transfer of Listing", signal: "high" },
  "3.02": { label: "unregistered-equity-sale", title: "Unregistered Sales of Equity Securities", signal: "medium" },
  "3.03": { label: "rights-amendment", title: "Material Modification to Rights of Security Holders", signal: "medium" },

  // Section 4 — Matters Related to Accountants and Financial Statements
  "4.01": { label: "auditor-change", title: "Changes in Registrant's Certifying Accountant", signal: "high" },
  "4.02": { label: "restatement", title: "Non-Reliance on Previously Issued Financial Statements or a Related Audit Report or Completed Interim Review", signal: "high" },

  // Section 5 — Corporate Governance and Management
  "5.01": { label: "change-in-control", title: "Changes in Control of Registrant", signal: "high" },
  "5.02": { label: "leadership-change", title: "Departure of Directors or Certain Officers; Election of Directors; Appointment of Certain Officers; Compensatory Arrangements of Certain Officers", signal: "high" },
  "5.03": { label: "bylaw-amendment", title: "Amendments to Articles of Incorporation or Bylaws; Change in Fiscal Year", signal: "low" },
  "5.04": { label: "temporary-suspension", title: "Temporary Suspension of Trading Under Registrant's Employee Benefit Plans", signal: "low" },
  "5.05": { label: "ethics-amendment", title: "Amendments to the Registrant's Code of Ethics, or Waiver of a Provision of the Code of Ethics", signal: "low" },
  "5.06": { label: "shell-company-change", title: "Change in Shell Company Status", signal: "medium" },
  "5.07": { label: "shareholder-vote", title: "Submission of Matters to a Vote of Security Holders", signal: "low" },
  "5.08": { label: "shareholder-director-nominees", title: "Shareholder Director Nominations", signal: "low" },

  // Section 6 — Asset-Backed Securities
  "6.01": { label: "abs-info", title: "ABS Informational and Computational Material", signal: "low" },
  "6.02": { label: "abs-change", title: "Change of Servicer or Trustee", signal: "low" },
  "6.03": { label: "abs-credit-enhancement", title: "Change in Credit Enhancement or Other External Support", signal: "low" },
  "6.04": { label: "abs-failure", title: "Failure to Make a Required Distribution", signal: "low" },
  "6.05": { label: "abs-performance-trigger", title: "Securities Act Updating Disclosure", signal: "low" },

  // Section 7 — Regulation FD
  "7.01": { label: "reg-fd", title: "Regulation FD Disclosure", signal: "medium" },

  // Section 8 — Other Events
  "8.01": { label: "other-event", title: "Other Events", signal: "medium" },

  // Section 9 — Financial Statements and Exhibits
  "9.01": { label: "exhibits", title: "Financial Statements and Exhibits", signal: "low" },
};

/**
 * Parse a comma-separated 8-K items string into typed, signal-ranked events.
 * Returns [] for empty/null input. Unknown or legacy codes map to "other"/low.
 */
export function classifyItems(itemsField: string): MaterialEventItem[] {
  if (!itemsField) return [];
  return itemsField.split(",").map((raw) => {
    const code = raw.trim();
    const entry = ITEM_CODE_MAP[code];
    if (entry) return { code, ...entry };
    return { code, label: "other", title: "Other event", signal: "low" as Signal };
  });
}
