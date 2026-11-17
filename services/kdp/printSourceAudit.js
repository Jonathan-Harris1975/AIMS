// Read-only, conservative geometry inventory for the existing ReportLab source PDFs.
// This is NOT a replacement for PDF parser, print typography QA or KDP previewer approval.
export const PRINT_INTERIOR_TARGET_POINTS = Object.freeze({ width: 432, height: 648 }); // 6 x 9 in

export function inspectPrintSourcePdf(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100) {
    return { ok: false, reason: "missing_or_short_pdf" };
  }
  const bytes = buffer.toString("latin1");
  if (!bytes.startsWith("%PDF-") || !bytes.includes("%%EOF")) {
    return { ok: false, reason: "invalid_pdf_structure" };
  }
  if (/\/Encrypt\b/.test(bytes)) return { ok: false, reason: "encrypted_pdf" };
  // These source files were made by ReportLab, which emits a plain /Type /Page
  // object and /MediaBox for each page. Object-stream/compressed/inherited page
  // dictionaries are deliberately rejected as unknown rather than miscounted.
  const pages = [...bytes.matchAll(/\/Type\s*\/Page\b/g)].length;
  const boxes = [...bytes.matchAll(
    /\/MediaBox\s*\[\s*(-?[0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s+(-?[0-9.]+)\s*\]/g,
  )].map((match) => match.slice(1).map(Number));
  if (!pages || pages > 10000 || boxes.length !== pages ||
      boxes.some((box) => !box.every(Number.isFinite))) {
    return { ok: false, reason: "unverified_page_tree_or_mediabox" };
  }
  const pageSizes = boxes.map(([x1, y1, x2, y2]) => ({
    width: Number((x2 - x1).toFixed(2)),
    height: Number((y2 - y1).toFixed(2)),
  }));
  const first = pageSizes[0];
  if (pageSizes.some(({ width, height }) => width <= 0 || height <= 0 ||
      Math.abs(width - first.width) > 0.05 || Math.abs(height - first.height) > 0.05)) {
    return { ok: false, reason: "mixed_page_sizes", observedPageCount: pages };
  }
  const geometryMatchesTarget =
    Math.abs(first.width - PRINT_INTERIOR_TARGET_POINTS.width) <= 0.05 &&
    Math.abs(first.height - PRINT_INTERIOR_TARGET_POINTS.height) <= 0.05;
  return {
    ok: true,
    observedPageCount: pages,
    pageWidthPt: first.width,
    pageHeightPt: first.height,
    geometryMatchesTarget,
    requiresReflow: !geometryMatchesTarget,
    sourceBytes: buffer.length,
    // True here only means the source geometry can enter full print QA.
    printQaPassed: false,
    inspectionMethod: "reportlab_plain_page_objects",
  };
}
