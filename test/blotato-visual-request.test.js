import test from "node:test";
import assert from "node:assert/strict";
import { buildAiStoryTemplateInputs, buildVisualCreationRequest } from "../services/blotato/utils/visualRequest.js";

const UUID = "5903fe43-514d-40ee-a060-0d6628c5f8fd";
const PATH = `/base/v2/ai-story-video/${UUID}/v1`;
const inputs = {
  scenes: [{ mediaSource: "adult professional using OCR at a desk", script: "A verified OCR workflow starts with this document." }],
  voiceName: "Daniel (British, authoritative)",
  aiImageModel: "replicate/black-forest-labs/flux-schnell",
  animateAiImages: true,
  captionPosition: "bottom",
  highlightColor: "#00E5FF",
  transition: "fade",
  aspectRatio: "9:16",
  trimToVoiceover: true,
  thumbnailText: "unsupported provider field",
};

test("Blotato UUID and full-path fallbacks send the same source-grounded scene contract", () => {
  for (const templateId of [UUID, PATH]) {
    const request = buildVisualCreationRequest({
      candidateTemplateId: templateId,
      visualInputs: inputs,
      visualPrompt: "Create a five-scene AI news video about OCR",
    });
    assert.equal(request.templateId, templateId);
    assert.deepEqual(request.inputs, buildAiStoryTemplateInputs(inputs));
    assert.equal(request.inputs.scenes[0].mediaSource, inputs.scenes[0].mediaSource);
    assert.equal(request.inputs.aiImageModel, "replicate/black-forest-labs/flux-schnell");
    assert.equal(request.inputs.animateAiImages, true);
    assert.equal(request.inputs.thumbnailText, undefined);
    assert.match(request.prompt, /OCR/);
    assert.equal(request.render, true);
    assert.equal(request.isDraft, false);
  }
});

test("Blotato prompt-only autofill remains an explicit compatibility escape hatch", () => {
  const request = buildVisualCreationRequest({
    candidateTemplateId: PATH,
    visualInputs: inputs,
    visualPrompt: "Create a five-scene AI news video about OCR",
    manualInputsConfigured: false,
  });
  assert.deepEqual(request.inputs, {});
  assert.match(request.prompt, /OCR/);
});

test("Blotato rejects an incomplete manual scene before starting a paid render", () => {
  assert.throws(
    () => buildAiStoryTemplateInputs({ scenes: [{ mediaSource: "specific image prompt" }] }),
    /complete scene/i,
  );
});

test("Blotato visual requests fail before the provider when ID or prompt is missing", () => {
  assert.throws(() => buildVisualCreationRequest({ visualPrompt: "video" }), /template ID/i);
  assert.throws(() => buildVisualCreationRequest({ candidateTemplateId: UUID }), /visual prompt/i);
});
