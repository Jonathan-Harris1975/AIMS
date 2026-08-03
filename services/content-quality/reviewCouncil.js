import { warn } from "../../logger.js";
import { THRESHOLDS } from "../../config/thresholds.js";
import { applyBritishEnglishReplacements } from "./britishEnglish.js";

const BOOLEAN_TRUE = new Set(["1", "true", "yes", "on"]);
const BOOLEAN_FALSE = new Set(["0", "false", "no", "off"]);

const TEXT_REPLACEMENTS = Object.freeze([
  [/\bin today's fast-paced world\b/gi, "in practical terms"],
  [/\brapidly evolving landscape\b/gi, "current state of play"],
  [/\bai landscape\b/gi, "artificial intelligence market"],
  [/\bartificial intelligence landscape\b/gi, "artificial intelligence market"],
  [/\bgroundbreaking\b/gi, "notable"],
  [/\bgame[-\s]?changing\b/gi, "important"],
  [/\bcutting[-\s]?edge\b/gi, "current"],
  [/\brevolutionary\b/gi, "significant"],
  [/\btransformative\b/gi, "useful"],
  [/\bparadigm shift\b/gi, "material change"],
  [/\bdelve\b/gi, "look"],
  [/\bfollow\s+for\s+more\b/gi, "keep Jonathan Harris on your radar"],
  [/\bplease\s+share\b/gi, "pass this on if it helps"],
  [/\bsmash\s+the\s+like\b/gi, "use this as a practical checkpoint"],
  [/\btag\s+a\s+friend\b/gi, "send this to a colleague"],
  [/\bshare\s+this\s+with\b/gi, "pass this to"],
  [/\bcomment\s+yes\b/gi, "treat this as a working note"],
  [/\bunlock value\b/gi, "find value"],
  [/\bseamless integration\b/gi, "clean integration"],
  [/\brobust data fabric\b/gi, "reliable data setup"],
]);



export const REVIEW_COUNCILS = Object.freeze({
  "rss-rewrite-quarantine": {
    env: "REVIEW_COUNCIL_RSS_REWRITE_ENABLED",
    defaultEnabled: true,
    members: [
      { seat: 1, role: "RSS Publication Chair", remit: "Chair the review, reconcile specialist findings, enforce source and summary-depth hard gates, and make the final publish-or-quarantine decision.", authority: "final-decision" },
      { seat: 2, role: "Source Integrity Reviewer", remit: "Verify the rewritten title and summary remain faithful to the supplied source and contain no invented claims, certainty or attribution.", authority: "hard-gate" },
      { seat: 3, role: "RSS Rewrite Editor", remit: "Judge whether the rewrite is genuinely useful, complete and concise enough for feed consumption without collapsing into a teaser or fragment.", authority: "hard-gate" },
      { seat: 4, role: "Expert Insight Editor", remit: "Check that the summary preserves the source's practical significance and does not strip away the consequence, tension or useful context.", authority: "advisory" },
      { seat: 5, role: "British English Language Expert", remit: "Enforce natural British English vocabulary, spelling and idiom outside immutable source quotations or names.", authority: "hard-gate" },
      { seat: 6, role: "Grammar, Spelling and Punctuation Expert", remit: "Remove grammatical errors, malformed punctuation, sentence fragments and formatting defects that reduce publication quality.", authority: "hard-gate" },
      { seat: 7, role: "Anti-Hype Reviewer", remit: "Challenge promotional inflation, vague superlatives and unsupported dramatic framing while preserving genuine significance.", authority: "hard-gate" },
      { seat: 8, role: "AEO Clarity Reviewer", remit: "Ensure the summary states the subject, development and practical meaning directly enough to be useful to people and answer engines.", authority: "advisory" },
      { seat: 9, role: "Independent RSS Red-Team", remit: "Challenge false positives, accidental source drift and weak repairs before the chair approves publication.", authority: "challenge" },
    ],
  },
  "blog-phase45": {
    env: "REVIEW_COUNCIL_BLOG_PHASE45_ENABLED",
    defaultEnabled: true,
    members: [
      { seat: 1, role: "Long-form Editorial Chair", remit: "Chair the meeting, reconcile editorial, search, evidence and conversion findings, and make the final bounded publish-or-quarantine decision.", authority: "final-decision" },
      { seat: 2, role: "Source Evidence Reviewer", remit: "Verify factual statements, attribution and evidence against supplied sources and block unsupported certainty or invented detail.", authority: "hard-gate" },
      { seat: 3, role: "Argument and Structure Reviewer", remit: "Test whether the article has a coherent thesis, logical progression, useful section order and a conclusion earned by the evidence.", authority: "hard-gate" },
      { seat: 4, role: "Original Insight Reviewer", remit: "Require meaningful interpretation or judgement beyond competent source summarisation so the article earns Jonathan Harris's byline.", authority: "hard-gate" },
      { seat: 5, role: "Jonathan Harris Voice Editor", remit: "Protect Jonathan's direct, sceptical, practical British voice and remove generic AI-editorial phrasing or performative expertise.", authority: "hard-gate" },
      { seat: 6, role: "British English Language Expert", remit: "Enforce natural British English vocabulary, spelling and idiom throughout generated editorial prose.", authority: "hard-gate" },
      { seat: 7, role: "Grammar, Spelling and Punctuation Expert", remit: "Correct grammar, punctuation, sentence construction and mechanical defects without flattening voice.", authority: "hard-gate" },
      { seat: 8, role: "Headline and Opening Reviewer", remit: "Judge whether the headline and opening create a specific reason to continue without clickbait, throat-clearing or generic scene-setting.", authority: "hard-gate" },
      { seat: 9, role: "SEO Search Intent Lead", remit: "Check title, headings and topical coverage against the article's genuine search intent without keyword stuffing or topic drift.", authority: "advisory" },
      { seat: 10, role: "AEO Answer Engine Lead", remit: "Improve direct-answer utility, extractable explanations and semantic clarity while preserving natural editorial flow.", authority: "advisory" },
      { seat: 11, role: "Internal Linking Reviewer", remit: "Check that internal links are relevant, real, non-duplicative and useful to the reader rather than decorative SEO links.", authority: "hard-gate" },
      { seat: 12, role: "Schema Integrity Reviewer", remit: "Verify structured metadata and publishing schema accurately describe the article and do not overclaim content not present on the page.", authority: "hard-gate" },
      { seat: 13, role: "Mobile UX Reader", remit: "Review paragraph length, heading rhythm and scanning behaviour for realistic mobile reading rather than desktop-only prose blocks.", authority: "advisory" },
      { seat: 14, role: "Organic Growth Editor", remit: "Identify useful discoverability and shareability improvements grounded in the article rather than generic growth tactics.", authority: "advisory" },
      { seat: 15, role: "Authority and Conversion Reviewer", remit: "Check that authority, calls to action and commercial pathways are credible, proportionate and relevant to the article's reader intent.", authority: "hard-gate" },
      { seat: 16, role: "Digital Content Performance Reviewer", remit: "Assess readability, usefulness, likely retention and content packaging against professional digital publishing standards.", authority: "advisory" },
      { seat: 17, role: "British English Stylist", remit: "Polish rhythm, concision and sentence variety while preserving meaning and Jonathan's recognisable tone.", authority: "advisory" },
      { seat: 18, role: "Brand Tone Reviewer", remit: "Block hype, corporate sludge, motivational filler and tone that conflicts with the wider Jonathan Harris publishing brand.", authority: "hard-gate" },
      { seat: 19, role: "Independent Blog Red-Team", remit: "Challenge groupthink, weak evidence, overlong repairs and recommendations that exceed the defect actually observed.", authority: "challenge" },
    ],
  },
  "blotato-script-quality": {
    env: "REVIEW_COUNCIL_BLOTATO_SCRIPT_ENABLED",
    defaultEnabled: false,
    members: [
      { seat: 1, role: "Short-form Editorial Chair", remit: "Chair the meeting, reconcile story, visual, source and platform findings, and make the final render-ready or quarantine decision.", authority: "final-decision" },
      { seat: 2, role: "Source Fidelity Reviewer", remit: "Verify every factual claim, named entity and implication against the supplied source material before any creative optimisation is accepted.", authority: "hard-gate" },
      { seat: 3, role: "Jonathan Harris Voice Editor", remit: "Protect Jonathan's sceptical, practical voice and reject generic creator language, hype or artificial enthusiasm.", authority: "hard-gate" },
      { seat: 4, role: "Hook and Retention Editor", remit: "Judge whether the opening earns attention immediately and whether each beat gives the viewer a reason to continue.", authority: "hard-gate" },
      { seat: 5, role: "Short-form Narrative Editor", remit: "Ensure the script develops a clear beginning, escalation and payoff rather than a stack of disconnected facts.", authority: "hard-gate" },
      { seat: 6, role: "Narrative Arc Editor", remit: "Verify the explicit whole-video narrative arc matches the script and scenes and contains a meaningful progression or reveal.", authority: "hard-gate" },
      { seat: 7, role: "Storyboard Continuity Director", remit: "Ensure adjacent scenes logically and visually progress from the same story instead of behaving like unrelated stock clips.", authority: "hard-gate" },
      { seat: 8, role: "Visual Continuity Director", remit: "Require a stable visual anchor, subject, environment or motif that persists coherently across the whole short.", authority: "hard-gate" },
      { seat: 9, role: "Voiceover Pacing Editor", remit: "Check spoken rhythm, sentence length and beat density for natural short-form delivery without rushed or dead sections.", authority: "advisory" },
      { seat: 10, role: "First-frame Packaging Reviewer", remit: "Judge the opening frame and thumbnail concept for immediate clarity and stopping power without deceptive packaging.", authority: "hard-gate" },
      { seat: 11, role: "Emotional Pull Reviewer", remit: "Check that the short creates curiosity, surprise, concern, recognition or useful tension without manufacturing emotion unsupported by the story.", authority: "advisory" },
      { seat: 12, role: "Short-form Shareability Reviewer", remit: "Assess whether the final idea gives viewers a credible reason to save, send or discuss the short rather than relying on engagement bait.", authority: "advisory" },
      { seat: 13, role: "Platform Fit Reviewer", remit: "Check that structure, duration and packaging work across Reels, Shorts, TikTok and Facebook video destinations.", authority: "hard-gate" },
      { seat: 14, role: "Caption Readability Reviewer", remit: "Ensure caption copy is concise, legible, source-faithful and complementary to the video rather than duplicating the entire script.", authority: "advisory" },
      { seat: 15, role: "British English Language Expert", remit: "Enforce natural British English in all generated copy outside immutable proper names and quotations.", authority: "hard-gate" },
      { seat: 16, role: "Grammar, Spelling and Punctuation Expert", remit: "Correct language mechanics without weakening spoken rhythm or Jonathan's voice.", authority: "hard-gate" },
      { seat: 17, role: "Publishing Readiness Reviewer", remit: "Confirm required fields, scenes, media instructions and platform payloads are complete before rendering begins.", authority: "hard-gate" },
      { seat: 18, role: "Independent Short-form Red-Team", remit: "Challenge weak hooks, false confidence, repetitive scenes and repairs that improve scores without improving the viewer experience.", authority: "challenge" },
    ],
  },
  "zernio-social-copy": {
    env: "REVIEW_COUNCIL_ZERNIO_SOCIAL_ENABLED",
    defaultEnabled: true,
    members: [
      { seat: 1, role: "Social Editorial Chair", remit: "Chair the meeting, reconcile copy, platform, visual and brand findings, and make the final schedule-or-quarantine decision.", authority: "final-decision" },
      { seat: 2, role: "Jonathan Harris Voice Editor", remit: "Protect Jonathan's practical, sceptical, direct voice and reject generic AI commentary, motivational filler and corporate phrasing.", authority: "hard-gate" },
      { seat: 3, role: "Social Hook Editor", remit: "Require a concrete opening point, tension, consequence or useful observation that earns attention without clickbait.", authority: "hard-gate" },
      { seat: 4, role: "Zernio Copy Editor", remit: "Judge the post as a complete social asset for clarity, substance, rhythm and useful editorial payoff.", authority: "hard-gate" },
      { seat: 5, role: "Engagement and Conversation Reviewer", remit: "Check that any reader prompt invites thoughtful response and never relies on likes, tags, one-word answers or manufactured engagement.", authority: "advisory" },
      { seat: 6, role: "CTA Reviewer", remit: "Ensure calls to action are restrained, specific and appropriate to the lane, with no fake urgency or hard-sell language.", authority: "hard-gate" },
      { seat: 7, role: "Platform Fit Reviewer", remit: "Check readability, length and structure for the targeted Facebook and Instagram destinations without forcing both into lowest-common-denominator copy.", authority: "hard-gate" },
      { seat: 8, role: "Dynamic Hashtag Strategist", remit: "Keep hashtags relevant, sparse and topic-specific, avoiding broad filler tags that add noise rather than discovery value.", authority: "advisory" },
      { seat: 9, role: "Visual-Copy Alignment Reviewer", remit: "Verify the image concept and written post communicate the same specific idea and do not create a misleading or generic visual story.", authority: "hard-gate" },
      { seat: 10, role: "Cross-Platform Coherence Reviewer", remit: "Ensure account variants preserve the same factual meaning and editorial point while avoiding byte-identical cross-posting.", authority: "advisory" },
      { seat: 11, role: "Brand Safety Reviewer", remit: "Block hype, ungrounded claims, motivational-poster language and anything that weakens professional trust.", authority: "hard-gate" },
      { seat: 12, role: "British English Language Expert", remit: "Enforce natural British English spelling, vocabulary and idiom throughout generated copy.", authority: "hard-gate" },
      { seat: 13, role: "Grammar, Spelling and Punctuation Expert", remit: "Correct mechanical language defects while retaining natural social rhythm.", authority: "hard-gate" },
      { seat: 14, role: "Scheduling Readiness Reviewer", remit: "Verify final copy, links, image attachment, target accounts, publish time and duplicate protection are ready for scheduling.", authority: "hard-gate" },
      { seat: 15, role: "Independent Social Red-Team", remit: "Challenge blandness, overlong padding, weak evidence and repairs that technically pass but do not improve reader value.", authority: "challenge" },
    ],
  },
  "zernio-mini-series": {
    env: "REVIEW_COUNCIL_ZERNIO_MINI_SERIES_ENABLED",
    defaultEnabled: true,
    members: [
      { seat: 1, role: "Mini-Series Editorial Chair", remit: "Chair the meeting, protect the series-level editorial arc and make the final approve, repair or quarantine decision for each part.", authority: "final-decision" },
      { seat: 2, role: "Source Integrity Reviewer", remit: "Verify every post stays inside the approved evidence set and does not invent facts, dates, legal conclusions or certainty.", authority: "hard-gate" },
      { seat: 3, role: "Jonathan Harris Voice Editor", remit: "Protect the same practical, sceptical Jonathan voice across all parts without making each post sound mechanically identical.", authority: "hard-gate" },
      { seat: 4, role: "Topical Relevance Editor", remit: "Ensure every part remains tightly tied to the approved timely topic and does not wander into generic AI commentary.", authority: "hard-gate" },
      { seat: 5, role: "Practical AI Authority Reviewer", remit: "Require concrete implications, decisions or operating consequences rather than repeating source summaries.", authority: "hard-gate" },
      { seat: 6, role: "Series Continuity Reviewer", remit: "Check that parts progress coherently, avoid repetition and remain useful individually while forming one editorial journey.", authority: "hard-gate" },
      { seat: 7, role: "Social Engagement Editor", remit: "Strengthen readability and discussion value without engagement bait or inflated claims.", authority: "advisory" },
      { seat: 8, role: "Platform Fit Reviewer", remit: "Check post length, structure and packaging for Facebook and Instagram consumption.", authority: "hard-gate" },
      { seat: 9, role: "British English Language Expert", remit: "Enforce polished British English across generated series copy.", authority: "hard-gate" },
      { seat: 10, role: "Publishing Readiness Reviewer", remit: "Confirm approved hashtags, image prompt, source URLs, schedule and required fields are complete before scheduling each part.", authority: "hard-gate" },
      { seat: 11, role: "Independent Series Red-Team", remit: "Challenge repetitive angles, weak evidence and a forced series where the topic no longer supports another useful post.", authority: "challenge" },
    ],
  },
  "zernio-ebook-conversion": {
    env: "REVIEW_COUNCIL_ZERNIO_EBOOK_ENABLED",
    defaultEnabled: true,
    members: [
      { seat: 1, role: "eBook Conversion Chair", remit: "Chair the meeting, reconcile editorial and commercial findings, enforce link integrity, and make the final schedule-or-quarantine decision.", authority: "final-decision" },
      { seat: 2, role: "eBook Editorial Director", remit: "Ensure the post communicates a real idea from the supplied book metadata rather than reading like catalogue copy or an advert.", authority: "hard-gate" },
      { seat: 3, role: "Online Digital Marketing Expert", remit: "Judge positioning, audience relevance and commercial clarity without introducing fake urgency, unsupported scarcity or promotional sludge.", authority: "advisory" },
      { seat: 4, role: "Conversion Copy Reviewer", remit: "Require a clear reader benefit, credible reason to care and natural path to the book page.", authority: "hard-gate" },
      { seat: 5, role: "Benefit-led Headline Reviewer", remit: "Check the opening and framing focus on a useful reader problem or benefit rather than merely naming the book.", authority: "advisory" },
      { seat: 6, role: "Source and Claims Reviewer", remit: "Verify every claim is supported by supplied book metadata and block invented reviews, rankings, reader reactions, credentials or outcomes.", authority: "hard-gate" },
      { seat: 7, role: "Audience Value Reviewer", remit: "Ensure the post remains useful even when the reader does not click through to buy the book.", authority: "hard-gate" },
      { seat: 8, role: "Commercial Relevance Reviewer", remit: "Check that the book is promoted to a relevant audience and the copy makes the commercial connection without hard selling.", authority: "advisory" },
      { seat: 9, role: "Purchase Friction Reviewer", remit: "Verify the route to the book is clear, direct and free of avoidable ambiguity or broken steps.", authority: "hard-gate" },
      { seat: 10, role: "Social Proof Integrity Reviewer", remit: "Block fabricated endorsements, popularity claims, rankings or social proof not present in the supplied evidence.", authority: "hard-gate" },
      { seat: 11, role: "Jonathan Harris Voice Editor", remit: "Keep the promotion in Jonathan's direct, useful, sceptical voice rather than conventional sales copy.", authority: "hard-gate" },
      { seat: 12, role: "British English Language Expert", remit: "Enforce polished British English throughout generated copy.", authority: "hard-gate" },
      { seat: 13, role: "Grammar, Spelling and Punctuation Expert", remit: "Correct language mechanics, sentence construction and punctuation without flattening Jonathan's voice.", authority: "hard-gate" },
      { seat: 14, role: "CTA and Link Integrity Reviewer", remit: "Confirm the exact book URL survives every repair and the CTA describes the real destination without misleading wording.", authority: "hard-gate" },
      { seat: 15, role: "Independent Conversion Red-Team", remit: "Challenge empty persuasion, unsupported claims and any repair that improves sales tone by weakening credibility.", authority: "challenge" },
    ],
  },
  "quiz-logic": {
    env: "REVIEW_COUNCIL_QUIZ_LOGIC_ENABLED",
    defaultEnabled: true,
    members: [
      { seat: 1, role: "Quiz Editorial Chair", remit: "Chair the review and make the final publish-or-quarantine decision only when question, options and answer validate as one coherent unit.", authority: "final-decision" },
      { seat: 2, role: "Question Clarity Reviewer", remit: "Ensure the question has one clear interpretation, suitable context and no hidden ambiguity.", authority: "hard-gate" },
      { seat: 3, role: "Answer Consistency Reviewer", remit: "Verify the declared correct answer is actually correct and matches the explanation without contradiction.", authority: "hard-gate" },
      { seat: 4, role: "Options Format Reviewer", remit: "Check all four options are present, parallel in form and plausible enough to make the quiz meaningful.", authority: "hard-gate" },
      { seat: 5, role: "Audience Level Reviewer", remit: "Keep difficulty appropriate for an intelligent general AI audience without triviality or unexplained specialist jargon.", authority: "advisory" },
      { seat: 6, role: "Static Card Readability Reviewer", remit: "Ensure question and answer cards remain legible, concise and visually usable on social platforms.", authority: "hard-gate" },
      { seat: 7, role: "British English Language Expert", remit: "Enforce polished British English outside immutable technical terms.", authority: "hard-gate" },
      { seat: 8, role: "Grammar, Spelling and Punctuation Expert", remit: "Correct language mechanics and option punctuation consistently.", authority: "hard-gate" },
      { seat: 9, role: "Independent Quiz Red-Team", remit: "Try to find alternative defensible answers, ambiguity or misleading wording before publication.", authority: "challenge" },
    ],
  },
  "podcast-on-brand": {
    env: "REVIEW_COUNCIL_PODCAST_ON_BRAND_ENABLED",
    defaultEnabled: true,
    members: [
      { seat: 1, role: "Podcast Editorial Chair", remit: "Chair the meeting, reconcile source, narrative, spoken-performance and metadata findings, and make the final publish-or-quarantine decision.", authority: "final-decision" },
      { seat: 2, role: "Source Integrity Reviewer", remit: "Verify factual claims, quotations, dates and attribution against supplied sources and block unsupported narrative embellishment.", authority: "hard-gate" },
      { seat: 3, role: "Podcast Voice Reviewer", remit: "Protect Jonathan's recognisable sceptical, practical editorial stance and reject generic presenter language.", authority: "hard-gate" },
      { seat: 4, role: "Opening Hook Reviewer", remit: "Judge whether the first minute establishes a concrete reason to listen and avoids throat-clearing or generic introductions.", authority: "hard-gate" },
      { seat: 5, role: "Audience Retention Reviewer", remit: "Identify flat passages, unnecessary detours and sections where attention is likely to sag.", authority: "hard-gate" },
      { seat: 6, role: "Narrative Arc Reviewer", remit: "Ensure the episode progresses through a coherent argument or story rather than a sequence of isolated news summaries.", authority: "hard-gate" },
      { seat: 7, role: "Conversational Voice Director", remit: "Make the script sound spoken, natural and human rather than like an article read aloud.", authority: "hard-gate" },
      { seat: 8, role: "Repetition and Pacing Editor", remit: "Remove repeated ideas, over-explanation and pacing problems without stripping necessary context.", authority: "advisory" },
      { seat: 9, role: "TTS Performance Reviewer", remit: "Check punctuation, sentence length, acronyms, pronunciation hazards and rhythm for reliable synthetic voice delivery.", authority: "hard-gate" },
      { seat: 10, role: "Ending and Takeaway Reviewer", remit: "Require a clear landing point, useful takeaway and proportionate close rather than an abrupt stop or generic sign-off.", authority: "hard-gate" },
      { seat: 11, role: "Transcript Layout Reviewer", remit: "Ensure the transcript is readable, structurally coherent and suitable for web/archive consumption.", authority: "advisory" },
      { seat: 12, role: "Transcript AEO Utility Reviewer", remit: "Improve answerability, headings and extractable explanations without distorting spoken content.", authority: "advisory" },
      { seat: 13, role: "Episode Metadata Reviewer", remit: "Verify episode title, description, dates, numbering and metadata faithfully represent the final episode.", authority: "hard-gate" },
      { seat: 14, role: "Podcast Keyword Strategist", remit: "Derive useful search terms from the final transcript rather than generic AI keywords or source titles alone.", authority: "advisory" },
      { seat: 15, role: "RSS Wording Reviewer", remit: "Check RSS-facing copy is accurate, useful and consistent with the published episode and archive links.", authority: "hard-gate" },
      { seat: 16, role: "Brand Continuity Reviewer", remit: "Ensure episode, transcript, artwork and promotional copy present one coherent Turing's Torch identity.", authority: "hard-gate" },
      { seat: 17, role: "British English Language Expert", remit: "Enforce polished British English throughout generated prose while preserving proper names and quotations.", authority: "hard-gate" },
      { seat: 18, role: "Grammar, Spelling and Punctuation Expert", remit: "Correct language mechanics while preserving conversational cadence.", authority: "hard-gate" },
      { seat: 19, role: "Long-form Editorial Director", remit: "Judge the episode as a complete professional programme for depth, coherence, usefulness and editorial authority.", authority: "hard-gate" },
      { seat: 20, role: "Independent Podcast Red-Team", remit: "Challenge weak sourcing, circular argument, inflated claims and passages that pass locally but weaken the whole episode.", authority: "challenge" },
    ],
  },
  "newsletter-editorial": {
    env: "REVIEW_COUNCIL_NEWSLETTER_ENABLED",
    defaultEnabled: true,
    members: [
      { seat: 1, role: "AI Edge Editorial Chair", remit: "Chair the meeting, reconcile source, voice, structure, audience and promotion findings, and make the final send-or-quarantine decision.", authority: "final-decision" },
      { seat: 2, role: "Source Integrity and Fact-Checking Reviewer", remit: "Verify every story, title, summary, link and editorial claim against the supplied source evidence and block mismatches.", authority: "hard-gate" },
      { seat: 3, role: "Jonathan Harris Voice Editor", remit: "Protect Jonathan's sceptical, practical editorial judgement and clearly distinguish reporting from opinion.", authority: "hard-gate" },
      { seat: 4, role: "Newsletter Structure and Scanability Editor", remit: "Keep the issue navigable in roughly five minutes with clear hierarchy, concise sections and useful visual rhythm.", authority: "hard-gate" },
      { seat: 5, role: "Audience Value and Retention Reviewer", remit: "Check every major section earns its place and gives readers a reason to continue or return next issue.", authority: "hard-gate" },
      { seat: 6, role: "Subject Line and Open-Rate Reviewer", remit: "Judge subject and preview text for clarity, specificity and curiosity without opaque wording or clickbait.", authority: "advisory" },
      { seat: 7, role: "Reality Check Scepticism Reviewer", remit: "Verify the Reality Check challenges a real claim with correctly paired evidence and does not manufacture a straw man.", authority: "hard-gate" },
      { seat: 8, role: "Practical Tool/Workflow Reviewer", remit: "Ensure practical recommendations are genuinely useful and supported rather than a random product list.", authority: "advisory" },
      { seat: 9, role: "Book and Podcast Promotion Balance Reviewer", remit: "Keep Tuesday book and Thursday podcast promotion useful, proportionate and clearly secondary to editorial value.", authority: "hard-gate" },
      { seat: 10, role: "Reader Interaction Reviewer", remit: "Check polls or questions invite meaningful response without gimmicks or engagement bait.", authority: "advisory" },
      { seat: 11, role: "Cross-Channel Duplication Reviewer", remit: "Detect copy-paste repetition from blog, podcast and social channels while allowing purposeful thematic reinforcement.", authority: "advisory" },
      { seat: 12, role: "British English Language Expert", remit: "Enforce polished British English across all generated editorial copy.", authority: "hard-gate" },
      { seat: 13, role: "Publishing Readiness Reviewer", remit: "Verify links, section pairing, promotional timing, image readiness and delivery fields before the issue may be stored for sending.", authority: "hard-gate" },
      { seat: 14, role: "Independent Newsletter Red-Team", remit: "Challenge story selection, unsupported rhetoric, source mismatches and groupthink before the chair approves the issue.", authority: "challenge" },
    ],
  },
  "social-performance": {
    env: "REVIEW_COUNCIL_SOCIAL_PERFORMANCE_ENABLED",
    defaultEnabled: true,
    members: [
      { seat: 1, role: "Social Performance Chair", remit: "Chair the review, reconcile platform evidence and make the final bounded recommendation set without inventing missing metrics.", authority: "final-decision" },
      { seat: 2, role: "Facebook Performance Reviewer", remit: "Interpret Facebook-specific reach, engagement and click evidence only where those metrics are actually supplied.", authority: "advisory" },
      { seat: 3, role: "Instagram Performance Reviewer", remit: "Interpret Instagram-specific reach, saves, shares and engagement evidence without extrapolating from other platforms.", authority: "advisory" },
      { seat: 4, role: "YouTube Shorts Reviewer", remit: "Interpret Shorts-specific retention, views and packaging evidence where available.", authority: "advisory" },
      { seat: 5, role: "TikTok Reviewer", remit: "Interpret TikTok-specific retention, views and engagement evidence where available.", authority: "advisory" },
      { seat: 6, role: "Thumbnail Evidence Reviewer", remit: "Compare packaging evidence to measured performance and avoid declaring thumbnail causes without supporting data.", authority: "advisory" },
      { seat: 7, role: "Measurement Integrity Reviewer", remit: "Verify metric provenance, time windows and comparability before recommendations are accepted.", authority: "hard-gate" },
      { seat: 8, role: "Independent Performance Red-Team", remit: "Challenge causal claims, cherry-picked examples and recommendations not supported by measured platform evidence.", authority: "challenge" },
    ],
  },
  housekeeping: {
    env: "REVIEW_COUNCIL_HOUSEKEEPING_ENABLED",
    defaultEnabled: true,
    members: [
      { seat: 1, role: "Housekeeping Completion Chair", remit: "Chair the cleanup review and authorise deletion only when every candidate is proven temporary or duplicate and no evidence is endangered.", authority: "final-decision" },
      { seat: 2, role: "Artefact Cleanup Reviewer", remit: "Identify generated artefacts that are safe to remove without touching published or audit evidence.", authority: "hard-gate" },
      { seat: 3, role: "Temporary File Reviewer", remit: "Distinguish genuinely temporary working files from durable outputs or recovery evidence.", authority: "hard-gate" },
      { seat: 4, role: "Manifest Consistency Reviewer", remit: "Protect manifests and references from becoming stale or pointing at deleted artefacts.", authority: "hard-gate" },
      { seat: 5, role: "Duplicate Output Reviewer", remit: "Confirm duplicate artefacts are byte-equivalent or semantically redundant before deletion is permitted.", authority: "hard-gate" },
      { seat: 6, role: "R2 Key Hygiene Reviewer", remit: "Check object-key conventions, publication ownership and safe deletion scope in R2-backed workflows.", authority: "hard-gate" },
      { seat: 7, role: "Audit Evidence Custodian", remit: "Block deletion of quarantine records, diagnostics, reports or evidence required for operational traceability.", authority: "hard-gate" },
      { seat: 8, role: "Independent Cleanup Red-Team", remit: "Assume deletion is unsafe until the evidence proves otherwise and challenge ambiguous cleanup candidates.", authority: "challenge" },
    ],
  },
});

const COUNCIL_PROTOCOLS = Object.freeze({
  "rss-rewrite-quarantine": {
    purpose: "Recover source-faithful RSS rewrites without lowering publication standards.",
    hardGates: ["source fidelity", "minimum useful summary depth", "British English", "no unsupported claims", "publication-safe formatting"],
    decisionRule: "Approve only after the repaired item passes the deterministic RSS gate; otherwise quarantine the individual item, not the whole feed.",
  },
  "blog-phase45": {
    purpose: "Protect long-form and social-blog editorial quality, evidence, discoverability and conversion without broad rewrites.",
    hardGates: ["source evidence", "schema integrity", "brand voice", "reader value", "SEO/AEO fit", "link integrity"],
    decisionRule: "Repair only failed components, revalidate the complete package, and quarantine if any hard gate remains unresolved.",
  },
  "blotato-script-quality": {
    purpose: "Approve short-form scripts and storyboards only when hook, narrative, visual continuity, source fidelity and platform fitness work together.",
    hardGates: ["source fidelity", "whole-video narrative arc", "visual continuity", "retention", "human-centred visual coverage", "publishing readiness"],
    decisionRule: "Use targeted micro-repairs first; if the same defect persists without measurable improvement, escalate to a fresh model generation rather than repeating an identical repair.",
  },
  "zernio-social-copy": {
    purpose: "Keep daily social posts useful, readable, platform-native and recognisably Jonathan Harris.",
    hardGates: ["source/angle integrity", "hook quality", "CTA quality", "platform fit", "visual-copy alignment", "link correctness"],
    decisionRule: "Approve only when the repaired post passes deterministic platform and brand checks for every targeted channel.",
  },
  "zernio-mini-series": {
    purpose: "Maintain topical relevance, continuity and authority across linked Zernio mini-series posts.",
    hardGates: ["source integrity", "series continuity", "practical value", "voice", "publishing readiness"],
    decisionRule: "Repair the failing episode/post only; never rewrite earlier approved series entries to mask a local defect.",
  },
  "zernio-ebook-conversion": {
    purpose: "Turn ebook promotion into credible, benefit-led conversion copy with working purchase routes.",
    hardGates: ["book/link integrity", "claim integrity", "reader benefit", "CTA clarity", "purchase friction", "brand voice"],
    decisionRule: "A missing or invalid book URL is an immediate publication block; copy repair may not invent urgency or social proof.",
  },
  "quiz-logic": {
    purpose: "Keep quizzes unambiguous, correctly answerable and visually publishable.",
    hardGates: ["question clarity", "answer correctness", "option consistency", "audience level", "card readability"],
    decisionRule: "Any answer-consistency defect blocks publication until the question and all options revalidate together.",
  },
  "podcast-on-brand": {
    purpose: "Protect long-form spoken quality from opening hook through transcript, TTS, metadata and discoverability.",
    hardGates: ["source integrity", "opening retention", "narrative progression", "spoken naturalness", "TTS readiness", "metadata/keyword fidelity"],
    decisionRule: "Apply surgical passage-level repair where possible; factual or source defects remain hard quarantine until corrected.",
  },
  "newsletter-editorial": {
    purpose: "Deliver a trustworthy five-minute AI Edge issue with correct story-source pairing and clear Jonathan Harris judgement.",
    hardGates: ["source/title/link alignment", "fact integrity", "scanability", "Jonathan voice", "reader value", "promotion balance"],
    decisionRule: "Every specialist hard gate must pass; retries must carry forward exact prior defects and correct only the affected sections.",
  },
  "social-performance": {
    purpose: "Turn measured channel performance into bounded, evidence-led recommendations.",
    hardGates: ["platform evidence", "thumbnail evidence", "metric provenance", "recommendation specificity"],
    decisionRule: "Do not infer performance from missing metrics; mark gaps for verification rather than inventing conclusions.",
  },
  housekeeping: {
    purpose: "Remove temporary artefacts without deleting published evidence, manifests or quarantine records.",
    hardGates: ["published artefact protection", "manifest consistency", "R2 key hygiene", "audit evidence retention"],
    decisionRule: "Deletion is allowed only for confirmed temporary or duplicate artefacts; uncertain objects are retained.",
  },
});

function detailedCouncilMembers(councilKey) {
  const council = getCouncilConfig(councilKey);
  return (council.members || []).map((member, index) => ({
    seat: Number(member?.seat || index + 1),
    role: String(member?.role || "Independent Reviewer"),
    remit: String(member?.remit || "Provide an evidence-led specialist review and identify only concrete defects."),
    authority: String(member?.authority || "advisory"),
  }));
}

function boolEnv(name, fallback = false, env = process.env) {
  const raw = String(env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (BOOLEAN_TRUE.has(raw)) return true;
  if (BOOLEAN_FALSE.has(raw)) return false;
  return fallback;
}

function getCouncilConfig(councilKey) {
  const council = REVIEW_COUNCILS[councilKey];
  if (!council) {
    warn?.("review_council.unknown_council_key", { councilKey, fallback: "blog-phase45" });
    return REVIEW_COUNCILS["blog-phase45"];
  }
  return council;
}

export function isReviewCouncilEnabled(councilKey, env = process.env) {
  const council = getCouncilConfig(councilKey);
  return boolEnv(council.env, council.defaultEnabled, env);
}

export function getReviewCouncilMembers(councilKey) {
  const details = detailedCouncilMembers(councilKey);
  const roles = details.map((member) => member.role);
  if (roles.length >= 6) return roles;
  const fallbackRoles = detailedCouncilMembers("housekeeping").map((member) => member.role);
  const padded = [...roles, ...fallbackRoles.filter((role) => !roles.includes(role))];
  return padded.slice(0, 6);
}

export function getReviewCouncilDefinition(councilKey) {
  const council = getCouncilConfig(councilKey);
  const protocol = COUNCIL_PROTOCOLS[councilKey] || COUNCIL_PROTOCOLS["blog-phase45"];
  return {
    councilKey,
    env: council.env,
    enabledByDefault: council.defaultEnabled,
    purpose: protocol.purpose,
    hardGates: [...protocol.hardGates],
    decisionRule: protocol.decisionRule,
    minimumMembersRequired: 6,
    chair: detailedCouncilMembers(councilKey).find((member) => member.seat === 1) || null,
    members: detailedCouncilMembers(councilKey),
    meetingProtocol: [
      "Chair opens the meeting and states the artifact, evidence set and hard gates.",
      "Hard-gate reviewers assess only their defined remit and record concrete defects.",
      "Advisory reviewers propose bounded improvements without overriding evidence or hard gates.",
      "The independent red-team challenges false confidence, groupthink and over-broad repairs.",
      "Repairs are surgical: change only failed components, preserve approved content, then revalidate.",
      "The chair may approve only when every hard gate passes; unresolved hard-gate defects require quarantine or fresh generation.",
    ],
  };
}

function compactText(value = "") {
  return String(value || "")
    .replace(/```(?:json|html|markdown)?/gi, "")
    .replace(/```/g, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function repairTextForReviewCouncil(value = "", { contentType = "", maxHashtags = 3 } = {}) {
  let text = compactText(value);
  for (const [pattern, replacement] of TEXT_REPLACEMENTS) text = text.replace(pattern, replacement);
  text = applyBritishEnglishReplacements(text);

  if (/quiz-answer/i.test(contentType)) {
    text = text
      .replace(/^\s*(?:quiz\s+answer|answer)\s*[:.!-]\s*/i, "Quiz Answer! ")
      .replace(/^\s*Quiz Answer!\s*/i, "Quiz Answer! ")
      .trim();
    if (text && !/^Quiz Answer!/i.test(text)) text = `Quiz Answer! ${text}`;
  }

  if (/quiz-question/i.test(contentType)) {
    text = text
      .replace(/^\s*([A-D])\s*[\.:\-]\s*/gim, "$1) ")
      .replace(/\b([A-D])\s*[\.:\-]\s+/g, "$1) ");
  }

  const hashtags = [...text.matchAll(/(^|\s)(#[A-Za-z0-9_]+)/g)].map((match) => match[2]);
  if (hashtags.length > maxHashtags) {
    const keep = new Set(hashtags.slice(0, maxHashtags).map((tag) => tag.toLowerCase()));
    text = text.replace(/(^|\s)(#[A-Za-z0-9_]+)/g, (match, lead, tag) => keep.has(String(tag).toLowerCase()) ? `${lead}${tag}` : lead).trim();
  }

  return text.replace(/[ \t]{2,}/g, " ").trim();
}

function cloneJson(value) {
  if (value == null || typeof value !== "object") return value;
  return JSON.parse(JSON.stringify(value));
}

function deepRepairStrings(value, options = {}) {
  if (typeof value === "string") return repairTextForReviewCouncil(value, options);
  if (Array.isArray(value)) return value.map((item) => deepRepairStrings(item, options));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, deepRepairStrings(child, { ...options, fieldName: key })]));
  }
  return value;
}

export function repairArtifactForReviewCouncil(artifact, options = {}) {
  return deepRepairStrings(cloneJson(artifact), options);
}

export function repairZernioPostForReviewCouncil(post = {}, { contentType = "zernio-social", featuredBook = null } = {}) {
  const repaired = repairArtifactForReviewCouncil(post, { contentType, maxHashtags: /ebook/i.test(contentType) ? 2 : 3 });
  if (featuredBook?.title && featuredBook?.bookUrl && /ebook/i.test(contentType)) {
    // Zernio does not expose a confirmed first-comment field in the documented
    // Posts API, so the URL must survive every council repair in main content.
    const content = String(repaired.content || "").trim();
    if (!content.includes(featuredBook.bookUrl)) {
      repaired.content = `${content}\n\nRead more: ${featuredBook.bookUrl}`.trim();
    }

    // Retain firstComment as internal metadata for backwards compatibility,
    // but publication correctness must never depend on it.
    const firstComment = String(repaired.firstComment || "");
    if (!firstComment.includes(featuredBook.title) || !firstComment.includes(featuredBook.bookUrl)) {
      repaired.firstComment = `Featured book: ${featuredBook.title}\nRead more: ${featuredBook.bookUrl}`;
    }
  }
  return repaired;
}

function reviewDecision({ councilKey, enabled, originalGate, repairedGate, attempts = [] }) {
  const members = getReviewCouncilMembers(councilKey);
  const definition = getReviewCouncilDefinition(councilKey);
  const originalDefects = originalGate?.defects || [];
  const repairedDefects = repairedGate?.defects || [];
  const improved = Number(repairedGate?.score || 0) > Number(originalGate?.score || 0) || repairedDefects.length < originalDefects.length;
  const approved = Boolean(repairedGate?.ok);

  return {
    councilKey,
    enabled,
    attempted: enabled,
    minimumMembersRequired: definition.minimumMembersRequired,
    purpose: definition.purpose,
    hardGates: definition.hardGates,
    decisionRule: definition.decisionRule,
    chair: definition.chair,
    meetingProtocol: definition.meetingProtocol,
    members,
    memberDetails: definition.members,
    memberCount: members.length,
    attempts,
    originalScore: originalGate?.score ?? null,
    repairedScore: repairedGate?.score ?? null,
    improved,
    approved,
    decision: approved ? "repair_approved" : "quarantine_after_review",
    defectsRemaining: repairedDefects,
    reviewedAt: new Date().toISOString(),
  };
}

export async function runReviewCouncilGate({
  councilKey,
  gate,
  artifact,
  contentType = "content",
  repairArtifact = repairArtifactForReviewCouncil,
  validate,
  maxAttempts = THRESHOLDS.reviewCouncil.maxAttempts,
  logger = warn,
} = {}) {
  if (!gate || gate.ok) {
    return { ok: true, gate, artifact, reviewCouncil: null, repaired: false };
  }
  const enabled = isReviewCouncilEnabled(councilKey);
  if (!enabled) {
    const disabledReview = {
      councilKey,
      enabled: false,
      attempted: false,
      members: getReviewCouncilMembers(councilKey),
      memberDetails: getReviewCouncilDefinition(councilKey).members,
      purpose: getReviewCouncilDefinition(councilKey).purpose,
      hardGates: getReviewCouncilDefinition(councilKey).hardGates,
      decisionRule: getReviewCouncilDefinition(councilKey).decisionRule,
      chair: getReviewCouncilDefinition(councilKey).chair,
      meetingProtocol: getReviewCouncilDefinition(councilKey).meetingProtocol,
      memberCount: getReviewCouncilMembers(councilKey).length,
      decision: "disabled_hard_gate_retained",
      reviewedAt: new Date().toISOString(),
    };
    return { ok: false, gate: { ...gate, reviewCouncil: disabledReview }, artifact, reviewCouncil: disabledReview, repaired: false };
  }

  const effectiveMaxAttempts = Math.max(1, Number(maxAttempts) || THRESHOLDS.reviewCouncil.maxAttempts);
  const attemptLog = [];
  let currentArtifact = artifact;
  let currentGate = gate;
  let repairedArtifact = artifact;
  let repairedGate = gate;
  let previousFingerprint = "";
  let stagnantAttempts = 0;
  const stagnationLimit = Math.max(1, Math.min(3, Number(process.env.REVIEW_COUNCIL_STAGNATION_LIMIT || 2)));

  for (let attempt = 1; attempt <= effectiveMaxAttempts; attempt += 1) {
    repairedArtifact = await repairArtifact(currentArtifact, { contentType, gate: currentGate, attempt });
    repairedGate = validate ? await validate(repairedArtifact) : currentGate;

    attemptLog.push({
      attempt,
      maxAttempts: effectiveMaxAttempts,
      score: repairedGate?.score ?? null,
      approved: Boolean(repairedGate?.ok),
    });

    logger?.("review_council.gate_attempt", {
      councilKey,
      attempt,
      maxAttempts: effectiveMaxAttempts,
      approved: Boolean(repairedGate?.ok),
      score: repairedGate?.score ?? null,
    });

    if (repairedGate?.ok) break;

    const fingerprint = JSON.stringify({
      score: repairedGate?.score ?? null,
      defects: [...(repairedGate?.defects || [])].map(String).sort(),
    });
    stagnantAttempts = fingerprint === previousFingerprint ? stagnantAttempts + 1 : 0;
    previousFingerprint = fingerprint;
    if (stagnantAttempts >= stagnationLimit) {
      logger?.("review_council.stagnation_escalated", {
        councilKey,
        attempt,
        maxAttempts: effectiveMaxAttempts,
        score: repairedGate?.score ?? null,
        defects: repairedGate?.defects?.slice?.(0, 8) || [],
        stagnationLimit,
      });
      break;
    }

    // Feed the (still-imperfect) repaired artefact back in as the input to
    // the next attempt so successive passes compound rather than repeat the
    // same fix against the untouched original.
    currentArtifact = repairedArtifact;
    currentGate = repairedGate;
  }

  const reviewCouncil = reviewDecision({
    councilKey,
    enabled,
    originalGate: gate,
    repairedGate,
    attempts: [
      `${attemptLog.length} of ${effectiveMaxAttempts} bounded repair-and-revalidate attempts used`,
      "deterministic text repair",
      "gate re-validation",
      "specialist-seat protocol and hard-gate arbitration",
      "micro-surgery rule: repair only failed components, then revalidate",
      repairedGate?.ok ? "chair outcome: approved repaired artefact" : `chair outcome: quarantine after ${attemptLog.length} reviewed attempts`,
    ],
  });
  reviewCouncil.attemptLog = attemptLog;
  reviewCouncil.attemptsUsed = attemptLog.length;
  reviewCouncil.maximumAttemptsAllowed = effectiveMaxAttempts;
  reviewCouncil.stagnationLimit = stagnationLimit;

  logger?.("review_council.gate_review", {
    councilKey,
    approved: reviewCouncil.approved,
    attemptsUsed: attemptLog.length,
    maximumAttemptsAllowed: effectiveMaxAttempts,
    stagnationLimit,
    originalScore: reviewCouncil.originalScore,
    repairedScore: reviewCouncil.repairedScore,
    remainingDefects: reviewCouncil.defectsRemaining?.slice?.(0, 8) || [],
  });

  return {
    ok: Boolean(repairedGate?.ok),
    gate: { ...repairedGate, reviewCouncil },
    artifact: repairedArtifact,
    reviewCouncil,
    repaired: Boolean(repairedGate?.ok),
  };
}

export function buildHousekeepingPlan({ lane = "content", artefacts = [] } = {}) {
  const definition = getReviewCouncilDefinition("housekeeping");
  return {
    councilKey: "housekeeping",
    enabled: isReviewCouncilEnabled("housekeeping"),
    purpose: definition.purpose,
    hardGates: definition.hardGates,
    decisionRule: definition.decisionRule,
    members: getReviewCouncilMembers("housekeeping"),
    memberDetails: definition.members,
    lane,
    actions: [
      "remove temporary generated files after successful publication",
      "keep published R2 artefacts and manifest entries",
      "retain quarantine JSON when review fails",
      "avoid deleting source evidence used by council reports",
    ],
    artefacts,
    plannedAt: new Date().toISOString(),
  };
}

export default {
  REVIEW_COUNCILS,
  isReviewCouncilEnabled,
  getReviewCouncilMembers,
  getReviewCouncilDefinition,
  repairTextForReviewCouncil,
  repairArtifactForReviewCouncil,
  repairZernioPostForReviewCouncil,
  runReviewCouncilGate,
  buildHousekeepingPlan,
};
