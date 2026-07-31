import test from "node:test";
import assert from "node:assert/strict";
import { analyseTopicFidelity, jaccardTopicSimilarity } from "../services/content-quality/topicFidelity.js";
import { normaliseSocialBlogPackage, validateSocialBlogPackageForBrand } from "../services/blog/utils/socialBlogPackage.js";

const sourceItems = [{
  title: "Hong Kong uses AI to detect construction safety risks",
  link: "https://example.com/hong-kong-safety",
  rewritten: "Computer vision reviews construction-site footage to identify missing protective equipment and unsafe zones before an incident.",
}];

test("topic fidelity rejects generic AI copy that is unrelated to the selected source", () => {
  const result = analyseTopicFidelity({
    generated: "AI is changing the landscape. Businesses should embrace innovation and prepare for the future.",
    sources: sourceItems,
    requiredTopic: "Hong Kong construction safety computer vision",
    minSourceHits: 3,
    minScore: 62,
  });
  assert.equal(result.ok, false);
  assert.match(result.defects.join(" "), /weak source-topic overlap/i);
});

test("topic fidelity accepts source-specific construction safety copy", () => {
  const result = analyseTopicFidelity({
    generated: "Hong Kong construction teams are using computer vision to flag unsafe zones and missing protective equipment before an incident. Human safety officers still decide what action to take.",
    sources: sourceItems,
    requiredTopic: "Hong Kong construction safety computer vision",
    minSourceHits: 3,
    minScore: 62,
  });
  assert.equal(result.ok, true);
  assert.ok(result.score >= 80);
});

test("social blog package must cite supplied source URLs and stay on that topic", () => {
  const pkg = normaliseSocialBlogPackage({
    title: "Hong Kong tests AI construction safeguards",
    summary: "Hong Kong is using computer vision to identify construction-site hazards. The practical question is how safety teams act on those alerts.",
    social_caption: "Hong Kong construction teams are testing computer vision against a stubborn practical problem: spotting unsafe zones and missing protective equipment before an incident. That can improve the speed of site inspections, but it does not transfer responsibility to a camera or a model. Safety officers still need clear thresholds, reliable footage and authority to stop work when the evidence warrants it. The useful lesson is not that AI removes risk. It is that a narrowly defined detection system can give trained people earlier evidence, provided the workflow around the alert is just as carefully designed.",
    hook: "The camera is not the safety officer.",
    body_sections: [
      { heading: "What changes", paragraphs: ["Computer vision can surface missing equipment and unsafe zones earlier."] },
      { heading: "What does not", paragraphs: ["Human safety teams still own the decision and intervention."] },
    ],
    takeaway: "The model is useful only when the response workflow is equally disciplined.",
    hashtags: ["#ConstructionSafety", "#ComputerVision", "#RiskManagement"],
    image_prompt: "High-impact premium editorial construction-safety scene with a site inspector reviewing a camera alert beside a real building site, dark navy and amber seasonal palette, teal safety accents, cinematic lighting, strong contrast, premium magazine composition, no text, no letters, no numbers, no logos and no watermarks.",
    themes: ["Construction safety", "Computer vision"],
    source_urls: [sourceItems[0].link],
  }, { items: sourceItems, dateLabel: "2026-07-31" });
  const gate = validateSocialBlogPackageForBrand(pkg, { sourceItems });
  assert.equal(gate.ok, true, gate.defects.join(" | "));
  assert.deepEqual(gate.contract.source_urls, [sourceItems[0].link]);
});

test("mini-series angle similarity detects near-duplicate plans", () => {
  const similarity = jaccardTopicSimilarity(
    "How computer vision spots construction safety risks",
    "How construction computer vision detects safety risks",
  );
  assert.ok(similarity > 0.68);
});

test("social blog package rejects selected source URLs that are not represented in the copy", () => {
  const unrelated = {
    title: "New chip cooling method cuts data-centre power",
    link: "https://example.com/chip-cooling",
    rewritten: "A liquid cooling design reduces server heat and electricity demand in dense data centres.",
  };
  const pkg = normaliseSocialBlogPackage({
    title: "Hong Kong tests AI construction safeguards",
    summary: "Hong Kong is using computer vision to identify construction-site hazards. Safety teams still decide how to act on the evidence.",
    social_caption: "Hong Kong construction teams are testing computer vision against a stubborn practical problem: spotting unsafe zones and missing protective equipment before an incident. That can improve the speed of site inspections, but it does not transfer responsibility to a camera or a model. Safety officers still need clear thresholds, reliable footage and authority to stop work when the evidence warrants it. The useful lesson is not that AI removes risk. It is that a narrowly defined detection system can give trained people earlier evidence, provided the workflow around the alert is just as carefully designed.",
    hook: "The camera is not the safety officer.",
    body_sections: [
      { heading: "What changes", paragraphs: ["Computer vision can surface missing equipment and unsafe zones earlier."] },
      { heading: "What does not", paragraphs: ["Human safety teams still own the decision and intervention."] },
    ],
    takeaway: "The model is useful only when the response workflow is equally disciplined.",
    hashtags: ["#ConstructionSafety", "#ComputerVision", "#RiskManagement"],
    image_prompt: "High-impact premium editorial construction-safety scene with a site inspector reviewing a camera alert beside a real building site, dark navy and amber seasonal palette, teal safety accents, cinematic lighting, strong contrast, premium magazine composition, no text, no letters, no numbers, no logos and no watermarks.",
    themes: ["Construction safety", "Computer vision"],
    source_urls: [sourceItems[0].link, unrelated.link],
  }, { items: [...sourceItems, unrelated], dateLabel: "2026-07-31" });
  const gate = validateSocialBlogPackageForBrand(pkg, { sourceItems: [...sourceItems, unrelated] });
  assert.equal(gate.ok, false);
  assert.match(gate.defects.join(" "), /Selected source 2 is not meaningfully represented/i);
});
