// src/utils/filters.js

/**
 * Extracts viable outreach leads from serpOutreach result
 * Designed to be permissive early, strict later.
 */
export function extractGoodLeads(outreachResult, keyword) {
  // Tuned for discovery → validation → outreach
  const MIN_LEAD_SCORE = 12;     // lowered to allow flow
  const MIN_EMAIL_SCORE = 0.3;   // allows catch-all / unknown

  const out = [];

  if (
    !outreachResult ||
    !Array.isArray(outreachResult.domains)
  ) {
    return out;
  }

  outreachResult.domains.forEach((d, idx) => {
    if (!d || d.blocked) return;

    // --- Lead scoring ---
    let leadScore = 0;

    // Editorial surface is the strongest signal
    if (d.editorial?.hasEditorialSurface) leadScore += 15;

    // Editorial signals depth
    const sigCount = Array.isArray(d.editorial?.signals)
      ? d.editorial.signals.length
      : 0;
    leadScore += Math.min(sigCount * 2, 10);

    // Domain info exists (urlscan succeeded)
    if (d.domainInfo) leadScore += 5;

    // Penalty: zero emails found
    if (!Array.isArray(d.emails) || d.emails.length === 0) {
      leadScore -= 10;
    }

    if (leadScore < MIN_LEAD_SCORE) return;

    // --- Email scoring ---
    d.emails.forEach((e) => {
      if (!e || !e.email) return;

      const status = e.validation?.status || "unknown";

      // Map ZeroBounce status → numeric confidence
      let emailScore = 0.25;
      if (status === "valid") emailScore = 1;
      else if (status === "catch-all") emailScore = 0.55;
      else if (status === "unknown") emailScore = 0.35;
      else emailScore = 0.1; // invalid / abuse / spamtrap

      if (emailScore < MIN_EMAIL_SCORE) return;

      out.push({
        timestamp: new Date().toISOString(),
        keyword,
        domain: d.domain,
        da: null,                 // DA optional / external
        serpPosition: idx + 1,    // relative SERP position
        email: e.email,
        emailScore,
        leadScore,
        editorialSignals: d.editorial?.signals || [],
      });
    });
  });

  return out;
      }
