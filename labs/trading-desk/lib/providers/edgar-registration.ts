/**
 * EDGAR registration / prospectus discovery — the deterministic first tier of
 * the critical-financials recovery ladder (FIX-898).
 *
 * A newly listed issuer (the SPCX failure mode) has audited financial
 * statements in its IPO prospectus (S-1 / 424B*) but not yet in periodic XBRL,
 * so `companyfacts` — which aggregates 10-K/10-Q facts — returns nothing for
 * it. The periodic filings provider (`edgar-filings.ts`) filters those forms
 * out too. This module surfaces the registration primary documents that carry
 * the audited statements so recovery can extract typed numbers from them.
 *
 * `REGISTRATION_FORMS` is a SEPARATE allowlist from `edgar-filings.ts`'s
 * `PERIODIC_FORMS`, so the MD&A / red-flag / 8-K extractors are untouched — a
 * prospectus is never fed to `latestPeriodic`. Reuses the shared CIK
 * resolution + User-Agent from `edgar.ts`; the fetch helpers throw on any
 * failure so the recovery runtime can `try/catch` and record an honest audit.
 */
import { resolveCik, USER_AGENT } from "./edgar";

const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";
const ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data";

/**
 * Forms eligible for IPO / registration primary-document recovery. Covers the
 * S-1 family (US domestic), the full 424B prospectus family (the design
 * promises `424B*` — every prospectus variant, not just 424B3/424B4), and the
 * F-1 family (foreign private issuers). Follow-on registrations (S-3 / F-3) are
 * out of scope in v1: they rarely restate full audited statements the way an
 * IPO prospectus does.
 */
export const REGISTRATION_FORMS = new Set([
  "S-1",
  "S-1/A",
  "424B1",
  "424B2",
  "424B3",
  "424B4",
  "424B5",
  "424B7",
  "424B8",
  "F-1",
  "F-1/A",
]);

/**
 * Preference rank for registration forms (lower = preferred). The final
 * prospectus (424B4/424B3) carries the priced, audited statements and is
 * preferred over the pre-effective S-1; a later amendment (S-1/A) is preferred
 * over the original S-1; the F-1 family backstops foreign private issuers.
 * Same-rank ties break on `filingDate` (latest first).
 */
function formRank(form: string): number {
  switch (form) {
    case "424B4":
      return 0;
    case "424B3":
      return 1;
    case "424B1":
    case "424B2":
    case "424B5":
    case "424B7":
    case "424B8":
      return 2;
    case "S-1/A":
      return 3;
    case "S-1":
      return 4;
    case "F-1/A":
      return 5;
    case "F-1":
      return 6;
    default:
      return 99;
  }
}

export type RegistrationCandidate = {
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  /** SEC Archives URL of the primary document. */
  url: string;
  cik: number;
  companyName: string;
};

/** The subset of the submissions `filings.recent` arrays this module reads. */
export type RecentSubmissions = {
  form?: string[];
  filingDate?: string[];
  accessionNumber?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
};

/**
 * Pure selector: pick and rank registration candidates from the raw
 * submissions arrays. Filed on or before `date` (a candidate filed after the
 * run's as-of date is future information — excluded), deduped to the eligible
 * forms, sorted by form preference then recency. Kept pure so the ranking is
 * unit-testable without a network fetch.
 */
export function selectRegistrationCandidates(
  recent: RecentSubmissions,
  cik: number,
  companyName: string,
  date: string,
  limit: number,
): RegistrationCandidate[] {
  const forms = recent.form ?? [];
  const candidates: RegistrationCandidate[] = [];
  for (let i = 0; i < forms.length; i++) {
    const form = forms[i];
    if (!REGISTRATION_FORMS.has(form)) continue;
    const filingDate = recent.filingDate?.[i] ?? "";
    // Lexical compare is valid for YYYY-MM-DD; a filing after the as-of date is
    // information the run should not have had.
    if (filingDate && date && filingDate > date) continue;
    const accession = (recent.accessionNumber?.[i] ?? "").replace(/-/g, "");
    const primaryDocument = recent.primaryDocument?.[i] ?? "";
    if (!accession || !primaryDocument) continue;
    candidates.push({
      form,
      filingDate,
      accessionNumber: accession,
      primaryDocument,
      url: `${ARCHIVES_BASE}/${cik}/${accession}/${primaryDocument}`,
      cik,
      companyName,
    });
  }
  candidates.sort((a, b) => {
    const rankDelta = formRank(a.form) - formRank(b.form);
    if (rankDelta !== 0) return rankDelta;
    return b.filingDate.localeCompare(a.filingDate);
  });
  return candidates.slice(0, limit);
}

async function edgarFetch(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`EDGAR ${url} failed: HTTP ${res.status}`);
  return res;
}

/**
 * Discover the preferred registration/prospectus primary documents for a
 * ticker, newest-and-most-authoritative first. Throws when the ticker has no
 * SEC CIK (non-US, no submissions) so the recovery runtime records
 * `no-candidates` honestly.
 */
export async function fetchRegistrationCandidates(
  ticker: string,
  date: string,
  limit = 3,
): Promise<RegistrationCandidate[]> {
  const paddedCik = await resolveCik(ticker);
  const res = await edgarFetch(`${SUBMISSIONS_BASE}/CIK${paddedCik}.json`);
  const data = (await res.json()) as {
    cik?: number;
    name?: string;
    filings?: { recent?: RecentSubmissions };
  };
  const recent = data.filings?.recent;
  const cik = data.cik ?? Number(paddedCik);
  if (!recent?.form) return [];
  return selectRegistrationCandidates(recent, cik, data.name ?? "", date, limit);
}

/**
 * Fetch a prospectus primary document as raw HTML text. The SEC Archives serve
 * the document verbatim; the caller (deterministic + LLM extractors) reads the
 * financial tables out of it. Throws on any non-2xx.
 */
export async function fetchProspectusPrimaryHtml(url: string): Promise<string> {
  const res = await edgarFetch(url);
  return res.text();
}
