// Copy the author's existing signed-in Kindle generative-AI declaration into
// the new print edition rather than inventing an Amazon disclosure. Unknown
// source questionnaires block before any new print title is created.
import { withKdpPage } from "./engine/kdpMetadata.ts";
import { openSetupStep } from "./engine/kdpCreateTitle.ts";

export function normalizeAiDeclaration(raw) {
  if (!raw || !["YES", "NO"].includes(String(raw.contains || "").toUpperCase())) {
    throw new Error("Existing Kindle AI-content declaration is not verifiable.");
  }
  if (String(raw.contains).toUpperCase() === "NO") {
    return { containsAiContent: false };
  }
  const keys = [
    ["textAmount", "aiTextAmount"], ["textTool", "aiTextTool"],
    ["imagesAmount", "aiImagesAmount"], ["imagesTool", "aiImagesTool"],
    ["translationsAmount", "aiTranslationsAmount"],
  ];
  const result = { containsAiContent: true };
  for (const [input, output] of keys) {
    if (typeof raw[input] === "string" && raw[input].trim()) result[output] = raw[input].trim();
  }
  if (!result.aiTextAmount || !result.aiImagesAmount || !result.aiTranslationsAmount) {
    throw new Error("Existing Kindle AI questionnaire is incomplete; print disclosure cannot be inferred.");
  }
  if (result.aiTextAmount.toLowerCase() !== "none" && !result.aiTextTool) {
    throw new Error("Existing Kindle AI-text tool is not known.");
  }
  if (result.aiImagesAmount.toLowerCase() !== "none" && !result.aiImagesTool) {
    throw new Error("Existing Kindle AI-image tool is not known.");
  }
  return result;
}

export async function readKindleAiDeclaration(titleId) {
  if (!/^[A-Z0-9]{10,14}$/i.test(titleId)) throw new TypeError("Verified existing Kindle KDP title ID required.");
  return withKdpPage(async page => {
    await openSetupStep(page, "kindle", titleId, "content");
    const raw = await page.evaluate(() => {
      const read = (...names) => {
        for (const name of names) {
          const input = document.querySelector('input[name="' + name + '"]');
          const value = input?.value?.trim();
          if (value) return value;
        }
        return "";
      };
      const field = (suffix) => read(
        "data[digital][generative_ai_questionnaire]" + suffix,
        "data[generative_ai_questionnaire]" + suffix,
        "data[print_book][generative_ai_questionnaire]" + suffix,
      );
      const contains = field("[contains_ai_content]") ||
        read("data[digital][generative_ai_questionnaire][contains_ai_content]");
      return {
        contains, textAmount: field("[text][amount_and_editing]"),
        textTool: field("[text][tools][0]"),
        imagesAmount: field("[images][amount_and_editing]"),
        imagesTool: field("[images][tools][0]"),
        translationsAmount: field("[translations][amount_and_editing]"),
      };
    });
    return normalizeAiDeclaration(raw);
  }, { headless: true });
}
