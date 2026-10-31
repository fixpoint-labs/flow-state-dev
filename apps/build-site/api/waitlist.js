/**
 * Waitlist signup for flow-state.build, deployed as a Vercel Function at
 * `/api/waitlist`. Adds the email as a Resend contact, in the segment named by
 * `RESEND_SEGMENT_ID` when set, so the launch email goes out from Resend.
 *
 * Env: `RESEND_API_KEY` (required), `RESEND_SEGMENT_ID` (optional).
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Handles `POST { email, company }`; `company` is a honeypot only bots fill in. */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    body = null;
  }
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (body.company) return Response.json({ ok: true });

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (email.length > 254 || !EMAIL.test(email)) {
    return Response.json({ error: "Enter an email address like you@yourcompany.com." }, { status: 400 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("waitlist: RESEND_API_KEY is not set");
    return Response.json({ error: "Signups are not open yet." }, { status: 500 });
  }

  const segment = process.env.RESEND_SEGMENT_ID;
  const res = await fetch("https://api.resend.com/contacts", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ email, ...(segment ? { segments: [{ id: segment }] } : {}) }),
  });

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    // Signing up twice is still a signup.
    if (/already exists/i.test(detail.message ?? "")) return Response.json({ ok: true });
    // Resend's message can echo the email back, so log only the status and error name.
    console.error(`waitlist: Resend returned ${res.status} ${detail.name ?? "unknown_error"}`);
    return Response.json({ error: "Something went wrong. Try again in a minute." }, { status: 502 });
  }

  return Response.json({ ok: true });
}
