// Print production from private source PDFs and the existing ImageKit artwork.
// Reflow is allowed only for text-only PDFs. Image/table-heavy material fails
// closed rather than silently discarding content during a format conversion.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { launchKdpBrowser } from "./engine/browser.ts";
import { getObjectAsBuffer, uploadPrivateBuffer, putPrivateJson } from "../shared/utils/r2-client.js";

const exec = promisify(execFile);
const IN = 72;
const W = 6;
const H = 9;
const SOURCE_LIMIT = 40 * 1024 * 1024;
const COVER_LIMIT = 12 * 1024 * 1024;
const allowedFormats = new Set(["paperback", "hardcover"]);

export function calculatePrintCover(format, pages) {
  if (!allowedFormats.has(format) || !Number.isInteger(pages) || pages < 24 || pages > 828) {
    throw new TypeError("Invalid print format or final interior page count.");
  }
  if (format === "hardcover" && (pages < 75 || pages > 550)) {
    throw new Error("Hardcover interior must contain 75–550 pages.");
  }
  const paperThickness = 0.002252; // Black ink / white paper; KDP paperback specification.
  const spine = format === "paperback" ? pages * paperThickness : pages * paperThickness + 0.189;
  const outer = format === "paperback" ? 0.125 : 0.591; // Paperback bleed / hardcover case wrap.
  const panelW = format === "paperback" ? W : W + 0.197;
  const panelH = format === "paperback" ? H : H + 0.236;
  return { width: outer * 2 + panelW * 2 + spine, height: outer * 2 + panelH,
    outer, panelW, panelH, spine,
    specification: format === "paperback" ? "KDP paperback, 6x9, black ink white paper" :
      "KDP case-laminate approximation; MUST pass KDP cover template/previewer validation" };
}

export function validatePrintSourceText(text) {
  const plain = String(text || "").replace(/\f/g, "\n\n").replace(/\r/g, "");
  const words = plain.match(/[\p{L}\p{N}]+/gu) || [];
  if (words.length < 1000) throw new Error("Source PDF has too little extractable text for reliable automated reflow.");
  return { plain, words, normalized: words.join(" ").toLocaleLowerCase("en-GB") };
}

async function runBin(cmd, args, maxBuffer = 24 * 1024 * 1024) {
  try {
    const result = await exec(cmd, args, { timeout: 120_000, maxBuffer });
    return String(result.stdout || "");
  } catch (error) {
    throw new Error(cmd + " failed: " + String(error?.message || error).slice(0, 240));
  }
}

export function parsePdfInfo(text) {
  const pages = Number(String(text).match(/^Pages:\s+(\d+)$/m)?.[1]);
  const size = String(text).match(/^Page size:\s+([\d.]+)\s+x\s+([\d.]+)\s+pts/m);
  if (!Number.isInteger(pages) || !size) throw new Error("Could not verify PDF page count and trim geometry.");
  return { pages, widthPt: Number(size[1]), heightPt: Number(size[2]) };
}

async function pdfInfo(file) {
  return parsePdfInfo(await runBin("pdfinfo", [file]));
}

async function fontQA(file) {
  const rows = (await runBin("pdffonts", [file])).trim().split("\n").slice(2).filter(Boolean);
  // pdffonts columns are "name type encoding emb sub uni object ID"; a font
  // type can itself contain spaces, so a fixed numeric column index is unsafe.
  if (!rows.length) throw new Error("Print PDF fonts could not be inspected.");
  for (const row of rows) {
    const match = row.trim().match(/\s(yes|no)\s+(yes|no)\s+(yes|no)\s+\d+\s+\d+\s*$/i);
    if (!match) throw new Error("Print PDF font embedding report is unreadable.");
    if (match[1].toLowerCase() !== "yes") throw new Error("Print PDF contains an unembedded font.");
  }
  return { embeddedFonts: true };
}

async function hasRasterImages(file) {
  const lines = (await runBin("pdfimages", ["-list", file])).trim().split("\n");
  return lines.slice(2).some(line => /^\s*\d+\s+\d+\s+/.test(line));
}

function htmlEscape(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function textHtml(text) {
  return text.replace(/\f/g, "\n\n").split(/\n\s*\n/)
    .map(part => part.replace(/\r/g, "").split("\n").map(line => line.trim()).filter(Boolean).join(" "))
    .filter(Boolean).map(p => "<p>" + htmlEscape(p) + "</p>").join("\n");
}

async function renderPdf(html, file, width, height) {
  const browser = await launchKdpBrowser(true);
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });
    await page.setContent(html, { waitUntil: "load", timeout: 90_000 });
    await page.pdf({
      path: file, width: width + "in", height: height + "in", preferCSSPageSize: true,
      printBackground: true, displayHeaderFooter: false, scale: 1,
    });
  } finally {
    await browser.close();
  }
}

async function reflowTextPdf(text, file) {
  const html = "<!doctype html><html lang='en'><head><meta charset='utf-8'>" +
    "<style>@page{size:6in 9in;margin:.7in .62in .7in .82in}" +
    "@page:left{margin-left:.62in;margin-right:.82in}" +
    "@page:right{margin-left:.82in;margin-right:.62in}" +
    "html,body{padding:0;margin:0}body{font-family:'DejaVu Serif',serif;" +
    "font-size:10.25pt;line-height:1.42;color:#151515;hyphens:none}" +
    "p{margin:0 0 .65em 0;text-align:justify;orphans:3;widows:3;overflow-wrap:break-word}" +
    "</style></head><body>" + textHtml(text) + "</body></html>";
  await renderPdf(html, file, W, H);
}

async function coverArt(book) {
  const url = new URL(String(book.coverArtUrl || ""));
  if (url.protocol !== "https:" || url.hostname !== "images.jonathan-harris.online") {
    throw new Error("Missing or untrusted existing book cover artwork.");
  }
  const response = await fetch(url.toString(), { signal: AbortSignal.timeout(20_000), redirect: "error" });
  if (!response.ok) throw new Error("Existing book cover artwork could not be retrieved.");
  const type = String(response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!["image/jpeg", "image/png", "image/webp"].includes(type)) throw new Error("Unsupported existing cover MIME type.");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > COVER_LIMIT) throw new Error("Existing cover image is empty or exceeds 12 MiB.");
  return { uri: "data:" + type + ";base64," + bytes.toString("base64"), sha256: digest(bytes) };
}

async function renderCover(book, format, pages, art, file) {
  const dim = calculatePrintCover(format, pages);
  const title = htmlEscape(book.title);
  const author = htmlEscape(book.author);
  const rawBlurb = String(book.shortDescription || book.description || book.summary || "").trim();
  if (!rawBlurb || !book.title || !book.author) throw new Error("Cover cannot be produced without genuine book metadata.");
  const description = htmlEscape(rawBlurb.slice(0, 700).replace(/\s+\S*$/, "").trim());
  const frontX = dim.outer + dim.panelW + dim.spine;
  const backX = dim.outer;
  const artWidth = Math.min(4, dim.panelW - 1.5);
  const canvas = "<!doctype html><html lang='en'><head><meta charset='utf-8'><style>" +
    "@page{size:" + dim.width.toFixed(5) + "in " + dim.height.toFixed(5) + "in;margin:0}" +
    "html,body{margin:0;padding:0;width:" + dim.width + "in;height:" + dim.height + "in;overflow:hidden}" +
    "body{font-family:'DejaVu Sans',sans-serif;color:white;background:#101b2a}" +
    "*{box-sizing:border-box}.surface{position:absolute;top:" + dim.outer + "in;height:" + dim.panelH + "in;" +
    "padding:.63in .60in .55in .60in;overflow:hidden}.front{left:" + frontX + "in;width:" + dim.panelW + "in;" +
    "background:linear-gradient(145deg,#11283a,#0a1422)}" +
    ".back{left:" + backX + "in;width:" + dim.panelW + "in;background:linear-gradient(140deg,#152b38,#0d1725)}" +
    ".title{font-size:" + (book.title.length > 75 ? 19 : book.title.length > 48 ? 23 : 27) +
    "pt;line-height:1.12;font-weight:bold;letter-spacing:-.3px;margin:0 0 .25in 0}" +
    ".front-art{display:block;margin:.1in auto;width:" + artWidth + "in;max-height:4.5in;object-fit:contain}" +
    ".author{position:absolute;left:.6in;right:.6in;bottom:.63in;font-size:16pt;letter-spacing:.5px}" +
    ".back .eyebrow{font-size:12pt;letter-spacing:2px;text-transform:uppercase;color:#b1e0e1;margin-top:.3in}" +
    ".back .blurb{font-size:12.5pt;line-height:1.48;margin-top:.45in;max-height:5.5in;overflow:hidden}" +
    ".back .barcode{position:absolute;right:.3in;bottom:.5in;width:2.2in;height:1.4in;background:#fff}" +
    "</style></head><body><div class='surface back'><div class='eyebrow'>About this book</div>" +
    "<div class='blurb'>" + description + "</div><div class='barcode'></div></div>" +
    "<div class='surface front'><div class='title'>" + title + "</div><img class='front-art' src='" + art.uri +
    "'><div class='author'>" + author + "</div></div></body></html>";
  await renderPdf(canvas, file, dim.width, dim.height);
  return dim;
}

function digest(bytes) { return crypto.createHash("sha256").update(bytes).digest("hex"); }

function validCount(format, pages) {
  if (!Number.isInteger(pages) || pages < (format === "hardcover" ? 75 : 24) ||
      pages > (format === "hardcover" ? 550 : 828)) {
    throw new Error("Final interior page count is outside supported KDP " + format + " limits.");
  }
}

export async function createPrintAssets(book, format, options = {}) {
  if (!allowedFormats.has(format)) throw new Error("Unknown print format.");
  const work = await fs.mkdtemp(path.join(os.tmpdir(), "kdp-print-"));
  await fs.chmod(work, 0o700);
  const original = path.join(work, "source.pdf");
  const interior = path.join(work, "interior.pdf");
  const cover = path.join(work, "cover.pdf");
  try {
    if (book.storageBucket !== "kdp" || !String(book.manuscriptR2Key).startsWith("Manuscripts pdf format/")) {
      throw new Error("Print source is not a private KDP catalogue PDF.");
    }
    const source = await getObjectAsBuffer("kdp", book.manuscriptR2Key, { maxBytes: SOURCE_LIMIT });
    await fs.writeFile(original, source, { mode: 0o600 });
    const sourceInfo = await pdfInfo(original);
    const sourceText = validatePrintSourceText(await runBin("pdftotext", ["-raw", "-enc", "UTF-8", original, "-"]));
    const originalTrim = Math.abs(sourceInfo.widthPt - 432) < 0.25 &&
      Math.abs(sourceInfo.heightPt - 648) < 0.25;
    let converted = false;
    if (originalTrim) {
      await fs.copyFile(original, interior);
      try { await fontQA(interior); } catch {
        if (await hasRasterImages(original)) throw new Error("Original trim PDF has unembedded fonts and images; source re-layout required.");
        converted = true;
        await reflowTextPdf(sourceText.plain, interior);
      }
    } else {
      if (await hasRasterImages(original)) throw new Error("Non-6x9 source PDF includes images; safe automatic reflow requires image-preserving source files.");
      converted = true;
      await reflowTextPdf(sourceText.plain, interior);
    }
    const info = await pdfInfo(interior);
    validCount(format, info.pages);
    if (Math.abs(info.widthPt - W * IN) > 0.25 || Math.abs(info.heightPt - H * IN) > 0.25) {
      throw new Error("Rendered print interior has the wrong trim dimensions.");
    }
    await fontQA(interior);
    const finalText = validatePrintSourceText(await runBin("pdftotext", ["-raw", "-enc", "UTF-8", interior, "-"]));
    if (sourceText.normalized !== finalText.normalized) {
      throw new Error("Automated print reflow did not preserve the complete source word sequence.");
    }
    const art = await coverArt(book);
    const coverSpec = await renderCover(book, format, info.pages, art, cover);
    const coverInfo = await pdfInfo(cover);
    if (coverInfo.pages !== 1 || Math.abs(coverInfo.widthPt - coverSpec.width * IN) > 0.5 ||
      Math.abs(coverInfo.heightPt - coverSpec.height * IN) > 0.5) {
      throw new Error("Generated print cover PDF dimensions do not match the calculated wrap.");
    }
    await fontQA(cover);
    const interiorBytes = await fs.readFile(interior);
    const coverBytes = await fs.readFile(cover);
    const interiorHash = digest(interiorBytes);
    const coverHash = digest(coverBytes);
    const root = "print/assets/" + book.ebookId + "/" + format + "/";
    const interiorKey = root + interiorHash + "-interior.pdf";
    const coverKey = root + coverHash + "-cover.pdf";
    const manifest = {
      schemaVersion: 1, ebookId: book.ebookId, format, title: book.title, author: book.author,
      sourceR2Key: book.manuscriptR2Key, sourceSha256: digest(source),
      sourcePageCount: sourceInfo.pages, finalPageCount: info.pages,
      finalTrimIn: [W, H], reflowed: converted,
      interiorR2Key: interiorKey, interiorSha256: interiorHash,
      coverR2Key: coverKey, coverSha256: coverHash, coverArtworkSha256: art.sha256,
      coverSizeIn: [coverSpec.width, coverSpec.height], coverSpec: coverSpec.specification,
      automaticallyChecked: ["source-text-word-sequence", "print-trim", "interior-fonts", "cover-trim", "cover-fonts"],
      requiresKdpPreview: true, requiresLiveRoyaltyCheck: true,
      createdAt: new Date().toISOString(),
    };
    if (!options.dryRun) {
      await uploadPrivateBuffer("kdp", interiorKey, interiorBytes, "application/pdf");
      await uploadPrivateBuffer("kdp", coverKey, coverBytes, "application/pdf");
      await putPrivateJson("kdp", root + "manifest.json", manifest);
    }
    return { manifest, interiorPath: interior, coverPath: cover, cleanup: async () => fs.rm(work, { recursive: true, force: true }) };
  } catch (error) {
    await fs.rm(work, { recursive: true, force: true });
    throw error;
  }
}
