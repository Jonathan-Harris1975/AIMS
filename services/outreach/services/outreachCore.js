const KEY = process.env.RAPID_API_KEY;

async function rapid(url, host, params) {
  if (!KEY) throw new Error("RAPID_API_KEY missing");

  const u = new URL(url);
  Object.entries(params || {}).forEach(([k, v]) => u.searchParams.set(k, v));

  const r = await fetch(u, {
    headers: {
      "x-rapidapi-key": KEY,
      "x-rapidapi-host": host
    }
  });

  if (!r.ok) throw new Error(`RapidAPI ${host} ${r.status}`);
  return r.json();
}

export const serpLookup = q =>
  rapid("https://serpapi.p.rapidapi.com/search", "serpapi.p.rapidapi.com", {
    engine: "google",
    q,
    hl: "en",
    gl: "gb"
  });

export const getDomainAuthority = domain =>
  rapid("https://domain-da-pa-check2.p.rapidapi.com/check",
    "domain-da-pa-check2.p.rapidapi.com",
    { domain });

export const findEmails = website =>
  rapid("https://email-address-finder1.p.rapidapi.com/emailjob",
    "email-address-finder1.p.rapidapi.com",
    { website });

export const validateEmail = email =>
  rapid("https://easy-email-validation.p.rapidapi.com/validate-v2",
    "easy-email-validation.p.rapidapi.com",
    { email });

export async function outreachScan(domain) {
  const da = await getDomainAuthority(domain);
  const found = await findEmails(domain);
  const emails = found?.emails || [];

  const validated = [];
  for (const e of emails) {
    const v = await validateEmail(e);
    validated.push({
      email: e,
      valid: v?.status === "valid",
      score: v?.score
    });
  }

  return { domain, da, emails: validated };
}
