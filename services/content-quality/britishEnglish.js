// Canonical British-English language rules for AIMS public-facing content.
// Context-sensitive pairs are not blindly rewritten. In British computing
// usage, "program" is correct for software; "programme" is for broadcasts,
// schedules and organised programmes.

export const AMERICAN_TO_BRITISH = Object.freeze([
  ["analyze", "analyse"], ["analyzed", "analysed"], ["analyzes", "analyses"], ["analyzing", "analysing"],
  ["behavior", "behaviour"], ["behaviors", "behaviours"], ["behavioral", "behavioural"],
  ["color", "colour"], ["colors", "colours"], ["colored", "coloured"], ["coloring", "colouring"],
  ["center", "centre"], ["centers", "centres"], ["centered", "centred"], ["centering", "centring"],
  ["favor", "favour"], ["favored", "favoured"], ["favoring", "favouring"], ["favorite", "favourite"], ["favorites", "favourites"],
  ["honor", "honour"], ["honors", "honours"], ["honored", "honoured"], ["honoring", "honouring"],
  ["labor", "labour"], ["labors", "labours"],
  ["modeled", "modelled"], ["modeling", "modelling"],
  ["optimize", "optimise"], ["optimized", "optimised"], ["optimizes", "optimises"], ["optimizing", "optimising"], ["optimization", "optimisation"],
  ["organize", "organise"], ["organized", "organised"], ["organizes", "organises"], ["organizing", "organising"],
  ["organization", "organisation"], ["organizations", "organisations"], ["organizational", "organisational"],
  ["personalization", "personalisation"], ["personalize", "personalise"], ["personalized", "personalised"], ["personalizing", "personalising"],
  ["prioritize", "prioritise"], ["prioritized", "prioritised"], ["prioritizes", "prioritises"], ["prioritizing", "prioritising"],
  ["realize", "realise"], ["realized", "realised"], ["realizes", "realises"], ["realizing", "realising"],
  ["recognize", "recognise"], ["recognized", "recognised"], ["recognizes", "recognises"], ["recognizing", "recognising"],
  ["summarize", "summarise"], ["summarized", "summarised"], ["summarizes", "summarises"], ["summarizing", "summarising"],
  ["customize", "customise"], ["customized", "customised"], ["customizes", "customises"], ["customizing", "customising"],
  ["minimize", "minimise"], ["minimized", "minimised"], ["minimizes", "minimises"], ["minimizing", "minimising"],
  ["maximize", "maximise"], ["maximized", "maximised"], ["maximizes", "maximises"], ["maximizing", "maximising"],
  ["specialize", "specialise"], ["specialized", "specialised"], ["specializes", "specialises"], ["specializing", "specialising"],
  ["standardize", "standardise"], ["standardized", "standardised"], ["standardizes", "standardises"], ["standardizing", "standardising"],
  ["categorize", "categorise"], ["categorized", "categorised"], ["categorizes", "categorises"], ["categorizing", "categorising"],
  ["visualize", "visualise"], ["visualized", "visualised"], ["visualizes", "visualises"], ["visualizing", "visualising"],
  ["localize", "localise"], ["localized", "localised"], ["localizes", "localises"], ["localizing", "localising"],
  ["utilize", "utilise"], ["utilized", "utilised"], ["utilizes", "utilises"], ["utilizing", "utilising"],
  ["authorize", "authorise"], ["authorized", "authorised"], ["authorizes", "authorises"], ["authorizing", "authorising"], ["authorization", "authorisation"],
  ["memorize", "memorise"], ["memorized", "memorised"], ["memorizing", "memorising"],
  ["initialize", "initialise"], ["initialized", "initialised"], ["initializing", "initialising"],
  ["finalize", "finalise"], ["finalized", "finalised"], ["finalizing", "finalising"],
  ["traveling", "travelling"], ["traveled", "travelled"], ["traveler", "traveller"], ["travelers", "travellers"],
  ["artifact", "artefact"], ["artifacts", "artefacts"],
  ["catalog", "catalogue"], ["catalogs", "catalogues"], ["cataloged", "catalogued"], ["cataloging", "cataloguing"],
  ["defense", "defence"], ["offense", "offence"], ["gray", "grey"],
  ["fueled", "fuelled"], ["fueling", "fuelling"], ["skillful", "skilful"], ["toward", "towards"],
  ["dialog", "dialogue"], ["dialogs", "dialogues"], ["analog", "analogue"],
  ["canceled", "cancelled"], ["canceling", "cancelling"], ["labeled", "labelled"], ["labeling", "labelling"],
  ["skeptic", "sceptic"], ["skeptical", "sceptical"], ["skepticism", "scepticism"],
]);

export const BRITISH_ENGLISH_CONTEXT_GUIDANCE = Object.freeze([
  "Use British English spelling, grammar, punctuation and idiom throughout public-facing prose.",
  "Use programme for broadcasts, schedules and organised programmes, but program/programs for computer software and code.",
  "Use licence as the noun and license as the verb.",
  "Use practice as the noun and practise as the verb.",
  "Preserve exact quotations, product names, company names, URLs, code, API fields and source titles exactly as supplied.",
  "Never British-localise text inside a verified quotation.",
]);

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function findAmericanSpellings(text = "") {
  const source = String(text || "");
  return AMERICAN_TO_BRITISH
    .filter(([american]) => new RegExp(`\\b${escapeRegExp(american)}\\b`, "i").test(source))
    .map(([american, british]) => ({ american, british }));
}

export function applyBritishEnglishReplacements(text = "") {
  let output = String(text || "");
  for (const [american, british] of AMERICAN_TO_BRITISH) {
    output = output.replace(new RegExp(`\\b${escapeRegExp(american)}\\b`, "gi"), (match) => {
      if (match === match.toUpperCase()) return british.toUpperCase();
      if (match[0] === match[0]?.toUpperCase()) return british[0].toUpperCase() + british.slice(1);
      return british;
    });
  }
  return output;
}

export function britishEnglishPromptGuidance() {
  return [
    ...BRITISH_ENGLISH_CONTEXT_GUIDANCE,
    "Preferred forms include analyse, behaviour, colour, centre, organisation, organise, optimise, prioritise, personalise, recognise, realise, summarise, authorise, visualise,\
 standardise, artefact, catalogue, modelling, travelling, labelled, cancelled, defence, grey and sceptical.",
  ].join(" ");
}
