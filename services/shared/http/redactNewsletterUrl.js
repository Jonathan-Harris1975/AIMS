export function redactNewsletterUrl(value) {
  const url = String(value || '');
  return url.replace(/(\/newsletter\/(?:confirm|unsubscribe)\/).*$/, '$1[redacted]');
}
