import getSponsor from "../../script/utils/getSponsor.js";

function cleanString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normaliseKeywords(value) {
  if (Array.isArray(value)) {
    return value.map((item) => cleanString(item)).filter(Boolean).join(", ");
  }
  return cleanString(value);
}

export function normaliseFeaturedBook(input = {}) {
  const title = cleanString(input.title);
  const bookUrl = cleanString(input.bookUrl || input.url || input.buyUrl || input.canonicalUrl);

  return {
    title,
    shortDescription: cleanString(input.shortDescription || input.short || input.description),
    summary: cleanString(input.summary || input.longDescription || input.description || input.shortDescription || input.short),
    keywords: normaliseKeywords(input.keywords || input.tags),
    audience: cleanString(input.audience),
    whoThisBookIsFor: cleanString(input.whoThisBookIsFor),
    whatThisBookCovers: cleanString(input.whatThisBookCovers),
    whatYouWillLearn: cleanString(input.whatYouWillLearn),
    whyItMatters: cleanString(input.whyItMatters),
    bookUrl,
    coverArtUrl: cleanString(input.coverArtUrl || input.imageUrl),
    manuscriptPdfUrl: cleanString(input.manuscriptPdfUrl),
    source: cleanString(input.source) || "request",
    selection: input.selection && typeof input.selection === "object" ? input.selection : null,
  };
}

function assertUsableFeaturedBook(featuredBook, sourceLabel) {
  if (!featuredBook.title) {
    const err = new Error(`${sourceLabel} did not provide featuredBook.title`);
    err.statusCode = 502;
    throw err;
  }

  if (!featuredBook.bookUrl) {
    const err = new Error(`${sourceLabel} did not provide featuredBook.bookUrl`);
    err.statusCode = 502;
    throw err;
  }
}

export async function resolveFeaturedBookForEbooks(options = {}) {
  if (options.featuredBook && typeof options.featuredBook === "object") {
    const featuredBook = normaliseFeaturedBook(options.featuredBook);
    assertUsableFeaturedBook(featuredBook, "Request body");
    return { featuredBook, warnings: [] };
  }

  const sponsor = await getSponsor({
    apiUrl: options.featuredBookApiUrl,
    timeout: options.featuredBookTimeoutMs,
  });

  if (!sponsor || sponsor.source === "fallback") {
    const err = new Error(
      "Featured book automation could not load a valid book from the podcast featured-book source. Fix FEATURED_BOOK_API_URL or pass featuredBook explicitly for a dry run."
    );
    err.statusCode = 502;
    throw err;
  }

  const featuredBook = normaliseFeaturedBook({
    ...sponsor,
    bookUrl: sponsor.url || sponsor.buyUrl || sponsor.canonicalUrl,
    coverArtUrl: sponsor.coverArtUrl,
  });
  assertUsableFeaturedBook(featuredBook, "Featured-book API");

  const warnings = [];
  if (!featuredBook.coverArtUrl) {
    warnings.push("The featured-book API did not include a coverArtUrl, so ebook posts will be scheduled without a cover image.");
  }

  return { featuredBook, warnings };
}
