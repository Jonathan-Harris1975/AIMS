/** Compare KDP editor HTML, public text and website HTML using the same entity rules. */
export function normaliseDescription(value) {
  const entities = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ',
    ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', hellip: '…' };
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, name) => {
    if (!name.startsWith('#')) return entities[name.toLowerCase()] ?? whole;
    const code = name[1].toLowerCase() === 'x' ? parseInt(name.slice(2), 16) : Number(name.slice(1));
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : whole;
  }).normalize('NFKC').replace(/\s+/g, ' ').trim();
}

export function currentKdpPrice(book, currency) {
  return currency === 'USD' ? book.listPriceUsd || book.prices?.USD || book.prices?.US || ''
    : book.prices?.GBP || book.prices?.GB || book.prices?.UK || '';
}
