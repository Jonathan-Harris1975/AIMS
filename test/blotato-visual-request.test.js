import test from "node:test";
import assert from "node:assert/strict";
import { buildVisualCreationRequest } from "../services/blotato/utils/visualRequest.js";

const UUID = "5903fe43-514d-40ee-a060-0d6628c5f8fd";
const PATH = `/base/v2/ai-story-video/${UUID}/v1`;
const inputs = { scenes: [{ mediaSource: "adult professional using OCR at a desk" }] };

test("Blotato UUID and full-path fallbacks use the same prompt-autofill contract", () => {
  for (const templateId of [UUID, PATH]) {
    const request = buildVisualCreationRequest({
      candidateTemplateId: templateId,
      visualInputs: inputs,
      visualPrompt: "Create a five-scene AI news video about OCR",
      manualInputsConfigured: false,
    });
    assert.equal(request.templateId, templateId);
    assert.deepEqual(request.inputs, {});
    assert.match(request.prompt, /OCR/);
    assert.equal(request.render, true);
    assert.equal(request.isDraft, false);
  }
});

test("Blotato manual inputs require an explicit opt-in and retain the proven prompt contract", () => {
  const request = buildVisualCreationRequest({
    candidateTemplateId: PATH,
    visualInputs: inputs,
    visualPrompt: "Create a five-scene AI news video about OCR",
    manualInputsConfigured: true,
  });
  assert.deepEqual(request.inputs, inputs);
  assert.match(request.prompt, /OCR/);
});

test("Blotato visual requests fail before the provider when ID or prompt is missing", () => {
  assert.throws(() => buildVisualCreationRequest({ visualPrompt: "video" }), /template ID/i);
  assert.throws(() => buildVisualCreationRequest({ candidateTemplateId: UUID }), /visual prompt/i);
});
