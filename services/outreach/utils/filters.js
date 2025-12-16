export function extractGoodLeads(outreachResult, keyword) {
  const MIN_LEAD_SCORE = 60;
  const MIN_EMAIL_SCORE = 0.85;

  const out = [];

  outreachResult.leads.forEach(lead => {
    if (lead.score < MIN_LEAD_SCORE) return;

    const da = lead?.da?.da || 0;

    lead.emails.forEach(email => {
      if (!email.valid) return;
      if (typeof email.score !== "number") return;
      if (email.score < MIN_EMAIL_SCORE) return;

      out.push({
        timestamp: new Date().toISOString(),
        keyword,
        domain: lead.domain,
        da,
        serpPosition: lead.serpPosition,
        email: email.email,
        emailScore: email.score,
        leadScore: lead.score
      });
    });
  });

  return out;
      }
