import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-core";

function text(value = "") {
  return String(value ?? "").trim();
}

function esc(value = "") {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function chromiumExecutable() {
  const candidates = [
    process.env.CHROMIUM_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].filter(Boolean);
  const direct = candidates.find((candidate) => fs.existsSync(candidate));
  if (direct) return direct;
  for (const command of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const result = spawnSync("which", [command], { encoding: "utf8" });
    const resolved = result.status === 0 ? text(result.stdout) : "";
    if (resolved && fs.existsSync(resolved)) return resolved;
  }
  return null;
}

function normaliseOptions(options = []) {
  return (Array.isArray(options) ? options : [])
    .slice(0, 4)
    .map((option, index) => ({
      letter: text(option?.letter || String.fromCharCode(65 + index)).slice(0, 1).toUpperCase(),
      text: text(option?.text || option),
    }));
}

function optionHtml(option, correctLetter, answerCard) {
  const isCorrect = answerCard && option.letter === correctLetter;
  const className = isCorrect ? "option option-correct" : answerCard ? "option option-muted" : "option";
  return `<div class="${className}"><div class="letter">${esc(option.letter)}</div><div class="option-text">${esc(option.text)}</div>${isCorrect ? '<div class="tick" aria-label="Correct">✓</div>' : ""}</div>`;
}

export function buildQuizCardHtml(card = {}) {
  const type = text(card.type || card.cardType || "question").toLowerCase() === "answer" ? "answer" : "question";
  const answerCard = type === "answer";
  const options = normaliseOptions(card.options);
  if (options.length !== 4 || options.some((option) => !option.text)) {
    throw new Error("Quiz card renderer requires exactly four non-empty options");
  }
  const correctLetter = text(card.correct?.letter || card.correctLetter).slice(0, 1).toUpperCase();
  if (answerCard && !options.some((option) => option.letter === correctLetter)) {
    throw new Error("Quiz answer card requires a correct option matching one of A-D");
  }

  const title = text(card.title || (answerCard ? "AI Quiz Answer" : "AI Quiz"));
  const question = text(card.question);
  const footer = text(card.footer || (answerCard ? "Did you get it right?" : "Comment your answer below."));
  const explanation = answerCard ? text(card.correct?.explanation || card.explanation) : "";
  const questionSize = question.length > 155 ? 35 : question.length > 105 ? 40 : 46;
  const optionSize = Math.max(25, options.reduce((max, option) => Math.max(max, option.text.length), 0) > 105 ? 25 : 29);
  const explanationSize = explanation.length > 260 ? 23 : explanation.length > 180 ? 26 : 29;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{width:1080px;height:1080px;margin:0;overflow:hidden}body{font-family:Arial,Helvetica,sans-serif;background:#071426;color:#f8fafc}
    .card{position:relative;width:1080px;height:1080px;padding:68px 72px 58px;display:flex;flex-direction:column;background:radial-gradient(circle at 88% 7%,rgba(22,180,173,.25),transparent 34%),radial-gradient(circle at 6% 96%,rgba(251,146,60,.18),transparent 34%),linear-gradient(150deg,#071426,#10233d 58%,#0b1729)}
    .card:before{content:"";position:absolute;inset:28px;border:2px solid rgba(255,255,255,.12);border-radius:36px;pointer-events:none}
    .kicker{font-size:24px;line-height:1.2;letter-spacing:.09em;text-transform:uppercase;font-weight:800;color:#6ee7dc;margin-bottom:24px}
    h1{font-size:${questionSize}px;line-height:1.13;margin:0 0 30px;letter-spacing:-.025em;max-height:164px;overflow:hidden}
    .options{display:grid;grid-template-columns:1fr;gap:14px}
    .option{min-height:112px;display:grid;grid-template-columns:68px 1fr 48px;align-items:center;gap:18px;padding:18px 24px;border-radius:22px;border:2px solid rgba(255,255,255,.18);background:rgba(255,255,255,.075);box-shadow:0 12px 30px rgba(0,0,0,.14)}
    .option-muted{opacity:.68}.option-correct{opacity:1;border-color:#5eead4;background:linear-gradient(90deg,rgba(13,148,136,.72),rgba(20,184,166,.36));box-shadow:0 0 0 4px rgba(94,234,212,.12),0 16px 35px rgba(0,0,0,.2)}
    .letter{width:58px;height:58px;border-radius:16px;display:flex;align-items:center;justify-content:center;background:#f8fafc;color:#0f172a;font-size:31px;font-weight:900}
    .option-text{font-size:${optionSize}px;line-height:1.18;font-weight:720;letter-spacing:-.01em}.tick{font-size:42px;font-weight:900;color:#ccfbf1;text-align:right}
    .explanation{margin-top:18px;padding:20px 24px;border-radius:20px;background:rgba(2,6,23,.5);border:1px solid rgba(255,255,255,.15);font-size:${explanationSize}px;line-height:1.28;color:#e2e8f0;max-height:142px;overflow:hidden}
    .footer{margin-top:auto;padding-top:20px;display:flex;align-items:center;justify-content:space-between;font-size:27px;font-weight:800;color:#fdba74}.brand{font-size:19px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}
  </style></head><body><main class="card"><div class="kicker">${esc(title)}</div><h1>${esc(question)}</h1><section class="options">${options.map((option) => optionHtml(option, correctLetter, answerCard)).join("")}</section>${answerCard && explanation ? `<section class="explanation">${esc(explanation)}</section>` : ""}<footer class="footer"><span>${esc(footer)}</span><span class="brand">Jonathan Harris</span></footer></main></body></html>`;
}

export async function renderQuizCardPng(card = {}, { signal } = {}) {
  const executablePath = chromiumExecutable();
  if (!executablePath) throw new Error("Chromium executable not found for deterministic quiz artwork");
  if (signal?.aborted) throw signal.reason instanceof Error ? signal.reason : new Error("Quiz rendering aborted");

  const browser = await chromium.launch({
    headless: true,
    executablePath,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });
  const onAbort = () => browser.close().catch(() => {});
  signal?.addEventListener?.("abort", onAbort, { once: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1080 }, deviceScaleFactor: 1 });
    await page.setContent(buildQuizCardHtml(card), { waitUntil: "load", timeout: 30_000 });
    return await page.screenshot({ type: "png", fullPage: false, animations: "disabled" });
  } finally {
    signal?.removeEventListener?.("abort", onAbort);
    await browser.close().catch(() => {});
  }
}

export const __quizCardRendererTestHooks = { chromiumExecutable, normaliseOptions };
export default { buildQuizCardHtml, renderQuizCardPng };
