/**
 * EDGAR filings provider — submissions list, document text extraction,
 * and full-text red-flag probes via EFTS.
 *
 * Reuses the shared CIK resolution and User-Agent from `providers/edgar.ts`.
 * Tools using this helper: get_sec_filings.
 */
import { resolveCik, USER_AGENT } from "./edgar";
import { classifyItems, type MaterialEventItem } from "./eight-k-items";
import { REGISTRATION_FORMS } from "./edgar-registration";

const SUBMISSIONS_BASE = "https://data.sec.gov/submissions";
const ARCHIVES_BASE = "https://www.sec.gov/Archives/edgar/data";
const EFTS_BASE = "https://efts.sec.gov/LATEST/search-index";

const PERIODIC_FORMS = new Set(["10-K", "10-K/A", "10-Q", "10-Q/A", "8-K", "8-K/A"]);
const EIGHT_K_FORMS = new Set(["8-K", "8-K/A"]);
const MAX_RECENT = 8;
const LOOKBACK_DAYS = 90;
const MAX_EVENTS = 12;
const SECTION_CAP = 6000;

const RED_FLAG_TERMS = [
  "going concern",
  "material weakness",
  "restatement",
  "covenant",
  "litigation",
  "dilution",
] as const;

type FilingEntry = {
  form: string;
  filingDate: string;
  title: string;
  url: string;
};

type RedFlagProbe = {
  term: string;
  hit: boolean;
  snippet: string | null;
};

type LatestPeriodic = {
  form: string;
  filingDate: string;
  url: string;
  riskFactors: string | null;
  mdna: string | null;
};

export type MaterialEvent = {
  filingDate: string;
  form: string;
  title: string;
  url: string;
  events: MaterialEventItem[];
};

export type EdgarFilingsPayload = {
  source: "edgar" | "fixture" | "unavailable";
  ticker: string;
  asOf: string;
  recentFilings: FilingEntry[];
  // Registration / prospectus primary documents (S-1, 424B*, F-1*), kept apart
  // from `recentFilings` so the periodic MD&A / red-flag consumers are unchanged
  // (FIX-898). Surfaces IPO disclosure as primary for newly listed issuers.
  registrationFilings: FilingEntry[];
  materialEvents: MaterialEvent[];
  latestPeriodic: LatestPeriodic | null;
  redFlagProbes: RedFlagProbe[];
};

async function edgarFetch(url: string): Promise<Response> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`EDGAR ${url} failed: HTTP ${res.status}`);
  return res;
}

/** Fetch the submissions list for a ticker. */
async function fetchSubmissions(ticker: string, date: string): Promise<{
  cik: number;
  recentFilings: FilingEntry[];
  registrationFilings: FilingEntry[];
  materialEvents: MaterialEvent[];
}> {
  const paddedCik = await resolveCik(ticker);
  const res = await edgarFetch(`${SUBMISSIONS_BASE}/CIK${paddedCik}.json`);
  const data = (await res.json()) as {
    cik: number;
    filings?: {
      recent?: {
        form?: string[];
        filingDate?: string[];
        accessionNumber?: string[];
        primaryDocument?: string[];
        primaryDocDescription?: string[];
        items?: string[];
      };
    };
  };
  const recent = data.filings?.recent;
  if (!recent?.form) {
    return { cik: data.cik, recentFilings: [], registrationFilings: [], materialEvents: [] };
  }

  const cutoff = windowCutoff(date, LOOKBACK_DAYS);
  const entries: FilingEntry[] = [];
  const registrationFilings: FilingEntry[] = [];
  const materialEvents: MaterialEvent[] = [];
  const len = recent.form.length;

  for (let i = 0; i < len; i++) {
    const form = recent.form[i];
    const isPeriodic = PERIODIC_FORMS.has(form);
    const isRegistration = REGISTRATION_FORMS.has(form);
    if (!isPeriodic && !isRegistration) continue;
    const accession = (recent.accessionNumber?.[i] ?? "").replace(/-/g, "");
    const primaryDoc = recent.primaryDocument?.[i] ?? "";
    const url = `${ARCHIVES_BASE}/${data.cik}/${accession}/${primaryDoc}`;
    const filingDate = recent.filingDate?.[i] ?? "";
    const title = recent.primaryDocDescription?.[i] ?? form;

    // Registration primaries go in the sibling list (never fed to the periodic
    // MD&A / red-flag extractors); periodic forms keep the existing behavior.
    if (isRegistration) {
      if (registrationFilings.length < MAX_RECENT) {
        registrationFilings.push({ form, filingDate, title, url });
      }
      continue;
    }

    if (entries.length < MAX_RECENT) {
      entries.push({ form, filingDate, title, url });
    }

    if (
      materialEvents.length < MAX_EVENTS &&
      EIGHT_K_FORMS.has(form) &&
      filingDate >= cutoff
    ) {
      const itemsField = recent.items?.[i] ?? "";
      const events = classifyItems(itemsField);
      if (events.length > 0) {
        materialEvents.push({ filingDate, form, title, url, events });
      }
    }
  }

  return { cik: data.cik, recentFilings: entries, registrationFilings, materialEvents };
}

/** Extract a section from filing HTML by item header pattern. */
function extractSection(html: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match) {
      const start = match.index + match[0].length;
      const slice = html.slice(start, start + SECTION_CAP * 3);
      const text = slice
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, SECTION_CAP);
      if (text.length > 100) return text;
    }
  }
  return null;
}

const RISK_FACTORS_PATTERNS = [
  /Item\s+1A[\.\s]*Risk\s+Factors/i,
];
const MDNA_PATTERNS = [
  /Item\s+7[\.\s]*Management'?s\s+Discussion/i,
  /Item\s+2[\.\s]*Management'?s\s+Discussion/i,
];

/** Fetch the latest periodic filing and extract key sections. */
async function fetchLatestPeriodic(
  filings: FilingEntry[],
): Promise<LatestPeriodic | null> {
  const periodic = filings.find((f) =>
    f.form === "10-K" || f.form === "10-K/A" || f.form === "10-Q" || f.form === "10-Q/A"
  );
  if (!periodic) return null;
  try {
    const res = await edgarFetch(periodic.url);
    const html = await res.text();
    return {
      form: periodic.form,
      filingDate: periodic.filingDate,
      url: periodic.url,
      riskFactors: extractSection(html, RISK_FACTORS_PATTERNS),
      mdna: extractSection(html, MDNA_PATTERNS),
    };
  } catch {
    return {
      form: periodic.form,
      filingDate: periodic.filingDate,
      url: periodic.url,
      riskFactors: null,
      mdna: null,
    };
  }
}

/** Run EFTS full-text red-flag probes. */
async function probeRedFlags(
  cik: number,
): Promise<RedFlagProbe[]> {
  const paddedCik = String(cik).padStart(10, "0");
  const startdt = thirtyMonthsAgo();
  return Promise.all(
    RED_FLAG_TERMS.map(async (term) => {
      try {
        const url = `${EFTS_BASE}?q=%22${encodeURIComponent(term)}%22&dateRange=custom&startdt=${startdt}&forms=10-K,10-Q&ciks=${paddedCik}`;
        const res = await edgarFetch(url);
        const data = (await res.json()) as { hits?: { total?: { value?: number }; hits?: Array<{ _source?: { file_description?: string } }> } };
        const total = data.hits?.total?.value ?? 0;
        const snippet = data.hits?.hits?.[0]?._source?.file_description ?? null;
        return { term, hit: total > 0, snippet };
      } catch {
        return { term, hit: false, snippet: null };
      }
    }),
  );
}

function thirtyMonthsAgo(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - 30);
  return d.toISOString().slice(0, 10);
}

function windowCutoff(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Full filings fetch: submissions + latest periodic extraction + red-flag probes. */
export async function fetchEdgarFilings(
  ticker: string,
  date: string,
): Promise<EdgarFilingsPayload> {
  const { cik, recentFilings, registrationFilings, materialEvents } =
    await fetchSubmissions(ticker, date);
  const [latestPeriodic, redFlagProbes] = await Promise.all([
    fetchLatestPeriodic(recentFilings),
    probeRedFlags(cik),
  ]);
  return {
    source: "edgar" as const,
    ticker,
    asOf: date,
    recentFilings,
    registrationFilings,
    materialEvents,
    latestPeriodic,
    redFlagProbes,
  };
}
